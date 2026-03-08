/**
 * Script to create the infant_allergies table
 */

const pool = require('./db');

async function createInfantAllergiesTable() {
  const client = await pool.connect();

  try {
    console.log('Creating infant_allergies table...');
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS infant_allergies (
        id SERIAL PRIMARY KEY,
        infant_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
        allergy_type VARCHAR(100) NOT NULL,
        allergen VARCHAR(255) NOT NULL,
        severity VARCHAR(20) CHECK (severity IN ('mild', 'moderate', 'severe')),
        reaction_description TEXT,
        onset_date DATE,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  ✓ Created infant_allergies table');

    // Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_infant_allergies_infant_id ON infant_allergies(infant_id)
    `);
    console.log('  ✓ Created index on infant_id');

    await client.query('COMMIT');
    console.log('\n✅ infant_allergies table created successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating table:', error.message);
    throw error;
  } finally {
    client.release();
    process.exit(0);
  }
}

createInfantAllergiesTable().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
