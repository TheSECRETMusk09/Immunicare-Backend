require('dotenv').config();

const db = require('../db');
const {
  CLINIC_TIMEZONE,
  MAX_VACCINATION_APPOINTMENTS_PER_DAY,
  rollForwardWeekendDateKey,
} = require('../utils/clinicCalendar');

const DEFAULT_MARKER = 'EXP95000';
const DEFAULT_MODE = 'audit';
const BATCH_SIZE = 500;

const APPOINTMENT_LOCAL_DATE_SQL = `(a.scheduled_date AT TIME ZONE '${CLINIC_TIMEZONE}')::date`;
const APPOINTMENT_VACCINATION_PREDICATE_SQL = `
  (
    LOWER(COALESCE(a.type::text, '')) LIKE '%vacc%'
    OR LOWER(COALESCE(a.type::text, '')) LIKE '%immun%'
    OR LOWER(COALESCE(a.type::text, '')) LIKE '%follow%'
  )
`;
const IMMUNIZATION_LOCAL_DATE_SQL = `ir.admin_date::date`;
const WEEKEND_PREDICATE_SQL = (dateExpression) => `EXTRACT(DOW FROM ${dateExpression}) IN (0, 6)`;

const parseArgs = (argv) => {
  const options = {
    marker: DEFAULT_MARKER,
    mode: DEFAULT_MODE,
    apply: false,
  };

  argv.forEach((arg) => {
    if (arg === '--apply') {
      options.apply = true;
      options.mode = 'repair';
      return;
    }

    const [key, rawValue] = arg.split('=');
    const value = String(rawValue || '').trim();

    if (key === '--marker' && value) {
      options.marker = value;
    }

    if (key === '--mode' && value) {
      options.mode = value;
    }
  });

  options.mode = ['audit', 'repair'].includes(String(options.mode).toLowerCase())
    ? String(options.mode).toLowerCase()
    : DEFAULT_MODE;

  return options;
};

const toDateKey = (value) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

const parseDateKey = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const enumerateWeekdays = (startDateKey, endDateKey) => {
  const start = parseDateKey(startDateKey);
  const end = parseDateKey(endDateKey);
  if (!start || !end || start > end) {
    return [];
  }

  const values = [];
  const cursor = new Date(start.getTime());
  while (cursor <= end) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      values.push(toDateKey(cursor));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return values;
};

const markerMatchSql = (patientAlias, rowAlias) => `
  (
    COALESCE(${patientAlias}.control_number, '') LIKE $1
    OR COALESCE(${rowAlias}.control_number, '') LIKE $2
    OR COALESCE(${rowAlias}.notes, '') ILIKE $3
  )
`;

const chunkArray = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const printSection = (title, rows) => {
  console.log(`\n${title}`);
  rows.forEach((row) => console.log(`  ${row}`));
};

const getSyntheticAppointmentScope = async (client, markerParams) => {
  const result = await client.query(
    `
      SELECT
        MIN(${APPOINTMENT_LOCAL_DATE_SQL}) AS min_date,
        MAX(${APPOINTMENT_LOCAL_DATE_SQL}) AS max_date,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT a.clinic_id), NULL) AS clinic_ids,
        COUNT(*)::int AS total_records,
        COUNT(*) FILTER (
          WHERE ${WEEKEND_PREDICATE_SQL(APPOINTMENT_LOCAL_DATE_SQL)}
        )::int AS weekend_records
      FROM appointments a
      JOIN patients p ON p.id = a.infant_id
      WHERE COALESCE(a.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND ${APPOINTMENT_VACCINATION_PREDICATE_SQL}
        AND ${markerMatchSql('p', 'a')}
    `,
    markerParams,
  );

  return result.rows[0] || null;
};

const getWeekendAppointmentRows = async (client, markerParams) => {
  const result = await client.query(
    `
      SELECT
        a.id,
        a.infant_id AS patient_id,
        p.control_number,
        ${APPOINTMENT_LOCAL_DATE_SQL} AS local_date
      FROM appointments a
      JOIN patients p ON p.id = a.infant_id
      WHERE COALESCE(a.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND ${APPOINTMENT_VACCINATION_PREDICATE_SQL}
        AND ${markerMatchSql('p', 'a')}
        AND ${WEEKEND_PREDICATE_SQL(APPOINTMENT_LOCAL_DATE_SQL)}
      ORDER BY ${APPOINTMENT_LOCAL_DATE_SQL} ASC, a.id ASC
    `,
    markerParams,
  );

  return result.rows || [];
};

const getClinicWeekdayCounts = async (client, clinicIds, startDate, endDate) => {
  const result = await client.query(
    `
      SELECT
        ${APPOINTMENT_LOCAL_DATE_SQL} AS local_date,
        COUNT(*)::int AS count
      FROM appointments a
      WHERE COALESCE(a.is_active, true) = true
        AND ${APPOINTMENT_VACCINATION_PREDICATE_SQL}
        AND a.clinic_id = ANY($1::int[])
        AND ${APPOINTMENT_LOCAL_DATE_SQL} BETWEEN $2::date AND $3::date
        AND NOT ${WEEKEND_PREDICATE_SQL(APPOINTMENT_LOCAL_DATE_SQL)}
      GROUP BY ${APPOINTMENT_LOCAL_DATE_SQL}
    `,
    [clinicIds, startDate, endDate],
  );

  return result.rows || [];
};

const getMarkerAppointmentCapacityStats = async (client, markerParams) => {
  const result = await client.query(
    `
      SELECT
        ${APPOINTMENT_LOCAL_DATE_SQL} AS local_date,
        COUNT(*)::int AS count
      FROM appointments a
      JOIN patients p ON p.id = a.infant_id
      WHERE COALESCE(a.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND ${APPOINTMENT_VACCINATION_PREDICATE_SQL}
        AND ${markerMatchSql('p', 'a')}
        AND NOT ${WEEKEND_PREDICATE_SQL(APPOINTMENT_LOCAL_DATE_SQL)}
      GROUP BY ${APPOINTMENT_LOCAL_DATE_SQL}
      ORDER BY count DESC, ${APPOINTMENT_LOCAL_DATE_SQL} ASC
    `,
    markerParams,
  );

  return result.rows || [];
};

const getWeekendImmunizationRows = async (client, markerParams) => {
  const result = await client.query(
    `
      SELECT
        ir.id,
        ir.patient_id,
        p.control_number,
        ${IMMUNIZATION_LOCAL_DATE_SQL} AS local_date
      FROM immunization_records ir
      JOIN patients p ON p.id = ir.patient_id
      WHERE COALESCE(ir.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND COALESCE(LOWER(ir.status), 'completed') IN ('completed', 'attended')
        AND ${IMMUNIZATION_LOCAL_DATE_SQL} IS NOT NULL
        AND (
          COALESCE(p.control_number, '') LIKE $1
          OR COALESCE(ir.notes, '') ILIKE $2
        )
        AND ${WEEKEND_PREDICATE_SQL(IMMUNIZATION_LOCAL_DATE_SQL)}
      ORDER BY ${IMMUNIZATION_LOCAL_DATE_SQL} ASC, ir.id ASC
    `,
    [markerParams[0], markerParams[2]],
  );

  return result.rows || [];
};

const getWeekendLegacyVaccinationRows = async (client, markerPrefix, markerSearch) => {
  const result = await client.query(
    `
      SELECT
        vr.id,
        p.id AS patient_id,
        p.control_number,
        vr.admin_date::date AS local_date
      FROM vaccination_records vr
      JOIN infants i ON i.id = vr.infant_id
      JOIN patients p ON p.control_number = i.patient_control_number
      WHERE COALESCE(vr.is_active, true) = true
        AND COALESCE(p.is_active, true) = true
        AND vr.admin_date IS NOT NULL
        AND (
          COALESCE(p.control_number, '') LIKE $1
          OR COALESCE(vr.notes, '') ILIKE $2
        )
        AND ${WEEKEND_PREDICATE_SQL('vr.admin_date::date')}
      ORDER BY vr.admin_date ASC, vr.id ASC
    `,
    [markerPrefix, markerSearch],
  );

  return result.rows || [];
};

const buildBucketMap = (weekdayKeys, countRows) => {
  const bucketMap = new Map(weekdayKeys.map((dateKey) => [dateKey, 0]));

  countRows.forEach((row) => {
    const dateKey = toDateKey(row.local_date);
    if (!dateKey || !bucketMap.has(dateKey)) {
      return;
    }

    bucketMap.set(dateKey, Number.parseInt(row.count, 10) || 0);
  });

  return bucketMap;
};

const assignBalancedWeekdays = (rows, bucketMap) => {
  const assignments = [];
  const buckets = [...bucketMap.keys()].map((dateKey) => ({
    dateKey,
    count: bucketMap.get(dateKey) || 0,
  }));

  rows.forEach((row) => {
    const originalDate = toDateKey(row.local_date);
    let bestBucket = null;

    for (const bucket of buckets) {
      if (bucket.count >= MAX_VACCINATION_APPOINTMENTS_PER_DAY) {
        continue;
      }

      const distance = Math.abs(
        parseDateKey(bucket.dateKey).getTime() - parseDateKey(originalDate).getTime(),
      );
      const score = (bucket.count * 10_000_000_000) + distance;

      if (!bestBucket || score < bestBucket.score) {
        bestBucket = {
          bucket,
          score,
        };
      }
    }

    if (!bestBucket) {
      throw new Error('Unable to find a weekday bucket with remaining capacity.');
    }

    bestBucket.bucket.count += 1;
    assignments.push({
      id: row.id,
      patient_id: row.patient_id,
      old_date: originalDate,
      new_date: bestBucket.bucket.dateKey,
    });
  });

  return assignments;
};

const updateDateAssignments = async (client, tableName, rows, {
  idColumn = 'id',
  dateColumn = 'scheduled_date',
} = {}) => {
  for (const chunk of chunkArray(rows, BATCH_SIZE)) {
    const values = [];
    const placeholders = chunk.map((row, index) => {
      const offset = index * 2;
      values.push(row.id, row.new_date);
      return `($${offset + 1}::int, $${offset + 2}::date)`;
    });

    await client.query(
      `
        UPDATE ${tableName} AS target
        SET ${dateColumn} = updates.new_date,
            updated_at = CURRENT_TIMESTAMP
        FROM (
          VALUES ${placeholders.join(', ')}
        ) AS updates(id, new_date)
        WHERE target.${idColumn} = updates.id
      `,
      values,
    );
  }
};

const buildAppointmentDateLookup = (rows) => {
  const lookup = new Map();
  rows.forEach((row) => {
    lookup.set(`${row.patient_id}|${row.old_date}`, row.new_date);
  });
  return lookup;
};

const mapRecordDates = (rows, lookup) => rows.map((row) => ({
  id: row.id,
  new_date:
    lookup.get(`${row.patient_id}|${toDateKey(row.local_date)}`) ||
    rollForwardWeekendDateKey(toDateKey(row.local_date)),
}));

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const markerPrefix = `${options.marker}-%`;
  const markerSearch = `%${options.marker}%`;
  const markerParams = [markerPrefix, markerPrefix, markerSearch];

  const client = await db.connect();

  try {
    const scope = await getSyntheticAppointmentScope(client, markerParams);
    if (!scope || Number.parseInt(scope.total_records, 10) === 0) {
      throw new Error(`No synthetic vaccination appointments found for marker ${options.marker}.`);
    }

    const startDate = toDateKey(scope.min_date);
    const endDate = toDateKey(scope.max_date);
    const clinicIds = Array.isArray(scope.clinic_ids)
      ? scope.clinic_ids.map((value) => Number.parseInt(value, 10)).filter(Number.isInteger)
      : [];

    if (!startDate || !endDate || clinicIds.length === 0) {
      throw new Error('Unable to resolve clinic scope or date range for the repair set.');
    }

    const [
      weekendAppointments,
      weekdayCountRows,
      markerWeekdayCountRows,
      weekendImmunizations,
      weekendLegacyVaccinations,
    ] = await Promise.all([
      getWeekendAppointmentRows(client, markerParams),
      getClinicWeekdayCounts(client, clinicIds, startDate, endDate),
      getMarkerAppointmentCapacityStats(client, markerParams),
      getWeekendImmunizationRows(client, markerParams),
      getWeekendLegacyVaccinationRows(client, markerPrefix, markerSearch),
    ]);

    const weekdayKeys = enumerateWeekdays(startDate, endDate);
    const maxWindowCapacity = weekdayKeys.length * MAX_VACCINATION_APPOINTMENTS_PER_DAY;
    const currentClinicWeekdayLoad = weekdayCountRows.reduce(
      (sum, row) => sum + (Number.parseInt(row.count, 10) || 0),
      0,
    );
    const maxObservedClinicWeekdayLoad = weekdayCountRows.reduce(
      (maxValue, row) => Math.max(maxValue, Number.parseInt(row.count, 10) || 0),
      0,
    );
    const clinicOverflowDays = weekdayCountRows.filter(
      (row) => (Number.parseInt(row.count, 10) || 0) > MAX_VACCINATION_APPOINTMENTS_PER_DAY,
    ).length;
    const currentMarkerWeekdayLoad = markerWeekdayCountRows.reduce(
      (sum, row) => sum + (Number.parseInt(row.count, 10) || 0),
      0,
    );
    const markerWeekendLoad = weekendAppointments.length;
    const totalMarkerVaccinationAppointments = currentMarkerWeekdayLoad + markerWeekendLoad;
    const maxObservedMarkerWeekdayLoad = markerWeekdayCountRows.reduce(
      (maxValue, row) => Math.max(maxValue, Number.parseInt(row.count, 10) || 0),
      0,
    );
    const markerOverflowDays = markerWeekdayCountRows.filter(
      (row) => (Number.parseInt(row.count, 10) || 0) > MAX_VACCINATION_APPOINTMENTS_PER_DAY,
    ).length;
    const bucketMap = buildBucketMap(weekdayKeys, weekdayCountRows);
    const availableWeekdaySlots = [...bucketMap.values()].reduce(
      (sum, count) => sum + Math.max(MAX_VACCINATION_APPOINTMENTS_PER_DAY - count, 0),
      0,
    );

    printSection('Weekend Vaccination Repair Audit', [
      `marker: ${options.marker}`,
      `mode: ${options.mode}`,
      `date window: ${startDate} -> ${endDate}`,
      `clinic ids: ${clinicIds.join(', ')}`,
      `weekday buckets in window: ${weekdayKeys.length}`,
      `weekday capacity in window: ${maxWindowCapacity}`,
      `current clinic weekday vaccination load: ${currentClinicWeekdayLoad}`,
      `current clinic max weekday load: ${maxObservedClinicWeekdayLoad}`,
      `current clinic weekdays over ${MAX_VACCINATION_APPOINTMENTS_PER_DAY}: ${clinicOverflowDays}`,
      `current synthetic weekday vaccination load: ${currentMarkerWeekdayLoad}`,
      `synthetic weekend vaccination appointments: ${markerWeekendLoad}`,
      `synthetic total vaccination appointments: ${totalMarkerVaccinationAppointments}`,
      `synthetic max weekday load: ${maxObservedMarkerWeekdayLoad}`,
      `synthetic weekdays over ${MAX_VACCINATION_APPOINTMENTS_PER_DAY}: ${markerOverflowDays}`,
      `available weekday slots at clinic level: ${availableWeekdaySlots}`,
      `weekend completed immunization records: ${weekendImmunizations.length}`,
      `weekend legacy vaccination records: ${weekendLegacyVaccinations.length}`,
    ]);

    const impossibleLoad =
      clinicOverflowDays > 0 ||
      totalMarkerVaccinationAppointments > maxWindowCapacity ||
      markerOverflowDays > 0 ||
      markerWeekendLoad > availableWeekdaySlots;

    if (impossibleLoad) {
      printSection('Repair Status', [
        'The current synthetic vaccination workload exceeds the weekday-only capacity rule.',
        `No data was changed. Reduce synthetic vaccination appointment volume or widen the active-day calendar before applying a repair.`,
      ]);

      if (options.mode === 'repair') {
        process.exitCode = 1;
      }
      return;
    }

    if (options.mode !== 'repair') {
      printSection('Repair Status', [
        'Audit completed successfully.',
        'Run with --apply to execute the weekday reassignment transaction.',
      ]);
      return;
    }

    const appointmentAssignments = assignBalancedWeekdays(weekendAppointments, bucketMap);
    const appointmentLookup = buildAppointmentDateLookup(appointmentAssignments);
    const immunizationAssignments = mapRecordDates(weekendImmunizations, appointmentLookup);
    const legacyAssignments = mapRecordDates(weekendLegacyVaccinations, appointmentLookup);

    await client.query('BEGIN');
    await updateDateAssignments(client, 'appointments', appointmentAssignments, {
      idColumn: 'id',
      dateColumn: 'scheduled_date',
    });
    await updateDateAssignments(client, 'immunization_records', immunizationAssignments, {
      idColumn: 'id',
      dateColumn: 'admin_date',
    });
    await updateDateAssignments(client, 'vaccination_records', legacyAssignments, {
      idColumn: 'id',
      dateColumn: 'admin_date',
    });
    await client.query('COMMIT');

    printSection('Repair Status', [
      `updated appointments: ${appointmentAssignments.length}`,
      `updated immunization_records: ${immunizationAssignments.length}`,
      `updated vaccination_records: ${legacyAssignments.length}`,
      'Weekend vaccination records were reassigned to weekday slots successfully.',
    ]);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {
      // Ignore rollback failures after a non-transactional audit.
    }

    console.error('\nWeekend vaccination repair failed.');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
};

if (require.main === module) {
  main();
}

module.exports = {
  assignBalancedWeekdays,
  enumerateWeekdays,
  mapRecordDates,
  parseArgs,
};
