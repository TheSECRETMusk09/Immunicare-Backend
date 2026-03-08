/**
 * fix_line_endings.js
 * Script to convert CRLF line endings to LF in JavaScript files
 *
 * This script helps fix ESLint linebreak-style errors on Windows by converting
 * all JavaScript files in the backend directory from CRLF to LF line endings.
 *
 * Usage: node fix_line_endings.js
 */

const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.join(__dirname);

/**
 * Recursively get all JavaScript files in a directory
 * @param {string} dir - Directory to search
 * @param {string[]} files - Array to store found files
 */
function getJavaScriptFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip node_modules and other excluded directories
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'build', 'load-tests'].includes(entry.name)) {
        getJavaScriptFiles(fullPath, files);
      }
    } else if (entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Convert CRLF to LF in file content
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if file was modified
 */
function convertFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');

    // Check if file has CRLF line endings
    if (content.includes('\r\n')) {
      const convertedContent = content.replace(/\r\n/g, '\n');
      fs.writeFileSync(filePath, convertedContent, 'utf8');
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
    return false;
  }
}

/**
 * Main function
 */
function main() {
  console.log('=== Line Ending Conversion Script ===\n');
  console.log('Converting CRLF to LF in JavaScript files...\n');

  const files = getJavaScriptFiles(BACKEND_DIR);
  let modifiedCount = 0;
  let errorCount = 0;

  console.log(`Found ${files.length} JavaScript files\n`);

  for (const file of files) {
    try {
      const relativePath = path.relative(BACKEND_DIR, file);
      const wasModified = convertFile(file);

      if (wasModified) {
        console.log(`  ✅ Converted: ${relativePath}`);
        modifiedCount++;
      }
    } catch (error) {
      console.error(`  ❌ Error: ${file} - ${error.message}`);
      errorCount++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Files processed: ${files.length}`);
  console.log(`Files converted: ${modifiedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (modifiedCount > 0) {
    console.log('\n✅ Line ending conversion complete!');
    console.log('Run ESLint again to verify: npm run lint');
  } else if (errorCount === 0) {
    console.log('\nℹ️  No files needed conversion (all already use LF)');
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  getJavaScriptFiles,
  convertFile,
};
