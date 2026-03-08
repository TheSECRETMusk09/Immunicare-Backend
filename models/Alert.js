const pool = require('../db');

class Alert {
  constructor(alertData) {
    this.id = alertData?.id;
    this.title = alertData?.title;
    this.message = alertData?.message;
    this.severity = alertData?.severity;
    this.category = alertData?.category;
    this.isActive =
      alertData?.is_active !== undefined ? alertData.is_active : true;
    this.isAcknowledged =
      alertData?.is_acknowledged !== undefined
        ? alertData.is_acknowledged
        : false;
    this.acknowledgedBy =
      alertData?.acknowledged_by || alertData?.acknowledgedBy;
    this.acknowledgedAt =
      alertData?.acknowledged_at || alertData?.acknowledgedAt;
    this.createdAt = alertData?.created_at || alertData?.createdAt;
    this.expiresAt = alertData?.expires_at || alertData?.expiresAt;
    this.thresholdValue =
      alertData?.threshold_value || alertData?.thresholdValue;
    this.currentValue = alertData?.current_value || alertData?.currentValue;
    this.triggerCondition =
      alertData?.trigger_condition || alertData?.triggerCondition;
    this.resolved =
      alertData?.resolved !== undefined ? alertData.resolved : false;
    this.resolvedBy = alertData?.resolved_by || alertData?.resolvedBy;
    this.resolvedAt = alertData?.resolved_at || alertData?.resolvedAt;
    this.resolutionNotes =
      alertData?.resolution_notes || alertData?.resolutionNotes;
    this.createdBy = alertData?.created_by || alertData?.createdBy;
    this.vaccineId = alertData?.vaccine_id || alertData?.vaccineId;
    this.patientId = alertData?.patient_id || alertData?.patientId;
    this.healthCenterId =
      alertData?.health_center_id || alertData?.healthCenterId;
  }

  static async findAll(limit = 100) {
    const result = await pool.query(
      'SELECT * FROM alerts ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return result.rows.map((row) => new Alert(row));
  }

  static async findById(id) {
    const result = await pool.query('SELECT * FROM alerts WHERE id = $1', [id]);
    return result.rows.length > 0 ? new Alert(result.rows[0]) : null;
  }

  static async findActive() {
    const result = await pool.query(
      `SELECT * FROM alerts 
       WHERE is_active = TRUE AND is_acknowledged = FALSE
       ORDER BY 
         CASE severity 
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END, created_at DESC`
    );
    return result.rows.map((row) => new Alert(row));
  }

  static async findByHealthCenter(healthCenterId) {
    const result = await pool.query(
      `SELECT * FROM alerts 
       WHERE health_center_id = $1 AND is_active = TRUE
       ORDER BY 
         CASE severity 
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END, created_at DESC`,
      [healthCenterId]
    );
    return result.rows.map((row) => new Alert(row));
  }

  static async findBySeverity(severity) {
    const result = await pool.query(
      `SELECT * FROM alerts 
       WHERE severity = $1 AND is_active = TRUE
       ORDER BY created_at DESC`,
      [severity]
    );
    return result.rows.map((row) => new Alert(row));
  }

  static async create(alertData) {
    const result = await pool.query(
      `INSERT INTO alerts (
        title, message, severity, category, expires_at,
        threshold_value, current_value, trigger_condition,
        health_center_id, vaccine_id, patient_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        alertData.title,
        alertData.message,
        alertData.severity,
        alertData.category,
        alertData.expiresAt,
        alertData.thresholdValue,
        alertData.currentValue,
        alertData.triggerCondition,
        alertData.healthCenterId,
        alertData.vaccineId,
        alertData.patientId,
        alertData.createdBy
      ]
    );
    return new Alert(result.rows[0]);
  }

  async acknowledge(userId) {
    this.isAcknowledged = true;
    this.acknowledgedBy = userId;
    this.acknowledgedAt = new Date();

    const result = await pool.query(
      `UPDATE alerts SET
        is_acknowledged = TRUE,
        acknowledged_by = $1,
        acknowledged_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [userId, this.id]
    );
    return new Alert(result.rows[0]);
  }

  async resolve(userId, resolutionNotes) {
    this.resolved = true;
    this.resolvedBy = userId;
    this.resolvedAt = new Date();
    this.resolutionNotes = resolutionNotes;

    const result = await pool.query(
      `UPDATE alerts SET
        is_active = FALSE,
        resolved = TRUE,
        resolved_by = $1,
        resolved_at = CURRENT_TIMESTAMP,
        resolution_notes = $2
      WHERE id = $3 RETURNING *`,
      [userId, resolutionNotes, this.id]
    );
    return new Alert(result.rows[0]);
  }

  async deactivate() {
    const result = await pool.query(
      `UPDATE alerts SET
        is_active = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
      [this.id]
    );
    return new Alert(result.rows[0]);
  }

  static async getAlertStats() {
    const result = await pool.query(
      `SELECT
        severity,
        COUNT(*) as count,
        SUM(CASE WHEN is_acknowledged = TRUE THEN 1 ELSE 0 END) as acknowledged_count,
        SUM(CASE WHEN is_active = FALSE THEN 1 ELSE 0 END) as resolved_count
      FROM alerts
      GROUP BY severity
      ORDER BY 
        CASE severity 
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          ELSE 5
        END`
    );
    return result.rows;
  }

  static async getAlertsByCategory() {
    const result = await pool.query(
      `SELECT
        category,
        COUNT(*) as count,
        SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_count
      FROM alerts
      GROUP BY category
      ORDER BY count DESC`
    );
    return result.rows;
  }

  static async getRecentAlerts(limit = 10) {
    const result = await pool.query(
      `SELECT * FROM alerts
       WHERE is_active = TRUE
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows.map((row) => new Alert(row));
  }

  static async deleteExpired() {
    const result = await pool.query(
      `DELETE FROM alerts 
       WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
       RETURNING *`
    );
    return result.rows.map((row) => new Alert(row));
  }

  // Alert creation helpers
  static async createLowStockAlert(
    vaccineId,
    currentStock,
    threshold,
    healthCenterId,
    createdBy
  ) {
    const result = await pool.query(
      `INSERT INTO alerts (
        title, message, severity, category, 
        threshold_value, current_value, trigger_condition,
        health_center_id, vaccine_id, created_by
      ) VALUES (
        'Low Stock Alert', 
        $1, 
        'high', 
        'inventory', 
        $2, $3, 'below',
        $4, $5, $6
      )
      RETURNING *`,
      [
        `Vaccine stock is low: ${currentStock} units remaining (threshold: ${threshold})`,
        threshold,
        currentStock,
        healthCenterId,
        vaccineId,
        createdBy
      ]
    );
    return new Alert(result.rows[0]);
  }

  static async createExpiryAlert(
    vaccineId,
    batchNumber,
    expiryDate,
    healthCenterId,
    createdBy
  ) {
    const result = await pool.query(
      `INSERT INTO alerts (
        title, message, severity, category,
        health_center_id, vaccine_id, created_by
      ) VALUES (
        'Vaccine Expiry Alert',
        $1,
        'critical',
        'inventory',
        $2, $3, $4
      )
      RETURNING *`,
      [
        `Vaccine batch ${batchNumber} expires on ${expiryDate}`,
        healthCenterId,
        vaccineId,
        createdBy
      ]
    );
    return new Alert(result.rows[0]);
  }

  static async createAppointmentAlert(
    patientId,
    appointmentDate,
    healthCenterId,
    createdBy
  ) {
    const result = await pool.query(
      `INSERT INTO alerts (
        title, message, severity, category,
        health_center_id, patient_id, created_by
      ) VALUES (
        'Missed Appointment Alert',
        $1,
        'medium',
        'appointment',
        $2, $3, $4
      )
      RETURNING *`,
      [
        `Patient missed scheduled appointment on ${appointmentDate}`,
        healthCenterId,
        patientId,
        createdBy
      ]
    );
    return new Alert(result.rows[0]);
  }
}

module.exports = Alert;
