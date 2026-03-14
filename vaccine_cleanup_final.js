/**
 * Final Vaccine Inventory Cleanup Script
 * Ensures vaccine inventory matches exactly the approved list for infant immunization
 *
 * Approved vaccines (exact matches required):
 * - BCG
 * - BCG, Diluent
 * - Hepa B
 * - Penta Valent
 * - OPV 20-doses
 * - PCV 13/PCV 10
 * - Measles & Rubella (P) [Note: appears truncated in source, using sensible complete form]
 * - MMR
 * - MMR, Diluent 5ml
 * - IPV multi dose
 */

const db = require('./db');

// Exact approved vaccine names (as provided, handling apparent truncation)
const APPROVED_VACCINES_EXACT = [
  'BCG',
  'BCG, Diluent',
  'Hepa B',
  'Penta Valent',
  'OPV 20-doses',
  'PCV 13/PCV 10',
  'Measles & Rubella (MR)',  // Using complete form since (P) appears truncated
  'MMR',
  'MMR, Diluent 5ml',
  'IPV multi dose',
];

// Normalize function for comparison (trim, uppercase, collapsed spaces)
function normalizeName(name) {
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

// Get normalized approved names for comparison
const APPROVED_NORMALIZED = APPROVED_VACCINES_EXACT.map(normalizeName);

// Specific mappings for known variants
const VACCINE_MAPPINGS = {
  // Map variants to their approved equivalents
  'HEPATITIS B': 'HEPA B',
  'ORAL POLIO VACCINE': 'OPV 20-DOSES',
  'INACTIVATED POLIO VACCINE': 'IPV MULTI DOSE',
  'PENTAVALENT (DPT-HEPB-HIB)': 'PENTA VALENT',
  'PNEUMOCOCCAL CONJUGATE VACCINE': 'PCV 13/PCV 10',
  'MEASLES-MUMPS-RUBELLA': 'MEASLES & RUBELLA (MR)',
  // Handle spacing variants
  'PCV 13 / PCV 10': 'PCV 13/PCV 10',  // Remove spaces around slash
};

async function cleanupVaccines() {
  console.log('=== FINAL VACCINE INVENTORY CLEANUP ===\n');

  // Get all vaccines
  const result = await db.query('SELECT id, name, code, is_active FROM vaccines ORDER BY id');
  const allVaccines = result.rows;

  console.log(`Found ${allVaccines.length} vaccines in database\n`);

  const stats = {
    kept: [],
    migrated: [],
    archived: [],
    removed: [],
    nameFixed: [],
  };

  for (const vaccine of allVaccines) {
    const normalizedName = normalizeName(vaccine.name);
    const isExactlyApproved = APPROVED_VACCINES_EXACT.includes(vaccine.name);
    const isNormalizedApproved = APPROVED_NORMALIZED.includes(normalizedName);
    const migrationTarget = VACCINE_MAPPINGS[normalizedName];

    console.log(`\nProcessing: ${vaccine.name} [${vaccine.code}] (ID: ${vaccine.id})`);
    console.log(`  Normalized: ${normalizedName}`);
    console.log(`  Exactly approved: ${isExactlyApproved}`);
    console.log(`  Normalized approved: ${isNormalizedApproved}`);

    if (isExactlyApproved) {
      // Already exactly correct
      await db.query('UPDATE vaccines SET is_active = true WHERE id = $1', [vaccine.id]);
      stats.kept.push(vaccine);
      console.log('  ✓ KEPT (exactly approved)');
    } else if (isNormalizedApproved) {
      // Needs name formatting fix (spacing, etc.)
      // Find which approved variant matches
      const matchedApproved = APPROVED_VACCINES_EXACT.find(av =>
        normalizeName(av) === normalizedName,
      );

      if (matchedApproved && vaccine.name !== matchedApproved) {
        await db.query('UPDATE vaccines SET name = $1 WHERE id = $2', [matchedApproved, vaccine.id]);
        stats.nameFixed.push({ id: vaccine.id, old: vaccine.name, new: matchedApproved });
        console.log(`  ✓ Name fixed: "${vaccine.name}" -> "${matchedApproved}"`);
      }
      await db.query('UPDATE vaccines SET is_active = true WHERE id = $1', [vaccine.id]);
      stats.kept.push(vaccine);
      console.log('  ✓ KEPT (approved after normalization)');
    } else if (migrationTarget) {
      // Can be migrated to an approved vaccine
      console.log(`  → Mapping to: ${migrationTarget}`);

      // Find target vaccine
      const targetResult = await db.query(
        'SELECT id FROM vaccines WHERE name = $1 AND is_active = true',
        [migrationTarget],
      );

      if (targetResult.rows.length === 0) {
        // Target might need to be activated first
        const targetResult2 = await db.query(
          'SELECT id FROM vaccines WHERE name = $1',
          [migrationTarget],
        );

        if (targetResult2.rows.length > 0) {
          await db.query('UPDATE vaccines SET is_active = true WHERE id = $1', [targetResult2.rows[0].id]);
        } else {
          console.log(`  ⚠ Target vaccine "${migrationTarget}" not found!`);
          // Fall back to archiving
          await db.query('UPDATE vaccines SET is_active = false WHERE id = $1', [vaccine.id]);
          stats.archived.push(vaccine);
          console.log('  ✓ ARCHIVED (target not found)');
          continue;
        }
      }

      const targetId = targetResult.rows[0].id;

      // Check and migrate dependencies
      const deps = await checkDependencies(vaccine.id);
      const totalDeps = Object.values(deps).reduce((a, b) => a + b, 0);

      if (totalDeps > 0) {
        console.log(`  Found ${totalDeps} dependent records, migrating...`);

        for (const [table, count] of Object.entries(deps)) {
          if (count > 0) {
            const migrated = await migrateVaccineRecords(vaccine.id, targetId, table);
            console.log(`    Migrated ${migrated} records in ${table}`);
          }
        }
      }

      // Archive source vaccine
      await db.query('UPDATE vaccines SET is_active = false WHERE id = $1', [vaccine.id]);
      stats.migrated.push({ ...vaccine, target: migrationTarget });
      console.log(`  ✓ MIGRATED to ${migrationTarget}`);
    } else {
      // Check for dependencies
      const deps = await checkDependencies(vaccine.id);
      const totalDeps = Object.values(deps).reduce((a, b) => a + b, 0);

      if (totalDeps > 0) {
        // Has dependencies - archive instead of delete
        console.log(`  Has ${totalDeps} dependent records, archiving...`);
        console.log('  Dependencies:', JSON.stringify(deps, null, 4));
        await db.query('UPDATE vaccines SET is_active = false WHERE id = $1', [vaccine.id]);
        stats.archived.push(vaccine);
        console.log('  ✓ ARCHIVED (has dependencies)');
      } else {
        // No dependencies - safe to remove
        console.log('  No dependencies, removing...');
        await db.query('DELETE FROM vaccines WHERE id = $1', [vaccine.id]);
        stats.removed.push(vaccine);
        console.log('  ✓ REMOVED');
      }
    }
  }

  console.log('\n=== CLEANUP SUMMARY ===\n');
  console.log(`Vaccines KEPT (approved): ${stats.kept.length}`);
  stats.kept.forEach(v => console.log(`  - ${v.name} [${v.code}]`));

  console.log(`\nVaccines MIGRATED: ${stats.migrated.length}`);
  stats.migrated.forEach(v => console.log(`  - ${v.name} -> ${v.target}`));

  console.log(`\nVaccines ARCHIVED (inactivated): ${stats.archived.length}`);
  stats.archived.forEach(v => console.log(`  - ${v.name} [${v.code}]`));

  console.log(`\nVaccines REMOVED (hard deleted): ${stats.removed.length}`);
  stats.removed.forEach(v => console.log(`  - ${v.name} [${v.code}]`));

  console.log(`\nName fixes applied: ${stats.nameFixed.length}`);
  stats.nameFixed.forEach(f => console.log(`  - "${f.old}" -> "${f.new}"`));

  // Verify final state matches approved list exactly
  console.log('\n=== VERIFICATION ===\n');
  const finalResult = await db.query('SELECT id, name, code, is_active FROM vaccines ORDER BY is_active DESC, name');
  const activeVaccines = finalResult.rows.filter(v => v.is_active);

  console.log(`Total vaccines: ${finalResult.rows.length}`);
  console.log(`Active vaccines: ${activeVaccines.length}`);
  console.log(`Inactive vaccines: ${finalResult.rows.length - activeVaccines.length}\n`);

  console.log('Active vaccines:');
  let allApproved = true;
  activeVaccines.forEach(v => {
    const isInList = APPROVED_VACCINES_EXACT.includes(v.name);
    const status = isInList ? '✓ APPROVED' : '✗ NOT APPROVED';
    if (!isInList) {
      allApproved = false;
    }
    console.log(`  ${v.id}: ${v.name} [${v.code}] - ${status}`);
  });

  // Check if we have exactly the approved vaccines
  const activeNames = activeVaccines.map(v => v.name).sort();
  const approvedNamesSorted = APPROVED_VACCINES_EXACT.slice().sort();

  console.log(`\nApproval check: ${allApproved && activeNames.length === approvedNamesSorted.length &&
    JSON.stringify(activeNames) === JSON.stringify(approvedNamesSorted) ? '✓ PASS' : '✗ FAIL'}`);

  if (!allApproved) {
    console.log('Non-approved active vaccines:');
    activeVaccines.filter(v => !APPROVED_VACCINES_EXACT.includes(v.name))
      .forEach(v => console.log(`  - ${v.name}`));
  }

  if (activeNames.length !== approvedNamesSorted.length) {
    console.log(`Count mismatch: ${activeNames.length} active vs ${approvedNamesSorted.length} approved`);
    if (activeNames.length > approvedNamesSorted.length) {
      console.log('Extra active vaccines:');
      activeNames.filter(name => !approvedNamesSorted.includes(name))
        .forEach(name => console.log(`  - ${name}`));
    } else {
      console.log('Missing approved vaccines:');
      approvedNamesSorted.filter(name => !activeNames.includes(name))
        .forEach(name => console.log(`  - ${name}`));
    }
  }

  await db.end();
  console.log('\n✓ Cleanup complete!');

  return stats;
}

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

// Run cleanup if called directly
if (require.main === module) {
  cleanupVaccines().catch(e => {
    console.error('Cleanup failed:', e);
    process.exit(1);
  });
}

module.exports = { cleanupVaccines };
