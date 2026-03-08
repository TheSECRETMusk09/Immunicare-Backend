const {
  validateAndNormalizeAnalyticsQuery,
  VACCINATION_STATUS_OPTIONS,
} = require('../validators/analyticsValidators');
const analyticsRepository = require('../repositories/analyticsRepository');

const APPOINTMENT_STATUS_MAP = Object.freeze({
  completed: ['attended'],
  attended: ['attended'],
  pending: ['scheduled', 'confirmed', 'rescheduled'],
  scheduled: ['scheduled', 'confirmed', 'rescheduled'],
  overdue: ['scheduled', 'confirmed', 'rescheduled', 'no-show'],
  cancelled: ['cancelled'],
  no_show: ['no-show'],
  all: null,
});

const IMMUNIZATION_STATUS_MAP = Object.freeze({
  completed: ['completed', 'attended'],
  attended: ['attended', 'completed'],
  pending: ['scheduled', 'pending'],
  scheduled: ['scheduled', 'pending'],
  overdue: ['scheduled', 'pending'],
  cancelled: ['cancelled'],
  no_show: ['no-show'],
  all: null,
});

const mapInt = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

const toChartPointLabel = (dateLike) => {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
  });
};

const parseDateOrNull = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
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
    const dateIso = cursor.toISOString().slice(0, 10);
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
    analyticsRepository.getInfantGuardianTotals({
      facilityId: filters.facilityId,
    }),
    analyticsRepository.getVaccinationSnapshot({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      vaccineIds,
      statuses: statusFilters.vaccinationStatuses,
      overdueOnly: statusFilters.overdueOnly,
    }),
    analyticsRepository.getVaccinationStatusBreakdown({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      vaccineIds,
      statuses: statusFilters.vaccinationStatuses,
    }),
    analyticsRepository.getAppointmentSnapshot({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      statuses: statusFilters.appointmentStatuses,
      overdueOnly: statusFilters.overdueOnly,
    }),
    analyticsRepository.getAppointmentStatusBreakdown({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      statuses: statusFilters.appointmentStatuses,
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
    }),
    analyticsRepository.getDailyVaccinationTrend({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      vaccineIds,
      statuses: statusFilters.vaccinationStatuses,
    }),
    analyticsRepository.getDailyAppointmentTrend({
      facilityId: filters.facilityId,
      startDate: filters.startDate,
      endDate: filters.endDate,
      statuses: statusFilters.appointmentStatuses,
    }),
    analyticsRepository.getDemographics({
      facilityId: filters.facilityId,
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

  const vaccinationCoverage = normalizeCoverageFromProgress(vaccineProgress, totalInfants);

  const summary = {
    totalRegisteredInfants: totalInfants,
    totalGuardians,
    vaccinationsCompletedToday: mapInt(vaccinationSnapshot.completed_today),
    administeredInPeriod: mapInt(vaccinationSnapshot.administered_in_period),
    infantsDueForVaccination: mapInt(vaccinationSnapshot.due_in_period),
    overdueVaccinations: mapInt(vaccinationSnapshot.overdue_count),
    pendingAppointments: mapInt(appointmentSnapshot.pending_in_period),
    lowStockVaccines: mapInt(inventorySnapshot.low_stock_count),
    totalAvailableVaccineDoses: mapInt(inventorySnapshot.total_available_doses),
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
    totalItems: mapInt(inventorySnapshot.total_items),
    totalAvailableDoses: mapInt(inventorySnapshot.total_available_doses),
    lowStockCount: mapInt(inventorySnapshot.low_stock_count),
    criticalStockCount: mapInt(inventorySnapshot.critical_stock_count),
    outOfStockCount: mapInt(inventorySnapshot.out_of_stock_count),
    byVaccine: inventoryByVaccine.map((item) => ({
      vaccineKey: item.vaccine_key,
      vaccineName: item.vaccine_name,
      availableDoses: mapInt(item.available_doses),
      lowStock: Boolean(item.low_stock),
      criticalStock: Boolean(item.critical_stock),
    })),
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

  const alerts = [
    ...lowStockAlerts.map((alert) => ({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      timestamp: alert.alert_at,
    })),
  ];

  const criticalAlerts = alerts.filter((item) => item.severity === 'critical');

  return {
    filters,
    summary,
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

  return {
    ...validation.filters,
    facilityId: scopedFacilityId,
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

  const normalizedQuery = hasMonthOverride
    ? {
      ...query,
      period: 'custom',
      startDate: new Date(new Date().setDate(new Date().getDate() - Math.max(7, monthsValue * 30)))
        .toISOString()
        .slice(0, 10),
      endDate: new Date().toISOString().slice(0, 10),
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
