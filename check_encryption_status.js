/**
 * Immunicare Encryption System - Quick Activation Guide
 *
 * This system provides:
 * 1. Database-level encryption using PostgreSQL pgcrypto
 * 2. TLS/SSL for HTTPS communication
 * 3. Encryption of sensitive data (contacts, phone numbers, addresses, birth certificates)
 * 4. Key rotation and backup capabilities
 * 5. Audit logging for all encryption operations
 */

const fs = require('fs');
const path = require('path');

console.log('='.repeat(60));
console.log('IMMUNICARE ENCRYPTION SYSTEM');
console.log('='.repeat(60));
console.log();

console.log('CURRENT ENCRYPTION STATUS:');
console.log('-'.repeat(40));
console.log();

const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');

// Check HTTPS status
const httpsEnabled = envContent.includes('ENABLE_HTTPS=true');
console.log(
  `HTTPS/SSL: ${httpsEnabled ? '✅ ENABLED' : '❌ DISABLED (Set ENABLE_HTTPS=true to enable)'}`
);

// Check database encryption status
const db = require('./db');

async function checkEncryptionStatus() {
  try {
    // Check if pgcrypto is installed
    const pgcryptoCheck = await db.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname = 'pgcrypto'
    `);

    if (pgcryptoCheck.rows.length > 0) {
      console.log(`pgcrypto Extension: ✅ INSTALLED (v${pgcryptoCheck.rows[0].extversion})`);
    } else {
      console.log('pgcrypto Extension: ❌ NOT INSTALLED');
    }

    // Check encryption keys table
    const keysCheck = await db.query(`
      SELECT COUNT(*) as key_count FROM encryption_keys
    `);
    console.log(`Encryption Keys: ${keysCheck.rows[0].key_count} keys defined`);

    // Check encrypted columns
    const usersEncrypted = await db.query(`
      SELECT COUNT(*) as count FROM users 
      WHERE encrypted_contact IS NOT NULL OR encrypted_email IS NOT NULL
    `);
    const guardiansEncrypted = await db.query(`
      SELECT COUNT(*) as count FROM guardians 
      WHERE encrypted_phone IS NOT NULL OR encrypted_email IS NOT NULL OR encrypted_address IS NOT NULL
    `);
    const infantsEncrypted = await db.query(`
      SELECT COUNT(*) as count FROM infants 
      WHERE encrypted_birth_certificate_number IS NOT NULL
    `);

    console.log();
    console.log('ENCRYPTED RECORDS:');
    console.log('-'.repeat(40));
    console.log(`  Users with encrypted data: ${usersEncrypted.rows[0].count}`);
    console.log(`  Guardians with encrypted data: ${guardiansEncrypted.rows[0].count}`);
    console.log(`  Infants with encrypted data: ${infantsEncrypted.rows[0].count}`);

    console.log();
    console.log('SECURITY FEATURES AVAILABLE:');
    console.log('-'.repeat(40));
    console.log('  ✅ AES-256 encryption');
    console.log('  ✅ Key rotation support');
    console.log('  ✅ Encryption audit logging');
    console.log('  ✅ Data integrity verification');
    console.log('  ✅ Key backup & restore');
    console.log('  ✅ TLS/SSL support (HTTPS)');
  } catch (error) {
    console.log('⚠️  Could not check encryption status:', error.message);
    console.log('   Run: node setup_encryption.js to initialize encryption');
  } finally {
    await db.end();
  }
}

console.log();
console.log('QUICK START COMMANDS:');
console.log('-'.repeat(40));
console.log();
console.log('1. Setup Database Encryption:');
console.log('   cd backend && node setup_encryption.js');
console.log();
console.log('2. Migrate Existing Data to Encrypted Columns:');
console.log('   cd backend && node migrate_encrypted_data.js');
console.log();
console.log('3. Enable HTTPS (SSL/TLS):');
console.log('   - Edit backend/.env and set ENABLE_HTTPS=true');
console.log('   - Generate SSL certificates: node generate_ssl_certificates.js');
console.log('   - Restart the server');
console.log();
console.log('4. Test Encryption:');
console.log(
  '   cd backend && node -e "const e = require(\"./services/encryptionService\"); e.checkPgcryptoInstallation().then(r => console.log(r)).catch(console.error)"'
);
console.log();

checkEncryptionStatus().then(() => {
  console.log('='.repeat(60));
});
