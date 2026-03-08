/**
 * Settings API Diagnostic Script
 * Tests settings functionality and identifies issues
 */

const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

// Test admin login to get token
async function testSettingsAPI() {
  console.log('=== Settings API Diagnostic Test ===\n');

  let token = null;

  // Step 1: Login to get token
  console.log('Step 1: Testing login...');
  try {
    // Try with different credentials
    const loginRes = await axios.post(
      `${API_BASE}/auth/login`,
      {
        username: 'administrator',
        password: 'admin123'
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
    token = loginRes.data.token;
    console.log('✓ Login successful');
    console.log('  User:', loginRes.data.user?.username);
    console.log('  Role:', loginRes.data.user?.role);
  } catch (err) {
    console.log('✗ Login failed:', err.response?.data?.error || err.message);
    console.log('  Full response:', err.response?.data);

    // Try different admin account
    try {
      console.log('\nTrying admin user...');
      const adminRes = await axios.post(
        `${API_BASE}/auth/login`,
        {
          username: 'admin',
          password: 'admin123'
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
      token = adminRes.data.token;
      console.log('✓ Admin login successful');
    } catch (err2) {
      console.log('✗ Admin login also failed');
    }
  }

  if (!token) {
    console.log('\n✗ No token obtained - checking if users have correct passwords...');

    // Check if we can find a user with a valid password
    const bcrypt = require('bcryptjs');
    const pool = require('./db');

    // Check password hashes
    const users = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username IN (\'admin\', \'administrator\')'
    );
    console.log('\nUser password hashes:');
    for (const user of users.rows) {
      console.log(`  ${user.username}: ${user.password_hash.substring(0, 20)}...`);
    }

    // Try testing password
    if (users.rows.length > 0) {
      const testPwd = 'admin123';
      const isValid = await bcrypt.compare(testPwd, users.rows[0].password_hash);
      console.log(`\nPassword "${testPwd}" is valid for ${users.rows[0].username}:`, isValid);
    }

    await pool.end();
    return;
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // Step 2: Test GET /settings
  console.log('\nStep 2: Testing GET /settings...');
  try {
    const settingsRes = await axios.get(`${API_BASE}/settings`, { headers });
    console.log('✓ GET /settings successful');
    console.log('  Data keys:', Object.keys(settingsRes.data.data || {}));
  } catch (err) {
    console.log('✗ GET /settings failed:', err.response?.data?.error || err.message);
  }

  // Step 3: Test PUT /settings (update settings)
  console.log('\nStep 3: Testing PUT /settings...');
  try {
    const updateRes = await axios.put(
      `${API_BASE}/settings`,
      {
        settings: [{ category: 'general', key: 'theme', value: 'dark', type: 'string' }]
      },
      { headers }
    );
    console.log('✓ PUT /settings successful');
    console.log('  Response:', JSON.stringify(updateRes.data, null, 2));
  } catch (err) {
    console.log('✗ PUT /settings failed:', err.response?.data?.error || err.message);
    if (err.response?.data?.details) {
      console.log('  Details:', err.response.data.details);
    }
  }

  // Step 4: Test POST /settings/:category/reset
  console.log('\nStep 4: Testing POST /settings/general/reset...');
  try {
    const resetRes = await axios.post(`${API_BASE}/settings/general/reset`, {}, { headers });
    console.log('✓ POST /settings/general/reset successful');
    console.log('  Response:', JSON.stringify(resetRes.data, null, 2));
  } catch (err) {
    console.log('✗ POST /settings/general/reset failed:', err.response?.data?.error || err.message);
  }

  console.log('\n=== Diagnostic Complete ===');
}

testSettingsAPI().catch(console.error);
