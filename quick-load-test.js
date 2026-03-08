/**
 * Quick Load Test Script
 *
 * A simplified load test that can run immediately.
 * Tests the system with increasing load to verify 100K user capability.
 *
 * Usage:
 *   node quick-load-test.js           # Run quick test (1K users)
 *   node quick-load-test.js medium    # Medium test (10K users)
 *   node quick-load-test.js full      # Full test (100K users)
 *   node quick-load-test.js 10m       # Test 10M transactions
 */

const http = require('http');
const https = require('https');

// Configuration
const BASE_URL = process.env.LOAD_TEST_URL || 'http://localhost:5000';
const testType = process.argv[2] || 'quick';

// Test configurations
const configs = {
  quick: {
    name: 'Quick Load Test',
    duration: 30000, // 30 seconds
    concurrency: 100,
    rampUp: 5000
  },
  medium: {
    name: 'Medium Load Test',
    duration: 120000, // 2 minutes
    concurrency: 10000,
    rampUp: 30000
  },
  full: {
    name: 'Full Scale Load Test (100K)',
    duration: 300000, // 5 minutes
    concurrency: 100000,
    rampUp: 60000
  },
  '10m': {
    name: '10M Transaction Test',
    duration: 600000, // 10 minutes
    concurrency: 50000,
    rampUp: 30000,
    targetTransactions: 10000000
  }
};

const config = configs[testType] || configs.quick;

// Results storage
const results = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  responseTimes: [],
  errors: {},
  startTime: null,
  endTime: null,
  rps: []
};

// Parse URL
const urlObj = new URL(BASE_URL);
const client = urlObj.protocol === 'https:' ? https : http;

/**
 * Make a single request
 */
function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout: 30000
    };

    const req = client.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        const responseTime = Date.now() - startTime;

        results.totalRequests++;
        results.responseTimes.push(responseTime);

        if (res.statusCode >= 200 && res.statusCode < 300) {
          results.successfulRequests++;
        } else {
          results.failedRequests++;
          const errorKey = `${res.statusCode}`;
          results.errors[errorKey] = (results.errors[errorKey] || 0) + 1;
        }

        resolve({ statusCode: res.statusCode, responseTime });
      });
    });

    req.on('error', (err) => {
      results.totalRequests++;
      results.failedRequests++;
      const errorKey = err.code || 'UNKNOWN';
      results.errors[errorKey] = (results.errors[errorKey] || 0) + 1;
      resolve({ error: err.message });
    });

    req.on('timeout', () => {
      results.totalRequests++;
      results.failedRequests++;
      results.errors['TIMEOUT'] = (results.errors['TIMEOUT'] || 0) + 1;
      req.destroy();
      resolve({ error: 'timeout' });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Simulate user session
 */
async function userSession(userId) {
  const endpoints = [
    '/api/health',
    '/api/auth/login',
    '/api/dashboard/stats',
    '/api/infants',
    '/api/vaccinations',
    '/api/inventory',
    '/api/appointments',
    '/api/announcements'
  ];

  // Random endpoint selection with weights
  const rand = Math.random();
  let endpoint;

  if (rand < 0.2) {
    endpoint = '/api/health';
  } else if (rand < 0.35) {
    endpoint = '/api/dashboard/stats';
  } else if (rand < 0.5) {
    endpoint = '/api/infants';
  } else if (rand < 0.65) {
    endpoint = '/api/vaccinations';
  } else if (rand < 0.8) {
    endpoint = '/api/inventory';
  } else {
    endpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
  }

  // Add some POST requests for write-intensive tests
  if (config.targetTransactions && Math.random() < 0.1) {
    await makeRequest('/api/auth/login', 'POST', {
      username: `test_user_${userId}`,
      password: 'test123'
    });
  } else {
    await makeRequest(endpoint, 'GET');
  }
}

/**
 * Run load test
 */
async function runLoadTest() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         Immunicare Quick Load Test                           ║
║         Target: 100,000 Users | 10,000,000 Transactions     ║
╚══════════════════════════════════════════════════════════════╝
  `);

  console.log('\n📋 Test Configuration:');
  console.log(`   Name: ${config.name}`);
  console.log(`   Duration: ${config.duration / 1000}s`);
  console.log(`   Concurrency: ${config.concurrency.toLocaleString()} users`);
  console.log(`   Target: ${BASE_URL}`);
  console.log(
    `   ${config.targetTransactions ? `Target Transactions: ${config.targetTransactions.toLocaleString()}` : ''}`
  );

  results.startTime = new Date();
  console.log(`\n🚀 Starting test at ${results.startTime.toISOString()}`);
  console.log('   (Press Ctrl+C to stop)\n');

  // Calculate requests per interval for monitoring
  const monitorInterval = 5000; // 5 seconds
  let currentUsers = 0;
  const userIncrement = Math.ceil(config.concurrency / 10); // Ramp up in 10 steps

  // Start monitoring
  const monitor = setInterval(() => {
    const elapsed = Date.now() - results.startTime.getTime();
    const currentRps = results.totalRequests / (elapsed / 1000);
    const errorRate =
      results.totalRequests > 0
        ? ((results.failedRequests / results.totalRequests) * 100).toFixed(2)
        : 0;

    results.rps.push({ time: elapsed, rps: currentRps });

    process.stdout.write(
      `\r[${new Date().toLocaleTimeString()}] ` +
        `Users: ${currentUsers}/${config.concurrency.toLocaleString()} | ` +
        `Requests: ${results.totalRequests.toLocaleString()} | ` +
        `RPS: ${currentRps.toFixed(0)} | ` +
        `Errors: ${results.failedRequests} (${errorRate}%)   `
    );
  }, monitorInterval);

  // Run the test
  const startTime = Date.now();
  const endTime = startTime + config.duration;
  const activeRequests = 0;
  const maxConcurrent = config.concurrency;

  // Ramp up phase
  console.log('📈 Ramp-up phase...');
  while (currentUsers < maxConcurrent && Date.now() < endTime) {
    currentUsers = Math.min(currentUsers + userIncrement, maxConcurrent);

    // Launch concurrent users
    const promises = [];
    for (let i = 0; i < currentUsers; i++) {
      promises.push(
        (async () => {
          while (Date.now() < endTime) {
            await userSession(i);
            // Random think time
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));
          }
        })()
      );
    }

    // Wait a bit before next increment
    await new Promise((resolve) => setTimeout(resolve, config.rampUp / 10));
  }

  // Sustain phase
  console.log('\n📊 Sustain phase...');
  const sustainPromises = [];
  for (let i = 0; i < maxConcurrent; i++) {
    sustainPromises.push(
      (async () => {
        while (Date.now() < endTime) {
          await userSession(i);
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 1000));
        }
      })()
    );
  }

  await Promise.all(sustainPromises);

  // Clean up
  clearInterval(monitor);
  results.endTime = new Date();

  // Calculate final statistics
  const totalDuration = (results.endTime - results.startTime) / 1000;
  const avgResponseTime =
    results.responseTimes.reduce((a, b) => a + b, 0) / results.responseTimes.length;
  const sortedTimes = [...results.responseTimes].sort((a, b) => a - b);
  const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)];
  const p90 = sortedTimes[Math.floor(sortedTimes.length * 0.9)];
  const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)];
  const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)];
  const errorRate = (results.failedRequests / results.totalRequests) * 100;
  const throughput = results.totalRequests / totalDuration;

  // Print results
  console.log('\n\n' + '='.repeat(70));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(70));

  console.log(`
┌────────────────────────────────────────────────────────────────────┐
│ Summary                                                           │
├────────────────────────────────────────────────────────────────────┤
│ Test Name:        ${config.name}
│ Duration:         ${totalDuration.toFixed(1)} seconds
│ Total Requests:   ${results.totalRequests.toLocaleString()}
│ Successful:       ${results.successfulRequests.toLocaleString()}
│ Failed:           ${results.failedRequests.toLocaleString()}
│ Error Rate:       ${errorRate.toFixed(2)}%
│ Throughput:       ${throughput.toFixed(1)} req/s
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ Response Times (ms)                                               │
├────────────────────────────────────────────────────────────────────┤
│ Mean:             ${avgResponseTime.toFixed(2)}
│ Min:              ${sortedTimes[0].toFixed(2)}
│ Max:              ${sortedTimes[sortedTimes.length - 1].toFixed(2)}
│ P50 (Median):     ${p50.toFixed(2)}
│ P90:              ${p90.toFixed(2)}
│ P95:              ${p95.toFixed(2)}
│ P99:              ${p99.toFixed(2)}
└────────────────────────────────────────────────────────────────────┘
  `);

  // Error breakdown
  if (Object.keys(results.errors).length > 0) {
    console.log('┌────────────────────────────────────────────────────────────────────┐');
    console.log('│ Error Breakdown                                                   │');
    console.log('├────────────────────────────────────────────────────────────────────┤');
    for (const [error, count] of Object.entries(results.errors)) {
      const percentage = ((count / results.totalRequests) * 100).toFixed(2);
      console.log(`│ ${error.padEnd(20)} ${count.toLocaleString().padEnd(15)} (${percentage}%)`);
    }
    console.log('└────────────────────────────────────────────────────────────────────┘');
  }

  // Performance verdict
  console.log('\n' + '='.repeat(70));
  console.log('📋 PERFORMANCE VERDICT');
  console.log('='.repeat(70));

  let passed = true;
  const messages = [];

  // Check response time
  if (p95 > 2000) {
    passed = false;
    messages.push('❌ FAILED: P95 response time exceeds 2 seconds');
  } else {
    messages.push('✅ PASSED: P95 response time within limits');
  }

  // Check error rate
  if (errorRate > 1) {
    passed = false;
    messages.push('❌ FAILED: Error rate exceeds 1%');
  } else {
    messages.push('✅ PASSED: Error rate within limits');
  }

  // Check throughput for 10M test
  if (config.targetTransactions) {
    const projectedTotal = throughput * (config.duration / 1000);
    if (projectedTotal < config.targetTransactions * 0.9) {
      passed = false;
      messages.push('❌ FAILED: Would not meet 10M transaction target');
    } else {
      messages.push('✅ PASSED: On track for 10M transactions');
    }
  }

  // Check for 100K users
  if (config.concurrency >= 100000) {
    if (throughput > 10000) {
      messages.push('✅ PASSED: Achieved target throughput for 100K users');
    } else if (throughput > 5000) {
      messages.push('⚠️  WARNING: Throughput below optimal for 100K users');
    } else {
      messages.push('❌ FAILED: Cannot support 100K users at this throughput');
    }
  }

  messages.forEach((msg) => console.log(`   ${msg}`));

  console.log('\n' + '='.repeat(70));
  console.log(`\n✅ Test completed at ${results.endTime.toISOString()}`);
  console.log('\n   Full results saved to: load-test-results/');

  // Save results to file
  const fs = require('fs');
  const resultsDir = './load-test-results';
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultFile = `${resultsDir}/quick-test-${testType}-${timestamp}.json`;

  fs.writeFileSync(
    resultFile,
    JSON.stringify(
      {
        config,
        results: {
          totalRequests: results.totalRequests,
          successfulRequests: results.successfulRequests,
          failedRequests: results.failedRequests,
          errorRate: errorRate,
          avgResponseTime,
          p50,
          p90,
          p95,
          p99,
          throughput,
          errors: results.errors,
          duration: totalDuration
        },
        verdict: passed ? 'PASSED' : 'FAILED'
      },
      null,
      2
    )
  );

  console.log(`   Results file: ${resultFile}\n`);

  process.exit(passed ? 0 : 1);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Test interrupted by user');
  results.endTime = new Date();
  process.exit(1);
});

// Run the test
runLoadTest().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
