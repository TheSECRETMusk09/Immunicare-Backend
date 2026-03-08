/**
 * Health Center Update Script
 * Updates the San Nicolas Health Center information in the database
 *
 * Health Center Details:
 * - Name: San Nicolas Health Center
 * - Region: NCR
 * - Province: Metro Manila
 * - City: Pasig City
 * - Barangay: San Nicolas
 * - Street: M.H. Del Pilar Street
 * - Zip code: 1600-1612
 */

const pool = require('./db');

async function updateHealthCenter() {
  const client = await pool.connect();

  try {
    console.log('=== Updating San Nicolas Health Center ===\n');

    // First, let's see what clinics exist
    console.log('Current clinics:');
    const existing = await client.query(
      'SELECT id, name, region, address, contact FROM clinics ORDER BY id',
    );

    existing.rows.forEach((row) => {
      console.log(`  ID: ${row.id}, Name: ${row.name}`);
      console.log(`    Region: ${row.region}, Address: ${row.address}`);
      console.log(`    Contact: ${row.contact}`);
      console.log('');
    });

    // Update the San Nicolas Health Center (id=1)
    const healthCenterData = {
      id: 1,
      name: 'San Nicolas Health Center',
      region: 'NCR',
      address: 'M.H. Del Pilar Street, San Nicolas, Pasig City, Metro Manila, 1600-1612',
      contact: '(02) 643-1111',
    };

    console.log('Updating clinic ID 1 with data:');
    console.log(`  Name: ${healthCenterData.name}`);
    console.log(`  Region: ${healthCenterData.region}`);
    console.log(`  Address: ${healthCenterData.address}`);
    console.log(`  Contact: ${healthCenterData.contact}`);
    console.log('');

    // Update the clinic
    const result = await client.query(
      `
      UPDATE clinics
      SET
        name = $1,
        region = $2,
        address = $3,
        contact = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING id, name, region, address, contact, updated_at
    `,
      [
        healthCenterData.name,
        healthCenterData.region,
        healthCenterData.address,
        healthCenterData.contact,
        healthCenterData.id,
      ],
    );

    if (result.rows.length > 0) {
      console.log('Update successful!');
      console.log('Updated health center:');
      const row = result.rows[0];
      console.log(`  ID: ${row.id}`);
      console.log(`  Name: ${row.name}`);
      console.log(`  Region: ${row.region}`);
      console.log(`  Address: ${row.address}`);
      console.log(`  Contact: ${row.contact}`);
      console.log(`  Updated At: ${row.updated_at}`);
    } else {
      console.log('No clinic was updated. Clinic with ID 1 not found.');
    }
    console.log('');

    // Verify the update
    console.log('Verifying update:');
    const verify = await client.query(
      'SELECT id, name, region, address, contact FROM clinics WHERE id = 1',
    );

    if (verify.rows.length > 0) {
      const row = verify.rows[0];
      console.log(`  ID: ${row.id}`);
      console.log(`  Name: ${row.name}`);
      console.log(`  Region: ${row.region}`);
      console.log(`  Address: ${row.address}`);
      console.log(`  Contact: ${row.contact}`);
    }

    console.log('\n=== Health Center Update Complete ===');
  } catch (error) {
    console.error('Error updating health center:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the update
updateHealthCenter()
  .then(() => {
    console.log('\nScript completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nScript failed:', error.message);
    process.exit(1);
  });
