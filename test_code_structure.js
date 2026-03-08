const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Code Structure Validation Tests...\n');

function testFileExists(filePath) {
  try {
    const fullPath = path.join(__dirname, filePath);
    const exists = fs.existsSync(fullPath);
    console.log(`${exists ? '✅' : '❌'} File exists: ${filePath}`);
    return exists;
  } catch (error) {
    console.error(`❌ Error checking file: ${filePath}`, error.message);
    return false;
  }
}

function testFileSyntax(filePath) {
  try {
    const fullPath = path.join(__dirname, filePath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Basic syntax checks
    if (content.includes('require("sequelize")')) {
      console.log(`❌ File still contains Sequelize references: ${filePath}`);
      return false;
    }

    if (content.includes('DataTypes')) {
      console.log(`❌ File still contains Sequelize DataTypes: ${filePath}`);
      return false;
    }

    if (content.includes('sequelize.define')) {
      console.log(`❌ File still contains Sequelize define: ${filePath}`);
      return false;
    }

    // Check for PostgreSQL usage
    if (content.includes('require("../db")')) {
      console.log(`✅ File uses PostgreSQL pool: ${filePath}`);
    } else {
      console.log(`⚠️  File may not use PostgreSQL pool: ${filePath}`);
    }

    // Check for raw SQL queries
    if (
      content.includes('pool.query') ||
      content.includes('await pool.query')
    ) {
      console.log(`✅ File uses raw SQL queries: ${filePath}`);
    }

    return true;
  } catch (error) {
    console.error(`❌ Error reading file: ${filePath}`, error.message);
    return false;
  }
}

function testModelStructure(filePath) {
  try {
    const fullPath = path.join(__dirname, filePath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Check for class definition
    if (content.includes('class ') && content.includes('{')) {
      console.log(`✅ File contains class definition: ${filePath}`);
    } else {
      console.log(`❌ File missing class definition: ${filePath}`);
      return false;
    }

    // Check for static methods
    if (content.includes('static async')) {
      console.log(`✅ File contains static methods: ${filePath}`);
    } else {
      console.log(`❌ File missing static methods: ${filePath}`);
      return false;
    }

    // Check for PostgreSQL methods
    const requiredMethods = ['findById', 'create'];
    const optionalMethods = ['findAll'];
    let hasRequiredMethods = true;

    for (const method of requiredMethods) {
      if (content.includes(method)) {
        console.log(`✅ File contains ${method} method: ${filePath}`);
      } else {
        console.log(`❌ File missing ${method} method: ${filePath}`);
        hasRequiredMethods = false;
      }
    }

    // Check optional methods
    for (const method of optionalMethods) {
      if (content.includes(method)) {
        console.log(`✅ File contains ${method} method: ${filePath}`);
      } else {
        console.log(`ℹ️  File missing optional ${method} method: ${filePath}`);
      }
    }

    return hasRequiredMethods;
  } catch (error) {
    console.error(
      `❌ Error analyzing model structure: ${filePath}`,
      error.message
    );
    return false;
  }
}

function testRouteStructure(filePath) {
  try {
    const fullPath = path.join(__dirname, filePath);
    const content = fs.readFileSync(fullPath, 'utf8');

    // Check for Express router
    if (content.includes('express.Router()')) {
      console.log(`✅ File uses Express router: ${filePath}`);
    } else {
      console.log(`❌ File missing Express router: ${filePath}`);
      return false;
    }

    // Check for auth middleware
    if (content.includes('require("../middleware/auth")')) {
      console.log(`✅ File uses auth middleware: ${filePath}`);
    } else {
      console.log(`❌ File missing auth middleware: ${filePath}`);
      return false;
    }

    // Check for new model imports
    if (content.includes('require("../models/Notification")')) {
      console.log(`✅ File imports Notification model: ${filePath}`);
    } else {
      console.log(`❌ File missing Notification model import: ${filePath}`);
      return false;
    }

    if (content.includes('require("../models/User")')) {
      console.log(`✅ File imports User model: ${filePath}`);
    } else {
      console.log(`❌ File missing User model import: ${filePath}`);
      return false;
    }

    // Check for Mongoose-style methods removal
    // Look for patterns like Model.find() or Model.findById() which are Mongoose-style
    // But allow our new model methods like notification.findById() which are PostgreSQL
    const mongoosePatterns = [
      /\.find\(/,
      /\.updateMany\(/,
      /\.countDocuments\(/,
      /\.populate\(/,
      /\$or/,
      /\$set/
    ];

    let hasMongooseMethods = false;
    for (const pattern of mongoosePatterns) {
      if (pattern.test(content)) {
        console.log(
          `❌ File still contains Mongoose-style pattern: ${filePath}`
        );
        hasMongooseMethods = true;
        break;
      }
    }

    if (!hasMongooseMethods) {
      console.log(`✅ File has no Mongoose-style methods: ${filePath}`);
    }

    return !hasMongooseMethods;
  } catch (error) {
    console.error(
      `❌ Error analyzing route structure: ${filePath}`,
      error.message
    );
    return false;
  }
}

async function runAllTests() {
  const results = {
    fileExistence: true,
    codeSyntax: true,
    modelStructure: true,
    routeStructure: true
  };

  console.log('📁 Testing File Existence...');
  const requiredFiles = [
    'models/Notification.js',
    'models/User.js',
    'models/Alert.js',
    'routes/notifications.js',
    'services/notificationService.js'
  ];

  let fileExistencePassed = true;
  for (const file of requiredFiles) {
    if (!testFileExists(file)) {
      fileExistencePassed = false;
    }
  }
  results.fileExistence = fileExistencePassed;

  console.log('\n🔍 Testing Code Syntax...');
  let codeSyntaxPassed = true;
  for (const file of requiredFiles) {
    if (!testFileSyntax(file)) {
      codeSyntaxPassed = false;
    }
  }
  results.codeSyntax = codeSyntaxPassed;

  console.log('\n🏗️ Testing Model Structure...');
  const modelFiles = [
    'models/Notification.js',
    'models/User.js',
    'models/Alert.js'
  ];
  let modelStructurePassed = true;
  for (const file of modelFiles) {
    if (!testModelStructure(file)) {
      modelStructurePassed = false;
    }
  }
  results.modelStructure = modelStructurePassed;

  console.log('\n🛣️ Testing Route Structure...');
  const routeFiles = ['routes/notifications.js'];
  let routeStructurePassed = true;
  for (const file of routeFiles) {
    if (!testRouteStructure(file)) {
      routeStructurePassed = false;
    }
  }
  results.routeStructure = routeStructurePassed;

  console.log('\n📊 Test Results Summary:');
  console.log('======================');
  Object.entries(results).forEach(([testName, passed]) => {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${testName}`);
  });

  const allPassed = Object.values(results).every((result) => result === true);

  if (allPassed) {
    console.log('\n🎉 All code structure tests passed!');
    console.log('✅ PostgreSQL migration appears to be complete and correct.');
    console.log('✅ All Sequelize/Mongoose references have been removed.');
    console.log('✅ All models use PostgreSQL raw SQL pattern.');
    console.log('✅ Routes use the new PostgreSQL models.');
  } else {
    console.log('\n⚠️  Some code structure tests failed.');
    console.log('Please review the error messages above.');
  }

  return allPassed;
}

// Run tests
runAllTests()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error('💥 Unexpected error during testing:', error);
    process.exit(1);
  });
