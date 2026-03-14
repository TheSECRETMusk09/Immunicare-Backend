/**
 * Corrected Vaccine Inventory Cleanup Script
 * Ensures vaccine inventory matches exactly the approved list for infant immunization
 *
 * Approved vaccines (exact matches required):
 * - BCG
 * - BCG, Diluent
 * - Hepa B
 * - Penta Valent
 * - OPV 20-doses
 * - PCV 13/PCV 10
 * - Measles & Rubella (P) [Note: Using (MR) as seen in actual data since (P) appears to be typo]
 * - MMR
 * - MMR, Diluent 5ml
 * - IPV multi dose
 */

const db = require('./db');

// Exact approved vaccine names (as provided in the task)
const APPROVED_VACCINES_EXACT = [
  'BCG',
  'BCG, Diluent',
  'Hepa B',
  'Penta Valent',
  'OPV 20-doses',
  'PCV 13/PCV 10',
  'Measles & Rubella (P)',  // From task spec, though data shows (MR)
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

// Create a map from normalized approved name to exact approved name
const NORMALIZED_TO_EXACT = new Map();
APPROVED_VACCINES_EXACT.forEach(name => {
  NORMALIZED_TO_EXACT.set(normalizeName(name), name);
});

// Specific mappings for known variants to their approved equivalents
const VACCINE_VARIANT_MAPPINGS = {
  // Hepatitis B variants
  'HEPATITIS B': 'HEPA B',

  // Polio variants
  'ORAL POLIO VACCINE': 'OPV 20-DOSES',
  'INACTIVATED POLIO VACCINE': 'IPV MULTI DOSE',

  // Pentavalent variants
  'PENTAVALENT (DPT-HEPB-HIB)': 'PENTA VALENT',

  // PCV variants
  'PNEUMOCOCCAL CONJUGATE VACCINE': 'PCV 13/PCV 10',
  'PCV 13 / PCV 10': 'PCV 13/PCV 10',  // Handle spacing around slash

  // MMR variants
  'MEASLES-MUMPS-RUBELLA': 'MEASLES & RUBELLA (P)',  // Map to approved form
  'MEASLES-MUMPS-RUBELLA (MMR)': 'MEASLES & RUBELLA (P)',

  // Additional variants that might appear
  'HEPATITIS B VACCINE': 'HEPA B',
};

async function cleanupVaccines() {
  console.log('=== CORRECTED VACCINE INVENTORY CLEANUP ===\n');

  // Get all vaccines
  const result = await db.query('SELECT id, name, code, is_active FROM vaccines ORDER BY id');
  const allVaccines = result.rows;

  console.log(`Found ${allVaccines.length} vaccines in database\n`);

  const stats = {
    kept: [],
    updatedName: [],
    archived: [],
    removed: [],
  };

  for (const vaccine of allVaccines) {
    const normalizedName = normalizeName(vaccine.name);
    const exactApprovedMatch = APPROVED_VACCINES_EXACT.includes(vaccine.name);
    const normalizedApprovedMatch = APPROVED_NORMALIZED.includes(normalizedName);
    const variantMapping = VACCINE_VARIANT_MAPPINGS[normalizedName];

    console.log(`\nProcessing: ${vaccine.name} [${vaccine.code}] (ID: ${vaccine.id})`);
    console.log(`  Normalized: ${normalizedName}`);
    console.log(`  Exactly approved: ${exactApprovedMatch}`);
    console.log(`  Normalized approved: ${normalizedApprovedMatch}`);
    if (variantMapping) {
      console.log(`  Has variant mapping to: ${variantMapping}`);
    }

    if (exactApprovedMatch) {
      // Already exactly correct
      await db.query('UPDATE vaccines SET is_active = true WHERE id = $1', [vaccine.id]);
      stats.kept.push(vaccine);
      console.log('  ✓ KEPT (exactly approved)');
    } else if (normalizedApprovedMatch) {
      // Needs name formatting to match exact approved version
      const exactName = NORMALIZED_TO_EXACT.get(normalizedName);
      if (exactName && vaccine.name !== exactName) {
        await db.query('UPDATE vaccines SET name = $1 WHERE id = $2', [exactName, vaccine.id]);
        stats.updatedName.push({ id: vaccine.id, old: vaccine.name, new: exactName });
        console.log(`  ✓ Name updated: "${vaccine.name}" -> "${exactName}"`);
      }
      await db.query('UPDATE vaccines SET is_active = true WHERE id = $1', [vaccine.id]);
      stats.kept.push(vaccine);
      console.log('  ✓ KEPT (approved after normalization)');
    } else if (variantMapping) {
      // Can be mapped to an approved vaccine via known variant
      const exactApprovedName = NORMALIZED_TO_EXACT.get(normalizeName(variantMapping));
      if (exactApprovedName) {
        console.log(`  → Mapping to approved name: ${exactApprovedName}`);

        // Update this vaccine's name to the approved version
        await db.query('UPDATE vaccines SET name = $1 WHERE id = $2', [exactApprovedName, vaccine.id]);
        stats.updatedName.push({ id: vaccine.id, old: vaccine.name, new: exactApprovedName });
        console.log(`  ✓ Name updated: "${vaccine.name}" -> "${exactApprovedName}"`);

        await db.query('UPDATE vaccines SET is_active = true WHERE id = $1', [vaccine.id]);
        stats.kept.push(vaccine);
        console.log('  ✓ KEPT (mapped to approved)');
      } else {
        console.log(`  ⚠ Could not find exact approved name for variant: ${variantMapping}`);
        // Fall back to treating as unapproved
        const deps = await checkDependencies(vaccine.id);
        const totalDeps = Object.values(deps).reduce((a, b) => a + b, 0);

        if (totalDeps > 0) {
          await db.query('UPDATE vaccines SET is_active = false WHERE id = $1', [vaccine.id]);
          stats.archived.push(vaccine);
          console.log('  ✓ ARCHIVED (has dependencies)');
        } else {
          await db.query('DELETE FROM vaccines WHERE id = $1', [vaccine.id]);
          stats.removed.push(vaccine);
          console.log('  ✓ REMOVED');
        }
      }
    } else {
      // Not approved and no known mapping - check dependencies
      const deps = await checkDependencies(vaccine.id);
      const totalDeps = Object.values(deps).reduce((a, b) => a + b, 0);

      if (totalDeps > 0) {
        // Has dependencies - archive instead of delete
        console.log(`  Has ${totalDeps} dependent records, archiving...`);
        console.log('  Dependencies:', JSON.stringify(deps, null, 2));
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

  console.log(`\nVaccines with NAME UPDATED: ${stats.updatedName.length}`);
  stats.updatedName.forEach(v => console.log(`  - ${v.old} -> ${v.new}`));

  console.log(`\nVaccines ARCHIVED (inactivated): ${stats.archived.length}`);
  stats.archived.forEach(v => console.log(`  - ${v.name} [${v.code}]`));

  console.log(`\nVaccines REMOVED (hard deleted): ${stats.removed.length}`);
  stats.removed.forEach(v => console.log(`  - ${v.name} [${v.code}]`));

  // Verify final state
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

// Run cleanup if called directly
if (require.main === module) {
  cleanupVaccines().catch(e => {
    console.error('Cleanup failed:', e);
    process.exit(1);
  });
}

module.exports = { cleanupVaccines };
