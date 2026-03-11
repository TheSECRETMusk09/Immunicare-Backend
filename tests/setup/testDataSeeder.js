const bcrypt = require('bcryptjs');
const pool = require('../../db');

const TEST_ADMIN = {
  username: 'enrico.torres',
  email: 'enrico.torres@immunicare.gov.ph',
  password: 'QaAdmin!234',
  name: 'Enrico Torres',
};

const TEST_GUARDIAN = {
  username: 'maria.santos',
  email: 'maria.santos@example.com',
  phone: '+639178912345',
  password: 'QaGuardian!234',
  name: 'Maria Clara Santos',
  relationship: 'mother',
};

const ensureClinic = async () => {
  const clinicResult = await pool.query(
    `SELECT id
     FROM clinics
     WHERE lower(name) = lower($1)
     LIMIT 1`,
    ['Guardian Portal'],
  );

  if (clinicResult.rows.length > 0) {
    return clinicResult.rows[0].id;
  }

  const created = await pool.query(
    `INSERT INTO clinics (name, region, address, contact)
     VALUES ('Guardian Portal', 'Virtual', 'Online', 'N/A')
     RETURNING id`,
  );

  return created.rows[0].id;
};

const ensureRole = async (name, displayName, hierarchyLevel, permissions) => {
  const existing = await pool.query('SELECT id FROM roles WHERE lower(name) = lower($1) LIMIT 1', [name]);
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  const created = await pool.query(
    `INSERT INTO roles (name, display_name, hierarchy_level, permissions, is_system_role)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id`,
    [name, displayName, hierarchyLevel, JSON.stringify(permissions || {}), name !== 'guardian'],
  );
  return created.rows[0].id;
};

const ensureUser = async ({ username, email, password, roleId, clinicId, guardianId = null }) => {
  const existing = await pool.query(
    'SELECT id FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2) LIMIT 1',
    [username, email],
  );

  const passwordHash = await bcrypt.hash(password, 10);

  if (existing.rows.length > 0) {
    const updated = await pool.query(
      `UPDATE users
       SET username = $1,
           email = $2,
           password_hash = $3,
           role_id = $4,
           clinic_id = $5,
           guardian_id = $6,
           is_active = true,
           force_password_change = false,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id`,
      [username, email, passwordHash, roleId, clinicId, guardianId, existing.rows[0].id],
    );
    return updated.rows[0].id;
  }

  const inserted = await pool.query(
    `INSERT INTO users (username, email, password_hash, role_id, clinic_id, guardian_id, is_active, force_password_change)
     VALUES ($1, $2, $3, $4, $5, $6, true, false)
     RETURNING id`,
    [username, email, passwordHash, roleId, clinicId, guardianId],
  );
  return inserted.rows[0].id;
};

const ensureGuardianRecord = async ({ name, email, phone, relationship }) => {
  const existing = await pool.query('SELECT id FROM guardians WHERE lower(email) = lower($1) LIMIT 1', [email]);

  if (existing.rows.length > 0) {
    const updated = await pool.query(
      `UPDATE guardians
       SET name = $1,
           phone = $2,
           relationship = $3,
           is_active = true,
           is_password_set = true,
           must_change_password = false,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id`,
      [name, phone, relationship, existing.rows[0].id],
    );
    return updated.rows[0].id;
  }

  const inserted = await pool.query(
    `INSERT INTO guardians (
      name,
      phone,
      email,
      relationship,
      address,
      is_active,
      is_password_set,
      must_change_password
    ) VALUES ($1, $2, $3, $4, $5, true, true, false)
    RETURNING id`,
    [name, phone, email, relationship, 'QA Test Address'],
  );

  return inserted.rows[0].id;
};

const seedTestAccounts = async () => {
  const clinicId = await ensureClinic();

  const systemAdminRoleId = await ensureRole('super_admin', 'System Administrator', 100, {
    system: { all: true },
  });
  const guardianRoleId = await ensureRole('guardian', 'Guardian', 20, {
    guardian: { own_children: true },
  });

  const guardianId = await ensureGuardianRecord({
    name: TEST_GUARDIAN.name,
    email: TEST_GUARDIAN.email,
    phone: TEST_GUARDIAN.phone,
    relationship: TEST_GUARDIAN.relationship,
  });

  const adminUserId = await ensureUser({
    username: TEST_ADMIN.username,
    email: TEST_ADMIN.email,
    password: TEST_ADMIN.password,
    roleId: systemAdminRoleId,
    clinicId,
  });

  const guardianUserId = await ensureUser({
    username: TEST_GUARDIAN.username,
    email: TEST_GUARDIAN.email,
    password: TEST_GUARDIAN.password,
    roleId: guardianRoleId,
    clinicId,
    guardianId,
  });

  await pool.query(
    `UPDATE guardians
     SET is_password_set = true,
         must_change_password = false,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [guardianId],
  );

  return {
    adminUserId,
    guardianUserId,
    guardianId,
    clinicId,
  };
};

const cleanupTestAccounts = async () => {
  await pool.query('DELETE FROM users WHERE lower(email) IN (lower($1), lower($2))', [
    TEST_ADMIN.email,
    TEST_GUARDIAN.email,
  ]);

  await pool.query('DELETE FROM guardians WHERE lower(email) = lower($1)', [TEST_GUARDIAN.email]);
};

module.exports = {
  TEST_ADMIN,
  TEST_GUARDIAN,
  seedTestAccounts,
  cleanupTestAccounts,
};
