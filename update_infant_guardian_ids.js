const pool = require('./db');

async function updateInfantGuardianIds() {
  try {
    console.log('Updating infant guardian IDs...');

    // Get all infants
    const infants = await pool.query('SELECT id, first_name, last_name FROM infants');

    // Get all guardians
    const guardians = await pool.query('SELECT id, name FROM guardians');

    // Assign each infant to a random guardian
    for (let i = 0; i < infants.rows.length; i++) {
      const infant = infants.rows[i];
      const randomGuardian = guardians.rows[Math.floor(Math.random() * guardians.rows.length)];

      await pool.query('UPDATE infants SET guardian_id = $1 WHERE id = $2', [
        randomGuardian.id,
        infant.id
      ]);

      console.log(
        `Updated ${infant.first_name} ${infant.last_name} (ID: ${infant.id}) to guardian ${randomGuardian.name} (ID: ${randomGuardian.id})`
      );
    }

    console.log('\nInfant guardian IDs updated successfully');

    // Verify the changes
    const updatedInfants = await pool.query(`
            SELECT i.id, i.first_name, i.last_name, g.name as guardian_name
            FROM infants i
            LEFT JOIN guardians g ON i.guardian_id = g.id
        `);

    console.log('\nUpdated infants with guardians:');
    console.log(updatedInfants.rows);

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

updateInfantGuardianIds();
