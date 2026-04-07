/**
 * Immunization Schedule Service
 *
 * Provides dynamic immunization schedule calculations based on infant's date of birth.
 * Supports due date calculation, status tracking, overdue detection, and catch-up scheduling.
 */

const pool = require('../db');
const {
  getClinicTodayDateKey,
  toClinicDateKey,
} = require('../utils/clinicCalendar');

const SCHEDULE_SCHEMA_COLUMNS = [
  'is_active',
  'age_in_months',
  'age_months',
  'age_description',
  'minimum_age_days',
  'grace_period_days',
];

let scheduleSchemaPromise = null;

const resolveScheduleSchema = async () => {
  if (!scheduleSchemaPromise) {
    scheduleSchemaPromise = pool
      .query(
        `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'vaccination_schedules'
            AND column_name = ANY($1::text[])
        `,
        [SCHEDULE_SCHEMA_COLUMNS],
      )
      .then((result) => {
        const columns = new Set((result.rows || []).map((row) => row.column_name));
        const ageColumn = columns.has('age_in_months')
          ? 'age_in_months'
          : columns.has('age_months')
            ? 'age_months'
            : null;

        if (!ageColumn) {
          throw new Error('Vaccination schedules age column is not configured');
        }

        return {
          columns,
          ageColumn,
        };
      })
      .catch((error) => {
        scheduleSchemaPromise = null;
        throw error;
      });
  }

  return scheduleSchemaPromise;
};

const buildOptionalScheduleColumn = (
  availableColumns,
  columnName,
  fallbackSql,
  alias = columnName,
) => {
  if (availableColumns.has(columnName)) {
    return `vs.${columnName} AS ${alias}`;
  }

  return `${fallbackSql} AS ${alias}`;
};

class ImmunizationScheduleService {
  getClinicTodayDateKey() {
    return getClinicTodayDateKey();
  }

  getClinicTodayDate() {
    const todayKey = this.getClinicTodayDateKey();
    if (!todayKey) {
      return new Date();
    }

    return new Date(`${todayKey}T00:00:00.000Z`);
  }

  getClinicDateKey(value) {
    return toClinicDateKey(value);
  }

  getClinicDate(value) {
    const dateKey = this.getClinicDateKey(value);
    if (!dateKey) {
      return null;
    }

    return new Date(`${dateKey}T00:00:00.000Z`);
  }

  resolveProjectionReferenceDateKey(referenceDate = null) {
    return this.getClinicDateKey(referenceDate) || this.getClinicTodayDateKey();
  }

  calculateClinicAgeInDays(dob) {
    if (!(dob instanceof Date) || Number.isNaN(dob.getTime())) {
      return 0;
    }

    const clinicToday = this.getClinicTodayDate();
    return Math.max(
      0,
      Math.floor((clinicToday.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24)),
    );
  }

  calculateClinicAgeInMonths(dob) {
    if (!(dob instanceof Date) || Number.isNaN(dob.getTime())) {
      return 0;
    }

    const clinicToday = this.getClinicTodayDate();
    return (
      (clinicToday.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
      (clinicToday.getUTCMonth() - dob.getUTCMonth())
    );
  }

  /**
   * Get the infant's date of birth
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Date|null>} - Date of birth or null if not found
   */
  async getInfantDOB(infantId) {
    try {
      const result = await pool.query(
        'SELECT dob FROM patients WHERE id = $1 LIMIT 1',
        [infantId],
      );

      if (result.rows.length === 0 || !result.rows[0].dob) {
        return null;
      }

      const dob = new Date(result.rows[0].dob);
      return isNaN(dob.getTime()) ? null : dob;
    } catch (error) {
      console.error('Error getting infant DOB:', error);
      return null;
    }
  }

  /**
   * Get infant info with DOB and guardian details
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Object|null>} - Infant info or null
   */
  async getInfantInfo(infantId) {
    try {
      // First, get basic patient info to avoid schema issues with optional fields
      const result = await pool.query(
        `
          SELECT
            p.id, p.control_number, p.first_name, p.last_name, p.dob, p.sex,
            g.name as guardian_name, g.phone as guardian_phone, g.email as guardian_email
          FROM patients p
          LEFT JOIN guardians g ON g.id = p.guardian_id
          WHERE p.id = $1 AND COALESCE(p.is_active, true) = true
          LIMIT 1
        `,
        [infantId],
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (err) {
      console.error('Error fetching infant info:', err);
      // Fallback minimal query
      try {
        const fallbackResult = await pool.query(
          'SELECT id, control_number, first_name, last_name, dob FROM patients WHERE id = $1 LIMIT 1',
          [infantId],
        );
        return fallbackResult.rows.length > 0 ? fallbackResult.rows[0] : null;
      } catch (innerErr) {
        console.error('Fatal error fetching infant info:', innerErr);
        return null;
      }
    }
  }

  /**
   * Get all vaccination schedules from the database
   * @returns {Promise<Array>} - Array of vaccination schedules
   */
  async getAllSchedules() {
    try {
      const { columns, ageColumn } = await resolveScheduleSchema();
      const activeFilter = columns.has('is_active')
        ? 'WHERE COALESCE(vs.is_active, true) = true'
        : '';
      const result = await pool.query(
        `
          SELECT
            vs.id,
            vs.vaccine_id,
            COALESCE(NULLIF(TRIM(vs.vaccine_name), ''), v.name) AS vaccine_name,
            vs.dose_number,
            CONCAT('Dose ', COALESCE(vs.dose_number, 1)) AS dose_name,
            vs.total_doses,
            vs.${ageColumn} AS age_months,
            ${buildOptionalScheduleColumn(columns, 'age_description', 'NULL::text')},
            vs.description,
            ${buildOptionalScheduleColumn(columns, 'minimum_age_days', 'NULL::integer')},
            ${buildOptionalScheduleColumn(columns, 'grace_period_days', 'NULL::integer')},
            v.code AS vaccine_code,
            v.name AS vaccine_full_name
          FROM vaccination_schedules vs
          LEFT JOIN vaccines v ON v.id = vs.vaccine_id
          ${activeFilter}
          ORDER BY
            vs.${ageColumn} ASC,
            COALESCE(NULLIF(TRIM(vs.vaccine_name), ''), v.name) ASC,
            vs.dose_number ASC
        `,
      );
      return result.rows;
    } catch (error) {
      console.error('Error in getAllSchedules:', error);
      return [];
    }
  }

  async getReadinessLookupsForPatients(patientIds = []) {
    const normalizedPatientIds = [...new Set(
      patientIds
        .map((patientId) => Number.parseInt(patientId, 10))
        .filter((patientId) => Number.isFinite(patientId) && patientId > 0),
    )];

    if (normalizedPatientIds.length === 0) {
      return new Map();
    }

    let rows = [];
    try {
      const result = await pool.query(
        `
          SELECT
            infant_id,
            vaccine_id,
            is_ready,
            ready_confirmed_by,
            ready_confirmed_at,
            notes
          FROM infant_vaccine_readiness
          WHERE infant_id = ANY($1::int[])
            AND COALESCE(is_active, true) = true
        `,
        [normalizedPatientIds],
      );
      rows = result.rows || [];
    } catch (error) {
      console.error('Error fetching vaccine readiness lookups:', error);
      rows = [];
    }

    return rows.reduce((lookup, row) => {
      const patientId = Number.parseInt(row.infant_id, 10);
      const vaccineId = Number.parseInt(row.vaccine_id, 10);

      if (!patientId || !vaccineId) {
        return lookup;
      }

      if (!lookup.has(patientId)) {
        lookup.set(patientId, new Map());
      }

      lookup.get(patientId).set(vaccineId, {
        vaccineId,
        isReady: Boolean(row.is_ready),
        confirmedBy: row.ready_confirmed_by || null,
        confirmedAt: row.ready_confirmed_at || null,
        notes: row.notes || null,
      });

      return lookup;
    }, new Map());
  }

  buildVaccinationLookupFromRows(rows = []) {
    const administered = {};
    const recordsByVaccine = {};

    rows.forEach((record) => {
      const vaccineId = Number(record.vaccine_id);
      if (!vaccineId) {
        return;
      }

      const normalizedStatus = String(record.status || '').trim().toLowerCase();
      const isCompleted = Boolean(record.admin_date) || normalizedStatus === 'completed';
      const doseNumber = Number.parseInt(record.dose_no, 10);

      if (!recordsByVaccine[vaccineId]) {
        recordsByVaccine[vaccineId] = [];
      }

      recordsByVaccine[vaccineId].push({
        ...record,
        vaccine_id: vaccineId,
        dose_no: Number.isFinite(doseNumber) ? doseNumber : record.dose_no,
        is_completed: isCompleted,
      });

      const currentMax = administered[vaccineId] || 0;
      if (isCompleted && Number.isFinite(doseNumber) && doseNumber > currentMax) {
        administered[vaccineId] = doseNumber;
      }
    });

    return { administered, recordsByVaccine };
  }

  /**
   * Get administered vaccines for an infant
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Object>} - Map of vaccine_id -> max dose administered
   */
  async getAdministeredVaccines(infantId) {
    let rows = [];
    try {
      const result = await pool.query(
        `
          SELECT vaccine_id, dose_no, admin_date, status
          FROM immunization_records
          WHERE patient_id = $1 AND COALESCE(is_active, true) = true
          ORDER BY admin_date ASC
        `,
        [infantId],
      );
      rows = result.rows;
    } catch (err) {
      // Fallback if status or is_active doesn't exist
      try {
        const result = await pool.query(
          `
            SELECT vaccine_id, dose_no, admin_date
            FROM immunization_records
            WHERE patient_id = $1
            ORDER BY admin_date ASC
          `,
          [infantId],
        );
        rows = result.rows.map(r => ({ ...r, status: r.admin_date ? 'completed' : 'pending' }));
      } catch (innerErr) {
        console.error('Error fetching administered vaccines:', innerErr);
        rows = [];
      }
    }

    return this.buildVaccinationLookupFromRows(rows);
  }

  async getAdministeredVaccinesForPatients(patientIds = []) {
    const normalizedPatientIds = [...new Set(
      patientIds
        .map((patientId) => Number.parseInt(patientId, 10))
        .filter((patientId) => Number.isFinite(patientId) && patientId > 0),
    )];

    if (normalizedPatientIds.length === 0) {
      return new Map();
    }

    let rows = [];
    try {
      const result = await pool.query(
        `
          SELECT patient_id, vaccine_id, dose_no, admin_date, status
          FROM immunization_records
          WHERE patient_id = ANY($1::int[])
            AND COALESCE(is_active, true) = true
          ORDER BY patient_id ASC, admin_date ASC NULLS LAST, dose_no ASC
        `,
        [normalizedPatientIds],
      );
      rows = result.rows;
    } catch (error) {
      try {
        const result = await pool.query(
          `
            SELECT patient_id, vaccine_id, dose_no, admin_date
            FROM immunization_records
            WHERE patient_id = ANY($1::int[])
            ORDER BY patient_id ASC, admin_date ASC NULLS LAST, dose_no ASC
          `,
          [normalizedPatientIds],
        );
        rows = result.rows.map((record) => ({
          ...record,
          status: record.admin_date ? 'completed' : 'pending',
        }));
      } catch (innerError) {
        console.error('Error fetching administered vaccines for patients:', innerError);
        rows = [];
      }
    }

    const rowsByPatientId = new Map();
    rows.forEach((record) => {
      const patientId = Number.parseInt(record.patient_id, 10);
      if (!patientId) {
        return;
      }

      if (!rowsByPatientId.has(patientId)) {
        rowsByPatientId.set(patientId, []);
      }

      rowsByPatientId.get(patientId).push(record);
    });

    return normalizedPatientIds.reduce((lookup, patientId) => {
      lookup.set(
        patientId,
        this.buildVaccinationLookupFromRows(rowsByPatientId.get(patientId) || []),
      );
      return lookup;
    }, new Map());
  }

  /**
   * Calculate due date based on infant's DOB and target age in months
   * @param {Date} dob - Date of birth
   * @param {number} targetAgeMonths - Target age in months
   * @returns {Date} - Calculated due date
   */
  calculateDueDate(dob, targetAgeMonths) {
    const dueDate = new Date(dob);
    const months = parseFloat(targetAgeMonths) || 0;
    const wholeMonths = Math.floor(months);
    const fractionalMonths = months - wholeMonths;

    dueDate.setMonth(dueDate.getMonth() + wholeMonths);
    if (fractionalMonths > 0) {
      dueDate.setDate(dueDate.getDate() + Math.round(fractionalMonths * 30.44));
    }
    return dueDate;
  }

  /**
   * Calculate due date based on minimum age in days
   * @param {Date} dob - Date of birth
   * @param {number} minimumAgeDays - Minimum age in days
   * @returns {Date} - Calculated due date
   */
  calculateDueDateFromDays(dob, minimumAgeDays) {
    const dueDate = new Date(dob);
    dueDate.setDate(dueDate.getDate() + parseInt(minimumAgeDays || 0, 10));
    return dueDate;
  }

  /**
   * Determine the status of a vaccine dose
   * @param {Date} dueDate - The calculated due date
   * @param {number} scheduleDoseNumber - Schedule dose number being evaluated
   * @param {number} completedDoseCount - Number of completed doses for this vaccine
   * @param {Array} records - Array of administered records for this vaccine
   * @param {string|null} facilityContext - Facility ID for facility-aware adjustments
   * @returns {Object} - Status object with status, adminDate, daysOverdue, etc.
   */
  determineDoseStatus(dueDate, scheduleDoseNumber, completedDoseCount, records = [], facilityContext = null) {
    if (!(dueDate instanceof Date) || isNaN(dueDate.getTime())) {
      return {
        status: 'future',
        statusLabel: 'Not Yet Due',
        adminDate: null,
        recordId: null,
        dueDate: null,
        daysOverdue: 0,
        isComplete: false,
      };
    }

    const today = this.getClinicTodayDate();
    const due = this.getClinicDate(dueDate) || dueDate;

    const doseRecord = records.find((record) =>
      Number(record.dose_no) === Number(scheduleDoseNumber) && record.is_completed,
    );

    if (doseRecord) {
      return {
        status: 'completed',
        statusLabel: 'Completed',
        adminDate: doseRecord?.admin_date ? new Date(doseRecord.admin_date) : null,
        recordId: doseRecord?.id || null,
        dueDate: dueDate,
        daysOverdue: 0,
        isComplete: true,
      };
    }

    const isNextDose = Number(scheduleDoseNumber) === Number(completedDoseCount) + 1;
    if (!isNextDose) {
      return {
        status: 'future',
        statusLabel: 'Not Yet Due',
        adminDate: null,
        recordId: null,
        dueDate: dueDate,
        daysOverdue: 0,
        isComplete: false,
      };
    }

    const diffTime = today - due;
    const daysDiff = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Facility-aware adjustment: In some facilities, we might have different grace periods
    // For example, rural health centers might have extended grace periods due to access issues
    let gracePeriodDays = 14; // Default 2 weeks grace period
    if (facilityContext === 'rural_health_unit') {
      gracePeriodDays = 21; // Extended grace period for rural facilities
    } else if (facilityContext === 'san_nicolas') {
      gracePeriodDays = 10; // Stricter grace period for main hospital
    }

    if (daysDiff > 0) {
      // Overdue
      return {
        status: 'overdue',
        statusLabel: 'Overdue',
        adminDate: null,
        recordId: null,
        dueDate: dueDate,
        daysOverdue: daysDiff,
        isComplete: false,
      };
    } else if (daysDiff >= -gracePeriodDays && daysDiff <= 0) {
      // Due within grace period (upcoming)
      return {
        status: 'upcoming',
        statusLabel: 'Due Soon',
        adminDate: null,
        recordId: null,
        dueDate: dueDate,
        daysOverdue: daysDiff,
        isComplete: false,
      };
    } else {
      // Future - not yet due
      return {
        status: 'future',
        statusLabel: 'Not Yet Due',
        adminDate: null,
        recordId: null,
        dueDate: dueDate,
        daysOverdue: 0,
        isComplete: false,
      };
    }
  }

  buildScheduleItems({
    dob,
    schedules = [],
    administered = {},
    recordsByVaccine = {},
    facilityContext = null,
  }) {
    if (!(dob instanceof Date) || Number.isNaN(dob.getTime())) {
      return [];
    }

    const scheduleItems = schedules.map((schedule) => {
      const completedDoseCount = administered[schedule.vaccine_id] || 0;
      const dueDate = schedule.minimum_age_days
        ? this.calculateDueDateFromDays(dob, schedule.minimum_age_days)
        : this.calculateDueDate(dob, schedule.age_months);
      const records = recordsByVaccine[schedule.vaccine_id] || [];
      const doseStatus = this.determineDoseStatus(
        dueDate,
        schedule.dose_number,
        completedDoseCount,
        records,
        facilityContext,
      );

      return {
        id: schedule.id,
        vaccineId: schedule.vaccine_id,
        vaccineCode: schedule.vaccine_code,
        vaccineName: schedule.vaccine_name,
        vaccineFullName: schedule.vaccine_full_name,
        doseNumber: schedule.dose_number,
        doseName: schedule.dose_name,
        totalDoses: schedule.total_doses,
        dosesCompleted: completedDoseCount,
        isComplete: doseStatus.isComplete,
        ageMonths: schedule.age_months,
        ageDescription: schedule.age_description,
        description: schedule.description,
        minimumAgeDays: schedule.minimum_age_days,
        dueDate: doseStatus.dueDate,
        adminDate: doseStatus.adminDate,
        recordId: doseStatus.recordId,
        status: doseStatus.status,
        statusLabel: doseStatus.statusLabel,
        daysOverdue: doseStatus.daysOverdue,
        isOverdue: doseStatus.status === 'overdue',
        isUpcoming: doseStatus.status === 'upcoming',
        isFuture: doseStatus.status === 'future',
        isCompleted: doseStatus.status === 'completed',
      };
    });

    scheduleItems.sort((a, b) => {
      if (a.isComplete && !b.isComplete) {
        return 1;
      }
      if (!a.isComplete && b.isComplete) {
        return -1;
      }

      if (!a.dueDate || !b.dueDate) {
        return 0;
      }

      return new Date(a.dueDate) - new Date(b.dueDate);
    });

    return scheduleItems;
  }

  summarizeScheduleItems(scheduleItems = []) {
    const totalScheduled = scheduleItems.length;
    const completedCount = scheduleItems.filter((scheduleItem) => scheduleItem.isComplete).length;
    const overdueCount = scheduleItems.filter((scheduleItem) => scheduleItem.isOverdue).length;
    const upcomingCount = scheduleItems.filter((scheduleItem) => scheduleItem.isUpcoming).length;
    const futureCount = scheduleItems.filter((scheduleItem) => scheduleItem.isFuture).length;

    let overallStatus = 'on_track';
    if (overdueCount > 0) {
      overallStatus = 'behind';
    } else if (completedCount === totalScheduled && totalScheduled > 0) {
      overallStatus = 'up_to_date';
    }

    return {
      totalScheduled,
      completedCount,
      overdueCount,
      upcomingCount,
      futureCount,
      pendingCount: overdueCount + upcomingCount,
      overallStatus,
    };
  }

  buildReadinessEntry(scheduleItem, { reason = null } = {}) {
    const dueDateKey = this.getClinicDateKey(scheduleItem?.dueDate);
    if (!dueDateKey) {
      return null;
    }

    return {
      vaccineId: scheduleItem.vaccineId,
      vaccineCode: scheduleItem.vaccineCode || null,
      doseNumber: scheduleItem.doseNumber,
      label: `${scheduleItem.vaccineName} (Dose ${scheduleItem.doseNumber})`,
      earliestDate: dueDateKey,
      recommendedDate: dueDateKey,
      reason,
    };
  }

  buildGuardianScheduleProjection(
    scheduleItems = [],
    readinessLookup = new Map(),
    options = {},
  ) {
    const referenceDateKey = this.resolveProjectionReferenceDateKey(options.referenceDate);

    const projectedSchedules = scheduleItems.map((scheduleItem) => {
      const dueDateKey = this.getClinicDateKey(scheduleItem?.dueDate);
      const isNextDueDose =
        !scheduleItem.isCompleted &&
        Number(scheduleItem.doseNumber) === Number(scheduleItem.dosesCompleted || 0) + 1;
      const readiness = readinessLookup.get(Number(scheduleItem.vaccineId)) || {
        isReady: false,
        confirmedBy: null,
        confirmedAt: null,
        notes: null,
      };
      const isPastDue = Boolean(dueDateKey && referenceDateKey && dueDateKey < referenceDateKey);
      const isDueOnReferenceDate = Boolean(
        dueDateKey && referenceDateKey && dueDateKey === referenceDateKey,
      );
      const isEligibleByReferenceDate = Boolean(
        dueDateKey && referenceDateKey && dueDateKey <= referenceDateKey,
      );

      let status = 'upcoming';
      if (scheduleItem.isCompleted) {
        status = 'completed';
      } else if (!isNextDueDose || !dueDateKey || (referenceDateKey && dueDateKey > referenceDateKey)) {
        status = 'upcoming';
      } else if (!readiness.isReady) {
        status = 'pending_confirmation';
      } else if (isPastDue) {
        status = 'overdue';
      } else if (isDueOnReferenceDate) {
        status = 'ready';
      } else {
        status = 'upcoming';
      }

      return {
        ...scheduleItem,
        status,
        isReady: Boolean(readiness.isReady),
        readinessConfirmedBy: readiness.confirmedBy || null,
        readinessConfirmedAt: readiness.confirmedAt || null,
        readinessNotes: readiness.notes || null,
        isNextDueDose,
        dueDateKey,
        isDueToday: isDueOnReferenceDate,
        isPastDue,
        isEligibleByReferenceDate,
        canBeAdministered:
          Boolean(readiness.isReady) &&
          isNextDueDose &&
          !scheduleItem.isCompleted &&
          isEligibleByReferenceDate,
      };
    });

    const summary = {
      totalVaccines: projectedSchedules.length,
      completed: projectedSchedules.filter((item) => item.isCompleted).length,
      ready: projectedSchedules.filter(
        (item) =>
          !item.isCompleted &&
          item.isNextDueDose &&
          item.isDueToday &&
          item.isReady,
      ).length,
      pendingConfirmation: projectedSchedules.filter(
        (item) =>
          !item.isCompleted &&
          item.isNextDueDose &&
          Boolean(item.isEligibleByReferenceDate) &&
          !item.isReady,
      ).length,
      upcoming: projectedSchedules.filter(
        (item) =>
          !item.isCompleted &&
          (!item.isNextDueDose ||
            Boolean(item.dueDateKey && referenceDateKey && item.dueDateKey > referenceDateKey)),
      ).length,
      overdue: projectedSchedules.filter(
        (item) =>
          !item.isCompleted &&
          item.isNextDueDose &&
          item.isPastDue,
      ).length,
    };

    const dueVaccines = projectedSchedules
      .filter(
        (item) =>
          !item.isCompleted &&
          item.isNextDueDose &&
          item.isDueToday &&
          item.isReady,
      )
      .map((item) => this.buildReadinessEntry(item))
      .filter(Boolean);

    const overdueVaccines = projectedSchedules
      .filter(
        (item) =>
          !item.isCompleted &&
          item.isNextDueDose &&
          item.isPastDue &&
          item.isReady,
      )
      .map((item) => this.buildReadinessEntry(item))
      .filter(Boolean);

    const blockedVaccines = projectedSchedules
      .filter(
        (item) =>
          !item.isCompleted &&
          item.isNextDueDose &&
          Boolean(item.isEligibleByReferenceDate) &&
          !item.isReady,
      )
      .map((item) =>
        this.buildReadinessEntry(item, {
          reason: 'Pending admin confirmation',
        }),
      )
      .filter(Boolean);

    const prioritizedVaccine =
      overdueVaccines[0] || dueVaccines[0] || blockedVaccines[0] || null;

    let readinessStatus = 'UPCOMING';
    if (overdueVaccines.length > 0) {
      readinessStatus = 'OVERDUE';
    } else if (dueVaccines.length > 0) {
      readinessStatus = 'READY';
    } else if (blockedVaccines.length > 0) {
      readinessStatus = 'PENDING_CONFIRMATION';
    }

    return {
      schedules: projectedSchedules,
      summary,
      readiness: {
        referenceDate: referenceDateKey,
        readinessStatus,
        dueVaccines,
        overdueVaccines,
        blockedVaccines,
        nextAppointmentPrediction: prioritizedVaccine
          ? {
              date: prioritizedVaccine.recommendedDate,
              reason:
                prioritizedVaccine.reason ||
                'Earliest safe date for next eligible dose',
            }
          : null,
      },
    };
  }

  async getScheduleSummariesForPatients(patientRows = [], options = {}) {
    const uniquePatients = [];
    const seenPatientIds = new Set();

    patientRows.forEach((patientRow) => {
      const patientId = Number.parseInt(patientRow?.id, 10);
      if (!patientId || seenPatientIds.has(patientId)) {
        return;
      }

      seenPatientIds.add(patientId);
      uniquePatients.push({
        ...patientRow,
        id: patientId,
      });
    });

    if (uniquePatients.length === 0) {
      return new Map();
    }

    const schedules = await this.getAllSchedules();
    const vaccinationLookupByPatient = await this.getAdministeredVaccinesForPatients(
      uniquePatients.map((patient) => patient.id),
    );

    return uniquePatients.reduce((summaryMap, patient) => {
      const facilityContext = typeof options.getFacilityContext === 'function'
        ? options.getFacilityContext(patient)
        : options.facilityContext || null;
      const dob = patient?.dob ? new Date(patient.dob) : null;
      const vaccinationLookup = vaccinationLookupByPatient.get(patient.id) || {
        administered: {},
        recordsByVaccine: {},
      };
      const scheduleItems = this.buildScheduleItems({
        dob,
        schedules,
        administered: vaccinationLookup.administered,
        recordsByVaccine: vaccinationLookup.recordsByVaccine,
        facilityContext,
      });

      summaryMap.set(patient.id, this.summarizeScheduleItems(scheduleItems));
      return summaryMap;
    }, new Map());
  }

  async getGuardianScheduleSummariesForPatients(patientRows = [], options = {}) {
    const uniquePatients = [];
    const seenPatientIds = new Set();

    patientRows.forEach((patientRow) => {
      const patientId = Number.parseInt(patientRow?.id, 10);
      if (!patientId || seenPatientIds.has(patientId)) {
        return;
      }

      seenPatientIds.add(patientId);
      uniquePatients.push({
        ...patientRow,
        id: patientId,
      });
    });

    if (uniquePatients.length === 0) {
      return new Map();
    }

    const schedules = await this.getAllSchedules();
    const patientIds = uniquePatients.map((patient) => patient.id);
    const [vaccinationLookupByPatient, readinessLookupByPatient] = await Promise.all([
      this.getAdministeredVaccinesForPatients(patientIds),
      this.getReadinessLookupsForPatients(patientIds),
    ]);

    return uniquePatients.reduce((summaryMap, patient) => {
      const facilityContext =
        typeof options.getFacilityContext === 'function'
          ? options.getFacilityContext(patient)
          : options.facilityContext || null;
      const dob = patient?.dob ? new Date(patient.dob) : null;
      const vaccinationLookup = vaccinationLookupByPatient.get(patient.id) || {
        administered: {},
        recordsByVaccine: {},
      };
      const scheduleItems = this.buildScheduleItems({
        dob,
        schedules,
        administered: vaccinationLookup.administered,
        recordsByVaccine: vaccinationLookup.recordsByVaccine,
        facilityContext,
      });
      const guardianProjection = this.buildGuardianScheduleProjection(
        scheduleItems,
        readinessLookupByPatient.get(patient.id) || new Map(),
      );

      summaryMap.set(patient.id, {
        ...guardianProjection.summary,
        pendingActionCount:
          guardianProjection.summary.ready +
          guardianProjection.summary.pendingConfirmation +
          guardianProjection.summary.overdue,
      });

      return summaryMap;
    }, new Map());
  }

  /**
   * Get full immunization schedule for an infant with status
   * @param {number} infantId - The infant/patient ID
   * @param {string} facilityContext - Facility ID for facility-aware calculations
   * @returns {Promise<Object>} - Full schedule with status
   */
  async getInfantSchedule(infantId, facilityContext = null) {
    try {
      const dob = await this.getInfantDOB(infantId);
      if (!dob) {
        return { error: 'Infant not found or invalid DOB', schedules: [] };
      }

      const infantInfo = await this.getInfantInfo(infantId);
      const schedules = await this.getAllSchedules();
      const { administered, recordsByVaccine } = await this.getAdministeredVaccines(infantId);

      // Calculate infant's current age in months
      const ageInMonths = this.calculateClinicAgeInMonths(dob);
      const ageInDays = this.calculateClinicAgeInDays(dob);

      const scheduleItems = this.buildScheduleItems({
        dob,
        schedules,
        administered,
        recordsByVaccine,
        facilityContext,
      });
      const summary = this.summarizeScheduleItems(scheduleItems);

      return {
        infantId,
        infantInfo: {
          id: infantInfo?.id,
          controlNumber: infantInfo?.control_number,
          firstName: infantInfo?.first_name,
          lastName: infantInfo?.last_name,
          dateOfBirth: dob,
          guardianName: infantInfo?.guardian_name,
          guardianPhone: infantInfo?.guardian_phone,
          guardianEmail: infantInfo?.guardian_email,
        },
        currentAge: {
          months: ageInMonths,
          days: ageInDays,
        },
        summary: {
          totalScheduled: summary.totalScheduled,
          completedCount: summary.completedCount,
          overdueCount: summary.overdueCount,
          upcomingCount: summary.upcomingCount,
          futureCount: summary.futureCount,
          overallStatus: summary.overallStatus,
        },
        schedules: scheduleItems,
      };
    } catch (error) {
      console.error('Error getting infant schedule:', error);
      return { error: 'Failed to fetch dynamic schedule', schedules: [] };
    }
  }

  async getGuardianScheduleProjection(infantId, facilityContext = null, options = {}) {
    const schedule = await this.getInfantSchedule(infantId, facilityContext);

    if (schedule.error) {
      return { error: schedule.error };
    }

    const readinessLookupByPatient = await this.getReadinessLookupsForPatients([infantId]);
    const guardianProjection = this.buildGuardianScheduleProjection(
      schedule.schedules || [],
      readinessLookupByPatient.get(infantId) || new Map(),
      options,
    );

    return {
      infantId,
      infantInfo: schedule.infantInfo,
      currentAge: schedule.currentAge,
      schedules: guardianProjection.schedules,
      summary: guardianProjection.summary,
      readiness: guardianProjection.readiness,
    };
  }

  /**
   * Calculate due date for a specific vaccine dose
   * @param {number} infantId - The infant/patient ID
   * @param {number} vaccineId - The vaccine ID
   * @param {number} doseNumber - The dose number
   * @returns {Promise<Object>} - Due date information
   */
  async calculateDueDateForDose(infantId, vaccineId, doseNumber) {
    try {
      const dob = await this.getInfantDOB(infantId);
      if (!dob) {
        return { error: 'Infant not found or invalid DOB' };
      }

      const { columns, ageColumn } = await resolveScheduleSchema();
      const activeFilter = columns.has('is_active')
        ? 'AND COALESCE(vs.is_active, true) = true'
        : '';
      const result = await pool.query(
        `
          SELECT
            vs.${ageColumn} AS age_months,
            ${buildOptionalScheduleColumn(columns, 'minimum_age_days', 'NULL::integer')},
            ${buildOptionalScheduleColumn(columns, 'age_description', 'NULL::text')}
          FROM vaccination_schedules vs
          WHERE vs.vaccine_id = $1
            AND vs.dose_number = $2
            ${activeFilter}
          LIMIT 1
        `,
        [vaccineId, doseNumber],
      );

      if (result.rows.length === 0) {
        return { error: 'Schedule not found for this vaccine and dose' };
      }

      const schedule = result.rows[0];
      const dueDate = schedule.minimum_age_days
        ? this.calculateDueDateFromDays(dob, schedule.minimum_age_days)
        : this.calculateDueDate(dob, schedule.age_months);

      // Get doses already completed
      const { administered } = await this.getAdministeredVaccines(infantId);
      const dosesCompleted = administered[vaccineId] || 0;

      return {
        infantId,
        vaccineId,
        doseNumber,
        dueDate,
        ageDescription: schedule.age_description,
        canAdminister: doseNumber === dosesCompleted + 1,
        isNextDose: doseNumber === dosesCompleted + 1,
      };
    } catch (error) {
      console.error('Error calculating due date for dose:', error);
      return { error: 'Failed to calculate due date' };
    }
  }

  /**
   * Get overall schedule status for an infant
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Object>} - Status information
   */
  async getScheduleStatus(infantId) {
    const schedule = await this.getInfantSchedule(infantId);

    if (schedule.error) {
      return { error: schedule.error };
    }

    const { summary } = schedule;

    return {
      infantId,
      overallStatus: summary.overallStatus,
      totalScheduled: summary.totalScheduled,
      completedCount: summary.completedCount,
      overdueCount: summary.overdueCount,
      upcomingCount: summary.upcomingCount,
      completionPercentage: summary.totalScheduled > 0
        ? Math.round((summary.completedCount / summary.totalScheduled) * 100)
        : 0,
    };
  }

  /**
   * Get list of overdue vaccines for an infant
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Array>} - Array of overdue vaccines
   */
  async getOverdueVaccines(infantId) {
    const schedule = await this.getInfantSchedule(infantId);

    if (schedule.error) {
      return [];
    }

    return schedule.schedules.filter(s => s.isOverdue);
  }

  /**
   * Get upcoming vaccines for an infant
   * @param {number} infantId - The infant/patient ID
   * @param {number} days - Number of days to look ahead (default 14)
   * @returns {Promise<Array>} - Array of upcoming vaccines
   */
  async getUpcomingVaccines(infantId, days = 14) {
    const schedule = await this.getInfantSchedule(infantId);

    if (schedule.error) {
      return [];
    }

    const now = this.getClinicTodayDate();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + days);

    return schedule.schedules.filter(s => {
      if (s.isComplete || !s.dueDate || !s.isUpcoming) {
        return false;
      }
      const dueDate = new Date(s.dueDate);
      return dueDate >= now && dueDate <= futureDate;
    });
  }

  /**
   * Get catch-up schedule for behind infants
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Object>} - Catch-up schedule
   */
  async getCatchUpSchedule(infantId) {
    const schedule = await this.getInfantSchedule(infantId);

    if (schedule.error) {
      return { error: schedule.error, items: [] };
    }

    const overdueItems = schedule.schedules.filter(s => s.isOverdue);
    const upcomingItems = schedule.schedules.filter(s => s.isUpcoming);

    if (overdueItems.length === 0) {
      return {
        infantId,
        needsCatchUp: false,
        message: 'Infant is on track with vaccination schedule',
        items: [],
      };
    }

    // Create prioritized catch-up schedule
    // Group by priority based on how overdue they are
    const catchUpItems = overdueItems.map((item, index) => {
      // Calculate recommended catch-up date (immediate for overdue, max 2 weeks for upcoming)
      const recommendedDate = new Date();
      recommendedDate.setDate(recommendedDate.getDate() + (index * 7)); // One per week

      return {
        ...item,
        priority: index + 1,
        recommendedDate,
        catchUpReason: item.daysOverdue > 30
          ? `Overdue by ${item.daysOverdue} days`
          : `Overdue by ${item.daysOverdue} days - prioritize`,
      };
    });

    // Add upcoming items to catch-up if there are overdue ones
    if (upcomingItems.length > 0) {
      upcomingItems.forEach((item, index) => {
        catchUpItems.push({
          ...item,
          priority: overdueItems.length + index + 1,
          recommendedDate: item.dueDate,
          catchUpReason: 'Due soon - schedule appointment',
        });
      });
    }

    return {
      infantId,
      needsCatchUp: true,
      totalOverdue: overdueItems.length,
      totalUpcoming: upcomingItems.length,
      items: catchUpItems,
    };
  }

  /**
   * Get schedule by age range
   * @param {number} infantId - The infant/patient ID
   * @param {number} minAgeMonths - Minimum age in months
   * @param {number} maxAgeMonths - Maximum age in months
   * @returns {Promise<Array>} - Filtered schedule
   */
  async getScheduleByAgeRange(infantId, minAgeMonths, maxAgeMonths) {
    const schedule = await this.getInfantSchedule(infantId);

    if (schedule.error) {
      return [];
    }

    return schedule.schedules.filter(s =>
      s.ageMonths >= minAgeMonths && s.ageMonths <= maxAgeMonths,
    );
  }

  /**
   * Get extended schedule (beyond 12 months)
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Array>} - Extended schedule items
   */
  async getExtendedSchedule(infantId) {
    return this.getScheduleByAgeRange(infantId, 12, 72); // 12 months to 6 years
  }

  /**
   * Invalidate cache after vaccination update
   * This is called when a new vaccination is recorded
   * @param {number} infantId - The infant/patient ID
   */
  async invalidateCache(infantId) {
    // For now, just log - the service calculates on-demand
    // In production, you might want to implement Redis cache invalidation
    console.log(`Cache invalidated for infant ${infantId}`);
  }
}

module.exports = new ImmunizationScheduleService();
