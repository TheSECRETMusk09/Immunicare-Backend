#!/usr/bin/env node

/**
 * Fix dashboard.js routing order
 * The /guardian/:guardianId/* routes must come before /guardians route
 */

const fs = require('fs');
const path = require('path');

const dashboardPath = path.join(__dirname, 'routes', 'dashboard.js');

console.log('Fixing dashboard.js routing order...');

let content = fs.readFileSync(dashboardPath, 'utf8');

// Extract the guardian routes section
const guardianRoutesMatch = content.match(
  /\/\/ ============================================\s*\/\/ GUARDIAN DASHBOARD ENDPOINTS\s*\/\/ ============================================[\s\S]*?(?=\n\/\/ Guardian vaccination records by infant)/
);

if (!guardianRoutesMatch) {
  console.error('Could not find guardian routes section');
  process.exit(1);
}

const guardianRoutes = guardianRoutesMatch[0];

// Remove the guardian routes from their current position
content = content.replace(guardianRoutes, '');

// Find the position after /appointments route and before /guardians route
const insertPosition = content.indexOf('// Dashboard guardians (protected)');

if (insertPosition === -1) {
  console.error('Could not find insertion point');
  process.exit(1);
}

// Insert guardian routes before /guardians
content =
  content.slice(0, insertPosition) + '\n' + guardianRoutes + '\n' + content.slice(insertPosition);

fs.writeFileSync(dashboardPath, content, 'utf8');

console.log('✓ Fixed dashboard.js routing order');
console.log('  Guardian routes now come before /guardians route');
