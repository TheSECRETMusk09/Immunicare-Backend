const express = require('express');
const pool = require('./db');

// Temporary debug endpoint to see what's being sent
const app = express();
app.use(express.json());

app.post('/debug-transaction', async (req, res) => {
  console.log('\n=== TRANSACTION PAYLOAD DEBUG ===');
  console.log('Received payload:', JSON.stringify(req.body, null, 2));
  
  // Check each required field
  console.log('\nField validation:');
  console.log('- vaccine_inventory_id:', req.body.vaccine_inventory_id, typeof req.body.vaccine_inventory_id);
  console.log('- vaccine_id:', req.body.vaccine_id, typeof req.body.vaccine_id);
  console.log('- clinic_id:', req.body.clinic_id, typeof req.body.clinic_id);
  console.log('- transaction_type:', req.body.transaction_type, typeof req.body.transaction_type);
  console.log('- quantity:', req.body.quantity, typeof req.body.quantity);
  console.log('- transaction_date:', req.body.transaction_date, typeof req.body.transaction_date);
  
  // Check database schema
  try {
    const inventoryColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'inventory' 
      AND table_schema = 'public'
    `);
    console.log('\nINVENTORY table columns:', inventoryColumns.rows.map(r => r.column_name));
    
    const vaccineInventoryColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vaccine_inventory' 
      AND table_schema = 'public'
    `);
    console.log('VACCINE_INVENTORY table columns:', vaccineInventoryColumns.rows.map(r => r.column_name));
    
    const transactionsColumns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'vaccine_inventory_transactions' 
      AND table_schema = 'public'
    `);
    console.log('VACCINE_INVENTORY_TRANSACTIONS table columns:', transactionsColumns.rows.map(r => r.column_name));
  } catch (error) {
    console.error('Schema check error:', error.message);
  }
  
  res.json({ received: req.body });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Debug server running on http://localhost:${PORT}`);
  console.log('Send POST to http://localhost:3001/debug-transaction with your payload');
});
