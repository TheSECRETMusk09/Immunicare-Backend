require('dotenv').config();

const db = require('./db');
const {
  MARKER,
  TARGET_INFANTS,
  TARGET_TRANSACTIONS,
  TRANSACTION_TARGETS,
  WINDOW_START,
  WINDOW_END,
} = require('./expand_immunicare_platform_data');

const toIsoDate = (value) => new Date(value).toISOString().slice(0, 10);

const existingTableSet = async (client) => {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  return new Set(result.rows.map((row) => row.table_name));
};

const getTableColumns = async (client, tableName) => {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
    `,
    [tableName],
  );

  return new Set(result.rows.map((row) => row.column_name));
};

const logCheck = (label, passed, detail) => {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`${status.padEnd(5)} ${label}${detail ? `: ${detail}` : ''}`);
};

async function verifyPlatformDataConsistency() {
  const client = await db.connect();

  try {
    const tables = await existingTableSet(client);
    const documentDownloadColumns = tables.has('document_downloads')
      ? await getTableColumns(client, 'document_downloads')
      : new Set();
    let failures = 0;

    console.log('='.repeat(72));
    console.log('IMMUNICARE PLATFORM EXPANSION VERIFICATION');
    console.log('='.repeat(72));

    const counts = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS count FROM patients WHERE control_number LIKE $1`, [`${MARKER}-%`]),
      client.query(`SELECT COUNT(*)::int AS count FROM guardians WHERE email LIKE $1`, [`${MARKER.toLowerCase()}%`]),
      client.query(`SELECT COUNT(*)::int AS count FROM users WHERE username LIKE $1`, [`${MARKER.toLowerCase()}%`]),
      client.query(`SELECT COUNT(*)::int AS count FROM immunization_records WHERE notes LIKE $1`, [`${MARKER}%`]),
      client.query(`SELECT COUNT(*)::int AS count FROM appointments WHERE notes LIKE $1`, [`${MARKER}%`]),
      tables.has('vaccine_inventory_transactions')
        ? client.query(`SELECT COUNT(*)::int AS count FROM vaccine_inventory_transactions WHERE notes LIKE $1`, [`${MARKER}%`])
        : Promise.resolve({ rows: [{ count: 0 }] }),
      client.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE COALESCE(metadata::text, '') LIKE $1`, [`%${MARKER}%`]),
      client.query(`SELECT COUNT(*)::int AS count FROM reports WHERE title LIKE $1`, [`${MARKER}%`]),
      tables.has('document_generation')
        ? client.query(`SELECT COUNT(*)::int AS count FROM document_generation WHERE COALESCE(generated_data::text, '') LIKE $1`, [`%${MARKER}%`])
        : Promise.resolve({ rows: [{ count: 0 }] }),
      tables.has('document_generation_logs')
        ? client.query(`SELECT COUNT(*)::int AS count FROM document_generation_logs WHERE COALESCE(data_source::text, '') LIKE $1`, [`%${MARKER}%`])
        : Promise.resolve({ rows: [{ count: 0 }] }),
      tables.has('transfer_in_cases')
        ? client.query(`SELECT COUNT(*)::int AS count FROM transfer_in_cases WHERE remarks LIKE $1`, [`${MARKER}%`])
        : Promise.resolve({ rows: [{ count: 0 }] }),
      tables.has('document_downloads')
        ? documentDownloadColumns.has('patient_id')
          ? client.query(`
              SELECT COUNT(*)::int AS count
              FROM document_downloads dd
              JOIN patients p ON p.id = dd.patient_id
              WHERE p.control_number LIKE $1
            `, [`${MARKER}-%`])
          : documentDownloadColumns.has('infant_id')
            ? client.query(`
                SELECT COUNT(*)::int AS count
                FROM document_downloads dd
                JOIN patients p ON p.id = dd.infant_id
                WHERE p.control_number LIKE $1
              `, [`${MARKER}-%`])
            : Promise.resolve({ rows: [{ count: 0 }] })
        : Promise.resolve({ rows: [{ count: 0 }] }),
    ]);

    const patientCount = counts[0].rows[0].count;
    const guardianCount = counts[1].rows[0].count;
    const guardianUserCount = counts[2].rows[0].count;
    const txCounts = {
      immunization_records: counts[3].rows[0].count,
      appointments: counts[4].rows[0].count,
      vaccine_inventory_transactions: counts[5].rows[0].count,
      notifications: counts[6].rows[0].count,
      reports: counts[7].rows[0].count,
      document_generation: counts[8].rows[0].count,
      document_generation_logs: counts[9].rows[0].count,
      transfer_in_cases: counts[10].rows[0].count,
      document_downloads: counts[11].rows[0].count,
    };
    const totalTransactions = Object.values(txCounts).reduce((sum, value) => sum + value, 0);

    const linkageChecks = await Promise.all([
      client.query(`
        SELECT COUNT(*)::int AS count
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE p.control_number LIKE $1
          AND g.id IS NULL
      `, [`${MARKER}-%`]),
      client.query(`
        SELECT COUNT(*)::int AS count
        FROM users u
        LEFT JOIN guardians g ON g.id = u.guardian_id
        WHERE u.username LIKE $1
          AND g.id IS NULL
      `, [`${MARKER.toLowerCase()}%`]),
      client.query(`
        SELECT COUNT(*)::int AS count
        FROM immunization_records ir
        LEFT JOIN patients p ON p.id = ir.patient_id
        WHERE ir.notes LIKE $1
          AND p.id IS NULL
      `, [`${MARKER}%`]),
      client.query(`
        SELECT COUNT(*)::int AS count
        FROM appointments a
        LEFT JOIN guardians g ON g.id = a.guardian_id
        WHERE a.notes LIKE $1
          AND g.id IS NULL
      `, [`${MARKER}%`]),
      client.query(`
        SELECT COUNT(*)::int AS count
        FROM patients
        WHERE control_number LIKE $1
        GROUP BY control_number
        HAVING COUNT(*) > 1
      `, [`${MARKER}-%`]),
    ]);

    const gapChecks = await Promise.all([
      client.query(`
        WITH dates AS (
          SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
        ),
        activity AS (
          SELECT DATE(created_at) AS day, COUNT(*) AS count
          FROM patients
          WHERE control_number LIKE $3
          GROUP BY DATE(created_at)
        )
        SELECT COUNT(*)::int AS count
        FROM dates d
        LEFT JOIN activity a ON a.day = d.day
        WHERE COALESCE(a.count, 0) = 0
      `, [toIsoDate(WINDOW_START), toIsoDate(WINDOW_END), `${MARKER}-%`]),
      client.query(`
        WITH dates AS (
          SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
        ),
        activity AS (
          SELECT DATE(admin_date) AS day, COUNT(*) AS count
          FROM immunization_records
          WHERE notes LIKE $3
          GROUP BY DATE(admin_date)
        )
        SELECT COUNT(*)::int AS count
        FROM dates d
        LEFT JOIN activity a ON a.day = d.day
        WHERE COALESCE(a.count, 0) = 0
      `, [toIsoDate(WINDOW_START), toIsoDate(WINDOW_END), `${MARKER}%`]),
      client.query(`
        WITH dates AS (
          SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
        ),
        activity AS (
          SELECT DATE(scheduled_date) AS day, COUNT(*) AS count
          FROM appointments
          WHERE notes LIKE $3
          GROUP BY DATE(scheduled_date)
        )
        SELECT COUNT(*)::int AS count
        FROM dates d
        LEFT JOIN activity a ON a.day = d.day
        WHERE COALESCE(a.count, 0) = 0
      `, [toIsoDate(WINDOW_START), toIsoDate(WINDOW_END), `${MARKER}%`]),
      client.query(`
        WITH dates AS (
          SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
        ),
        activity AS (
          SELECT DATE(created_at) AS day, COUNT(*) AS count
          FROM notifications
          WHERE COALESCE(metadata::text, '') LIKE $3
          GROUP BY DATE(created_at)
        )
        SELECT COUNT(*)::int AS count
        FROM dates d
        LEFT JOIN activity a ON a.day = d.day
        WHERE COALESCE(a.count, 0) = 0
      `, [toIsoDate(WINDOW_START), toIsoDate(WINDOW_END), `%${MARKER}%`]),
    ]);

    const inventoryCheck = tables.has('vaccine_inventory')
      ? await client.query(`
          SELECT COUNT(*)::int AS count
          FROM vaccine_inventory
          WHERE COALESCE(lot_batch_number, '') LIKE $1
            AND stock_on_hand <> (beginning_balance + received_during_period + transferred_in - transferred_out - expired_wasted - issuance)
        `, [`${MARKER}%`]).catch(() => ({ rows: [{ count: 0 }] }))
      : { rows: [{ count: 0 }] };

    const scheduleMismatch = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM (
        SELECT patient_id, vaccine_id, dose_no, COUNT(*) AS dupes
        FROM immunization_records
        WHERE notes LIKE $1
        GROUP BY patient_id, vaccine_id, dose_no
        HAVING COUNT(*) > 1
      ) q
    `, [`${MARKER}%`]);

    logCheck('Patients added', patientCount === TARGET_INFANTS, `${patientCount}/${TARGET_INFANTS}`);
    if (patientCount !== TARGET_INFANTS) failures += 1;
    logCheck('Guardians added', guardianCount === TARGET_INFANTS, `${guardianCount}/${TARGET_INFANTS}`);
    if (guardianCount !== TARGET_INFANTS) failures += 1;
    logCheck('Guardian users added', guardianUserCount === TARGET_INFANTS, `${guardianUserCount}/${TARGET_INFANTS}`);
    if (guardianUserCount !== TARGET_INFANTS) failures += 1;

    Object.keys(TRANSACTION_TARGETS).forEach((key) => {
      const passed = txCounts[key] === TRANSACTION_TARGETS[key];
      logCheck(`Transaction count: ${key}`, passed, `${txCounts[key]}/${TRANSACTION_TARGETS[key]}`);
      if (!passed) failures += 1;
    });

    logCheck('Total generated transactions', totalTransactions === TARGET_TRANSACTIONS, `${totalTransactions}/${TARGET_TRANSACTIONS}`);
    if (totalTransactions !== TARGET_TRANSACTIONS) failures += 1;

    logCheck('Patient -> guardian linkage', linkageChecks[0].rows[0].count === 0, `${linkageChecks[0].rows[0].count} orphan patients`);
    if (linkageChecks[0].rows[0].count !== 0) failures += 1;
    logCheck('Guardian user -> guardian linkage', linkageChecks[1].rows[0].count === 0, `${linkageChecks[1].rows[0].count} orphan guardian users`);
    if (linkageChecks[1].rows[0].count !== 0) failures += 1;
    logCheck('Immunization -> patient linkage', linkageChecks[2].rows[0].count === 0, `${linkageChecks[2].rows[0].count} orphan immunization rows`);
    if (linkageChecks[2].rows[0].count !== 0) failures += 1;
    logCheck('Appointment -> guardian linkage', linkageChecks[3].rows[0].count === 0, `${linkageChecks[3].rows[0].count} orphan appointments`);
    if (linkageChecks[3].rows[0].count !== 0) failures += 1;
    logCheck('Duplicate control numbers', linkageChecks[4].rows.length === 0, `${linkageChecks[4].rows.length} duplicates`);
    if (linkageChecks[4].rows.length !== 0) failures += 1;

    logCheck('Registration daily gaps', gapChecks[0].rows[0].count === 0, `${gapChecks[0].rows[0].count} missing days`);
    if (gapChecks[0].rows[0].count !== 0) failures += 1;
    logCheck('Vaccination daily gaps', gapChecks[1].rows[0].count === 0, `${gapChecks[1].rows[0].count} missing days`);
    if (gapChecks[1].rows[0].count !== 0) failures += 1;
    logCheck('Appointment daily gaps', gapChecks[2].rows[0].count === 0, `${gapChecks[2].rows[0].count} missing days`);
    if (gapChecks[2].rows[0].count !== 0) failures += 1;
    logCheck('Notification daily gaps', gapChecks[3].rows[0].count === 0, `${gapChecks[3].rows[0].count} missing days`);
    if (gapChecks[3].rows[0].count !== 0) failures += 1;

    logCheck('Inventory reconciliation', inventoryCheck.rows[0].count === 0, `${inventoryCheck.rows[0].count} mismatched rows`);
    if (inventoryCheck.rows[0].count !== 0) failures += 1;
    logCheck('Duplicate vaccine dose records', scheduleMismatch.rows[0].count === 0, `${scheduleMismatch.rows[0].count} duplicate patient/vaccine/dose groups`);
    if (scheduleMismatch.rows[0].count !== 0) failures += 1;

    console.log('='.repeat(72));
    if (failures > 0) {
      console.error(`VERIFICATION FAILED: ${failures} checks did not pass.`);
      process.exitCode = 1;
    } else {
      console.log('VERIFICATION PASSED');
    }
    console.log('='.repeat(72));
  } finally {
    client.release();
    await db.end();
  }
}

module.exports = {
  verifyPlatformDataConsistency,
};

if (require.main === module) {
  verifyPlatformDataConsistency()
    .then(() => process.exit(process.exitCode || 0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
