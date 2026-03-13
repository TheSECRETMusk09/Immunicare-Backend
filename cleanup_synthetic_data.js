/**
 * Synthetic Data Cleanup Script
 * Removes test/synthetic data that's causing performance issues
 * Run: node cleanup_synthetic_data.js
 */

const db = require('./db');

async function cleanupSyntheticData() {
  const client = await db.connect();

  try {
    console.log('='.repeat(60));
    console.log('SYNTHETIC DATA CLEANUP');
    console.log('='.repeat(60));

    // ===== STEP 1: VERIFY SYNTHETIC DATA =====
    console.log('\n>>> STEP 1: Verifying Synthetic Data Counts\n');

    const verificationQueries = [
      { name: 'infants (SYNPH26-INF-*)', sql: 'SELECT COUNT(*) FROM infants WHERE patient_control_number LIKE \'SYNPH26-INF-%\'' },
      { name: 'patients (SYNPH26-INF-*)', sql: 'SELECT COUNT(*) FROM patients WHERE control_number LIKE \'SYNPH26-INF-%\'' },
      { name: 'guardians (syn_guard_*)', sql: 'SELECT COUNT(*) FROM guardians WHERE email LIKE \'syn_guard_%@synthetic-immunicare.ph\'' },
      { name: 'vaccines (SYNPH26-*)', sql: 'SELECT COUNT(*) FROM vaccines WHERE code LIKE \'SYNPH26-%\'' },
      { name: 'suppliers (SYNPH26SUP*)', sql: 'SELECT COUNT(*) FROM suppliers WHERE supplier_code LIKE \'SYNPH26SUP%\'' },
    ];

    for (const vq of verificationQueries) {
      const result = await client.query(vq.sql);
      console.log(`  ${vq.name}: ${result.rows[0].count}`);
    }

    // ===== STEP 2: DELETE SYNTHETIC TRANSACTION DATA (Child Tables) =====
    console.log('\n>>> STEP 2: Deleting Synthetic Transaction Data\n');

    const transactionDeletes = [
      { name: 'vaccination_reminders', sql: 'DELETE FROM vaccination_reminders WHERE notes LIKE \'SYNPH26-TXN-VR-%\'' },
      { name: 'appointments', sql: 'DELETE FROM appointments WHERE notes LIKE \'SYNPH26-TXN-AP-%\'' },
      { name: 'immunization_records', sql: 'DELETE FROM immunization_records WHERE notes LIKE \'SYNPH26-TXN-IR-%\'' },
      { name: 'notifications', sql: 'DELETE FROM notifications WHERE message LIKE \'SYNPH26-TXN-NF-%\'' },
      { name: 'sms_logs', sql: 'DELETE FROM sms_logs WHERE message LIKE \'SYNPH26-TXN-SMS-%\'' },
      { name: 'inventory_transactions', sql: 'DELETE FROM inventory_transactions WHERE notes LIKE \'SYNPH26-TXN-IT-%\'' },
      { name: 'audit_logs', sql: 'DELETE FROM audit_logs WHERE new_values LIKE \'%SYNPH26-TXN-AUD-%\'' },
    ];

    for (const td of transactionDeletes) {
      const result = await client.query(td.sql);
      console.log(`  Deleted ${result.rowCount} from ${td.name}`);
    }

    // ===== STEP 3: DELETE INVENTORY SYNTHETIC ROWS =====
    console.log('\n>>> STEP 3: Deleting Inventory Synthetic Rows\n');

    const inventoryDeletes = [
      { name: 'vaccine_inventory (SYNLOT-*)', sql: 'DELETE FROM vaccine_inventory WHERE lot_batch_number LIKE \'SYNLOT-%\'' },
      { name: 'vaccine_batches (SYNLOT-*)', sql: 'DELETE FROM vaccine_batches WHERE lot_no LIKE \'SYNLOT-%\'' },
    ];

    for (const inv of inventoryDeletes) {
      const result = await client.query(inv.sql);
      console.log(`  Deleted ${result.rowCount} from ${inv.name}`);
    }

    // ===== STEP 4: DELETE INFANTS AND PATIENTS =====
    console.log('\n>>> STEP 4: Deleting Infants and Patients\n');

    const coreDeletes = [
      { name: 'infants', sql: 'DELETE FROM infants WHERE patient_control_number LIKE \'SYNPH26-INF-%\'' },
      { name: 'patients', sql: 'DELETE FROM patients WHERE control_number LIKE \'SYNPH26-INF-%' },
    ];

    for (const cd of coreDeletes) {
      const result = await client.query(cd.sql);
      console.log(`  Deleted ${result.rowCount} from ${cd.name}`);
    }

    // ===== STEP 5: DELETE GUARDIANS AND USERS =====
    console.log('\n>>> STEP 5: Deleting Guardians and Users\n');

    // First delete related preferences and phone numbers
    await client.query(`
      DELETE FROM guardian_notification_preferences
      WHERE guardian_id IN (
        SELECT id FROM guardians
        WHERE email LIKE 'syn_guard_%@synthetic-immunicare.ph'
      )
    `);
    console.log('  Deleted guardian_notification_preferences');

    await client.query(`
      DELETE FROM guardian_phone_numbers
      WHERE guardian_id IN (
        SELECT id FROM guardians
        WHERE email LIKE 'syn_guard_%@synthetic-immunicare.ph'
      )
    `);
    console.log('  Deleted guardian_phone_numbers');

    const userResult = await client.query(`
      DELETE FROM users
      WHERE username LIKE 'syn_%'
         OR email LIKE '%@synthetic-immunicare.ph'
    `);
    console.log(`  Deleted ${userResult.rowCount} from users`);

    const guardianResult = await client.query(`
      DELETE FROM guardians
      WHERE email LIKE 'syn_guard_%@synthetic-immunicare.ph'
    `);
    console.log(`  Deleted ${guardianResult.rowCount} from guardians`);

    // ===== STEP 6: DELETE VACCINES AND SUPPLIERS =====
    console.log('\n>>> STEP 6: Deleting Vaccines and Suppliers\n');

    const vsDeletes = [
      { name: 'suppliers', sql: 'DELETE FROM suppliers WHERE supplier_code LIKE \'SYNPH26SUP%\'' },
      { name: 'vaccines', sql: 'DELETE FROM vaccines WHERE code LIKE \'SYNPH26-%\'' },
    ];

    for (const vs of vsDeletes) {
      const result = await client.query(vs.sql);
      console.log(`  Deleted ${result.rowCount} from ${vs.name}`);
    }

    // ===== STEP 7: CHECK REMAINING DATA =====
    console.log('\n>>> STEP 7: Checking Remaining Data\n');

    const remainingQueries = [
      { name: 'infants', sql: 'SELECT COUNT(*) FROM infants' },
      { name: 'patients', sql: 'SELECT COUNT(*) FROM patients' },
      { name: 'vaccination_reminders', sql: 'SELECT COUNT(*) FROM vaccination_reminders' },
      { name: 'appointments', sql: 'SELECT COUNT(*) FROM appointments' },
      { name: 'immunization_records', sql: 'SELECT COUNT(*) FROM immunization_records' },
    ];

    for (const rq of remainingQueries) {
      const result = await client.query(rq.sql);
      console.log(`  ${rq.name}: ${result.rows[0].count}`);
    }

    // ===== OPTIONAL: RESET SEQUENCES =====
    console.log('\n>>> OPTIONAL: Resetting ID Sequences\n');

    try {
      await client.query('SELECT setval(\'infants_id_seq\', (SELECT MAX(id) FROM infants))');
      console.log('  Reset infants_id_seq');
    } catch (e) {
      console.log('  Skipped infants_id_seq:', e.message);
    }

    try {
      await client.query('SELECT setval(\'patients_id_seq\', (SELECT MAX(id) FROM patients))');
      console.log('  Reset patients_id_seq');
    } catch (e) {
      console.log('  Skipped patients_id_seq:', e.message);
    }

    console.log('\n' + '='.repeat(60));
    console.log('CLEANUP COMPLETE!');
    console.log('='.repeat(60));
    console.log('\nIMPORTANT: Restart your system:');
    console.log('  - Backend server');
    console.log('  - Frontend application');
    console.log('\nYour system should become fast again.');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error during cleanup:', error);
  } finally {
    client.release();
    await db.end();
  }
}

cleanupSyntheticData().catch(console.error);
