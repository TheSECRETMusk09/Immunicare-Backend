const db = require('./db');

async function cleanupVaccines() {
  try {
    console.log('Starting vaccine cleanup...');

    // Define approved vaccines (normalized for comparison)
    const approvedVaccines = new Set([
      'BCG',
      'BCG, DILUENT',
      'HEPA B',
      'PENTA VALENT',
      'OPV 20-DOSES',
      'PCV 13/PCV 10',
      'MEASLES & RUBELLA (P)',
      'MMR',
      'MMR, DILUENT 5ML',
      'IPV MULTI DOSE',
    ]);

    // Get all vaccines
    const vaccinesResult = await db.query('SELECT id, name, code, is_active FROM vaccines');
    const vaccines = vaccinesResult.rows;

    console.log(`Total vaccines found: ${vaccines.length}`);

    // Track actions
    const kept = [];
    const removed = [];
    const archived = [];
    const migrated = [];

    for (const vaccine of vaccines) {
      // Normalize vaccine name for comparison
      const normalizedName = vaccine.name
        .toUpperCase()
        .trim()
        .replace(/\s+/g, ' ');

      console.log(`Processing: '${vaccine.name}' (ID: ${vaccine.id}) -> Normalized: '${normalizedName}'`);

      if (approvedVaccines.has(normalizedName)) {
        // Vaccine is approved, keep it
        kept.push(vaccine);
        console.log('  -> KEEP (approved)');
        continue;
      }

      // Check if this is a naming mismatch that can be migrated
      let targetVaccineId = null;
      let migrationReason = '';

      // Check for Measles & Rubella (MR) -> Measles & Rubella (P)
      if (normalizedName === 'MEASLES & RUBELLA (MR)') {
        const targetResult = await db.query(
          'SELECT id FROM vaccines WHERE UPPER(TRIM(REPLACE(name, \'\\s+\', \' \'))) = $1',
          ['MEASLES & RUBELLA (P)'],
        );
        if (targetResult.rows.length > 0) {
          targetVaccineId = targetResult.rows[0].id;
          migrationReason = 'Measles & Rubella (MR) -> Measles & Rubella (P)';
        }
      }

      if (targetVaccineId) {
        // This vaccine can be migrated to an approved vaccine
        console.log(`  -> MIGRATE to vaccine ID ${targetVaccineId} (${migrationReason})`);

        // Update all references to point to the target vaccine
        const tablesToUpdate = [
          'vaccination_records',
          'immunization_records',
          'vaccine_inventory',
          'vaccine_batches',
          'vaccine_inventory_transactions',
          'vaccine_stock_alerts',
          'inventory',
          'vaccine_waitlist',
          'vaccine_availability_notifications',
          'vaccine_supply',
          'vaccination_reminders',
          'vaccination_reminder_templates',
          'vaccination_schedule_config',
          'vaccination_schedules',
        ];

        for (const table of tablesToUpdate) {
          try {
            await db.query(
              `UPDATE ${table} SET vaccine_id = $1 WHERE vaccine_id = $2`,
              [targetVaccineId, vaccine.id],
            );
            console.log(`    -> Updated ${table}`);
          } catch (error) {
            // Table might not exist or column might be different, continue
            console.log(`    -> Skipping ${table} (error: ${error.message})`);
          }
        }

        migrated.push({
          ...vaccine,
          targetVaccineId,
          migrationReason,
        });

        // Now we can safely delete this vaccine since all references are updated
        await db.query('DELETE FROM vaccines WHERE id = $1', [vaccine.id]);
        console.log(`    -> Deleted vaccine ID ${vaccine.id} after migration`);

      } else {
        // This vaccine cannot be migrated, mark as inactive/archived instead of deleting
        console.log('  -> ARCHIVE (no approved equivalent, has dependencies)');

        // Check if is_archived column exists, if not use is_active
        const columnsResult = await db.query(
          'SELECT column_name FROM information_schema.columns WHERE table_name = \'vaccines\' AND column_name = \'is_archived\'',
        );

        if (columnsResult.rows.length > 0) {
          // Use is_archived column
          await db.query(
            'UPDATE vaccines SET is_archived = true, archived_at = NOW() WHERE id = $1',
            [vaccine.id],
          );
        } else {
          // Use is_active column
          await db.query(
            'UPDATE vaccines SET is_active = false WHERE id = $1',
            [vaccine.id],
          );
        }

        archived.push(vaccine);
      }
    }

    // Summary
    console.log('\n=== CLEANUP SUMMARY ===');
    console.log(`Kept (approved): ${kept.length}`);
    kept.forEach(v => console.log(`  - ${v.name} (ID: ${v.id})`));

    console.log(`\nMigrated: ${migrated.length}`);
    migrated.forEach(m => console.log(`  - ${m.name} (ID: ${m.id}) -> ${m.targetVaccineId} (${m.migrationReason})`));

    console.log(`\nArchived/Inactivated: ${archived.length}`);
    archived.forEach(a => console.log(`  - ${a.name} (ID: ${a.id})`));

    console.log(`\nRemoved (deleted): ${removed.length}`);
    removed.forEach(r => console.log(`  - ${r.name} (ID: ${r.id})`));

    // Verify final state
    const finalResult = await db.query('SELECT id, name, code, is_active FROM vaccines ORDER BY name');
    console.log(`\n=== FINAL VACCINE LIST (${finalResult.rows.length} total) ===`);
    finalResult.rows.forEach(v => {
      const status = v.is_active ? 'ACTIVE' : 'INACTIVE';
      console.log(`ID: ${v.id}, Name: '${v.name}', Code: '${v.code}', Status: ${status}`);
    });

  } catch (error) {
    console.error('Error during vaccine cleanup:', error);
  } finally {
    process.exit();
  }
}

cleanupVaccines();
