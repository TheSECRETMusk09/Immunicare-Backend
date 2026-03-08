// Run database schema fixes using the backend's db module
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const pool = require('./db');

async function runFixes() {
  const client = await pool.connect();

  try {
    console.log('Starting database schema fixes...');

    // 1. Add 'confirmed' status to appointment_status enum
    await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status' 
                         AND EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'appointment_status') AND enumlabel = 'confirmed')) THEN
              ALTER TYPE appointment_status ADD VALUE IF NOT EXISTS 'confirmed';
              RAISE NOTICE 'Added confirmed status to appointment_status enum';
          ELSE
              RAISE NOTICE 'confirmed status already exists';
          END IF;
      END $$;
    `);
    console.log('✓ Fixed appointment_status enum');

    // 2. Add infant_id column to appointments if needed
    await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'appointments' AND column_name = 'infant_id') THEN
              IF EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'appointments' AND column_name = 'patient_id') THEN
                  ALTER TABLE appointments RENAME COLUMN patient_id TO infant_id;
                  RAISE NOTICE 'Renamed patient_id to infant_id';
              ELSE
                  ALTER TABLE appointments ADD COLUMN infant_id INTEGER;
                  RAISE NOTICE 'Added infant_id column';
              END IF;
          ELSE
              RAISE NOTICE 'infant_id already exists';
          END IF;
      END $$;
    `);
    console.log('✓ Fixed infant_id column');

    // 3. Verify guardian_id exists in patients
    await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'patients' AND column_name = 'guardian_id') THEN
              ALTER TABLE patients ADD COLUMN guardian_id INTEGER REFERENCES guardians(id);
              RAISE NOTICE 'Added guardian_id to patients';
          ELSE
              RAISE NOTICE 'guardian_id already exists';
          END IF;
      END $$;
    `);
    console.log('✓ Fixed guardian_id column');

    // 4. Fix vaccines table
    await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'vaccines' AND column_name = 'number_of_doses') THEN
              IF EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'vaccines' AND column_name = 'doses_required') THEN
                  ALTER TABLE vaccines RENAME COLUMN doses_required TO number_of_doses;
                  RAISE NOTICE 'Renamed doses_required to number_of_doses';
              ELSE
                  ALTER TABLE vaccines ADD COLUMN number_of_doses INTEGER;
                  RAISE NOTICE 'Added number_of_doses column';
              END IF;
          ELSE
              RAISE NOTICE 'number_of_doses already exists';
          END IF;
      END $$;
    `);
    console.log('✓ Fixed vaccines table');

    // 5. Fix vaccination_schedules age column
    await client.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'vaccination_schedules' AND column_name = 'age_in_months') THEN
              IF EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_name = 'vaccination_schedules' AND column_name = 'age_months') THEN
                  ALTER TABLE vaccination_schedules RENAME COLUMN age_months TO age_in_months;
                  RAISE NOTICE 'Renamed age_months to age_in_months';
              ELSE
                  RAISE NOTICE 'age_in_months column issue';
              END IF;
          ELSE
              RAISE NOTICE 'age_in_months already exists';
          END IF;
      END $$;
    `);
    console.log('✓ Fixed vaccination_schedules table');

    // 6. Check if infants table exists (it should be an alias for patients)
    const infantsTable = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'infants'
      );
    `);

    if (!infantsTable.rows[0].exists) {
      // Create infants view pointing to patients
      await client.query(`
        CREATE VIEW infants AS SELECT * FROM patients;
      `);
      console.log('✓ Created infants view');
    } else {
      console.log('✓ Infants table already exists');
    }

    // Verify fixes
    const result = await client.query(`
      SELECT enumlabel FROM pg_enum WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'appointment_status') ORDER BY enumlabel;
    `);
    console.log(
      'Appointment status values:',
      result.rows.map((r) => r.enumlabel)
    );

    console.log('\n✅ All database schema fixes completed successfully!');
  } catch (error) {
    console.error('Error running fixes:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runFixes().catch(console.error);
