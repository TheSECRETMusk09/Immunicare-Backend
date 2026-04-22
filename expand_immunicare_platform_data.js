require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  MAX_VACCINATION_APPOINTMENTS_PER_DAY,
  getClinicTodayDateKey,
} = require('./utils/clinicCalendar');

process.env.DB_QUERY_TIMEOUT = process.env.DB_QUERY_TIMEOUT || '0';
process.env.DB_STATEMENT_TIMEOUT = process.env.DB_STATEMENT_TIMEOUT || '0';

const db = require('./db');
const { isDateAvailableForBooking } = require('./config/holidays');
const {
  FEMALE_FIRST_NAMES,
  MALE_FIRST_NAMES,
  MIDDLE_NAMES,
  LAST_NAMES,
  PASIG_BARANGAYS,
  STREET_NAMES,
  SUBDIVISIONS,
  PLACE_OF_BIRTHS,
} = require('./demo_dataset_catalog');

const MARKER = 'EXP95000';
const RNG_SEED = 20260404;
const TARGET_INFANTS = 95000;
const WINDOW_START = new Date('2025-08-01T00:00:00.000Z');
const WINDOW_END = new Date('2030-07-31T23:59:59.999Z');
const OPERATIONAL_ACTIVE_DAYS_PER_YEAR = 243;
const OPERATIONAL_WINDOW_YEARS = 5;
const DEFAULT_GUARDIAN_PASSWORD = 'GuardianExpand2026!';
const DEMO_CITY = 'Pasig City';
const DEMO_REGION = 'NCR';
const DEMO_POSTAL_CODE = '1600';
const DEFAULT_HEALTH_CENTER = 'San Nicolas Health Center';
const toIsoDate = (value) => new Date(value.getTime()).toISOString().slice(0, 10);
const countOperationalDaysInWindow = (start, end) => {
  let count = 0;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

  while (cursor <= end) {
    if (isDateAvailableForBooking(toIsoDate(cursor), { allowPast: true }).isAvailable) {
      count += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return count;
};

const WINDOW_OPERATIONAL_VACCINATION_DAYS = countOperationalDaysInWindow(WINDOW_START, WINDOW_END);
const WINDOW_OPERATIONAL_VACCINATION_CAPACITY =
  WINDOW_OPERATIONAL_VACCINATION_DAYS * MAX_VACCINATION_APPOINTMENTS_PER_DAY;
const COMPLETED_VISIT_1_TARGET = 4200;
const COMPLETED_VISIT_2_TARGET = 1600;
const COMPLETED_DOSE_TARGET =
  (TARGET_INFANTS * 2)
  + (COMPLETED_VISIT_1_TARGET * 4)
  + (COMPLETED_VISIT_2_TARGET * 3);

const TRANSACTION_TARGETS = Object.freeze({
  immunization_records: COMPLETED_DOSE_TARGET,
  appointments: WINDOW_OPERATIONAL_VACCINATION_CAPACITY,
  vaccine_inventory_transactions: 25000,
  notifications: 320000,
  reports: 15000,
  document_generation: 70000,
  document_generation_logs: 50000,
  transfer_in_cases: 10000,
  document_downloads: 10000,
});

const TARGET_TRANSACTIONS = Object.values(TRANSACTION_TARGETS).reduce(
  (sum, value) => sum + value,
  0,
);

const SESSION_TARGET = 50000;

const VISIT_TEMPLATES = Object.freeze([
  {
    code: 'BIRTH',
    ageMonths: 0,
    vaccines: [
      { code: 'BCG', dose: 1 },
      { code: 'HEP-B', dose: 1 },
    ],
  },
  {
    code: 'VISIT_1M',
    ageMonths: 1,
    vaccines: [
      { code: 'HEP-B', dose: 2 },
      { code: 'PENTA', dose: 1 },
      { code: 'OPV-20', dose: 1 },
      { code: 'PCV-13-10', dose: 1 },
    ],
  },
  {
    code: 'VISIT_2M',
    ageMonths: 2,
    vaccines: [
      { code: 'PENTA', dose: 2 },
      { code: 'OPV-20', dose: 2 },
      { code: 'PCV-13-10', dose: 2 },
    ],
  },
]);

const INVENTORY_CODES = ['BCG', 'HEP-B', 'PENTA', 'OPV-20', 'PCV-13-10', 'MMR', 'IPV-MULTI'];

const mulberry32 = (seed) => {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rng = mulberry32(RNG_SEED);
const rand = () => rng();
const chance = (p) => rand() < p;
const randomInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randomFloat = (min, max, decimals = 2) =>
  Number((min + (max - min) * rand()).toFixed(decimals));
const pick = (items) => items[randomInt(0, items.length - 1)];

const cloneDate = (value) => new Date(value.getTime());
const addDays = (value, days) => {
  const copy = cloneDate(value);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
};
const addMonths = (value, months) => {
  const copy = cloneDate(value);
  const day = copy.getUTCDate();
  copy.setUTCDate(1);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  const maxDay = new Date(Date.UTC(copy.getUTCFullYear(), copy.getUTCMonth() + 1, 0)).getUTCDate();
  copy.setUTCDate(Math.min(day, maxDay));
  return copy;
};
const startOfMonth = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
const endOfMonth = (value) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0, 23, 59, 59, 999));
const monthKey = (value) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
const safeJson = (value) => JSON.stringify(value || {});
const randomDateBetween = (start, end) => {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return new Date(startMs + Math.floor(rand() * (endMs - startMs + 1)));
};

const weightedPick = (choices) => {
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  const cursor = rand() * total;
  let cumulative = 0;
  for (const choice of choices) {
    cumulative += choice.weight;
    if (cursor <= cumulative) {
      return choice.value;
    }
  }
  return choices[choices.length - 1].value;
};

const buildGuardianEmail = (sequence) => `${MARKER.toLowerCase()}.guardian.${String(sequence).padStart(6, '0')}@immunicare.test`;
const buildGuardianUsername = (sequence) => `${MARKER.toLowerCase()}.guardian.${String(sequence).padStart(6, '0')}`;
const buildInfantControlNumber = (sequence) => `${MARKER}-INF-${String(sequence).padStart(6, '0')}`;
const buildAppointmentControlNumber = (sequence) => `${MARKER}-APT-${String(sequence).padStart(7, '0')}`;
const buildReferenceNumber = (prefix, sequence) => `${MARKER}-${prefix}-${String(sequence).padStart(8, '0')}`;
const formatMobile = () => `+639${String(randomInt(10, 99))}${String(randomInt(0, 9999999)).padStart(7, '0')}`;

const buildAddress = (barangay) => {
  const block = randomInt(1, 30);
  const lot = randomInt(1, 40);
  const subdivision = chance(0.55) ? `${pick(SUBDIVISIONS)}, ` : '';
  return `Blk ${block} Lot ${lot}, ${subdivision}${pick(STREET_NAMES)} St., Barangay ${barangay}, ${DEMO_CITY}, ${DEMO_REGION} ${DEMO_POSTAL_CODE}`;
};

const dailySeries = (start, end) => {
  const values = [];
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (cursor <= end) {
    values.push(cloneDate(cursor));
    cursor = addDays(cursor, 1);
  }
  return values;
};

const isWeekendDay = (value) => {
  const dow = value.getUTCDay();
  return dow === 0 || dow === 6;
};

const rollForwardToWeekday = (value) => {
  let cursor = cloneDate(value);
  while (!isDateAvailableForBooking(toIsoDate(cursor), { allowPast: true }).isAvailable) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
};

const weekdaySeries = (start, end) =>
  dailySeries(start, end).filter((day) =>
    isDateAvailableForBooking(toIsoDate(day), { allowPast: true }).isAvailable,
  );

const buildOperationalServiceDays = (
  start,
  end,
  { maxDaysPerYear = OPERATIONAL_ACTIVE_DAYS_PER_YEAR } = {},
) => {
  const weekdays = weekdaySeries(start, end);
  const daysByYear = new Map();

  for (const day of weekdays) {
    const year = day.getUTCFullYear();
    if (!daysByYear.has(year)) {
      daysByYear.set(year, []);
    }
    daysByYear.get(year).push(day);
  }

  const serviceDays = [];
  for (const year of [...daysByYear.keys()].sort((left, right) => left - right)) {
    const yearlyDays = daysByYear.get(year);
    if (yearlyDays.length <= maxDaysPerYear) {
      serviceDays.push(...yearlyDays);
      continue;
    }

    const step = yearlyDays.length / maxDaysPerYear;
    for (let index = 0; index < maxDaysPerYear; index += 1) {
      const sourceIndex = Math.min(
        yearlyDays.length - 1,
        Math.floor(index * step),
      );
      serviceDays.push(yearlyDays[sourceIndex]);
    }
  }

  return serviceDays;
};

const createOperationalDayAllocator = (
  start,
  end,
  {
    category = 'operational service days',
    maxPerDay = MAX_VACCINATION_APPOINTMENTS_PER_DAY,
    maxDaysPerYear = OPERATIONAL_ACTIVE_DAYS_PER_YEAR,
  } = {},
) => {
  const serviceDays = buildOperationalServiceDays(start, end, { maxDaysPerYear });

  if (!serviceDays.length) {
    throw new Error(`No service days available for ${category}.`);
  }

  const keyedDays = serviceDays.map((day) => ({
    day,
    key: toIsoDate(day),
    count: 0,
  }));

  const allocate = (preferredDate) => {
    const normalizedPreferred = rollForwardToWeekday(clampDate(preferredDate, start, end));
    const preferredKey = toIsoDate(normalizedPreferred);
    let preferredIndex = keyedDays.findIndex((entry) => entry.key >= preferredKey);
    if (preferredIndex < 0) {
      preferredIndex = keyedDays.length - 1;
    }

    for (let index = preferredIndex; index < keyedDays.length; index += 1) {
      if (keyedDays[index].count < maxPerDay) {
        keyedDays[index].count += 1;
        return cloneDate(keyedDays[index].day);
      }
    }

    for (let index = preferredIndex - 1; index >= 0; index -= 1) {
      if (keyedDays[index].count < maxPerDay) {
        keyedDays[index].count += 1;
        return cloneDate(keyedDays[index].day);
      }
    }

    throw new Error(
      `Unable to allocate ${category}; service-day capacity of ${serviceDays.length * maxPerDay} has been exhausted.`,
    );
  };

  return {
    serviceDays,
    maxCapacity: serviceDays.length * maxPerDay,
    allocate,
  };
};

const monthSeries = (start, end) => {
  const values = [];
  let cursor = startOfMonth(start);
  while (cursor <= end) {
    values.push(cloneDate(cursor));
    cursor = addMonths(cursor, 1);
  }
  return values;
};

const distributeByDay = (total, days, { minPerDay = 1, category = 'generic' } = {}) => {
  if (total < days.length * minPerDay) {
    throw new Error(`Cannot distribute ${total} ${category} records with minPerDay=${minPerDay}`);
  }

  const base = new Array(days.length).fill(minPerDay);
  const remaining = total - days.length * minPerDay;
  if (remaining === 0) {
    return base;
  }

  const weights = days.map((day, index) => {
    const dow = day.getUTCDay();
    const month = day.getUTCMonth() + 1;
    const dayOfMonth = day.getUTCDate();

    const weekendFactor = dow === 0 || dow === 6 ? 0.62 : 1.0;
    const monthFactor = [8, 9, 10].includes(month) ? 1.22 : [12, 1].includes(month) ? 1.12 : [3, 4].includes(month) ? 1.15 : 1.0;
    const campaignFactor = dayOfMonth <= 5 && [3, 8, 10].includes(month) ? 1.35 : 1.0;
    const endMonthFactor = dayOfMonth >= 25 ? 1.08 : 1.0;
    const oscillation = 0.9 + ((index % 14) / 100);
    return weekendFactor * monthFactor * campaignFactor * endMonthFactor * oscillation;
  });

  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const fractional = [];
  let allocated = 0;
  for (let index = 0; index < days.length; index += 1) {
    const exact = (weights[index] / weightTotal) * remaining;
    const whole = Math.floor(exact);
    base[index] += whole;
    allocated += whole;
    fractional.push({ index, remainder: exact - whole });
  }

  fractional.sort((left, right) => right.remainder - left.remainder);
  for (let index = 0; index < remaining - allocated; index += 1) {
    base[fractional[index].index] += 1;
  }

  return base;
};

const rebalanceCappedDistribution = (counts, maxPerDay, category) => {
  const rebalanced = [...counts];
  let overflow = 0;

  for (let index = 0; index < rebalanced.length; index += 1) {
    if (rebalanced[index] > maxPerDay) {
      overflow += rebalanced[index] - maxPerDay;
      rebalanced[index] = maxPerDay;
    }
  }

  if (overflow === 0) {
    return rebalanced;
  }

  const candidates = rebalanced
    .map((count, index) => ({ index, count }))
    .sort((left, right) => left.count - right.count);

  for (const candidate of candidates) {
    if (overflow === 0) {
      break;
    }

    const spare = maxPerDay - rebalanced[candidate.index];
    if (spare <= 0) {
      continue;
    }

    const allocation = Math.min(spare, overflow);
    rebalanced[candidate.index] += allocation;
    overflow -= allocation;
  }

  if (overflow > 0) {
    throw new Error(
      `Unable to rebalance ${category} within the ${maxPerDay}/day weekday capacity.`,
    );
  }

  return rebalanced;
};

const distributeByWeekdayCapacity = (
  total,
  days,
  {
    category = 'vaccination appointments',
    maxPerDay = MAX_VACCINATION_APPOINTMENTS_PER_DAY,
  } = {},
) => {
  const weekdays = days.filter((day) => !isWeekendDay(day));
  const maxCapacity = weekdays.length * maxPerDay;

  if (total > maxCapacity) {
    throw new Error(
      `Cannot distribute ${total} ${category}; weekday capacity is only ${maxCapacity}.`,
    );
  }

  const rawCounts = distributeByDay(total, weekdays, {
    minPerDay: 0,
    category,
  });
  const counts = rebalanceCappedDistribution(rawCounts, maxPerDay, category);

  return {
    days: weekdays,
    counts,
    maxCapacity,
  };
};

const buildInsertQuery = (tableName, columns, rows, returningColumns = []) => {
  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const rowPlaceholders = row.map((value, columnIndex) => {
      values.push(value);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${rowPlaceholders.join(', ')})`;
  });

  const returning = returningColumns.length ? ` RETURNING ${returningColumns.join(', ')}` : '';
  return {
    text: `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${placeholders.join(', ')}${returning}`,
    values,
  };
};

const chunkArray = (items, chunkSize) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const existingTableSet = async (client) => {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  return new Set(result.rows.map((row) => row.table_name));
};

const ensureSyntheticSupportTables = async (client, tables) => {
  if (!tables.has('document_generation_logs')) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_generation_logs (
        id SERIAL PRIMARY KEY,
        template_id INTEGER REFERENCES paper_templates(id),
        patient_id INTEGER REFERENCES patients(id),
        admin_id INTEGER REFERENCES admin(id),
        generation_type VARCHAR(50) NOT NULL,
        generation_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'SUCCESS',
        error_message TEXT,
        generated_files JSONB,
        processing_time INTEGER,
        data_source JSONB
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_document_generation_logs_template_id ON document_generation_logs(template_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_document_generation_logs_patient_id ON document_generation_logs(patient_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_document_generation_logs_admin_id ON document_generation_logs(admin_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_document_generation_logs_generation_date ON document_generation_logs(generation_date)`);
    tables.add('document_generation_logs');
  }
};

const tableColumnsMap = async (client, tables) => {
  const result = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);
  const map = new Map();
  for (const table of tables) {
    map.set(table, new Set());
  }
  for (const row of result.rows) {
    if (!map.has(row.table_name)) {
      map.set(row.table_name, new Set());
    }
    map.get(row.table_name).add(row.column_name);
  }
  return map;
};

const columnLengthCache = new Map();

const getColumnLengthMap = async (client, tableName) => {
  if (columnLengthCache.has(tableName)) {
    return columnLengthCache.get(tableName);
  }

  const result = await client.query(
    `
      SELECT column_name, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND character_maximum_length IS NOT NULL
    `,
    [tableName],
  );

  const lengths = new Map(
    result.rows.map((row) => [row.column_name, Number(row.character_maximum_length)]),
  );
  columnLengthCache.set(tableName, lengths);
  return lengths;
};

const getExistingColumns = async (client, tableName, candidateColumns) => {
  const result = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = ANY($2::text[])
    `,
    [tableName, candidateColumns],
  );

  return new Set(result.rows.map((row) => row.column_name));
};

const insertObjectRows = async (client, tableName, columnsMap, rows, options = {}) => {
  if (!rows.length) {
    return [];
  }

  const availableColumns = columnsMap.get(tableName) || new Set();
  const columnLengthMap = await getColumnLengthMap(client, tableName);
  if (!availableColumns.size) {
    return [];
  }

  const filteredRows = rows
    .map((row) => {
      const filtered = {};
      Object.keys(row).forEach((key) => {
        if (availableColumns.has(key) && row[key] !== undefined) {
          const value = row[key];
          const maxLength = columnLengthMap.get(key);
          if (typeof value === 'string' && Number.isFinite(maxLength) && value.length > maxLength) {
            filtered[key] = value.slice(0, maxLength);
          } else {
            filtered[key] = value;
          }
        }
      });
      return filtered;
    })
    .filter((row) => Object.keys(row).length > 0);

  if (!filteredRows.length) {
    return [];
  }

  const columns = Object.keys(filteredRows[0]).filter((column) => filteredRows.every((row) => Object.prototype.hasOwnProperty.call(row, column)));
  const valueRows = filteredRows.map((row) => columns.map((column) => row[column] ?? null));
  const returningColumns = (options.returningColumns || []).filter((column) => availableColumns.has(column));
  const chunkSize = options.chunkSize || 500;
  const inserted = [];

  for (const chunk of chunkArray(valueRows, chunkSize)) {
    const query = buildInsertQuery(tableName, columns, chunk, returningColumns);
    const result = await client.query(query);
    if (returningColumns.length) {
      inserted.push(...result.rows);
    }
  }

  return inserted;
};

const fetchReferenceData = async (client) => {
  const userColumns = await getExistingColumns(client, 'users', [
    'id',
    'username',
    'email',
    'first_name',
    'last_name',
    'role',
    'role_id',
    'clinic_id',
    'facility_id',
    'contact',
  ]);
  const selectableUserColumns = [
    'id',
    'username',
    'email',
    'first_name',
    'last_name',
    'role',
    'role_id',
    'clinic_id',
    'facility_id',
    'contact',
  ].filter((column) => userColumns.has(column));

  const [rolesResult, clinicsResult, vaccinesResult, schedulesResult, suppliersResult, usersResult] = await Promise.all([
    client.query(`SELECT id, name FROM roles`),
    client.query(`SELECT id, name FROM clinics`),
    client.query(`
      SELECT id, code, name, manufacturer
      FROM vaccines
      WHERE COALESCE(is_active, true) = true
      ORDER BY id
    `),
    client.query(`
      SELECT id, vaccine_id, vaccine_name, vaccine_code, dose_number, age_in_months, target_age_months
      FROM vaccination_schedules
      WHERE COALESCE(is_active, true) = true
    `),
    client.query(`
      SELECT id, name, supplier_code
      FROM suppliers
      WHERE COALESCE(is_active, true) = true
      ORDER BY id
    `).catch(() => ({ rows: [] })),
    client.query(`
      SELECT ${selectableUserColumns.join(', ')}
      FROM users
      WHERE COALESCE(is_active, true) = true
        AND COALESCE(role, '') <> 'guardian'
      ORDER BY id
      LIMIT 25
    `),
  ]);

  return {
    rolesByName: new Map(rolesResult.rows.map((row) => [String(row.name).toLowerCase(), row.id])),
    clinicsByName: new Map(clinicsResult.rows.map((row) => [row.name, row.id])),
    vaccinesByCode: new Map(vaccinesResult.rows.map((row) => [row.code, row])),
    vaccines: vaccinesResult.rows,
    schedulesByKey: new Map(
      schedulesResult.rows.map((row) => [`${row.vaccine_id}:${row.dose_number}`, row]),
    ),
    suppliers: suppliersResult.rows,
    staffUsers: usersResult.rows,
  };
};

const resolveAppointmentInfantTargetTable = async (client) => {
  const result = await client.query(`
    SELECT ccu.table_name AS foreign_table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'appointments'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'infant_id'
    LIMIT 1
  `);

  return result.rows[0]?.foreign_table_name || null;
};

const resolveScopeIds = (referenceData) => {
  const clinicId =
    referenceData.clinicsByName.get('San Nicolas Health Center') ||
    referenceData.clinicsByName.get('Main Health Center') ||
    referenceData.clinicsByName.get('Guardian Portal') ||
    1;

  const guardianPortalClinicId =
    referenceData.clinicsByName.get('Guardian Portal') ||
    clinicId;

  const facilityId = clinicId === 1 ? 203 : clinicId;

  return { clinicId, guardianPortalClinicId, facilityId };
};

const chooseStaffUsers = (referenceData) => {
  if (!referenceData.staffUsers.length) {
    throw new Error('No active non-guardian staff users found. Cannot assign generated operational records.');
  }
  return referenceData.staffUsers;
};

const buildDailyRegistrationDates = () => {
  const days = dailySeries(WINDOW_START, WINDOW_END);
  const counts = distributeByDay(TARGET_INFANTS, days, {
    minPerDay: 1,
    category: 'registrations',
  });

  const dates = [];
  days.forEach((day, index) => {
    for (let count = 0; count < counts[index]; count += 1) {
      dates.push(addDays(day, 0));
    }
  });
  return dates;
};

const buildFamiliesAndChildren = ({ clinicId, facilityId }) => {
  const registrationDates = buildDailyRegistrationDates();
  const families = [];
  const children = [];

  registrationDates.forEach((createdAt, index) => {
    const sequence = index + 1;
    const isFemaleGuardian = chance(0.82);
    const guardianFirstName = pick(isFemaleGuardian ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
    const guardianMiddleName = pick(MIDDLE_NAMES);
    const guardianLastName = pick(LAST_NAMES);
    const guardianBarangay = pick(PASIG_BARANGAYS);
    const guardianRelationship = weightedPick([
      { value: 'Mother', weight: 68 },
      { value: 'Father', weight: 18 },
      { value: 'Grandmother', weight: 8 },
      { value: 'Aunt', weight: 4 },
      { value: 'Guardian', weight: 2 },
    ]);

    const guardian = {
      sequence,
      firstName: guardianFirstName,
      middleName: guardianMiddleName,
      lastName: guardianLastName,
      relationship: guardianRelationship,
      barangay: guardianBarangay,
      address: buildAddress(guardianBarangay),
      phone: formatMobile(),
      alternatePhone: formatMobile(),
      emergencyPhone: formatMobile(),
      emergencyContact: `${pick(FEMALE_FIRST_NAMES)} ${guardianLastName}`,
      email: buildGuardianEmail(sequence),
      username: buildGuardianUsername(sequence),
      createdAt,
      lastLogin: addDays(createdAt, randomInt(1, 14)),
      clinicId,
      facilityId,
    };

    const sex = chance(0.51) ? 'M' : 'F';
    const childFirstName = pick(sex === 'F' ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
    const childMiddleName = pick(MIDDLE_NAMES);
    const dob = addDays(createdAt, -randomInt(0, 75));
    const child = {
      sequence,
      controlNumber: buildInfantControlNumber(sequence),
      firstName: childFirstName,
      middleName: childMiddleName,
      lastName: guardianLastName,
      sex,
      dob,
      createdAt,
      motherName:
        guardianRelationship === 'Mother'
          ? `${guardianFirstName} ${guardianMiddleName} ${guardianLastName}`
          : `${pick(FEMALE_FIRST_NAMES)} ${pick(MIDDLE_NAMES)} ${guardianLastName}`,
      fatherName:
        guardianRelationship === 'Father'
          ? `${guardianFirstName} ${guardianMiddleName} ${guardianLastName}`
          : `${pick(MALE_FIRST_NAMES)} ${pick(MIDDLE_NAMES)} ${guardianLastName}`,
      barangay: guardianBarangay,
      address: guardian.address,
      contact: guardian.phone,
      birthWeight: randomFloat(2.4, 4.2),
      birthHeight: randomFloat(47, 54),
      placeOfBirth: pick(PLACE_OF_BIRTHS),
      familyNo: `${MARKER}-FAM-${String(sequence).padStart(6, '0')}`,
      healthCenter: DEFAULT_HEALTH_CENTER,
      clinicId,
      facilityId,
      doctorMidwifeNurse: weightedPick([
        { value: 'Nurse Reyes', weight: 45 },
        { value: 'Midwife Lim', weight: 32 },
        { value: 'Dr. Tan', weight: 23 },
      ]),
      typeOfDelivery: weightedPick([
        { value: 'Normal', weight: 74 },
        { value: 'Cesarean', weight: 22 },
        { value: 'Assisted', weight: 4 },
      ]),
      timeOfDelivery: `${String(randomInt(0, 23)).padStart(2, '0')}:${String(randomInt(0, 59)).padStart(2, '0')}:00`,
      nbsDone: chance(0.92),
      validationStatus: weightedPick([
        { value: 'approved', weight: 82 },
        { value: 'for_validation', weight: 11 },
        { value: 'pending', weight: 7 },
      ]),
      transferInSource: chance(0.11) ? 'Transferred from another Pasig vaccination facility' : null,
    };

    families.push({ sequence, guardian });
    children.push(child);
  });

  return { families, children };
};

const buildGuardianObjects = (families) =>
  families.map(({ guardian }) => ({
    name: `${guardian.firstName} ${guardian.middleName} ${guardian.lastName}`,
    phone: guardian.phone,
    email: guardian.email,
    address: guardian.address,
    relationship: guardian.relationship,
    is_active: true,
    created_at: guardian.createdAt,
    updated_at: guardian.createdAt,
    password_hash: null,
    is_password_set: true,
    last_login: guardian.lastLogin,
    must_change_password: false,
    password: DEFAULT_GUARDIAN_PASSWORD,
    first_name: guardian.firstName,
    last_name: guardian.lastName,
    middle_name: guardian.middleName,
    emergency_contact_priority: 1,
    alternate_phone: guardian.alternatePhone,
    is_primary_guardian: true,
    relationship_to_student: guardian.relationship,
    clinic_id: guardian.clinicId,
    facility_id: guardian.facilityId,
    emergency_contact: guardian.emergencyContact,
    emergency_phone: guardian.emergencyPhone,
  }));

const buildGuardianUserObjects = (families, guardianIdsBySequence, guardianRoleId, { clinicId, facilityId }, passwordHash) =>
  families.map(({ sequence, guardian }) => ({
    username: guardian.username,
    password_hash: passwordHash,
    role_id: guardianRoleId,
    clinic_id: clinicId,
    facility_id: facilityId,
    contact: guardian.phone,
    email: guardian.email,
    last_login: guardian.lastLogin,
    guardian_id: guardianIdsBySequence.get(sequence),
    is_active: true,
    created_at: guardian.createdAt,
    updated_at: guardian.createdAt,
    force_password_change: false,
    password: DEFAULT_GUARDIAN_PASSWORD,
    first_name: guardian.firstName,
    last_name: guardian.lastName,
    role: 'guardian',
    canonical_role: 'GUARDIAN',
    permissions: safeJson([]),
  }));

const buildPatientObjects = (children, guardianIdsBySequence) =>
  children.map((child) => ({
    name: `${child.firstName} ${child.lastName}`,
    date_of_birth: toIsoDate(child.dob),
    dob: toIsoDate(child.dob),
    gender: child.sex,
    sex: child.sex,
    parent_guardian: `${child.motherName} / ${child.fatherName}`,
    contact_number: child.contact,
    contact: child.contact,
    address: child.address,
    created_at: child.createdAt,
    updated_at: child.createdAt,
    guardian_id: guardianIdsBySequence.get(child.sequence),
    first_name: child.firstName,
    last_name: child.lastName,
    middle_name: child.middleName,
    national_id: `${MARKER}-NAT-${String(child.sequence).padStart(8, '0')}`,
    photo_url: null,
    mother_name: child.motherName,
    father_name: child.fatherName,
    birth_weight: child.birthWeight,
    birth_height: child.birthHeight,
    place_of_birth: child.placeOfBirth,
    barangay: child.barangay,
    health_center: child.healthCenter,
    family_no: child.familyNo,
    time_of_delivery: child.timeOfDelivery,
    type_of_delivery: child.typeOfDelivery,
    doctor_midwife_nurse: child.doctorMidwifeNurse,
    nbs_done: child.nbsDone,
    nbs_date: child.nbsDone ? toIsoDate(addDays(child.dob, 2)) : null,
    cellphone_number: child.contact,
    clinic_id: child.clinicId,
    facility_id: child.facilityId,
    control_number: child.controlNumber,
    is_active: true,
    allergy_information: chance(0.15) ? 'No known allergy' : null,
    health_care_provider: DEFAULT_HEALTH_CENTER,
    transfer_in_source: child.transferInSource,
    validation_status: child.validationStatus,
    auto_computed_next_vaccine: null,
    age_months: Math.max(0, Math.floor((WINDOW_END.getTime() - child.dob.getTime()) / (30.4 * 86400000))),
  }));

const buildInfantObjects = (children) =>
  children.map((child) => ({
    first_name: child.firstName,
    last_name: child.lastName,
    middle_name: child.middleName,
    dob: toIsoDate(child.dob),
    sex: child.sex,
    national_id: `${MARKER}-NAT-${String(child.sequence).padStart(8, '0')}`,
    address: child.address,
    contact: child.contact,
    guardian_id: null,
    clinic_id: child.clinicId,
    facility_id: child.facilityId,
    birth_height: child.birthHeight,
    birth_weight: child.birthWeight,
    mother_name: child.motherName,
    father_name: child.fatherName,
    barangay: child.barangay,
    health_center: child.healthCenter,
    family_no: child.familyNo,
    place_of_birth: child.placeOfBirth,
    time_of_delivery: child.timeOfDelivery,
    type_of_delivery: child.typeOfDelivery,
    doctor_midwife_nurse: child.doctorMidwifeNurse,
    nbs_done: child.nbsDone,
    nbs_date: child.nbsDone ? toIsoDate(addDays(child.dob, 2)) : null,
    cellphone_number: child.contact,
    is_active: true,
    created_at: child.createdAt,
    updated_at: child.createdAt,
    patient_control_number: child.controlNumber,
  }));

const buildParentGuardianObjects = (children, guardianUsersByGuardianId, guardianIdsBySequence, infantIdsByControlNumber, passwordHash) =>
  children.map((child) => {
    const guardianId = guardianIdsBySequence.get(child.sequence);
    const guardianUser = guardianUsersByGuardianId.get(guardianId);
    return {
      user_id: guardianUser?.id || null,
      infant_id: infantIdsByControlNumber.get(child.controlNumber),
      relationship_type: 'parent',
      full_name: `${child.motherName}`,
      phone: child.contact,
      email: buildGuardianEmail(child.sequence),
      relationship_details: child.address,
      is_primary: true,
      is_active: true,
      created_at: child.createdAt,
      updated_at: child.createdAt,
      created_by: null,
      updated_by: null,
      password_hash: passwordHash,
      is_password_set: true,
    };
  });

const createPaperTemplatesIfNeeded = async (client, columnsMap, staffUsers) => {
  if (!(columnsMap.get('paper_templates') || new Set()).size) {
    return [];
  }

  const existing = await client.query(`
    SELECT id, name, template_type
    FROM paper_templates
    WHERE COALESCE(is_active, true) = true
    ORDER BY id
    LIMIT 10
  `);

  if (existing.rows.length >= 3) {
    return existing.rows;
  }

  const createdBy = staffUsers[0].id;
  const definitions = [
    { name: `${MARKER} Immunization Chart`, template_type: 'immunization_chart' },
    { name: `${MARKER} Immunization Record`, template_type: 'immunization_record' },
    { name: `${MARKER} Vaccine Schedule`, template_type: 'vaccine_schedule' },
  ].slice(existing.rows.length);

  const inserted = await insertObjectRows(
    client,
    'paper_templates',
    columnsMap,
    definitions.map((definition) => ({
      name: definition.name,
      description: `${MARKER} autogenerated template`,
      template_type: definition.template_type,
      fields: safeJson({ autogenerated: true }),
      validation_rules: safeJson({}),
      is_active: true,
      created_by: createdBy,
      updated_by: createdBy,
      created_at: WINDOW_START,
      updated_at: WINDOW_START,
    })),
    { returningColumns: ['id', 'name', 'template_type'], chunkSize: 50 },
  );

  return [...existing.rows, ...inserted];
};

const generateImmunizationData = ({
  children,
  patientIdsByControlNumber,
  infantIdsByControlNumber,
  referenceData,
  staffUsers,
  batchIdByCodeAndMonth,
}) => {
  const shuffled = [...children];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const visit1Children = new Set(
    shuffled.slice(0, COMPLETED_VISIT_1_TARGET).map((child) => child.controlNumber),
  );
  const visit2Children = new Set(
    shuffled.slice(0, COMPLETED_VISIT_2_TARGET).map((child) => child.controlNumber),
  );

  const immunizationRows = [];
  const legacyVaccinationRows = [];
  const visitAppointmentSeeds = [];
  const completionIndexByChild = new Map();
  const completedVisitAllocator = createOperationalDayAllocator(WINDOW_START, WINDOW_END, {
    category: 'expanded immunization visits',
  });

  const scheduleIdFor = (vaccineCode, doseNumber) => {
    const vaccine = referenceData.vaccinesByCode.get(vaccineCode);
    if (!vaccine) {
      return null;
    }
    return referenceData.schedulesByKey.get(`${vaccine.id}:${doseNumber}`)?.id || null;
  };

  for (const child of children) {
    const completedVisits = ['BIRTH'];
    if (visit1Children.has(child.controlNumber)) {
      completedVisits.push('VISIT_1M');
    }
    if (visit2Children.has(child.controlNumber)) {
      completedVisits.push('VISIT_2M');
    }

    completionIndexByChild.set(child.controlNumber, completedVisits.length - 1);

    for (const visitCode of completedVisits) {
      const template = VISIT_TEMPLATES.find((entry) => entry.code === visitCode);
      const adminDate = visitCode === 'BIRTH'
        ? addDays(child.dob, randomInt(0, 3))
        : visitCode === 'VISIT_1M'
          ? addDays(addMonths(child.dob, 1), randomInt(-3, 8))
          : addDays(addMonths(child.dob, 2), randomInt(-3, 10));
      const boundedAdminDate = adminDate > WINDOW_END ? cloneDate(WINDOW_END) : adminDate;
      const safeAdminDate = completedVisitAllocator.allocate(boundedAdminDate);
      const recordCreatedAt = safeAdminDate < child.createdAt ? child.createdAt : safeAdminDate;
      const nextTemplateIndex = VISIT_TEMPLATES.findIndex((entry) => entry.code === visitCode) + 1;
      const nextDueDate = nextTemplateIndex < VISIT_TEMPLATES.length
        ? addMonths(child.dob, VISIT_TEMPLATES[nextTemplateIndex].ageMonths)
        : null;
      const administeredBy = pick(staffUsers).id;

      visitAppointmentSeeds.push({
        child,
        appointmentDate: safeAdminDate,
        status: 'attended',
        type: 'Vaccination',
        notes: `${MARKER} completed ${visitCode} vaccination visit`,
      });

      for (const vaccineDose of template.vaccines) {
        const vaccine = referenceData.vaccinesByCode.get(vaccineDose.code);
        if (!vaccine) {
          continue;
        }

        const batch = batchIdByCodeAndMonth.get(`${vaccineDose.code}:${monthKey(startOfMonth(safeAdminDate))}`) || null;
        const batchNumber = batch?.lotNo || buildReferenceNumber(vaccineDose.code, child.sequence);

        immunizationRows.push({
          patient_id: patientIdsByControlNumber.get(child.controlNumber),
          infant_id: infantIdsByControlNumber.get(child.controlNumber),
          vaccine_id: vaccine.id,
          batch_id: batch?.id || null,
          admin_date: toIsoDate(safeAdminDate),
          next_due_date: nextDueDate ? toIsoDate(nextDueDate) : null,
          status: 'completed',
          notes: `${MARKER} autogenerated completion for ${visitCode}`,
          administered_by: administeredBy,
          created_at: recordCreatedAt,
          updated_at: recordCreatedAt,
          is_active: true,
          dose_no: vaccineDose.dose,
          site_of_injection: pick(['Left thigh', 'Right thigh', 'Left arm', 'Right arm']),
          reactions: chance(0.04) ? 'Mild fever resolved within 24 hours' : null,
          health_care_provider: DEFAULT_HEALTH_CENTER,
          schedule_id: scheduleIdFor(vaccineDose.code, vaccineDose.dose),
          lot_number: batchNumber,
          batch_number: batchNumber,
        });

        legacyVaccinationRows.push({
          infant_id: infantIdsByControlNumber.get(child.controlNumber),
          vaccine_id: vaccine.id,
          batch_id: batch?.id || null,
          dose_no: vaccineDose.dose,
          admin_date: toIsoDate(safeAdminDate),
          administered_by: administeredBy,
          vaccinator_id: administeredBy,
          dosage: vaccineDose.code === 'BCG' ? '0.05 mL intradermal' : '0.5 mL',
          site_of_injection: pick(['Left thigh', 'Right thigh', 'Left arm', 'Right arm']),
          reactions: chance(0.03) ? 'Localized redness' : null,
          next_due_date: nextDueDate ? toIsoDate(nextDueDate) : null,
          notes: `${MARKER} legacy mirror vaccination row`,
          is_active: true,
          created_at: recordCreatedAt,
          updated_at: recordCreatedAt,
        });
      }
    }
  }

  if (immunizationRows.length !== TRANSACTION_TARGETS.immunization_records) {
    throw new Error(`Expected ${TRANSACTION_TARGETS.immunization_records} immunization rows, generated ${immunizationRows.length}`);
  }

  return { immunizationRows, legacyVaccinationRows, visitAppointmentSeeds, completionIndexByChild };
};

const aggregateImmunizationUsageByMonth = (immunizationRows, referenceData) => {
  const counts = new Map();
  for (const row of immunizationRows) {
    const vaccine = referenceData.vaccines.find((entry) => entry.id === row.vaccine_id);
    if (!vaccine) {
      continue;
    }
    const key = `${vaccine.code}:${monthKey(startOfMonth(new Date(`${row.admin_date}T00:00:00.000Z`)))}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
};

const createBatchRows = (referenceData, scopeIds) => {
  const months = monthSeries(startOfMonth(addMonths(WINDOW_START, -3)), WINDOW_END);
  const batchRows = [];
  const batchIdByCodeAndMonth = new Map();
  let lotSequence = 1;

  for (const month of months) {
    for (const code of INVENTORY_CODES.filter((entry) => referenceData.vaccinesByCode.has(entry))) {
      const vaccine = referenceData.vaccinesByCode.get(code);
      const qtyReceived = randomInt(250, 1200);
      const manufactureDate = addDays(month, -randomInt(60, 150));
      const expiryDate = addDays(month, randomInt(320, 900));
      const lotNo = `${MARKER}-${code}-${monthKey(month).replace('-', '')}-${String(lotSequence).padStart(4, '0')}`;
      batchRows.push({
        vaccine_id: vaccine.id,
        lot_no: lotNo,
        lot_number: lotNo,
        expiry_date: toIsoDate(expiryDate),
        manufacture_date: toIsoDate(manufactureDate),
        qty_received: qtyReceived,
        qty_current: Math.round(qtyReceived * randomFloat(0.08, 0.26)),
        qty_initial: qtyReceived,
        supplier_id: referenceData.suppliers[0]?.id || null,
        clinic_id: scopeIds.clinicId,
        facility_id: scopeIds.facilityId,
        period_start: toIsoDate(month),
        storage_conditions: '2-8 C',
        status: 'active',
        is_active: true,
        created_at: addDays(month, 2),
        updated_at: addDays(month, 2),
      });
      batchIdByCodeAndMonth.set(`${code}:${monthKey(month)}`, { lotNo });
      lotSequence += 1;
    }
  }

  return { batchRows, batchIdByCodeAndMonth };
};

const createInventoryData = ({ referenceData, scopeIds, staffUsers, usageByMonth, batchLookup }) => {
  const months = monthSeries(WINDOW_START, WINDOW_END);
  const inventoryRows = [];
  const inventoryMeta = [];
  const carryoverByVaccine = new Map();

  for (const month of months) {
    const periodStart = startOfMonth(month);
    const periodEnd = endOfMonth(month);
    for (const code of INVENTORY_CODES.filter((entry) => referenceData.vaccinesByCode.has(entry))) {
      const vaccine = referenceData.vaccinesByCode.get(code);
      const usage = usageByMonth.get(`${code}:${monthKey(month)}`) || 0;
      const beginning = carryoverByVaccine.get(code) ?? randomInt(180, 360);
      const issuance = Math.max(usage, 60);
      const received = Math.max(issuance + randomInt(70, 200), randomInt(180, 480));
      const wastage = usage > 0 ? randomInt(0, Math.max(2, Math.floor(usage * 0.04))) : randomInt(0, 2);
      const transferredIn = randomInt(0, 30);
      const transferredOut = randomInt(0, 16);
      const stockOnHand = Math.max(0, beginning + received + transferredIn - transferredOut - wastage - issuance);
      const thresholds = { low: 45, critical: 20 };
      const batch = batchLookup.get(`${code}:${monthKey(month)}`);
      const createdBy = pick(staffUsers).id;

      inventoryRows.push({
        vaccine_id: vaccine.id,
        clinic_id: scopeIds.clinicId,
        facility_id: scopeIds.facilityId,
        beginning_balance: beginning,
        received_during_period: received,
        lot_batch_number: batch?.lotNo || buildReferenceNumber('LOT', inventoryRows.length + 1),
        transferred_in: transferredIn,
        transferred_out: transferredOut,
        expired_wasted: wastage,
        issuance,
        low_stock_threshold: thresholds.low,
        critical_stock_threshold: thresholds.critical,
        is_low_stock: stockOnHand <= thresholds.low,
        is_critical_stock: stockOnHand <= thresholds.critical,
        period_start: toIsoDate(periodStart),
        period_end: toIsoDate(periodEnd),
        created_by: createdBy,
        updated_by: createdBy,
        created_at: addDays(periodEnd, 1),
        updated_at: addDays(periodEnd, 1),
        stock_on_hand: stockOnHand,
        is_active: true,
        expiry_date: batch ? batch.expiry_date : null,
      });

      inventoryMeta.push({
        vaccineCode: code,
        vaccineId: vaccine.id,
        periodStart,
        periodEnd,
        beginning,
        received,
        transferredIn,
        transferredOut,
        wastage,
        issuance,
        stockOnHand,
        batch,
      });

      carryoverByVaccine.set(code, stockOnHand);
    }
  }

  return { inventoryRows, inventoryMeta };
};

const splitIntegerIntoParts = (total, parts) => {
  if (parts <= 1) {
    return [total];
  }
  const values = new Array(parts).fill(0);
  for (let index = 0; index < total; index += 1) {
    values[index % parts] += 1;
  }
  return values.filter((value) => value > 0);
};

const createInventoryTransactions = ({ inventoryMeta, insertedInventoryRows, staffUsers, scopeIds }) => {
  const transactions = [];
  const extraTxRows = TRANSACTION_TARGETS.vaccine_inventory_transactions - (inventoryMeta.length * 46);
  let globalSequence = 1;

  inventoryMeta.forEach((detail, index) => {
    const inventoryRow = insertedInventoryRows[index];
    const performedBy = pick(staffUsers).id;
    const approvedBy = pick(staffUsers).id;
    const totalTxForRow = 46 + (index < Math.max(0, extraTxRows) ? 1 : 0);
    const issueTxCount = totalTxForRow - 2;
    const issueQuantities = splitIntegerIntoParts(Math.max(issueTxCount, detail.issuance), issueTxCount);
    const maxIssueDay = Math.min(24, issueQuantities.length);

    transactions.push({
      vaccine_inventory_id: inventoryRow.id,
      vaccine_id: detail.vaccineId,
      clinic_id: scopeIds.clinicId,
      facility_id: scopeIds.facilityId,
      transaction_type: 'RECEIVE',
      quantity: detail.received,
      previous_balance: detail.beginning,
      new_balance: detail.beginning + detail.received,
      lot_number: detail.batch?.lotNo || buildReferenceNumber('LOT', globalSequence),
      batch_number: detail.batch?.lotNo || buildReferenceNumber('LOT', globalSequence),
      expiry_date: detail.batch?.expiry_date || null,
      supplier_name: 'Expanded synthetic supplier',
      reference_number: buildReferenceNumber('VIT', globalSequence),
      performed_by: performedBy,
      approved_by: approvedBy,
      notes: `${MARKER} monthly stock receipt`,
      triggered_low_stock_alert: detail.stockOnHand <= 45,
      triggered_critical_stock_alert: detail.stockOnHand <= 20,
      created_at: addDays(detail.periodStart, 2),
    });
    globalSequence += 1;

    let runningBalance = detail.beginning + detail.received + detail.transferredIn;
    for (let txIndex = 0; txIndex < issueQuantities.length; txIndex += 1) {
      const qty = issueQuantities[txIndex];
      const newBalance = Math.max(0, runningBalance - qty);
      transactions.push({
        vaccine_inventory_id: inventoryRow.id,
        vaccine_id: detail.vaccineId,
        clinic_id: scopeIds.clinicId,
        facility_id: scopeIds.facilityId,
        transaction_type: 'ISSUE',
        quantity: qty,
        previous_balance: runningBalance,
        new_balance: newBalance,
        lot_number: detail.batch?.lotNo || buildReferenceNumber('LOT', globalSequence),
        batch_number: detail.batch?.lotNo || buildReferenceNumber('LOT', globalSequence),
        expiry_date: detail.batch?.expiry_date || null,
        supplier_name: null,
        reference_number: buildReferenceNumber('VIT', globalSequence),
        performed_by: performedBy,
        approved_by: approvedBy,
        notes: `${MARKER} dose issuance`,
        triggered_low_stock_alert: newBalance <= 45,
        triggered_critical_stock_alert: newBalance <= 20,
        created_at: addDays(detail.periodStart, 3 + (txIndex % maxIssueDay)),
      });
      runningBalance = newBalance;
      globalSequence += 1;
    }

    transactions.push({
      vaccine_inventory_id: inventoryRow.id,
      vaccine_id: detail.vaccineId,
      clinic_id: scopeIds.clinicId,
      facility_id: scopeIds.facilityId,
      transaction_type: detail.wastage > 0 ? 'WASTAGE' : 'ADJUST',
      quantity: Math.max(1, detail.wastage),
      previous_balance: runningBalance,
      new_balance: Math.max(0, runningBalance - Math.max(1, detail.wastage)),
      lot_number: detail.batch?.lotNo || buildReferenceNumber('LOT', globalSequence),
      batch_number: detail.batch?.lotNo || buildReferenceNumber('LOT', globalSequence),
      expiry_date: detail.batch?.expiry_date || null,
      supplier_name: null,
      reference_number: buildReferenceNumber('VIT', globalSequence),
      performed_by: performedBy,
      approved_by: approvedBy,
      notes: `${MARKER} monthly wastage reconciliation`,
      triggered_low_stock_alert: detail.stockOnHand <= 45,
      triggered_critical_stock_alert: detail.stockOnHand <= 20,
      created_at: addDays(detail.periodStart, 26),
    });
    globalSequence += 1;
  });

  if (transactions.length !== TRANSACTION_TARGETS.vaccine_inventory_transactions) {
    throw new Error(`Expected ${TRANSACTION_TARGETS.vaccine_inventory_transactions} inventory tx rows, generated ${transactions.length}`);
  }

  return transactions;
};

const createAppointments = ({
  children,
  appointmentInfantIdsByControlNumber,
  guardianIdsBySequence,
  visitAppointmentSeeds,
  completionIndexByChild,
  staffUsers,
  scopeIds,
}) => {
  const days = buildOperationalServiceDays(WINDOW_START, WINDOW_END);
  const { counts } = distributeByWeekdayCapacity(TRANSACTION_TARGETS.appointments, days, {
    category: 'appointments',
  });
  const appointments = [];
  let sequence = 1;
  const todayKey = getClinicTodayDateKey();
  let childCursor = 0;
  days.forEach((day, dayIndex) => {
    let dayCount = counts[dayIndex];
    const scheduledDateKey = toIsoDate(day);
    const inPast = scheduledDateKey < todayKey;
    const isToday = scheduledDateKey === todayKey;

    while (dayCount > 0) {
      const child = children[childCursor % children.length];
      childCursor += 1;
      const nextVisitIndex = Math.min(
        completionIndexByChild.get(child.controlNumber) + 1,
        VISIT_TEMPLATES.length - 1,
      );
      const nextVisit = VISIT_TEMPLATES[nextVisitIndex];
      const status = weightedPick(
        inPast
          ? [
            { value: 'attended', weight: 54 },
            { value: 'no-show', weight: 13 },
            { value: 'cancelled', weight: 8 },
            { value: 'rescheduled', weight: 14 },
            { value: 'confirmed', weight: 6 },
            { value: 'scheduled', weight: 5 },
          ]
          : isToday
            ? [
              { value: 'scheduled', weight: 44 },
              { value: 'confirmed', weight: 24 },
              { value: 'rescheduled', weight: 16 },
              { value: 'attended', weight: 10 },
              { value: 'cancelled', weight: 6 },
            ]
            : [
              { value: 'scheduled', weight: 49 },
              { value: 'confirmed', weight: 28 },
              { value: 'rescheduled', weight: 15 },
              { value: 'cancelled', weight: 8 },
            ],
      );
      const createdAt = addDays(day, -randomInt(1, inPast ? 21 : 35));
      const normalizedCreatedAt = createdAt > day ? addDays(day, -1) : createdAt;
      const isAttended = status === 'attended';
      const isConfirmed = status === 'confirmed' || status === 'rescheduled' || isAttended;

      appointments.push({
        infant_id: appointmentInfantIdsByControlNumber.get(child.controlNumber),
        patient_id: child.patientId,
        guardian_id: guardianIdsBySequence.get(child.sequence),
        scheduled_date: scheduledDateKey,
        type: 'Vaccination',
        status,
        notes: `${MARKER} weekday vaccination appointment for ${nextVisit.code}`,
        cancellation_reason: status === 'cancelled' ? 'Guardian requested a date change.' : null,
        completion_notes: isAttended ? `${MARKER} weekday vaccination visit completed` : null,
        duration_minutes: 35,
        created_by: pick(staffUsers).id,
        clinic_id: scopeIds.clinicId,
        facility_id: scopeIds.facilityId,
        is_active: true,
        created_at: normalizedCreatedAt,
        updated_at: isAttended ? day : normalizedCreatedAt,
        location: 'San Nicolas Health Center Vaccination Room',
        confirmation_status: isConfirmed ? 'confirmed' : 'pending',
        confirmed_at: isConfirmed ? addDays(day, -1) : null,
        confirmation_method: weightedPick([
          { value: 'sms', weight: 51 },
          { value: 'portal', weight: 29 },
          { value: 'sms+portal', weight: 20 },
        ]),
        sms_confirmation_sent: true,
        sms_confirmation_sent_at: addDays(day, -2),
        control_number: buildAppointmentControlNumber(sequence),
        reminder_sent_24h: chance(0.82),
        reminder_sent_48h: chance(0.47),
        sms_missed_notification_sent: status === 'no-show' ? chance(0.5) : false,
      });

      sequence += 1;
      dayCount -= 1;
    }
  });

  if (visitAppointmentSeeds.length > WINDOW_OPERATIONAL_VACCINATION_CAPACITY) {
    console.warn(
      `[${MARKER}] Historical visit seeds (${visitAppointmentSeeds.length}) exceed operational appointment capacity (${WINDOW_OPERATIONAL_VACCINATION_CAPACITY}); synthetic appointment output is generated from the operational-day allocator instead of mirroring every completed visit.`,
    );
  }

  if (appointments.length !== TRANSACTION_TARGETS.appointments) {
    throw new Error(`Expected ${TRANSACTION_TARGETS.appointments} appointments, generated ${appointments.length}`);
  }

  return appointments;
};

const createNotifications = ({ days, children, guardianUsersByGuardianId, guardianIdsBySequence, staffUsers }) => {
  const counts = distributeByDay(TRANSACTION_TARGETS.notifications, days, { minPerDay: 1, category: 'notifications' });
  const notifications = [];
  let childCursor = 0;
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    for (let count = 0; count < counts[dayIndex]; count += 1) {
      const day = days[dayIndex];
      const child = children[childCursor % children.length];
      childCursor += 1;
      const guardianId = guardianIdsBySequence.get(child.sequence);
      const guardianUser = guardianUsersByGuardianId.get(guardianId);
      const notificationType = weightedPick([
        { value: 'appointment_reminder', weight: 40 },
        { value: 'vaccination_due', weight: 32 },
        { value: 'system_alert', weight: 18 },
        { value: 'inventory_alert', weight: 10 },
      ]);
      const channel = weightedPick([
        { value: 'sms', weight: 35 },
        { value: 'push', weight: 30 },
        { value: 'both', weight: 35 },
      ]);
      const status = weightedPick([
        { value: 'queued', weight: 14 },
        { value: 'sent', weight: 26 },
        { value: 'delivered', weight: 34 },
        { value: 'read', weight: 22 },
        { value: 'failed', weight: 4 },
      ]);
      const isGuardianNotification = notificationType !== 'inventory_alert' || chance(0.8);
      const staff = pick(staffUsers);
      notifications.push({
        notification_type: notificationType,
        target_type: isGuardianNotification ? 'guardian' : 'user',
        target_id: isGuardianNotification ? guardianId : staff.id,
        recipient_name: isGuardianNotification ? `${child.firstName} ${child.lastName}` : `${staff.first_name} ${staff.last_name}`,
        recipient_email: isGuardianNotification ? guardianUser?.email || null : staff.email,
        recipient_phone: isGuardianNotification ? guardianUser?.contact || null : staff.contact,
        channel,
        priority: notificationType === 'inventory_alert' ? 'high' : 'normal',
        status,
        scheduled_for: day,
        sent_at: ['sent', 'delivered', 'read', 'failed'].includes(status) ? day : null,
        delivered_at: ['delivered', 'read'].includes(status) ? day : null,
        read_at: status === 'read' ? day : null,
        failed_at: status === 'failed' ? day : null,
        failure_reason: status === 'failed' ? 'Synthetic provider retry queued' : null,
        retry_count: 0,
        max_retries: 2,
        subject: `${MARKER} ${notificationType.replace(/_/g, ' ')}`,
        message:
          notificationType === 'inventory_alert'
            ? `${MARKER} Inventory alert for ${child.firstName}.`
            : `${MARKER} Reminder for ${child.firstName} ${child.lastName}.`,
        template_data: safeJson({ childControlNumber: child.controlNumber }),
        related_entity_type: notificationType === 'inventory_alert' ? 'inventory' : 'appointments',
        related_entity_id: null,
        provider_response: safeJson({ synthetic: true }),
        delivery_status: safeJson({ visible: true }),
        language: 'en-PH',
        timezone: 'Asia/Manila',
        requires_response: false,
        tags: safeJson(['platform-expansion']),
        metadata: safeJson({ marker: MARKER }),
        created_by: staff.id,
        created_at: day,
        updated_at: day,
        user_id: isGuardianNotification ? guardianUser?.id || null : staff.id,
        guardian_id: isGuardianNotification ? guardianId : null,
        target_role: isGuardianNotification ? 'guardian' : 'admin',
        title: `${MARKER} ${notificationType}`,
        is_read: status === 'read',
        action_url: isGuardianNotification ? '/guardian/appointments' : '/inventory',
      });
    }
  }
  return notifications;
};

const createReports = (days, staffUsers) => {
  const counts = distributeByDay(TRANSACTION_TARGETS.reports, days, { minPerDay: 1, category: 'reports' });
  const reports = [];
  let sequence = 1;
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    for (let count = 0; count < counts[dayIndex]; count += 1) {
      const type = weightedPick([
        { value: 'inventory', weight: 34 },
        { value: 'vaccination', weight: 28 },
        { value: 'appointment', weight: 18 },
        { value: 'guardian', weight: 10 },
        { value: 'infant', weight: 10 },
      ]);
      reports.push({
        type,
        title: `${MARKER} ${type} report ${sequence}`,
        description: `${MARKER} autogenerated ${type} report`,
        parameters: safeJson({ reportDate: toIsoDate(day), marker: MARKER }),
        file_path: `/reports/${MARKER.toLowerCase()}-${type}-${sequence}.pdf`,
        file_format: 'pdf',
        status: 'completed',
        generated_by: pick(staffUsers).id,
        date_generated: day,
        expires_at: addMonths(day, 12),
        download_count: randomInt(0, 12),
        error_message: null,
        is_active: true,
        created_at: day,
        updated_at: day,
        file_size: randomInt(90000, 550000),
      });
      sequence += 1;
    }
  }
  return reports;
};

const createTransferCases = (days, children, guardianIdsBySequence, patientIdsByControlNumber, staffUsers) => {
  const counts = distributeByDay(TRANSACTION_TARGETS.transfer_in_cases, days, { minPerDay: 1, category: 'transfer-in cases' });
  const rows = [];
  let childCursor = 0;
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    for (let count = 0; count < counts[dayIndex]; count += 1) {
      const child = children[childCursor % children.length];
      childCursor += 1;
      rows.push({
        guardian_id: guardianIdsBySequence.get(child.sequence),
        infant_id: patientIdsByControlNumber.get(child.controlNumber),
        patient_id: patientIdsByControlNumber.get(child.controlNumber),
        source_facility: 'Transferred from another Pasig vaccination facility',
        submitted_vaccines: safeJson([{ code: 'BCG', dose: 1 }]),
        vaccination_card_url: `/uploads/transfer/${child.controlNumber}.jpg`,
        remarks: `${MARKER} historical transfer reconciliation`,
        next_recommended_vaccine: 'PENTA',
        auto_computed_next_vaccine: 'PENTA',
        validation_status: 'approved',
        validation_notes: 'Synthetic transfer validated',
        validation_priority: 'normal',
        triage_category: 'ready_for_scheduling',
        auto_approved: true,
        created_at: day,
        updated_at: day,
        validated_at: addDays(day, 1),
        validated_by: pick(staffUsers).id,
      });
    }
  }
  return rows;
};

const createDocumentGenerations = (days, children, patientIdsByControlNumber, guardianIdsBySequence, paperTemplates, staffUsers) => {
  const counts = distributeByDay(TRANSACTION_TARGETS.document_generation, days, { minPerDay: 1, category: 'document generation' });
  const generations = [];
  let childCursor = 0;
  let sequence = 1;
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    for (let count = 0; count < counts[dayIndex]; count += 1) {
      const child = children[childCursor % children.length];
      childCursor += 1;
      const template = paperTemplates[(sequence - 1) % paperTemplates.length];
      generations.push({
        template_id: template.id,
        patient_id: patientIdsByControlNumber.get(child.controlNumber),
        guardian_id: guardianIdsBySequence.get(child.sequence),
        generated_by: pick(staffUsers).id,
        file_path: `/documents/${MARKER.toLowerCase()}-${sequence}.pdf`,
        file_name: `${MARKER.toLowerCase()}-${sequence}.pdf`,
        file_size: randomInt(85000, 320000),
        mime_type: 'application/pdf',
        status: 'generated',
        generated_data: safeJson({ childControlNumber: child.controlNumber }),
        digital_signature: null,
        signature_timestamp: null,
        download_count: randomInt(0, 5),
        last_downloaded: chance(0.48) ? day : null,
        expires_at: addMonths(day, 12),
        created_at: day,
        updated_at: day,
      });
      sequence += 1;
    }
  }
  return generations;
};

const createDocumentGenerationLogs = (days, children, patientIdsByControlNumber, paperTemplates, staffUsers) => {
  const counts = distributeByDay(TRANSACTION_TARGETS.document_generation_logs, days, { minPerDay: 1, category: 'document generation logs' });
  const rows = [];
  let childCursor = 0;
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    for (let count = 0; count < counts[dayIndex]; count += 1) {
      const child = children[childCursor % children.length];
      childCursor += 1;
      const template = paperTemplates[(childCursor - 1) % paperTemplates.length];
      rows.push({
        template_id: template.id,
        patient_id: patientIdsByControlNumber.get(child.controlNumber),
        admin_id: pick(staffUsers).id,
        generation_type: template.template_type,
        generation_date: day,
        status: 'SUCCESS',
        error_message: null,
        generated_files: safeJson([`${child.controlNumber}.pdf`]),
        processing_time: randomInt(180, 2500),
        data_source: safeJson({ marker: MARKER }),
      });
    }
  }
  return rows;
};

const createDocumentDownloads = (days, children, patientIdsByControlNumber, paperTemplates, staffUsers) => {
  const counts = distributeByDay(TRANSACTION_TARGETS.document_downloads, days, { minPerDay: 1, category: 'document downloads' });
  const rows = [];
  let childCursor = 0;
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    for (let count = 0; count < counts[dayIndex]; count += 1) {
      const child = children[childCursor % children.length];
      childCursor += 1;
      const template = paperTemplates[(childCursor - 1) % paperTemplates.length];
      rows.push({
        template_id: template.id,
        infant_id: patientIdsByControlNumber.get(child.controlNumber),
        patient_id: patientIdsByControlNumber.get(child.controlNumber),
        user_id: pick(staffUsers).id,
        admin_id: pick(staffUsers).id,
        download_date: day,
        download_status: 'COMPLETED',
        created_at: day,
        download_type: 'PDF',
        file_path: `/documents/downloads/${child.controlNumber}-${template.template_type}.pdf`,
        file_size: randomInt(64000, 280000),
      });
    }
  }
  return rows;
};

const createGuardianSessions = (days, guardianUsers, scopeIds) => {
  const counts = distributeByDay(SESSION_TARGET, days, { minPerDay: 1, category: 'guardian sessions' });
  const sessions = [];
  let userCursor = 0;
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const day = days[dayIndex];
    for (let count = 0; count < counts[dayIndex]; count += 1) {
      const user = guardianUsers[userCursor % guardianUsers.length];
      userCursor += 1;
      const loginTime = new Date(`${toIsoDate(day)}T0${randomInt(6, 9)}:${String(randomInt(0, 59)).padStart(2, '0')}:00.000Z`);
      const logoutTime = addDays(loginTime, 0);
      sessions.push({
        user_id: user.id,
        session_token: crypto.randomUUID(),
        ip_address: `203.177.${randomInt(1, 254)}.${randomInt(1, 254)}`,
        user_agent: chance(0.64) ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' : 'Mozilla/5.0 (Linux; Android 13)',
        device_info: safeJson({ device: chance(0.6) ? 'desktop' : 'mobile' }),
        location_info: safeJson({ city: DEMO_CITY, region: DEMO_REGION }),
        login_time: loginTime,
        logout_time: logoutTime,
        last_activity: logoutTime,
        session_duration: randomInt(240, 4800),
        is_active: false,
        login_method: 'password',
        impersonated_by: null,
        security_events: safeJson([]),
        metadata: safeJson({ marker: MARKER, clinic_id: scopeIds.guardianPortalClinicId }),
        created_at: loginTime,
        updated_at: loginTime,
        expires_at: addDays(loginTime, 7),
      });
    }
  }
  return sessions;
};

const ensureNoMarkerCollision = async (client, columnsMap) => {
  const checks = [
    columnsMap.get('patients')?.has('control_number')
      ? client.query(`SELECT COUNT(*)::int AS count FROM patients WHERE control_number LIKE $1`, [`${MARKER}-%`])
      : Promise.resolve({ rows: [{ count: 0 }] }),
    columnsMap.get('users')?.has('username')
      ? client.query(`SELECT COUNT(*)::int AS count FROM users WHERE username LIKE $1`, [`${MARKER.toLowerCase()}%`])
      : Promise.resolve({ rows: [{ count: 0 }] }),
    columnsMap.get('guardians')?.has('email')
      ? client.query(`SELECT COUNT(*)::int AS count FROM guardians WHERE email LIKE $1`, [`${MARKER.toLowerCase()}%`])
      : Promise.resolve({ rows: [{ count: 0 }] }),
  ];

  const results = await Promise.all(checks);
  const existingCount = results.reduce((sum, result) => sum + Number(result.rows[0].count || 0), 0);
  if (existingCount > 0) {
    throw new Error(`Marker ${MARKER} already exists in the database. Aborting additive expansion to avoid duplicates.`);
  }
};

async function expandImmunicarePlatformData() {
  const client = await db.connect();
  let inTransaction = false;

  try {
    console.log('='.repeat(72));
    console.log('IMMUNICARE PLATFORM EXPANSION');
    console.log('='.repeat(72));
    console.log(`Marker: ${MARKER}`);
    console.log(`Target infants: ${TARGET_INFANTS}`);
    console.log(`Target transactions: ${TARGET_TRANSACTIONS}`);
    console.log(`Window: ${toIsoDate(WINDOW_START)} to ${toIsoDate(WINDOW_END)}`);

    const tables = await existingTableSet(client);
    await ensureSyntheticSupportTables(client, tables);
    const columnsMap = await tableColumnsMap(client, tables);
    await ensureNoMarkerCollision(client, columnsMap);

    const referenceData = await fetchReferenceData(client);
    const scopeIds = resolveScopeIds(referenceData);
    const staffUsers = chooseStaffUsers(referenceData);
    const guardianRoleId = referenceData.rolesByName.get('guardian') || null;

    const { families, children } = buildFamiliesAndChildren(scopeIds);
    const guardianPasswordHash = await bcrypt.hash(DEFAULT_GUARDIAN_PASSWORD, 10);

    await client.query('BEGIN');
    inTransaction = true;
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query('SET LOCAL lock_timeout = 0');

    const insertedGuardians = await insertObjectRows(client, 'guardians', columnsMap, buildGuardianObjects(families), { returningColumns: ['id', 'email'], chunkSize: 1000 });
    const guardianIdsBySequence = new Map(families.map((family, index) => [family.sequence, insertedGuardians[index].id]));
    const insertedGuardianUsers = await insertObjectRows(client, 'users', columnsMap, buildGuardianUserObjects(families, guardianIdsBySequence, guardianRoleId, scopeIds, guardianPasswordHash), { returningColumns: ['id', 'guardian_id', 'email', 'username'], chunkSize: 1000 });
    const guardianUsersByGuardianId = new Map(insertedGuardianUsers.map((row) => [row.guardian_id, row]));
    const insertedPatients = await insertObjectRows(client, 'patients', columnsMap, buildPatientObjects(children, guardianIdsBySequence), { returningColumns: ['id', 'control_number'], chunkSize: 1000 });
    const patientIdsByControlNumber = new Map(insertedPatients.map((row) => [row.control_number, row.id]));
    children.forEach((child) => { child.patientId = patientIdsByControlNumber.get(child.controlNumber); });

    let infantIdsByControlNumber = new Map();
    if (tables.has('infants')) {
      const insertedInfants = await insertObjectRows(client, 'infants', columnsMap, buildInfantObjects(children), { returningColumns: ['id', 'patient_control_number'], chunkSize: 1000 });
      infantIdsByControlNumber = new Map(insertedInfants.map((row) => [row.patient_control_number, row.id]));
      children.forEach((child) => { child.infantId = infantIdsByControlNumber.get(child.controlNumber); });
    }
    if (tables.has('parent_guardian') && infantIdsByControlNumber.size) {
      await insertObjectRows(client, 'parent_guardian', columnsMap, buildParentGuardianObjects(children, guardianUsersByGuardianId, guardianIdsBySequence, infantIdsByControlNumber, guardianPasswordHash), { chunkSize: 1000 });
    }

    const { batchRows, batchIdByCodeAndMonth } = createBatchRows(referenceData, scopeIds);
    if (tables.has('vaccine_batches')) {
      const insertedBatchRows = await insertObjectRows(client, 'vaccine_batches', columnsMap, batchRows, { returningColumns: ['id', 'vaccine_id', 'lot_no', 'lot_number', 'expiry_date', 'created_at', 'period_start'], chunkSize: 1000 });
      const batchMap = new Map();
      insertedBatchRows.forEach((row) => {
        const vaccine = referenceData.vaccines.find((entry) => entry.id === row.vaccine_id);
        if (vaccine) {
          const periodSource = row.period_start || row.created_at;
          batchMap.set(`${vaccine.code}:${monthKey(startOfMonth(new Date(periodSource)))}`, { id: row.id, lotNo: row.lot_no || row.lot_number, expiry_date: row.expiry_date });
        }
      });
      batchIdByCodeAndMonth.clear();
      batchMap.forEach((value, key) => batchIdByCodeAndMonth.set(key, value));
    }

    const { immunizationRows, legacyVaccinationRows, visitAppointmentSeeds, completionIndexByChild } = generateImmunizationData({ children, patientIdsByControlNumber, infantIdsByControlNumber, referenceData, staffUsers, batchIdByCodeAndMonth });
    await insertObjectRows(client, 'immunization_records', columnsMap, immunizationRows, { chunkSize: 1000 });
    if (tables.has('vaccination_records')) {
      await insertObjectRows(client, 'vaccination_records', columnsMap, legacyVaccinationRows, { chunkSize: 1000 });
    }

    const days = dailySeries(WINDOW_START, WINDOW_END);
    const appointmentInfantTargetTable = await resolveAppointmentInfantTargetTable(client);
    const appointmentInfantIdsByControlNumber =
      appointmentInfantTargetTable === 'patients' || !infantIdsByControlNumber.size
        ? patientIdsByControlNumber
        : infantIdsByControlNumber;

    const appointments = createAppointments({ children, appointmentInfantIdsByControlNumber, guardianIdsBySequence, visitAppointmentSeeds, completionIndexByChild, staffUsers, scopeIds });
    await insertObjectRows(client, 'appointments', columnsMap, appointments, { returningColumns: ['id', 'guardian_id', 'control_number'], chunkSize: 1000 });
    if (tables.has('transfer_in_cases')) {
      await insertObjectRows(client, 'transfer_in_cases', columnsMap, createTransferCases(days, children, guardianIdsBySequence, patientIdsByControlNumber, staffUsers), { chunkSize: 1000 });
    }

    const usageByMonth = aggregateImmunizationUsageByMonth(immunizationRows, referenceData);
    const { inventoryRows, inventoryMeta } = createInventoryData({ referenceData, scopeIds, staffUsers, usageByMonth, batchLookup: batchIdByCodeAndMonth });
    let insertedInventoryRows = [];
    if (tables.has('vaccine_inventory')) {
      insertedInventoryRows = await insertObjectRows(client, 'vaccine_inventory', columnsMap, inventoryRows, { returningColumns: ['id', 'vaccine_id', 'period_start'], chunkSize: 1000 });
    }
    if (tables.has('vaccine_inventory_transactions') && insertedInventoryRows.length) {
      await insertObjectRows(client, 'vaccine_inventory_transactions', columnsMap, createInventoryTransactions({ inventoryMeta, insertedInventoryRows, staffUsers, scopeIds }), { chunkSize: 1000 });
    }

    await insertObjectRows(client, 'notifications', columnsMap, createNotifications({ days, children, guardianUsersByGuardianId, guardianIdsBySequence, staffUsers }), { chunkSize: 1000 });
    await insertObjectRows(client, 'reports', columnsMap, createReports(days, staffUsers), { chunkSize: 1000 });

    const paperTemplates = await createPaperTemplatesIfNeeded(client, columnsMap, staffUsers);
    if (tables.has('document_generation') && paperTemplates.length) {
      const generations = createDocumentGenerations(days, children, patientIdsByControlNumber, guardianIdsBySequence, paperTemplates, staffUsers);
      const insertedDocumentGenerations = await insertObjectRows(client, 'document_generation', columnsMap, generations, { returningColumns: ['id', 'template_id', 'patient_id', 'guardian_id', 'created_at'], chunkSize: 1000 });
      if (tables.has('digital_papers')) {
        const digitalPaperRows = insertedDocumentGenerations.map((row, index) => ({
          document_generation_id: row.id,
          title: `${MARKER} digital paper ${index + 1}`,
          document_type: paperTemplates[index % paperTemplates.length].template_type,
          content: `${MARKER} autogenerated digital content`,
          metadata: safeJson({ marker: MARKER }),
          created_at: row.created_at,
          updated_at: row.created_at,
        }));
        await insertObjectRows(client, 'digital_papers', columnsMap, digitalPaperRows, { chunkSize: 1000 });
      }
    }
    if (tables.has('document_generation_logs') && paperTemplates.length) {
      await insertObjectRows(client, 'document_generation_logs', columnsMap, createDocumentGenerationLogs(days, children, patientIdsByControlNumber, paperTemplates, staffUsers), { chunkSize: 1000 });
    }
    if (tables.has('document_downloads') && paperTemplates.length) {
      await insertObjectRows(client, 'document_downloads', columnsMap, createDocumentDownloads(days, children, patientIdsByControlNumber, paperTemplates, staffUsers), { chunkSize: 1000 });
    }
    if (tables.has('user_sessions')) {
      await insertObjectRows(client, 'user_sessions', columnsMap, createGuardianSessions(days, insertedGuardianUsers, scopeIds), { chunkSize: 1000 });
    }

    await client.query('COMMIT');
    inTransaction = false;

    console.log('='.repeat(72));
    console.log('PLATFORM EXPANSION COMPLETE');
    console.log('='.repeat(72));
    console.log(`Guardians added: ${insertedGuardians.length}`);
    console.log(`Guardian users added: ${insertedGuardianUsers.length}`);
    console.log(`Patients added: ${insertedPatients.length}`);
    console.log(`Transactions generated: ${TARGET_TRANSACTIONS}`);
    console.log(`Marker: ${MARKER}`);
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    console.error('\nPLATFORM EXPANSION FAILED');
    console.error(error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

module.exports = {
  createAppointments,
  distributeByWeekdayCapacity,
  generateImmunizationData,
  expandImmunicarePlatformData,
  TRANSACTION_TARGETS,
  TARGET_INFANTS,
  TARGET_TRANSACTIONS,
  WINDOW_START,
  WINDOW_END,
  rollForwardToWeekday,
  weekdaySeries,
  MARKER,
};

if (require.main === module) {
  expandImmunicarePlatformData()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
