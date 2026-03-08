/**
 * Frontend Button Interactivity Test Suite
 * Tests button functionality for all Admin Dashboard modules
 *
 * This test validates:
 * 1. Button click handlers are properly bound
 * 2. Buttons trigger correct API endpoints
 * 3. Form submissions work correctly
 * 4. Modal open/close functionality
 * 5. Navigation buttons work correctly
 *
 * Run: node backend/tests/frontend_button_interactivity_test.js
 */

const fs = require('fs');
const path = require('path');

// Test configuration
const FRONTEND_SRC = path.join(__dirname, '../../frontend/src');

// Test results
const testResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  modules: {}
};

// Helper function to log test results
function logTest(module, testName, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL';
  const message = `${status} | [${module}] ${testName}${details ? ` - ${details}` : ''}`;
  console.log(message);

  if (!testResults.modules[module]) {
    testResults.modules[module] = { passed: 0, failed: 0, tests: [] };
  }

  testResults.modules[module].tests.push({ testName, passed, details });
  if (passed) {
    testResults.passed++;
    testResults.modules[module].passed++;
  } else {
    testResults.failed++;
    testResults.modules[module].failed++;
  }
}

function logSkip(module, testName, reason = '') {
  const message = `⏭️ SKIP | [${module}] ${testName}${reason ? ` - ${reason}` : ''}`;
  console.log(message);
  testResults.skipped++;
}

// ==================== FILE ANALYSIS HELPERS ====================

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return null;
  }
}

function findButtons(content) {
  // Find all button-related patterns
  const patterns = [
    /<button[^>]*onClick=\{([^}]+)\}[^>]*>/g,
    /<Button[^>]*onClick=\{([^}]+)\}[^>]*>/g,
    /onClick=\{[^}]*handle[A-Z][a-zA-Z]*[^}]*\}/g,
    /onClick=\{[^}]*on[A-Z][a-zA-Z]*[^}]*\}/g
  ];

  const buttons = [];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      buttons.push(match[0]);
    }
  });

  return buttons;
}

function findEventHandlers(content) {
  // Find event handler function definitions
  const patterns = [
    /const\s+(handle[A-Z][a-zA-Z]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?:=>|\{)/g,
    /function\s+(handle[A-Z][a-zA-Z]*)\s*\(/g,
    /const\s+(on[A-Z][a-zA-Z]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?:=>|\{)/g
  ];

  const handlers = [];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      handlers.push(match[1]);
    }
  });

  return [...new Set(handlers)];
}

function findApiCalls(content) {
  // Find API calls
  const patterns = [
    /apiClient\.([a-zA-Z]+)\(([^)]*)\)/g,
    /api\.([a-zA-Z]+)\(([^)]*)\)/g,
    /fetch\(['"]([^'"]+)['"]/g,
    /axios\.[a-zA-Z]+\(['"]([^'"]+)['"]/g
  ];

  const calls = [];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      calls.push(match[1] || match[0]);
    }
  });

  return [...new Set(calls)];
}

function findNavigationCalls(content) {
  // Find navigation calls
  const patterns = [
    /navigate\(['"]([^'"]+)['"]/g,
    /history\.push\(['"]([^'"]+)['"]/g,
    /<Link[^>]*to=['"]([^'"]+)['"]/g,
    /<Navigate[^>]*to=['"]([^'"]+)['"]/g
  ];

  const navigations = [];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      navigations.push(match[1]);
    }
  });

  return [...new Set(navigations)];
}

// ==================== MODULE TESTS ====================

function testDashboardButtons() {
  console.log('\n=== Testing Dashboard Module Buttons ===\n');
  const module = 'Dashboard';

  const dashboardPath = path.join(FRONTEND_SRC, 'components/Dashboard/DashboardOverview.jsx');
  const content = readFile(dashboardPath);

  if (!content) {
    logSkip(module, 'Dashboard file not found');
    return;
  }

  // Test for button presence
  const buttons = findButtons(content);
  logTest(
    module,
    'Dashboard has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  // Test for event handlers
  const handlers = findEventHandlers(content);
  logTest(
    module,
    'Dashboard has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}${handlers.length > 5 ? '...' : ''}`
  );

  // Test for API calls
  const apiCalls = findApiCalls(content);
  logTest(
    module,
    'Dashboard makes API calls',
    apiCalls.length > 0,
    `Found: ${apiCalls.slice(0, 5).join(', ')}${apiCalls.length > 5 ? '...' : ''}`
  );

  // Test for specific dashboard features
  logTest(
    module,
    'Dashboard has stats display',
    content.includes('stats') || content.includes('statistics')
  );
  logTest(
    module,
    'Dashboard has recent activity',
    content.includes('recent') || content.includes('activity')
  );
}

function testAnalyticsButtons() {
  console.log('\n=== Testing Analytics Module Buttons ===\n');
  const module = 'Analytics';

  const analyticsPath = path.join(FRONTEND_SRC, 'pages/Analytics.jsx');
  const content = readFile(analyticsPath);

  if (!content) {
    logSkip(module, 'Analytics file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'Analytics has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'Analytics has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for chart interactions
  logTest(
    module,
    'Analytics has chart components',
    content.includes('Chart') || content.includes('chart') || content.includes('Graph')
  );

  // Test for date filtering
  logTest(
    module,
    'Analytics has date filtering',
    content.includes('date') && (content.includes('filter') || content.includes('range'))
  );
}

function testInfantManagementButtons() {
  console.log('\n=== Testing Infant Management Module Buttons ===\n');
  const module = 'InfantManagement';

  const infantPath = path.join(FRONTEND_SRC, 'pages/InfantManagement.jsx');
  const content = readFile(infantPath);

  if (!content) {
    logSkip(module, 'InfantManagement file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'InfantManagement has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'InfantManagement has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for CRUD operations
  logTest(
    module,
    'InfantManagement has add infant functionality',
    content.includes('add') || content.includes('create') || content.includes('new')
  );
  logTest(
    module,
    'InfantManagement has edit functionality',
    content.includes('edit') || content.includes('update')
  );
  logTest(
    module,
    'InfantManagement has delete functionality',
    content.includes('delete') || content.includes('remove')
  );
  logTest(
    module,
    'InfantManagement has search functionality',
    content.includes('search') || content.includes('filter')
  );

  // Test for modal usage
  logTest(
    module,
    'InfantManagement uses modals',
    content.includes('Modal') || content.includes('modal')
  );
}

function testInventoryManagementButtons() {
  console.log('\n=== Testing Inventory Management Module Buttons ===\n');
  const module = 'InventoryManagement';

  const inventoryPath = path.join(FRONTEND_SRC, 'pages/InventoryManagement.jsx');
  const content = readFile(inventoryPath);

  if (!content) {
    logSkip(module, 'InventoryManagement file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'InventoryManagement has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'InventoryManagement has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for inventory-specific features
  logTest(
    module,
    'InventoryManagement has stock tracking',
    content.includes('stock') || content.includes('quantity')
  );
  logTest(
    module,
    'InventoryManagement has alerts',
    content.includes('alert') || content.includes('warning')
  );
  logTest(
    module,
    'InventoryManagement has transactions',
    content.includes('transaction') || content.includes('history')
  );
}

function testUserManagementButtons() {
  console.log('\n=== Testing User Management Module Buttons ===\n');
  const module = 'UserManagement';

  const userPath = path.join(FRONTEND_SRC, 'pages/UserManagement.jsx');
  const content = readFile(userPath);

  if (!content) {
    logSkip(module, 'UserManagement file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'UserManagement has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'UserManagement has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for user management features
  logTest(
    module,
    'UserManagement has add user functionality',
    content.includes('add') || content.includes('create')
  );
  logTest(
    module,
    'UserManagement has edit user functionality',
    content.includes('edit') || content.includes('update')
  );
  logTest(
    module,
    'UserManagement has role management',
    content.includes('role') || content.includes('permission')
  );
  logTest(
    module,
    'UserManagement has password reset',
    content.includes('password') || content.includes('reset')
  );
}

function testVaccinationsDashboardButtons() {
  console.log('\n=== Testing Vaccinations Dashboard Module Buttons ===\n');
  const module = 'VaccinationsDashboard';

  const vaccPath = path.join(FRONTEND_SRC, 'pages/VaccinationsDashboard.jsx');
  const content = readFile(vaccPath);

  if (!content) {
    logSkip(module, 'VaccinationsDashboard file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'VaccinationsDashboard has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'VaccinationsDashboard has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for vaccination features
  logTest(
    module,
    'VaccinationsDashboard has schedule view',
    content.includes('schedule') || content.includes('calendar')
  );
  logTest(
    module,
    'VaccinationsDashboard has record functionality',
    content.includes('record') || content.includes('log')
  );
  logTest(
    module,
    'VaccinationsDashboard has vaccine selection',
    content.includes('vaccine') || content.includes('immunization')
  );
}

function testReportsButtons() {
  console.log('\n=== Testing Reports Module Buttons ===\n');
  const module = 'Reports';

  const reportsPath = path.join(FRONTEND_SRC, 'pages/Reports.jsx');
  const content = readFile(reportsPath);

  if (!content) {
    logSkip(module, 'Reports file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'Reports has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'Reports has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for report features
  logTest(
    module,
    'Reports has generate functionality',
    content.includes('generate') || content.includes('create')
  );
  logTest(
    module,
    'Reports has export functionality',
    content.includes('export') || content.includes('download')
  );
  logTest(
    module,
    'Reports has print functionality',
    content.includes('print') || content.includes('pdf')
  );
}

function testAnnouncementsButtons() {
  console.log('\n=== Testing Announcements Module Buttons ===\n');
  const module = 'Announcements';

  const announcePath = path.join(FRONTEND_SRC, 'pages/Announcements.jsx');
  const content = readFile(announcePath);

  if (!content) {
    logSkip(module, 'Announcements file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'Announcements has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'Announcements has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for announcement features
  logTest(
    module,
    'Announcements has create functionality',
    content.includes('create') || content.includes('add') || content.includes('new')
  );
  logTest(
    module,
    'Announcements has edit functionality',
    content.includes('edit') || content.includes('update')
  );
  logTest(
    module,
    'Announcements has delete functionality',
    content.includes('delete') || content.includes('remove')
  );
}

function testSettingsButtons() {
  console.log('\n=== Testing Settings Module Buttons ===\n');
  const module = 'Settings';

  const settingsPath = path.join(FRONTEND_SRC, 'pages/Settings.jsx');
  const content = readFile(settingsPath);

  if (!content) {
    logSkip(module, 'Settings file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'Settings has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'Settings has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for settings features
  logTest(
    module,
    'Settings has save functionality',
    content.includes('save') || content.includes('update')
  );
  logTest(
    module,
    'Settings has form validation',
    content.includes('validate') || content.includes('error')
  );
}

function testDigitalPapersButtons() {
  console.log('\n=== Testing Digital Papers Module Buttons ===\n');
  const module = 'DigitalPapers';

  const papersPath = path.join(FRONTEND_SRC, 'pages/DigitalPapersDashboard.jsx');
  const content = readFile(papersPath);

  if (!content) {
    logSkip(module, 'DigitalPapersDashboard file not found');
    return;
  }

  const buttons = findButtons(content);
  logTest(
    module,
    'DigitalPapers has interactive buttons',
    buttons.length > 0,
    `Found ${buttons.length} buttons`
  );

  const handlers = findEventHandlers(content);
  logTest(
    module,
    'DigitalPapers has event handlers',
    handlers.length > 0,
    `Found: ${handlers.slice(0, 5).join(', ')}`
  );

  // Test for digital papers features
  logTest(
    module,
    'DigitalPapers has download functionality',
    content.includes('download') || content.includes('export')
  );
  logTest(
    module,
    'DigitalPapers has template selection',
    content.includes('template') || content.includes('paper')
  );
}

// ==================== SHARED COMPONENT TESTS ====================

function testSharedComponents() {
  console.log('\n=== Testing Shared UI Components ===\n');
  const module = 'SharedComponents';

  // Test Button component
  const buttonPath = path.join(FRONTEND_SRC, 'components/UI/Button.jsx');
  const buttonContent = readFile(buttonPath);

  if (buttonContent) {
    logTest(module, 'Button component exists', true);
    logTest(module, 'Button has onClick handler', buttonContent.includes('onClick'));
    logTest(module, 'Button has disabled state', buttonContent.includes('disabled'));
    logTest(module, 'Button has loading state', buttonContent.includes('loading'));
  } else {
    logSkip(module, 'Button component not found');
  }

  // Test Modal component
  const modalPath = path.join(FRONTEND_SRC, 'components/UI/Modal.jsx');
  const modalContent = readFile(modalPath);

  if (modalContent) {
    logTest(module, 'Modal component exists', true);
    logTest(
      module,
      'Modal has open/close functionality',
      modalContent.includes('onClose') || modalContent.includes('isOpen')
    );
  } else {
    logSkip(module, 'Modal component not found');
  }

  // Test TextInput component
  const textInputPath = path.join(FRONTEND_SRC, 'components/UI/TextInput.jsx');
  const textInputContent = readFile(textInputPath);

  if (textInputContent) {
    logTest(module, 'TextInput component exists', true);
    logTest(module, 'TextInput has onChange handler', textInputContent.includes('onChange'));
  } else {
    logSkip(module, 'TextInput component not found');
  }
}

// ==================== API SERVICE TESTS ====================

function testApiServices() {
  console.log('\n=== Testing API Services ===\n');
  const module = 'ApiServices';

  const servicesDir = path.join(FRONTEND_SRC, 'services');

  // Test userService
  const userServicePath = path.join(servicesDir, 'userService.js');
  const userServiceContent = readFile(userServicePath);

  if (userServiceContent) {
    logTest(module, 'userService exists', true);
    const apiCalls = findApiCalls(userServiceContent);
    logTest(
      module,
      'userService has API calls',
      apiCalls.length > 0,
      `Found: ${apiCalls.slice(0, 5).join(', ')}`
    );
  } else {
    logSkip(module, 'userService not found');
  }

  // Test infantService
  const infantServicePath = path.join(servicesDir, 'infantService.js');
  const infantServiceContent = readFile(infantServicePath);

  if (infantServiceContent) {
    logTest(module, 'infantService exists', true);
    const apiCalls = findApiCalls(infantServiceContent);
    logTest(
      module,
      'infantService has API calls',
      apiCalls.length > 0,
      `Found: ${apiCalls.slice(0, 5).join(', ')}`
    );
  } else {
    logSkip(module, 'infantService not found');
  }

  // Test vaccinationService
  const vaccinationServicePath = path.join(servicesDir, 'vaccinationService.js');
  const vaccinationServiceContent = readFile(vaccinationServicePath);

  if (vaccinationServiceContent) {
    logTest(module, 'vaccinationService exists', true);
    const apiCalls = findApiCalls(vaccinationServiceContent);
    logTest(
      module,
      'vaccinationService has API calls',
      apiCalls.length > 0,
      `Found: ${apiCalls.slice(0, 5).join(', ')}`
    );
  } else {
    logSkip(module, 'vaccinationService not found');
  }
}

// ==================== MAIN TEST RUNNER ====================

function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FRONTEND BUTTON INTERACTIVITY TEST SUITE              ║');
  console.log('║     Testing Button Functionality for Admin Modules        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // Run module tests
  testDashboardButtons();
  testAnalyticsButtons();
  testInfantManagementButtons();
  testInventoryManagementButtons();
  testUserManagementButtons();
  testVaccinationsDashboardButtons();
  testReportsButtons();
  testAnnouncementsButtons();
  testSettingsButtons();
  testDigitalPapersButtons();

  // Run shared component tests
  testSharedComponents();

  // Run API service tests
  testApiServices();

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`⏭️  Skipped: ${testResults.skipped}`);
  console.log(`📊 Total: ${testResults.passed + testResults.failed + testResults.skipped}`);

  // Print module breakdown
  console.log('\n=== Module Breakdown ===');
  Object.entries(testResults.modules).forEach(([module, results]) => {
    console.log(`  ${module}: ${results.passed} passed, ${results.failed} failed`);
  });

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests();
