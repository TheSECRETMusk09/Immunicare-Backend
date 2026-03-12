const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'immunicare_dev',
  user: process.env.DB_USER || 'immunicare_dev',
  password: String(process.env.DB_PASSWORD || '')
});

async function main() {
  console.log('Completing remaining database fixes...');
  const client = await pool.connect();

  try {
    // Fix guardians table clinic_id reference
    const guardiansCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'guardians' 
        AND column_name = 'clinic_id'
      );
    `);

    if (!guardiansCheck.rows[0].exists) {
      console.log('Adding clinic_id column to guardians table...');
      await client.query(`
        ALTER TABLE guardians ADD COLUMN clinic_id INTEGER REFERENCES clinics(id) ON UPDATE CASCADE ON DELETE SET NULL;
      `);
      console.log('✓ clinic_id column added to guardians table');
    } else {
      console.log('✓ clinic_id column already exists in guardians table');
    }

    // Check if clinics table exists
    const clinicsCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'clinics'
      );
    `);

    if (!clinicsCheck.rows[0].exists) {
      console.log('Creating clinics table...');
      await client.query(`
        CREATE TABLE clinics (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE,
          region VARCHAR(255),
          address TEXT,
          contact VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await client.query(`
        INSERT INTO clinics (name, region, address, contact) VALUES
        ('Main Health Center', 'Region 1', 'Main Health Center Address', 'Contact Number')
        ON CONFLICT (name) DO NOTHING;
      `);

      console.log('✓ clinics table created');
    } else {
      console.log('✓ clinics table already exists');
    }

    console.log('\nAll remaining fixes completed successfully!');
  } catch (error) {
    console.error('Error:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
