require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const {
  MAX_VACCINATION_APPOINTMENTS_PER_DAY,
} = require('./utils/clinicCalendar');

process.env.DB_QUERY_TIMEOUT = '0';
process.env.DB_STATEMENT_TIMEOUT = '0';

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
  ANNOUNCEMENT_TEMPLATES,
  MESSAGE_SUBJECTS,
  MESSAGE_BODIES,
} = require('./demo_dataset_catalog');

const DEMO_MARKER = 'DEMO30';
const RNG_SEED = 20260326;
const INFANT_TARGET = 5000;
const MIN_TOTAL_TRANSACTIONS = 100000;
const CURRENT_DATE = new Date('2026-03-26T00:00:00.000Z');
const WINDOW_START = new Date('2026-03-01T00:00:00.000Z');
const WINDOW_END = new Date('2030-12-31T23:59:59.999Z');
const OPERATIONAL_ACTIVE_DAYS_PER_YEAR = 243;
const OPERATIONAL_HISTORY_START = new Date('2024-01-01T00:00:00.000Z');
const DEFAULT_GUARDIAN_PASSWORD = 'GuardianDemo2026!';
const DEFAULT_STAFF_PASSWORD = 'AdminDemo2026!';
const DEFAULT_HEALTH_CENTER = 'SAN NICOLAS HC';
const DEFAULT_CLINIC_LABEL = 'San Nicolas Health Center';
const DEFAULT_CITY = 'Pasig City';
const DEFAULT_REGION = 'NCR';
const DEFAULT_POSTAL_CODE = '1600';

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
const chance = (probability) => rand() < probability;
const randomInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const randomFloat = (min, max, decimals = 2) =>
  Number((min + (max - min) * rand()).toFixed(decimals));
const pick = (items) => items[randomInt(0, items.length - 1)];
const sample = (items, size) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy.slice(0, size);
};
const weightedPick = (choices) => {
  const totalWeight = choices.reduce((sum, choice) => sum + choice.weight, 0);
  const cursor = rand() * totalWeight;
  let cumulative = 0;
  for (const choice of choices) {
    cumulative += choice.weight;
    if (cursor <= cumulative) {
      return choice.value;
    }
  }
  return choices[choices.length - 1].value;
};

const slugify = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/(^\.|\.$)/g, '')
    .replace(/\.{2,}/g, '.');

const cloneDate = (value) => new Date(value.getTime());
const toIsoDate = (value) => cloneDate(value).toISOString().slice(0, 10);
const atNoonUtc = (value) => new Date(`${value}T12:00:00.000Z`);
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
const clampDate = (value, min, max) => {
  if (value < min) return cloneDate(min);
  if (value > max) return cloneDate(max);
  return cloneDate(value);
};
const randomDateBetween = (start, end) => {
  const startMs = start.getTime();
  const endMs = end.getTime();
  return new Date(startMs + Math.floor(rand() * (endMs - startMs + 1)));
};
const startOfMonth = (value) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
const endOfMonth = (value) =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0, 23, 59, 59, 999));
const monthKey = (value) => `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
const monthName = (value) =>
  cloneDate(value).toLocaleString('en-PH', { month: 'long', timeZone: 'Asia/Manila' });
const dateDifferenceInDays = (a, b) => Math.round((a.getTime() - b.getTime()) / 86400000);
const formatMobile = () => `+639${String(randomInt(10, 99))}${String(randomInt(0, 9999999)).padStart(7, '0')}`;
const formatLandline = () => `(02) ${String(randomInt(8000, 8999))}-${String(randomInt(1000, 9999))}`;
const safeJson = (value) => JSON.stringify(value || {});

const monthSeries = (start, end) => {
  const values = [];
  let cursor = startOfMonth(start);
  while (cursor <= end) {
    values.push(cloneDate(cursor));
    cursor = addMonths(cursor, 1);
  }
  return values;
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
    category = 'operational schedule',
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

const buildAddress = (barangay) => {
  const block = randomInt(1, 25);
  const lot = randomInt(1, 30);
  const subdivision = chance(0.55) ? `${pick(SUBDIVISIONS)}, ` : '';
  const street = `${pick(STREET_NAMES)} St.`;
  return `Blk ${block} Lot ${lot}, ${subdivision}${street}, Barangay ${barangay}, ${DEFAULT_CITY}, ${DEFAULT_REGION} ${DEFAULT_POSTAL_CODE}`;
};

const buildHouseholdGuardian = () => {
  const primaryRelationship = weightedPick([
    { value: 'Mother', weight: 68 },
    { value: 'Father', weight: 18 },
    { value: 'Grandmother', weight: 8 },
    { value: 'Aunt', weight: 4 },
    { value: 'Guardian', weight: 2 },
  ]);

  const isFemale = primaryRelationship !== 'Father';
  const firstName = pick(isFemale ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
  const middleName = pick(MIDDLE_NAMES);
  const lastName = pick(LAST_NAMES);
  const barangay = pick(PASIG_BARANGAYS);

  return {
    firstName,
    middleName,
    lastName,
    relationship: primaryRelationship,
    barangay,
    address: buildAddress(barangay),
    phone: formatMobile(),
    alternatePhone: formatMobile(),
    emergencyPhone: formatMobile(),
    emergencyContact: `${pick(FEMALE_FIRST_NAMES)} ${lastName}`,
  };
};

const buildGuardianEmail = (guardian, sequence) =>
  `${slugify(`${guardian.firstName}.${guardian.lastName}`)}.${String(sequence).padStart(4, '0')}@demo-immunicare.ph`;
const buildGuardianUsername = (sequence) => `demo.guardian.${String(sequence).padStart(4, '0')}`;
const buildInfantControlNumber = (sequence) => `${DEMO_MARKER}-INF-${String(sequence).padStart(6, '0')}`;
const buildAppointmentControlNumber = (sequence) =>
  `${DEMO_MARKER}-APT-${String(sequence).padStart(7, '0')}`;
const buildBatchNumber = (code, period, sequence) =>
  `${DEMO_MARKER}-${code.replace(/[^A-Z0-9]/gi, '')}-${monthKey(period).replace('-', '')}-${String(sequence).padStart(3, '0')}`;
const buildReferenceNumber = (prefix, sequence) =>
  `${DEMO_MARKER}-${prefix}-${String(sequence).padStart(7, '0')}`;

const infantDobBucket = () =>
  weightedPick([
    { value: [atNoonUtc('2025-12-01'), atNoonUtc('2026-03-20')], weight: 24 },
    { value: [atNoonUtc('2025-07-01'), atNoonUtc('2025-11-30')], weight: 28 },
    { value: [atNoonUtc('2024-09-01'), atNoonUtc('2025-06-30')], weight: 30 },
    { value: [atNoonUtc('2024-01-01'), atNoonUtc('2024-08-31')], weight: 18 },
  ]);

const randomDob = () => {
  const [start, end] = infantDobBucket();
  return randomDateBetween(start, end);
};

const inferParentGuardianRelationshipType = (relationship) => {
  if (['Mother', 'Father'].includes(relationship)) {
    return 'parent';
  }

  if (relationship === 'Guardian') {
    return 'guardian';
  }

  return 'guardian';
};

const vaccineDemandBaseline = {
  BCG: { received: [90, 180], issuance: [55, 125], threshold: { low: 40, critical: 18 } },
  'BCG-DIL': { received: [90, 180], issuance: [55, 125], threshold: { low: 40, critical: 18 } },
  'HEP-B': { received: [170, 340], issuance: [120, 250], threshold: { low: 60, critical: 24 } },
  PENTA: { received: [180, 360], issuance: [130, 280], threshold: { low: 70, critical: 28 } },
  'OPV-20': { received: [160, 320], issuance: [110, 250], threshold: { low: 65, critical: 24 } },
  'PCV-13-10': { received: [150, 300], issuance: [95, 220], threshold: { low: 55, critical: 20 } },
  MMR: { received: [95, 190], issuance: [55, 120], threshold: { low: 40, critical: 15 } },
  'MMR-DIL': { received: [95, 190], issuance: [55, 120], threshold: { low: 40, critical: 15 } },
  'IPV-MULTI': { received: [85, 160], issuance: [40, 95], threshold: { low: 30, critical: 12 } },
};

const visitTemplates = [
  { code: 'BIRTH', ageMonths: 0, vaccines: [{ code: 'BCG', dose: 1 }, { code: 'HEP-B', dose: 1 }] },
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
  {
    code: 'VISIT_3M',
    ageMonths: 3,
    vaccines: [
      { code: 'PENTA', dose: 3 },
      { code: 'OPV-20', dose: 3 },
      { code: 'PCV-13-10', dose: 3 },
      { code: 'IPV-MULTI', dose: 1 },
    ],
  },
  { code: 'VISIT_6M', ageMonths: 6, vaccines: [{ code: 'HEP-B', dose: 3 }] },
  { code: 'VISIT_9M', ageMonths: 9, vaccines: [{ code: 'MMR', dose: 1 }] },
  { code: 'VISIT_18M', ageMonths: 18, vaccines: [{ code: 'IPV-MULTI', dose: 2 }] },
];

const buildInsertQuery = (tableName, columns, rows, returningColumns = []) => {
  const params = [];
  const valueGroups = rows.map((row, rowIndex) => {
    const placeholders = columns.map((_column, columnIndex) => {
      params.push(row[columnIndex] === undefined ? null : row[columnIndex]);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const returningClause = returningColumns.length > 0 ? ` RETURNING ${returningColumns.join(', ')}` : '';

  return {
    text: `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${valueGroups.join(', ')}${returningClause}`,
    values: params,
  };
};

const chunkArray = (items, chunkSize) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const insertRows = async (client, tableName, columns, rows, options = {}) => {
  const { chunkSize = 250, returningColumns = [] } = options;
  if (!rows.length) {
    return [];
  }

  const results = [];
  for (const chunk of chunkArray(rows, chunkSize)) {
    const query = buildInsertQuery(tableName, columns, chunk, returningColumns);
    const response = await client.query(query.text, query.values);
    if (returningColumns.length > 0) {
      results.push(...response.rows);
    }
  }
  return results;
};

const updateInfantGuardianLinks = async (client, updates) => {
  if (!updates.length) {
    return;
  }

  for (const chunk of chunkArray(updates, 300)) {
    const values = [];
    const tupleSql = chunk
      .map((entry, index) => {
        const base = index * 2;
        values.push(entry.infantId, entry.parentGuardianId);
        return `($${base + 1}::int, $${base + 2}::int)`;
      })
      .join(', ');

    await client.query(
      `
        UPDATE infants AS i
        SET guardian_id = links.parent_guardian_id,
            updated_at = CURRENT_TIMESTAMP
        FROM (
          VALUES ${tupleSql}
        ) AS links(infant_id, parent_guardian_id)
        WHERE i.id = links.infant_id
      `,
      values,
    );
  }
};

const existingTableSet = async (client) => {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);

  return new Set(result.rows.map((row) => row.table_name));
};

const truncateExistingTables = async (client, tables, availableTables) => {
  const actualTables = tables.filter((tableName) => availableTables.has(tableName));
  if (!actualTables.length) {
    return;
  }

  await client.query(`TRUNCATE TABLE ${actualTables.join(', ')} RESTART IDENTITY CASCADE`);
};

const deleteMatchingRowsInBatches = async (client, tableName, predicateSql, options = {}) => {
  const { batchSize = 1000, label = tableName } = options;
  let deletedCount = 0;
  let batchNumber = 0;

  while (true) {
    const result = await client.query(
      `
        WITH target_rows AS (
          SELECT id
          FROM ${tableName}
          WHERE ${predicateSql}
          ORDER BY id
          LIMIT $1
        )
        DELETE FROM ${tableName}
        WHERE id IN (SELECT id FROM target_rows)
        RETURNING id
      `,
      [batchSize],
    );

    deletedCount += result.rowCount;
    batchNumber += 1;
    if (result.rowCount > 0) {
      console.log(`  ${label}: deleted batch ${batchNumber} (${result.rowCount} rows)`);
    }
    if (result.rowCount === 0) {
      break;
    }
  }

  return deletedCount;
};

const fetchReferenceData = async (client) => {
  const [rolesResult, clinicsResult, vaccinesResult, scheduleResult, suppliersResult] = await Promise.all([
    client.query(`SELECT id, name FROM roles`),
    client.query(`SELECT id, name FROM clinics`),
    client.query(`
      SELECT id, code, name, manufacturer
      FROM vaccines
      WHERE is_active = true
        AND code !~ '^SYNPH26-'
    `),
    client.query(`
      SELECT id, vaccine_id, vaccine_name, vaccine_code, dose_number, age_in_months, target_age_months
      FROM vaccination_schedules
      WHERE is_active = true
    `),
    client.query(`
      SELECT id, name, supplier_code
      FROM suppliers
      WHERE is_active = true
        AND COALESCE(supplier_code, '') !~ '^SYNPH26SUP'
      ORDER BY id
    `),
  ]);

  return {
    rolesByName: new Map(rolesResult.rows.map((row) => [row.name, row.id])),
    clinicsByName: new Map(clinicsResult.rows.map((row) => [row.name, row.id])),
    vaccinesByCode: new Map(vaccinesResult.rows.map((row) => [row.code, row])),
    schedulesByKey: new Map(
      scheduleResult.rows.map((row) => [`${row.vaccine_id}:${row.dose_number}`, row]),
    ),
    suppliers: suppliersResult.rows,
  };
};

const generateStaffUsers = async (client, referenceData) => {
  const adminRoleId = referenceData.rolesByName.get('admin') || referenceData.rolesByName.get('system_admin');
  const nurseRoleId = referenceData.rolesByName.get('nurse') || referenceData.rolesByName.get('healthcare_worker');
  const midwifeRoleId = referenceData.rolesByName.get('midwife') || referenceData.rolesByName.get('healthcare_worker');
  const physicianRoleId = referenceData.rolesByName.get('physician') || referenceData.rolesByName.get('healthcare_worker');
  const inventoryRoleId =
    referenceData.rolesByName.get('inventory_manager') || referenceData.rolesByName.get('healthcare_worker');
  const healthWorkerRoleId =
    referenceData.rolesByName.get('health_worker') || referenceData.rolesByName.get('healthcare_worker');
  const clinicId =
    referenceData.clinicsByName.get('San Nicolas Health Center') ||
    referenceData.clinicsByName.get('Main Health Center') ||
    1;

  const passwordHash = await bcrypt.hash(DEFAULT_STAFF_PASSWORD, 10);
  await client.query(`
    DELETE FROM users
    WHERE email LIKE '%@demo-immunicare.ph'
       OR username LIKE 'defense.%'
  `);

  const staffDefinitions = [
    {
      username: 'defense.admin',
      email: 'defense.admin@demo-immunicare.ph',
      roleId: adminRoleId,
      roleName: 'admin',
      firstName: 'Paolo',
      lastName: 'Navarro',
      contact: formatMobile(),
    },
    {
      username: 'defense.inventory',
      email: 'defense.inventory@demo-immunicare.ph',
      roleId: inventoryRoleId,
      roleName: 'inventory_manager',
      firstName: 'Andrea',
      lastName: 'Santos',
      contact: formatMobile(),
    },
    {
      username: 'defense.nurse',
      email: 'defense.nurse@demo-immunicare.ph',
      roleId: nurseRoleId,
      roleName: 'nurse',
      firstName: 'Clarisse',
      lastName: 'Reyes',
      contact: formatMobile(),
    },
    {
      username: 'defense.midwife',
      email: 'defense.midwife@demo-immunicare.ph',
      roleId: midwifeRoleId,
      roleName: 'midwife',
      firstName: 'Mariel',
      lastName: 'Lim',
      contact: formatMobile(),
    },
    {
      username: 'defense.physician',
      email: 'defense.physician@demo-immunicare.ph',
      roleId: physicianRoleId,
      roleName: 'physician',
      firstName: 'Michael',
      lastName: 'Tan',
      contact: formatMobile(),
    },
    {
      username: 'defense.healthworker',
      email: 'defense.healthworker@demo-immunicare.ph',
      roleId: healthWorkerRoleId,
      roleName: 'health_worker',
      firstName: 'Gabriela',
      lastName: 'Cruz',
      contact: formatMobile(),
    },
  ].filter((definition) => Number.isInteger(definition.roleId));

  return insertRows(
    client,
    'users',
    [
      'username',
      'password_hash',
      'role_id',
      'clinic_id',
      'contact',
      'email',
      'last_login',
      'guardian_id',
      'is_active',
      'created_at',
      'updated_at',
      'force_password_change',
      'password',
      'first_name',
      'last_name',
      'role',
    ],
    staffDefinitions.map((definition) => {
      const createdAt = randomDateBetween(WINDOW_START, addDays(WINDOW_START, 10));
      return [
        definition.username,
        passwordHash,
        definition.roleId,
        clinicId,
        definition.contact,
        definition.email,
        randomDateBetween(addDays(WINDOW_START, 2), CURRENT_DATE),
        null,
        true,
        createdAt,
        createdAt,
        false,
        DEFAULT_STAFF_PASSWORD,
        definition.firstName,
        definition.lastName,
        definition.roleName,
      ];
    }),
    { chunkSize: 100, returningColumns: ['id', 'username', 'email', 'role_id', 'first_name', 'last_name'] },
  );
};

const generateFamilies = () => {
  const families = [];
  let totalChildren = 0;
  let familySequence = 1;

  while (totalChildren < INFANT_TARGET) {
    let childCount = weightedPick([
      { value: 1, weight: 68 },
      { value: 2, weight: 25 },
      { value: 3, weight: 7 },
    ]);

    if (totalChildren + childCount > INFANT_TARGET) {
      childCount = INFANT_TARGET - totalChildren;
    }

    const guardian = buildHouseholdGuardian();
    guardian.email = buildGuardianEmail(guardian, familySequence);
    guardian.username = buildGuardianUsername(familySequence);
    guardian.createdAt = randomDateBetween(WINDOW_START, addDays(WINDOW_START, 150));
    guardian.lastLogin = randomDateBetween(addDays(WINDOW_START, 5), CURRENT_DATE);

    families.push({
      sequence: familySequence,
      childCount,
      guardian,
      children: [],
    });

    totalChildren += childCount;
    familySequence += 1;
  }

  return families;
};

const generateChildren = (families, healthCenterClinicId) => {
  const children = [];
  let infantSequence = 1;

  for (const family of families) {
    const guardian = family.guardian;
    for (let childIndex = 0; childIndex < family.childCount; childIndex += 1) {
      const sex = chance(0.51) ? 'M' : 'F';
      const firstName = pick(sex === 'F' ? FEMALE_FIRST_NAMES : MALE_FIRST_NAMES);
      const middleName = pick(MIDDLE_NAMES);
      const dob = randomDob();
      const createdAt = clampDate(
        randomDateBetween(WINDOW_START, addDays(WINDOW_START, 200)),
        addDays(dob, 1),
        addDays(WINDOW_END, -365),
      );

      const child = {
        sequence: infantSequence,
        familySequence: family.sequence,
        guardianFamilySequence: family.sequence,
        controlNumber: buildInfantControlNumber(infantSequence),
        firstName,
        middleName,
        lastName: guardian.lastName,
        sex,
        dob,
        createdAt,
        motherName:
          guardian.relationship === 'Mother'
            ? `${guardian.firstName} ${guardian.middleName} ${guardian.lastName}`
            : `${pick(FEMALE_FIRST_NAMES)} ${pick(MIDDLE_NAMES)} ${guardian.lastName}`,
        fatherName:
          guardian.relationship === 'Father'
            ? `${guardian.firstName} ${guardian.middleName} ${guardian.lastName}`
            : `${pick(MALE_FIRST_NAMES)} ${pick(MIDDLE_NAMES)} ${guardian.lastName}`,
        barangay: guardian.barangay,
        address: guardian.address,
        contact: guardian.phone,
        birthWeight: randomFloat(2.5, 4.1),
        birthHeight: randomFloat(47, 54),
        placeOfBirth: pick(PLACE_OF_BIRTHS),
        familyNo: `${DEMO_MARKER}-FAM-${String(family.sequence).padStart(5, '0')}`,
        healthCenter: DEFAULT_HEALTH_CENTER,
        clinicId: healthCenterClinicId,
        doctorMidwifeNurse: weightedPick([
          { value: 'Nurse Clarisse Reyes', weight: 45 },
          { value: 'Midwife Mariel Lim', weight: 30 },
          { value: 'Dr. Michael Tan', weight: 25 },
        ]),
        typeOfDelivery: weightedPick([
          { value: 'Normal Spontaneous Delivery', weight: 74 },
          { value: 'Cesarean Section', weight: 22 },
          { value: 'Assisted Vaginal Delivery', weight: 4 },
        ]),
        timeOfDelivery: `${String(randomInt(0, 23)).padStart(2, '0')}:${String(randomInt(0, 59)).padStart(2, '0')}:00`,
        nbsDone: chance(0.92),
        validationStatus: weightedPick([
          { value: 'approved', weight: 78 },
          { value: 'for_validation', weight: 14 },
          { value: 'pending', weight: 8 },
        ]),
        transferInSource: chance(0.12) ? 'Transferred from another Pasig vaccination facility' : null,
      };

      child.doctorMidwifeNurseShort =
        child.doctorMidwifeNurse === 'Nurse Clarisse Reyes'
          ? 'Nurse C. Reyes'
          : child.doctorMidwifeNurse === 'Midwife Mariel Lim'
            ? 'Midwife M. Lim'
            : 'Dr. M. Tan';
      child.typeOfDeliveryShort =
        child.typeOfDelivery === 'Normal Spontaneous Delivery'
          ? 'NSD'
          : child.typeOfDelivery === 'Cesarean Section'
            ? 'CS'
            : 'AVD';

      family.children.push(child);
      children.push(child);
      infantSequence += 1;
    }
  }

  return children;
};

const buildPatientRows = (children, guardianIdByFamilySequence) =>
  children.map((child) => [
    `${child.firstName} ${child.lastName}`,
    toIsoDate(child.dob),
    child.sex,
    `${child.motherName} / ${child.fatherName}`,
    child.contact,
    child.address,
    child.createdAt,
    child.createdAt,
    guardianIdByFamilySequence.get(child.guardianFamilySequence),
    child.firstName,
    child.lastName,
    child.middleName,
    toIsoDate(child.dob),
    child.sex,
    `${DEMO_MARKER}-NAT-${String(child.sequence).padStart(8, '0')}`,
    child.contact,
    null,
    child.motherName,
    child.fatherName,
    child.birthWeight,
    child.birthHeight,
    child.placeOfBirth,
    child.barangay,
    child.healthCenter,
    child.familyNo,
    child.timeOfDelivery,
    child.typeOfDelivery,
    child.doctorMidwifeNurse,
    child.nbsDone,
    child.nbsDone ? toIsoDate(addDays(child.dob, 2)) : null,
    child.contact,
    child.clinicId,
    child.controlNumber,
    true,
    chance(0.18) ? 'No known allergy' : null,
    DEFAULT_CLINIC_LABEL,
    child.transferInSource,
    child.validationStatus,
    null,
    Math.max(0, Math.floor(dateDifferenceInDays(CURRENT_DATE, child.dob) / 30.4)),
  ]);

const buildInfantRows = (children) =>
  children.map((child) => [
    child.firstName,
    child.lastName,
    child.middleName,
    toIsoDate(child.dob),
    child.sex,
    `${DEMO_MARKER}-NAT-${String(child.sequence).padStart(8, '0')}`,
    child.address,
    child.contact,
    null,
    child.clinicId,
    child.birthHeight,
    child.birthWeight,
    child.motherName,
    child.fatherName,
    child.barangay,
    child.healthCenter,
    child.familyNo,
    child.placeOfBirth,
    child.timeOfDelivery,
    child.typeOfDeliveryShort,
    child.doctorMidwifeNurseShort,
    child.nbsDone,
    child.nbsDone ? toIsoDate(addDays(child.dob, 2)) : null,
    child.contact,
    true,
    child.createdAt,
    child.createdAt,
    child.controlNumber,
  ]);

const createBatchPlan = (referenceData, clinicId) => {
  const inventoryCodes = ['BCG', 'BCG-DIL', 'HEP-B', 'PENTA', 'OPV-20', 'PCV-13-10', 'MMR', 'MMR-DIL', 'IPV-MULTI']
    .filter((code) => referenceData.vaccinesByCode.has(code));
  const periods = monthSeries(WINDOW_START, WINDOW_END);
  const batches = [];
  let batchSequence = 1;

  for (const code of inventoryCodes) {
    const vaccine = referenceData.vaccinesByCode.get(code);
    const [receiveMin, receiveMax] = vaccineDemandBaseline[code].received;
    let cursor = startOfMonth(WINDOW_START);

    while (cursor <= WINDOW_END) {
      const receiveDate = addDays(startOfMonth(cursor), randomInt(0, 18));
      const qtyReceived = randomInt(receiveMin * 2, receiveMax * 2);
      const expiryDate = addDays(receiveDate, randomInt(280, 720));
      const manufactureDate = addDays(receiveDate, -randomInt(40, 150));
      const residualFactor = chance(0.28) ? randomFloat(0.02, 0.22) : randomFloat(0, 0.08);
      const qtyCurrent = Math.max(0, Math.round(qtyReceived * residualFactor));
      const status =
        expiryDate < CURRENT_DATE ? 'expired' : qtyCurrent <= Math.max(5, Math.round(qtyReceived * 0.04)) ? 'depleted' : 'active';

      batches.push({
        vaccineId: vaccine.id,
        vaccineCode: code,
        receiveDate,
        lotNo: buildBatchNumber(code, cursor, batchSequence),
        expiryDate,
        manufactureDate,
        qtyReceived,
        qtyCurrent,
        qtyInitial: qtyReceived,
        supplierId: pick(referenceData.suppliers).id,
        clinicId,
        status,
      });

      batchSequence += 1;
      cursor = addMonths(cursor, 3);
    }
  }

  return {
    periods,
    inventoryCodes,
    batches,
    batchRows: batches.map((batch) => [
      batch.vaccineId,
      batch.lotNo,
      toIsoDate(batch.expiryDate),
      toIsoDate(batch.manufactureDate),
      batch.qtyReceived,
      batch.qtyCurrent,
      batch.qtyInitial,
      batch.supplierId,
      batch.clinicId,
      '2-8 C',
      batch.status,
      true,
      batch.receiveDate,
      batch.receiveDate,
      batch.lotNo,
    ]),
  };
};

const createInventoryRows = (referenceData, batchByCodeAndMonth, staffUsers, clinicId, periods, inventoryCodes) => {
  const inventoryRows = [];
  const inventoryDetails = [];
  const carryover = new Map();

  for (const periodStart of periods) {
    const periodEnd = endOfMonth(periodStart);
    for (const code of inventoryCodes) {
      const vaccine = referenceData.vaccinesByCode.get(code);
      const config = vaccineDemandBaseline[code];
      const key = `${vaccine.id}`;
      const beginningBalance = carryover.get(key) ?? randomInt(55, 140);
      const batch = batchByCodeAndMonth.get(`${code}:${monthKey(periodStart)}`) || null;
      const received = batch ? Math.round(batch.qtyReceived * randomFloat(0.55, 0.82)) : randomInt(0, 42);
      const issuance = randomInt(config.issuance[0], config.issuance[1]);
      const transferredIn = chance(0.18) ? randomInt(0, 28) : 0;
      const transferredOut = chance(0.14) ? randomInt(0, 20) : 0;
      const expiredWasted = chance(0.28) ? randomInt(0, 8) : 0;
      const stockOnHand = Math.max(
        0,
        beginningBalance + received + transferredIn - transferredOut - expiredWasted - issuance,
      );
      const createdBy = pick(staffUsers).id;
      const updatedBy = chance(0.7) ? createdBy : pick(staffUsers).id;
      const thresholds = config.threshold;
      carryover.set(key, stockOnHand);

      inventoryRows.push([
        vaccine.id,
        clinicId,
        beginningBalance,
        received,
        batch ? batch.lotNo : buildBatchNumber(code, periodStart, 999),
        transferredIn,
        transferredOut,
        expiredWasted,
        issuance,
        thresholds.low,
        thresholds.critical,
        stockOnHand <= thresholds.low,
        stockOnHand <= thresholds.critical,
        toIsoDate(periodStart),
        toIsoDate(periodEnd),
        createdBy,
        updatedBy,
        addDays(periodEnd, 1),
        addDays(periodEnd, 1),
        stockOnHand,
        true,
        batch ? toIsoDate(batch.expiryDate) : null,
      ]);

      inventoryDetails.push({
        vaccineId: vaccine.id,
        vaccineCode: code,
        periodStart,
        periodEnd,
        beginningBalance,
        received,
        transferredIn,
        transferredOut,
        expiredWasted,
        issuance,
        stockOnHand,
        batch,
      });
    }
  }

  return {
    inventoryRows,
    inventoryDetails,
  };
};

const buildGrowthMeasurement = (dob, measurementDate, sex) => {
  const ageDays = Math.max(0, dateDifferenceInDays(measurementDate, dob));
  const ageMonths = ageDays / 30.4;
  const baseWeight = sex === 'M' ? 3.2 : 3.0;
  return {
    ageDays,
    weight: randomFloat(
      baseWeight + ageMonths * 0.52 - Math.max(0, ageMonths - 9) * 0.18,
      baseWeight + ageMonths * 0.62 - Math.max(0, ageMonths - 9) * 0.08,
      2,
    ),
    height: randomFloat(50 + ageMonths * 1.65, 51.5 + ageMonths * 1.82, 2),
    headCircumference: randomFloat(34 + ageMonths * 0.42, 35 + ageMonths * 0.47, 2),
  };
};

async function reseedDefenseDemoDataset() {
  const client = await db.connect();
  let inTransaction = false;

  try {
    console.log('='.repeat(72));
    console.log('IMMUNICARE DEFENSE DEMO DATASET RESEED');
    console.log('='.repeat(72));
    console.log(`Marker: ${DEMO_MARKER}`);
    console.log(`Target infants: ${INFANT_TARGET}`);
    console.log(`Window: ${toIsoDate(WINDOW_START)} to ${toIsoDate(WINDOW_END)}`);

    const availableTables = await existingTableSet(client);

    console.log('\n[1/8] Cleaning current synthetic and guardian-facing demo data...');
    const cleanupGroups = [
      ['appointment_confirmations', 'vaccination_reminders', 'sms_logs', 'audit_logs', 'notifications', 'appointments', 'immunization_records'],
      ['announcement_recipient_deliveries', 'messages', 'reports', 'user_sessions', 'admin_activity_log', 'notification_logs', 'access_logs', 'security_events'],
      ['vaccine_availability_notifications', 'vaccine_waitlist', 'transfer_in_cases', 'vaccination_records', 'vaccine_transactions'],
      ['documents', 'document_downloads', 'infant_documents', 'health_records', 'growth', 'growth_records', 'infant_growth', 'patient_growth', 'paper_completion_status'],
      ['vaccine_inventory_transactions', 'inventory_transactions', 'vaccine_inventory', 'vaccine_batches'],
      ['guardian_notification_preferences', 'guardian_phone_numbers', 'notification_preferences', 'password_history', 'password_reset_otps', 'password_reset_tokens', 'user_preferences'],
      ['parent_guardian', 'infants', 'patients'],
    ];

    for (const cleanupGroup of cleanupGroups) {
      console.log(`  Truncating ${cleanupGroup.join(', ')}`);
      await truncateExistingTables(client, cleanupGroup, availableTables);
    }

    await client.query("SET session_replication_role = 'replica'");
    const deletedGuardianUsers = await deleteMatchingRowsInBatches(
      client,
      'users',
      `
        role_id = (SELECT id FROM roles WHERE name = 'guardian' LIMIT 1)
        OR guardian_id IS NOT NULL
        OR username LIKE 'demo.guardian.%'
        OR username LIKE 'defense.%'
        OR username LIKE 'syn_%'
        OR username LIKE 'guardian_%'
        OR username LIKE 'updated.test%'
        OR username LIKE 'test%'
        OR email LIKE '%@synthetic-immunicare.ph'
        OR email LIKE '%@demo-immunicare.ph'
        OR email LIKE '%@immunicare.test'
      `,
      { batchSize: 10000, label: 'users' },
    );

    const deletedGuardians = await deleteMatchingRowsInBatches(
      client,
      'guardians',
      `TRUE`,
      { batchSize: 10000, label: 'guardians' },
    );
    await client.query("SET session_replication_role = 'origin'");

    console.log(`Removed ${deletedGuardianUsers} guardian/demo users and ${deletedGuardians} guardian records`);

    await client.query(`
      UPDATE vaccination_schedules AS vs
      SET vaccine_code = v.code,
          vaccine_name = v.name,
          manufacturer = v.manufacturer,
          updated_at = CURRENT_TIMESTAMP
      FROM vaccines AS v
      WHERE vs.vaccine_id = v.id
        AND vs.is_active = true
    `);

    if (availableTables.has('vaccination_reminder_templates')) {
      await client.query(`
        DELETE FROM vaccination_reminder_templates
        WHERE vaccine_id IN (
          SELECT id FROM vaccines WHERE code ~ '^SYNPH26-'
        )
      `);
    }

    await client.query(`DELETE FROM vaccination_schedules WHERE vaccine_id IN (SELECT id FROM vaccines WHERE code ~ '^SYNPH26-')`);
    await client.query(`DELETE FROM vaccines WHERE code ~ '^SYNPH26-'`);
    await client.query(`DELETE FROM suppliers WHERE COALESCE(supplier_code, '') ~ '^SYNPH26SUP'`);

    await client.query('BEGIN');
    inTransaction = true;
    await client.query('SET LOCAL statement_timeout = 0');
    await client.query('SET LOCAL lock_timeout = 0');

    console.log('\n[2/8] Loading reference data and creating staff accounts...');
    const referenceData = await fetchReferenceData(client);
    const staffUsers = await generateStaffUsers(client, referenceData);
    const healthCenterClinicId =
      referenceData.clinicsByName.get('San Nicolas Health Center') ||
      referenceData.clinicsByName.get('Main Health Center') ||
      1;
    const guardianPortalClinicId =
      referenceData.clinicsByName.get('Guardian Portal') || healthCenterClinicId;
    const guardianRoleId = referenceData.rolesByName.get('guardian');

    if (!guardianRoleId) {
      throw new Error('Guardian role is missing; cannot build linked guardian users.');
    }

    console.log(`Created ${staffUsers.length} demo staff users`);

    console.log('\n[3/8] Generating realistic Pasig families, guardians, infants, and compatibility rows...');
    const families = generateFamilies();
    const children = generateChildren(families, healthCenterClinicId);
    const guardianPasswordHash = await bcrypt.hash(DEFAULT_GUARDIAN_PASSWORD, 10);

    const insertedGuardians = await insertRows(
      client,
      'guardians',
      [
        'name',
        'phone',
        'email',
        'address',
        'relationship',
        'is_active',
        'created_at',
        'updated_at',
        'password_hash',
        'is_password_set',
        'last_login',
        'must_change_password',
        'password',
        'first_name',
        'last_name',
        'middle_name',
        'emergency_contact_priority',
        'alternate_phone',
        'is_primary_guardian',
        'relationship_to_student',
        'clinic_id',
        'emergency_contact',
        'emergency_phone',
      ],
      families.map((family) => {
        const guardian = family.guardian;
        return [
          `${guardian.firstName} ${guardian.middleName} ${guardian.lastName}`,
          guardian.phone,
          guardian.email,
          guardian.address,
          guardian.relationship,
          true,
          guardian.createdAt,
          guardian.createdAt,
          guardianPasswordHash,
          true,
          guardian.lastLogin,
          false,
          DEFAULT_GUARDIAN_PASSWORD,
          guardian.firstName,
          guardian.lastName,
          guardian.middleName,
          1,
          guardian.alternatePhone,
          true,
          guardian.relationship,
          healthCenterClinicId,
          guardian.emergencyContact,
          guardian.emergencyPhone,
        ];
      }),
      { chunkSize: 250, returningColumns: ['id', 'email'] },
    );

    const guardianIdByEmail = new Map(insertedGuardians.map((row) => [row.email, row.id]));
    const guardianIdByFamilySequence = new Map(
      families.map((family) => [family.sequence, guardianIdByEmail.get(family.guardian.email)]),
    );

    const insertedGuardianUsers = await insertRows(
      client,
      'users',
      [
        'username',
        'password_hash',
        'role_id',
        'clinic_id',
        'contact',
        'email',
        'last_login',
        'guardian_id',
        'is_active',
        'created_at',
        'updated_at',
        'force_password_change',
        'password',
        'first_name',
        'last_name',
        'role',
      ],
      families.map((family) => {
        const guardian = family.guardian;
        return [
          guardian.username,
          guardianPasswordHash,
          guardianRoleId,
          guardianPortalClinicId,
          guardian.phone,
          guardian.email,
          guardian.lastLogin,
          guardianIdByFamilySequence.get(family.sequence),
          true,
          guardian.createdAt,
          guardian.createdAt,
          false,
          DEFAULT_GUARDIAN_PASSWORD,
          guardian.firstName,
          guardian.lastName,
          'guardian',
        ];
      }),
      { chunkSize: 250, returningColumns: ['id', 'username', 'guardian_id', 'email'] },
    );

    const guardianUserIdByGuardianId = new Map(
      insertedGuardianUsers.map((row) => [row.guardian_id, row.id]),
    );

    await insertRows(
      client,
      'guardian_notification_preferences',
      [
        'guardian_id',
        'sms_enabled',
        'email_enabled',
        'push_enabled',
        'reminder_days_before',
        'created_at',
        'updated_at',
        'notification_type',
        'preferred_time',
        'is_active',
      ],
      families.map((family) => [
        guardianIdByFamilySequence.get(family.sequence),
        true,
        chance(0.72),
        chance(0.58),
        weightedPick([
          { value: 1, weight: 18 },
          { value: 3, weight: 50 },
          { value: 5, weight: 32 },
        ]),
        family.guardian.createdAt,
        family.guardian.createdAt,
        'all',
        '09:00:00',
        true,
      ]),
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'guardian_phone_numbers',
      [
        'guardian_id',
        'phone_number',
        'is_primary',
        'is_verified',
        'verified_at',
        'sms_preferences',
        'created_at',
        'updated_at',
      ],
      families.map((family) => [
        guardianIdByFamilySequence.get(family.sequence),
        family.guardian.phone,
        true,
        true,
        family.guardian.createdAt,
        safeJson({ reminders: true, announcements: chance(0.86) }),
        family.guardian.createdAt,
        family.guardian.createdAt,
      ]),
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'password_history',
      ['user_id', 'password_hash', 'created_at', 'expires_at'],
      insertedGuardianUsers.map((user) => [
        user.id,
        guardianPasswordHash,
        WINDOW_START,
        addMonths(WINDOW_END, 12),
      ]),
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'notification_preferences',
      [
        'user_id',
        'notification_type',
        'channel',
        'enabled',
        'frequency',
        'quiet_hours_start',
        'quiet_hours_end',
        'timezone',
        'custom_message',
        'conditions',
        'created_at',
        'updated_at',
        'deleted_at',
      ],
      insertedGuardianUsers.flatMap((user) => [
        [
          user.id,
          'appointment_updates',
          'both',
          true,
          'immediate',
          null,
          null,
          'Asia/Manila',
          null,
          safeJson({ source: 'guardian-dashboard' }),
          WINDOW_START,
          WINDOW_START,
          null,
        ],
        [
          user.id,
          'announcements',
          chance(0.65) ? 'sms' : 'push',
          true,
          'daily',
          null,
          null,
          'Asia/Manila',
          null,
          safeJson({ source: 'admin-broadcasts' }),
          WINDOW_START,
          WINDOW_START,
          null,
        ],
      ]),
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'user_preferences',
      [
        'user_id',
        'preference_key',
        'preference_value',
        'preference_type',
        'is_active',
        'created_at',
        'updated_at',
      ],
      insertedGuardianUsers.map((user) => [
        user.id,
        'guardian_dashboard',
        safeJson({
          landingCard: chance(0.55) ? 'upcoming-appointments' : 'vaccination-history',
          locale: 'en-PH',
          timezone: 'Asia/Manila',
        }),
        'system',
        true,
        WINDOW_START,
        WINDOW_START,
      ]),
      { chunkSize: 250 },
    );

    const insertedPatients = await insertRows(
      client,
      'patients',
      [
        'name',
        'date_of_birth',
        'gender',
        'parent_guardian',
        'contact_number',
        'address',
        'created_at',
        'updated_at',
        'guardian_id',
        'first_name',
        'last_name',
        'middle_name',
        'dob',
        'sex',
        'national_id',
        'contact',
        'photo_url',
        'mother_name',
        'father_name',
        'birth_weight',
        'birth_height',
        'place_of_birth',
        'barangay',
        'health_center',
        'family_no',
        'time_of_delivery',
        'type_of_delivery',
        'doctor_midwife_nurse',
        'nbs_done',
        'nbs_date',
        'cellphone_number',
        'facility_id',
        'control_number',
        'is_active',
        'allergy_information',
        'health_care_provider',
        'transfer_in_source',
        'validation_status',
        'auto_computed_next_vaccine',
        'age_months',
      ],
      buildPatientRows(children, guardianIdByFamilySequence),
      { chunkSize: 200, returningColumns: ['id', 'control_number'] },
    );

    const patientIdByControlNumber = new Map(
      insertedPatients.map((row) => [row.control_number, row.id]),
    );

    const insertedInfants = await insertRows(
      client,
      'infants',
      [
        'first_name',
        'last_name',
        'middle_name',
        'dob',
        'sex',
        'national_id',
        'address',
        'contact',
        'guardian_id',
        'clinic_id',
        'birth_height',
        'birth_weight',
        'mother_name',
        'father_name',
        'barangay',
        'health_center',
        'family_no',
        'place_of_birth',
        'time_of_delivery',
        'type_of_delivery',
        'doctor_midwife_nurse',
        'nbs_done',
        'nbs_date',
        'cellphone_number',
        'is_active',
        'created_at',
        'updated_at',
        'patient_control_number',
      ],
      buildInfantRows(children),
      { chunkSize: 200, returningColumns: ['id', 'patient_control_number'] },
    );

    const infantIdByControlNumber = new Map(
      insertedInfants.map((row) => [row.patient_control_number, row.id]),
    );

    const insertedParentGuardians = await insertRows(
      client,
      'parent_guardian',
      [
        'user_id',
        'infant_id',
        'relationship_type',
        'full_name',
        'phone',
        'email',
        'relationship_details',
        'is_primary',
        'is_active',
        'created_at',
        'updated_at',
        'created_by',
        'updated_by',
        'password_hash',
        'is_password_set',
      ],
      children.map((child) => {
        const family = families[child.familySequence - 1];
        const guardian = family.guardian;
        const guardianId = guardianIdByFamilySequence.get(child.guardianFamilySequence);
        return [
          guardianUserIdByGuardianId.get(guardianId),
          infantIdByControlNumber.get(child.controlNumber),
          inferParentGuardianRelationshipType(guardian.relationship),
          `${guardian.firstName} ${guardian.middleName} ${guardian.lastName}`,
          guardian.phone,
          guardian.email.replace('@', `+pg${String(child.sequence).padStart(4, '0')}@`),
          guardian.address,
          true,
          true,
          child.createdAt,
          child.createdAt,
          staffUsers[0]?.id || null,
          staffUsers[0]?.id || null,
          guardianPasswordHash,
          true,
        ];
      }),
      { chunkSize: 200, returningColumns: ['id', 'infant_id'] },
    );

    const parentGuardianIdByInfantId = new Map(
      insertedParentGuardians.map((row) => [row.infant_id, row.id]),
    );

    await updateInfantGuardianLinks(
      client,
      children.map((child) => ({
        infantId: infantIdByControlNumber.get(child.controlNumber),
        parentGuardianId: parentGuardianIdByInfantId.get(
          infantIdByControlNumber.get(child.controlNumber),
        ),
      })),
    );

    children.forEach((child) => {
      child.guardianId = guardianIdByFamilySequence.get(child.guardianFamilySequence);
      child.guardianUserId = guardianUserIdByGuardianId.get(child.guardianId);
      child.patientId = patientIdByControlNumber.get(child.controlNumber);
      child.infantId = infantIdByControlNumber.get(child.controlNumber);
      child.parentGuardianId = parentGuardianIdByInfantId.get(child.infantId);
      families[child.familySequence - 1].guardianId = child.guardianId;
      families[child.familySequence - 1].guardianUserId = child.guardianUserId;
    });

    console.log(`Inserted ${families.length} guardians and ${children.length} linked infants/patients`);

    console.log('\n[4/8] Building inventory, stock, batch, and utilization coverage...');
    const batchPlan = createBatchPlan(referenceData, healthCenterClinicId);
    const insertedBatchRows = await insertRows(
      client,
      'vaccine_batches',
      [
        'vaccine_id',
        'lot_no',
        'expiry_date',
        'manufacture_date',
        'qty_received',
        'qty_current',
        'qty_initial',
        'supplier_id',
        'clinic_id',
        'storage_conditions',
        'status',
        'is_active',
        'created_at',
        'updated_at',
        'lot_number',
      ],
      batchPlan.batchRows,
      { chunkSize: 150, returningColumns: ['id', 'vaccine_id', 'lot_no', 'expiry_date', 'created_at'] },
    );

    const batchLookup = new Map();
    for (const batch of insertedBatchRows) {
      const vaccine = [...referenceData.vaccinesByCode.values()].find((entry) => entry.id === batch.vaccine_id);
      if (!vaccine) {
        continue;
      }
      batchLookup.set(`${vaccine.code}:${monthKey(startOfMonth(new Date(batch.created_at)))}`, {
        id: batch.id,
        lotNo: batch.lot_no,
        expiryDate: new Date(batch.expiry_date),
        qtyReceived: batchPlan.batches.find((entry) => entry.lotNo === batch.lot_no)?.qtyReceived || 0,
      });
    }

    const { inventoryRows, inventoryDetails } = createInventoryRows(
      referenceData,
      batchLookup,
      staffUsers,
      healthCenterClinicId,
      batchPlan.periods,
      batchPlan.inventoryCodes,
    );

    const insertedInventoryRows = await insertRows(
      client,
      'vaccine_inventory',
      [
        'vaccine_id',
        'clinic_id',
        'beginning_balance',
        'received_during_period',
        'lot_batch_number',
        'transferred_in',
        'transferred_out',
        'expired_wasted',
        'issuance',
        'low_stock_threshold',
        'critical_stock_threshold',
        'is_low_stock',
        'is_critical_stock',
        'period_start',
        'period_end',
        'created_by',
        'updated_by',
        'created_at',
        'updated_at',
        'stock_on_hand',
        'is_active',
        'expiry_date',
      ],
      inventoryRows,
      { chunkSize: 150, returningColumns: ['id', 'vaccine_id', 'period_start'] },
    );

    inventoryDetails.forEach((detail, index) => {
      detail.inventoryId = insertedInventoryRows[index]?.id || null;
    });

    const inventoryTransactionRows = [];
    const vaccineInventoryTransactionRows = [];
    let vaccineInventoryTransactionSequence = 1;

    for (const detail of inventoryDetails) {
      const inventoryId = detail.inventoryId;
      const performedBy = chance(0.6) ? staffUsers[1]?.id || staffUsers[0].id : pick(staffUsers).id;
      const approvedBy = pick(staffUsers).id;

      if (detail.received > 0) {
        vaccineInventoryTransactionRows.push([
          inventoryId,
          detail.vaccineId,
          healthCenterClinicId,
          'RECEIVE',
          detail.received,
          detail.beginningBalance,
          detail.beginningBalance + detail.received,
          detail.batch?.lotNo || buildReferenceNumber('LOT', vaccineInventoryTransactionSequence),
          detail.batch?.lotNo || buildReferenceNumber('LOT', vaccineInventoryTransactionSequence),
          detail.batch ? toIsoDate(detail.batch.expiryDate) : null,
          detail.batch ? pick(referenceData.suppliers).name : null,
          buildReferenceNumber('VIT', vaccineInventoryTransactionSequence),
          performedBy,
          approvedBy,
          `${DEMO_MARKER} monthly stock receipt`,
          detail.stockOnHand <= 45,
          detail.stockOnHand <= 20,
          addDays(detail.periodStart, 5),
        ]);
        vaccineInventoryTransactionSequence += 1;
      }

      vaccineInventoryTransactionRows.push([
        inventoryId,
        detail.vaccineId,
        healthCenterClinicId,
        'ISSUE',
        detail.issuance,
        detail.beginningBalance + detail.received + detail.transferredIn,
        detail.stockOnHand + detail.transferredOut + detail.expiredWasted,
        detail.batch?.lotNo || buildReferenceNumber('LOT', vaccineInventoryTransactionSequence),
        detail.batch?.lotNo || buildReferenceNumber('LOT', vaccineInventoryTransactionSequence),
        detail.batch ? toIsoDate(detail.batch.expiryDate) : null,
        null,
        buildReferenceNumber('VIT', vaccineInventoryTransactionSequence),
        performedBy,
        approvedBy,
        `${DEMO_MARKER} doses issued to vaccination sessions`,
        detail.stockOnHand <= 45,
        detail.stockOnHand <= 20,
        addDays(detail.periodStart, 20),
      ]);
      vaccineInventoryTransactionSequence += 1;

      if (detail.expiredWasted > 0) {
        vaccineInventoryTransactionRows.push([
          inventoryId,
          detail.vaccineId,
          healthCenterClinicId,
          'WASTAGE',
          detail.expiredWasted,
          detail.stockOnHand + detail.expiredWasted,
          detail.stockOnHand,
          detail.batch?.lotNo || buildReferenceNumber('LOT', vaccineInventoryTransactionSequence),
          detail.batch?.lotNo || buildReferenceNumber('LOT', vaccineInventoryTransactionSequence),
          detail.batch ? toIsoDate(detail.batch.expiryDate) : null,
          null,
          buildReferenceNumber('VIT', vaccineInventoryTransactionSequence),
          performedBy,
          approvedBy,
          `${DEMO_MARKER} cold chain wastage reconciliation`,
          detail.stockOnHand <= 45,
          detail.stockOnHand <= 20,
          addDays(detail.periodStart, 25),
        ]);
        vaccineInventoryTransactionSequence += 1;
      }

      if (detail.batch) {
        inventoryTransactionRows.push([
          detail.batch.id,
          'RECEIVE',
          Math.max(1, Math.round(detail.received * randomFloat(0.85, 1.0))),
          approvedBy,
          `${DEMO_MARKER} batch stocking`,
          addDays(detail.periodStart, 4),
        ]);
        inventoryTransactionRows.push([
          detail.batch.id,
          chance(0.85) ? 'ISSUE' : 'ADJUST',
          Math.max(1, Math.round(detail.issuance * randomFloat(0.4, 0.9))),
          performedBy,
          `${DEMO_MARKER} monthly vaccine issuance`,
          addDays(detail.periodStart, 18),
        ]);
      }
    }

    await insertRows(
      client,
      'vaccine_inventory_transactions',
      [
        'vaccine_inventory_id',
        'vaccine_id',
        'clinic_id',
        'transaction_type',
        'quantity',
        'previous_balance',
        'new_balance',
        'lot_number',
        'batch_number',
        'expiry_date',
        'supplier_name',
        'reference_number',
        'performed_by',
        'approved_by',
        'notes',
        'triggered_low_stock_alert',
        'triggered_critical_stock_alert',
        'created_at',
      ],
      vaccineInventoryTransactionRows,
      { chunkSize: 200 },
    );

    await insertRows(
      client,
      'inventory_transactions',
      ['batch_id', 'txn_type', 'qty', 'user_id', 'notes', 'created_at'],
      inventoryTransactionRows.filter((row) => row[0]),
      { chunkSize: 200 },
    );

    console.log(`Inserted ${insertedBatchRows.length} batches, ${insertedInventoryRows.length} inventory rows`);

    console.log('\n[5/8] Generating immunization history, appointments, reminders, transfers, and waitlists...');
    const contemporaryBatchByVaccineCode = new Map();
    for (const row of insertedBatchRows) {
      const vaccine = [...referenceData.vaccinesByCode.values()].find((entry) => entry.id === row.vaccine_id);
      if (!vaccine) {
        continue;
      }
      if (!contemporaryBatchByVaccineCode.has(vaccine.code)) {
        contemporaryBatchByVaccineCode.set(vaccine.code, []);
      }
      contemporaryBatchByVaccineCode.get(vaccine.code).push({
        id: row.id,
        expiryDate: new Date(row.expiry_date),
        createdAt: new Date(row.created_at),
        lotNo: row.lot_no,
      });
    }

    for (const batchList of contemporaryBatchByVaccineCode.values()) {
      batchList.sort((left, right) => left.createdAt - right.createdAt);
    }

    const selectBatchForVaccine = (vaccineCode, adminDate) => {
      const options = contemporaryBatchByVaccineCode.get(vaccineCode) || [];
      const valid = options.filter(
        (option) => option.createdAt <= adminDate && option.expiryDate >= adminDate,
      );
      if (valid.length) {
        return valid[valid.length - 1];
      }
      return options[0] || null;
    };

    const scheduleIdFor = (vaccineCode, doseNumber) => {
      const vaccine = referenceData.vaccinesByCode.get(vaccineCode);
      if (!vaccine) {
        return null;
      }
      return referenceData.schedulesByKey.get(`${vaccine.id}:${doseNumber}`)?.id || null;
    };

    const immunizationRows = [];
    const legacyVaccinationRows = [];
    const appointmentRows = [];
    const reminderRows = [];
    const transferCaseRows = [];
    const waitlistRows = [];
    let appointmentSequence = 1;
    const completedVisitAllocator = createOperationalDayAllocator(
      OPERATIONAL_HISTORY_START,
      CURRENT_DATE,
      { category: 'defense demo completed visits' },
    );
    const futureAppointmentAllocator = createOperationalDayAllocator(
      addDays(CURRENT_DATE, 1),
      WINDOW_END,
      { category: 'defense demo scheduled appointments' },
    );

    for (const child of children) {
      const importedHistory = [];

      for (const template of visitTemplates) {
        const dueDate = addMonths(child.dob, template.ageMonths);
        const jitteredAdminDate = clampDate(addDays(dueDate, randomInt(-4, 21)), child.dob, WINDOW_END);
        const dueByToday = dueDate <= CURRENT_DATE;
        const overdueDays = dateDifferenceInDays(CURRENT_DATE, dueDate);
        const completionProbability =
          !dueByToday
            ? 0
            : overdueDays > 240
              ? 0.93
              : overdueDays > 90
                ? 0.87
                : overdueDays > 14
                  ? 0.74
                  : 0.48;

        const isCompleted = dueByToday && chance(completionProbability);

        if (isCompleted) {
          const preferredAdminDate = dueDate < WINDOW_START
            ? dueDate
            : clampDate(jitteredAdminDate, WINDOW_START, CURRENT_DATE);
          const actualAdminDate = completedVisitAllocator.allocate(preferredAdminDate);
          const recordCreatedAt =
            actualAdminDate < WINDOW_START
              ? randomDateBetween(actualAdminDate, CURRENT_DATE)
              : addDays(actualAdminDate, randomInt(0, 3));
          const administeredBy = pick(staffUsers).id;
          let nextDueDate = null;
          const templateIndex = visitTemplates.findIndex((entry) => entry.code === template.code);
          if (templateIndex >= 0 && templateIndex < visitTemplates.length - 1) {
            nextDueDate = addMonths(child.dob, visitTemplates[templateIndex + 1].ageMonths);
          }

          for (const vaccineDose of template.vaccines) {
            const vaccine = referenceData.vaccinesByCode.get(vaccineDose.code);
            if (!vaccine) {
              continue;
            }

            const batch = actualAdminDate >= WINDOW_START ? selectBatchForVaccine(vaccineDose.code, actualAdminDate) : null;
            const notePrefix = actualAdminDate < WINDOW_START ? 'Historical record imported during demo reseed.' : 'Administered at health center visit.';

            immunizationRows.push([
              child.patientId,
              vaccine.id,
              batch?.id || null,
              toIsoDate(actualAdminDate),
              nextDueDate ? toIsoDate(nextDueDate) : null,
              'completed',
              `${DEMO_MARKER} ${notePrefix}`,
              administeredBy,
              recordCreatedAt,
              recordCreatedAt,
              true,
              vaccineDose.dose,
              pick(['Left thigh', 'Right thigh', 'Left arm', 'Right arm']),
              chance(0.07) ? 'Mild fever resolved within 24 hours' : null,
              pick(['Nurse Clarisse Reyes', 'Midwife Mariel Lim', 'Dr. Michael Tan']),
              scheduleIdFor(vaccineDose.code, vaccineDose.dose),
              batch?.lotNo || `${DEMO_MARKER}-HIST-${vaccineDose.code}-${toIsoDate(actualAdminDate)}`,
              batch?.lotNo || `${DEMO_MARKER}-HIST-${vaccineDose.code}-${toIsoDate(actualAdminDate)}`,
            ]);

            if (batch?.id) {
              legacyVaccinationRows.push([
                child.infantId,
                vaccine.id,
                batch.id,
                vaccineDose.dose,
                actualAdminDate,
                administeredBy,
                administeredBy,
                vaccineDose.code === 'BCG' ? '0.05 mL intradermal' : '0.5 mL',
                pick(['Left thigh', 'Right thigh', 'Left arm', 'Right arm']),
                chance(0.05) ? 'Localized redness' : null,
                nextDueDate ? toIsoDate(nextDueDate) : null,
                `${DEMO_MARKER} legacy vaccination mirror row`,
                true,
                recordCreatedAt,
                recordCreatedAt,
              ]);
            }

            importedHistory.push({
              vaccineCode: vaccineDose.code,
              doseNumber: vaccineDose.dose,
              adminDate: toIsoDate(actualAdminDate),
              status: 'completed',
            });
          }

          if (actualAdminDate >= WINDOW_START) {
            appointmentRows.push([
              child.infantId,
              actualAdminDate,
              'Vaccination',
              'attended',
              `${DEMO_MARKER} vaccination visit for ${template.code}`,
              null,
              'Routine immunization completed',
              35,
              pick(staffUsers).id,
              healthCenterClinicId,
              true,
              addDays(actualAdminDate, -randomInt(1, 10)),
              actualAdminDate,
              'San Nicolas Health Center Vaccination Room',
              'confirmed',
              addDays(actualAdminDate, -1),
              weightedPick([
                { value: 'sms', weight: 52 },
                { value: 'portal', weight: 30 },
                { value: 'sms+portal', weight: 18 },
              ]),
              chance(0.86),
              addDays(actualAdminDate, -2),
              child.guardianId,
              buildAppointmentControlNumber(appointmentSequence),
              chance(0.75),
              chance(0.34),
              false,
            ]);
            appointmentSequence += 1;
          }

          if (template.ageMonths <= 3 && importedHistory.length >= 4 && chance(0.12)) {
            transferCaseRows.push([
              child.guardianId,
              child.patientId,
              'Pasig City Maternity and Child Wellness Center',
              safeJson(importedHistory),
              `/uploads/transfer/${child.controlNumber}.jpg`,
              `${DEMO_MARKER} prior vaccine card reconciled into active record`,
              template.vaccines[template.vaccines.length - 1]?.code || 'MMR',
              template.vaccines[template.vaccines.length - 1]?.code || 'MMR',
              'approved',
              'Supporting documents verified by nurse reviewer',
              'normal',
              'ready_for_scheduling',
              true,
              recordCreatedAt,
              recordCreatedAt,
              addDays(recordCreatedAt, 3),
              pick(staffUsers).id,
            ]);
          }
        } else {
          const appointmentDate =
            dueDate <= CURRENT_DATE
              ? clampDate(addDays(CURRENT_DATE, randomInt(3, 45)), WINDOW_START, WINDOW_END)
              : clampDate(addDays(dueDate, randomInt(-3, 10)), WINDOW_START, WINDOW_END);

          if (appointmentDate > WINDOW_END) {
            continue;
          }

          const scheduledAppointmentDate = futureAppointmentAllocator.allocate(appointmentDate);

          const appointmentStatus = dueDate <= CURRENT_DATE
            ? weightedPick([
                { value: 'scheduled', weight: 44 },
                { value: 'confirmed', weight: 28 },
                { value: 'rescheduled', weight: 12 },
                { value: 'no-show', weight: 10 },
                { value: 'cancelled', weight: 6 },
              ])
            : weightedPick([
                { value: 'scheduled', weight: 54 },
                { value: 'confirmed', weight: 32 },
                { value: 'rescheduled', weight: 10 },
                { value: 'cancelled', weight: 4 },
              ]);

          appointmentRows.push([
            child.infantId,
            scheduledAppointmentDate,
            'Vaccination',
            appointmentStatus,
            `${DEMO_MARKER} follow-up vaccination schedule for ${template.code}`,
            appointmentStatus === 'cancelled' ? 'Guardian requested a date change.' : null,
            null,
            35,
            pick(staffUsers).id,
            healthCenterClinicId,
            true,
            addDays(scheduledAppointmentDate, -randomInt(2, 15)),
            addDays(scheduledAppointmentDate, -randomInt(0, 2)),
            'San Nicolas Health Center Vaccination Room',
            appointmentStatus === 'confirmed' ? 'confirmed' : 'pending',
            addDays(scheduledAppointmentDate, -1),
            weightedPick([
              { value: 'sms', weight: 58 },
              { value: 'portal', weight: 24 },
              { value: 'sms+portal', weight: 18 },
            ]),
            chance(0.82),
            chance(0.52) ? addDays(scheduledAppointmentDate, -2) : null,
            child.guardianId,
            buildAppointmentControlNumber(appointmentSequence),
            chance(0.8),
            chance(0.4),
            appointmentStatus === 'no-show' ? chance(0.35) : false,
          ]);
          appointmentSequence += 1;

          reminderRows.push([
            child.infantId,
            referenceData.vaccinesByCode.get(template.vaccines[0].code)?.id || null,
            toIsoDate(dueDate),
            toIsoDate(addDays(scheduledAppointmentDate, -weightedPick([
              { value: 1, weight: 22 },
              { value: 3, weight: 54 },
              { value: 5, weight: 24 },
            ]))),
            appointmentStatus === 'no-show' ? 'overdue' : 'scheduled',
            null,
            addDays(scheduledAppointmentDate, -randomInt(12, 20)),
            addDays(scheduledAppointmentDate, -randomInt(0, 3)),
            child.patientId,
            child.guardianId,
            template.vaccines[0].dose,
            toIsoDate(scheduledAppointmentDate),
            null,
            false,
            false,
            null,
            `${DEMO_MARKER} reminder for ${template.code.toLowerCase()} visit`,
          ]);

          if (chance(0.05) && template.ageMonths >= 9) {
            const vaccine = referenceData.vaccinesByCode.get(template.vaccines[0].code);
            waitlistRows.push([
              child.infantId,
              vaccine.id,
              child.guardianId,
              healthCenterClinicId,
              weightedPick([
                { value: 'waiting', weight: 52 },
                { value: 'notified', weight: 22 },
                { value: 'resolved', weight: 26 },
              ]),
              chance(0.45) ? addDays(scheduledAppointmentDate, -1) : null,
              addDays(scheduledAppointmentDate, -randomInt(18, 32)),
              addDays(scheduledAppointmentDate, -randomInt(2, 8)),
            ]);
          }
        }
      }
    }

    const insertedAppointments = await insertRows(
      client,
      'appointments',
      [
        'infant_id',
        'scheduled_date',
        'type',
        'status',
        'notes',
        'cancellation_reason',
        'completion_notes',
        'duration_minutes',
        'created_by',
        'clinic_id',
        'is_active',
        'created_at',
        'updated_at',
        'location',
        'confirmation_status',
        'confirmed_at',
        'confirmation_method',
        'sms_confirmation_sent',
        'sms_confirmation_sent_at',
        'guardian_id',
        'control_number',
        'reminder_sent_24h',
        'reminder_sent_48h',
        'sms_missed_notification_sent',
      ],
      appointmentRows,
      { chunkSize: 200, returningColumns: ['id', 'guardian_id', 'status', 'scheduled_date', 'control_number'] },
    );

    await insertRows(
      client,
      'appointment_confirmations',
      [
        'appointment_id',
        'guardian_id',
        'message',
        'response_received',
        'response_type',
        'response_at',
        'created_at',
      ],
      insertedAppointments
        .filter((appointment) => ['scheduled', 'confirmed', 'rescheduled'].includes(appointment.status))
        .slice(0, 7000)
        .map((appointment) => {
          const createdAt = addDays(new Date(appointment.scheduled_date), -1);
          const responseReceived = chance(0.72);
          return [
            appointment.id,
            appointment.guardian_id,
            `${DEMO_MARKER} Please confirm ${appointment.control_number} for your child vaccination visit.`,
            responseReceived,
            responseReceived ? weightedPick([
              { value: 'confirmed', weight: 72 },
              { value: 'reschedule_requested', weight: 18 },
              { value: 'cancelled', weight: 10 },
            ]) : null,
            responseReceived ? addDays(createdAt, 1) : null,
            createdAt,
          ];
        }),
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'immunization_records',
      [
        'patient_id',
        'vaccine_id',
        'batch_id',
        'admin_date',
        'next_due_date',
        'status',
        'notes',
        'administered_by',
        'created_at',
        'updated_at',
        'is_active',
        'dose_no',
        'site_of_injection',
        'reactions',
        'health_care_provider',
        'schedule_id',
        'lot_number',
        'batch_number',
      ],
      immunizationRows,
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'vaccination_records',
      [
        'infant_id',
        'vaccine_id',
        'batch_id',
        'dose_no',
        'admin_date',
        'administered_by',
        'vaccinator_id',
        'dosage',
        'site_of_injection',
        'reactions',
        'next_due_date',
        'notes',
        'is_active',
        'created_at',
        'updated_at',
      ],
      legacyVaccinationRows,
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'vaccination_reminders',
      [
        'infant_id',
        'vaccine_id',
        'due_date',
        'reminder_date',
        'status',
        'sent_at',
        'created_at',
        'updated_at',
        'patient_id',
        'guardian_id',
        'dose_number',
        'scheduled_date',
        'notification_id',
        'is_read',
        'is_completed',
        'completed_at',
        'notes',
      ],
      reminderRows,
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'transfer_in_cases',
      [
        'guardian_id',
        'infant_id',
        'source_facility',
        'submitted_vaccines',
        'vaccination_card_url',
        'remarks',
        'next_recommended_vaccine',
        'auto_computed_next_vaccine',
        'validation_status',
        'validation_notes',
        'validation_priority',
        'triage_category',
        'auto_approved',
        'created_at',
        'updated_at',
        'validated_at',
        'validated_by',
      ],
      transferCaseRows.slice(0, 600),
      { chunkSize: 200 },
    );

    const insertedWaitlistRows = await insertRows(
      client,
      'vaccine_waitlist',
      ['infant_id', 'vaccine_id', 'guardian_id', 'clinic_id', 'status', 'notified_at', 'created_at', 'updated_at'],
      waitlistRows.slice(0, 320),
      { chunkSize: 200, returningColumns: ['id', 'infant_id', 'vaccine_id', 'guardian_id', 'status', 'created_at'] },
    );

    await insertRows(
      client,
      'vaccine_availability_notifications',
      [
        'waitlist_id',
        'infant_id',
        'vaccine_id',
        'guardian_id',
        'notification_type',
        'message',
        'status',
        'sent_at',
        'created_at',
      ],
      insertedWaitlistRows
        .filter((row) => ['notified', 'resolved'].includes(row.status) || chance(0.48))
        .slice(0, 220)
        .map((row) => [
          row.id,
          row.infant_id,
          row.vaccine_id,
          row.guardian_id,
          'availability_update',
          `${DEMO_MARKER} Vaccine slot is available for your child. Please confirm your visit.`,
          chance(0.8) ? 'sent' : 'queued',
          chance(0.8) ? addDays(new Date(row.created_at), 1) : null,
          row.created_at,
        ]),
      { chunkSize: 200 },
    );

    console.log(`Inserted ${immunizationRows.length} immunization rows, ${insertedAppointments.length} appointments`);

    console.log('\n[6/8] Populating reminders, notifications, announcements, messages, growth, documents, and reports...');
    const reminderNotificationRows = reminderRows.map((reminder, index) => {
      const guardianId = reminder[9];
      const guardianUserId = guardianUserIdByGuardianId.get(guardianId);
      const child = children.find((entry) => entry.guardianId === guardianId && entry.patientId === reminder[8]);
      const createdAt = reminder[6];
      return [
        'appointment_reminder',
        'guardian',
        guardianId,
        child ? `${child.firstName} ${child.lastName}` : 'Guardian',
        child ? families[child.familySequence - 1].guardian.email : null,
        child ? families[child.familySequence - 1].guardian.phone : null,
        weightedPick([
          { value: 'sms', weight: 48 },
          { value: 'push', weight: 22 },
          { value: 'both', weight: 30 },
        ]),
        weightedPick([
          { value: 'normal', weight: 55 },
          { value: 'high', weight: 35 },
          { value: 'urgent', weight: 10 },
        ]),
        weightedPick([
          { value: 'sent', weight: 30 },
          { value: 'delivered', weight: 34 },
          { value: 'read', weight: 24 },
          { value: 'queued', weight: 12 },
        ]),
        createdAt,
        chance(0.82) ? addDays(createdAt, 1) : null,
        chance(0.56) ? addDays(createdAt, 1) : null,
        chance(0.3) ? addDays(createdAt, 2) : null,
        null,
        null,
        0,
        2,
        `Vaccination Reminder #${index + 1}`,
        `${DEMO_MARKER} Reminder: your child has a vaccination appointment scheduled on ${reminder[11]}.`,
        null,
        safeJson({ appointmentDate: reminder[11] }),
        'appointments',
        null,
        null,
        safeJson({ window: 'defense-demo' }),
        safeJson({ status: 'visible' }),
        null,
        'en-PH',
        'Asia/Manila',
        false,
        null,
        null,
        null,
        safeJson(['guardian-dashboard', 'appointments']),
        safeJson({ source: 'vaccination_reminders' }),
        staffUsers[0]?.id || null,
        null,
        null,
        createdAt,
        createdAt,
        guardianUserId,
        guardianId,
        'guardian',
        `Upcoming vaccination for ${child ? child.firstName : 'your child'}`,
        chance(0.35),
        `/guardian/appointments?date=${reminder[11]}`,
      ];
    });

    const adminNotificationRows = inventoryDetails
      .filter((detail) => detail.stockOnHand <= 45 && detail.periodStart <= CURRENT_DATE)
      .slice(0, 1200)
      .map((detail) => {
        const vaccine = [...referenceData.vaccinesByCode.values()].find((row) => row.id === detail.vaccineId);
        const createdAt = addDays(detail.periodStart, 26);
        const adminUser = pick(staffUsers);
        return [
          'inventory_alert',
          'user',
          adminUser.id,
          `${adminUser.first_name} ${adminUser.last_name}`,
          adminUser.email,
          adminUser.contact,
          'push',
          detail.stockOnHand <= 20 ? 'urgent' : 'high',
          chance(0.45) ? 'read' : 'delivered',
          createdAt,
          createdAt,
          createdAt,
          chance(0.45) ? addDays(createdAt, 1) : null,
          null,
          null,
          0,
          1,
          `Stock alert for ${vaccine?.name || detail.vaccineCode}`,
          `${DEMO_MARKER} ${vaccine?.name || detail.vaccineCode} stock is ${detail.stockOnHand} for ${monthName(detail.periodStart)} ${detail.periodStart.getUTCFullYear()}.`,
          null,
          safeJson({ stockOnHand: detail.stockOnHand }),
          'inventory',
          null,
          null,
          safeJson({ visibleInDashboard: true }),
          safeJson({ thresholdTriggered: detail.stockOnHand <= 20 ? 'critical' : 'low' }),
          null,
          'en-PH',
          'Asia/Manila',
          false,
          null,
          null,
          null,
          safeJson(['admin-dashboard', 'inventory']),
          safeJson({ source: 'inventory_alerts' }),
          adminUser.id,
          null,
          null,
          createdAt,
          createdAt,
          adminUser.id,
          null,
          'admin',
          `Inventory alert: ${vaccine?.name || detail.vaccineCode}`,
          chance(0.45),
          '/admin/inventory-management?tab=stock-alerts',
        ];
      });

    const insertedNotifications = await insertRows(
      client,
      'notifications',
      [
        'notification_type',
        'target_type',
        'target_id',
        'recipient_name',
        'recipient_email',
        'recipient_phone',
        'channel',
        'priority',
        'status',
        'scheduled_for',
        'sent_at',
        'delivered_at',
        'read_at',
        'failed_at',
        'failure_reason',
        'retry_count',
        'max_retries',
        'subject',
        'message',
        'template_id',
        'template_data',
        'related_entity_type',
        'related_entity_id',
        'external_message_id',
        'provider_response',
        'delivery_status',
        'cost',
        'language',
        'timezone',
        'requires_response',
        'response_deadline',
        'response_received',
        'response_at',
        'tags',
        'metadata',
        'created_by',
        'cancelled_by',
        'cancelled_at',
        'created_at',
        'updated_at',
        'user_id',
        'guardian_id',
        'target_role',
        'title',
        'is_read',
        'action_url',
      ],
      [...reminderNotificationRows, ...adminNotificationRows],
      {
        chunkSize: 200,
        returningColumns: ['id', 'channel', 'guardian_id', 'user_id', 'message', 'status', 'recipient_phone', 'recipient_name', 'created_at'],
      },
    );

    const announcementRows = [];
    let announcementSequence = 1;
    const announcementMonths = batchPlan.periods.filter((_, index) => index % 2 === 0);
    for (const period of announcementMonths) {
      const template = ANNOUNCEMENT_TEMPLATES[(announcementSequence - 1) % ANNOUNCEMENT_TEMPLATES.length];
      const createdBy = pick(staffUsers).id;
      const startDate = addDays(period, randomInt(0, 4));
      const endDate = addDays(endOfMonth(period), randomInt(10, 35));
      announcementRows.push([
        `${template.title} ${period.getUTCFullYear()}`,
        template.content,
        template.priority,
        'published',
        template.target_audience,
        toIsoDate(startDate),
        toIsoDate(endDate),
        startDate,
        true,
        endDate,
        createdBy,
        startDate,
        startDate,
        null,
      ]);
      announcementSequence += 1;
    }

    const insertedAnnouncements = await insertRows(
      client,
      'announcements',
      [
        'title',
        'content',
        'priority',
        'status',
        'target_audience',
        'start_date',
        'end_date',
        'published_at',
        'is_active',
        'expires_at',
        'created_by',
        'created_at',
        'updated_at',
        'deleted_at',
      ],
      announcementRows,
      { chunkSize: 120, returningColumns: ['id', 'title', 'created_at', 'target_audience'] },
    );

    const guardianAnnouncementRows = [];
    for (const announcement of insertedAnnouncements) {
      const recipients = sample(families, 260);
      for (const recipient of recipients) {
        guardianAnnouncementRows.push([
          announcement.id,
          recipient.guardianUserId,
          recipient.guardianId,
          null,
          announcement.target_audience,
          weightedPick([
            { value: 'in_app', weight: 45 },
            { value: 'sms', weight: 30 },
            { value: 'email', weight: 25 },
          ]),
          weightedPick([
            { value: 'delivered', weight: 48 },
            { value: 'read', weight: 26 },
            { value: 'sent', weight: 20 },
            { value: 'queued', weight: 6 },
          ]),
          randomInt(1, 2),
          announcement.created_at,
          addDays(new Date(announcement.created_at), 1),
          addDays(new Date(announcement.created_at), 1),
          chance(0.28) ? addDays(new Date(announcement.created_at), 2) : null,
          null,
          null,
          safeJson({ audience: 'guardian' }),
          announcement.created_at,
          announcement.created_at,
        ]);
      }
    }

    await insertRows(
      client,
      'announcement_recipient_deliveries',
      [
        'announcement_id',
        'recipient_user_id',
        'recipient_guardian_id',
        'notification_id',
        'resolved_target_audience',
        'delivery_channel',
        'delivery_status',
        'delivery_attempts',
        'queued_at',
        'sent_at',
        'delivered_at',
        'read_at',
        'failed_at',
        'failure_reason',
        'metadata',
        'created_at',
        'updated_at',
      ],
      guardianAnnouncementRows,
      { chunkSize: 200 },
    );

    const messageRows = [];
    for (let index = 0; index < 3200; index += 1) {
      const child = pick(children);
      const guardianUser = insertedGuardianUsers.find((user) => user.guardian_id === child.guardianId);
      const staffUser = pick(staffUsers);
      const createdAt = randomDateBetween(WINDOW_START, CURRENT_DATE);
      const guardianStartsThread = chance(0.58);
      messageRows.push([
        guardianStartsThread ? guardianUser.id : staffUser.id,
        guardianStartsThread ? staffUser.id : guardianUser.id,
        child.guardianId,
        child.infantId,
        pick(MESSAGE_SUBJECTS),
        pick(MESSAGE_BODIES),
        guardianStartsThread ? 'guardian_inquiry' : 'staff_reply',
        guardianStartsThread ? 'normal' : weightedPick([
          { value: 'normal', weight: 72 },
          { value: 'high', weight: 28 },
        ]),
        weightedPick([
          { value: 'sent', weight: 24 },
          { value: 'delivered', weight: 42 },
          { value: 'read', weight: 34 },
        ]),
        chance(0.36),
        chance(0.36) ? addDays(createdAt, 1) : null,
        null,
        null,
        safeJson({ childControlNumber: child.controlNumber }),
        null,
        createdAt,
        createdAt,
        null,
      ]);
    }

    await insertRows(
      client,
      'messages',
      [
        'sender_id',
        'recipient_id',
        'guardian_id',
        'infant_id',
        'subject',
        'content',
        'message_type',
        'priority',
        'status',
        'is_read',
        'read_at',
        'parent_message_id',
        'attachments',
        'metadata',
        'expires_at',
        'created_at',
        'updated_at',
        'conversation_id',
      ],
      messageRows,
      { chunkSize: 200 },
    );

    const growthRecordRows = [];
    const legacyGrowthRows = [];
    const infantGrowthRows = [];
    const patientGrowthRows = [];
    const growthNoteOptions = [
      'Growth is appropriate for age.',
      'Guardian advised to continue exclusive breastfeeding and routine follow-up.',
      'Weight gain remains within expected range.',
      'No acute nutritional concern noted during visit.',
    ];

    for (const child of children) {
      const checkpoints = [
        addDays(child.dob, 30),
        addDays(child.dob, 180),
        addDays(child.dob, 365),
      ].filter((checkpoint) => checkpoint <= CURRENT_DATE);

      for (const checkpoint of checkpoints.slice(0, chance(0.72) ? 2 : 3)) {
        const measurement = buildGrowthMeasurement(child.dob, checkpoint, child.sex);
        const createdBy = pick(staffUsers).id;

        growthRecordRows.push([
          child.infantId,
          toIsoDate(checkpoint),
          measurement.weight,
          measurement.height,
          measurement.headCircumference,
          pick(growthNoteOptions),
          createdBy,
          checkpoint,
          checkpoint,
          measurement.ageDays,
        ]);

        legacyGrowthRows.push([
          child.infantId,
          toIsoDate(checkpoint),
          measurement.weight,
          measurement.height,
          measurement.headCircumference,
          measurement.ageDays,
          pick(growthNoteOptions),
          createdBy,
          checkpoint,
          checkpoint,
        ]);

        infantGrowthRows.push([
          child.infantId,
          toIsoDate(checkpoint),
          measurement.ageDays,
          measurement.weight,
          measurement.height,
          measurement.headCircumference,
          randomFloat(15, 18),
          randomFloat(20, 85),
          randomFloat(20, 85),
          randomFloat(18, 82),
          randomFloat(18, 82),
          randomFloat(-1.1, 1.2),
          randomFloat(-1.1, 1.2),
          randomFloat(-1.0, 1.1),
          randomFloat(-1.0, 1.0),
          'digital_scale',
          createdBy,
          DEFAULT_CLINIC_LABEL,
          pick(growthNoteOptions),
          0,
          0,
          '09:00:00',
          'unknown',
          chance(0.84) ? 'well' : 'minor_illness',
          null,
          false,
          null,
          null,
          null,
          null,
          null,
          'normal',
          weightedPick([
            { value: 'normal', weight: 84 },
            { value: 'underweight', weight: 7 },
            { value: 'overweight', weight: 5 },
            { value: 'wasted', weight: 4 },
          ]),
          safeJson({ sitting: measurement.ageDays > 180, crawling: measurement.ageDays > 240 }),
          null,
          pick(growthNoteOptions),
          chance(0.14),
          chance(0.14) ? addDays(checkpoint, 30) : null,
          null,
          true,
          createdBy,
          createdBy,
          checkpoint,
          checkpoint,
        ]);

        patientGrowthRows.push([
          child.patientId,
          toIsoDate(checkpoint),
          measurement.weight,
          measurement.height,
          measurement.headCircumference,
          randomFloat(20, 85),
          randomFloat(20, 85),
          randomFloat(20, 85),
          pick(growthNoteOptions),
          createdBy,
          checkpoint,
          checkpoint,
          true,
          measurement.ageDays,
        ]);
      }
    }

    await insertRows(
      client,
      'growth_records',
      ['infant_id', 'record_date', 'weight', 'height', 'head_circumference', 'notes', 'recorded_by', 'created_at', 'updated_at', 'age_in_days'],
      growthRecordRows,
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'growth',
      ['infant_id', 'date_recorded', 'weight_kg', 'height_cm', 'head_circumference_cm', 'age_in_days', 'notes', 'created_by', 'created_at', 'updated_at'],
      legacyGrowthRows,
      { chunkSize: 250 },
    );

    await insertRows(
      client,
      'infant_growth',
      [
        'infant_id',
        'measurement_date',
        'age_in_days',
        'weight_kg',
        'length_cm',
        'head_circumference_cm',
        'bmi',
        'weight_for_age_percentile',
        'length_for_age_percentile',
        'weight_for_length_percentile',
        'head_circumference_percentile',
        'weight_z_score',
        'length_z_score',
        'bmi_z_score',
        'head_circumference_z_score',
        'measurement_method',
        'measured_by',
        'measurement_location',
        'notes',
        'clothing_weight_kg',
        'diaper_weight_kg',
        'measurement_time',
        'feeding_status',
        'health_status',
        'temperature_celsius',
        'is_outlier',
        'outlier_reason',
        'previous_weight_kg',
        'previous_length_cm',
        'weight_velocity',
        'length_velocity',
        'growth_pattern',
        'nutritional_status',
        'development_milestones',
        'parent_concerns',
        'healthcare_worker_notes',
        'follow_up_required',
        'follow_up_date',
        'follow_up_reason',
        'is_active',
        'created_by',
        'updated_by',
        'created_at',
        'updated_at',
      ],
      infantGrowthRows,
      { chunkSize: 150 },
    );

    await insertRows(
      client,
      'patient_growth',
      [
        'patient_id',
        'measurement_date',
        'weight',
        'height',
        'head_circumference',
        'weight_for_age_percentile',
        'height_for_age_percentile',
        'weight_for_height_percentile',
        'notes',
        'measured_by',
        'created_at',
        'updated_at',
        'is_active',
        'age_in_days',
      ],
      patientGrowthRows,
      { chunkSize: 250 },
    );

    const documentsRows = [];
    const infantDocumentRows = [];
    const healthRecordRows = [];
    const documentDownloadRows = [];

    for (const child of sample(children, 1800)) {
      const createdBy = pick(staffUsers).id;
      const createdAt = randomDateBetween(WINDOW_START, CURRENT_DATE);
      documentsRows.push([
        child.infantId,
        null,
        weightedPick([
          { value: 'immunization_card', weight: 44 },
          { value: 'growth_chart', weight: 28 },
          { value: 'consultation_summary', weight: 28 },
        ]),
        `/documents/${child.controlNumber}.pdf`,
        `${child.controlNumber}.pdf`,
        randomInt(85000, 420000),
        createdBy,
        randomInt(0, 5),
        'available',
        createdAt,
        createdAt,
      ]);

      infantDocumentRows.push([
        child.patientId,
        weightedPick([
          { value: 'birth_certificate', weight: 36 },
          { value: 'vaccination_card', weight: 44 },
          { value: 'medical_record', weight: 12 },
          { value: 'other', weight: 8 },
        ]),
        `/uploads/infants/${child.controlNumber}.pdf`,
        `${child.controlNumber}.pdf`,
        'application/pdf',
        randomInt(90000, 480000),
        createdBy,
        createdAt,
        `${DEMO_MARKER} uploaded document for portal access`,
        true,
        createdAt,
        createdAt,
      ]);

      if (chance(0.5)) {
        healthRecordRows.push([
          child.infantId,
          weightedPick([
            { value: 'immunization_card', weight: 48 },
            { value: 'growth_chart', weight: 18 },
            { value: 'medical_report', weight: 20 },
            { value: 'consultation_note', weight: 14 },
          ]),
          'Routine Health Record',
          `${DEMO_MARKER} record prepared for guardian download and admin review`,
          `/health-records/${child.controlNumber}.pdf`,
          `${child.controlNumber}.pdf`,
          randomInt(120000, 520000),
          'application/pdf',
          '.pdf',
          toIsoDate(createdAt),
          toIsoDate(createdAt),
          DEFAULT_CLINIC_LABEL,
          formatLandline(),
          false,
          false,
          'not_required',
          null,
          null,
          null,
          safeJson(['defense-demo']),
          safeJson({ childControlNumber: child.controlNumber }),
          null,
          null,
          true,
          1,
          null,
          createdBy,
          pick(staffUsers).id,
          addDays(createdAt, 1),
          'Reviewed and validated for demo dataset',
          null,
          null,
          randomInt(0, 6),
          chance(0.4) ? addDays(createdAt, randomInt(3, 24)) : null,
          safeJson({ accesses: randomInt(0, 6) }),
          createdAt,
          createdAt,
        ]);
      }

      if (chance(0.78)) {
        documentDownloadRows.push([
          null,
          child.infantId,
          child.guardianUserId,
          addDays(createdAt, randomInt(1, 30)),
          weightedPick([
            { value: 'completed', weight: 88 },
            { value: 'failed', weight: 4 },
            { value: 'queued', weight: 8 },
          ]),
          createdAt,
          child.patientId,
        ]);
      }
    }

    await insertRows(
      client,
      'documents',
      ['infant_id', 'template_id', 'document_type', 'file_path', 'file_name', 'file_size', 'generated_by', 'download_count', 'status', 'created_at', 'updated_at'],
      documentsRows,
      { chunkSize: 200 },
    );

    await insertRows(
      client,
      'infant_documents',
      ['infant_id', 'document_type', 'file_path', 'original_filename', 'mime_type', 'file_size', 'uploaded_by', 'uploaded_at', 'description', 'is_active', 'created_at', 'updated_at'],
      infantDocumentRows,
      { chunkSize: 200 },
    );

    await insertRows(
      client,
      'health_records',
      [
        'infant_id',
        'record_type',
        'title',
        'description',
        'file_path',
        'original_filename',
        'file_size',
        'mime_type',
        'file_extension',
        'document_date',
        'visit_date',
        'healthcare_provider',
        'provider_contact',
        'is_confidential',
        'requires_signature',
        'signature_status',
        'signed_by',
        'signed_at',
        'signature_notes',
        'tags',
        'metadata',
        'ocr_text',
        'thumbnail_path',
        'is_active',
        'version',
        'parent_record_id',
        'uploaded_by',
        'reviewed_by',
        'reviewed_at',
        'review_notes',
        'expiry_date',
        'reminder_date',
        'access_count',
        'last_accessed',
        'access_log',
        'created_at',
        'updated_at',
      ],
      healthRecordRows,
      { chunkSize: 150 },
    );

    await insertRows(
      client,
      'document_downloads',
      ['template_id', 'infant_id', 'user_id', 'download_date', 'download_status', 'created_at', 'patient_id'],
      documentDownloadRows,
      { chunkSize: 200 },
    );

    const reportRows = [];
    for (const period of batchPlan.periods) {
      for (const type of ['inventory', 'vaccination', 'appointment']) {
        const generatedBy = pick(staffUsers).id;
        const createdAt = addDays(endOfMonth(period), randomInt(1, 4));
        reportRows.push([
          type,
          `${monthName(period)} ${period.getUTCFullYear()} ${type} report`,
          `${DEMO_MARKER} ${type} report for ${monthName(period)} ${period.getUTCFullYear()}`,
          safeJson({ month: monthKey(period), clinic: DEFAULT_HEALTH_CENTER }),
          `/reports/${type}-${monthKey(period)}.pdf`,
          'pdf',
          'completed',
          generatedBy,
          createdAt,
          addMonths(createdAt, 6),
          randomInt(0, 12),
          null,
          true,
          createdAt,
          createdAt,
          randomInt(120000, 860000),
        ]);
      }
    }

    await insertRows(
      client,
      'reports',
      ['type', 'title', 'description', 'parameters', 'file_path', 'file_format', 'status', 'generated_by', 'date_generated', 'expires_at', 'download_count', 'error_message', 'is_active', 'created_at', 'updated_at', 'file_size'],
      reportRows,
      { chunkSize: 150 },
    );

    console.log(`Inserted ${insertedNotifications.length} notifications, ${guardianAnnouncementRows.length} announcement deliveries`);

    console.log('\n[7/8] Writing sessions, admin logs, audit trails, SMS traces, and access activity...');
    const allOperationalUsers = [...staffUsers, ...insertedGuardianUsers];

    await insertRows(
      client,
      'sms_logs',
      [
        'phone_number',
        'message',
        'message_type',
        'status',
        'provider',
        'message_id',
        'metadata',
        'attempts',
        'sent_at',
        'failed_at',
        'error_message',
        'created_at',
        'message_content',
        'external_message_id',
        'gateway_response',
        'appointment_id',
        'error_details',
      ],
      insertedNotifications
        .filter((notification) => ['sms', 'both'].includes(notification.channel))
        .slice(0, 9000)
        .map((notification, index) => [
          notification.recipient_phone || formatMobile(),
          notification.message,
          'guardian_notification',
          notification.status === 'queued' ? 'pending' : notification.status,
          'demo-sms-gateway',
          buildReferenceNumber('SMS', index + 1),
          safeJson({ notificationId: notification.id }),
          safeJson([{ attempt: 1, status: notification.status }]),
          notification.status !== 'queued' ? addDays(new Date(notification.created_at), 1) : null,
          notification.status === 'failed' ? addDays(new Date(notification.created_at), 1) : null,
          notification.status === 'failed' ? 'Simulated demo gateway retry' : null,
          notification.created_at,
          notification.message,
          buildReferenceNumber('SMS-EXT', index + 1),
          notification.status === 'failed' ? 'Retry queued' : 'Accepted',
          null,
          null,
        ]),
      { chunkSize: 200 },
    );

    await insertRows(
      client,
      'notification_logs',
      ['recipient_type', 'recipient_id', 'notification_type', 'channel', 'subject', 'content', 'status', 'external_message_id', 'metadata', 'error_details', 'sent_at', 'delivered_at', 'failed_at', 'created_at', 'updated_at'],
      insertedNotifications.slice(0, 11000).map((notification, index) => [
        notification.guardian_id ? 'guardian' : 'user',
        notification.guardian_id || notification.user_id,
        'portal_notification',
        notification.channel === 'both' ? 'in_app' : notification.channel,
        notification.recipient_name || notification.message.slice(0, 40),
        notification.message,
        notification.status === 'read'
          ? 'delivered'
          : notification.status === 'queued'
            ? 'pending'
            : notification.status,
        buildReferenceNumber('NLOG', index + 1),
        safeJson({ sourceNotificationId: notification.id }),
        notification.status === 'failed' ? 'Simulated provider failure' : null,
        notification.status === 'queued' ? null : addDays(new Date(notification.created_at), 1),
        ['delivered', 'read'].includes(notification.status) ? addDays(new Date(notification.created_at), 1) : null,
        notification.status === 'failed' ? addDays(new Date(notification.created_at), 1) : null,
        notification.created_at,
        notification.created_at,
      ]),
      { chunkSize: 200 },
    );

    const sessionRows = [];
    for (let index = 0; index < 9500; index += 1) {
      const user = pick(allOperationalUsers);
      const loginTime = randomDateBetween(WINDOW_START, WINDOW_END);
      const activeSession = chance(0.22);
      const logoutTime = activeSession ? null : addDays(loginTime, 0);
      sessionRows.push([
        user.id,
        crypto.randomUUID(),
        `203.177.${randomInt(1, 254)}.${randomInt(1, 254)}`,
        chance(0.65) ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' : 'Mozilla/5.0 (Linux; Android 13)',
        safeJson({ device: chance(0.65) ? 'desktop' : 'mobile', browser: chance(0.5) ? 'Chrome' : 'Edge' }),
        safeJson({ city: DEFAULT_CITY, region: DEFAULT_REGION }),
        loginTime,
        logoutTime,
        activeSession ? addDays(loginTime, randomInt(0, 3)) : logoutTime,
        activeSession ? null : randomInt(180, 4200),
        activeSession,
        'password',
        null,
        safeJson([]),
        safeJson({ source: 'defense-demo' }),
        loginTime,
        loginTime,
        addDays(loginTime, 7),
      ]);
    }

    await insertRows(
      client,
      'user_sessions',
      ['user_id', 'session_token', 'ip_address', 'user_agent', 'device_info', 'location_info', 'login_time', 'logout_time', 'last_activity', 'session_duration', 'is_active', 'login_method', 'impersonated_by', 'security_events', 'metadata', 'created_at', 'updated_at', 'expires_at'],
      sessionRows,
      { chunkSize: 200 },
    );

    await insertRows(
      client,
      'access_logs',
      ['user_id', 'action', 'resource', 'ip_address', 'user_agent', 'timestamp', 'details', 'username', 'role', 'permission', 'path', 'method', 'resource_type', 'resource_id', 'status', 'accessed_at', 'created_at'],
      Array.from({ length: 9000 }, (_, index) => {
        const user = pick(allOperationalUsers);
        const timestamp = randomDateBetween(WINDOW_START, WINDOW_END);
        const isGuardian = insertedGuardianUsers.some((entry) => entry.id === user.id);
        return [
          user.id,
          weightedPick([
            { value: 'view', weight: 58 },
            { value: 'create', weight: 16 },
            { value: 'update', weight: 18 },
            { value: 'download', weight: 8 },
          ]),
          isGuardian ? 'guardian_dashboard' : 'admin_dashboard',
          `203.177.${randomInt(1, 254)}.${randomInt(1, 254)}`,
          chance(0.64) ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' : 'Mozilla/5.0 (Linux; Android 13)',
          timestamp,
          safeJson({ index }),
          user.username || user.email,
          isGuardian ? 'guardian' : 'staff',
          isGuardian ? 'dashboard:view' : 'inventory:view',
          isGuardian ? '/guardian/dashboard' : '/admin/dashboard',
          chance(0.72) ? 'GET' : 'POST',
          isGuardian ? 'guardian' : 'admin',
          randomInt(1, INFANT_TARGET),
          chance(0.93) ? 'success' : 'forbidden',
          timestamp,
          timestamp,
        ];
      }),
      { chunkSize: 200 },
    );

    await insertRows(
      client,
      'security_events',
      ['user_id', 'event_type', 'severity', 'ip_address', 'user_agent', 'resource_type', 'resource_id', 'details', 'created_at'],
      Array.from({ length: 420 }, () => {
        const user = pick(allOperationalUsers);
        const createdAt = randomDateBetween(WINDOW_START, WINDOW_END);
        return [
          user.id,
          weightedPick([
            { value: 'login_success', weight: 48 },
            { value: 'password_change', weight: 16 },
            { value: 'login_failure', weight: 18 },
            { value: 'session_expired', weight: 18 },
          ]),
          weightedPick([
            { value: 'low', weight: 58 },
            { value: 'medium', weight: 32 },
            { value: 'high', weight: 10 },
          ]),
          `203.177.${randomInt(1, 254)}.${randomInt(1, 254)}`,
          'Mozilla/5.0',
          chance(0.55) ? 'auth' : 'dashboard',
          randomInt(1, INFANT_TARGET),
          safeJson({ marker: DEMO_MARKER }),
          createdAt,
        ];
      }),
      { chunkSize: 200 },
    );

    await insertRows(
      client,
      'admin_activity_log',
      ['admin_id', 'action', 'ip_address', 'user_agent', 'details', 'created_at'],
      Array.from({ length: 3200 }, (_, index) => {
        const admin = pick(staffUsers);
        const createdAt = randomDateBetween(WINDOW_START, WINDOW_END);
        return [
          admin.id,
          weightedPick([
            { value: 'reviewed_inventory', weight: 26 },
            { value: 'validated_transfer_case', weight: 18 },
            { value: 'published_announcement', weight: 14 },
            { value: 'generated_report', weight: 18 },
            { value: 'updated_appointment_status', weight: 24 },
          ]),
          `203.177.${randomInt(1, 254)}.${randomInt(1, 254)}`,
          'Mozilla/5.0',
          safeJson({ sequence: index + 1, marker: DEMO_MARKER }),
          createdAt,
        ];
      }),
      { chunkSize: 200 },
    );

    await insertRows(
      client,
      'audit_logs',
      ['user_id', 'event_type', 'entity_type', 'entity_id', 'old_values', 'new_values', 'metadata', 'timestamp', 'ip_address', 'user_agent'],
      Array.from({ length: 7200 }, (_, index) => {
        const actor = pick([...staffUsers, ...insertedGuardianUsers.slice(0, 600)]);
        const timestamp = randomDateBetween(WINDOW_START, WINDOW_END);
        return [
          actor.id,
          weightedPick([
            { value: 'appointment.update', weight: 26 },
            { value: 'inventory.transaction', weight: 18 },
            { value: 'notification.dispatch', weight: 18 },
            { value: 'report.generate', weight: 14 },
            { value: 'guardian.login', weight: 24 },
          ]),
          weightedPick([
            { value: 'appointments', weight: 26 },
            { value: 'vaccine_inventory_transactions', weight: 16 },
            { value: 'notifications', weight: 18 },
            { value: 'reports', weight: 14 },
            { value: 'patients', weight: 26 },
          ]),
          randomInt(1, INFANT_TARGET),
          null,
          safeJson({ auditIndex: index + 1, marker: DEMO_MARKER }),
          safeJson({ actorRole: actor.role || 'guardian' }),
          timestamp,
          `203.177.${randomInt(1, 254)}.${randomInt(1, 254)}`,
          'Mozilla/5.0',
        ];
      }),
      { chunkSize: 200 },
    );

    await client.query(`
      UPDATE users AS u
      SET role = r.name
      FROM roles AS r
      WHERE u.role_id = r.id
        AND COALESCE(u.role, '') <> COALESCE(r.name, '')
    `);

    console.log('\n[8/8] Final verification...');
    const verificationQueries = await Promise.all([
      client.query(`SELECT COUNT(*)::int AS count FROM patients`),
      client.query(`SELECT COUNT(*)::int AS count FROM infants`),
      client.query(`SELECT COUNT(*)::int AS count FROM guardians`),
      client.query(`SELECT COUNT(*)::int AS count FROM users WHERE guardian_id IS NOT NULL`),
      client.query(`SELECT COUNT(*)::int AS count FROM parent_guardian`),
      client.query(`SELECT COUNT(*)::int AS count FROM immunization_records`),
      client.query(`SELECT COUNT(*)::int AS count FROM appointments`),
      client.query(`SELECT COUNT(*)::int AS count FROM vaccination_reminders`),
      client.query(`SELECT COUNT(*)::int AS count FROM notifications`),
      client.query(`SELECT COUNT(*)::int AS count FROM vaccine_inventory_transactions`),
      client.query(`SELECT COUNT(*)::int AS count FROM inventory_transactions`),
      client.query(`
        SELECT COUNT(*)::int AS count
        FROM users AS u
        JOIN roles AS r ON r.id = u.role_id
        WHERE COALESCE(u.role, '') <> COALESCE(r.name, '')
      `),
    ]);

    const counts = {
      patients: verificationQueries[0].rows[0].count,
      infants: verificationQueries[1].rows[0].count,
      guardians: verificationQueries[2].rows[0].count,
      guardian_users: verificationQueries[3].rows[0].count,
      parent_guardian: verificationQueries[4].rows[0].count,
      immunization_records: verificationQueries[5].rows[0].count,
      appointments: verificationQueries[6].rows[0].count,
      vaccination_reminders: verificationQueries[7].rows[0].count,
      notifications: verificationQueries[8].rows[0].count,
      vaccine_inventory_transactions: verificationQueries[9].rows[0].count,
      inventory_transactions: verificationQueries[10].rows[0].count,
      role_mismatches: verificationQueries[11].rows[0].count,
    };

    const totalTransactions =
      counts.immunization_records +
      counts.appointments +
      counts.vaccination_reminders +
      counts.notifications +
      counts.vaccine_inventory_transactions +
      counts.inventory_transactions +
      guardianAnnouncementRows.length +
      messageRows.length +
      growthRecordRows.length +
      legacyGrowthRows.length +
      infantGrowthRows.length +
      patientGrowthRows.length +
      sessionRows.length +
      documentsRows.length +
      reportRows.length;

    if (counts.patients < INFANT_TARGET || counts.infants < INFANT_TARGET) {
      throw new Error(`Seed validation failed: expected at least ${INFANT_TARGET} patients and infants.`);
    }

    if (counts.guardians !== counts.guardian_users) {
      throw new Error(
        `Seed validation failed: expected guardian records (${counts.guardians}) to match linked guardian user accounts (${counts.guardian_users}).`,
      );
    }

    if (counts.role_mismatches > 0) {
      throw new Error(`Seed validation failed: found ${counts.role_mismatches} users with mismatched role strings.`);
    }

    if (totalTransactions < MIN_TOTAL_TRANSACTIONS) {
      throw new Error(
        `Seed validation failed: expected at least ${MIN_TOTAL_TRANSACTIONS} activity rows, got ${totalTransactions}.`,
      );
    }

    await client.query('COMMIT');
    inTransaction = false;

    console.log('\nDONE');
    console.log('-'.repeat(72));
    console.log(`Guardians: ${counts.guardians}`);
    console.log(`Guardian User Accounts: ${counts.guardian_users}`);
    console.log(`Patients: ${counts.patients}`);
    console.log(`Infants: ${counts.infants}`);
    console.log(`Parent Guardian Links: ${counts.parent_guardian}`);
    console.log(`Immunization Records: ${counts.immunization_records}`);
    console.log(`Appointments: ${counts.appointments}`);
    console.log(`Vaccination Reminders: ${counts.vaccination_reminders}`);
    console.log(`Notifications: ${counts.notifications}`);
    console.log(`Inventory Transactions: ${counts.inventory_transactions}`);
    console.log(`Inventory Movement Rows: ${counts.vaccine_inventory_transactions}`);
    console.log(`Announcement Deliveries: ${guardianAnnouncementRows.length}`);
    console.log(`Messages: ${messageRows.length}`);
    console.log(`Approx. total transaction/activity rows: ${totalTransactions}`);
    console.log(`Guardian login password: ${DEFAULT_GUARDIAN_PASSWORD}`);
    console.log(`Staff login password: ${DEFAULT_STAFF_PASSWORD}`);
    console.log('-'.repeat(72));
  } catch (error) {
    if (inTransaction) {
      await client.query('ROLLBACK');
    }
    console.error('\nRESEED FAILED');
    console.error(error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

module.exports = {
  reseedDefenseDemoDataset,
};

if (require.main === module) {
  reseedDefenseDemoDataset()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
