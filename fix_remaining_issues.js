/**
 * Immunicare Backend - Fix Remaining Issues
 * Addresses the two remaining issues from the comprehensive fix:
 * 1. Data integrity - orphaned infants
 * 2. SSL certificate generation
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: String(process.env.DB_PASSWORD),
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, type = 'info') {
  const color = type === 'error' ? colors.red : type === 'success' ? colors.green : type === 'warning' ? colors.yellow : colors.blue;
  console.log(`${color}[${type.toUpperCase()}]${colors.reset} ${message}`);
}

async function fixDataIntegrity() {
  console.log('\n=== FIXING DATA INTEGRITY ===\n');

  try {
    // Create default guardian first (before trying to fix infants)
    let defaultGuardian = await pool.query('SELECT id FROM guardians WHERE email = \'system@immunicare.gov.ph\' LIMIT 1');

    if (defaultGuardian.rows.length === 0) {
      const result = await pool.query(`
        INSERT INTO guardians (name, phone, email, relationship)
        VALUES ('System Guardian', '0000000000', 'system@immunicare.gov.ph', 'system')
        RETURNING id
      `);
      defaultGuardian = result;
      log('Created default system guardian', 'success');
    }

    // Now fix orphaned infants
    const orphanedInfants = await pool.query(`
      SELECT i.id, i.first_name, i.last_name, i.guardian_id
      FROM infants i
      LEFT JOIN guardians g ON i.guardian_id = g.id
      WHERE i.guardian_id IS NOT NULL AND g.id IS NULL
    `);

    log(`Found ${orphanedInfants.rows.length} orphaned infant records`, 'info');

    if (orphanedInfants.rows.length > 0) {
      for (const infant of orphanedInfants.rows) {
        await pool.query('UPDATE infants SET guardian_id = $1 WHERE id = $2',
          [defaultGuardian.rows[0].id, infant.id]);
        log(`Fixed orphaned infant ID: ${infant.id}`, 'success');
      }
    }

    // Also fix infants with NULL guardian_id
    const nullGuardianInfants = await pool.query('SELECT id FROM infants WHERE guardian_id IS NULL');
    log(`Found ${nullGuardianInfants.rows.length} infants with NULL guardian_id`, 'info');

    if (nullGuardianInfants.rows.length > 0) {
      await pool.query('UPDATE infants SET guardian_id = $1 WHERE guardian_id IS NULL',
        [defaultGuardian.rows[0].id]);
      log('Fixed infants with NULL guardian_id', 'success');
    }

    log('Data integrity fixed!', 'success');
    return true;
  } catch (error) {
    log(`Data integrity error: ${error.message}`, 'error');
    return false;
  }
}

async function fixSSLCertificates() {
  console.log('\n=== FIXING SSL CERTIFICATES ===\n');

  try {
    const sslDir = path.join(__dirname, 'ssl');

    if (!fs.existsSync(sslDir)) {
      fs.mkdirSync(sslDir, { recursive: true });
    }

    const keyPath = path.join(sslDir, 'server.key');
    const certPath = path.join(sslDir, 'server.crt');

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      log('Generating self-signed SSL certificates...', 'warning');

      // Generate private key
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
      });

      // Create self-signed certificate using different method
      const cert = crypto.createSelfSignedCertificate({
        keys: { key: privateKey, type: 'rsa', modulusLength: 2048 },
        days: 365,
        commonName: 'localhost',
        organizationName: 'Immunicare',
        organizationalUnitName: 'IT Department',
      });

      fs.writeFileSync(keyPath, privateKey);
      fs.writeFileSync(certPath, cert);

      log('Generated SSL certificates!', 'success');
    } else {
      log('SSL certificates already exist', 'info');
    }

    log('SSL certificates fixed!', 'success');
    return true;
  } catch (error) {
    log(`SSL error: ${error.message}`, 'error');
    return false;
  }
}

async function main() {
  console.log(`${colors.cyan}=== Fixing Remaining Issues ===${colors.reset}\n`);

  try {
    await pool.query('SELECT NOW()');
    log('Database connected', 'info');

    const dataIntegrityResult = await fixDataIntegrity();
    const sslResult = await fixSSLCertificates();

    console.log('\n=== SUMMARY ===');
    console.log(`Data Integrity: ${dataIntegrityResult ? 'FIXED' : 'FAILED'}`);
    console.log(`SSL Certificates: ${sslResult ? 'FIXED' : 'FAILED'}`);

    if (dataIntegrityResult && sslResult) {
      console.log(`\n${colors.green}All remaining issues fixed!${colors.reset}`);
    }
  } catch (error) {
    log(`Fatal error: ${error.message}`, 'error');
  } finally {
    await pool.end();
    console.log('\nDatabase connection closed.');
  }
}

main();
