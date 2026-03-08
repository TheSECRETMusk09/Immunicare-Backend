/**
 * Proxy Error Diagnostic Tool
 *
 * This script diagnoses ECONNREFUSED errors when proxying from
 * React frontend (localhost:3000) to backend (localhost:5000)
 */

const http = require('http');
const net = require('net');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');

const BACKEND_PORT = 5000;
const FRONTEND_PORT = 3000;
const BACKEND_HOST = 'localhost';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, type = 'info') {
  const color =
    type === 'error'
      ? colors.red
      : type === 'success'
        ? colors.green
        : type === 'warning'
          ? colors.yellow
          : colors.blue;
  console.log(`${color}${message}${colors.reset}`);
}

async function checkPortStatus(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, BACKEND_HOST);
  });
}

async function checkPortWithNetstat(port) {
  try {
    const { stdout } = await execPromise(`netstat -ano | findstr :${port}`);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function getProcessOnPort(port) {
  try {
    const { stdout } = await execPromise(`netstat -ano | findstr :${port}`);
    if (!stdout) {
      return null;
    }

    const lines = stdout.split('\n').filter((line) => line.includes(`:${port}`));
    if (lines.length === 0) {
      return null;
    }

    const match = lines[0].match(/(\d+)$/);
    if (!match) {
      return null;
    }

    const pid = match[1];
    const { stdout: processStdout } = await execPromise(`tasklist | findstr ${pid}`);
    return { pid, process: processStdout.trim() };
  } catch {
    return null;
  }
}

function testHealthEndpoint() {
  return new Promise((resolve) => {
    const options = {
      hostname: BACKEND_HOST,
      port: BACKEND_PORT,
      path: '/api/health',
      method: 'GET',
      timeout: 3000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          success: res.statusCode === 200,
          statusCode: res.statusCode,
          data: data
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Request timeout'
      });
    });

    req.end();
  });
}

function testProxyEndpoint() {
  return new Promise((resolve) => {
    const options = {
      hostname: BACKEND_HOST,
      port: FRONTEND_PORT,
      path: '/api/health',
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          success: res.statusCode === 200,
          statusCode: res.statusCode,
          data: data
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        success: false,
        error: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        success: false,
        error: 'Request timeout'
      });
    });

    req.end();
  });
}

async function checkEnvironmentVariables() {
  log('\n=== Checking Environment Variables ===', 'info');

  const requiredVars = ['PORT', 'DB_HOST', 'DB_NAME', 'JWT_SECRET'];
  const missing = [];

  require('dotenv').config({ path: path.join(__dirname, '.env') });

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    log(`❌ Missing environment variables: ${missing.join(', ')}`, 'error');
    log('   Make sure backend/.env file exists and is properly configured', 'warning');
  } else {
    log('✅ All required environment variables present', 'success');
  }

  const port = process.env.PORT || 5000;
  if (port !== BACKEND_PORT) {
    log(`⚠️  PORT is set to ${port}, expected ${BACKEND_PORT}`, 'warning');
  } else {
    log(`✅ PORT correctly set to ${port}`, 'success');
  }
}

async function runDiagnostics() {
  log('╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║     Proxy Error Diagnostic Tool                           ║', 'cyan');
  log('║     Checking connection: React (3000) → Backend (5000)    ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');

  // 1. Check if backend port is listening
  log('\n=== Step 1: Checking if Backend is Running on Port 5000 ===', 'info');
  const isPortListening = await checkPortStatus(BACKEND_PORT);
  const netstatResult = await checkPortWithNetstat(BACKEND_PORT);

  if (isPortListening) {
    log('✅ Backend server is responding on port 5000', 'success');
    const processInfo = await getProcessOnPort(BACKEND_PORT);
    if (processInfo) {
      log(`   Process: ${processInfo.process.split(' ')[0]} (PID: ${processInfo.pid})`, 'info');
    }
  } else if (netstatResult) {
    log('⚠️  Port 5000 is bound but not accepting connections', 'warning');
    const processInfo = await getProcessOnPort(BACKEND_PORT);
    if (processInfo) {
      log(`   Process using port: ${processInfo.process.split(' ')[0]}`, 'info');
    }
    log('   Server may be starting up or crashed', 'warning');
  } else {
    log('❌ Nothing is listening on port 5000', 'error');
    log('   The backend server is NOT running!', 'error');
    log('\n   💡 To fix:', 'warning');
    log('      1. Open a new terminal', 'warning');
    log('      2. cd backend', 'warning');
    log('      3. npm start', 'warning');
  }

  // 2. Test direct backend connectivity
  log('\n=== Step 2: Testing Direct Backend Connectivity ===', 'info');
  const healthResult = await testHealthEndpoint();

  if (healthResult.success) {
    log('✅ Direct connection to backend works!', 'success');
    log(`   Response: ${healthResult.data}`, 'success');
  } else {
    log(`❌ Cannot connect to backend directly: ${healthResult.error}`, 'error');
    if (healthResult.error.includes('ECONNREFUSED')) {
      log('   The backend server is not accepting connections', 'error');
    }
  }

  // 3. Check frontend proxy
  log('\n=== Step 3: Testing Frontend Proxy ===', 'info');
  const proxyResult = await testProxyEndpoint();

  if (proxyResult.success) {
    log('✅ Proxy is working correctly!', 'success');
    log(`   Response: ${proxyResult.data}`, 'success');
  } else {
    log(`❌ Proxy connection failed: ${proxyResult.error || 'Unknown error'}`, 'error');
    if (proxyResult.error && proxyResult.error.includes('ECONNREFUSED')) {
      log('   The frontend development server may not be running', 'warning');
      log('\n   💡 To fix:', 'warning');
      log('      1. Start the frontend: cd frontend && npm start', 'warning');
    }
  }

  // 4. Check environment
  await checkEnvironmentVariables();

  // 5. Summary
  log('\n╔════════════════════════════════════════════════════════════╗', 'cyan');
  log('║                      DIAGNOSIS SUMMARY                     ║', 'cyan');
  log('╚════════════════════════════════════════════════════════════╝', 'cyan');

  if (!isPortListening) {
    log('\n🔴 CRITICAL: Backend server is not running!', 'error');
    log('\nQuick Start Commands:', 'info');
    log('---------------------', 'info');
    log('Terminal 1 (Backend):', 'info');
    log('  cd backend', 'info');
    log('  npm install  # if not already done', 'info');
    log('  npm start', 'info');
    log('\nTerminal 2 (Frontend):', 'info');
    log('  cd frontend', 'info');
    log('  npm install  # if not already done', 'info');
    log('  npm start', 'info');
  } else if (!healthResult.success) {
    log('\n🟡 Backend is running but not responding correctly', 'warning');
    log('Check the backend console for errors', 'warning');
  } else if (!proxyResult.success) {
    log('\n🟡 Backend works but proxy connection fails', 'warning');
    log('Check that frontend dev server is running on port 3000', 'warning');
  } else {
    log('\n🟢 All systems operational!', 'success');
    log('Both backend and proxy are working correctly', 'success');
  }

  log('\n');
}

// Run diagnostics
runDiagnostics().catch((err) => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
