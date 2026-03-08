/**
 * check_clinics.js
 * Utility script to verify clinics/health centers data in the database
 *
 * This script checks the health_centers table and validates clinic data
 */

const db = require('./db');

/**
 * Check if the health_centers table exists
 */
async function checkHealthCentersTable() {
  try {
    const result = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'health_centers'
    `);
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking health_centers table:', error.message);
    return false;
  }
}

/**
 * Get all clinics from the database
 */
async function getAllClinics() {
  try {
    const result = await db.query(`
      SELECT id, name, address, phone, email, is_active
      FROM health_centers
      ORDER BY name
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching clinics:', error.message);
    return [];
  }
}

/**
 * Get active clinics only
 */
async function getActiveClinics() {
  try {
    const result = await db.query(`
      SELECT id, name, address, phone, email
      FROM health_centers
      WHERE is_active = true
      ORDER BY name
    `);
    return result.rows;
  } catch (error) {
    console.error('Error fetching active clinics:', error.message);
    return [];
  }
}

/**
 * Verify clinic data integrity
 */
async function verifyClinicData() {
  const issues = [];

  try {
    // Check if table exists
    const tableExists = await checkHealthCentersTable();
    if (!tableExists) {
      issues.push('health_centers table does not exist');
      return { valid: false, issues };
    }

    // Get all clinics
    const clinics = await getAllClinics();

    if (clinics.length === 0) {
      issues.push('No clinics found in the database');
    }

    // Validate each clinic
    for (const clinic of clinics) {
      if (!clinic.name || clinic.name.trim() === '') {
        issues.push(`Clinic ID ${clinic.id} has no name`);
      }
      if (!clinic.address || clinic.address.trim() === '') {
        issues.push(`Clinic ID ${clinic.id} has no address`);
      }
    }

    return {
      valid: issues.length === 0,
      issues,
      clinicCount: clinics.length,
    };
  } catch (error) {
    console.error('Error verifying clinic data:', error.message);
    return { valid: false, issues: [error.message] };
  }
}

/**
 * Main function to run all checks
 */
async function main() {
  console.log('=== Clinic Verification Script ===\n');

  try {
    // Check table existence
    const tableExists = await checkHealthCentersTable();
    console.log(`Health centers table exists: ${tableExists}`);

    if (!tableExists) {
      console.log('\nPlease run the database setup scripts first.');
      process.exit(1);
    }

    // Get clinic statistics
    const allClinics = await getAllClinics();
    const activeClinics = await getActiveClinics();

    console.log(`\nTotal clinics: ${allClinics.length}`);
    console.log(`Active clinics: ${activeClinics.length}`);

    // Verify data
    const verification = await verifyClinicData();
    console.log(`\nVerification result: ${verification.valid ? 'PASSED' : 'FAILED'}`);

    if (verification.issues.length > 0) {
      console.log('\nIssues found:');
      verification.issues.forEach((issue) => {
        console.log(`  - ${issue}`);
      });
    }

    // Display clinics
    if (allClinics.length > 0) {
      console.log('\nClinics list:');
      allClinics.forEach((clinic) => {
        console.log(`  - ${clinic.name} (ID: ${clinic.id}) - ${clinic.is_active ? 'Active' : 'Inactive'}`);
      });
    }

    console.log('\n=== Verification Complete ===');
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  } finally {
    // Close database connection
    if (db.end) {
      await db.end();
    }
  }
}

// Export functions for use in other modules
module.exports = {
  checkHealthCentersTable,
  getAllClinics,
  getActiveClinics,
  verifyClinicData,
};

// Run if executed directly
if (require.main === module) {
  main();
}
