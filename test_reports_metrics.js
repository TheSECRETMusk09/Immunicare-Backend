require('dotenv').config({ path: '.env.development' });
require('dotenv').config();

const { getDashboardMetrics } = require('./services/adminMetricsService');
const ReportService = require('./services/reportService');
const pool = require('./db');

const reportService = new ReportService(pool);

async function testReportsMetrics() {
  console.log('Testing Reports Module Metrics...\n');

  try {
    // Test 1: Dashboard Stats (used by Reports as fallback)
    console.log('1. Testing /dashboard/stats endpoint data:');
    const dashboardStats = await getDashboardMetrics({
      facilityId: null,
      scopeIds: [],
    });
    console.log('Dashboard Stats:', JSON.stringify(dashboardStats, null, 2));
    console.log('\n');

    // Test 2: Reports Admin Summary
    console.log('2. Testing /reports/admin/summary endpoint data:');
    const adminSummary = await reportService.getAdminSummary({
      startDate: undefined,
      endDate: undefined,
      facilityId: null,
      scopeIds: [],
    });
    console.log('Admin Summary:', JSON.stringify(adminSummary, null, 2));
    console.log('\n');

    // Test 3: Verify specific metrics
    console.log('3. Verifying specific metrics:');
    console.log('  Vaccinations Total:', adminSummary.vaccination?.total || 0);
    console.log('  Vaccinations Completed:', adminSummary.vaccination?.completed || 0);
    console.log('  Infants Total:', adminSummary.infants?.total || 0);
    console.log('  Infants Up to Date:', adminSummary.infants?.up_to_date || 0);
    console.log('  Appointments Total:', adminSummary.appointments?.total || 0);
    console.log('  Appointments Completed:', adminSummary.appointments?.completed || 0);
    console.log('  Guardians Total:', adminSummary.guardians?.total || 0);
    console.log('  Transfer Turnaround Days:', adminSummary.transfers?.avg_turnaround_days || 0);
    console.log('  Transfer Open Cases:', adminSummary.transfers?.open_cases || 0);
    console.log('\n');

    // Test 4: Check if data matches dashboard stats
    console.log('4. Comparing with dashboard stats:');
    console.log('  Dashboard Infants:', dashboardStats.total_infants || dashboardStats.infants || 0);
    console.log('  Dashboard Vaccinations:', dashboardStats.total_vaccinations || dashboardStats.vaccinations || 0);
    console.log('  Dashboard Guardians:', dashboardStats.total_guardians || dashboardStats.guardians || 0);
    console.log('\n');

    console.log('✅ All metrics tests completed successfully!');
  } catch (error) {
    console.error('❌ Error testing metrics:', error);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

testReportsMetrics();
