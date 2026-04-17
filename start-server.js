#!/usr/bin/env node
/**
 * Immunicare Server Startup Script
 * Starts the backend server with proper configuration checks
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, type = 'info') {
  const prefix = {
    info: `${colors.cyan}[INFO]${colors.reset}`,
    success: `${colors.green}[SUCCESS]${colors.reset}`,
    warning: `${colors.yellow}[WARNING]${colors.reset}`,
    error: `${colors.red}[ERROR]${colors.reset}`
  };
  console.log(`${prefix[type]} ${message}`);
}

function checkPrerequisites() {
  log('Checking prerequisites...');
  const issues = [];

  // Check if .env file exists
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    issues.push('.env file not found. Please create one based on .env.example');
  }

  // Check Node.js version
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
  if (majorVersion < 16) {
    issues.push(`Node.js version ${nodeVersion} is too old. Please use Node.js 16 or higher`);
  }

  return issues;
}

function startServer() {
  console.log('\n' + '='.repeat(60));
  console.log(`${colors.bold}Immunicare Server Startup${colors.reset}`);
  console.log('='.repeat(60) + '\n');

  // Check prerequisites
  const issues = checkPrerequisites();
  if (issues.length > 0) {
    issues.forEach((issue) => log(issue, 'warning'));
    console.log('');
  }

  // Check if dependencies are installed
  const nodeModulesPath = path.join(__dirname, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    log('Installing dependencies...', 'warning');
    const npm = spawn('npm', ['install'], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    npm.on('close', (code) => {
      if (code === 0) {
        log('Dependencies installed successfully', 'success');
        startServer();
      } else {
        log('Failed to install dependencies', 'error');
        process.exit(1);
      }
    });
    return;
  }

  // Display configuration info
  log('Server Configuration:', 'info');
  console.log(`  Port: ${process.env.PORT || 5000}`);
  console.log(
    `  Database: ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'immunicare_dev'}`
  );
  console.log(`  JWT Access Expiration: ${process.env.JWT_ACCESS_EXPIRATION || '8h'}`);
  console.log(`  JWT Refresh Expiration: ${process.env.JWT_REFRESH_EXPIRATION || '7d'}`);
  console.log(
    `  Cache: ${process.env.CACHE_DISABLED === 'true' ? 'Disabled (Memory fallback)' : 'Enabled'}`
  );
  console.log(
    `  Redis: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`
  );
  console.log('');

  // Start the server
  log('Starting server...', 'info');

  const server = spawn('node', ['start.js', 'development'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development' }
  });

  // Handle server output
  server.stdout.on('data', (data) => {
    process.stdout.write(data.toString());
  });

  server.stderr.on('data', (data) => {
    process.stderr.write(data.toString());
  });

  server.on('close', (code) => {
    if (code !== 0) {
      log(`Server process exited with code ${code}`, 'error');
    }
  });

  server.on('error', (error) => {
    log(`Failed to start server: ${error.message}`, 'error');
  });

  // Handle graceful shutdown
  const shutdown = (signal) => {
    log(`Received ${signal}. Shutting down gracefully...`, 'warning');
    server.kill('SIGTERM');
    setTimeout(() => {
      log('Server shutdown complete', 'success');
      process.exit(0);
    }, 1000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Run the startup script
startServer();
