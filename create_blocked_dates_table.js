const pool = require('./db');

const createBlockedDatesTable = async () => {
  try {
    // Create the blocked_dates table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_dates (
        id SERIAL PRIMARY KEY,
        blocked_date DATE NOT NULL UNIQUE,
        is_blocked BOOLEAN NOT NULL DEFAULT TRUE,
        reason TEXT,
        blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        clinic_id INTEGER,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table "blocked_dates" created successfully');

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocked_dates_date ON blocked_dates(blocked_date)
    `);
    console.log('✅ Index "idx_blocked_dates_date" created');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_blocked_dates_clinic ON blocked_dates(clinic_id)
    `);
    console.log('✅ Index "idx_blocked_dates_clinic" created');

    console.log('🎉 Blocked dates table setup complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating blocked_dates table:', error.message);
    process.exit(1);
  }
};

createBlockedDatesTable();
