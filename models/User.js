const pool = require('../db');

class User {
  constructor(userData) {
    this.id = userData?.id;
    this.username = userData?.username;
    this.email = userData?.email;
    this.passwordHash = userData?.password_hash;
    this.roleId = userData?.role_id || userData?.roleId;
    this.clinicId = userData?.clinic_id || userData?.clinicId;
    this.contact = userData?.contact;
    this.isActive = userData?.is_active !== undefined ? userData.is_active : true;
    this.lastLogin = userData?.last_login || userData?.lastLogin;
    this.createdAt = userData?.created_at || userData?.createdAt;
    this.updatedAt = userData?.updated_at || userData?.updatedAt;
    this.guardianId = userData?.guardian_id || userData?.guardianId;

    // Additional properties from joins
    this.roleName = userData?.role_name || userData?.roleName;
    this.roleDisplayName = userData?.display_name || userData?.displayName;
    this.clinicName = userData?.clinic_name || userData?.clinicName;
  }

  static async findById(id) {
    try {
      const result = await pool.query(
        `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
         FROM users u
         JOIN roles r ON u.role_id = r.id
         LEFT JOIN clinics c ON u.clinic_id = c.id
         WHERE u.id = $1 AND u.is_active = true`,
        [id]
      );
      return result.rows.length > 0 ? new User(result.rows[0]) : null;
    } catch (error) {
      console.error('Error finding user by id:', error);
      // If tables don't exist, return null
      return null;
    }
  }

  static async findByUsername(username) {
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.username = $1 AND u.is_active = true`,
      [username]
    );
    return result.rows.length > 0 ? new User(result.rows[0]) : null;
  }

  static async findByEmail(email) {
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );
    return result.rows.length > 0 ? new User(result.rows[0]) : null;
  }

  static async findByRole(roleId, limit = 100) {
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.role_id = $1 AND u.is_active = true
       LIMIT $2`,
      [roleId, limit]
    );
    return result.rows.map((row) => new User(row));
  }

  static async findByClinic(clinicId, limit = 100) {
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.clinic_id = $1 AND u.is_active = true
       LIMIT $2`,
      [clinicId, limit]
    );
    return result.rows.map((row) => new User(row));
  }

  static async getUserRole(userId) {
    const result = await pool.query(
      `SELECT r.name as role_name, r.display_name, r.id as role_id
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.id = $1`,
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  static async getUserClinic(userId) {
    const result = await pool.query(
      `SELECT c.id as clinic_id, c.name as clinic_name, c.address, c.contact
       FROM users u
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.id = $1`,
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async save() {
    if (this.id) {
      // Update existing user
      const result = await pool.query(
        `UPDATE users SET
          username = $1,
          email = $2,
          role_id = $3,
          clinic_id = $4,
          contact = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $6 RETURNING *`,
        [this.username, this.email, this.roleId, this.clinicId, this.contact, this.id]
      );
      return new User(result.rows[0]);
    } else {
      // Create new user
      const result = await pool.query(
        `INSERT INTO users (
          username, email, password_hash, role_id, clinic_id, contact
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [this.username, this.email, this.passwordHash, this.roleId, this.clinicId, this.contact]
      );
      return new User(result.rows[0]);
    }
  }

  async updatePassword(newPasswordHash) {
    const result = await pool.query(
      `UPDATE users SET
        password_hash = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [newPasswordHash, this.id]
    );
    return new User(result.rows[0]);
  }

  async updateLastLogin() {
    await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [this.id]);
  }

  async deactivate() {
    const result = await pool.query(
      `UPDATE users SET
        is_active = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 RETURNING *`,
      [this.id]
    );
    return new User(result.rows[0]);
  }

  static async getAllUsers(limit = 100, offset = 0) {
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.is_active = true
       ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows.map((row) => new User(row));
  }

  static async searchUsers(searchTerm, limit = 50) {
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.is_active = true AND (
         u.username ILIKE $1 OR
         u.email ILIKE $1 OR
         r.name ILIKE $1 OR
         c.name ILIKE $1
       )
       ORDER BY u.username
       LIMIT $2`,
      [`%${searchTerm}%`, limit]
    );
    return result.rows.map((row) => new User(row));
  }

  static async getUserCountByRole() {
    const result = await pool.query(
      `SELECT r.name as role_name, r.display_name, COUNT(u.id) as user_count
       FROM roles r
       LEFT JOIN users u ON r.id = u.role_id AND u.is_active = true
       GROUP BY r.name, r.display_name
       ORDER BY user_count DESC`
    );
    return result.rows;
  }

  static async getUserCountByClinic() {
    const result = await pool.query(
      `SELECT c.name as clinic_name, COUNT(u.id) as user_count
       FROM clinics c
       LEFT JOIN users u ON c.id = u.clinic_id AND u.is_active = true
       GROUP BY c.name
       ORDER BY user_count DESC`
    );
    return result.rows;
  }

  // Notification preferences methods
  async getNotificationSettings() {
    const result = await pool.query('SELECT notification_settings FROM users WHERE id = $1', [
      this.id
    ]);
    return result.rows.length > 0 ? result.rows[0].notification_settings : null;
  }

  async updateNotificationSettings(settings) {
    const result = await pool.query(
      `UPDATE users SET
        notification_settings = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [settings, this.id]
    );
    return new User(result.rows[0]);
  }

  // Guardian-specific methods
  static async findByGuardianId(guardianId) {
    const result = await pool.query(
      `SELECT u.*, r.name as role_name, r.display_name, c.name as clinic_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN clinics c ON u.clinic_id = c.id
       WHERE u.guardian_id = $1 AND u.is_active = true`,
      [guardianId]
    );
    return result.rows.map((row) => new User(row));
  }

  async updateGuardianId(guardianId) {
    const result = await pool.query(
      `UPDATE users SET
        guardian_id = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 RETURNING *`,
      [guardianId, this.id]
    );
    return new User(result.rows[0]);
  }
}

module.exports = User;
