const db = require('./db');

async function cleanupVaccineSchedules() {
  try {
    console.log('Starting vaccine schedule cleanup...');

    // Map of inactive vaccine IDs to active vaccine IDs for migration
    const vaccineIdMap = {
      // BCG (inactive ID 91 -> active ID 1)
      91: 1,
      // PCV 13/PCV 10 (inactive ID 96 -> active ID 6)
      96: 6,
    };

    // Get all schedules with inactive vaccines
    const schedulesResult = await db.query(`
      SELECT vs.id, vs.vaccine_id, v.name as vaccine_name, v.is_active
      FROM vaccination_schedules vs
      JOIN vaccines v ON vs.vaccine_id = v.id
      WHERE v.is_active = false
    `);

    console.log(`Found ${schedulesResult.rows.length} schedules with inactive vaccines`);

    let migrated = 0;
    let deleted = 0;

    for (const schedule of schedulesResult.rows) {
      if (vaccineIdMap[schedule.vaccine_id]) {
        // Migrate to active vaccine
        const newVaccineId = vaccineIdMap[schedule.vaccine_id];
        const getVaccineResult = await db.query('SELECT name FROM vaccines WHERE id = $1', [newVaccineId]);
        const newVaccineName = getVaccineResult.rows[0]?.name;

        await db.query(
          'UPDATE vaccination_schedules SET vaccine_id = $1 WHERE id = $2',
          [newVaccineId, schedule.id],
        );
        console.log(`Migrated schedule ${schedule.id}: ${schedule.vaccine_name} (ID ${schedule.vaccine_id}) -> ${newVaccineName} (ID ${newVaccineId})`);
        migrated++;
      } else {
        // Delete schedule for vaccine with no active equivalent
        await db.query('DELETE FROM vaccination_schedules WHERE id = $1', [schedule.id]);
        console.log(`Deleted schedule ${schedule.id}: ${schedule.vaccine_name} (ID ${schedule.vaccine_id}) - no active equivalent`);
        deleted++;
      }
    }

    // Now check for approved vaccines that don't have schedules
    const activeVaccinesResult = await db.query(`
      SELECT v.id, v.name
      FROM vaccines v
      WHERE v.is_active = true
      ORDER BY v.name
    `);

    console.log('\n=== Active vaccines and their schedules ===');
    for (const vaccine of activeVaccinesResult.rows) {
      const scheduleCountResult = await db.query(
        'SELECT COUNT(*) as count FROM vaccination_schedules WHERE vaccine_id = $1',
        [vaccine.id],
      );
      const count = parseInt(scheduleCountResult.rows[0].count);
      console.log(`${vaccine.name} (ID ${vaccine.id}): ${count} schedule(s)`);
    }

    console.log('\n=== CLEANUP SUMMARY ===');
    console.log(`Migrated: ${migrated}`);
    console.log(`Deleted: ${deleted}`);

    // Verify final state
    const finalResult = await db.query(`
      SELECT vs.id, vs.vaccine_id, v.name as vaccine_name, v.is_active
      FROM vaccination_schedules vs
      JOIN vaccines v ON vs.vaccine_id = v.id
      ORDER BY v.name
    `);
    console.log(`\n=== FINAL SCHEDULES (${finalResult.rows.length} total) ===`);
    const vaccineScheduleCounts = {};
    for (const row of finalResult.rows) {
      if (!vaccineScheduleCounts[row.vaccine_name]) {
        vaccineScheduleCounts[row.vaccine_name] = 0;
      }
      vaccineScheduleCounts[row.vaccine_name]++;
    }
    for (const [name, count] of Object.entries(vaccineScheduleCounts)) {
      console.log(`${name}: ${count} schedule(s)`);
    }

  } catch (error) {
    console.error('Error during schedule cleanup:', error);
  } finally {
    process.exit();
  }
}

cleanupVaccineSchedules();
