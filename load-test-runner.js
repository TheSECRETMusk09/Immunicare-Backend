/**
 * Load Test Runner - Main execution script for all load tests
 *
 * Usage:
 *   node load-test-runner.js                    # Run all tests
 *   node load-test-runner.js --load             # Run load test only
 *   node load-test-runner.js --stress           # Run stress test only
 *   node load-test-runner.js --spike            # Run spike test only
 *   node load-test-runner.js --endurance        # Run endurance test only
 *   node load-test-runner.js --scalability      # Run scalability test only
 *   node load-test-runner.js --volume           # Run volume test only
 *   node load-test-runner.js --custom           # Run custom test
 *   node load-test-runner.js --report           # Generate report from previous results
 *
 * For 100K users and 10M transactions:
 *   node load-test-runner.js --scalability      # Tests up to 100K users
 *   node load-test-runner.js --volume           # Tests 10M transactions
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./load-test-config');

// Parse command line arguments
const args = process.argv.slice(2);
const testType = args.find((arg) => arg.startsWith('--'))?.replace('--', '') || 'all';

// Results directory
const resultsDir = path.join(__dirname, config.resultsDir);
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
}

// Test start time
const testStartTime = new Date();

/**
 * Execute a loadtest command
 */
function runLoadTest(testConfig, testName, options = {}) {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(resultsDir, `${testName}-${timestamp}.json`);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting: ${testConfig.name}`);
    console.log(`Description: ${testConfig.description}`);
    console.log(`${'='.repeat(60)}`);

    const args = [
      '-n',
      String(testConfig.totalRequests || testConfig.duration * 100),
      '-c',
      String(testConfig.concurrency || 100),
      '-p',
      String(options.pipeline || 1),
      '-T',
      '30000', // 30 second timeout
      '--uploads',
      '0',
      '--quiet',
      '-o',
      outputFile,
    ];

    // Add custom headers if provided
    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        args.push('-H', `${key}: ${value}`);
      });
    }

    // Add cookies if provided
    if (options.cookies) {
      Object.entries(options.cookies).forEach(([key, value]) => {
        args.push('-c', `${key}=${value}`);
      });
    }

    // Add method and body for POST requests
    if (options.method === 'POST' && options.body) {
      args.push('-m', 'POST');
      args.push('-T', 'application/json');
      args.push('-d', JSON.stringify(options.body));
    }

    args.push(config.baseUrl + (options.path || '/api/health'));

    console.log(`Command: loadtest ${args.join(' ')}`);
    console.log(`Output: ${outputFile}`);

    const loadtest = spawn('npx', ['loadtest', ...args], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
    });

    loadtest.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✓ ${testName} completed successfully`);
        resolve({ success: true, outputFile });
      } else {
        console.error(`\n✗ ${testName} failed with code ${code}`);
        reject(new Error(`Load test failed with code ${code}`));
      }
    });

    loadtest.on('error', (err) => {
      console.error(`\n✗ ${testName} error:`, err.message);
      reject(err);
    });
  });
}

/**
 * Run custom load test with multiple endpoints
 */
async function runCustomTest(testConfig, testName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting Custom Load Test: ${testName}`);
  console.log(`${'='.repeat(60)}`);

  const results = [];
  new Date().toISOString().replace(/[:.]/g, '-');

  // Run tests for each endpoint based on weight
  for (const endpoint of testConfig.endpoints) {
    console.log(`\nTesting: ${endpoint.method} ${endpoint.path}`);

    try {
      const result = await runLoadTest(
        {
          ...testConfig,
          name: `${testName} - ${endpoint.method} ${endpoint.path}`,
          totalRequests: Math.floor((testConfig.totalRequests || 100000) * (endpoint.weight / 100)),
          concurrency: testConfig.concurrency || 100,
        },
        `${testName}-${endpoint.method}-${endpoint.path.replace(/\//g, '_')}`,
        {
          path: endpoint.path,
          method: endpoint.method,
        }
      );
      results.push(result);
    } catch (err) {
      console.error(`Failed for endpoint ${endpoint.path}:`, err.message);
    }
  }

  return results;
}

/**
 * Run stress test with gradual load increase
 */
async function runStressTest(stressConfig) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting Stress Test: ${stressConfig.name}`);
  console.log(`${'='.repeat(60)}`);

  new Date().toISOString().replace(/[:.]/g, '-');
  const phases = [];

  // Calculate total duration
  const totalDuration = stressConfig.rampUpTime + stressConfig.sustainTime;
  const steps = Math.ceil(
    (stressConfig.maxUsers - stressConfig.initialUsers) / stressConfig.stepSize
  );

  console.log(`Initial Users: ${stressConfig.initialUsers}`);
  console.log(`Max Users: ${stressConfig.maxUsers}`);
  console.log(`Ramp-up Time: ${stressConfig.rampUpTime}s`);
  console.log(`Sustain Time: ${stressConfig.sustainTime}s`);
  console.log(`Total Steps: ${steps}`);
  console.log(`Estimated Duration: ${Math.round(totalDuration / 60)} minutes`);

  let currentUsers = stressConfig.initialUsers;

  for (let i = 0; i < steps; i++) {
    const phaseName = `Stress-Phase-${i + 1}`;
    console.log(`\n--- Phase ${i + 1}/${steps}: ${currentUsers} users ---`);

    const phaseConfig = {
      name: phaseName,
      description: `Stress test phase ${i + 1} with ${currentUsers} users`,
      duration: Math.floor(stressConfig.rampUpTime / steps),
      concurrency: currentUsers,
      totalRequests: currentUsers * 100,
    };

    try {
      const result = await runCustomTest(phaseConfig, phaseName);
      phases.push({
        users: currentUsers,
        result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`Phase ${i + 1} failed:`, err.message);
    }

    currentUsers = Math.min(currentUsers + stressConfig.stepSize, stressConfig.maxUsers);
  }

  // Final sustain phase at max capacity
  console.log(`\n--- Final Phase: ${stressConfig.maxUsers} users (Sustain) ---`);

  const sustainConfig = {
    name: 'Stress-Sustain-Max',
    description: `Sustained load test at maximum ${stressConfig.maxUsers} users`,
    duration: stressConfig.sustainTime,
    concurrency: stressConfig.maxUsers,
    totalRequests: stressConfig.maxUsers * 100,
  };

  await runCustomTest(sustainConfig, 'Stress-Sustain-Max');

  return phases;
}

/**
 * Run spike test with sudden traffic increases
 */
async function runSpikeTest(spikeConfig) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting Spike Test: ${spikeConfig.name}`);
  console.log(`${'='.repeat(60)}`);

  const results = [];

  for (let i = 0; i < spikeConfig.spikes; i++) {
    const spikeNum = i + 1;
    console.log(`\n--- Spike ${spikeNum}/${spikeConfig.spikes} ---`);

    // Baseline phase
    console.log(`Phase 1: Baseline with ${spikeConfig.baselineUsers} users`);
    await new Promise((resolve) => setTimeout(resolve, 30000)); // 30s baseline

    // Spike phase
    console.log(`Phase 2: SPIKE to ${spikeConfig.spikeUsers} users`);
    const spikeConfigRun = {
      name: `Spike-${spikeNum}`,
      description: `Spike test ${spikeNum}`,
      duration: spikeConfig.spikeDuration,
      concurrency: spikeConfig.spikeUsers,
      totalRequests: spikeConfig.spikeUsers * 50,
    };

    await runCustomTest(spikeConfigRun, `Spike-${spikeNum}`);

    // Recovery phase
    console.log(`Phase 3: Recovery back to ${spikeConfig.baselineUsers} users`);
    await new Promise((resolve) => setTimeout(resolve, spikeConfig.recoveryTime * 1000));

    results.push({ spikeNum, timestamp: new Date().toISOString() });
  }

  return results;
}

/**
 * Run scalability test - 100K users target
 */
async function runScalabilityTest(scalabilityConfig) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting Scalability Test: ${scalabilityConfig.name}`);
  console.log('Target: 100,000 concurrent users');
  console.log(`${'='.repeat(60)}`);

  const results = [];

  for (const phase of scalabilityConfig.phases) {
    console.log(`\n--- ${phase.name} ---`);
    console.log(`Users: ${phase.users}, Duration: ${phase.duration}s`);

    const phaseConfig = {
      name: phase.name,
      description: `Scalability test - ${phase.name}`,
      duration: phase.duration,
      concurrency: phase.users,
      totalRequests: phase.users * 100,
    };

    try {
      const result = await runCustomTest(phaseConfig, phase.name.replace(/\s+/g, '-'));
      results.push({
        phase: phase.name,
        users: phase.users,
        result,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error(`Phase ${phase.name} failed:`, err.message);
    }
  }

  return results;
}

/**
 * Run volume test - 10M transactions
 */
async function runVolumeTest(volumeConfig) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Starting Volume Test: ${volumeConfig.name}`);
  console.log(`Target: ${volumeConfig.targetTransactions.toLocaleString()} transactions`);
  console.log(`${'='.repeat(60)}`);

  // Calculate required RPS to meet target
  const targetRPS = Math.ceil(volumeConfig.targetTransactions / volumeConfig.estimatedDuration);
  console.log(`Required RPS: ${targetRPS.toLocaleString()}`);
  console.log(`Estimated Duration: ${Math.round(volumeConfig.estimatedDuration / 60)} minutes`);

  const results = [];

  // Run transactions based on distribution
  for (const transaction of volumeConfig.transactions) {
    const txRequests = Math.floor(volumeConfig.targetTransactions * (transaction.weight / 100));
    console.log(`\nTesting ${transaction.type}: ${txRequests.toLocaleString()} requests`);

    const txConfig = {
      name: `Volume-${transaction.type}`,
      description: `Volume test - ${transaction.type}`,
      duration: Math.ceil(txRequests / (targetRPS / volumeConfig.transactions.length)),
      concurrency: volumeConfig.concurrentWriters,
      totalRequests: txRequests,
    };

    try {
      const result = await runLoadTest(txConfig, `Volume-${transaction.type}`, {
        path: getEndpointForTransaction(transaction.type),
      });
      results.push(result);
    } catch (err) {
      console.error(`Transaction ${transaction.type} failed:`, err.message);
    }
  }

  return results;
}

/**
 * Map transaction types to API endpoints
 */
function getEndpointForTransaction(type) {
  const mapping = {
    login: '/api/auth/login',
    read_infant: '/api/infants',
    read_vaccination: '/api/vaccinations',
    create_appointment: '/api/appointments',
    update_inventory: '/api/inventory',
    record_vaccination: '/api/vaccinations',
    send_notification: '/api/notifications',
    update_dashboard: '/api/dashboard/stats',
  };
  return mapping[type] || '/api/health';
}

/**
 * Generate summary report
 */
function generateReport(testResults, testType) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = path.join(resultsDir, `report-${testType}-${timestamp}.html`);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Load Test Report - ${testType}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { color: #333; border-bottom: 3px solid #007bff; padding-bottom: 10px; }
    h2 { color: #555; margin-top: 30px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
    .metric { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
    .metric-value { font-size: 32px; font-weight: bold; color: #007bff; }
    .metric-label { color: #666; margin-top: 5px; }
    .status-pass { color: #28a745; }
    .status-fail { color: #dc3545; }
    .status-warn { color: #ffc107; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #007bff; color: white; }
    tr:hover { background: #f5f5f5; }
    .timestamp { color: #999; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Load Test Report</h1>
    <p class="timestamp">Test Type: ${testType}</p>
    <p class="timestamp">Generated: ${new Date().toISOString()}</p>
    <p class="timestamp">Test Start: ${testStartTime.toISOString()}</p>
    
    <h2>Summary</h2>
    <div class="summary">
      <div class="metric">
        <div class="metric-value">100K</div>
        <div class="metric-label">Target Users</div>
      </div>
      <div class="metric">
        <div class="metric-value">10M</div>
        <div class="metric-label">Target Transactions</div>
      </div>
      <div class="metric">
        <div class="metric-value">${config.baseUrl}</div>
        <div class="metric-label">Test URL</div>
      </div>
    </div>
    
    <h2>Test Configuration</h2>
    <table>
      <tr><th>Parameter</th><th>Value</th></tr>
      <tr><td>Test Type</td><td>${testType}</td></tr>
      <tr><td>Base URL</td><td>${config.baseUrl}</td></tr>
      <tr><td>Results Directory</td><td>${resultsDir}</td></tr>
    </table>
    
    <h2>Recommendations</h2>
    <ul>
      <li>Monitor server CPU and memory usage during tests</li>
      <li>Check database connection pool settings</li>
      <li>Review slow queries in database logs</li>
      <li>Consider horizontal scaling if needed</li>
      <li>Implement caching for frequently accessed data</li>
    </ul>
  </div>
</body>
</html>
`;

  fs.writeFileSync(reportFile, html);
  console.log(`\n📊 Report generated: ${reportFile}`);

  return reportFile;
}

/**
 * Main execution
 */
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   Immunicare Load & Stress Testing System                   ║
║   Target: 100,000 Users | 10,000,000 Transactions           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);

  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Results Directory: ${resultsDir}`);
  console.log(`Test Type: ${testType}`);

  try {
    let results;

    switch (testType) {
      case 'load':
        console.log('\n▶ Running Load Test...');
        results = await runCustomTest(config.loadTest, 'LoadTest');
        break;

      case 'stress':
        console.log('\n▶ Running Stress Test...');
        results = await runStressTest(config.stressTest);
        break;

      case 'spike':
        console.log('\n▶ Running Spike Test...');
        results = await runSpikeTest(config.spikeTest);
        break;

      case 'endurance':
        console.log('\n▶ Running Endurance Test...');
        results = await runCustomTest(config.enduranceTest, 'EnduranceTest');
        break;

      case 'scalability':
        console.log('\n▶ Running Scalability Test (100K Users)...');
        results = await runScalabilityTest(config.scalabilityTest);
        break;

      case 'volume':
        console.log('\n▶ Running Volume Test (10M Transactions)...');
        results = await runVolumeTest(config.volumeTest);
        break;

      case 'custom':
        console.log('\n▶ Running Custom Test...');
        results = await runCustomTest(config.loadTest, 'CustomTest');
        break;

      case 'report':
        console.log('\n▶ Generating Report...');
        generateReport(null, 'all');
        return;

      case 'all':
      default:
        console.log('\n▶ Running All Tests (Sequentially)...');

        console.log('\n\n*** Phase 1: Load Test ***');
        await runCustomTest(config.loadTest, 'LoadTest');

        console.log('\n\n*** Phase 2: Scalability Test (100K Users) ***');
        await runScalabilityTest(config.scalabilityTest);

        console.log('\n\n*** Phase 3: Volume Test (10M Transactions) ***');
        await runVolumeTest(config.volumeTest);

        console.log('\n\n*** Phase 4: Stress Test ***');
        results = await runStressTest(config.stressTest);

        console.log('\n\n*** Phase 5: Spike Test ***');
        await runSpikeTest(config.spikeTest);

        break;
    }

    // Generate report
    if (results || testType !== 'report') {
      generateReport(results, testType);
    }

    console.log('\n✅ All tests completed!');
    console.log(`Results saved to: ${resultsDir}`);
  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  runLoadTest,
  runCustomTest,
  runStressTest,
  runSpikeTest,
  runScalabilityTest,
  runVolumeTest,
  generateReport,
};
