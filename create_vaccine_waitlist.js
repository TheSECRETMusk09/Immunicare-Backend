/**
 * Script to create vaccine_waitlist and related tables
 */
require('fs');
require('path');
const pool = require('./db');

async function createVaccineWaitlistTable() {
  const client = await pool.connect();

  try {
    console.log('Creating vaccine_waitlist table...');

    // Create vaccine_waitlist table
    await client.query(`
      CREATE TABLE IF NOT EXISTS vaccine_waitlist (
        id SERIAL PRIMARY KEY,
        infant_id INTEGER NOT NULL REFERENCES infants(id) 
          ON UPDATE CASCADE ON DELETE CASCADE,
        vaccine_id INTEGER NOT NULL REFERENCES vaccines(id) 
          ON UPDATE CASCADE ON DELETE CASCADE,
        guardian_id INTEGER NOT NULL REFERENCES guardians(id) 
          ON UPDATE CASCADE ON DELETE CASCADE,
        clinic_id INTEGER NOT NULL REFERENCES clinics(id) 
          ON UPDATE CASCADE ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL DEFAULT 'waiting',
        notified_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(infant_id, vaccine_id, clinic_id)
      )
    `);
    console.log('✅ vaccine_waitlist table created');

    // Create vaccine_availability_notifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS vaccine_availability_notifications (
        id SERIAL PRIMARY KEY,
        waitlist_id INTEGER REFERENCES vaccine_waitlist(id),
        infant_id INTEGER NOT NULL REFERENCES infants(id),
        vaccine_id INTEGER NOT NULL REFERENCES vaccines(id),
        guardian_id INTEGER NOT NULL REFERENCES guardians(id),
        notification_type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        sent_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ vaccine_availability_notifications table created');

    // Create indexes for waitlist
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_infant_id ON vaccine_waitlist(infant_id)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_vaccine_id ON vaccine_waitlist(vaccine_id)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_vaccine_waitlist_status ON vaccine_waitlist(status)'
    );
    console.log('✅ Indexes created');

    // Verify tables exist
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('vaccine_waitlist', 'vaccine_availability_notifications')
    `);

    console.log('\nTables created:');
    tables.rows.forEach((t) => {
      console.log(`  ✅ ${t.table_name}`);
    });

    console.log('\n🎉 Vaccine waitlist tables created successfully!');
  } catch (error) {
    console.error('Error creating tables:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

createVaccineWaitlistTable();
