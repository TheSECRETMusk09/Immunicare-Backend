#!/usr/bin/env node
/**
 * VPS Deployment Script for Immunicare Backend
 *
 * This script helps deploy the backend to a VPS (Namecheap, DigitalOcean, Linode, etc.)
 * Using PostgreSQL on Namecheap VPS
 *
 * Usage:
 *   1. Configure your database credentials in backend/.env.production
 *   2. Run: node deploy-vps.js
 *
 * Prerequisites:
 *   - VPS server with Node.js installed
 *   - PostgreSQL database (local or remote like Namecheap VPS)
 *   - PM2 for process management (recommended)
 *   - Nginx for reverse proxy (recommended)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

const log = {
  info: (msg) => console.log(`${GREEN}[INFO]${RESET} ${msg}`),
  warn: (msg) => console.log(`${YELLOW}[WARN]${RESET} ${msg}`),
  error: (msg) => console.log(`${RED}[ERROR]${RESET} ${msg}`),
  step: (msg) => console.log(`\n${BLUE}==>${RESET} ${msg}`),
  cmd: (msg) => console.log(`$ ${msg}`),
};

function checkPrerequisites() {
  log.step('Checking prerequisites...');

  // Check Node.js version
  const nodeVersion = process.version;
  log.info(`Node.js version: ${nodeVersion}`);

  // Check if .env.production exists
  const envPath = path.join(__dirname, '.env.production');
  if (!fs.existsSync(envPath)) {
    log.error('Missing backend/.env.production file!');
    log.info('Please create it with your database credentials.');
    process.exit(1);
  }

  // Check if database credentials are set
  const envContent = fs.readFileSync(envPath, 'utf8');
  const requiredVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missingVars = requiredVars.filter(v => !envContent.includes(`${v}=`));

  if (missingVars.length > 0) {
    log.warn(`Missing database configuration for: ${missingVars.join(', ')}`);
    log.info('Please edit backend/.env.production and configure your database credentials.');
    process.exit(1);
  }

  // Check if JWT secrets are set (not the default placeholder)
  if (envContent.includes('JWT_SECRET=PH9qfVhBQWnx')) {
    log.warn('JWT_SECRET is using the default placeholder!');
    log.info('Consider generating a new secure secret for production.');
  }

  log.info('Prerequisites check passed!');
}

function installDependencies() {
  log.step('Installing production dependencies...');

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
    execSync('npm run migrate:prod', {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
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
      env: { ...process.env, NODE_ENV: 'production' },
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
      env: { ...process.env, NODE_ENV: 'production' },
    });
    log.info('Database connection test passed!');
  } catch (error) {
    log.error('Database connection test failed!');
    process.exit(1);
  }
}

function showDeploymentInstructions() {
  log.step('VPS Deployment Instructions\n');

  console.log(`
${GREEN}Option 1: Deploy to VPS with PM2 (Recommended)${RESET}
----------------------------------------------
1. Upload code to your VPS:
   - Via Git: git clone your-repo
   - Or: Upload via FTP/SSH

2. SSH into your VPS and run:
${YELLOW}   cd /path/to/backend
   npm install --production
   NODE_ENV=production node quick_admin_setup.js${RESET}

3. Start with PM2 (process manager):
${YELLOW}   npm install -g pm2
   pm2 start server.js --name immunicare
   pm2 save
   pm2 startup${RESET}

4. Set up Nginx as reverse proxy (recommended):
${YELLOW}   sudo apt install nginx
   sudo nano /etc/nginx/sites-available/immunicare${RESET}

   Add this configuration:
${BLUE}   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:5000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }${RESET}

5. Enable and restart Nginx:
${YELLOW}   sudo ln -s /etc/nginx/sites-available/immunicare /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx${RESET}

6. Set up SSL with Let's Encrypt (optional but recommended):
${YELLOW}   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com${RESET}


${GREEN}Option 2: Deploy with Systemd${RESET}
-------------------------------------
1. Create service file:
${YELLOW}   sudo nano /etc/systemd/system/immunicare.service${RESET}

2. Add this content:
${BLUE}   [Unit]
   Description=Immunicare API Server
   After=network.target postgresql.service

   [Service]
   Type=simple
   User=www-data
   WorkingDirectory=/path/to/backend
   Environment=NODE_ENV=production
   ExecStart=/usr/bin/node server.js
   Restart=always
   RestartSec=10

   [Install]
   WantedBy=multi-user.target${RESET}

3. Enable and start:
${YELLOW}   sudo systemctl daemon-reload
   sudo systemctl enable immunicare
   sudo systemctl start immunicare${RESET}


${GREEN}Database Configuration (Namecheap VPS)${RESET}
--------------------------------------
Your backend/.env.production already has Namecheap database config:

${BLUE}   DB_HOST=203.161.48.137
   DB_PORT=5432
   DB_NAME=immunicare_prod
   DB_USER=immunicare_user
   DB_PASSWORD=******
   DB_SSL=true${RESET}

If using local PostgreSQL on the same VPS, change:
${YELLOW}   DB_HOST=localhost
   DB_SSL=false${RESET}


${GREEN}Testing Your Deployment${RESET}
-----------------------------
After deployment, test these endpoints:
- Health: https://your-domain.com/api/health
- Admin Login: POST https://your-domain.com/api/auth/login

Admin credentials:
- Username: admin
- Password: Admin2026!


${GREEN}Useful PM2 Commands${RESET}
-------------------------
${YELLOW}   pm2 status              # Check status
   pm2 logs immunicare     # View logs
   pm2 restart immunicare # Restart
   pm2 monit              # Monitor${RESET}
`);
}

function main() {
  console.log(`
${GREEN}╔════════════════════════════════════════════════════════════╗
║     Immunicare Backend - VPS Deployment Script         ║
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
