/**
 * Complete Database Reseed Script
 * Fixes:
 * 1. Guardian Login Password Mismatch - uses correct password "Guardian123"
 * 2. Adds seed data for announcements using the correct schema
 *
 * Run with: node backend/reseed_database.js
 */

require('dotenv').config();
const pool = require('./db');
const bcrypt = require('bcryptjs');

async function reseedDatabase() {
  console.log('===========================================');
  console.log('Starting Complete Database Reseed');
  console.log('===========================================\n');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ============================================================================
    // STEP 1: Update Guardian Passwords to "Guardian123"
    // ============================================================================
    console.log('STEP 1: Updating guardian passwords to "Guardian123"...');

    const salt = await bcrypt.genSalt(10);
    const newPasswordHash = await bcrypt.hash('Guardian123', salt);

    const updatePasswords = await client.query(`
      UPDATE parent_guardian 
      SET password_hash = '${newPasswordHash}', is_password_set = true
      WHERE email IN (
        'maria.santos@email.com', 
        'juan.delacruz@email.com', 
        'ana.reyes@email.com',
        'pedro.garcia@email.com',
        'carmen.lim@email.com'
      )
      RETURNING id, full_name, email
    `);

    console.log(`Updated ${updatePasswords.rowCount} guardian passwords`);

    await client.query('COMMIT');
    console.log('Password update committed successfully!\n');

    // ============================================================================
    // STEP 2: Get admin ID for announcements
    // ============================================================================
    console.log('STEP 2: Getting admin ID for announcements...');

    const adminResult = await pool.query('SELECT id FROM admin WHERE username = \'admin\' LIMIT 1');
    const adminId = adminResult.rows[0]?.id;

    if (!adminId) {
      console.log('WARNING: No admin user found. Announcements will not be created.');
    } else {
      console.log(`Found admin ID: ${adminId}`);
    }

    // ============================================================================
    // STEP 3: Add Seed Data for ANNOUNCEMENTS table (using correct schema)
    // ============================================================================
    console.log('\nSTEP 3: Adding announcement records...');

    const existingAnnounce = await pool.query('SELECT COUNT(*) as count FROM announcements');
    console.log(`Existing announcements: ${existingAnnounce.rows[0].count}`);

    if (parseInt(existingAnnounce.rows[0].count) === 0 && adminId) {
      // Insert sample announcements using correct column names
      const announcementRecords = [
        {
          title: 'National Immunization Month - March 2026',
          content:
            'Join us for the National Immunization Month celebration! Free vaccines available for all children. Please schedule your appointment today.',
          priority: 'high',
          target_audience: 'all',
          status: 'published',
          start_date: '2026-03-01',
          end_date: '2026-03-31'
        },
        {
          title: 'New Vaccine Stocks Arrived',
          content:
            'We have received new supplies of Pentaxim, BCG, and Hepatitis B vaccines. All scheduled appointments will proceed as planned.',
          priority: 'medium',
          target_audience: 'all',
          status: 'published',
          start_date: '2026-02-15',
          end_date: '2026-04-15'
        },
        {
          title: 'Reminder: Bring Vaccination Card',
          content:
            'Please remember to bring your child\'s vaccination card during every appointment for proper documentation.',
          priority: 'medium',
          target_audience: 'patients',
          status: 'published',
          start_date: '2026-01-01',
          end_date: '2026-12-31'
        },
        {
          title: 'Health Center Operating Hours',
          content:
            'San Nicolas Health Center is open Monday to Friday, 8:00 AM to 5:00 PM. Saturday hours are 8:00 AM to 12:00 PM.',
          priority: 'low',
          target_audience: 'all',
          status: 'published',
          start_date: '2026-01-01',
          end_date: '2026-12-31'
        },
        {
          title: 'MMR Vaccine Available',
          content:
            'MMR vaccines are now available for children 9 months and above. Please schedule an appointment with our nurses.',
          priority: 'medium',
          target_audience: 'patients',
          status: 'published',
          start_date: '2026-02-20',
          end_date: '2026-06-30'
        }
      ];

      for (const announce of announcementRecords) {
        try {
          await pool.query(
            `
            INSERT INTO announcements (
              title, content, priority, target_audience, status,
              start_date, end_date, created_by, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          `,
            [
              announce.title,
              announce.content,
              announce.priority,
              announce.target_audience,
              announce.status,
              announce.start_date,
              announce.end_date,
              adminId
            ]
          );
          console.log(`  Added: ${announce.title}`);
        } catch (err) {
          console.log(`  Error adding announcement: ${err.message}`);
        }
      }
    } else if (adminId) {
      console.log('  Announcements already exist, skipping...');
    }

    // ============================================================================
    // STEP 4: Check appointments table structure
    // ============================================================================
    console.log('\nSTEP 4: Checking appointments table...');

    try {
      const apptCheck = await pool.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'appointments' 
        AND column_name IN ('infant_id', 'patient_id', 'scheduled_date')
      `);

      console.log(`  Appointments columns: ${apptCheck.rows.map((r) => r.column_name).join(', ')}`);
    } catch (err) {
      console.log(`  Error checking appointments: ${err.message}`);
    }

    console.log('\n===========================================');
    console.log('Database Reseed Completed Successfully!');
    console.log('===========================================');

    // ============================================================================
    // VERIFICATION
    // ============================================================================
    console.log('\n=== VERIFICATION ===');

    // Check passwords
    const pwCheck = await pool.query(`
      SELECT full_name, email, is_password_set 
      FROM parent_guardian 
      WHERE email IN ('maria.santos@email.com', 'juan.delacruz@email.com')
    `);
    console.log('\nGuardian Password Status:');
    pwCheck.rows.forEach((row) => {
      console.log(`  ${row.full_name} (${row.email}): password_set = ${row.is_password_set}`);
    });

    // Check announcement count
    const announceCount = await pool.query('SELECT COUNT(*) as count FROM announcements');
    console.log(`\nAnnouncements: ${announceCount.rows[0].count}`);

    console.log('\n=== TEST CREDENTIALS ===');
    console.log('Guardian Login:');
    console.log('  Email: maria.santos@email.com');
    console.log('  Password: Guardian123');
    console.log('\nAdmin Login:');
    console.log('  Username: admin');
    console.log('  Password: Admin2026');
  } catch (error) {
    console.error('Error during reseed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Export function for use in other modules
module.exports = { reseedDatabase };

// Run the reseed function if called directly
if (require.main === module) {
  reseedDatabase()
    .then(() => {
      console.log('\nReseed completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Reseed failed:', error.message);
      process.exit(1);
    });
}
