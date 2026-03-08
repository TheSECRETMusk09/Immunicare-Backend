require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function seedData() {
  console.log('Seeding sample data with password support...');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ============================================================================
    // STEP 0: Add password column if not exists, drop constraints temporarily
    // ============================================================================
    console.log('Adding password column to parent_guardian table...');
    await client.query(
      'ALTER TABLE parent_guardian ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)'
    );
    await client.query(
      'ALTER TABLE parent_guardian ADD COLUMN IF NOT EXISTS is_password_set BOOLEAN DEFAULT false'
    );
    console.log('Password column added');

    console.log('Dropping NOT NULL constraints and FK constraint...');
    await client.query('ALTER TABLE infants ALTER COLUMN guardian_id DROP NOT NULL');
    await client.query('ALTER TABLE infants DROP CONSTRAINT IF EXISTS infants_guardian_id_fkey');
    console.log('Constraints dropped successfully');

    // ============================================================================
    // STEP 1: INSERT 5 PATIENTS/INFANTS FIRST (with NULL guardian_id initially)
    // ============================================================================

    const infantInsertions = [
      {
        firstName: 'Sofia',
        lastName: 'Santos',
        middleName: 'Garcia',
        dob: '2024-06-15',
        sex: 'F',
        address: '123 Sampaguita Street, Barangay Maliksi, Quezon City',
        contact: '+63-917-123-4567',
        motherName: 'Maria Elena Santos',
        fatherName: 'Roberto Santos',
        barangay: 'Maliksi'
      },
      {
        firstName: 'Mateo',
        lastName: 'Santos',
        middleName: 'Garcia',
        dob: '2024-08-20',
        sex: 'M',
        address: '123 Sampaguita Street, Barangay Maliksi, Quezon City',
        contact: '+63-917-123-4567',
        motherName: 'Maria Elena Santos',
        fatherName: 'Roberto Santos',
        barangay: 'Maliksi'
      },
      {
        firstName: 'Isabella',
        lastName: 'dela Cruz',
        middleName: 'Ramos',
        dob: '2024-03-10',
        sex: 'F',
        address: '456 Rose Avenue, Barangay Santol, Manila',
        contact: '+63-918-234-5678',
        motherName: 'Ana dela Cruz',
        fatherName: 'Juan Miguel dela Cruz',
        barangay: 'Santol'
      },
      {
        firstName: 'Gabriel',
        lastName: 'Reyes',
        middleName: 'Vargas',
        dob: '2024-09-05',
        sex: 'M',
        address: '789 Lily Lane, Barangay Holy Spirit, Quezon City',
        contact: '+63-919-345-6789',
        motherName: 'Ana Marie Reyes',
        fatherName: 'Carlos Reyes',
        barangay: 'Holy Spirit'
      },
      {
        firstName: 'Camila',
        lastName: 'Garcia',
        middleName: 'Mendoza',
        dob: '2024-07-22',
        sex: 'F',
        address: '321 Jasmine Road, Barangay San Antonio, Makati',
        contact: '+63-920-456-7890',
        motherName: 'Maria Garcia',
        fatherName: 'Pedro Luis Garcia',
        barangay: 'San Antonio'
      }
    ];

    const infantIds = [];
    for (const infant of infantInsertions) {
      try {
        const result = await client.query(
          `
                    INSERT INTO infants (
                        first_name, last_name, middle_name, dob, sex, address, contact,
                        mother_name, father_name, barangay, is_active
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
                    RETURNING id
                `,
          [
            infant.firstName,
            infant.lastName,
            infant.middleName,
            infant.dob,
            infant.sex,
            infant.address,
            infant.contact,
            infant.motherName,
            infant.fatherName,
            infant.barangay
          ]
        );
        infantIds.push({
          id: result.rows[0].id,
          firstName: infant.firstName,
          lastName: infant.lastName
        });
        console.log(
          `Inserted infant: ${infant.firstName} ${infant.lastName} (ID: ${result.rows[0].id})`
        );
      } catch (err) {
        console.log(`Infant insert error: ${err.message}`);
      }
    }

    // ============================================================================
    // STEP 2: INSERT 5 GUARDIANS WITH HASHED PASSWORDS
    // ============================================================================

    const guardianInsertions = [
      {
        fullName: 'Maria Elena Santos',
        phone: '+63-917-123-4567',
        email: 'maria.santos@email.com',
        password: 'guardian123',
        relationshipDetails: '123 Sampaguita Street, Barangay Maliksi, Quezon City',
        relationshipType: 'parent',
        userId: 6,
        infantId: infantIds[0]?.id
      },
      {
        fullName: 'Juan Miguel dela Cruz',
        phone: '+63-918-234-5678',
        email: 'juan.delacruz@email.com',
        password: 'guardian123',
        relationshipDetails: '456 Rose Avenue, Barangay Santol, Manila',
        relationshipType: 'parent',
        userId: 6,
        infantId: infantIds[2]?.id
      },
      {
        fullName: 'Ana Marie Reyes',
        phone: '+63-919-345-6789',
        email: 'ana.reyes@email.com',
        password: 'guardian123',
        relationshipDetails: '789 Lily Lane, Barangay Holy Spirit, Quezon City',
        relationshipType: 'parent',
        userId: 6,
        infantId: infantIds[3]?.id
      },
      {
        fullName: 'Pedro Luis Garcia',
        phone: '+63-920-456-7890',
        email: 'pedro.garcia@email.com',
        password: 'guardian123',
        relationshipDetails: '321 Jasmine Road, Barangay San Antonio, Makati',
        relationshipType: 'parent',
        userId: 6,
        infantId: infantIds[4]?.id
      },
      {
        fullName: 'Carmen Victoria Lim',
        phone: '+63-921-567-8901',
        email: 'carmen.lim@email.com',
        password: 'guardian123',
        relationshipDetails: '654 Orchid Street, Barangay Bel-Air, Makati',
        relationshipType: 'guardian',
        userId: 6,
        infantId: infantIds[1]?.id
      }
    ];

    const guardianIds = [];
    for (let i = 0; i < guardianInsertions.length; i++) {
      const g = guardianInsertions[i];

      if (!g.infantId) {
        console.log(`Skipping guardian ${g.fullName} - no infant ID`);
        continue;
      }

      try {
        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(g.password, salt);

        const result = await client.query(
          `
                    INSERT INTO parent_guardian (user_id, infant_id, full_name, phone, email, password_hash, is_password_set, relationship_details, relationship_type, is_active)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
                    RETURNING id
                `,
          [
            g.userId,
            g.infantId,
            g.fullName,
            g.phone,
            g.email,
            passwordHash,
            true,
            g.relationshipDetails,
            g.relationshipType
          ]
        );

        guardianIds.push({ id: result.rows[0].id, fullName: g.fullName, email: g.email });
        console.log(
          `Inserted guardian: ${g.fullName} (ID: ${result.rows[0].id}) with hashed password`
        );
      } catch (err) {
        console.log(`Guardian insert error: ${err.message}`);
      }
    }

    // ============================================================================
    // STEP 3: UPDATE infants with guardian_id (do this after commit to avoid FK issues)
    // ============================================================================

    await client.query('COMMIT');
    console.log('Initial data committed, now updating relationships...');

    // Start new transaction for updates
    await client.query('BEGIN');

    for (let i = 0; i < Math.min(infantIds.length, guardianIds.length); i++) {
      try {
        await client.query('UPDATE infants SET guardian_id = $1 WHERE id = $2', [
          guardianIds[i].id,
          infantIds[i].id
        ]);
        console.log(
          `Linked infant ${infantIds[i].firstName} ${infantIds[i].lastName} to guardian ${guardianIds[i].fullName}`
        );
      } catch (err) {
        console.log(`Update error: ${err.message}`);
      }
    }

    await client.query('COMMIT');
    console.log('Relationships updated successfully');

    // ============================================================================
    // STEP 4: Re-add constraints
    // ============================================================================
    console.log('Re-adding constraints...');

    // Add back the foreign key constraint
    await client.query(
      'ALTER TABLE infants ADD CONSTRAINT infants_guardian_id_fkey FOREIGN KEY (guardian_id) REFERENCES parent_guardian(id) ON DELETE SET NULL'
    );
    console.log('Foreign key constraint added successfully');

    // ============================================================================
    // VERIFICATION
    // ============================================================================

    console.log('\n=== VERIFICATION ===');

    const guardianCount = await pool.query(`
            SELECT COUNT(*) as count FROM parent_guardian 
            WHERE email IN ('maria.santos@email.com', 'juan.delacruz@email.com', 'ana.reyes@email.com', 'pedro.garcia@email.com', 'carmen.lim@email.com')
        `);
    console.log(`Guardians: ${guardianCount.rows[0].count}`);

    const infantCount = await pool.query(`
            SELECT COUNT(*) as count FROM infants 
            WHERE first_name IN ('Sofia', 'Mateo', 'Isabella', 'Gabriel', 'Camila')
        `);
    console.log(`Patients (infants): ${infantCount.rows[0].count}`);

    // Show password hashes
    console.log('\n=== PASSWORD HASHES VERIFICATION ===');
    const passwordCheck = await pool.query(`
            SELECT full_name, email, password_hash IS NOT NULL as has_password, is_password_set 
            FROM parent_guardian 
            WHERE email IN ('maria.santos@email.com', 'juan.delacruz@email.com', 'ana.reyes@email.com', 'pedro.garcia@email.com', 'carmen.lim@email.com')
        `);
    passwordCheck.rows.forEach((row) => {
      console.log(
        `${row.full_name}: password_set=${row.is_password_set}, hash_exists=${row.has_password}`
      );
    });

    // Show relationships
    console.log('\n=== GUARDIAN-PATIENT RELATIONSHIPS ===');
    const relationships = await pool.query(`
            SELECT 
                g.full_name as guardian_name,
                g.relationship_type as relationship,
                i.first_name as patient_first_name,
                i.last_name as patient_last_name,
                i.dob as patient_dob,
                i.sex as patient_sex
            FROM parent_guardian g
            LEFT JOIN infants i ON g.id = i.guardian_id
            WHERE g.email IN ('maria.santos@email.com', 'juan.delacruz@email.com', 'ana.reyes@email.com', 'pedro.garcia@email.com', 'carmen.lim@email.com')
            ORDER BY g.full_name
        `);

    relationships.rows.forEach((row) => {
      console.log(
        `Guardian: ${row.guardian_name} (${row.relationship}) -> Patient: ${row.patient_first_name || '(none)'} ${row.patient_last_name || ''} (${row.patient_dob || 'N/A'}, ${row.patient_sex || 'N/A'})`
      );
    });

    console.log('\nSample data seeding with passwords completed!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error seeding data:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Run the seed function
seedData()
  .then(() => {
    console.log('Seed completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exit(1);
  });
