const db = require('./db');

async function checkDependencies() {
  try {
    // Check vaccination records
    const vacResult = await db.query(`
      SELECT vr.id, vr.vaccine_id, v.name as vaccine_name
      FROM vaccination_records vr
      JOIN vaccines v ON vr.vaccine_id = v.id
      WHERE v.name NOT IN (
        'BCG', 'BCG, Diluent', 'Hepa B', 'Penta Valent', 'OPV 20-doses',
        'PCV 13/PCV 10', 'Measles & Rubella (P)', 'MMR', 'MMR, Diluent 5ml', 'IPV multi dose'
      )
    `);
    console.log('Vaccination records with non-approved vaccines:', vacResult.rows.length);
    vacResult.rows.forEach(row => {
      console.log(`ID: ${row.id}, Vaccine ID: ${row.vaccine_id}, Vaccine Name: '${row.vaccine_name}'`);
    });

    // Check immunization records
    const immResult = await db.query(`
      SELECT ir.id, ir.vaccine_id, v.name as vaccine_name
      FROM immunization_records ir
      JOIN vaccines v ON ir.vaccine_id = v.id
      WHERE v.name NOT IN (
        'BCG', 'BCG, Diluent', 'Hepa B', 'Penta Valent', 'OPV 20-doses',
        'PCV 13/PCV 10', 'Measles & Rubella (P)', 'MMR', 'MMR, Diluent 5ml', 'IPV multi dose'
      )
    `);
    console.log('\nImmunization records with non-approved vaccines:', immResult.rows.length);
    immResult.rows.forEach(row => {
      console.log(`ID: ${row.id}, Vaccine ID: ${row.vaccine_id}, Vaccine Name: '${row.vaccine_name}'`);
    });

    // Check vaccine inventory
    const invResult = await db.query(`
      SELECT vi.id, vi.vaccine_id, v.name as vaccine_name
      FROM vaccine_inventory vi
      JOIN vaccines v ON vi.vaccine_id = v.id
      WHERE v.name NOT IN (
        'BCG', 'BCG, Diluent', 'Hepa B', 'Penta Valent', 'OPV 20-doses',
        'PCV 13/PCV 10', 'Measles & Rubella (P)', 'MMR', 'MMR, Diluent 5ml', 'IPV multi dose'
      )
    `);
    console.log('\nVaccine inventory with non-approved vaccines:', invResult.rows.length);
    invResult.rows.forEach(row => {
      console.log(`ID: ${row.id}, Vaccine ID: ${row.vaccine_id}, Vaccine Name: '${row.vaccine_name}'`);
    });

    // Check vaccine batches
    const vbResult = await db.query(`
      SELECT vb.id, vb.vaccine_id, v.name as vaccine_name
      FROM vaccine_batches vb
      JOIN vaccines v ON vb.vaccine_id = v.id
      WHERE v.name NOT IN (
        'BCG', 'BCG, Diluent', 'Hepa B', 'Penta Valent', 'OPV 20-doses',
        'PCV 13/PCV 10', 'Measles & Rubella (P)', 'MMR', 'MMR, Diluent 5ml', 'IPV multi dose'
      )
    `);
    console.log('\nVaccine batches with non-approved vaccines:', vbResult.rows.length);
    vbResult.rows.forEach(row => {
      console.log(`ID: ${row.id}, Vaccine ID: ${row.vaccine_id}, Vaccine Name: '${row.vaccine_name}'`);
    });

  } catch (error) {
    console.error('Error checking dependencies:', error);
  } finally {
    process.exit();
  }
}

checkDependencies();
