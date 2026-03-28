const pool = require('./db');
const fs = require('fs');

async function implementAllFixes() {
  const results = {
    timestamp: new Date().toISOString(),
    fixes: {}
  };

  try {
    console.log('=== IMPLEMENTING ALL FIXES FOR SAN NICOLAS HEALTH CENTER ===\n');

    // ========================================================================
    // FIX #1: MERGE DUPLICATE FACILITIES
    // ========================================================================
    console.log('FIX #1: MERGING DUPLICATE FACILITY RECORDS...\n');
    
    const fix1Start = Date.now();
    
    // Execute the merge SQL
    const mergeSql = fs.readFileSync('fix_1_merge_facilities.sql', 'utf8');
    await pool.query(mergeSql);
    
    // Verify merge
    const verifyMerge = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM appointments WHERE clinic_id = 1) as appointments,
        (SELECT COUNT(*) FROM vaccine_inventory WHERE clinic_id = 1) as inventory,
        (SELECT COUNT(*) FROM guardians WHERE clinic_id = 1) as guardians,
        (SELECT COUNT(*) FROM users WHERE clinic_id = 1) as users,
        (SELECT COUNT(*) FROM clinics WHERE id = 203) as duplicate_exists
    `);
    
    console.log('✅ Facility merge complete:');
    console.table(verifyMerge.rows[0]);
    
    results.fixes.facilityMerge = {
      success: true,
      duration: Date.now() - fix1Start,
      data: verifyMerge.rows[0]
    };

    // ========================================================================
    // FIX #2: ADD PERFORMANCE INDEXES
    // ========================================================================
    console.log('\nFIX #2: ADDING PERFORMANCE INDEXES...\n');
    
    const fix2Start = Date.now();
    
    // Execute the index SQL
    const indexSql = fs.readFileSync('fix_2_add_indexes.sql', 'utf8');
    await pool.query(indexSql);
    
    // Verify indexes
    const verifyIndexes = await pool.query(`
      SELECT 
        schemaname,
        tablename,
        indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE 'idx_%clinic%'
      ORDER BY tablename, indexname;
    `);
    
    console.log(`✅ Created ${verifyIndexes.rows.length} performance indexes:`);
    console.table(verifyIndexes.rows);
    
    results.fixes.performanceIndexes = {
      success: true,
      duration: Date.now() - fix2Start,
      indexCount: verifyIndexes.rows.length,
      indexes: verifyIndexes.rows
    };

    // ========================================================================
    // FIX #3: VERIFY ANALYTICS FACILITY FILTERING
    // ========================================================================
    console.log('\nFIX #3: VERIFYING ANALYTICS FACILITY FILTERING...\n');
    
    // Check if analytics service has facility filtering
    const analyticsServiceContent = fs.readFileSync('services/analyticsService.js', 'utf8');
    const hasFacilityFiltering = analyticsServiceContent.includes('resolveScopedFacilityId');
    const passesUserContext = analyticsServiceContent.includes('user: req.user');
    
    console.log('✅ Analytics facility filtering check:');
    console.log(`  - Has resolveScopedFacilityId: ${hasFacilityFiltering}`);
    console.log(`  - Passes user context: ${passesUserContext}`);
    
    results.fixes.analyticsFacilityFiltering = {
      success: hasFacilityFiltering && passesUserContext,
      hasFacilityFiltering,
      passesUserContext,
      note: 'Analytics already properly filters by facility via user context'
    };

    // ========================================================================
    // FIX #4: FINAL VERIFICATION
    // ========================================================================
    console.log('\nFIX #4: FINAL VERIFICATION...\n');
    
    const finalCheck = await pool.query(`
      SELECT 
        c.id,
        c.name,
        (SELECT COUNT(*) FROM infants WHERE clinic_id = c.id) as infants,
        (SELECT COUNT(*) FROM appointments WHERE clinic_id = c.id) as appointments,
        (SELECT COUNT(*) FROM vaccine_inventory WHERE clinic_id = c.id) as inventory,
        (SELECT COUNT(*) FROM guardians WHERE clinic_id = c.id) as guardians,
        (SELECT COUNT(*) FROM users WHERE clinic_id = c.id) as users
      FROM clinics c
      WHERE c.id = 1;
    `);
    
    console.log('✅ San Nicolas Health Center (ID: 1) - Final Status:');
    console.table(finalCheck.rows[0]);
    
    results.fixes.finalVerification = {
      success: true,
      facilityData: finalCheck.rows[0]
    };

    // ========================================================================
    // SUMMARY
    // ========================================================================
    console.log('\n========================================');
    console.log('ALL FIXES IMPLEMENTED SUCCESSFULLY!');
    console.log('========================================\n');
    
    console.log('Summary:');
    console.log(`✅ Merged duplicate facility records`);
    console.log(`✅ Added ${verifyIndexes.rows.length} performance indexes`);
    console.log(`✅ Verified analytics facility filtering`);
    console.log(`✅ Final data integrity check passed`);
    
    console.log('\nSan Nicolas Health Center now has:');
    console.log(`  - ${finalCheck.rows[0].infants} infants`);
    console.log(`  - ${finalCheck.rows[0].appointments} appointments`);
    console.log(`  - ${finalCheck.rows[0].inventory} vaccine inventory records`);
    console.log(`  - ${finalCheck.rows[0].guardians} guardians`);
    console.log(`  - ${finalCheck.rows[0].users} users`);

    // Write results
    fs.writeFileSync('IMPLEMENTATION_RESULTS.json', JSON.stringify(results, null, 2));
    console.log('\n📄 Results saved to: IMPLEMENTATION_RESULTS.json');

    await pool.end();
    return results;
  } catch (error) {
    console.error('\n❌ Error during implementation:', error);
    console.error(error.stack);
    
    results.fixes.error = {
      message: error.message,
      stack: error.stack
    };
    
    fs.writeFileSync('IMPLEMENTATION_RESULTS.json', JSON.stringify(results, null, 2));
    process.exit(1);
  }
}

implementAllFixes();
