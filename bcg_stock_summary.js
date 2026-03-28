const pool = require('./db');

async function bcgStockSummary() {
  try {
    console.log('=== BCG STOCK SUMMARY FOR SAN NICOLAS HEALTH CENTER ===\n');

    const summaryQuery = await pool.query(`
      SELECT 
        COUNT(*) as total_records,
        SUM(stock_on_hand) as total_available_doses,
        MAX(stock_on_hand) as largest_batch,
        MIN(stock_on_hand) as smallest_batch,
        AVG(stock_on_hand)::int as average_per_record
      FROM vaccine_inventory vi
      JOIN vaccines v ON v.id = vi.vaccine_id
      WHERE v.name ILIKE '%BCG%'
        AND vi.clinic_id = 1
        AND vi.is_active = true;
    `);

    console.log('Overall Summary:');
    console.table(summaryQuery.rows[0]);

    const topRecordsQuery = await pool.query(`
      SELECT 
        vi.id,
        vi.stock_on_hand,
        vi.beginning_balance,
        vi.received_during_period,
        vi.issuance
      FROM vaccine_inventory vi
      JOIN vaccines v ON v.id = vi.vaccine_id
      WHERE v.name ILIKE '%BCG%'
        AND vi.clinic_id = 1
        AND vi.is_active = true
        AND vi.stock_on_hand > 0
      ORDER BY vi.stock_on_hand DESC
      LIMIT 10;
    `);

    console.log('\nTop 10 Records with Available Stock:');
    console.table(topRecordsQuery.rows);

    console.log('\n========================================');
    console.log('RECOMMENDATION:');
    console.log('========================================');
    console.log(`Total BCG stock available: ${summaryQuery.rows[0].total_available_doses} doses`);
    console.log(`Largest single batch: ${summaryQuery.rows[0].largest_batch} doses`);
    console.log('\nTo issue 1000 doses, you have two options:');
    console.log('1. Issue from the largest batch (record with most stock)');
    console.log('2. Split the issuance across multiple records');
    console.log('\nThe validation error occurred because you tried to issue');
    console.log('1000 doses from a record that only has 538 doses.');

    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

bcgStockSummary();
