const axios = require('axios');
const fs = require('fs');
const BASE_URL = 'http://localhost:5000';

const output = [];

function log(msg) {
  output.push(msg);
  console.log(msg);
}

async function runTests() {
  try {
    log('=== COMPREHENSIVE SECURITY & FUNCTIONAL TESTS ===\n');

    // 1. Test SQL Injection patterns
    log('1. SQL INJECTION PREVENTION TESTS:');
    const sqlPatterns = [
      { username: 'admin\' OR \'1\'=\'1', password: 'test', desc: 'Basic OR injection' },
      { username: 'admin\' UNION SELECT--', password: 'test', desc: 'UNION injection' },
      { username: '\'; DROP TABLE users;--', password: 'test', desc: 'DROP TABLE' },
      { username: 'OR 1=1', password: 'test', desc: 'OR 1=1' }
    ];

    for (const test of sqlPatterns) {
      try {
        const res = await axios.post(BASE_URL + '/api/auth/login', test, { timeout: 3000 });
        log('  FAIL - ' + test.desc + ': Returned status ' + res.status);
      } catch (e) {
        if (e.response && (e.response.status === 400 || e.response.status === 401)) {
          log('  PASS - ' + test.desc + ': Blocked with status ' + e.response.status);
        } else {
          log('  ERROR - ' + test.desc + ': ' + e.message);
        }
      }
    }

    // 2. Test XSS patterns
    log('\n2. XSS INPUT SANITIZATION TESTS:');
    const xssPatterns = [
      { username: '<script>alert(1)</script>', password: 'test' },
      { username: 'javascript:alert(1)', password: 'test' }
    ];

    for (const test of xssPatterns) {
      try {
        await axios.post(BASE_URL + '/api/auth/login', test, { timeout: 3000 });
        log('  FAIL - XSS not sanitized: ' + test.username.substring(0, 25));
      } catch (e) {
        if (e.response && e.response.status === 400) {
          log('  PASS - XSS blocked: ' + test.username.substring(0, 25));
        }
      }
    }

    // 3. Test Rate Limiting
    log('\n3. RATE LIMITING TESTS:');
    let attempts = 0;
    for (let i = 0; i < 8; i++) {
      try {
        await axios.post(
          BASE_URL + '/api/auth/login',
          { username: 'test' + i, password: 'test' },
          { timeout: 3000 }
        );
        attempts++;
      } catch (e) {
        if (e.response && e.response.status === 429) {
          log('  PASS - Rate limited after ' + attempts + ' attempts');
          break;
        }
      }
    }
    if (attempts >= 8) {
      log('  INFO - No rate limit triggered in 8 attempts');
    }

    // 4. Test SMS Config
    log('\n4. SMS CONFIGURATION:');
    try {
      const smsRes = await axios.post(BASE_URL + '/api/sms/test', { phoneNumber: '+639123456789' });
      log('  SMS Provider: ' + smsRes.data.provider);
      log('  SMS Mode: ' + (smsRes.data.testMode ? 'TEST/LOG' : 'PRODUCTION'));
    } catch (e) {
      log('  ERROR: ' + e.message);
    }

    // 5. Test API Modules Accessibility
    log('\n5. API MODULES ACCESS TEST:');
    const modules = [
      { path: '/api/infants', name: 'Infants' },
      { path: '/api/appointments', name: 'Appointments' },
      { path: '/api/vaccinations', name: 'Vaccinations' },
      { path: '/api/inventory', name: 'Inventory' },
      { path: '/api/dashboard', name: 'Dashboard' }
    ];

    for (const mod of modules) {
      try {
        await axios.get(BASE_URL + mod.path);
        log('  ' + mod.name + ': No auth required (SECURITY ISSUE)');
      } catch (e) {
        if (e.response && e.response.status === 401) {
          log('  ' + mod.name + ': Requires auth (OK)');
        }
      }
    }

    log('\n=== TESTS COMPLETED ===');
  } catch (e) {
    log('ERROR: ' + e.message);
  }

  // Write to file
  fs.writeFileSync('test_output.txt', output.join('\n'));
}

runTests();
