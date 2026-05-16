/**
 * Test Data Generator for Immunicare
 * Generates 10M transactions and 100K infants over 5 years
 *
 * Usage: node generate_test_data.js [options]
 * Options:
 *   --infants=N       Number of infants to generate (default: 100000)
 *   --transactions=N  Approx transactions per infant (default: 100)
 *   --years=N         Years of data (default: 5)
 *   --batch=N         Batch size for inserts (default: 1000)
 *   --skip-master     Skip master data generation
 *
 * Example: node generate_test_data.js --infants=1000 --transactions=50
 */

const pool = require('./db');
require('fs');
require('path');
const { isDateAvailableForBooking } = require('./config/holidays');

// Configuration
const CONFIG = {
  infants:
    parseInt(process.argv.find((arg) => arg.startsWith('--infants='))?.split('=')[1]) || 100000,
  transactionsPerInfant:
    parseInt(process.argv.find((arg) => arg.startsWith('--transactions='))?.split('=')[1]) || 100,
  years: parseInt(process.argv.find((arg) => arg.startsWith('--years='))?.split('=')[1]) || 5,
  batchSize:
    parseInt(process.argv.find((arg) => arg.startsWith('--batch='))?.split('=')[1]) || 1000,
  skipMaster: process.argv.includes('--skip-master'),
};

console.log('========================================');
console.log('IMMUNICARE TEST DATA GENERATOR');
console.log('========================================');
console.log('Configuration:', CONFIG);
console.log('');

// Helper functions
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randomDate = (start, end) =>
  new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
const randomElement = (arr) => arr[Math.floor(Math.random() * arr.length)];

const shiftToBookableDate = (value, direction = 1, maxSteps = 366) => {
  const cursor = new Date(value);
  cursor.setHours(12, 0, 0, 0);

  let steps = 0;
  while (steps < maxSteps) {
    if (isDateAvailableForBooking(cursor, { allowPast: true }).isAvailable) {
      return cursor;
    }

    cursor.setDate(cursor.getDate() + direction);
    steps += 1;
  }

  return null;
};

// Philippine names
const firstNames = [
  'Maria',
  'Juan',
  'Ana',
  'Pedro',
  'Jose',
  'Rosa',
  'Carlos',
  'Carmen',
  'Miguel',
  'Elena',
  'Gabriel',
  'Lucia',
  'Rafael',
  'Sofia',
  'Diego',
  'Isabella',
  'Alejandro',
  'Valentina',
  'Javier',
  'Emma',
  'Adrian',
  'Mariana',
  'Daniel',
  'Victoria',
  'Fernando',
  'Renata',
  'Sebastian',
  'Emilia',
  'Pablo',
  'Lucia',
];

const lastNames = [
  'Garcia',
  'Rodriguez',
  'Martinez',
  'Hernandez',
  'Lopez',
  'Gonzalez',
  'Perez',
  'Sanchez',
  'Ramirez',
  'Torres',
  'Flores',
  'Rivera',
  'Gomez',
  'Diaz',
  'Cruz',
  'Reyes',
  'Morales',
  'Ortiz',
  'Gutierrez',
  'Chavez',
  'Ramos',
  'Mendoza',
  'Ruiz',
  'Alvarez',
  'Castillo',
  'Jimenez',
  'Vargas',
  'Romero',
  'Herrera',
  'Medina',
];

const barangays = [
  'Barangay 1',
  'Barangay 2',
  'Barangay 3',
  'Barangay 4',
  'Barangay 5',
  'Barangay 6',
  'Barangay 7',
  'Barangay 8',
  'Barangay 9',
  'Barangay 10',
  'Poblacion',
  'San Jose',
  'San Miguel',
  'San Juan',
  'Santa Cruz',
  'Santa Maria',
  'Santo Niño',
  'Holy Trinity',
  'Goodwill',
  'Peace',
];

const appointmentTypes = [
  'Vaccination',
  'Check-up',
  'Follow-up',
  'Growth Monitoring',
  'Consultation',
];

async function generateMasterData() {
  console.log('Generating master data...');

  // Check if master data already exists
  const existingClinics = await pool.query('SELECT COUNT(*) as count FROM clinics');
  if (parseInt(existingClinics.rows[0].count) > 0 && CONFIG.skipMaster) {
    console.log('Master data already exists, skipping...');
    return;
  }

  // Generate clinics
  console.log('Creating clinics...');
  const clinics = [];
  for (let i = 1; i <= 50; i++) {
    clinics.push({
      name: `Health Center ${i}`,
      region: `Region ${randomInt(1, 17)}`,
      address: `${randomElement(barangays)}, City/Municipality ${i}`,
      contact: `+63${randomInt(9000000000, 9999999999)}`,
    });
  }

  for (const clinic of clinics) {
    await pool.query(
      'INSERT INTO clinics (name, region, address, contact) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
      [clinic.name, clinic.region, clinic.address, clinic.contact]
    );
  }
  console.log(`Created ${clinics.length} clinics`);

  // Generate roles (if not exist)
  console.log('Setting up roles...');
  await pool.query(`
        INSERT INTO roles (name, display_name, is_system_role, hierarchy_level) VALUES 
        ('admin', 'Administrator', true, 100),
        ('nurse', 'Nurse', false, 30),
        ('midwife', 'Midwife', false, 25),
        ('health_worker', 'Health Worker', false, 20),
        ('guardian', 'Guardian', false, 10)
        ON CONFLICT (name) DO NOTHING
    `);

  // Generate healthcare workers
  console.log('Creating healthcare workers...');

  const roles = await pool.query('SELECT id, name FROM roles WHERE is_system_role = true');
  const clinicsResult = await pool.query('SELECT id FROM clinics');
  const clinicIds = clinicsResult.rows.map((r) => r.id);
  const roleIds = roles.rows;

  for (let i = 0; i < 500; i++) {
    const role = randomElement(roleIds);
    const clinicId = randomElement(clinicIds);
    randomElement(firstNames);
    randomElement(lastNames);

    await pool.query(
      `
            INSERT INTO users (username, password_hash, role_id, clinic_id, contact)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (username) DO NOTHING
        `,
      [
        `health_worker_${i}`,
        '$2b$10$placeholder',
        role.id,
        clinicId,
        `+63${randomInt(9000000000, 9999999999)}`,
      ]
    );
  }
  console.log('Created 500 healthcare workers');

  // Generate vaccines
  console.log('Creating vaccines...');
  const vaccineData = [
    { code: 'BCG', name: 'Bacillus Calmette-Guérin', doses: 1 },
    { code: 'HEP-B', name: 'Hepatitis B', doses: 3 },
    { code: 'PENTA', name: 'Pentavalent Vaccine', doses: 3 },
    { code: 'OPV', name: 'Oral Polio Vaccine', doses: 4 },
    { code: 'PCV', name: 'Pneumococcal Conjugate Vaccine', doses: 3 },
    { code: 'MR', name: 'Measles and Rubella', doses: 2 },
    { code: 'MMR', name: 'Measles, Mumps, Rubella', doses: 2 },
    { code: 'IPV', name: 'Inactivated Polio Vaccine', doses: 1 },
    { code: 'ROTA', name: 'Rotavirus Vaccine', doses: 2 },
    { code: 'VIT-A', name: 'Vitamin A Supplement', doses: 1 },
  ];

  for (const vaccine of vaccineData) {
    await pool.query(
      `
            INSERT INTO vaccines (code, name, doses_required)
            VALUES ($1, $2, $3)
            ON CONFLICT (code) DO NOTHING
        `,
      [vaccine.code, vaccine.name, vaccine.doses]
    );
  }
  console.log(`Created ${vaccineData.length} vaccine types`);

  // Generate suppliers
  console.log('Creating suppliers...');
  for (let i = 1; i <= 20; i++) {
    await pool.query(
      `
            INSERT INTO suppliers (name, supplier_code, contact_person, email, phone, address_line_1, city, supplier_type)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'vaccines')
            ON CONFLICT (supplier_code) DO NOTHING
        `,
      [
        `Supplier ${i}`,
        `SUP${String(i).padStart(4, '0')}`,
        randomElement(firstNames) + ' ' + randomElement(lastNames),
        `supplier${i}@email.com`,
        `+63${randomInt(9000000000, 9999999999)}`,
        randomElement(barangays),
        'Metro Manila',
      ]
    );
  }
  console.log('Created 20 suppliers');

  console.log('Master data generation complete!\n');
}

async function generateInfantsAndGuardians() {
  console.log(`Generating ${CONFIG.infants} infants and guardians...`);

  const startDate = new Date('2021-01-01');
  const endDate = new Date('2026-02-01');

  const clinicsResult = await pool.query('SELECT id FROM clinics');
  const clinicIds = clinicsResult.rows.map((r) => r.id);

  let processed = 0;
  const batch = [];
  const batchSize = CONFIG.batchSize;

  for (let i = 0; i < CONFIG.infants; i++) {
    const firstName = randomElement(firstNames);
    const lastName = randomElement(lastNames);
    const barangay = randomElement(barangays);
    const clinicId = randomElement(clinicIds);

    // Generate date of birth (infants born in the last 5 years)
    const dob = randomDate(startDate, endDate);

    // Guardian (one per infant for simplicity)
    const guardianFirstName = randomElement(firstNames);
    const guardianLastName = randomElement(lastNames);

    batch.push({
      infant: {
        first_name: firstName,
        last_name: lastName,
        dob: dob,
        sex: randomElement(['M', 'F']),
        address: `${randomInt(1, 999)} ${randomElement(['St.', 'Ave.', 'Blvd.', 'Lane'])}, ${barangay}`,
        contact: `+63${randomInt(9000000000, 9999999999)}`,
        barangay: barangay,
        health_center: `Health Center ${clinicId}`,
        place_of_birth: randomElement(['Hospital', 'Clinic', 'Home']),
        type_of_delivery: randomElement(['NSD', 'CS']),
        clinic_id: clinicId,
      },
      guardian: {
        name: `${guardianFirstName} ${guardianLastName}`,
        phone: `+63${randomInt(9000000000, 9999999999)}`,
        address: `${randomInt(1, 999)} ${randomElement(['St.', 'Ave.', 'Blvd.', 'Lane'])}, ${barangay}`,
        relationship: randomElement(['Mother', 'Father', 'Grandmother', 'Grandfather']),
      },
    });

    if (batch.length >= batchSize || i === CONFIG.infants - 1) {
      // Insert batch
      for (const item of batch) {
        try {
          // Insert guardian
          const guardianResult = await pool.query(
            `
                        INSERT INTO guardians (name, phone, address, relationship)
                        VALUES ($1, $2, $3, $4)
                        RETURNING id
                    `,
            [
              item.guardian.name,
              item.guardian.phone,
              item.guardian.address,
              item.guardian.relationship,
            ]
          );

          const guardianId = guardianResult.rows[0].id;

          // Insert infant with guardian
          await pool.query(
            `
                        INSERT INTO infants (first_name, last_name, dob, sex, address, contact, guardian_id, barangay, health_center, place_of_birth, type_of_delivery, clinic_id)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    `,
            [
              item.infant.first_name,
              item.infant.last_name,
              item.infant.dob,
              item.infant.sex,
              item.infant.address,
              item.infant.contact,
              guardianId,
              item.infant.barangay,
              item.infant.health_center,
              item.infant.place_of_birth,
              item.infant.type_of_delivery,
              item.infant.clinic_id,
            ]
          );

          processed++;
        } catch (error) {
          console.error('Error inserting infant:', error.message);
        }
      }

      batch.length = 0; // Clear batch

      // Progress update
      const progress = Math.round((processed / CONFIG.infants) * 100);
      process.stdout.write(`\rProgress: ${processed}/${CONFIG.infants} (${progress}%)`);
    }
  }

  console.log(`\nGenerated ${processed} infants and guardians`);
}

async function generateVaccinationRecords() {
  console.log('Generating vaccination records...');

  const infantsResult = await pool.query('SELECT id, dob FROM infants');
  const infants = infantsResult.rows;

  const vaccinesResult = await pool.query('SELECT id, code, doses_required FROM vaccines');
  const vaccines = vaccinesResult.rows;

  const usersResult = await pool.query(
    'SELECT id FROM users WHERE role_id IN (SELECT id FROM roles WHERE is_system_role = true)'
  );
  const userIds = usersResult.rows.map((r) => r.id);

  const clinicsResult = await pool.query('SELECT id FROM clinics');
  const clinicIds = clinicsResult.rows.map((r) => r.id);

  let totalRecords = 0;
  CONFIG.batchSize;

  // Generate vaccination records for each infant
  for (const infant of infants) {
    const infantAge = Math.floor((new Date() - new Date(infant.dob)) / (1000 * 60 * 60 * 24 * 30)); // Age in months

    // Generate random number of vaccinations
    const numVaccinations = Math.min(randomInt(5, 15), infantAge);

    for (let i = 0; i < numVaccinations; i++) {
      const vaccine = randomElement(vaccines);
      const userId = randomElement(userIds);
      const clinicId = randomElement(clinicIds);

      // Random date within infant's lifetime
      const minDate = new Date(infant.dob);
      const maxDate = new Date();
      const adminDate = randomDate(minDate, maxDate);

      // Create batch for this vaccination
      const batchNumber = `BATCH-${randomInt(100000, 999999)}`;
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() + randomInt(6, 24));

      try {
        // Insert batch
        const batchResult = await pool.query(
          `
                    INSERT INTO vaccine_batches (vaccine_id, lot_no, expiry_date, qty_received, qty_current, clinic_id)
                    VALUES ($1, $2, $3, $4, $4, $5)
                    ON CONFLICT DO NOTHING
                    RETURNING id
                `,
          [vaccine.id, batchNumber, expiryDate, randomInt(50, 200), clinicId]
        );

        if (batchResult.rows.length === 0) {
          continue;
        }
        const batchId = batchResult.rows[0].id;

        // Insert vaccination record
        await pool.query(
          `
                    INSERT INTO vaccination_records (infant_id, vaccine_id, batch_id, dose_no, admin_date, vaccinator_id, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
          [
            infant.id,
            vaccine.id,
            batchId,
            randomInt(1, vaccine.doses_required),
            adminDate,
            userId,
            'Routine vaccination',
          ]
        );

        totalRecords++;

        if (totalRecords % 10000 === 0) {
          process.stdout.write(`\rGenerated ${totalRecords} vaccination records...`);
        }
      } catch (error) {
        // Skip duplicates
      }
    }
  }

  console.log(`\nGenerated ${totalRecords} vaccination records`);
}

async function generateAppointments() {
  console.log('Generating appointments...');

  const infantsResult = await pool.query('SELECT id, dob FROM infants');
  const infants = infantsResult.rows;

  const usersResult = await pool.query(
    'SELECT id FROM users WHERE role_id IN (SELECT id FROM roles WHERE is_system_role = true)'
  );
  const userIds = usersResult.rows.map((r) => r.id);

  const clinicsResult = await pool.query('SELECT id FROM clinics');
  const clinicIds = clinicsResult.rows.map((r) => r.id);

  let totalAppointments = 0;

  // Generate appointments for each infant
  for (const infant of infants) {
    const numAppointments = randomInt(3, 8);

    for (let i = 0; i < numAppointments; i++) {
      const userId = randomElement(userIds);
      const clinicId = randomElement(clinicIds);

      // Random date in the future or past
      const daysOffset = randomInt(-365, 180);
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + daysOffset);
      const bookableDate = shiftToBookableDate(scheduledDate, daysOffset < 0 ? -1 : 1);
      if (!bookableDate) {
        continue;
      }

      const status =
        daysOffset < 0 ? randomElement(['attended', 'completed', 'no-show']) : 'scheduled';

      try {
        await pool.query(
          `
                    INSERT INTO appointments (infant_id, scheduled_date, type, status, created_by, clinic_id, location)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                `,
          [
            infant.id,
            bookableDate,
            randomElement(appointmentTypes),
            status,
            userId,
            clinicId,
            `Health Center ${clinicId}`,
          ]
        );

        totalAppointments++;

        if (totalAppointments % 10000 === 0) {
          process.stdout.write(`\rGenerated ${totalAppointments} appointments...`);
        }
      } catch (error) {
        // Skip duplicates
      }
    }
  }

  console.log(`\nGenerated ${totalAppointments} appointments`);
}

async function generateGrowthRecords() {
  console.log('Generating growth records...');

  const infantsResult = await pool.query('SELECT id, dob FROM infants');
  const infants = infantsResult.rows;

  const usersResult = await pool.query(
    'SELECT id FROM users WHERE role_id IN (SELECT id FROM roles WHERE is_system_role = true)'
  );
  const userIds = usersResult.rows.map((r) => r.id);

  let totalRecords = 0;

  // Generate growth records for each infant
  for (const infant of infants) {
    const infantAgeMonths = Math.floor(
      (new Date() - new Date(infant.dob)) / (1000 * 60 * 60 * 24 * 30)
    );
    const numRecords = Math.min(randomInt(4, infantAgeMonths + 1), 24); // Monthly records, max 2 years

    for (let i = 0; i < numRecords; i++) {
      const measurementDate = new Date(infant.dob);
      measurementDate.setMonth(measurementDate.getMonth() + (i + 1) * randomInt(1, 2));

      if (measurementDate > new Date()) {
        break;
      }

      const ageInDays = Math.floor(
        (measurementDate - new Date(infant.dob)) / (1000 * 60 * 60 * 24)
      );
      const userId = randomElement(userIds);

      try {
        await pool.query(
          `
                    INSERT INTO infant_growth (infant_id, measurement_date, age_in_days, weight_kg, length_cm, head_circumference_cm, measured_by, measurement_method)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'digital_scale')
                `,
          [
            infant.id,
            measurementDate,
            ageInDays,
            randomInt(30, 120) / 10, // Weight in kg
            randomInt(450, 950) / 10, // Length in cm
            randomInt(320, 500) / 10, // Head circumference in cm
            userId,
          ]
        );

        totalRecords++;

        if (totalRecords % 10000 === 0) {
          process.stdout.write(`\rGenerated ${totalRecords} growth records...`);
        }
      } catch (error) {
        // Skip duplicates
      }
    }
  }

  console.log(`\nGenerated ${totalRecords} growth records`);
}

async function generateInventoryTransactions() {
  console.log('Generating inventory transactions...');

  const vaccinesResult = await pool.query('SELECT id FROM vaccines');
  const vaccineIds = vaccinesResult.rows.map((r) => r.id);

  const usersResult = await pool.query(
    'SELECT id FROM users WHERE role_id IN (SELECT id FROM roles WHERE is_system_role = true)'
  );
  const userIds = usersResult.rows.map((r) => r.id);

  const clinicsResult = await pool.query('SELECT id FROM clinics');
  const clinicIds = clinicsResult.rows.map((r) => r.id);

  const suppliersResult = await pool.query('SELECT id FROM suppliers');
  const supplierIds = suppliersResult.rows.map((r) => r.id);

  let totalTransactions = 0;

  // Generate inventory transactions
  for (let i = 0; i < 10000; i++) {
    const vaccineId = randomElement(vaccineIds);
    const userId = randomElement(userIds);
    const clinicId = randomElement(clinicIds);
    randomElement(supplierIds);

    const transactionTypes = ['RECEIVE', 'ISSUE', 'WASTAGE', 'ADJUST'];
    const txnType = randomElement(transactionTypes);

    const qty = randomInt(10, 100);

    try {
      // Insert batch first
      const batchResult = await pool.query(
        `
                INSERT INTO vaccine_batches (vaccine_id, lot_no, expiry_date, qty_received, qty_current, clinic_id)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT DO NOTHING
                RETURNING id
            `,
        [
          vaccineId,
          `LOT-${randomInt(100000, 999999)}`,
          new Date(Date.now() + randomInt(30, 365) * 24 * 60 * 60 * 1000),
          qty,
          qty,
          clinicId,
        ]
      );

      if (batchResult.rows.length === 0) {
        continue;
      }
      const batchId = batchResult.rows[0].id;

      await pool.query(
        `
                INSERT INTO inventory_transactions (batch_id, txn_type, qty, user_id, notes)
                VALUES ($1, $2, $3, $4, $5)
            `,
        [batchId, txnType, qty, userId, `${txnType} transaction`]
      );

      totalTransactions++;

      if (totalTransactions % 1000 === 0) {
        process.stdout.write(`\rGenerated ${totalTransactions} inventory transactions...`);
      }
    } catch (error) {
      // Skip errors
    }
  }

  console.log(`\nGenerated ${totalTransactions} inventory transactions`);
}

async function generateNotifications() {
  console.log('Generating notification records...');

  const guardiansResult = await pool.query('SELECT id, phone FROM guardians LIMIT 1000');
  const guardians = guardiansResult.rows;

  const usersResult = await pool.query('SELECT id FROM users');
  const userIds = usersResult.rows.map((r) => r.id);

  let totalNotifications = 0;
  const notificationTypes = [
    'appointment_reminder',
    'vaccination_reminder',
    'general_alert',
    'system_announcement',
  ];
  const statuses = ['sent', 'delivered', 'pending', 'failed'];

  for (let i = 0; i < 50000; i++) {
    const guardian = randomElement(guardians);
    const userId = randomElement(userIds);

    if (!guardian.phone) {
      continue;
    }

    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - randomInt(0, 365));

    try {
      await pool.query(
        `
                INSERT INTO notifications (
                    notification_type, target_type, target_id, recipient_name, recipient_phone,
                    channel, priority, status, message, created_by, created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `,
        [
          randomElement(notificationTypes),
          'guardian',
          guardian.id,
          `Guardian ${guardian.id}`,
          guardian.phone,
          'sms',
          randomElement(['low', 'normal', 'high']),
          randomElement(statuses),
          'Test notification message',
          userId,
          createdAt,
        ]
      );

      totalNotifications++;

      if (totalNotifications % 10000 === 0) {
        process.stdout.write(`\rGenerated ${totalNotifications} notifications...`);
      }
    } catch (error) {
      // Skip errors
    }
  }

  console.log(`\nGenerated ${totalNotifications} notifications`);
}

async function generateAllergies() {
  console.log('Generating allergy records...');

  const infantsResult = await pool.query('SELECT id FROM infants LIMIT 10000');
  const infants = infantsResult.rows;

  const allergyTypes = ['vaccine', 'food', 'medication', 'environmental'];
  const allergens = [
    'Penicillin',
    'Eggs',
    'Peanuts',
    'Milk',
    'Polio',
    'BCG',
    'Dust',
    'Pollen',
    'Shellfish',
    'Soy',
  ];
  const severities = ['mild', 'moderate', 'severe'];

  let totalAllergies = 0;

  for (const infant of infants) {
    // Random chance of having allergies
    if (Math.random() > 0.1) {
      continue;
    } // 10% have allergies

    const numAllergies = randomInt(1, 3);

    for (let i = 0; i < numAllergies; i++) {
      try {
        await pool.query(
          `
                    INSERT INTO infant_allergies (infant_id, allergy_type, allergen, severity, reaction_description)
                    VALUES ($1, $2, $3, $4, $5)
                `,
          [
            infant.id,
            randomElement(allergyTypes),
            randomElement(allergens),
            randomElement(severities),
            'Recorded reaction',
          ]
        );

        totalAllergies++;
      } catch (error) {
        // Skip duplicates
      }
    }

    if (totalAllergies % 1000 === 0) {
      process.stdout.write(`\rGenerated ${totalAllergies} allergy records...`);
    }
  }

  console.log(`\nGenerated ${totalAllergies} allergy records`);
}

async function generateAuditLogs() {
  console.log('Generating audit logs...');

  const usersResult = await pool.query('SELECT id FROM users');
  const userIds = usersResult.rows.map((r) => r.id);

  let totalLogs = 0;
  const eventTypes = ['LOGIN', 'LOGOUT', 'CREATE', 'UPDATE', 'DELETE', 'VIEW', 'EXPORT'];

  for (let i = 0; i < 100000; i++) {
    const userId = randomElement(userIds);
    const timestamp = new Date();
    timestamp.setDate(timestamp.getDate() - randomInt(0, 365));

    try {
      await pool.query(
        `
                INSERT INTO audit_logs (user_id, event_type, entity_type, entity_id, timestamp)
                VALUES ($1, $2, $3, $4, $5)
            `,
        [
          userId,
          randomElement(eventTypes),
          randomElement(['infant', 'vaccination', 'appointment', 'user']),
          randomInt(1, 10000),
          timestamp,
        ]
      );

      totalLogs++;

      if (totalLogs % 20000 === 0) {
        process.stdout.write(`\rGenerated ${totalLogs} audit logs...`);
      }
    } catch (error) {
      // Skip errors
    }
  }

  console.log(`\nGenerated ${totalLogs} audit logs`);
}

async function main() {
  try {
    console.log('Connecting to database...');

    // Test connection
    await pool.query('SELECT NOW()');
    console.log('Database connected!\n');

    const startTime = Date.now();

    // Phase 1: Master Data
    await generateMasterData();

    // Phase 2: Core Data
    await generateInfantsAndGuardians();

    // Phase 3: Transaction Data
    await generateVaccinationRecords();
    await generateAppointments();
    await generateGrowthRecords();
    await generateInventoryTransactions();
    await generateNotifications();
    await generateAllergies();
    await generateAuditLogs();

    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);

    console.log('');
    console.log('========================================');
    console.log('TEST DATA GENERATION COMPLETE');
    console.log('========================================');
    console.log(`Total time: ${duration} seconds`);
    console.log('');
    console.log('Summary:');
    console.log(`- Infants: ${CONFIG.infants}`);
    console.log(`- Years of data: ${CONFIG.years}`);
    console.log('');

    // Get final counts
    const counts = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM infants'),
      pool.query('SELECT COUNT(*) as count FROM guardians'),
      pool.query('SELECT COUNT(*) as count FROM vaccination_records'),
      pool.query('SELECT COUNT(*) as count FROM appointments'),
      pool.query('SELECT COUNT(*) as count FROM infant_growth'),
      pool.query('SELECT COUNT(*) as count FROM inventory_transactions'),
      pool.query('SELECT COUNT(*) as count FROM notifications'),
      pool.query('SELECT COUNT(*) as count FROM infant_allergies'),
      pool.query('SELECT COUNT(*) as count FROM audit_logs'),
    ]);

    console.log('Database Counts:');
    console.log(`- Infants: ${counts[0].rows[0].count}`);
    console.log(`- Guardians: ${counts[1].rows[0].count}`);
    console.log(`- Vaccination Records: ${counts[2].rows[0].count}`);
    console.log(`- Appointments: ${counts[3].rows[0].count}`);
    console.log(`- Growth Records: ${counts[4].rows[0].count}`);
    console.log(`- Inventory Transactions: ${counts[5].rows[0].count}`);
    console.log(`- Notifications: ${counts[6].rows[0].count}`);
    console.log(`- Allergy Records: ${counts[7].rows[0].count}`);
    console.log(`- Audit Logs: ${counts[8].rows[0].count}`);

    const totalTransactions =
      parseInt(counts[2].rows[0].count) +
      parseInt(counts[3].rows[0].count) +
      parseInt(counts[4].rows[0].count) +
      parseInt(counts[5].rows[0].count) +
      parseInt(counts[6].rows[0].count) +
      parseInt(counts[8].rows[0].count);

    console.log(`\nTotal Transactions: ${totalTransactions}`);
    console.log('========================================');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

// Run the generator
main();
