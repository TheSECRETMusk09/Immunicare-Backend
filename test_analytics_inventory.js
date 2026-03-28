const pool = require('./db');
const analyticsRepository = require('./repositories/analyticsRepository');

async function testInventoryAnalytics() {
  try {
    console.log('=== Testing Analytics Inventory Snapshot ===\n');
    
    // Test the analytics repository function
    const inventorySnapshot = await analyticsRepository.getInventorySnapshot({
      facilityId: null,
      vaccineIds: null,
    });
    
    console.log('Analytics Repository Result:');
    console.table([inventorySnapshot]);
    
    console.log('\n=== Expected Values from Direct Database Query ===');
    const directQuery = `
      SELECT 
        COUNT(*)::int AS total_items,
        COALESCE(SUM(GREATEST(COALESCE(quantity, 0), 0)), 0)::int AS total_available_doses,
        COUNT(*) FILTER (WHERE GREATEST(COALESCE(quantity, 0), 0) <= 10)::int AS low_stock_count,
        COUNT(*) FILTER (WHERE GREATEST(COALESCE(quantity, 0), 0) <= 5)::int AS critical_stock_count,
        COUNT(*) FILTER (WHERE GREATEST(COALESCE(quantity, 0), 0) <= 0)::int AS out_of_stock_count
      FROM inventory
      WHERE COALESCE(is_active, true) = true;
    `;
    
    const directResult = await pool.query(directQuery);
    console.log('Direct Query Result:');
    console.table(directResult.rows);
    
    console.log('\n=== Comparison ===');
    const expected = directResult.rows[0];
    const actual = inventorySnapshot;
    
    const comparison = {
      metric: ['total_items', 'total_available_doses', 'low_stock_count', 'critical_stock_count', 'out_of_stock_count'],
      expected: [
        expected.total_items,
        expected.total_available_doses,
        expected.low_stock_count,
        expected.critical_stock_count,
        expected.out_of_stock_count
      ],
      actual: [
        actual.total_items,
        actual.total_available_doses,
        actual.lowStockCount || actual.low_stock_count,
        actual.criticalStockCount || actual.critical_stock_count,
        actual.outOfStockCount || actual.out_of_stock_count
      ],
      match: []
    };
    
    for (let i = 0; i < comparison.metric.length; i++) {
      comparison.match[i] = comparison.expected[i] === comparison.actual[i] ? '✓' : '✗ MISMATCH';
    }
    
    console.table(comparison.metric.map((m, i) => ({
      metric: m,
      expected: comparison.expected[i],
      actual: comparison.actual[i],
      match: comparison.match[i]
    })));
    
    await pool.end();
    
    if (comparison.match.some(m => m.includes('MISMATCH'))) {
      console.log('\n❌ DISCREPANCIES FOUND - Analytics calculations do not match database values!');
      process.exit(1);
    } else {
      console.log('\n✅ All values match correctly!');
      process.exit(0);
    }
  } catch (error) {
    console.error('Error testing inventory analytics:', error);
    process.exit(1);
  }
}

testInventoryAnalytics();
