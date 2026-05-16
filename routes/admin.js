/**
 * Admin management routes.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const {
  requirePermission,
  requireSuperAdmin: requireSuperAdminRBAC,
} = require('../middleware/rbac');
const { asyncHandler, NotFoundError, ValidationError } = require('../middleware/errorHandler');
require('../middleware/validation');

const router = express.Router();

// Get all admin users
router.get(
  '/admins',
  authenticateToken,
  requirePermission('user:view'),
  asyncHandler(async (req, res) => {
    const result = await pool.query(`
    SELECT
      u.id,
      u.username,
      u.email,
      u.contact,
      u.last_login,
      u.is_active,
      u.created_at,
      r.name as role,
      r.display_name as role_display,
      c.name as clinic_name
    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN clinics c ON u.clinic_id = c.id
    WHERE r.name IN ('super_admin', 'system_admin', 'admin', 'doctor', 'nurse', 'midwife')
    ORDER BY r.hierarchy_level DESC, u.created_at ASC
  `);

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
    });
  })
);

// Get admin user by ID
router.get(
  '/admins/:id',
  authenticateToken,
  requirePermission('user:view'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await pool.query(
      `
    SELECT
      u.id,
      u.username,
      u.email,
      u.contact,
      u.last_login,
      u.is_active,
      u.created_at,
      r.name as role,
      r.display_name as role_display,
      c.name as clinic_name
    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN clinics c ON u.clinic_id = c.id
    WHERE u.id = $1
  `,
      [id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Admin user not found');
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  })
);

// Update admin user
router.put(
  '/admins/:id',
  authenticateToken,
  requireSuperAdminRBAC,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { email, contact, is_active } = req.body;

    // Prevent updating super_admin's own account through this endpoint
    const currentUser = await pool.query('SELECT role_id FROM users WHERE id = $1', [id]);
    const targetRoleResult = await pool.query('SELECT name FROM roles WHERE id = $1', [
      currentUser.rows[0]?.role_id,
    ]);

    if (targetRoleResult.rows[0]?.name === 'super_admin' && req.user.role !== 'super_admin') {
      throw new ValidationError('Cannot modify super_admin account');
    }

    const result = await pool.query(
      `
    UPDATE users
    SET
      email = COALESCE($1, email),
      contact = COALESCE($2, contact),
      is_active = COALESCE($3, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING id, username, email, contact, is_active;
  `,
      [email, contact, is_active, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Admin user not found');
    }

    res.json({
      success: true,
      message: 'Admin user updated successfully',
      data: result.rows[0],
    });
  })
);

// Reset admin password (super_admin only)
router.put(
  '/admins/:id/password',
  authenticateToken,
  requireSuperAdminRBAC,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      throw new ValidationError('Password must be at least 6 characters long');
    }

    // Prevent resetting own password through this endpoint
    if (parseInt(id) === req.user.id) {
      throw new ValidationError('Use the change password endpoint to change your own password');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const result = await pool.query(
      `
    UPDATE users
    SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, username, email;
  `,
      [passwordHash, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Admin user not found');
    }

    res.json({
      success: true,
      message: 'Password reset successfully',
      data: {
        id: result.rows[0].id,
        username: result.rows[0].username,
        email: result.rows[0].email,
      },
    });
  })
);

// Get current admin profile
router.get(
  '/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
    SELECT
      u.id,
      u.username,
      u.email,
      u.contact,
      u.last_login,
      u.created_at,
      r.name as role,
      r.display_name as role_display,
      c.name as clinic_name
    FROM users u
    JOIN roles r ON u.role_id = r.id
    LEFT JOIN clinics c ON u.clinic_id = c.id
    WHERE u.id = $1
  `,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  })
);

// Update current admin profile
router.put(
  '/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { email, contact } = req.body;

    const result = await pool.query(
      `
    UPDATE users
    SET
      email = COALESCE($1, email),
      contact = COALESCE($2, contact),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $3
    RETURNING id, username, email, contact, role_id;
  `,
      [email, contact, req.user.id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: result.rows[0],
    });
  })
);

// Get admin statistics
router.get(
  '/stats',
  authenticateToken,
  requirePermission('user:view'),
  asyncHandler(async (req, res) => {
    const [totalAdmins, activeAdmins, byRole] = await Promise.all([
      pool.query(`
      SELECT COUNT(*) as count
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.name IN ('super_admin', 'system_admin', 'admin', 'doctor', 'nurse', 'midwife')
    `),
      pool.query(`
      SELECT COUNT(*) as count
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.name IN ('super_admin', 'system_admin', 'admin', 'doctor', 'nurse', 'midwife')
      AND u.is_active = true
    `),
      pool.query(`
      SELECT r.name as role, r.display_name as role_display, r.hierarchy_level, COUNT(u.id) as count
      FROM users u
      JOIN roles r ON u.role_id = r.id
      WHERE r.name IN ('super_admin', 'system_admin', 'admin', 'doctor', 'nurse', 'midwife')
      GROUP BY r.name, r.display_name, r.hierarchy_level
      ORDER BY r.hierarchy_level DESC
    `),
    ]);

    res.json({
      success: true,
      data: {
        total: parseInt(totalAdmins.rows[0].count),
        active: parseInt(activeAdmins.rows[0].count),
        inactive: parseInt(totalAdmins.rows[0].count) - parseInt(activeAdmins.rows[0].count),
        byRole: byRole.rows,
      },
    });
  })
);

module.exports = router;
