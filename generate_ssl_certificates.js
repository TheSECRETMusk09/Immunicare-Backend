/**
 * SSL Certificate Generation Script
 * This script generates self-signed SSL certificates for development
 * For production, use certificates from a trusted Certificate Authority (CA)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Generate self-signed SSL certificates using OpenSSL
 */
const generateCertificates = () => {
  console.log('='.repeat(60));
  console.log('SSL Certificate Generation');
  console.log('='.repeat(60));
  console.log();

  const certDir = path.join(__dirname, 'ssl');
  const keyPath = path.join(certDir, 'server.key');
  const certPath = path.join(certDir, 'server.crt');
  const csrPath = path.join(certDir, 'server.csr');

  try {
    // Create SSL directory if it doesn't exist
    if (!fs.existsSync(certDir)) {
      console.log('1. Creating SSL directory...');
      fs.mkdirSync(certDir, { recursive: true });
      console.log(`✓ Created directory: ${certDir}`);
      console.log();
    } else {
      console.log('1. SSL directory already exists');
      console.log();
    }

    // Check if certificates already exist
    if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
      console.log('2. SSL certificates already exist');
      console.log(`   Key: ${keyPath}`);
      console.log(`   Certificate: ${certPath}`);
      console.log();
      console.log(
        'To regenerate certificates, delete the existing files and run this script again.'
      );
      console.log();
      return true;
    }

    // Check if OpenSSL is available
    console.log('2. Checking OpenSSL availability...');
    try {
      execSync('openssl version', { stdio: 'pipe' });
      console.log('✓ OpenSSL is available');
      console.log();
    } catch (error) {
      console.error('✗ OpenSSL is not available');
      console.error();
      console.error('Please install OpenSSL:');
      console.error('  - Windows: Download from https://slproweb.com/products/Win32OpenSSL.html');
      console.error('  - macOS: Already installed');
      console.error('  - Linux: sudo apt-get install openssl (Debian/Ubuntu)');
      console.error('             sudo yum install openssl (RHEL/CentOS)');
      console.error();
      return false;
    }

    // Generate private key
    console.log('3. Generating private key...');
    try {
      execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: 'pipe' });
      console.log(`✓ Generated private key: ${keyPath}`);
      console.log();
    } catch (error) {
      console.error('✗ Failed to generate private key');
      console.error(error.message);
      return false;
    }

    // Generate certificate signing request (CSR)
    console.log('4. Generating certificate signing request (CSR)...');
    try {
      const configPath = path.join(certDir, 'openssl.cnf');
      const config = `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = SG
ST = Singapore
L = Singapore
O = Immunicare
OU = Development
CN = localhost

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
DNS.2 = *.localhost
DNS.3 = 127.0.0.1
IP.1 = 127.0.0.1
IP.2 = ::1
`;
      fs.writeFileSync(configPath, config);

      execSync(`openssl req -new -key "${keyPath}" -out "${csrPath}" -config "${configPath}"`, {
        stdio: 'pipe'
      });
      console.log(`✓ Generated CSR: ${csrPath}`);
      console.log();
    } catch (error) {
      console.error('✗ Failed to generate CSR');
      console.error(error.message);
      return false;
    }

    // Generate self-signed certificate
    console.log('5. Generating self-signed certificate...');
    try {
      const configPath = path.join(certDir, 'openssl.cnf');
      execSync(
        `openssl x509 -req -days 365 -in "${csrPath}" -signkey "${keyPath}" -out "${certPath}" -extensions v3_req -extfile "${configPath}"`,
        { stdio: 'pipe' }
      );
      console.log(`✓ Generated certificate: ${certPath}`);
      console.log();
    } catch (error) {
      console.error('✗ Failed to generate certificate');
      console.error(error.message);
      return false;
    }

    // Set file permissions
    console.log('6. Setting file permissions...');
    try {
      // On Unix-like systems, set restrictive permissions
      if (process.platform !== 'win32') {
        fs.chmodSync(keyPath, 0o600);
        fs.chmodSync(certPath, 0o644);
        console.log('✓ Set file permissions');
      } else {
        console.log('✓ File permissions set (Windows)');
      }
      console.log();
    } catch (error) {
      console.warn('⚠ Could not set file permissions:', error.message);
      console.log();
    }

    // Display certificate information
    console.log('7. Certificate information:');
    try {
      const certInfo = execSync(`openssl x509 -in "${certPath}" -noout -text`, {
        encoding: 'utf8'
      });
      console.log(certInfo);
    } catch (error) {
      console.warn('⚠ Could not display certificate information');
    }

    console.log('='.repeat(60));
    console.log('✓ SSL certificates generated successfully!');
    console.log('='.repeat(60));
    console.log();
    console.log('Generated files:');
    console.log(`  - Private Key: ${keyPath}`);
    console.log(`  - Certificate: ${certPath}`);
    console.log(`  - CSR: ${csrPath}`);
    console.log();
    console.log('Next steps:');
    console.log('1. Add the following to your .env file:');
    console.log('   SSL_KEY_PATH=./ssl/server.key');
    console.log('   SSL_CERT_PATH=./ssl/server.crt');
    console.log('   HTTPS_PORT=5443');
    console.log('   ENABLE_HTTPS=true');
    console.log();
    console.log('2. Start the server with HTTPS enabled');
    console.log('   npm start');
    console.log();
    console.log('3. Access the server at:');
    console.log('   https://localhost:5443');
    console.log();
    console.log('⚠ WARNING: These are self-signed certificates for development only!');
    console.log('   For production, use certificates from a trusted Certificate Authority (CA).');
    console.log();

    return true;
  } catch (error) {
    console.error('='.repeat(60));
    console.error('✗ SSL certificate generation failed!');
    console.error('='.repeat(60));
    console.error();
    console.error('Error:', error.message);
    console.error();

    return false;
  }
};

// Run certificate generation
const success = generateCertificates();
process.exit(success ? 0 : 1);
