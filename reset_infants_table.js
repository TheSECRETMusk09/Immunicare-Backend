const pool = require('./db');

async function resetInfantsTable() {
  try {
    console.log('Starting infants table reset...');

    // 1. Check existing guardians
    console.log('Checking for existing guardians...');
    const guardiansResult = await pool.query('SELECT * FROM guardians WHERE is_active = true');
    const guardians = guardiansResult.rows;

    if (guardians.length === 0) {
      throw new Error('No active guardians found. Please create guardians first.');
    }
    console.log(`Found ${guardians.length} active guardians`);

    // 2. Reset infants table
    console.log('Resetting infants table...');
    await pool.query('TRUNCATE TABLE patients RESTART IDENTITY CASCADE');

    // 3. Generate infant records with proper sex values
    console.log('Generating infant records...');

    const hospitals = [
      'San Nicolas General Hospital',
      'Community Health Center - Barangay 1',
      'Maternity Clinic - Poblacion',
      'City Medical Center',
      'Rural Health Unit - San Nicolas'
    ];

    const infantsData = [
      { firstName: 'Maria', lastName: 'Garcia', sex: 'female' },
      { firstName: 'Juan', lastName: 'Santos', sex: 'male' },
      { firstName: 'Sofia', lastName: 'Cruz', sex: 'female' },
      { firstName: 'Miguel', lastName: 'Mendoza', sex: 'male' },
      { firstName: 'Rosa', lastName: 'Reyes', sex: 'female' },
      { firstName: 'Carlos', lastName: 'Torres', sex: 'male' },
      { firstName: 'Ana', lastName: 'Lopez', sex: 'female' },
      { firstName: 'Luis', lastName: 'Ramos', sex: 'male' },
      { firstName: 'Carmen', lastName: 'Vargas', sex: 'female' },
      { firstName: 'Pedro', lastName: 'Castillo', sex: 'male' }
    ];

    const infants = [];
    const now = new Date();

    for (let i = 0; i < infantsData.length; i++) {
      const data = infantsData[i];
      const guardian = guardians[i % guardians.length];
      const fullName = `${data.firstName} ${data.lastName}`;

      // Random date of birth within last 3 years
      const yearsAgo = Math.floor(Math.random() * 3);
      const monthsAgo = Math.floor(Math.random() * 12);
      const daysAgo = Math.floor(Math.random() * 28);
      const dob = new Date(now);
      dob.setFullYear(dob.getFullYear() - yearsAgo);
      dob.setMonth(dob.getMonth() - monthsAgo);
      dob.setDate(dob.getDate() - daysAgo);

      const birthWeight = (5 + Math.random() * 5).toFixed(2); // 5-10 pounds
      const birthHeight = Math.floor(18 + Math.random() * 6); // 18-24 inches
      const placeOfBirth = hospitals[Math.floor(Math.random() * hospitals.length)];

      infants.push({
        name: fullName,
        first_name: data.firstName,
        last_name: data.lastName,
        dob: dob.toISOString().split('T')[0],
        sex: data.sex,
        guardian_id: guardian.id,
        birth_weight: birthWeight,
        birth_height: birthHeight,
        place_of_birth: placeOfBirth,
        is_active: true
      });
    }

    // 4. Insert infant records
    console.log('Inserting infant records...');
    for (const infant of infants) {
      await pool.query(`
        INSERT INTO patients (
          name, first_name, last_name, dob, sex, guardian_id, birth_weight, birth_height,
          place_of_birth, is_active, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW()
        )
      `, [
        infant.name,
        infant.first_name,
        infant.last_name,
        infant.dob,
        infant.sex,
        infant.guardian_id,
        infant.birth_weight,
        infant.birth_height,
        infant.place_of_birth,
        infant.is_active
      ]);
    }

    console.log(`Successfully inserted ${infants.length} infant records`);

    // 5. Verify insertion
    const verifyResult = await pool.query('SELECT COUNT(*) FROM patients');
    console.log(`Total infants in table: ${verifyResult.rows[0].count}`);

    // 6. Display sample records
    const sampleResult = await pool.query('SELECT id, name, first_name, last_name, dob, sex, guardian_id FROM patients');
    console.log('\nInfant records:');
    sampleResult.rows.forEach(infant => {
      console.log(`- ID: ${infant.id}, Name: ${infant.name} (${infant.sex}), DOB: ${infant.dob}, Guardian ID: ${infant.guardian_id}`);
    });

    console.log('\nInfants table reset and populated successfully!');

  } catch (error) {
    console.error('Error resetting infants table:', error);
  } finally {
    // Close connection
    await pool.end();
  }
}

resetInfantsTable();
