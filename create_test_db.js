const { Pool } = require('pg');
const loadBackendEnv = require('./config/loadEnv');
loadBackendEnv();

const main = async () => {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: 'postgres', // Connect to the default 'postgres' database
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
  });

  try {
    console.log('Connecting to the postgres database...');
    const client = await pool.connect();
    console.log('Connected to the postgres database.');

    console.log('Creating the immunicare_test database...');
    await client.query('CREATE DATABASE immunicare_test');
    console.log('Database immunicare_test created.');

    client.release();
  } catch (err) {
    console.error('Error creating database:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
};

main();
