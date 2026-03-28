const analyticsService = require('./services/analyticsService');

async function testAnalyticsEndpoints() {
  console.log('Testing Analytics Service Endpoints...\n');

  try {
    // Mock user object (system admin with no facility restriction)
    const mockUser = {
      id: 1,
      role: 'system_admin',
      clinic_id: null, // No facility restriction for system admin
    };

    // Test 1: Dashboard Summary Analytics
    console.log('1. Testing Dashboard Summary Analytics...');
    const dashboardSummary = await analyticsService.getDashboardSummaryAnalytics({
      query: {
        period: 'this_month',
      },
      user: mockUser,
    });
    
    console.log('Dashboard Summary:');
    console.log('  Total Registered Infants:', dashboardSummary.totalRegisteredInfants);
    console.log('  Total Guardians:', dashboardSummary.totalGuardians);
    console.log('  Vaccinations Completed Today:', dashboardSummary.vaccinationsCompletedToday);
    console.log('  Infants Due for Vaccination:', dashboardSummary.infantsDueForVaccination);
    console.log('  Pending Appointments:', dashboardSummary.pendingAppointments);
    console.log('  Overdue Vaccinations:', dashboardSummary.overdueVaccinations);

    // Test 2: Full Dashboard Analytics
    console.log('\n2. Testing Full Dashboard Analytics...');
    const dashboard = await analyticsService.getDashboardAnalytics({
      query: {
        period: 'this_month',
      },
      user: mockUser,
    });
    
    console.log('Full Dashboard:');
    console.log('  Summary:', dashboard.summary);
    console.log('  Filters:', dashboard.filters);

    // Test 3: Vaccination Analytics
    console.log('\n3. Testing Vaccination Analytics...');
    const vaccinations = await analyticsService.getVaccinationAnalytics({
      query: {
        period: 'this_month',
      },
      user: mockUser,
    });
    
    console.log('Vaccination Analytics:');
    console.log('  Summary:', vaccinations.summary);

    // Test 4: Appointment Analytics
    console.log('\n4. Testing Appointment Analytics...');
    const appointments = await analyticsService.getAppointmentAnalytics({
      query: {
        period: 'this_month',
      },
      user: mockUser,
    });
    
    console.log('Appointment Analytics:');
    console.log('  Summary:', appointments.summary);

    console.log('\n✅ All analytics endpoints tested successfully!');
    
    // Verify non-zero values
    console.log('\n📊 Verification:');
    const issues = [];
    
    if (dashboardSummary.totalRegisteredInfants === 0) {
      issues.push('❌ Total Registered Infants is 0 (expected 5000)');
    } else {
      console.log('✅ Total Registered Infants:', dashboardSummary.totalRegisteredInfants);
    }
    
    if (dashboardSummary.totalGuardians === 0) {
      issues.push('❌ Total Guardians is 0 (expected 3623)');
    } else {
      console.log('✅ Total Guardians:', dashboardSummary.totalGuardians);
    }
    
    if (issues.length > 0) {
      console.log('\n⚠️ Issues found:');
      issues.forEach(issue => console.log(issue));
    } else {
      console.log('\n✅ All metrics showing correct non-zero values!');
    }

  } catch (error) {
    console.error('❌ Error testing analytics endpoints:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

testAnalyticsEndpoints().then(() => {
  console.log('\nTest completed.');
  process.exit(0);
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
