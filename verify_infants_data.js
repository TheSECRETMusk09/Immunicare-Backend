require('dotenv').config({ path: '.env.development' });
require('dotenv').config();

const pool = require('./db');

async function verifyInfantsData() {
  console.log('Verifying Infants Data in Database...\n');

  try {
    // 1. Check total infants in database
    const totalInfants = await pool.query(`
      SELECT COUNT(*) as total_infants 
      FROM patients 
      WHERE COALESCE(is_active, true) = true
    `);
    console.log('1. Total Infants in Database:', totalInfants.rows[0].total_infants);

    // 2. Check what the backend API returns
    const ReportService = require('./services/reportService');
    const reportService = new ReportService(pool);
    
    const adminSummary = await reportService.getAdminSummary({
      startDate: undefined,
      endDate: undefined,
      facilityId: null,
      scopeIds: [],
    });

    console.log('\n2. Backend API Response:');
    console.log('   adminSummary.infants:', JSON.stringify(adminSummary.infants, null, 2));
    
    // 3. Check the exact structure
    console.log('\n3. Detailed Structure Check:');
    console.log('   adminSummary.infants.total:', adminSummary.infants?.total);
    console.log('   adminSummary.infants.up_to_date:', adminSummary.infants?.up_to_date);
    console.log('   adminSummary.infants.active:', adminSummary.infants?.active);
    
    console.log('\n✅ Verification complete!');
  } catch (error) {
    console.error('❌ Error:', error);
    console.error('Stack:', error.stack);
  } finally {
    process.exit(0);
  }
}

verifyInfantsData();
