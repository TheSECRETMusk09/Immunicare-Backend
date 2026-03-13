const pool = require('./db');
const { getAdminInfantVaccinationMonitoring } = require('./services/adminVaccinationMonitoringService');

const analyzeQuery = async () => {
  try {
    const result = await pool.query(`
      EXPLAIN ANALYZE
      WITH infant_base AS (
        SELECT
          p.id AS infant_id,
          p.first_name,
          p.last_name,
          p.control_number,
          p.dob,
          p.guardian_id,
          p.health_center_id AS clinic_id
        FROM patients p
        WHERE p.is_active = true
      ),
      record_rollup AS (
        SELECT
          ir.patient_id AS infant_id,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', ir.id,
              'vaccineId', ir.vaccine_id,
              'vaccineName', v.name,
              'doseNo', ir.dose_no,
              'adminDate', ir.admin_date,
              'nextDueDate', ir.next_due_date,
              'status', ir.status,
              'notes', ir.notes
            ) ORDER BY ir.admin_date DESC NULLS LAST, ir.created_at DESC
          ) AS history,
          MAX(ir.admin_date) AS last_admin_date,
          MIN(ir.next_due_date) FILTER (
            WHERE ir.next_due_date IS NOT NULL
              AND (ir.status IS NULL OR ir.status IN ('pending', 'scheduled'))
          ) AS next_due_date,
          COUNT(*) FILTER (WHERE ir.status = 'completed') AS completed_count,
          COUNT(*) FILTER (
            WHERE ir.status IS NULL OR ir.status IN ('pending', 'scheduled')
          ) AS pending_count
        FROM immunization_records ir
        JOIN vaccines v ON v.id = ir.vaccine_id
        WHERE ir.is_active = true
        GROUP BY ir.patient_id
      ),
      appointment_rollup AS (
        SELECT
          a.infant_id,
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', a.id,
              'scheduledDate', a.scheduled_date,
              'status', a.status,
              'type', a.type,
              'location', a.location
            ) ORDER BY a.scheduled_date ASC
          ) FILTER (
            WHERE a.scheduled_date >= CURRENT_DATE
              AND LOWER(a.status::text) IN ('scheduled', 'confirmed', 'rescheduled')
          ) AS upcoming_appointments,
          MIN(a.scheduled_date) FILTER (
            WHERE a.scheduled_date >= CURRENT_DATE
              AND LOWER(a.status::text) IN ('scheduled', 'confirmed', 'rescheduled')
          ) AS next_appointment_date,
          COUNT(*) FILTER (
            WHERE a.scheduled_date >= CURRENT_DATE
              AND LOWER(a.status::text) IN ('scheduled', 'confirmed', 'rescheduled')
          ) AS upcoming_appointments_count
        FROM appointments a
        WHERE a.is_active = true
        GROUP BY a.infant_id
      ),
      base AS (
        SELECT
          ib.infant_id,
          ib.first_name,
          ib.last_name,
          ib.control_number,
          ib.dob,
          ib.guardian_id,
          ib.clinic_id,
          g.name AS guardian_name,
          g.phone AS guardian_phone,
          rr.history,
          rr.last_admin_date,
          rr.next_due_date,
          rr.completed_count,
          rr.pending_count,
          ar.upcoming_appointments,
          ar.next_appointment_date,
          ar.upcoming_appointments_count,
          CASE
            WHEN rr.next_due_date IS NULL THEN 'no_pending_dose'
            WHEN rr.next_due_date < CURRENT_DATE THEN 'overdue'
            WHEN rr.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'due_soon'
            ELSE 'upcoming'
          END AS next_status
        FROM infant_base ib
        LEFT JOIN guardians g ON g.id = ib.guardian_id
        LEFT JOIN record_rollup rr ON rr.infant_id = ib.infant_id
        LEFT JOIN appointment_rollup ar ON ar.infant_id = ib.infant_id
      )
      SELECT
        base.*,
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, base.dob))::int AS age_years,
        EXTRACT(MONTH FROM AGE(CURRENT_DATE, base.dob))::int AS age_months
      FROM base
      WHERE 1=1
      ORDER BY
        CASE base.next_status
          WHEN 'overdue' THEN 1
          WHEN 'due_soon' THEN 2
          WHEN 'upcoming' THEN 3
          ELSE 4
        END,
        base.next_due_date ASC NULLS LAST,
        base.last_name ASC,
        base.first_name ASC
      LIMIT 100
    `);
    console.log(result.rows.map(row => row['QUERY PLAN']).join(`
`));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
};

analyzeQuery();
