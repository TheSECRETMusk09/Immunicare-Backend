/**
 * Migration File Renamer Script
 *
 * Renames migration files by removing dates, numbers, or version prefixes
 * and converting them to descriptive snake_case names.
 *
 * Usage: node rename_migrations.js [directory] [--dry-run]
 *
 * Examples:
 *   node rename_migrations.js                    # Rename files in default migrations folder
 *   node rename_migrations.js backend/migrations  # Specify custom directory
 *   node rename_migrations.js . --dry-run          # Preview changes without renaming
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DEFAULT_MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SUPPORTED_EXTENSIONS = ['.sql', '.js'];

// Pattern to match common migration filename prefixes
const PREFIX_PATTERNS = [
  // Date patterns: 20240211000000_, 2026-02-20_, etc.
  /^(?:(?:\d{4}[-_]?\d{2}[-_]?\d{2})(?:[_-]?\d{6})?[-_]?)/,
  // Numeric prefixes: 001_, 003_, 001_, etc.
  /^(?:\d{3}[_-])/,
  // Version patterns: v1_, v2_, version_1_, etc.
  /^(?:v\d+[-_]?|version[-_]?\d+[-_]?)/,
  // Timestamp patterns: 1700000000_, timestamp_
  /^(?:\d{10}[_-]?|timestamp[-_]?)/,
  // Migration keyword with separators: migration_, migration-001_
  /^(?:migration[-_]?\d*[-_]?)/i,
  // Feature migration patterns: feature_migration_, feature-
  /^(?:feature[-_]?migration[-_]?\d*[-_]?)/i
];

// Keywords to prioritize from filename
const PRIORITY_KEYWORDS = [
  'vaccine',
  'vaccination',
  'patient',
  'infant',
  'guardian',
  'user',
  'admin',
  'appointment',
  'clinic',
  'health',
  'worker',
  'password',
  'auth',
  'session',
  'token',
  'security',
  'audit',
  'log',
  'notification',
  'sms',
  'reminder',
  'allergy',
  'waitlist',
  'alert',
  'inventory',
  'stock',
  'distribution',
  'medicine',
  'drug',
  'settings',
  'config',
  'cache',
  'migration',
  'schema',
  'message',
  'conversation',
  'digital',
  'paper',
  'document',
  'location',
  'photo',
  'role',
  'permission',
  'email',
  'verification',
  'reset',
  'encryption'
];

/**
 * Analyze the migration file content to determine its purpose
 */
function analyzeMigrationContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let content = '';

  try {
    if (ext === '.sql') {
      content = fs.readFileSync(filePath, 'utf8').toLowerCase();
    } else if (ext === '.js') {
      const jsContent = fs.readFileSync(filePath, 'utf8').toLowerCase();
      content = jsContent;
    }
  } catch (err) {
    console.warn(`  Warning: Could not read file content: ${err.message}`);
  }

  // Extract key actions and entities from content
  const actions = [];
  const entities = [];

  // SQL-specific analysis
  if (ext === '.sql') {
    // Detect CREATE statements and table names
    const tableMatches = content.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?/g
    );
    for (const match of tableMatches) {
      actions.push('create');
      entities.push(match[1].replace(/["']/g, ''));
    }

    if (content.includes('create index')) {
      actions.push('create_index');
    }
    if (content.includes('create function')) {
      actions.push('create_function');
    }
    if (content.includes('create trigger')) {
      actions.push('create_trigger');
    }
    if (content.includes('create sequence')) {
      actions.push('create_sequence');
    }
    if (content.includes('create type')) {
      actions.push('create_type');
    }
    if (content.includes('create extension')) {
      actions.push('create_extension');
    }
    if (content.includes('alter table')) {
      actions.push('alter');
    }
    if (content.includes('add column')) {
      actions.push('add_column');
    }

    // Detect specific features
    if (content.includes('password')) {
      actions.push('password');
      if (content.includes('reset')) {
        entities.push('password_reset');
      } else if (content.includes('force')) {
        entities.push('force_password');
      } else if (content.includes('encrypt')) {
        entities.push('password_encryption');
      }
    }
    if (content.includes('encryption') || content.includes('encrypt')) {
      entities.push('encryption');
    }
    if (content.includes('session')) {
      entities.push('session');
    }
    if (content.includes('token')) {
      entities.push('token');
      if (content.includes('email') && content.includes('verification')) {
        entities.push('email_verification');
      }
      if (content.includes('password') && content.includes('reset')) {
        entities.push('password_reset');
      }
    }
    if (content.includes('security')) {
      entities.push('security');
    }
    if (content.includes('audit')) {
      entities.push('audit');
    }
    if (
      content.includes('notification') ||
      content.includes('sms') ||
      content.includes('reminder')
    ) {
      entities.push('notification');
      if (content.includes('reminder')) {
        entities.push('reminder');
      }
    }
    if (content.includes('vaccine')) {
      entities.push('vaccine');
    }
    if (content.includes('infant') || content.includes('patient')) {
      entities.push('patient');
    }
    if (content.includes('guardian')) {
      entities.push('guardian');
    }
    if (content.includes('appointment')) {
      entities.push('appointment');
    }
    if (content.includes('allergy')) {
      entities.push('allergy');
    }
    if (content.includes('waitlist')) {
      entities.push('waitlist');
    }
    if (content.includes('alert')) {
      entities.push('alert');
    }
    if (content.includes('confirmation')) {
      entities.push('confirmation');
    }
    if (content.includes('cache')) {
      entities.push('cache');
    }
    if (content.includes('settings') || content.includes('config')) {
      entities.push('settings');
    }
    if (content.includes('message') || content.includes('conversation')) {
      entities.push('messaging');
    }
    if (content.includes('digital') && content.includes('paper')) {
      entities.push('digital_papers');
    }
    if (content.includes('inventory') || content.includes('stock')) {
      entities.push('inventory');
    }
    if (content.includes('distribution')) {
      entities.push('distribution');
    }
    if (content.includes('medicine')) {
      entities.push('medicine');
    }
    if (content.includes('clinic') || (content.includes('health') && content.includes('worker'))) {
      entities.push('healthcare');
    }
    if (content.includes('photo')) {
      entities.push('photo');
    }
    if (content.includes('location')) {
      entities.push('location');
    }
    if (content.includes('role')) {
      entities.push('role');
    }
    if (content.includes('permission')) {
      entities.push('permission');
    }
    if (content.includes('control_number') || content.includes('patient_control')) {
      entities.push('patient_control');
    }
  }

  // JS-specific analysis
  if (ext === '.js') {
    if (content.includes('migration')) {
      actions.push('migration');
    }
    if (content.includes('password')) {
      entities.push('password');
    }
    if (content.includes('auth')) {
      entities.push('auth');
    }
    if (content.includes('guardian')) {
      entities.push('guardian');
    }
    if (content.includes('admin')) {
      entities.push('admin');
    }
    if (content.includes('force')) {
      entities.push('force_password');
    }
    if (content.includes('location')) {
      entities.push('location');
    }
    if (content.includes('notification')) {
      entities.push('notification');
    }
  }

  return { actions, entities };
}

/**
 * Clean a filename by removing prefixes
 */
function removePrefixes(filename) {
  let cleaned = filename;

  // Remove each prefix pattern
  for (const pattern of PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Also handle underscores and hyphens at the start
  cleaned = cleaned.replace(/^[-_]+/, '');

  return cleaned;
}

/**
 * Convert filename to snake_case
 */
function toSnakeCase(str) {
  let result = str;

  // Replace common separators with underscores
  result = result.replace(/[-]+/g, '_');
  result = result.replace(/\s+/g, '_');

  // Handle camelCase or PascalCase
  result = result.replace(/([a-z])([A-Z])/g, '$1_$2');

  // Handle consecutive uppercase letters followed by lowercase
  result = result.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2');

  // Replace any non-alphanumeric characters (except underscores) with underscores
  result = result.replace(/[^a-zA-Z0-9_]/g, '_');

  // Replace multiple consecutive underscores with single underscore
  result = result.replace(/_+/g, '_');

  // Remove leading/trailing underscores
  result = result.replace(/^_+/, '');
  result = result.replace(/_+$/, '');

  // Convert to lowercase
  result = result.toLowerCase();

  return result;
}

/**
 * Extract priority keywords from filename
 */
function extractKeywordsFromFilename(filename) {
  const lower = filename.toLowerCase();
  const keywords = [];

  for (const kw of PRIORITY_KEYWORDS) {
    if (lower.includes(kw)) {
      keywords.push(kw);
    }
  }

  return keywords;
}

/**
 * Generate a descriptive name for the migration file
 */
function generateDescriptiveName(originalName, filePath) {
  // Get filename without extension and remove prefixes
  let nameWithoutExt = path.basename(originalName, path.extname(originalName));
  const originalCleaned = removePrefixes(nameWithoutExt);
  nameWithoutExt = toSnakeCase(originalCleaned);

  // Extract keywords from original filename
  const filenameKeywords = extractKeywordsFromFilename(originalCleaned);

  // Analyze the content
  const { actions, entities } = analyzeMigrationContent(filePath);

  // Combine all discovered keywords
  const allKeywords = [
    ...new Set([
      ...filenameKeywords,
      ...entities.filter(
        (e) => !['table', 'column', 'index', 'trigger', 'function', 'type'].includes(e)
      )
    ])
  ];

  let cleanedName;

  // If we have keywords from content or filename, use them
  if (allKeywords.length > 0) {
    // Get primary action
    let primaryAction = 'add';
    if (actions.includes('create') || actions.includes('create_table')) {
      primaryAction = 'create';
    } else if (actions.includes('alter')) {
      primaryAction = 'alter';
    } else if (actions.includes('drop')) {
      primaryAction = 'drop';
    } else if (actions.includes('enable')) {
      primaryAction = 'enable';
    } else if (actions.includes('disable')) {
      primaryAction = 'disable';
    } else if (actions.includes('fix')) {
      primaryAction = 'fix';
    } else if (actions.includes('add_column')) {
      primaryAction = 'add_column';
    } else if (actions.includes('password') && actions.includes('force_password_change')) {
      primaryAction = 'force_password';
    }

    // Build name with action + most relevant keywords (max 2)
    const relevantKeywords = allKeywords.slice(0, 2);
    cleanedName = `${primaryAction}_${relevantKeywords.join('_')}`;
  } else {
    // Fall back to cleaned filename
    cleanedName = nameWithoutExt;
  }

  // Clean up the name - remove duplicates and common suffixes
  cleanedName = cleanedName
    .replace(/_table$/, '')
    .replace(/_tables$/, '')
    .replace(/_if$/, '')
    .replace(/_exists$/, '')
    .replace(/_id$/, '')
    .replace(/_new$/, '')
    .replace(/_and_/, '_')
    .replace(/_or_/, '_');

  // Remove duplicate words (e.g., "security_security" -> "security")
  const parts = cleanedName.split('_');
  const uniqueParts = [];
  let lastPart = '';
  for (const part of parts) {
    if (part !== lastPart) {
      uniqueParts.push(part);
      lastPart = part;
    }
  }
  cleanedName = uniqueParts.join('_');

  // Final cleanup
  cleanedName = cleanedName.replace(/_+/g, '_');
  cleanedName = cleanedName.replace(/^_+/, '');
  cleanedName = cleanedName.replace(/_+$/, '');

  return cleanedName || 'unnamed_migration';
}

/**
 * Check if a file is a migration file
 */
function isMigrationFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Process a single migration file
 */
function processMigrationFile(filePath, dryRun = false, existingNames = new Set()) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename);
  const dir = path.dirname(filePath);

  if (!isMigrationFile(filename)) {
    return null;
  }

  // Generate new filename
  let newBaseName = generateDescriptiveName(filename, filePath);
  let newFilename = `${newBaseName}${ext}`;
  let newFilePath = path.join(dir, newFilename);

  // Handle conflicts with existing files (including files renamed in this run)
  if (existingNames.has(newFilename.toLowerCase()) || (!dryRun && fs.existsSync(newFilePath))) {
    // Add a distinguishing suffix based on the original name
    const suffix = filename.replace(ext, '').slice(-8);
    newBaseName = `${newBaseName}_${suffix}`;
    newFilename = `${newBaseName}${ext}`;
    newFilePath = path.join(dir, newFilename);

    // If still conflicts, use a counter
    let counter = 1;
    while (
      existingNames.has(newFilename.toLowerCase()) ||
      (!dryRun && fs.existsSync(newFilePath))
    ) {
      newBaseName = `${generateDescriptiveName(filename, filePath)}_${counter}`;
      newFilename = `${newBaseName}${ext}`;
      newFilePath = path.join(dir, newFilename);
      counter++;
    }
  }

  // Skip if names are the same
  if (newFilename === filename) {
    return { skipped: true, oldName: filename, newName: filename };
  }

  // Rename the file
  if (!dryRun) {
    fs.renameSync(filePath, newFilePath);
  }

  return { renamed: true, oldName: filename, newName: newFilename };
}

/**
 * Recursively process all migration files in a directory
 */
function processDirectory(dirPath, dryRun = false) {
  const results = [];

  if (!fs.existsSync(dirPath)) {
    console.error(`Error: Directory not found: ${dirPath}`);
    return results;
  }

  // First pass: collect all existing filenames (for conflict detection)
  const existingNames = new Set();
  function collectExistingFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectExistingFiles(fullPath);
      } else if (entry.isFile()) {
        existingNames.add(entry.name.toLowerCase());
      }
    }
  }
  collectExistingFiles(dirPath);

  // Second pass: process files
  function processDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        processDir(fullPath);
      } else if (entry.isFile()) {
        const result = processMigrationFile(fullPath, dryRun, existingNames);
        if (result) {
          results.push(result);
          if (result.renamed) {
            existingNames.add(result.newName.toLowerCase());
          }
        }
      }
    }
  }

  processDir(dirPath);
  return results;
}

/**
 * Print results in a formatted table
 */
function printResults(results) {
  console.log('\n' + '='.repeat(80));
  console.log('MIGRATION FILE RENAMING RESULTS');
  console.log('='.repeat(80));

  if (results.length === 0) {
    console.log('\nNo migration files found to rename.');
    return;
  }

  const renamed = results.filter((r) => r.renamed);
  const skipped = results.filter((r) => r.skipped);

  console.log(`\nTotal files processed: ${results.length}`);
  console.log(`Files renamed: ${renamed.length}`);
  console.log(`Files skipped (already descriptive): ${skipped.length}`);

  if (renamed.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('RENAMED FILES:');
    console.log('-'.repeat(80));

    // Find max lengths for formatting
    const maxOldName = Math.max(...renamed.map((r) => r.oldName.length), 40);
    const maxNewName = Math.max(...renamed.map((r) => r.newName.length), 40);

    for (const r of renamed) {
      const oldName = r.oldName.padEnd(Math.min(maxOldName, 50)).substring(0, 50);
      const newName = r.newName.padEnd(Math.min(maxNewName, 50)).substring(0, 50);
      console.log(`  ${oldName}  →  ${newName}`);
    }
  }

  if (skipped.length > 0) {
    console.log('\n' + '-'.repeat(80));
    console.log('SKIPPED FILES (already have descriptive names):');
    console.log('-'.repeat(80));
    for (const r of skipped) {
      console.log(`  ${r.oldName}`);
    }
  }

  console.log('\n' + '='.repeat(80));
}

/**
 * Main function
 */
function main() {
  // Get command line arguments
  const args = process.argv.slice(2);

  let dirPath = DEFAULT_MIGRATIONS_DIR;
  let dryRun = false;

  // Parse arguments
  for (const arg of args) {
    if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
    } else if (!arg.startsWith('--')) {
      // Assume it's a directory path
      dirPath = path.resolve(arg);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('MIGRATION FILE RENAMER');
  console.log('='.repeat(80));
  console.log(`\nTarget directory: ${dirPath}`);
  console.log(
    `Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (files will be renamed)'}`
  );

  // Process files
  const results = processDirectory(dirPath, dryRun);

  // Print results
  printResults(results);

  // Save log to file
  if (results.length > 0) {
    const logFile = path.join(dirPath, 'migration_rename_log.txt');
    const timestamp = new Date().toISOString();

    let logContent = `Migration Rename Log - ${timestamp}\n`;
    logContent += '='.repeat(80) + '\n';
    logContent += `Directory: ${dirPath}\n`;
    logContent += `Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n\n`;
    logContent += 'OLD NAME → NEW NAME\n';
    logContent += '-'.repeat(80) + '\n';

    for (const r of results) {
      if (r.renamed) {
        logContent += `${r.oldName} → ${r.newName}\n`;
      } else if (r.skipped) {
        logContent += `${r.oldName} → (skipped - already descriptive)\n`;
      }
    }

    if (!dryRun) {
      fs.writeFileSync(logFile, logContent, 'utf8');
      console.log(`\nLog saved to: ${logFile}`);
    } else {
      console.log('\nLog preview (dry-run - not saved):');
      console.log(logContent);
    }
  }

  // Exit with appropriate code
  process.exit(0);
}

// Run the script
main();
