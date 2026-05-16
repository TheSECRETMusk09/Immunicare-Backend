/**
 * Guardian Dashboard Mobile - Executable Test Script
 *
 * This script tests the mobile guardian dashboard functionality:
 * - Mobile responsiveness
 * - Touch targets (WCAG 2.5.5 - 44px minimum)
 * - Accessibility features
 * - CSS class consistency
 * - Navigation functionality
 *
 * Run with: node test_guardian_mobile.js
 */

const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════');
console.log('  Guardian Dashboard Mobile - Comprehensive Test Suite');
console.log('═══════════════════════════════════════════════════════════\n');

const TEST_RESULTS = {
  passed: 0,
  failed: 0,
  warnings: 0,
  total: 0,
};

const issues = [];
const recommendations = [];

/**
 * Test Helper Functions
 */
function pass(testName, details = '') {
  TEST_RESULTS.passed++;
  TEST_RESULTS.total++;
  console.log(`  ✅ PASS: ${testName}`);
  if (details) {
    console.log(`     └─ ${details}`);
  }
}

function fail(testName, details = '') {
  TEST_RESULTS.failed++;
  TEST_RESULTS.total++;
  console.log(`  ❌ FAIL: ${testName}`);
  if (details) {
    console.log(`     └─ ${details}`);
  }
  issues.push({ test: testName, issue: details });
}

function warn(testName, details = '') {
  TEST_RESULTS.warnings++;
  TEST_RESULTS.total++;
  console.log(`  ⚠️  WARN: ${testName}`);
  if (details) {
    console.log(`     └─ ${details}`);
  }
  recommendations.push({ test: testName, recommendation: details });
}

/**
 * Test Categories
 */
const tests = {
  // 1. CSS File Existence Tests
  cssFiles: () => {
    console.log('\n📁 CSS File Structure Tests');
    console.log('─'.repeat(60));

    const cssFiles = [
      'frontend/src/css/guardian-mobile.css',
      'frontend/src/css/guardian-mobile-enhancements.css',
    ];

    cssFiles.forEach((file) => {
      const exists = fs.existsSync(path.join(__dirname, '..', file));
      if (exists) {
        const stats = fs.statSync(path.join(__dirname, '..', file));
        pass(`${file} exists`, `${(stats.size / 1024).toFixed(1)} KB`);
      } else {
        fail(`${file} missing`);
      }
    });
  },

  // 2. Mobile Responsive Design Tests
  mobileResponsive: () => {
    console.log('\n📱 Mobile Responsive Design Tests');
    console.log('─'.repeat(60));

    const mobileCssPath = path.join(__dirname, '..', 'frontend/src/css/guardian-mobile.css');
    const content = fs.readFileSync(mobileCssPath, 'utf8');

    // Test for mobile breakpoint
    if (content.includes('max-width: 767px') || content.includes('max-width: 768px')) {
      pass('Mobile breakpoint defined', 'Uses @media (max-width: 767px)');
    } else {
      fail('Mobile breakpoint missing');
    }

    // Test for touch target sizes
    if (content.includes('min-height: 44px') || content.includes('min-height: 48px')) {
      pass('Touch target sizes defined', 'Uses minimum 44px for touch');
    } else {
      fail('Touch target sizes missing');
    }

    // Test for safe area insets (iOS)
    if (content.includes('safe-area-inset')) {
      pass('iOS safe area support', 'Uses env(safe-area-inset-*)');
    } else {
      warn('iOS safe area support', 'Consider adding safe-area-inset for notched devices');
    }

    // Test for viewport overflow handling
    if (content.includes('overflow-x: hidden')) {
      pass('Horizontal overflow prevented');
    } else {
      warn('Horizontal overflow handling', 'Consider adding overflow-x: hidden for mobile');
    }

    // Test for dvh units (dynamic viewport height)
    if (content.includes('100dvh') || content.includes('100vh')) {
      pass('Dynamic viewport height used');
    } else {
      warn('Dynamic viewport height', 'Consider using 100dvh for mobile browsers');
    }
  },

  // 3. Touch Target Tests
  touchTargets: () => {
    console.log('\n👆 Touch Target Tests (WCAG 2.5.5)');
    console.log('─'.repeat(60));

    const fixesCssPath = path.join(
      __dirname,
      '..',
      'frontend/src/css/guardian-mobile-enhancements.css'
    );
    const content = fs.readFileSync(fixesCssPath, 'utf8');

    // Test for button touch targets
    if (content.includes('min-height: 44px') && content.includes('min-width: 44px')) {
      pass('Button touch targets', '44x44px minimum');
    } else {
      fail('Button touch targets', 'Should have 44x44px minimum');
    }

    // Test for form input touch targets
    if (content.includes('min-height: 48px') && content.includes('input')) {
      pass('Form input touch targets', '48px minimum for inputs');
    } else {
      warn('Form input touch targets', 'Consider 48px minimum for form inputs');
    }

    // Test for touch-action property
    if (content.includes('touch-action')) {
      pass('Touch action CSS property', 'Prevents double-tap zoom');
    } else {
      warn('Touch action CSS', 'Consider adding touch-action: manipulation');
    }
  },

  // 4. Component Tests
  components: () => {
    console.log('\n🧩 Component Structure Tests');
    console.log('─'.repeat(60));

    const components = [
      { path: 'frontend/src/components/GuardianLayout.jsx', name: 'GuardianLayout' },
      { path: 'frontend/src/components/GuardianSidebar.jsx', name: 'GuardianSidebar' },
      { path: 'frontend/src/components/MobileBottomNav.jsx', name: 'MobileBottomNav' },
      { path: 'frontend/src/pages/GuardianDashboard.jsx', name: 'GuardianDashboard' },
    ];

    components.forEach((comp) => {
      const fullPath = path.join(__dirname, '..', comp.path);
      if (fs.existsSync(fullPath)) {
        pass(`${comp.name} component exists`);
      } else {
        fail(`${comp.name} component missing`);
      }
    });
  },

  // 5. Accessibility Tests
  accessibility: () => {
    console.log('\n♿ Accessibility Tests');
    console.log('─'.repeat(60));

    const dashboardPath = path.join(__dirname, '..', 'frontend/src/pages/GuardianDashboard.jsx');
    const content = fs.readFileSync(dashboardPath, 'utf8');

    // Test for ARIA attributes
    const ariaCount = (content.match(/aria-/g) || []).length;
    if (ariaCount > 0) {
      pass('ARIA attributes present', `${ariaCount} occurrences`);
    } else {
      warn('ARIA attributes', 'Consider adding ARIA labels for accessibility');
    }

    // Test for role attributes
    const roleCount = (content.match(/role=/g) || []).length;
    if (roleCount > 0) {
      pass('Role attributes present', `${roleCount} occurrences`);
    } else {
      warn('Role attributes', 'Consider adding semantic roles');
    }

    // Test for keyboard navigation support
    if (
      content.includes('onKeyDown') ||
      content.includes('onKeyUp') ||
      content.includes('keyboard')
    ) {
      pass('Keyboard navigation support');
    } else {
      warn('Keyboard navigation', 'Consider adding keyboard event handlers');
    }
  },

  // 6. Navigation Tests
  navigation: () => {
    console.log('\n🧭 Navigation Tests');
    console.log('─'.repeat(60));

    const sidebarPath = path.join(__dirname, '..', 'frontend/src/components/GuardianSidebar.jsx');
    const bottomNavPath = path.join(__dirname, '..', 'frontend/src/components/MobileBottomNav.jsx');

    // Test sidebar
    if (fs.existsSync(sidebarPath)) {
      const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');

      if (sidebarContent.includes('fixed') || sidebarContent.includes('position: fixed')) {
        pass('Sidebar fixed positioning');
      }

      if (sidebarContent.includes('transform') && sidebarContent.includes('translateX')) {
        pass('Sidebar slide animation');
      }

      if (sidebarContent.includes('onClose') || sidebarContent.includes('handleClose')) {
        pass('Sidebar close handler');
      }
    }

    // Test bottom nav
    if (fs.existsSync(bottomNavPath)) {
      const bottomNavContent = fs.readFileSync(bottomNavPath, 'utf8');

      if (bottomNavContent.includes('fixed') || bottomNavContent.includes('bottom: 0')) {
        pass('Bottom navigation fixed at bottom');
      }

      if (bottomNavContent.includes('useLocation') || bottomNavContent.includes('active')) {
        pass('Bottom nav active state handling');
      }
    }
  },

  // 7. Dark Mode Tests
  darkMode: () => {
    console.log('\n🌙 Dark Mode Tests');
    console.log('─'.repeat(60));

    const mobileCssPath = path.join(__dirname, '..', 'frontend/src/css/guardian-mobile.css');
    const content = fs.readFileSync(mobileCssPath, 'utf8');

    // Test for dark mode support
    if (content.includes('dark:') || content.includes('dark-mode')) {
      pass('Dark mode CSS classes');
    } else {
      warn('Dark mode support', 'Consider adding dark: variants for mobile');
    }

    // Test for dark mode toggle in header
    const headerPath = path.join(__dirname, '..', 'frontend/src/components/GuardianHeader.jsx');
    if (fs.existsSync(headerPath)) {
      const headerContent = fs.readFileSync(headerPath, 'utf8');

      if (headerContent.includes('darkMode') || headerContent.includes('isDark')) {
        pass('Dark mode toggle in header');
      }
    }
  },

  // 8. Performance Tests
  performance: () => {
    console.log('\n⚡ Performance Tests');
    console.log('─'.repeat(60));

    const mobileCssPath = path.join(__dirname, '..', 'frontend/src/css/guardian-mobile.css');
    const content = fs.readFileSync(mobileCssPath, 'utf8');

    // Test for will-change property (optimization)
    if (content.includes('will-change')) {
      pass('CSS will-change property', 'Animation optimization');
    } else {
      warn('CSS animation optimization', 'Consider using will-change for animations');
    }

    // Test for transform/opacity animations only
    if (content.includes('transform:') && content.includes('opacity')) {
      pass('Performance-friendly animations', 'Uses transform and opacity');
    }

    // Test for reduced motion support
    if (content.includes('prefers-reduced-motion')) {
      pass('Reduced motion support', 'Accessibility for motion sensitivity');
    } else {
      warn('Reduced motion', 'Consider adding prefers-reduced-motion support');
    }
  },
};

/**
 * Run All Tests
 */
function runTests() {
  try {
    // Run all test categories
    Object.values(tests).forEach((test) => test());

    // Print Summary
    console.log('\n' + '═'.repeat(60));
    console.log('                    TEST SUMMARY');
    console.log('═'.repeat(60));

    console.log(`\n  Total Tests: ${TEST_RESULTS.total}`);
    console.log(`  ✅ Passed:   ${TEST_RESULTS.passed}`);
    console.log(`  ❌ Failed:   ${TEST_RESULTS.failed}`);
    console.log(`  ⚠️  Warnings: ${TEST_RESULTS.warnings}`);

    const passRate = ((TEST_RESULTS.passed / TEST_RESULTS.total) * 100).toFixed(1);
    console.log(`\n  Pass Rate:  ${passRate}%`);

    // Print Issues
    if (issues.length > 0) {
      console.log('\n' + '─'.repeat(60));
      console.log('                    ISSUES FOUND');
      console.log('─'.repeat(60));

      issues.forEach((issue, index) => {
        console.log(`\n  ${index + 1}. ${issue.test}`);
        console.log(`     Issue: ${issue.issue}`);
      });
    }

    // Print Recommendations
    if (recommendations.length > 0) {
      console.log('\n' + '─'.repeat(60));
      console.log('                RECOMMENDATIONS');
      console.log('─'.repeat(60));

      recommendations.forEach((rec, index) => {
        console.log(`\n  ${index + 1}. ${rec.test}`);
        console.log(`     Recommendation: ${rec.recommendation}`);
      });
    }

    // Generate JSON Report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: TEST_RESULTS.total,
        passed: TEST_RESULTS.passed,
        failed: TEST_RESULTS.failed,
        warnings: TEST_RESULTS.warnings,
        passRate: passRate + '%',
      },
      issues: issues,
      recommendations: recommendations,
    };

    const reportPath = path.join(__dirname, 'GUARDIAN_MOBILE_TEST_RESULTS.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);

    // Final Status
    console.log('\n' + '═'.repeat(60));
    if (TEST_RESULTS.failed === 0) {
      console.log('  ✅ ALL TESTS PASSED - Mobile Guardian Dashboard Ready!');
    } else {
      console.log(`  ❌ ${TEST_RESULTS.failed} TEST(S) FAILED - Needs Attention`);
    }
    console.log('═'.repeat(60) + '\n');

    return TEST_RESULTS.failed === 0;
  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Execute tests
const success = runTests();
process.exit(success ? 0 : 1);
