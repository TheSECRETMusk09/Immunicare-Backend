const pool = require('../db');

const getAdminInfantVaccinationMonitoring = async ({
  infantId = null,
  clinicId = null,
  guardianId = null,
  status = null,
  dateFrom = null,
  dateTo = null,
  limit = 100,
  offset = 0,
}) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const params = [];
  const whereParts = ['ib.is_active = true'];

  if (infantId) {
    params.push(infantId);
    whereParts.push(`ib.infant_id = $${params.length}`);
  }

  if (guardianId) {
    params.push(guardianId);
    whereParts.push(`ib.guardian_id = $${params.length}`);
  }

  if (clinicId) {
    params.push(clinicId);
    whereParts.push(`ib.clinic_id = $${params.length}`);
  }

  if (dateFrom) {
    params.push(dateFrom);
    whereParts.push(`ir_agg.next_due_date >= $${params.length}::date`);
  }

  if (dateTo) {
    params.push(dateTo);
    whereParts.push(`ir_agg.next_due_date <= $${params.length}::date`);
  }

  if (status) {
    const normalizedStatus = String(status).trim().toLowerCase();
    if (['overdue', 'due_soon', 'upcoming', 'no_pending_dose'].includes(normalizedStatus)) {
      params.push(normalizedStatus);
      whereParts.push(`
        (
          CASE
            WHEN ir_agg.next_due_date IS NULL THEN 'no_pending_dose'
            WHEN ir_agg.next_due_date < CURRENT_DATE THEN 'overdue'
            WHEN ir_agg.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'due_soon'
            ELSE 'upcoming'
          END
        ) = $${params.length}
      `);
    }
  }

  params.push(safeLimit);
  const limitParam = `$${params.length}`;
  params.push(safeOffset);
  const offsetParam = `$${params.length}`;

  const result = await pool.query(
    `
      WITH infant_base AS (
        SELECT
          p.id AS infant_id,
          p.first_name,
          p.last_name,
          p.control_number,
          p.dob,
          p.guardian_id,
          p.clinic_id,
          p.is_active,
          g.name AS guardian_name,
          g.phone AS guardian_phone
        FROM patients p
        LEFT JOIN guardians g ON g.id = p.guardian_id
        WHERE p.is_active = true
      ),
      immunization_agg AS (
        SELECT
          ir.patient_id,
          MAX(ir.admin_date) AS last_vaccination_date,
          MIN(
            CASE
              WHEN ir.next_due_date IS NOT NULL
                AND (ir.status IS NULL OR ir.status IN ('pending', 'scheduled'))
              THEN ir.next_due_date
              ELSE NULL
            END
          ) AS next_due_date,
          COUNT(*) FILTER (WHERE ir.status = 'completed')::int AS completed_count,
          COUNT(*) FILTER (
            WHERE (ir.status IS NULL OR ir.status IN ('pending', 'scheduled'))
          )::int AS pending_count
        FROM immunization_records ir
        WHERE ir.is_active = true
        GROUP BY ir.patient_id
      ),
      appointment_agg AS (
        SELECT
          a.infant_id,
          COUNT(*) FILTER (
            WHERE a.is_active = true
              AND a.scheduled_date >= CURRENT_DATE
              AND LOWER(a.status::text) IN ('scheduled', 'confirmed', 'rescheduled')
          )::int AS upcoming_appointments_count
        FROM appointments a
        GROUP BY a.infant_id
      )
      SELECT
        ib.infant_id,
        ib.first_name,
        ib.last_name,
        ib.control_number,
        ib.dob,
        ib.guardian_id,
        ib.guardian_name,
        ib.guardian_phone,
        EXTRACT(YEAR FROM AGE(CURRENT_DATE, ib.dob))::int AS age_years,
        EXTRACT(MONTH FROM AGE(CURRENT_DATE, ib.dob))::int AS age_months,
        ir_agg.last_vaccination_date,
        ir_agg.next_due_date,
        COALESCE(ir_agg.completed_count, 0)::int AS completed_count,
        COALESCE(ir_agg.pending_count, 0)::int AS pending_count,
        COALESCE(appt_agg.upcoming_appointments_count, 0)::int AS upcoming_appointments_count,
        CASE
          WHEN ir_agg.next_due_date IS NULL THEN 'no_pending_dose'
          WHEN ir_agg.next_due_date < CURRENT_DATE THEN 'overdue'
          WHEN ir_agg.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'due_soon'
          ELSE 'upcoming'
        END AS next_status
      FROM infant_base ib
      LEFT JOIN immunization_agg ir_agg ON ir_agg.patient_id = ib.infant_id
      LEFT JOIN appointment_agg appt_agg ON appt_agg.infant_id = ib.infant_id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY
        CASE
          WHEN ir_agg.next_due_date IS NULL THEN 4
          WHEN ir_agg.next_due_date < CURRENT_DATE THEN 1
          WHEN ir_agg.next_due_date <= CURRENT_DATE + INTERVAL '7 days' THEN 2
          ELSE 3
        END,
        ir_agg.next_due_date ASC NULLS LAST,
        ib.last_name ASC,
        ib.first_name ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    params,
  );

  return result.rows;
};

module.exports = {
  getAdminInfantVaccinationMonitoring,
};
