/**
 * Vaccine Inventory Cleanup Script v2
 * Cleans up vaccine inventory to match the approved list for infant immunization
 *
 * Approved vaccines:
 * - BCG
 * - BCG, Diluent
 * - Hepa B
 * - Penta Valent
 * - OPV 20-doses
 * - PCV 13/PCV 10
 * - Measles & Rubella (MR) - assuming (P) was truncated
 * - MMR
 * - MMR, Diluent 5ml
 * - IPV multi dose
 */

const db = require('./db');

const APPROVED_VACCINES = [
  'BCG',
  'BCG, DILUENT',
  'HEPA B',
  'PENTA VALENT',
  'OPV 20-DOSES',
  'PCV 13/PCV 10',
  'MEASLES & RUBELLA (MR)',  // Assuming (P) was truncated
  'MMR',
  'MMR, DILUENT 5ML',
  'IPV MULTI DOSE',
];

// Normalize function for comparison
function normalizeName(name) {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

// Mapping of vaccines that should be migrated (naming mismatches)
const VACCINE_MIGRATIONS = {
  'HEPATITIS B': 'HEPA B',
  'ORAL POLIO VACCINE': 'OPV 20-DOSES',
  'INACTIVATED POLIO VACCINE': 'IPV MULTI DOSE',
  'PENTAVALENT (DPT-HEPB-HIB)': 'PENTA VALENT',
  'PNEUMOCOCCAL CONJUGATE VACCINE': 'PCV 13/PCV 10',
  'MEASLES-MUMPS-RUBELLA': 'MMR',
};

async function checkDependencies(vaccineId) {
  const tables = [
    'immunization_records',
    'vaccination_schedules',
    'vaccine_batches',
    'vaccine_inventory',
    'appointments',
  ];

  const dependencies = {};

  for (const table of tables) {
    try {
      const result = await db.query(
        `SELECT COUNT(*) as count FROM "${table}" WHERE vaccine_id = $1`,
        [vaccineId],
      );
      dependencies[table] = parseInt(result.rows[0].count);
    } catch (e) {
      // Table might not exist or have vaccine_id column
      dependencies[table] = 0;
    }
  }

  return dependencies;
}

async function getTableColumns(tableName) {
  try {
    const result = await db.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      [tableName],
    );
    return result.rows.map(r => r.column_name);
  } catch (e) {
    return [];
  }
}

async function migrateVaccineRecords(fromVaccineId, toVaccineId, tableName) {
  try {
    const columns = await getTableColumns(tableName);
    if (!columns.includes('vaccine_id')) {
      return 0;
    }

    const result = await db.query(
      `UPDATE "${tableName}" SET vaccine_id = $1 WHERE vaccine_id = $2 RETURNING id`,
      [toVaccineId, fromVaccineId],
    );
    return result.rowCount || 0;
  } catch (e) {
    console.log(`  Warning: Could not migrate ${tableName}: ${e.message}`);
    return 0;
  }
}

async function cleanupVaccines() {
  console.log('=== VACCINE INVENTORY CLEANUP v2 ===\n');

  // Get all vaccines
  const result = await db.query('SELECT id, name, code, is_active FROM vaccines ORDER BY id');
  const allVaccines = result.rows;

  console.log(`Found ${allVaccines.length} vaccines in database\n`);

  const vaccinesKept = [];
  const vaccinesMigrated = [];
  const vaccinesArchived = [];
  const vaccinesRemoved = [];
  const nameFixes = [];

  for (const vaccine of allVaccines) {
    const normalizedName = normalizeName(vaccine.name);
    const isApproved = APPROVED_VACCINES.includes(normalizedName);
    const migrationTarget = VACCINE_MIGRATIONS[normalizedName];

    console.log(`\nProcessing: ${vaccine.name} [${vaccine.code}] (ID: ${vaccine.id})`);
    console.log(`  Normalized: ${normalizedName}`);
    console.log(`  Is approved: ${isApproved}`);

    if (isApproved) {
      // Check if name needs to be fixed to match approved format
      const approvedMatch = APPROVED_VACCINES.find(av =>
        normalizeName(av) === normalizedName,
      );
      if (approvedMatch && vaccine.name !== approvedMatch) {
        await db.query('UPDATE vaccines SET name = $1 WHERE id = $2', [approvedMatch, vaccine.id]);
        nameFixes.push({ id: vaccine.id, old: vaccine.name, new: approvedMatch });
        console.log(`  ✓ Name fixed: "${vaccine.name}" -> "${approvedMatch}"`);
      }
      await db.query('UPDATE vaccines SET is_active = true WHERE id = $1', [vaccine.id]);
      vaccinesKept.push(vaccine);
      console.log('  ✓ KEPT (approved vaccine)');
    } else if (migrationTarget) {
      // Find target vaccine
      const targetResult = await db.query(
        'SELECT id FROM vaccines WHERE UPPER(TRIM(name)) = $1 AND is_active = true',
        [migrationTarget],
      );

      if (targetResult.rows.length > 0) {
        const targetId = targetResult.rows[0].id;
        console.log(`  → Migrating to: ${migrationTarget} (ID: ${targetId})`);

        // Check and migrate dependencies
        const deps = await checkDependencies(vaccine.id);
        const totalDeps = Object.values(deps).reduce((a, b) => a + b, 0);

        if (totalDeps > 0) {
          console.log(`  Found ${totalDeps} dependent records, migrating...`);

          for (const table of Object.keys(deps)) {
            if (deps[table] > 0) {
              const migrated = await migrateVaccineRecords(vaccine.id, targetId, table);
              console.log(`    Migrated ${migrated} records in ${table}`);
            }
          }
        }

        // Archive source vaccine
        await db.query('UPDATE vaccines SET is_active = false WHERE id = $1', [vaccine.id]);
        vaccinesMigrated.push({ ...vaccine, target: migrationTarget });
        console.log(`  ✓ MIGRATED to ${migrationTarget}`);
      } else {
        console.log(`  ⚠ Target vaccine "${migrationTarget}" not found, archiving...`);
        await db.query('UPDATE vaccines SET is_active = false WHERE id = $1', [vaccine.id]);
        vaccinesArchived.push(vaccine);
      }
    } else {
      // Check for dependencies
      const deps = await checkDependencies(vaccine.id);
      const totalDeps = Object.values(deps).reduce((a, b) => a + b, 0);

      if (totalDeps > 0) {
        // Has dependencies - archive instead of delete
        console.log(`  Has ${totalDeps} dependent records, archiving...`);
        console.log('  Dependencies:', deps);
        await db.query('UPDATE vaccines SET is_active = false WHERE id = $1', [vaccine.id]);
        vaccinesArchived.push(vaccine);
        console.log('  ✓ ARCHIVED (has dependencies)');
      } else {
        // No dependencies - safe to remove
        console.log('  No dependencies, removing...');
        await db.query('DELETE FROM vaccines WHERE id = $1', [vaccine.id]);
        vaccinesRemoved.push(vaccine);
        console.log('  ✓ REMOVED');
      }
    }
  }

  console.log('\n=== CLEANUP SUMMARY ===\n');
  console.log(`Vaccines KEPT (approved): ${vaccinesKept.length}`);
  vaccinesKept.forEach(v => console.log(`  - ${v.name} [${v.code}]`));

  console.log(`\nVaccines MIGRATED: ${vaccinesMigrated.length}`);
  vaccinesMigrated.forEach(v => console.log(`  - ${v.name} -> ${v.target}`));

  console.log(`\nVaccines ARCHIVED (inactivated): ${vaccinesArchived.length}`);
  vaccinesArchived.forEach(v => console.log(`  - ${v.name} [${v.code}]`));

  console.log(`\nVaccines REMOVED (hard deleted): ${vaccinesRemoved.length}`);
  vaccinesRemoved.forEach(v => console.log(`  - ${v.name} [${v.code}]`));

  console.log(`\nName fixes applied: ${nameFixes.length}`);
  nameFixes.forEach(f => console.log(`  - "${f.old}" -> "${f.new}"`));

  // Verify final state
  console.log('\n=== FINAL STATE ===\n');
  const finalResult = await db.query('SELECT id, name, code, is_active FROM vaccines ORDER BY is_active DESC, name');
  console.log(`Total vaccines: ${finalResult.rows.length}`);
  console.log(`Active: ${finalResult.rows.filter(v => v.is_active).length}`);
  console.log(`Inactive: ${finalResult.rows.filter(v => !v.is_active).length}`);

  console.log('\nActive vaccines:');
  finalResult.rows.filter(v => v.is_active).forEach(v => {
    const normalized = normalizeName(v.name);
    const approved = APPROVED_VACCINES.includes(normalized);
    console.log(`  ${v.id}: ${v.name} [${v.code}] - ${approved ? 'APPROVED' : 'NOT IN APPROVED LIST'}`);
  });

  await db.end();
  console.log('\n✓ Cleanup complete!');
}

cleanupVaccines().catch(e => {
  console.error('Cleanup failed:', e);
  process.exit(1);
});
