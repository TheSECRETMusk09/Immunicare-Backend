const db = require('./db');

async function checkInventoryAPI() {
  try {
    console.log('\n=== CHECKING INVENTORY API RESPONSE ===\n');
    
    // Simplified query to check vaccine names
    const query = `
      SELECT vi.id, vi.vaccine_id, v.name as vaccine_name, v.code as vaccine_code,
             vi.beginning_balance, vi.received_during_period, vi.issuance, vi.expired_wasted
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE v.is_active = true
      ORDER BY v.name, vi.period_start DESC
      LIMIT 200
    `;
    
    const result = await db.query(query);
    
    console.log(`Total inventory records returned: ${result.rows.length}\n`);
    
    // Group by vaccine_name to see what names are being returned
    const byVaccine = {};
    result.rows.forEach(row => {
      const name = row.vaccine_name;
      if (!byVaccine[name]) {
        byVaccine[name] = [];
      }
      byVaccine[name].push(row);
    });
    
    console.log('Vaccines in API response:');
    Object.keys(byVaccine).sort().forEach(name => {
      console.log(`  - ${name}: ${byVaccine[name].length} records`);
    });
    
    // Check specifically for PCV and MR
    console.log('\n=== PCV VACCINES ===');
    const pcvRecords = result.rows.filter(r => 
      r.vaccine_name.toLowerCase().includes('pcv') || 
      r.vaccine_code.toLowerCase().includes('pcv')
    );
    if (pcvRecords.length > 0) {
      console.log(`Found ${pcvRecords.length} PCV records:`);
      pcvRecords.slice(0, 3).forEach(r => {
        console.log(`  ID: ${r.id}, Vaccine: "${r.vaccine_name}", Code: "${r.vaccine_code}"`);
      });
    } else {
      console.log('No PCV records found');
    }
    
    console.log('\n=== MEASLES/RUBELLA VACCINES ===');
    const mrRecords = result.rows.filter(r => 
      r.vaccine_name.toLowerCase().includes('measles') || 
      r.vaccine_name.toLowerCase().includes('rubella') ||
      r.vaccine_name.toLowerCase().includes('mr')
    );
    if (mrRecords.length > 0) {
      console.log(`Found ${mrRecords.length} MR records:`);
      mrRecords.forEach(r => {
        console.log(`  ID: ${r.id}, Vaccine: "${r.vaccine_name}", Code: "${r.vaccine_code}"`);
      });
    } else {
      console.log('No Measles/Rubella records found');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

checkInventoryAPI();
