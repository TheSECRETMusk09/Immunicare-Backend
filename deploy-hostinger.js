#!/usr/bin/env node
/**
 * Hostinger Deployment Script for Immunicare Backend
 *
 * This script helps deploy the backend to Hostinger
 *
 * Usage:
 *   1. Configure your Hostinger database credentials in backend/.env.hostinger
 *   2. Run: node deploy-hostinger.js
 *
 * Prerequisites:
 *   - Hostinger account with Node.js application
 *   - PostgreSQL database created in Hostinger hPanel
 *   - Git repository with your code
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

const log = {
  info: (msg) => console.log(`${GREEN}[INFO]${RESET} ${msg}`),
  warn: (msg) => console.log(`${YELLOW}[WARN]${RESET} ${msg}`),
  error: (msg) => console.log(`${RED}[ERROR]${RESET} ${msg}`),
  step: (msg) => console.log(`\n${GREEN}==>${RESET} ${msg}`),
};

function checkPrerequisites() {
  log.step('Checking prerequisites...');

  // Check Node.js version
  const nodeVersion = process.version;
  log.info(`Node.js version: ${nodeVersion}`);

  // Check if .env.hostinger exists
  const envPath = path.join(__dirname, '.env.hostinger');
  if (!fs.existsSync(envPath)) {
    log.error('Missing backend/.env.hostinger file!');
    log.info('Please create it with your Hostinger database credentials.');
    process.exit(1);
  }

  // Check if database credentials are set
  const envContent = fs.readFileSync(envPath, 'utf8');
  const databaseUrlMatch = envContent.match(/^DATABASE_URL=(.*)$/m);
  const databaseUrlValue = databaseUrlMatch ? databaseUrlMatch[1].trim() : '';
  const hasDatabaseUrl =
    databaseUrlValue.length > 0 &&
    !databaseUrlValue.startsWith('your_') &&
    databaseUrlValue !== 'postgres://username:password@host:5432/database';

  const readEnvValue = (name) => {
    const match = envContent.match(new RegExp(`^${name}=(.*)$`, 'm'));
    return match ? match[1].trim() : '';
  };

  const requiredVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missingVars = hasDatabaseUrl
    ? []
    : requiredVars.filter(
      (v) => {
        const value = readEnvValue(v);
        return !value || value.startsWith('your_');
      },
    );

  if (missingVars.length > 0) {
    log.warn(`Missing or placeholder database configuration for: ${missingVars.join(', ')}`);
    log.info('Please edit backend/.env.hostinger and configure your database credentials.');
    process.exit(1);
  }

  log.info('Prerequisites check passed!');
}

function installDependencies() {
  log.step('Installing dependencies...');

  try {
    execSync('npm install --production', {
      cwd: __dirname,
      stdio: 'inherit',
    });
    log.info('Dependencies installed successfully!');
  } catch (error) {
    log.error('Failed to install dependencies');
    process.exit(1);
  }
}

function runMigrations() {
  log.step('Running database migrations...');

  try {
    // Set environment to hostinger
    process.env.NODE_ENV = 'hostinger';

    // Run migrations
    execSync('npm run migrate:hostinger', {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'hostinger' },
    });
    log.info('Database migrations completed!');
  } catch (error) {
    log.warn('Migration may have failed or already applied. Continuing...');
  }
}

function setupAdmin() {
  log.step('Setting up admin user...');

  try {
    execSync('node quick_admin_setup.js', {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'hostinger' },
    });
    log.info('Admin user setup completed!');
  } catch (error) {
    log.warn('Admin setup may have failed. This is okay if admin already exists.');
  }
}

function testConnection() {
  log.step('Testing database connection...');

  try {
    execSync('node -e "require(\"./db\").healthCheck().then(r => { console.log(r.healthy ? \"Database connected!\" : \"Connection failed: \" + r.error); process.exit(r.healthy ? 0 : 1); })"', {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'hostinger' },
    });
    log.info('Database connection test passed!');
  } catch (error) {
    log.error('Database connection test failed!');
    process.exit(1);
  }
}

function showDeploymentInstructions() {
  log.step('Deployment instructions for Hostinger:\n');

  console.log(`
${GREEN}Option 1: Git Deployment (Recommended)${RESET}
-----------------------------------------
1. Push your code to a Git repository (GitHub, GitLab, Bitbucket)
2. In Hostinger hPanel:
   - Go to Git > Connect Repository
   - Authorize your Git provider
   - Select your repository and branch
   - Set the "Deployment branch" to main/master

3. After connecting:
   - Hostinger will automatically deploy on push
   - Build command: npm install --production
   - Application root: /backend
   - Application start: node start.js hostinger

${GREEN}Option 2: File Upload via FTP${RESET}
----------------------------------
1. Get FTP credentials from Hostinger hPanel > Files > FTP
2. Upload the backend folder contents to /backend
3. Connect via SSH and run:
   cd backend
   npm install --production
   npm run migrate:hostinger
   node quick_admin_setup.js

${GREEN}Required Environment Variables in Hostinger${RESET}
-----------------------------------------
Set these in Hostinger hPanel > Node.js > Environment Variables:

NODE_ENV=hostinger
PORT=5000
SERVE_FRONTEND=false

Use either:

DATABASE_URL=postgres://user:password@host:5432/database

or the discrete variables:

DB_HOST=your_postgres_host
DB_PORT=5432
DB_NAME=your_database_name
DB_USER=your_database_user
DB_PASSWORD=your_database_password

If your provider requires TLS client certificates, set:
DB_SSL=true
DB_SSL_CA=<base64 encoded PEM>
DB_SSL_CERT=<base64 encoded PEM>
DB_SSL_KEY=<base64 encoded PEM>

${GREEN}Database Setup in Hostinger${RESET}
--------------------------------
1. Go to hPanel > Databases > PostgreSQL
2. Create a new database
3. Note the host, port, username, and password
4. Import your database schema:
   - Download schema.sql from backend/
   - Use phpPgAdmin or psql to import

${GREEN}Testing Your Deployment${RESET}
-----------------------------
After deployment, test these endpoints:
- Health: https://your-domain.com/api/health
- Admin Login: POST https://your-domain.com/api/auth/login
`);
}

function main() {
  console.log(`
${GREEN}╔════════════════════════════════════════════════════════════╗
║     Immunicare Backend - Hostinger Deployment Script      ║
╚════════════════════════════════════════════════════════════╝${RESET}
  `);

  // Check prerequisites
  checkPrerequisites();

  // Ask user what they want to do
  const args = process.argv.slice(2);

  if (args.includes('--full-deploy')) {
    // Full deployment workflow
    installDependencies();
    testConnection();
    runMigrations();
    setupAdmin();
  } else if (args.includes('--test-db')) {
    // Test database connection only
    testConnection();
  } else if (args.includes('--help')) {
    // Show help
    showDeploymentInstructions();
  } else {
    // Show deployment instructions
    showDeploymentInstructions();
  }

  log.info('\nDeployment preparation complete!');
}

main();
