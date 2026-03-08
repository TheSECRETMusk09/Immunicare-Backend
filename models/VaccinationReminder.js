const pool = require('../db');

/**
 * Vaccination Reminder Model
 * Handles database operations for vaccination reminders
 */
class VaccinationReminder {
  constructor(reminderData) {
    this.id = reminderData?.id;
    this.patientId = reminderData?.patient_id || reminderData?.patientId;
    this.guardianId = reminderData?.guardian_id || reminderData?.guardianId;
    this.vaccineId = reminderData?.vaccine_id || reminderData?.vaccineId;
    this.doseNumber = reminderData?.dose_number || reminderData?.doseNumber;
    this.scheduledDate = reminderData?.scheduled_date || reminderData?.scheduledDate;
    this.reminderSentAt = reminderData?.reminder_sent_at || reminderData?.reminderSentAt;
    this.notificationId = reminderData?.notification_id || reminderData?.notificationId;
    this.status = reminderData?.status || 'sent';
    this.isRead = reminderData?.is_read !== undefined ? reminderData.is_read : false;
    this.isCompleted = reminderData?.is_completed !== undefined ? reminderData.is_completed : false;
    this.completedAt = reminderData?.completed_at || reminderData?.completedAt;
    this.notes = reminderData?.notes;
    this.createdAt = reminderData?.created_at || reminderData?.createdAt;
    this.updatedAt = reminderData?.updated_at || reminderData?.updatedAt;
  }

  /**
   * Create a new vaccination reminder
   */
  static async create(reminderData) {
    const result = await pool.query(
      `INSERT INTO vaccination_reminders (
        patient_id, guardian_id, vaccine_id, dose_number, 
        scheduled_date, notification_id, status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        reminderData.patientId,
        reminderData.guardianId,
        reminderData.vaccineId,
        reminderData.doseNumber,
        reminderData.scheduledDate,
        reminderData.notificationId || null,
        reminderData.status || 'sent',
        reminderData.notes || null
      ]
    );
    return new VaccinationReminder(result.rows[0]);
  }

  /**
   * Find reminder by ID
   */
  static async findById(id) {
    const result = await pool.query('SELECT * FROM vaccination_reminders WHERE id = $1', [id]);
    return result.rows.length > 0 ? new VaccinationReminder(result.rows[0]) : null;
  }

  /**
   * Find reminders by patient ID
   */
  static async findByPatientId(patientId, limit = 50) {
    const result = await pool.query(
      `SELECT vr.*, v.name as vaccine_name
       FROM vaccination_reminders vr
       LEFT JOIN vaccines v ON vr.vaccine_id = v.id
       WHERE vr.patient_id = $1
       ORDER BY vr.scheduled_date DESC
       LIMIT $2`,
      [patientId, limit]
    );
    return result.rows.map((row) => new VaccinationReminder(row));
  }

  /**
   * Find reminders by guardian ID
   */
  static async findByGuardianId(guardianId, limit = 50) {
    const result = await pool.query(
      `SELECT vr.*, v.name as vaccine_name,
              p.first_name as patient_first_name, p.last_name as patient_last_name
       FROM vaccination_reminders vr
       LEFT JOIN vaccines v ON vr.vaccine_id = v.id
       LEFT JOIN patients p ON vr.patient_id = p.id
       WHERE vr.guardian_id = $1
       ORDER BY vr.scheduled_date DESC
       LIMIT $2`,
      [guardianId, limit]
    );
    return result.rows.map((row) => new VaccinationReminder(row));
  }

  /**
   * Find pending reminders for a date range
   */
  static async findPendingReminders(startDate, endDate) {
    const result = await pool.query(
      `SELECT vr.*, v.name as vaccine_name,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              g.name as guardian_name, g.email as guardian_email, g.phone as guardian_phone
       FROM vaccination_reminders vr
       LEFT JOIN vaccines v ON vr.vaccine_id = v.id
       LEFT JOIN patients p ON vr.patient_id = p.id
       LEFT JOIN guardians g ON vr.guardian_id = g.id
       WHERE vr.status = 'pending'
       AND vr.scheduled_date BETWEEN $1 AND $2
       ORDER BY vr.scheduled_date ASC`,
      [startDate, endDate]
    );
    return result.rows.map((row) => new VaccinationReminder(row));
  }

  /**
   * Find upcoming reminders (not yet sent)
   */
  static async findUpcoming(daysInAdvance = 7) {
    const result = await pool.query(
      `SELECT vr.*, v.name as vaccine_name,
              p.first_name as patient_first_name, p.last_name as patient_last_name,
              g.name as guardian_name, g.email as guardian_email, g.phone as guardian_phone
       FROM vaccination_reminders vr
       LEFT JOIN vaccines v ON vr.vaccine_id = v.id
       LEFT JOIN patients p ON vr.patient_id = p.id
       LEFT JOIN guardians g ON vr.guardian_id = g.id
       WHERE vr.status = 'pending'
       AND vr.scheduled_date <= CURRENT_DATE + $1
       ORDER BY vr.scheduled_date ASC`,
      [daysInAdvance]
    );
    return result.rows.map((row) => new VaccinationReminder(row));
  }

  /**
   * Update reminder status
   */
  async updateStatus(status) {
    this.status = status;
    const result = await pool.query(
      `UPDATE vaccination_reminders 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [status, this.id]
    );
    return new VaccinationReminder(result.rows[0]);
  }

  /**
   * Mark reminder as sent
   */
  async markAsSent(notificationId) {
    this.status = 'sent';
    this.reminderSentAt = new Date();
    this.notificationId = notificationId;

    const result = await pool.query(
      `UPDATE vaccination_reminders 
       SET status = 'sent', 
           reminder_sent_at = CURRENT_TIMESTAMP,
           notification_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [notificationId, this.id]
    );
    return new VaccinationReminder(result.rows[0]);
  }

  /**
   * Mark reminder as completed
   */
  async markAsCompleted() {
    this.isCompleted = true;
    this.completedAt = new Date();
    this.status = 'completed';

    const result = await pool.query(
      `UPDATE vaccination_reminders 
       SET is_completed = TRUE,
           completed_at = CURRENT_TIMESTAMP,
           status = 'completed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [this.id]
    );
    return new VaccinationReminder(result.rows[0]);
  }

  /**
   * Mark as read
   */
  async markAsRead() {
    this.isRead = true;
    const result = await pool.query(
      `UPDATE vaccination_reminders 
       SET is_read = TRUE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [this.id]
    );
    return new VaccinationReminder(result.rows[0]);
  }

  /**
   * Delete reminder
   */
  async delete() {
    await pool.query('DELETE FROM vaccination_reminders WHERE id = $1', [this.id]);
    return true;
  }

  /**
   * Get reminder statistics
   */
  static async getStats(guardianId = null) {
    let query = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN is_completed = TRUE THEN 1 ELSE 0 END) as completed_count,
        SUM(CASE WHEN is_read = TRUE THEN 1 ELSE 0 END) as read_count
      FROM vaccination_reminders
    `;

    const params = [];
    if (guardianId) {
      query += ' WHERE guardian_id = $1';
      params.push(guardianId);
    }

    const result = await pool.query(query, params);
    return result.rows[0];
  }
}

/**
 * Guardian Notification Preference Model
 */
class GuardianNotificationPreference {
  constructor(preferenceData) {
    this.id = preferenceData?.id;
    this.guardianId = preferenceData?.guardian_id || preferenceData?.guardianId;
    this.notificationType = preferenceData?.notification_type || preferenceData?.notificationType;
    this.emailEnabled =
      preferenceData?.email_enabled !== undefined ? preferenceData.email_enabled : true;
    this.smsEnabled = preferenceData?.sms_enabled !== undefined ? preferenceData.sms_enabled : true;
    this.pushEnabled =
      preferenceData?.push_enabled !== undefined ? preferenceData.push_enabled : true;
    this.reminderDaysBefore =
      preferenceData?.reminder_days_before || preferenceData?.reminderDaysBefore || 7;
    this.preferredTime =
      preferenceData?.preferred_time || preferenceData?.preferredTime || '08:00:00';
    this.isActive = preferenceData?.is_active !== undefined ? preferenceData.is_active : true;
    this.createdAt = preferenceData?.created_at || preferenceData?.createdAt;
    this.updatedAt = preferenceData?.updated_at || preferenceData?.updatedAt;
  }

  /**
   * Find preference by ID
   */
  static async findById(id) {
    const result = await pool.query(
      'SELECT * FROM guardian_notification_preferences WHERE id = $1',
      [id]
    );
    return result.rows.length > 0 ? new GuardianNotificationPreference(result.rows[0]) : null;
  }

  /**
   * Find preferences by guardian ID
   */
  static async findByGuardianId(guardianId) {
    const result = await pool.query(
      `SELECT * FROM guardian_notification_preferences 
       WHERE guardian_id = $1 AND is_active = TRUE`,
      [guardianId]
    );
    return result.rows.map((row) => new GuardianNotificationPreference(row));
  }

  /**
   * Find specific preference by guardian and type
   */
  static async findByGuardianAndType(guardianId, notificationType) {
    const result = await pool.query(
      `SELECT * FROM guardian_notification_preferences 
       WHERE guardian_id = $1 AND notification_type = $2 AND is_active = TRUE`,
      [guardianId, notificationType]
    );
    return result.rows.length > 0 ? new GuardianNotificationPreference(result.rows[0]) : null;
  }

  /**
   * Create or update preference
   */
  static async upsert(preferenceData) {
    const result = await pool.query(
      `INSERT INTO guardian_notification_preferences (
        guardian_id, notification_type, email_enabled, sms_enabled, 
        push_enabled, reminder_days_before, preferred_time, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (guardian_id, notification_type)
      DO UPDATE SET
        email_enabled = EXCLUDED.email_enabled,
        sms_enabled = EXCLUDED.sms_enabled,
        push_enabled = EXCLUDED.push_enabled,
        reminder_days_before = EXCLUDED.reminder_days_before,
        preferred_time = EXCLUDED.preferred_time,
        is_active = EXCLUDED.is_active,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        preferenceData.guardianId,
        preferenceData.notificationType,
        preferenceData.emailEnabled !== undefined ? preferenceData.emailEnabled : true,
        preferenceData.smsEnabled !== undefined ? preferenceData.smsEnabled : true,
        preferenceData.pushEnabled !== undefined ? preferenceData.pushEnabled : true,
        preferenceData.reminderDaysBefore || 7,
        preferenceData.preferredTime || '08:00:00',
        preferenceData.isActive !== undefined ? preferenceData.isActive : true
      ]
    );
    return new GuardianNotificationPreference(result.rows[0]);
  }

  /**
   * Update preference
   */
  async update(updateData) {
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (updateData.emailEnabled !== undefined) {
      updates.push(`email_enabled = $${paramCount++}`);
      values.push(updateData.emailEnabled);
    }
    if (updateData.smsEnabled !== undefined) {
      updates.push(`sms_enabled = $${paramCount++}`);
      values.push(updateData.smsEnabled);
    }
    if (updateData.pushEnabled !== undefined) {
      updates.push(`push_enabled = $${paramCount++}`);
      values.push(updateData.pushEnabled);
    }
    if (updateData.reminderDaysBefore !== undefined) {
      updates.push(`reminder_days_before = $${paramCount++}`);
      values.push(updateData.reminderDaysBefore);
    }
    if (updateData.preferredTime !== undefined) {
      updates.push(`preferred_time = $${paramCount++}`);
      values.push(updateData.preferredTime);
    }
    if (updateData.isActive !== undefined) {
      updates.push(`is_active = $${paramCount++}`);
      values.push(updateData.isActive);
    }

    if (updates.length === 0) {
      return this;
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(this.id);

    const result = await pool.query(
      `UPDATE guardian_notification_preferences 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING *`,
      values
    );
    return new GuardianNotificationPreference(result.rows[0]);
  }

  /**
   * Delete preference (soft delete)
   */
  async delete() {
    return this.update({ isActive: false });
  }
}

/**
 * Vaccination Reminder Template Model
 */
class VaccinationReminderTemplate {
  constructor(templateData) {
    this.id = templateData?.id;
    this.templateName = templateData?.template_name || templateData?.templateName;
    this.templateType = templateData?.template_type || templateData?.templateType;
    this.language = templateData?.language || 'en';
    this.subject = templateData?.subject;
    this.bodyHtml = templateData?.body_html || templateData?.bodyHtml;
    this.bodyText = templateData?.body_text || templateData?.bodyText;
    this.variables = templateData?.variables;
    this.isActive = templateData?.is_active !== undefined ? templateData.is_active : true;
    this.createdAt = templateData?.created_at || templateData?.createdAt;
    this.updatedAt = templateData?.updated_at || templateData?.updatedAt;
  }

  /**
   * Find template by ID
   */
  static async findById(id) {
    const result = await pool.query('SELECT * FROM vaccination_reminder_templates WHERE id = $1', [
      id
    ]);
    return result.rows.length > 0 ? new VaccinationReminderTemplate(result.rows[0]) : null;
  }

  /**
   * Find template by name
   */
  static async findByName(templateName) {
    const result = await pool.query(
      'SELECT * FROM vaccination_reminder_templates WHERE template_name = $1',
      [templateName]
    );
    return result.rows.length > 0 ? new VaccinationReminderTemplate(result.rows[0]) : null;
  }

  /**
   * Find templates by type
   */
  static async findByType(templateType) {
    const result = await pool.query(
      `SELECT * FROM vaccination_reminder_templates 
       WHERE template_type = $1 AND is_active = TRUE`,
      [templateType]
    );
    return result.rows.map((row) => new VaccinationReminderTemplate(row));
  }

  /**
   * Get all active templates
   */
  static async findAll() {
    const result = await pool.query(
      'SELECT * FROM vaccination_reminder_templates WHERE is_active = TRUE'
    );
    return result.rows.map((row) => new VaccinationReminderTemplate(row));
  }
}

/**
 * Vaccination Schedule Config Model
 */
class VaccinationScheduleConfig {
  constructor(configData) {
    this.id = configData?.id;
    this.vaccineId = configData?.vaccine_id || configData?.vaccineId;
    this.vaccineName = configData?.vaccine_name || configData?.vaccineName;
    this.doseNumber = configData?.dose_number || configData?.doseNumber;
    this.ageWeeks = configData?.age_weeks || configData?.ageWeeks;
    this.ageMonths = configData?.age_months || configData?.ageMonths;
    this.minAgeWeeks = configData?.min_age_weeks || configData?.minAgeWeeks;
    this.maxAgeWeeks = configData?.max_age_weeks || configData?.maxAgeWeeks;
    this.intervalDays = configData?.interval_days || configData?.intervalDays;
    this.isMandatory = configData?.is_mandatory !== undefined ? configData.is_mandatory : true;
    this.isActive = configData?.is_active !== undefined ? configData.is_active : true;
    this.createdAt = configData?.created_at || configData?.createdAt;
    this.updatedAt = configData?.updated_at || configData?.updatedAt;
  }

  /**
   * Find config by ID
   */
  static async findById(id) {
    const result = await pool.query('SELECT * FROM vaccination_schedule_config WHERE id = $1', [
      id
    ]);
    return result.rows.length > 0 ? new VaccinationScheduleConfig(result.rows[0]) : null;
  }

  /**
   * Find config by vaccine name and dose
   */
  static async findByVaccineAndDose(vaccineName, doseNumber) {
    const result = await pool.query(
      `SELECT * FROM vaccination_schedule_config 
       WHERE vaccine_name = $1 AND dose_number = $2 AND is_active = TRUE`,
      [vaccineName, doseNumber]
    );
    return result.rows.length > 0 ? new VaccinationScheduleConfig(result.rows[0]) : null;
  }

  /**
   * Get all active schedule configs
   */
  static async findAll() {
    const result = await pool.query(
      'SELECT * FROM vaccination_schedule_config WHERE is_active = TRUE ORDER BY age_weeks ASC'
    );
    return result.rows.map((row) => new VaccinationScheduleConfig(row));
  }

  /**
   * Find configs by age range (in weeks)
   */
  static async findByAgeRange(minWeeks, maxWeeks) {
    const result = await pool.query(
      `SELECT * FROM vaccination_schedule_config 
       WHERE is_active = TRUE 
       AND age_weeks BETWEEN $1 AND $2
       ORDER BY age_weeks ASC`,
      [minWeeks, maxWeeks]
    );
    return result.rows.map((row) => new VaccinationScheduleConfig(row));
  }
}

module.exports = {
  VaccinationReminder,
  GuardianNotificationPreference,
  VaccinationReminderTemplate,
  VaccinationScheduleConfig
};
