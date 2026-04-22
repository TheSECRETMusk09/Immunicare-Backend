
const pool = require('./db');
async function run() {
  try {
    const listQuery = 'SELECT a.id, p.first_name || '' '' || p.last_name as patient_name, a.status::text, a.is_active, p.is_active as patient_is_active, a.scheduled_date, (a.scheduled_date AT TIME ZONE ''Asia/Manila'')::date as manila_date, a.facility_id, a.clinic_id FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id OR p.id = a.infant_id LEFT JOIN guardians g ON g.id = p.guardian_id WHERE (p.first_name ILIKE ''%christian%'' OR p.last_name ILIKE ''%christian%'' OR g.name ILIKE ''%christian%'') LIMIT 20';
    const countQuery = 'SELECT (scheduled_date AT TIME ZONE ''Asia/Manila'')::date as manila_date, count(*) as cancelled_count FROM appointments WHERE status = ''cancelled'' AND scheduled_date >= date_trunc(''month'', now() AT TIME ZONE ''Asia/Manila'') GROUP BY 1 ORDER BY 1';
    
    const listRes = await pool.query(listQuery);
    const countRes = await pool.query(countQuery);
    
    console.log('--- Christian Appointments ---');
    console.table(listRes.rows);
    console.log('\n--- Cancelled Counts ---');
    console.table(countRes.rows);
  } catch (err) {
    console.error(err);
  } finally {
    if (pool.close) await pool.close();
    else if (pool.end) await pool.end();
    process.exit();
  }
}
run();

