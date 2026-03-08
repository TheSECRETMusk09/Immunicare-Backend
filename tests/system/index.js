/**
 * Consolidated backend system test entrypoint.
 * Runs curated non-Jest system/integration scripts in deterministic order.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const testScripts = [
  'comprehensive_api_test.js',
  'comprehensive_system_test.js',
  'comprehensive_functional_test.js',
  'comprehensive_e2e_test.js',
  'check_vaccine_waitlist_table.js',
];

function run() {
  console.log('==============================================');
  console.log('IMMUNICARE BACKEND SYSTEM TEST HUB');
  console.log('==============================================');

  let failed = 0;

  for (const script of testScripts) {
    const scriptPath = path.join(__dirname, script);
    console.log(`\n▶ Running ${script} ...`);

    const result = spawnSync(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: process.env,
      cwd: path.join(__dirname, '..', '..'),
    });

    if (result.status !== 0) {
      failed += 1;
      console.error(`✖ ${script} failed with exit code ${result.status}`);
    } else {
      console.log(`✔ ${script} passed`);
    }
  }

  console.log('\n==============================================');
  console.log(`SYSTEM TEST HUB COMPLETE: ${testScripts.length - failed} passed, ${failed} failed`);
  console.log('==============================================');

  process.exit(failed > 0 ? 1 : 0);
}

run();
