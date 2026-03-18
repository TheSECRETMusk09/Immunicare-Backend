/**
 * Immunization Schedule Service
 *
 * Provides dynamic immunization schedule calculations based on infant's date of birth.
 * Supports due date calculation, status tracking, overdue detection, and catch-up scheduling.
 */

const pool = require('../db');

class ImmunizationScheduleService {
  /**
   * Get the infant's date of birth
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Date|null>} - Date of birth or null if not found
   */
  async getInfantDOB(infantId) {
    const result = await pool.query(
      'SELECT dob FROM patients WHERE id = $1 AND is_active = true LIMIT 1',
      [infantId],
    );

    if (result.rows.length === 0) {
      return null;
    }

    return new Date(result.rows[0].dob);
  }

  /**
   * Get infant info with DOB and guardian details
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Object|null>} - Infant info or null
   */
  async getInfantInfo(infantId) {
    const result = await pool.query(
      `
        SELECT
          p.id, p.control_number, p.first_name, p.last_name, p.dob, p.gender,
          p.weight_at_birth, p.height_at_birth, p.place_of_birth,
          g.name as guardian_name, g.phone as guardian_phone, g.email as guardian_email,
          c.name as health_center_name
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        LEFT JOIN clinics c ON c.id = p.clinic_id
        WHERE p.id = $1 AND p.is_active = true
        LIMIT 1
      `,
      [infantId],
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get all vaccination schedules from the database
   * @returns {Promise<Array>} - Array of vaccination schedules
   */
  async getAllSchedules() {
    const result = await pool.query(
      `
        SELECT
          vs.id, vs.vaccine_id, vs.vaccine_name, vs.dose_number, vs.dose_name,
          vs.total_doses, vs.age_months, vs.age_description, vs.description,
          vs.minimum_age_days, vs.grace_period_days, vs.is_active,
          v.code as vaccine_code, v.name as vaccine_full_name
        FROM vaccination_schedules vs
        LEFT JOIN vaccines v ON v.id = vs.vaccine_id
        WHERE vs.is_active = true
        ORDER BY vs.age_months ASC, vs.vaccine_name ASC, vs.dose_number ASC
      `,
    );

    return result.rows;
  }

  /**
   * Get administered vaccines for an infant
   * @param {number} infantId - The infant/patient ID
   * @returns {Promise<Object>} - Map of vaccine_id -> max dose administered
   */
  async getAdministeredVaccines(infantId) {
    const result = await pool.query(
      `
        SELECT vaccine_id, dose_no, admin_date, status
        FROM immunization_records
        WHERE patient_id = $1 AND is_active = true
        ORDER BY admin_date ASC
      `,
      [infantId],
    );

    const administered = {};
    const recordsByVaccine = {};

    result.rows.forEach(record => {
      if (!recordsByVaccine[record.vaccine_id]) {
        recordsByVaccine[record.vaccine_id] = [];
      }
      recordsByVaccine[record.vaccine_id].push(record);

      const currentMax = administered[record.vaccine_id] || 0;
      if (record.dose_no > currentMax) {
        administered[record.vaccine_id] = record.dose_no;
      }
    });

    return { administered, recordsByVaccine };
  }

  /**
   * Calculate due date based on infant's DOB and target age in months
   * @param {Date} dob - Date of birth
   * @param {number} targetAgeMonths - Target age in months
   * @returns {Date} - Calculated due date
   */
  calculateDueDate(dob, targetAgeMonths) {
    const dueDate = new Date(dob);
    dueDate.setMonth(dueDate.getMonth() + targetAgeMonths);
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
    dueDate.setDate(dueDate.getDate() + minimumAgeDays);
    return dueDate;
  }

  /**
   * Determine the status of a vaccine dose
   * @param {Date} dueDate - The calculated due date
   * {number} dosesCompleted - Number of doses already completed
   * @param {number} totalDoses - Total doses required for this vaccine
   * @param {Array} records - Array of administered records for this vaccine
   * @param {string|null} facilityContext - Facility ID for facility-aware adjustments
   * @returns {Object} - Status object with status, adminDate, daysOverdue, etc.
   */
  determineDoseStatus(dueDate, dosesCompleted, totalDoses, records = [], facilityContext = null) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const due = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

    // Find the latest record for this specific dose
    const doseRecord = records.find(r => r.dose_no === dosesCompleted + 1);

    if (dosesCompleted >= totalDoses) {
      // All doses completed
      return {
        status: 'completed',
        statusLabel: 'Completed',
        adminDate: doseRecord?.admin_date ? new Date(doseRecord.admin_date) : null,
        dueDate: dueDate,
        daysOverdue: 0,
        isComplete: true,
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
        dueDate: dueDate,
        daysOverdue: 0,
        isComplete: false,
      };
    }
  }

  /**
   * Get full immunization schedule for an infant with status
   * @param {number} infantId - The infant/patient ID
   * @param {string} facilityContext - Facility ID for facility-aware calculations
   * @returns {Promise<Object>} - Full schedule with status
   */
  async getInfantSchedule(infantId, facilityContext = null) {
    const dob = await this.getInfantDOB(infantId);
    if (!dob) {
      return { error: 'Infant not found', schedules: [] };
    }

    const infantInfo = await this.getInfantInfo(infantId);
    const schedules = await this.getAllSchedules();
    const { administered, recordsByVaccine } = await this.getAdministeredVaccines(infantId);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const infantDOB = new Date(dob.getFullYear(), dob.getMonth(), dob.getDate());

    // Calculate infant's current age in months
    const ageInMonths = (now.getFullYear() - dob.getFullYear()) * 12 +
                        (now.getMonth() - dob.getMonth());
    const ageInDays = Math.ceil((now - dob) / (1000 * 60 * 60 * 24));

    // Build schedule items with status
    const scheduleItems = schedules.map(schedule => {
      const dosesCompleted = administered[schedule.vaccine_id] || 0;
      const isComplete = dosesCompleted >= schedule.total_doses;

      // Use minimum_age_days if available, otherwise use age_months * 30
      const dueDate = schedule.minimum_age_days
        ? this.calculateDueDateFromDays(dob, schedule.minimum_age_days)
        : this.calculateDueDate(dob, schedule.age_months);

      const records = recordsByVaccine[schedule.vaccine_id] || [];
      const doseStatus = this.determineDoseStatus(
        dueDate,
        dosesCompleted,
        schedule.total_doses,
        records,
        facilityContext, // Pass facility context for facility-aware status determination
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
        dosesCompleted,
        isComplete,
        ageMonths: schedule.age_months,
        ageDescription: schedule.age_description,
        description: schedule.description,
        dueDate: doseStatus.dueDate,
        adminDate: doseStatus.adminDate,
        status: doseStatus.status,
        statusLabel: doseStatus.statusLabel,
        daysOverdue: doseStatus.daysOverdue,
        isOverdue: doseStatus.status === 'overdue',
        isUpcoming: doseStatus.status === 'upcoming',
        isFuture: doseStatus.status === 'future',
        isCompleted: doseStatus.status === 'completed',
      };
    });

    // Sort by due date (most urgent first)
    scheduleItems.sort((a, b) => {
      // Completed items go to the end
      if (a.isComplete && !b.isComplete) {
        return 1;
      }
      if (!a.isComplete && b.isComplete) {
        return -1;
      }

      // Sort by due date
      return new Date(a.dueDate) - new Date(b.dueDate);
    });

    // Calculate summary statistics
    const totalScheduled = scheduleItems.length;
    const completedCount = scheduleItems.filter(s => s.isComplete).length;
    const overdueCount = scheduleItems.filter(s => s.isOverdue).length;
    const upcomingCount = scheduleItems.filter(s => s.isUpcoming).length;
    const futureCount = scheduleItems.filter(s => s.isFuture).length;

    // Determine overall status
    let overallStatus = 'on_track';
    if (overdueCount > 0) {
      overallStatus = 'behind';
    } else if (completedCount === totalScheduled) {
      overallStatus = 'up_to_date';
    }

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
        healthCenterName: infantInfo?.health_center_name,
      },
      currentAge: {
        months: ageInMonths,
        days: ageInDays,
      },
      summary: {
        totalScheduled,
        completedCount,
        overdueCount,
        upcomingCount,
        futureCount,
        overallStatus,
      },
      schedules: scheduleItems,
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
    const dob = await this.getInfantDOB(infantId);
    if (!dob) {
      return { error: 'Infant not found' };
    }

    const result = await pool.query(
      `SELECT age_months, minimum_age_days, age_description
       FROM vaccination_schedules
       WHERE vaccine_id = $1 AND dose_number = $2 AND is_active = true
       LIMIT 1`,
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

    const now = new Date();
    const futureDate = new Date(now);
    futureDate.setDate(futureDate.getDate() + days);

    return schedule.schedules.filter(s => {
      if (s.isComplete) {
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
