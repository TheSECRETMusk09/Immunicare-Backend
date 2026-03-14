/**
 * Seed Near-Expiry Vaccine Records and Test Admin Notifications
 *
 * This script:
 * 1. Creates near-expiry vaccine inventory records
 * 2. Sends admin notifications for each
 * 3. Sends SMS alert to 09936997484
 */

const db = require('./db');
const { sendExpiryAlert, sendOutOfStockAlert, sendAdminNotification, NOTIFICATION_CATEGORIES, clearDedupCache } = require('./services/adminNotificationService');

const ADMIN_SMS_RECIPIENT = '09936997484';
const DEFAULT_CLINIC_ID = 1; // San Nicolas Health Center

async function seedNearExpiryVaccines() {
  console.log('=== Seeding Near-Expiry Vaccine Records ===\n');

  try {
    // First, let's get active vaccines
    const vaccinesResult = await db.query(
      'SELECT id, name, code FROM vaccines WHERE is_active = true ORDER BY name LIMIT 10',
    );

    if (vaccinesResult.rows.length === 0) {
      console.log('No active vaccines found. Creating sample vaccines...');
      // Create some sample vaccines if none exist
      const sampleVaccines = [
        { name: 'BCG', code: 'BCG' },
        { name: 'Hepatitis B', code: 'HEPB' },
        { name: 'Pentavalent', code: 'PENT' },
        { name: 'Oral Polio', code: 'OPV' },
        { name: 'IPV', code: 'IPV' },
        { name: 'Measles', code: 'MEASLES' },
        { name: 'MMR', code: 'MMR' },
      ];

      for (const v of sampleVaccines) {
        await db.query(
          'INSERT INTO vaccines (name, code, is_active) VALUES ($1, $2, true) ON CONFLICT (code) DO NOTHING',
          [v.name, v.code],
        );
      }

      // Refresh the list
      const refreshed = await db.query(
        'SELECT id, name, code FROM vaccines WHERE is_active = true ORDER BY name LIMIT 10',
      );
      vaccinesResult.rows = refreshed.rows;
    }

    console.log(`Found ${vaccinesResult.rows.length} active vaccines`);

    // Create expiry dates: 3 days, 7 days, and 14 days from now
    const expiryDates = [
      new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),  // 3 days
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),  // 7 days
      new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
    ];

    const lotNumbers = ['LOT2024-001', 'LOT2024-002', 'LOT2024-003'];

    console.log('\n--- Creating near-expiry vaccine inventory records ---\n');

    const createdRecords = [];

    for (let i = 0; i < Math.min(3, vaccinesResult.rows.length); i++) {
      const vaccine = vaccinesResult.rows[i];
      const expiryDate = expiryDates[i];
      const lotNumber = lotNumbers[i];
      const daysUntilExpiry = Math.ceil((expiryDate - Date.now()) / (24 * 60 * 60 * 1000));

      // Insert vaccine inventory record with clinic_id
      const result = await db.query(
        `INSERT INTO vaccine_inventory
         (vaccine_id, clinic_id, lot_batch_number, stock_on_hand, expiry_date, is_active)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING id`,
        [vaccine.id, DEFAULT_CLINIC_ID, lotNumber, 50, expiryDate],
      );

      console.log(`Created inventory: ${vaccine.name} [${vaccine.code}]`);
      console.log(`  Lot: ${lotNumber}, Stock: 50, Expires: ${expiryDate.toISOString().split('T')[0]} (${daysUntilExpiry} days)`);

      createdRecords.push({
        vaccineId: vaccine.id,
        vaccineName: vaccine.name,
        vaccineCode: vaccine.code,
        lotNumber,
        expiryDate,
        daysUntilExpiry,
        inventoryId: result.rows[0].id,
      });
    }

    console.log('\n--- Sending Admin Notifications ---\n');

    // Clear deduplication cache to ensure notifications are sent
    clearDedupCache();
    console.log('Cleared deduplication cache\n');

    // Send notifications for each near-expiry record
    for (const record of createdRecords) {
      console.log(`Sending expiry alert for: ${record.vaccineName}`);

      const notifResult = await sendExpiryAlert(
        record.vaccineName,
        record.vaccineId,
        record.expiryDate,
        record.daysUntilExpiry,
        record.lotNumber,
      );

      console.log('  Notification result:', notifResult);

      // Also send direct SMS to the specified number
      console.log(`\n  Sending direct SMS to ${ADMIN_SMS_RECIPIENT}...`);
      const smsResult = await sendAdminNotification({
        category: NOTIFICATION_CATEGORIES.EXPIRY_WARNING,
        title: `VACCINE EXPIRY ALERT: ${record.vaccineName}`,
        message: `${record.vaccineName} (Lot: ${record.lotNumber}) expires in ${record.daysUntilExpiry} days. Please take action.`,
        priority: record.daysUntilExpiry <= 7 ? 'urgent' : 'high',
        targetId: record.vaccineId,
        alertType: `seed_expiry_${record.lotNumber}`,
        skipDedup: true, // Skip deduplication for this seed test
        sendSms: true,
        smsRecipient: ADMIN_SMS_RECIPIENT,
      });

      console.log('  Direct SMS result:', smsResult.results);
    }

    console.log('\n=== Seed Complete ===\n');
    console.log(`Created ${createdRecords.length} near-expiry vaccine records`);
    console.log('Admin notifications sent for each');
    console.log(`SMS alerts sent to: ${ADMIN_SMS_RECIPIENT}`);

    // Summary
    console.log('\n--- Summary ---');
    for (const record of createdRecords) {
      console.log(`- ${record.vaccineName} [${record.vaccineCode}]: ${record.daysUntilExpiry} days until expiry (Lot: ${record.lotNumber})`);
    }

  } catch (error) {
    console.error('Error seeding near-expiry vaccines:', error);
  }

  process.exit(0);
}

// Run the seed
seedNearExpiryVaccines();
