/**
 * Runs all backend tests from a single command while preserving Jest compatibility.
 * 1) Executes existing Jest suites
 * 2) Executes consolidated system test hub
 */

const { spawnSync } = require('child_process');
const path = require('path');

function execNodeScript(scriptPath) {
  return spawnSync(process.execPath, [scriptPath], {
    stdio: 'inherit',
    env: process.env,
    cwd: path.join(__dirname, '..'),
  });
}

function execNpm(command, args = []) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return spawnSync(npmCmd, [command, ...args], {
    stdio: 'inherit',
    env: process.env,
    cwd: path.join(__dirname, '..'),
  });
}

function runAll() {
  console.log('==============================================');
  console.log('IMMUNICARE BACKEND TEST RUNNER (ALL)');
  console.log('==============================================');

  console.log('\n[1/2] Running Jest suites...');
  const jestResult = execNpm('run', ['test']);
  if (jestResult.status !== 0) {
    process.exit(jestResult.status || 1);
  }

  console.log('\n[2/2] Running system test hub...');
  const systemResult = execNodeScript(path.join(__dirname, 'system', 'index.js'));
  if (systemResult.status !== 0) {
    process.exit(systemResult.status || 1);
  }

  console.log('\n✔ All backend tests completed successfully');
}

runAll();
