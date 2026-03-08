const selfsigned = require('selfsigned');
const fs = require('fs');
const path = require('path');

const sslDir = path.join(__dirname, 'ssl');

if (!fs.existsSync(sslDir)) {
  fs.mkdirSync(sslDir, { recursive: true });
  console.log('Created SSL directory');
}

const attrs = [
  { name: 'commonName', value: 'localhost' },
  { name: 'organizationName', value: 'Immunicare' },
  { name: 'organizationalUnitName', value: 'IT Department' },
];

console.log('Generating self-signed certificates...');

const pems = selfsigned.generate(attrs, {
  days: 365,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] },
  ],
});

console.log('Certificates generated');
console.log('Keys in pems object:', Object.keys(pems));

// Check what keys are available
if (pems.private) {
  fs.writeFileSync(path.join(sslDir, 'server.key'), pems.private);
  console.log('Written server.key');
} else if (pems.key) {
  fs.writeFileSync(path.join(sslDir, 'server.key'), pems.key);
  console.log('Written server.key (from key)');
} else {
  console.log('No private key found in pems');
}

if (pems.cert) {
  fs.writeFileSync(path.join(sslDir, 'server.crt'), pems.cert);
  console.log('Written server.crt');
} else if (pems.certificate) {
  fs.writeFileSync(path.join(sslDir, 'server.crt'), pems.certificate);
  console.log('Written server.crt (from certificate)');
} else {
  console.log('No certificate found in pems');
}

console.log('\nDone! Files created in ' + sslDir);
