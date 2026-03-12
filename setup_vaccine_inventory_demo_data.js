/**
 * Vaccine Inventory Demo Data Setup Script
 * Populates the vaccine_inventory table with sample demo data
 * for the 10 standard vaccines in the immunization program
 *
 * Run with: node backend/setup_vaccine_inventory_demo_data.js
 */

const { Pool } = require('pg');

// Database configuration - update these to match your environment
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: process.env.DB_PASSWORD || '',
});

// Demo inventory data for each vaccine type
// Using realistic inventory counts for a health center
const demoInventoryData = [
  {
    vaccineCode: 'BCG',
    vaccineName: 'BCG',
    beginningBalance: 50,
    receivedDuringPeriod: 100,
    lotBatchNumber: 'BCG-2026-001',
    transferredIn: 0,
    transferredOut: 0,
    expiredWasted: 5,
    issuance: 45,
    lowStockThreshold: 20,
    criticalStockThreshold: 10,
  },
  {
    vaccineCode: 'BCG-DIL',
    vaccineName: 'BCG, Diluent',
    beginningBalance: 30,
    receivedDuringPeriod: 80,
    lotBatchNumber: 'BCG-DIL-2026-001',
    transferredIn: 0,
    transferredOut: 0,
    expiredWasted: 2,
    issuance: 38,
    lowStockThreshold: 15,
    criticalStockThreshold: 5,
  },
  {
    vaccineCode: 'HEP-B',
    vaccineName: 'Hepa B',
    beginningBalance: 80,
    receivedDuringPeriod: 150,
    lotBatchNumber: 'HEPB-2026-001',
    transferredIn: 0,
    transferredOut: 10,
    expiredWasted: 8,
    issuance: 92,
    lowStockThreshold: 30,
    criticalStockThreshold: 15,
  },
  {
    vaccineCode: 'PENTA',
    vaccineName: 'Penta Valent',
    beginningBalance: 120,
    receivedDuringPeriod: 200,
    lotBatchNumber: 'PENTA-2026-001',
    transferredIn: 0,
    transferredOut: 15,
    expiredWasted: 12,
    issuance: 168,
    lowStockThreshold: 40,
    criticalStockThreshold: 20,
  },
  {
    vaccineCode: 'OPV-20',
    vaccineName: 'OPV 20-doses',
    beginningBalance: 60,
    receivedDuringPeriod: 120,
    lotBatchNumber: 'OPV-2026-001',
    transferredIn: 0,
    transferredOut: 5,
    expiredWasted: 6,
    issuance: 89,
    lowStockThreshold: 25,
    criticalStockThreshold: 10,
  },
  {
    vaccineCode: 'PCV-13-10',
    vaccineName: 'PCV 13 / PCV 10',
    beginningBalance: 75,
    receivedDuringPeriod: 130,
    lotBatchNumber: 'PCV-2026-001',
    transferredIn: 0,
    transferredOut: 8,
    expiredWasted: 4,
    issuance: 97,
    lowStockThreshold: 25,
    criticalStockThreshold: 12,
  },
  {
    vaccineCode: 'MR',
    vaccineName: 'Measles & Rubella (MR)',
    beginningBalance: 90,
    receivedDuringPeriod: 180,
    lotBatchNumber: 'MR-2026-001',
    transferredIn: 0,
    transferredOut: 12,
    expiredWasted: 10,
    issuance: 138,
    lowStockThreshold: 35,
    criticalStockThreshold: 15,
  },
  {
    vaccineCode: 'MMR',
    vaccineName: 'MMR',
    beginningBalance: 85,
    receivedDuringPeriod: 160,
    lotBatchNumber: 'MMR-2026-001',
    transferredIn: 0,
    transferredOut: 10,
    expiredWasted: 7,
    issuance: 118,
    lowStockThreshold: 30,
    criticalStockThreshold: 15,
  },
  {
    vaccineCode: 'MMR-DIL',
    vaccineName: 'MMR, Diluent 5ml',
    beginningBalance: 40,
    receivedDuringPeriod: 90,
    lotBatchNumber: 'MMR-DIL-2026-001',
    transferredIn: 0,
    transferredOut: 5,
    expiredWasted: 3,
    issuance: 62,
    lowStockThreshold: 20,
    criticalStockThreshold: 8,
  },
  {
    vaccineCode: 'IPV-MULTI',
    vaccineName: 'IPV multi dose',
    beginningBalance: 55,
    receivedDuringPeriod: 100,
    lotBatchNumber: 'IPV-2026-001',
    transferredIn: 0,
    transferredOut: 8,
    expiredWasted: 5,
    issuance: 72,
    lowStockThreshold: 20,
    criticalStockThreshold: 10,
  },
];

async function setupVaccineInventoryDemoData() {
  const client = await pool.connect();

  try {
    console.log('💉 Setting up Vaccine Inventory Demo Data...\n');

    // Start transaction
    await client.query('BEGIN');

    // Get the default facility ID (Main Health Center)
    const facilityResult = await client.query(`
      SELECT id FROM healthcare_facilities
      WHERE name = 'Main Health Center'
      LIMIT 1
    `);

    let facilityId;
    if (facilityResult.rows.length === 0) {
      // Create default facility if not exists
      const newFacility = await client.query(`
        INSERT INTO healthcare_facilities (name, region, address, contact, facility_type)
        VALUES ('Main Health Center', 'Region IV-A', 'Barangay San Nicolas, Pasig City', '+63 900 123 4567', 'health_center')
        RETURNING id
      `);
      facilityId = newFacility.rows[0].id;
      console.log('✓ Created default healthcare facility');
    } else {
      facilityId = facilityResult.rows[0].id;
    }

    // Get the admin user ID for created_by/updated_by
    const adminResult = await client.query(`
      SELECT id FROM admin
      WHERE role = 'super_admin'
      LIMIT 1
    `);

    let adminId;
    if (adminResult.rows.length === 0) {
      // Use first available admin
      const anyAdmin = await client.query('SELECT id FROM admin LIMIT 1');
      adminId = anyAdmin.rows[0]?.id || 1;
    } else {
      adminId = adminResult.rows[0].id;
    }

    // Get current date for period
    const currentDate = new Date();
    const periodStart = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const periodEnd = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

    // Insert or update inventory for each vaccine
    for (const vaccineData of demoInventoryData) {
      // Find vaccine by code
      const vaccineResult = await client.query(`
        SELECT id FROM vaccines WHERE code = $1
      `, [vaccineData.vaccineCode]);

      if (vaccineResult.rows.length === 0) {
        console.log(`⚠️  Vaccine not found: ${vaccineData.vaccineCode} - skipping`);
        continue;
      }

      const vaccineId = vaccineResult.rows[0].id;

      // Calculate total available and stock on hand
      const totalAvailable = vaccineData.beginningBalance + vaccineData.receivedDuringPeriod;
      const stockOnHand = totalAvailable + vaccineData.transferredIn -
                          vaccineData.transferredOut - vaccineData.expiredWasted -
                          vaccineData.issuance;

      // Determine low stock and critical stock flags
      const isLowStock = stockOnHand <= vaccineData.lowStockThreshold;
      const isCriticalStock = stockOnHand <= vaccineData.criticalStockThreshold;

      // Check if inventory record already exists for this vaccine and period
      const existingRecord = await client.query(`
        SELECT id FROM vaccine_inventory
        WHERE vaccine_id = $1 AND facility_id = $2
          AND period_start = $3 AND period_end = $4
      `, [vaccineId, facilityId, periodStart, periodEnd]);

      if (existingRecord.rows.length > 0) {
        // Update existing record
        await client.query(`
          UPDATE vaccine_inventory SET
            beginning_balance = $1,
            received_during_period = $2,
            lot_batch_number = $3,
            transferred_in = $4,
            transferred_out = $5,
            expired_wasted = $6,
            issuance = $7,
            low_stock_threshold = $8,
            critical_stock_threshold = $9,
            is_low_stock = $10,
            is_critical_stock = $11,
            updated_by = $12,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $13
        `, [
          vaccineData.beginningBalance,
          vaccineData.receivedDuringPeriod,
          vaccineData.lotBatchNumber,
          vaccineData.transferredIn,
          vaccineData.transferredOut,
          vaccineData.expiredWasted,
          vaccineData.issuance,
          vaccineData.lowStockThreshold,
          vaccineData.criticalStockThreshold,
          isLowStock,
          isCriticalStock,
          adminId,
          existingRecord.rows[0].id,
        ]);
        console.log(`✓ Updated inventory: ${vaccineData.vaccineName}`);
      } else {
        // Insert new record
        await client.query(`
          INSERT INTO vaccine_inventory (
            vaccine_id, facility_id, beginning_balance, received_during_period,
            lot_batch_number, transferred_in, transferred_out, expired_wasted,
            issuance, low_stock_threshold, critical_stock_threshold,
            is_low_stock, is_critical_stock, period_start, period_end,
            created_by, updated_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `, [
          vaccineId,
          facilityId,
          vaccineData.beginningBalance,
          vaccineData.receivedDuringPeriod,
          vaccineData.lotBatchNumber,
          vaccineData.transferredIn,
          vaccineData.transferredOut,
          vaccineData.expiredWasted,
          vaccineData.issuance,
          vaccineData.lowStockThreshold,
          vaccineData.criticalStockThreshold,
          isLowStock,
          isCriticalStock,
          periodStart,
          periodEnd,
          adminId,
          adminId,
        ]);
        console.log(`✓ Created inventory: ${vaccineData.vaccineName}`);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    console.log('\n📊 Vaccine Inventory Demo Data Summary:');
    console.log('═══════════════════════════════════════════════════════');
    console.log('Vaccine Name                  | Beginning | Received | Issued | Stock');
    console.log('──────────────────────────────|-----------|----------|--------|------');

    for (const vaccineData of demoInventoryData) {
      const totalAvailable = vaccineData.beginningBalance + vaccineData.receivedDuringPeriod;
      const stockOnHand = totalAvailable + vaccineData.transferredIn -
                          vaccineData.transferredOut - vaccineData.expiredWasted -
                          vaccineData.issuance;

      console.log(
        `${vaccineData.vaccineName.padEnd(28)}| ${String(vaccineData.beginningBalance).padStart(9)} | ${String(vaccineData.receivedDuringPeriod).padStart(8)} | ${String(vaccineData.issuance).padStart(6)} | ${String(stockOnHand).padStart(5)}`,
      );
    }
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('✅ Vaccine inventory demo data setup completed successfully!');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error setting up vaccine inventory demo data:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run setup if executed directly
if (require.main === module) {
  setupVaccineInventoryDemoData()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupVaccineInventoryDemoData, demoInventoryData };
