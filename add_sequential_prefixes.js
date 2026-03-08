/**
 * Add Sequential Prefixes to Migration Files
 *
 * Adds numbered prefixes (001_, 002_, etc.) to migration files
 * while preserving their descriptive snake_case names.
 *
 * Usage: node add_sequential_prefixes.js [directory]
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function main() {
  const args = process.argv.slice(2);
  const dirPath = args[0] ? path.resolve(args[0]) : DEFAULT_MIGRATIONS_DIR;

  if (!fs.existsSync(dirPath)) {
    console.error(`Error: Directory not found: ${dirPath}`);
    process.exit(1);
  }

  // Get all migration files
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .filter((e) => {
      const ext = path.extname(e.name).toLowerCase();
      return ext === '.sql' || ext === '.js';
    })
    .map((e) => e.name)
    .sort(); // Sort alphabetically for consistent ordering

  console.log('\n' + '='.repeat(60));
  console.log('ADDING SEQUENTIAL PREFIXES TO MIGRATION FILES');
  console.log('='.repeat(60));
  console.log(`\nDirectory: ${dirPath}`);
  console.log(`Files found: ${files.length}`);

  // Rename each file with sequential prefix
  const renamed = [];
  for (let i = 0; i < files.length; i++) {
    const oldName = files[i];
    const ext = path.extname(oldName);
    const baseName = path.basename(oldName, ext);

    // Create new name with sequential prefix (3-digit padding)
    const newName = `${String(i + 1).padStart(3, '0')}_${baseName}${ext}`;

    if (oldName !== newName) {
      const oldPath = path.join(dirPath, oldName);
      const newPath = path.join(dirPath, newName);

      fs.renameSync(oldPath, newPath);
      renamed.push({ old: oldName, new: newName });
      console.log(`  ${oldName}  →  ${newName}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Total files renamed: ${renamed.length}`);
  console.log('='.repeat(60));

  // Save log
  const logFile = path.join(dirPath, 'sequential_rename_log.txt');
  let logContent = `Sequential Rename Log - ${new Date().toISOString()}\n`;
  logContent += '='.repeat(60) + '\n';
  for (const r of renamed) {
    logContent += `${r.old} → ${r.new}\n`;
  }
  fs.writeFileSync(logFile, logContent, 'utf8');
  console.log(`\nLog saved to: ${logFile}`);
}

main();
