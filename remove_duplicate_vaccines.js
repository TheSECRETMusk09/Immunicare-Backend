/**
 * Remove duplicate vaccines (keep non-SYNPH26 versions, deactivate SYNPH26 versions)
 * for the approved vaccine list.
 */

const db = require('./db');

const APPROVED_VACCINES = [
  'BCG',
  'BCG, Diluent',
  'Hepa B',
  'Penta Valent',
  'OPV 20-doses',
  'PCV 13/PCV 10',
  'Measles & Rubella (P)',
  'MMR',
  'MMR, Diluent 5ml',
  'IPV multi dose',
];

async function removeDuplicates() {
  console.log('=== REMOVING DUPLICATE VACCINES ===\n');

  // Get all active vaccines
  const result = await db.query('SELECT id, name, code, is_active FROM vaccines WHERE is_active = true');
  const activeVaccines = result.rows;

  console.log(`Currently active vaccines: ${activeVaccines.length}\n`);

  // We'll keep the non-SYNPH26 version for each approved vaccine
  const toDeactivate = [];

  for (const vaccine of activeVaccines) {
    // Check if this is a SYNPH26 version (code starts with SYNPH26)
    const isSynph26 = vaccine.code.startsWith('SYNPH26');

    // Check if the name is in the approved list
    const isApproved = APPROVED_VACCINES.includes(vaccine.name);

    if (isSynph26 && isApproved) {
      // This is a SYNPH26 version of an approved vaccine - we'll deactivate it
      // but only if there is also a non-SYNPH26 version active
      const nonSynphVersion = activeVaccines.find(v =>
        !v.code.startsWith('SYNPH26') &&
        v.name === vaccine.name,
      );

      if (nonSynphVersion) {
        toDeactivate.push(vaccine);
        console.log(`Marking for deactivation: ${vaccine.name} [${vaccine.code}] (SYNPH26 version)`);
      } else {
        // If there's no non-SYNPH26 version, we have to keep this one
        console.log(`Keeping SYNPH26 version (no non-SYNPH26 alternative): ${vaccine.name} [${vaccine.code}]`);
      }
    }
  }

  console.log(`\nFound ${toDeactivate.length} SYNPH26 duplicate vaccines to deactivate\n`);

  // Deactivate the duplicates
  for (const vaccine of toDeactivate) {
    await db.query('UPDATE vaccines SET is_active = false WHERE id = $1', [vaccine.id]);
    console.log(`Deactivated: ${vaccine.name} [${vaccine.code}]`);
  }

  // Final verification
  console.log('\n=== FINAL VERIFICATION ===\n');
  const finalResult = await db.query('SELECT id, name, code, is_active FROM vaccines ORDER BY is_active DESC, name');
  const finalVaccines = finalResult.rows;
  const activeFinal = finalVaccines.filter(v => v.is_active);

  console.log(`Total vaccines: ${finalVaccines.length}`);
  console.log(`Active vaccines: ${activeFinal.length}`);
  console.log(`Inactive vaccines: ${finalVaccines.length - activeFinal.length}\n`);

  console.log('Active vaccines:');
  let allApproved = true;
  for (const vaccine of activeFinal) {
    const isInApprovedList = APPROVED_VACCINES.includes(vaccine.name);
    const status = isInApprovedList ? '✓ APPROVED' : '✗ NOT APPROVED';
    if (!isInApprovedList) {
      allApproved = false;
    }
    console.log(`  ${vaccine.id}: ${vaccine.name} [${vaccine.code}] - ${status}`);
  }

  // Check if we have exactly the approved vaccines
  const activeNames = activeFinal.map(v => v.name).sort();
  const approvedNamesSorted = [...APPROVED_VACCINES].sort();

  console.log('\nVerification:');
  console.log(`  All active vaccines are approved: ${allApproved ? '✓ YES' : '✗ NO'}`);
  console.log(`  Active vaccine count: ${activeFinal.length} (expected: ${APPROVED_VACCINES.length})`);

  if (!allApproved) {
    console.log('  Non-approved active vaccines:');
    activeFinal.filter(v => !APPROVED_VACCINES.includes(v.name))
      .forEach(v => console.log(`    - ${v.name}`));
  }

  if (activeFinal.length !== APPROVED_VACCINES.length) {
    console.log('  Count mismatch!');

    // Find missing approved vaccines
    const activeNormalized = new Set(activeFinal.map(v => v.name));
    const expectedNormalized = new Set(APPROVED_VACCINES);

    const missing = APPROVED_VACCINES.filter(v => !activeNormalized.has(v));
    const extra = activeFinal.filter(v => !expectedNormalized.has(v.name));

    if (missing.length > 0) {
      console.log('  Missing approved vaccines:');
      missing.forEach(v => console.log(`    - ${v}`));
    }
    if (extra.length > 0) {
      console.log('  Extra active vaccines:');
      extra.forEach(v => console.log(`    - ${v.name}`));
    }
  }

  const success = allApproved && activeFinal.length === APPROVED_VACCINES.length;
  console.log(`\nOverall result: ${success ? '✓ SUCCESS' : '✗ FAILED'}`);

  await db.end();
  return success;
}

// Run cleanup if called directly
if (require.main === module) {
  removeDuplicates()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(e => {
      console.error('Cleanup failed:', e);
      process.exit(1);
    });
}

module.exports = { removeDuplicates };
