const db = require('./db');

async function cleanupVaccineInventory() {
  try {
    console.log('Starting vaccine inventory cleanup...');

    // Map of inactive vaccine IDs to active vaccine IDs for migration
    const vaccineIdMap = {
      // BCG (inactive ID 91 -> active ID 1)
      91: 1,
      // PCV 13/PCV 10 (inactive ID 96 -> active ID 6)
      96: 6,
    };

    // Get all inventory records with inactive vaccines
    const inventoryResult = await db.query(`
      SELECT vi.id, vi.vaccine_id, v.name as vaccine_name, v.is_active, vi.stock_on_hand
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE v.is_active = false
    `);

    console.log(`Found ${inventoryResult.rows.length} inventory records with inactive vaccines`);

    let migrated = 0;
    let archived = 0;

    for (const inv of inventoryResult.rows) {
      if (vaccineIdMap[inv.vaccine_id]) {
        // Migrate to active vaccine - add stock to existing inventory or create new
        const newVaccineId = vaccineIdMap[inv.vaccine_id];

        // Check if there's already inventory for the target vaccine at the same clinic
        const existingInvResult = await db.query(
          `SELECT vi.id, vi.stock_on_hand FROM vaccine_inventory vi
           WHERE vi.vaccine_id = $1 AND vi.clinic_id = (SELECT clinic_id FROM vaccine_inventory WHERE id = $2)`,
          [newVaccineId, inv.id],
        );

        if (existingInvResult.rows.length > 0) {
          // Add stock to existing inventory
          const existingInv = existingInvResult.rows[0];
          const newStock = parseInt(existingInv.stock_on_hand || 0) + parseInt(inv.stock_on_hand || 0);

          await db.query(
            'UPDATE vaccine_inventory SET stock_on_hand = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newStock, existingInv.id],
          );
          console.log(`Merged inventory from ${inv.vaccine_name} (ID ${inv.vaccine_id}) to existing inventory, added ${inv.stock_on_hand} doses`);
        } else {
          // Update the vaccine_id to point to the active vaccine
          await db.query(
            'UPDATE vaccine_inventory SET vaccine_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newVaccineId, inv.id],
          );
          console.log(`Migrated inventory from ${inv.vaccine_name} (ID ${inv.vaccine_id}) to active vaccine ID ${newVaccineId}`);
        }

        // Delete the old inventory record if we merged it
        if (existingInvResult.rows.length > 0) {
          await db.query('DELETE FROM vaccine_inventory WHERE id = $1', [inv.id]);
        }

        migrated++;
      } else {
        // Archive inventory for vaccine with no active equivalent - mark as inactive
        await db.query(
          'UPDATE vaccine_inventory SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [inv.id],
        );
        console.log(`Archived inventory for ${inv.vaccine_name} (ID ${inv.vaccine_id}) - no active equivalent`);
        archived++;
      }
    }

    // Summary
    console.log('\n=== CLEANUP SUMMARY ===');
    console.log(`Migrated: ${migrated}`);
    console.log(`Archived: ${archived}`);

    // Verify final state - show only active vaccines in inventory
    const finalResult = await db.query(`
      SELECT DISTINCT vi.vaccine_id, v.name, v.is_active, vi.stock_on_hand
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE vi.is_active = true
      ORDER BY v.name
    `);

    console.log(`\n=== FINAL INVENTORY (active vaccines only, ${finalResult.rows.length} types) ===`);
    for (const row of finalResult.rows) {
      console.log(`ID ${row.vaccine_id}: ${row.name} - Stock: ${row.stock_on_hand}`);
    }

  } catch (error) {
    console.error('Error during inventory cleanup:', error);
  } finally {
    process.exit();
  }
}

cleanupVaccineInventory();
