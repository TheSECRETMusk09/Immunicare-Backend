/**
 * Script to add missing columns to the patients table
 * This fixes the schema mismatch between the infants route and the database
 */

const pool = require('./db');

async function fixPatientsSchema() {
  const client = await pool.connect();

  try {
    console.log('Starting patients table schema fix...');
    await client.query('BEGIN');

    // Check existing columns
    const existingColumns = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'patients'
    `);
    const columnNames = existingColumns.rows.map((r) => r.column_name);
    console.log('Existing columns:', columnNames);

    // Add missing columns one by one (IF NOT EXISTS for safety)
    const columnsToAdd = [
      { name: 'first_name', type: 'VARCHAR(255)' },
      { name: 'last_name', type: 'VARCHAR(255)' },
      { name: 'middle_name', type: 'VARCHAR(255)' },
      { name: 'dob', type: 'DATE' },
      { name: 'sex', type: 'VARCHAR(20)' },
      { name: 'national_id', type: 'VARCHAR(50)' },
      { name: 'contact', type: 'VARCHAR(50)' },
      { name: 'photo_url', type: 'TEXT' },
      { name: 'mother_name', type: 'VARCHAR(255)' },
      { name: 'father_name', type: 'VARCHAR(255)' },
      { name: 'birth_weight', type: 'DECIMAL(5,2)' },
      { name: 'birth_height', type: 'DECIMAL(5,2)' },
      { name: 'place_of_birth', type: 'VARCHAR(255)' },
      { name: 'barangay', type: 'VARCHAR(100)' },
      { name: 'health_center', type: 'VARCHAR(255)' },
      { name: 'family_no', type: 'VARCHAR(50)' },
      { name: 'time_of_delivery', type: 'TIME' },
      { name: 'type_of_delivery', type: 'VARCHAR(100)' },
      { name: 'doctor_midwife_nurse', type: 'VARCHAR(255)' },
      { name: 'nbs_done', type: 'BOOLEAN DEFAULT false' },
      { name: 'nbs_date', type: 'DATE' },
      { name: 'cellphone_number', type: 'VARCHAR(50)' },
      { name: 'facility_id', type: 'INTEGER' },
      { name: 'control_number', type: 'VARCHAR(20) UNIQUE' },
      { name: 'is_active', type: 'BOOLEAN DEFAULT true' }
    ];

    for (const col of columnsToAdd) {
      if (!columnNames.includes(col.name)) {
        console.log(`Adding column: ${col.name}`);
        try {
          await client.query(`ALTER TABLE patients ADD COLUMN ${col.name} ${col.type}`);
          console.log(`  ✓ Added ${col.name}`);
        } catch (err) {
          console.log(`  ⚠ Could not add ${col.name}: ${err.message}`);
        }
      } else {
        console.log(`  - Column ${col.name} already exists`);
      }
    }

    // Migrate existing data if needed
    // If 'name' exists but 'first_name' is empty, split 'name' into first_name and last_name
    const hasNameColumn = columnNames.includes('name');
    if (hasNameColumn) {
      console.log('Migrating existing name data to first_name/last_name...');

      // Update first_name and last_name from name column
      await client.query(`
        UPDATE patients 
        SET 
          first_name = CASE 
            WHEN name IS NOT NULL AND first_name IS NULL 
            THEN SPLIT_PART(name, ' ', 1)
            ELSE first_name
          END,
          last_name = CASE 
            WHEN name IS NOT NULL AND last_name IS NULL 
            THEN SUBSTRING(name FROM POSITION(' ' IN name) + 1)
            ELSE last_name
          END
        WHERE name IS NOT NULL AND (first_name IS NULL OR last_name IS NULL)
      `);
      console.log('  ✓ Migrated name data');
    }

    // Migrate date_of_birth to dob if needed
    const hasDateOfBirth = columnNames.includes('date_of_birth');
    if (hasDateOfBirth) {
      console.log('Migrating date_of_birth to dob...');
      await client.query(`
        UPDATE patients 
        SET dob = date_of_birth
        WHERE date_of_birth IS NOT NULL AND dob IS NULL
      `);
      console.log('  ✓ Migrated date_of_birth data');
    }

    // Migrate gender to sex if needed
    const hasGender = columnNames.includes('gender');
    if (hasGender) {
      console.log('Migrating gender to sex...');
      await client.query(`
        UPDATE patients 
        SET sex = CASE 
          WHEN gender IN ('M', 'Male', 'male') THEN 'male'
          WHEN gender IN ('F', 'Female', 'female') THEN 'female'
          ELSE 'other'
        END
        WHERE gender IS NOT NULL AND sex IS NULL
      `);
      console.log('  ✓ Migrated gender data');
    }

    // Set is_active to true for existing records if null
    await client.query(`
      UPDATE patients SET is_active = true WHERE is_active IS NULL
    `);

    // Generate control numbers for existing patients
    const patientsWithoutControl = await client.query(`
      SELECT id FROM patients WHERE control_number IS NULL
    `);

    const year = new Date().getFullYear();
    for (let i = 0; i < patientsWithoutControl.rows.length; i++) {
      const patient = patientsWithoutControl.rows[i];
      const controlNumber = `${year}-${String(i + 1).padStart(6, '0')}`;
      await client.query('UPDATE patients SET control_number = $1 WHERE id = $2', [
        controlNumber,
        patient.id
      ]);
    }
    console.log(`  ✓ Generated control numbers for ${patientsWithoutControl.rows.length} patients`);

    await client.query('COMMIT');
    console.log('\n✅ Schema fix completed successfully!');

    // Show final schema
    const finalColumns = await client.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'patients' 
      ORDER BY ordinal_position
    `);
    console.log('\nFinal patients table schema:');
    finalColumns.rows.forEach((col) => {
      console.log(
        `  ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`
      );
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error fixing schema:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    client.release();
    process.exit(0);
  }
}

fixPatientsSchema().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
