const pool = require('./db');

async function fixInfantGuardianRelationships() {
  try {
    console.log('Updating infant guardian relationships...');

    const parentGuardians = await pool.query(`
            SELECT id, infant_id FROM parent_guardian
            WHERE infant_id IS NOT NULL
        `);

    for (const pg of parentGuardians.rows) {
      await pool.query(
        `
                UPDATE infants 
                SET guardian_id = $1
                WHERE id = $2
            `,
        [pg.id, pg.infant_id]
      );

      console.log(`Updated infant ${pg.infant_id} with guardian_id ${pg.id}`);
    }

    console.log('Infant guardian relationships updated successfully');

    await pool.end();
  } catch (error) {
    console.error('Error:', error);
  }
}

fixInfantGuardianRelationships();
