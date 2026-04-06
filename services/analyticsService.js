const {
  validateAndNormalizeAnalyticsQuery,
  VACCINATION_STATUS_OPTIONS,
} = require('../validators/analyticsValidators');
const analyticsRepository = require('../repositories/analyticsRepository');
const { getAdminMetricsSummary } = require('./adminMetricsService');
const {
  getClinicTodayDateKey,
  shiftClinicDateKey,
} = require('../utils/clinicCalendar');

const APPOINTMENT_STATUS_MAP = Object.freeze({
  completed: ['attended'],
  attended: ['attended'],
  pending: ['scheduled', 'confirmed', 'rescheduled'],
  scheduled: ['scheduled', 'confirmed', 'rescheduled'],
  overdue: ['scheduled', 'confirmed', 'rescheduled', 'no_show'],
  cancelled: ['cancelled'],
  no_show: ['no_show'],
  all: null,
});

const IMMUNIZATION_STATUS_MAP = Object.freeze({
  completed: ['completed', 'attended'],
  attended: ['attended', 'completed'],
  pending: ['scheduled', 'pending'],
  scheduled: ['scheduled', 'pending'],
  overdue: ['scheduled', 'pending'],
  cancelled: ['cancelled'],
  no_show: ['no-show', 'no_show'],
  all: null,
});

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_ABBREVIATIONS = Object.freeze([
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]);

const mapInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const padDatePart = (value) => String(value).padStart(2, '0');

const buildLocalDate = (year, monthIndex, day) => {
  const date = new Date(year, monthIndex, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== monthIndex
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
};

const parseLocalDateValue = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return buildLocalDate(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const text = String(value).trim();
  const dateOnlyMatch = text.match(DATE_ONLY_PATTERN);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return buildLocalDate(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return buildLocalDate(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
};

const toLocalDateKey = (value) => {
  const date = parseLocalDateValue(value);
  if (!date) {
    return null;
  }

  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
};

const toMonthDayLabel = (value) => {
  const dateKey = toLocalDateKey(value);
  const match = dateKey ? dateKey.match(DATE_ONLY_PATTERN) : null;

  if (!match) {
    return '';
  }

  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  return `${MONTH_ABBREVIATIONS[monthIndex] || ''} ${day}`.trim();
};

const normalizeAlertSeverity = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'critical' || normalized === 'error') {
    return 'critical';
  }

  if (normalized === 'warning' || normalized === 'warn' || normalized === 'high') {
    return 'warning';
  }

  return normalized || 'warning';
};

const dedupeAlertsBySignature = (alerts = []) => {
  const seen = new Set();
  const deduped = [];

  alerts.forEach((item, index) => {
    const signature = `${String(item?.type || '').toLowerCase()}|${String(item?.message || '').toLowerCase()}|${String(item?.timestamp || '')}`;
    if (seen.has(signature)) {
      return;
    }

    seen.add(signature);
    deduped.push({
      id: item?.id || `alert-${index}`,
      type: item?.type || 'alert',
      severity: normalizeAlertSeverity(item?.severity),
      message: item?.message || 'Alert',
      timestamp: item?.timestamp || null,
    });
  });

  return deduped;
};

const resolveAlertTimestamp = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
};

const calculateRate = (numerator, denominator) => {
  const a = mapInt(numerator);
  const b = mapInt(denominator);
  if (b <= 0) {
    return 0;
  }

  return Number(((a / b) * 100).toFixed(2));
};

const toChartPointDate = (dateLike) => {
  return toLocalDateKey(dateLike);
};

const toChartPointLabel = (dateLike) => {
  return toMonthDayLabel(dateLike);
};

const parseDateOrNull = (value) => {
  return parseLocalDateValue(value);
};

const buildDateSpine = (startDate, endDate) => {
  const start = parseDateOrNull(startDate);
  const end = parseDateOrNull(endDate);

  if (!start || !end || start > end) {
    return [];
  }

  const points = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    const dateIso = toLocalDateKey(cursor);
    points.push({
      date: dateIso,
      label: toChartPointLabel(dateIso),
      count: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
};

const toTrendPoint = (item = {}) => {
  const date = toChartPointDate(item.day || item.date);
  if (!date) {
    return null;
  }

  return {
    date,
    label: item.label || toChartPointLabel(date),
    count: mapInt(item.count),
  };
};

const mergeTrendWithDateSpine = (rows = [], { startDate, endDate }) => {
  const normalized = rows.map(toTrendPoint).filter(Boolean);

  const spine = buildDateSpine(startDate, endDate);
  if (!spine.length) {
    return normalized;
  }

  const index = new Map(normalized.map((item) => [item.date, item]));
  return spine.map((point) => {
    const existing = index.get(point.date);
    if (!existing) {
      return point;
    }

    return {
      ...point,
      ...existing,
      label: existing.label || point.label,
      count: mapInt(existing.count),
    };
  });
};

const getStatusFilters = (vaccinationStatus) => ({
  vaccinationStatuses: IMMUNIZATION_STATUS_MAP[vaccinationStatus] || null,
  appointmentStatuses: APPOINTMENT_STATUS_MAP[vaccinationStatus] || null,
  overdueOnly: vaccinationStatus === 'overdue',
});

const mergeScopedIds = (...values) => Array.from(
  new Set(
    values
      .flat()
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0),
  ),
);

const resolveScopedFacilityId = (reqUser = {}, fallbackFacilityId = null) => {
  if (reqUser && Number.isFinite(Number.parseInt(reqUser.clinic_id, 10))) {
    return Number.parseInt(reqUser.clinic_id, 10);
  }

  if (reqUser && Number.isFinite(Number.parseInt(reqUser.facility_id, 10))) {
    return Number.parseInt(reqUser.facility_id, 10);
  }

  if (Number.isFinite(Number.parseInt(fallbackFacilityId, 10))) {
    return Number.parseInt(fallbackFacilityId, 10);
  }

  return null;
};

const resolveAppointmentScopeIds = (reqUser = {}, fallbackFacilityId = null) =>
  mergeScopedIds(reqUser?.clinic_id, reqUser?.facility_id, fallbackFacilityId);

const buildDimensionAndLookup = async ({ vaccineType }) => {
  const dimension = await analyticsRepository.getVaccineDimension();

  const filteredDimension = vaccineType === 'ALL'
    ? dimension
    : dimension.filter((item) => item.vaccine_key === vaccineType);

  const vaccineIds = filteredDimension.map((item) => mapInt(item.vaccine_id)).filter((id) => id > 0);
  const vaccineKeys = filteredDimension.map((item) => item.vaccine_key);

  return {
    dimension: filteredDimension,
    vaccineIds,
    vaccineKeys,
  };
};

const normalizeCoverageFromProgress = (progressRows = [], totalInfants = 0) => progressRows.map((row) => {
  const infantsCovered = mapInt(row.infants_covered);
  return {
    vaccineKey: row.vaccine_key,
    vaccineName: row.vaccine_name,
    infantsCovered,
    dosesAdministered: mapInt(row.doses_administered),
    dueCount: mapInt(row.due_count),
    overdueCount: mapInt(row.overdue_count),
    coverageRate: calculateRate(infantsCovered, totalInfants),
  };
});

const buildReportShortcuts = (filters) => {
  const query = new URLSearchParams({
    period: filters.period,
    startDate: filters.startDate,
    endDate: filters.endDate,
    vaccineType: filters.vaccineType,
    vaccinationStatus: filters.vaccinationStatus,
    ...(filters.facilityId ? { facilityId: String(filters.facilityId) } : {}),
  }).toString();

  return [
    {
      key: 'vaccination-summary',
      title: 'Vaccination Summary',
      format: 'pdf',
      endpoint: `/api/reports/vaccination-summary?${query}`,
    },
    {
      key: 'appointments-followup',
      title: 'Appointments and Follow-up',
      format: 'csv',
      endpoint: `/api/reports/appointments?${query}`,
    },
    {
      key: 'inventory-status',
      title: 'Inventory Status',
      format: 'xlsx',
      endpoint: `/api/reports/inventory?${query}`,
    },
    {
      key: 'sms-reminder-log',
      title: 'SMS Reminder Log',
      format: 'csv',
      endpoint: `/api/reports/notifications?${query}`,
    },
  ];
};

const collectDashboardData = async ({ filters }) => {
  const { dimension, vaccineIds, vaccineKeys } = await buildDimensionAndLookup({
    vaccineType: filters.vaccineType,
  });

  const statusFilters = getStatusFilters(filters.vaccinationStatus);

  const [
    validatedMetrics,
    totals,
    vaccinationSnapshot,
    vaccinationStatusBreakdown,
    appointmentSnapshot,
    appointmentStatusBreakdown,
    inventorySnapshot,
    inventoryByVaccine,
    vaccineProgress,
    vaccinationTrend,
    appointmentTrend,
    demographics,
    reminderStats,
    recentActivity,
    lowStockAlerts,
    failedSmsCount,
  ] = await Promise.all([
    getAdminMetricsSummary({
      startDate: filters.startDate,
      endDate: filters.endDate,
      facilityId: filters.facilityId,
      scopeIds: filters.appointmentScopeIds,
    }),
    analyticsRepository.getInfantGuardianTotals({
      facilityId: filters.facilityId,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getVaccinationSnapshot({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      vaccineIds,
      statuses: statusFilters.vaccinationStatuses,
      overdueOnly: statusFilters.overdueOnly,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getVaccinationStatusBreakdown({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      vaccineIds,
      statuses: statusFilters.vaccinationStatuses,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getAppointmentSnapshot({
      scopeIds: filters.appointmentScopeIds,
      startDate: filters.startDate,
      endDate: filters.endDate,
      statuses: statusFilters.appointmentStatuses,
      overdueOnly: statusFilters.overdueOnly,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getAppointmentStatusBreakdown({
      scopeIds: filters.appointmentScopeIds,
      startDate: filters.startDate,
      endDate: filters.endDate,
      statuses: statusFilters.appointmentStatuses,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getInventorySnapshot({
      facilityId: filters.facilityId,
      vaccineIds,
    }),
    analyticsRepository.getInventoryByVaccine({
      facilityId: filters.facilityId,
      vaccineIds,
      vaccineKeys,
    }),
    analyticsRepository.getVaccineProgress({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      vaccineIds,
      statuses: statusFilters.vaccinationStatuses,
      vaccineKeys,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getDailyVaccinationTrend({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      vaccineIds,
      statuses: statusFilters.vaccinationStatuses,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getDailyAppointmentTrend({
      scopeIds: filters.appointmentScopeIds,
      startDate: filters.startDate,
      endDate: filters.endDate,
      statuses: statusFilters.appointmentStatuses,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getDemographics({
      facilityId: filters.facilityId,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getReminderStats({
      startDate: filters.startDate,
      endDate: filters.endDate,
      facilityId: filters.facilityId,
    }),
    analyticsRepository.getRecentActivity({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      limit: filters.activityLimit,
      guardianId: filters.guardianId,
    }),
    analyticsRepository.getLowStockAlerts({
      facilityId: filters.facilityId,
      vaccineIds,
      limit: filters.alertLimit,
    }),
    analyticsRepository.getFailedSmsCount({
      startDate: filters.startDate,
      endDate: filters.endDate,
    }),
  ]);

  const totalInfants = mapInt(totals.total_infants);
  const totalGuardians = mapInt(totals.total_guardians);
  const normalizedInventoryByVaccine = inventoryByVaccine.map((item) => ({
    vaccineKey: item.vaccine_key,
    vaccineName: item.vaccine_name,
    availableDoses: mapInt(item.available_doses),
    lowStock: Boolean(item.low_stock),
    criticalStock: Boolean(item.critical_stock),
  }));
  const inventoryTotals = normalizedInventoryByVaccine.reduce(
    (accumulator, item) => {
      const availableDoses = mapInt(item.availableDoses);
      const isOutOfStock = availableDoses <= 0;
      const isCriticalStock = !isOutOfStock && Boolean(item.criticalStock);
      const isLowStock =
        !isOutOfStock &&
        !isCriticalStock &&
        Boolean(item.lowStock);

      return {
        totalAvailableDoses:
          accumulator.totalAvailableDoses + availableDoses,
        lowStockCount: accumulator.lowStockCount + (isLowStock ? 1 : 0),
        criticalStockCount:
          accumulator.criticalStockCount + (isCriticalStock ? 1 : 0),
        outOfStockCount:
          accumulator.outOfStockCount + (isOutOfStock ? 1 : 0),
        needsReplenishmentCount:
          accumulator.needsReplenishmentCount +
          (isLowStock || isCriticalStock || isOutOfStock ? 1 : 0),
      };
    },
    {
      totalAvailableDoses: 0,
      lowStockCount: 0,
      criticalStockCount: 0,
      outOfStockCount: 0,
      needsReplenishmentCount: 0,
    },
  );

  const vaccinationCoverage = normalizeCoverageFromProgress(vaccineProgress, totalInfants);

  const summary = {
    totalRegisteredInfants: totalInfants,
    totalGuardians,
    vaccinationsCompletedToday: mapInt(vaccinationSnapshot.completed_today),
    administeredInPeriod: mapInt(vaccinationSnapshot.administered_in_period),
    infantsDueForVaccination: mapInt(vaccinationSnapshot.due_in_period),
    dueSoon7Days: mapInt(vaccinationSnapshot.due_soon_7_days),
    overdueVaccinations: mapInt(vaccinationSnapshot.overdue_count),
    pendingAppointments: mapInt(appointmentSnapshot.pending_in_period),
    lowStockVaccines: inventoryTotals.needsReplenishmentCount,
    totalAvailableVaccineDoses: inventoryTotals.totalAvailableDoses,
    uniqueInfantsServed: mapInt(vaccinationSnapshot.unique_infants_served),
  };

  const appointmentFollowup = {
    totalInPeriod: mapInt(appointmentSnapshot.total_in_period),
    today: mapInt(appointmentSnapshot.today_total),
    attended: mapInt(appointmentSnapshot.attended_in_period),
    pending: mapInt(appointmentSnapshot.pending_in_period),
    cancelled: mapInt(appointmentSnapshot.cancelled_in_period),
    upcoming7Days: mapInt(appointmentSnapshot.upcoming_7_days),
    overdueFollowUps: mapInt(appointmentSnapshot.overdue_followups),
    followUpsToday: mapInt(appointmentSnapshot.followups_today),
    followUpsInPeriod: mapInt(appointmentSnapshot.followups_in_period),
    statusBreakdown: appointmentStatusBreakdown.map((item) => ({
      status: item.status,
      count: mapInt(item.count),
    })),
  };

  const inventory = {
    totalItems: normalizedInventoryByVaccine.length,
    totalAvailableDoses: inventoryTotals.totalAvailableDoses,
    lowStockCount: inventoryTotals.lowStockCount,
    criticalStockCount: inventoryTotals.criticalStockCount,
    outOfStockCount: inventoryTotals.outOfStockCount,
    byVaccine: normalizedInventoryByVaccine,
  };

  const reminders = {
    smsSent: mapInt(reminderStats.sms_sent),
    smsDelivered: mapInt(reminderStats.sms_delivered),
    smsFailed: mapInt(reminderStats.sms_failed) + mapInt(reminderStats.sms_log_failed),
    unreadNotifications: mapInt(reminderStats.unread_notifications),
    smsLogTotal: mapInt(reminderStats.sms_log_total),
    failedSmsCount: mapInt(failedSmsCount),
    deliveryRate: calculateRate(reminderStats.sms_delivered, reminderStats.sms_sent),
  };

  const vaccinationAnalytics = {
    statusBreakdown: vaccinationStatusBreakdown.map((item) => ({
      status: item.status,
      count: mapInt(item.count),
    })),
    vaccineProgress: vaccinationCoverage,
  };

  const trends = {
    vaccination: mergeTrendWithDateSpine(vaccinationTrend, {
      startDate: filters.startDate,
      endDate: filters.endDate,
    }),
    appointments: mergeTrendWithDateSpine(appointmentTrend, {
      startDate: filters.startDate,
      endDate: filters.endDate,
    }),
  };

  const inventoryAlerts = [
    ...lowStockAlerts.map((alert, index) => ({
      id: alert.id || `inventory-alert-${index}`,
      type: alert.type || 'inventory',
      severity: normalizeAlertSeverity(alert.severity),
      message: alert.message || 'Low stock alert',
      timestamp: resolveAlertTimestamp(alert.alert_at) || new Date().toISOString(),
    })),
  ];

  const overdueVaccinationAlerts = summary.overdueVaccinations > 0
    ? [
      {
        id: `overdue-vaccinations-${filters.startDate}-${filters.endDate}`,
        type: 'vaccination',
        severity: summary.overdueVaccinations >= 10 ? 'critical' : 'warning',
        message: `${summary.overdueVaccinations} infant vaccination${summary.overdueVaccinations === 1 ? '' : 's'} overdue`,
        timestamp: new Date().toISOString(),
      },
    ]
    : [];

  const failedSmsAlerts = reminders.failedSmsCount > 0
    ? [
      {
        id: `failed-sms-${filters.startDate}-${filters.endDate}`,
        type: 'reminder',
        severity: reminders.failedSmsCount >= 5 ? 'critical' : 'warning',
        message: `${reminders.failedSmsCount} reminder SMS failed in selected period`,
        timestamp: new Date().toISOString(),
      },
    ]
    : [];

  const alerts = dedupeAlertsBySignature([
    ...inventoryAlerts,
    ...overdueVaccinationAlerts,
    ...failedSmsAlerts,
  ]);

  const criticalAlerts = alerts.filter((item) => item.severity === 'critical');

  return {
    filters,
    summary,
    validatedMetrics,
    vaccinationAnalytics,
    appointmentFollowup,
    inventory,
    reminders,
    demographics,
    trends,
    recentActivity: recentActivity.map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      description: item.description,
      severity: item.severity,
      timestamp: item.activity_at,
    })),
    alerts,
    criticalAlerts,
    reportShortcuts: buildReportShortcuts(filters),
    metadata: {
      vaccineDimension: dimension,
      vaccineFilterApplied: filters.vaccineType,
      vaccinationStatusApplied: filters.vaccinationStatus,
      generatedAt: new Date().toISOString(),
      scope: {
        facilityId: filters.facilityId,
        locality: 'Barangay Health Center, Pasig City',
      },
    },
  };
};

const validateFilters = (query, user) => {
  const validation = validateAndNormalizeAnalyticsQuery(query, user);
  if (!validation.isValid) {
    const error = new Error('Invalid analytics query parameters');
    error.statusCode = 400;
    error.details = validation.errors;
    throw error;
  }

  const scopedFacilityId = resolveScopedFacilityId(user, validation.filters.facilityId);

  // Extract guardianId from user object - support multiple property names
  // The user object may have: guardian_id, guardianId, or id (for legacy tokens)
  const isGuardian = user?.role === 'GUARDIAN' || user?.role_type === 'GUARDIAN';
  let guardianId = null;

  if (isGuardian) {
    // Try to get guardian_id from various possible properties
    guardianId = user?.guardian_id
      ? (Number.isFinite(Number.parseInt(user.guardian_id, 10)) ? Number.parseInt(user.guardian_id, 10) : null)
      : (user?.id
        ? (Number.isFinite(Number.parseInt(user.id, 10)) ? Number.parseInt(user.id, 10) : null)
        : null);
  }

  const appointmentScopeIds = isGuardian
    ? []
    : resolveAppointmentScopeIds(user, validation.filters.facilityId);

  return {
    ...validation.filters,
    facilityId: scopedFacilityId,
    guardianId,
    appointmentScopeIds,
  };
};

const getDashboardAnalytics = async ({ query, user }) => {
  const filters = validateFilters(query, user);
  return collectDashboardData({ filters });
};

const getVaccinationAnalytics = async ({ query, user }) => {
  const filters = validateFilters(query, user);
  const dashboard = await collectDashboardData({ filters });

  return {
    filters: dashboard.filters,
    summary: {
      completedToday: dashboard.summary.vaccinationsCompletedToday,
      administeredInPeriod: dashboard.summary.administeredInPeriod,
      dueInPeriod: dashboard.summary.infantsDueForVaccination,
      dueSoon7Days: dashboard.summary.dueSoon7Days,
      overdue: dashboard.summary.overdueVaccinations,
      uniqueInfantsServed: dashboard.summary.uniqueInfantsServed,
    },
    statusBreakdown: dashboard.vaccinationAnalytics.statusBreakdown,
    vaccineProgress: dashboard.vaccinationAnalytics.vaccineProgress,
    trends: dashboard.trends.vaccination,
    generatedAt: dashboard.metadata.generatedAt,
  };
};

const getAppointmentAnalytics = async ({ query, user }) => {
  const filters = validateFilters(query, user);
  const dashboard = await collectDashboardData({ filters });

  return {
    filters: dashboard.filters,
    ...dashboard.appointmentFollowup,
    trends: dashboard.trends.appointments,
    generatedAt: dashboard.metadata.generatedAt,
  };
};

const getInventoryAnalytics = async ({ query, user }) => {
  const filters = validateFilters(query, user);
  const dashboard = await collectDashboardData({ filters });

  return {
    filters: dashboard.filters,
    ...dashboard.inventory,
    criticalAlerts: dashboard.criticalAlerts,
    generatedAt: dashboard.metadata.generatedAt,
  };
};

const getTrendsAnalytics = async ({ query, user }) => {
  const monthsValue = Number.parseInt(query.months, 10);
  const hasMonthOverride = Number.isFinite(monthsValue);
  const todayKey = getClinicTodayDateKey();
  const overrideStartDate = todayKey
    ? shiftClinicDateKey(todayKey, -Math.max(7, monthsValue * 30 || 0))
    : null;

  const normalizedQuery = hasMonthOverride
    ? {
      ...query,
      period: 'custom',
      startDate: overrideStartDate,
      endDate: todayKey,
    }
    : query;

  const filters = validateFilters(normalizedQuery, user);
  const dashboard = await collectDashboardData({ filters });

  return {
    filters: dashboard.filters,
    vaccinations: dashboard.trends.vaccination,
    appointments: dashboard.trends.appointments,
    generatedAt: dashboard.metadata.generatedAt,
  };
};

const getDemographicsAnalytics = async ({ query, user }) => {
  const filters = validateFilters(query, user);
  const dashboard = await collectDashboardData({ filters });

  return {
    filters: dashboard.filters,
    ...dashboard.demographics,
    generatedAt: dashboard.metadata.generatedAt,
  };
};

const getDashboardSummaryAnalytics = async ({ query, user }) => {
  const filters = validateFilters(query, user);
  const dashboard = await collectDashboardData({ filters });

  return {
    summary: {
      infants: dashboard.summary.totalRegisteredInfants,
      guardians: dashboard.summary.totalGuardians,
      appointmentsToday: dashboard.appointmentFollowup.today,
      lowStock: dashboard.summary.lowStockVaccines,
      overdueVaccinations: dashboard.summary.overdueVaccinations,
      completedToday: dashboard.summary.vaccinationsCompletedToday,
    },
    vaccinationActivity: dashboard.trends.vaccination,
    appointmentDistribution: dashboard.appointmentFollowup.statusBreakdown,
    generatedAt: dashboard.metadata.generatedAt,
  };
};

const getAvailableFilterOptions = () => ({
  periods: ['today', 'week', 'month', 'custom'],
  vaccineTypes: analyticsRepository.REQUIRED_VACCINE_KEYS,
  vaccinationStatuses: Array.from(VACCINATION_STATUS_OPTIONS),
  refreshIntervalsSeconds: [15, 30, 60],
});

module.exports = {
  getDashboardAnalytics,
  getVaccinationAnalytics,
  getAppointmentAnalytics,
  getInventoryAnalytics,
  getTrendsAnalytics,
  getDemographicsAnalytics,
  getDashboardSummaryAnalytics,
  getAvailableFilterOptions,
};
