/**
 * Load Test Results Analyzer
 *
 * Analyzes load test results and generates performance reports.
 *
 * Usage:
 *   node load-test-analyzer.js                    # Analyze all results
 *   node load-test-analyzer.js --latest          # Analyze latest results
 *   node load-test-analyzer.js --file results.json  # Analyze specific file
 *   node load-test-analyzer.js --export csv       # Export to CSV
 */

const fs = require('fs');
const path = require('path');

// Configuration
const RESULTS_DIR = './load-test-results';
const args = process.argv.slice(2);

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/**
 * Performance metrics
 */
class PerformanceMetrics {
  constructor() {
    this.totalRequests = 0;
    this.totalRequestsSec = 0;
    this.meanResponseTime = 0;
    this.minResponseTime = Infinity;
    this.maxResponseTime = 0;
    this.p50ResponseTime = 0;
    this.p90ResponseTime = 0;
    this.p95ResponseTime = 0;
    this.p99ResponseTime = 0;
    this.errorCount = 0;
    this.errorRate = 0;
    this.totalBytes = 0;
    this.throughput = 0;
  }

  calculate(values) {
    if (!values || values.length === 0) {
      return this;
    }

    // Sort values for percentiles
    const sorted = [...values].sort((a, b) => a - b);

    this.totalRequests = values.length;
    this.minResponseTime = sorted[0];
    this.maxResponseTime = sorted[sorted.length - 1];
    this.meanResponseTime = values.reduce((a, b) => a + b, 0) / values.length;
    this.p50ResponseTime = sorted[Math.floor(sorted.length * 0.5)];
    this.p90ResponseTime = sorted[Math.floor(sorted.length * 0.9)];
    this.p95ResponseTime = sorted[Math.floor(sorted.length * 0.95)];
    this.p99ResponseTime = sorted[Math.floor(sorted.length * 0.99)];

    return this;
  }

  toJSON() {
    return {
      totalRequests: this.totalRequests,
      meanResponseTime: Math.round(this.meanResponseTime * 100) / 100,
      minResponseTime: Math.round(this.minResponseTime * 100) / 100,
      maxResponseTime: Math.round(this.maxResponseTime * 100) / 100,
      p50ResponseTime: Math.round(this.p50ResponseTime * 100) / 100,
      p90ResponseTime: Math.round(this.p90ResponseTime * 100) / 100,
      p95ResponseTime: Math.round(this.p95ResponseTime * 100) / 100,
      p99ResponseTime: Math.round(this.p99ResponseTime * 100) / 100,
      errorCount: this.errorCount,
      errorRate: Math.round(this.errorRate * 10000) / 10000,
      throughput: Math.round(this.throughput * 100) / 100
    };
  }
}

/**
 * Analyze a single result file
 */
function analyzeResultFile(filePath) {
  console.log(`\n📁 Analyzing: ${path.basename(filePath)}`);

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);

    const metrics = new PerformanceMetrics();

    // Extract metrics from loadtest format
    if (data.total_requests) {
      metrics.totalRequests = data.total_requests;
    }

    if (data.mean_response_time) {
      metrics.meanResponseTime = data.mean_response_time;
    }

    if (data.min_response_time) {
      metrics.minResponseTime = data.min_response_time;
    }

    if (data.max_response_time) {
      metrics.maxResponseTime = data.max_response_time;
    }

    if (data.total_errors) {
      metrics.errorCount = data.total_errors;
    }

    if (data.total_requests && data.total_errors) {
      metrics.errorRate = data.total_errors / data.total_requests;
    }

    if (data.requests_per_second) {
      metrics.throughput = data.requests_per_second;
      metrics.totalRequestsSec = data.requests_per_second;
    }

    // Extract response times if available
    if (data.response_times) {
      metrics.calculate(Object.values(data.response_times));
    }

    // Print summary
    console.log('\n  📊 Results:');
    console.log(`     Total Requests: ${metrics.totalRequests.toLocaleString()}`);
    console.log(`     Mean Response Time: ${metrics.meanResponseTime.toFixed(2)} ms`);
    console.log(`     Min Response Time: ${metrics.minResponseTime.toFixed(2)} ms`);
    console.log(`     Max Response Time: ${metrics.maxResponseTime.toFixed(2)} ms`);
    console.log(`     Error Rate: ${(metrics.errorRate * 100).toFixed(2)}%`);
    console.log(`     Throughput: ${metrics.throughput.toFixed(2)} req/s`);

    // Determine status
    let status = '✅ PASS';
    if (metrics.errorRate > 0.05) {
      status = '❌ FAIL - High Error Rate';
    } else if (metrics.meanResponseTime > 5000) {
      status = '⚠️  WARN - Slow Response';
    } else if (metrics.meanResponseTime > 2000) {
      status = '⚠️  WARN - Moderate Response Time';
    }

    console.log(`\n  Status: ${status}`);

    return {
      file: path.basename(filePath),
      ...metrics.toJSON(),
      status
    };
  } catch (err) {
    console.error(`  ❌ Error analyzing file: ${err.message}`);
    return null;
  }
}

/**
 * Generate comparison report
 */
function generateComparisonReport(results) {
  console.log('\n' + '='.repeat(80));
  console.log('📈 COMPARISON REPORT');
  console.log('='.repeat(80));

  // Create comparison table
  console.log(
    '\n┌' +
      '─'.repeat(15) +
      '┬' +
      '─'.repeat(15) +
      '┬' +
      '─'.repeat(15) +
      '┬' +
      '─'.repeat(15) +
      '┬' +
      '─'.repeat(15) +
      '┐'
  );
  console.log('│ Test Name      │ Requests      │ Mean (ms)    │ Error Rate   │ Status       │');
  console.log(
    '├' +
      '─'.repeat(15) +
      '┼' +
      '─'.repeat(15) +
      '┼' +
      '─'.repeat(15) +
      '┼' +
      '─'.repeat(15) +
      '┼' +
      '─'.repeat(15) +
      '┤'
  );

  for (const result of results) {
    if (result) {
      const name = result.file.substring(0, 14).padEnd(15);
      const reqs = String(result.totalRequests).substring(0, 12).padEnd(15);
      const mean = String(result.meanResponseTime.toFixed(0)).padEnd(15);
      const errors = String((result.errorRate * 100).toFixed(2) + '%').padEnd(15);
      const status = result.status.substring(0, 12).padEnd(15);

      console.log(`│ ${name} │ ${reqs} │ ${mean} │ ${errors} │ ${status} │`);
    }
  }

  console.log(
    '└' +
      '─'.repeat(15) +
      '┴' +
      '─'.repeat(15) +
      '┴' +
      '─'.repeat(15) +
      '┴' +
      '─'.repeat(15) +
      '┴' +
      '─'.repeat(15) +
      '┘'
  );
}

/**
 * Generate HTML report
 */
function generateHTMLReport(results, outputPath) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Load Test Results Analysis</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; padding: 20px; }
    .container { max-width: 1400px; margin: 0 auto; }
    
    header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 20px; }
    h1 { font-size: 28px; margin-bottom: 10px; }
    .subtitle { opacity: 0.9; }
    
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
    .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .card-value { font-size: 32px; font-weight: bold; color: #667eea; }
    .card-label { color: #666; font-size: 14px; margin-top: 5px; }
    
    .section { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 20px; }
    h2 { color: #333; margin-bottom: 20px; padding-bottom: 10px; border-bottom: 2px solid #667eea; }
    
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #667eea; color: white; font-weight: 600; }
    tr:hover { background: #f8f9fa; }
    
    .status-pass { color: #28a745; font-weight: bold; }
    .status-fail { color: #dc3545; font-weight: bold; }
    .status-warn { color: #ffc107; font-weight: bold; }
    
    .chart { height: 300px; display: flex; align-items: flex-end; gap: 10px; padding: 20px 0; }
    .bar { flex: 1; background: linear-gradient(to top, #667eea, #764ba2); border-radius: 4px 4px 0 0; min-height: 20px; position: relative; }
    .bar-label { position: absolute; bottom: -25px; left: 50%; transform: translateX(-50%); font-size: 12px; color: #666; white-space: nowrap; }
    
    .recommendation { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 10px 0; }
    .recommendation h3 { color: #856404; margin-bottom: 10px; }
    
    .timestamp { color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 Load Test Results Analysis</h1>
      <p class="subtitle">Target: 100,000 Users | 10,000,000 Transactions</p>
      <p class="timestamp">Generated: ${new Date().toISOString()}</p>
    </header>
    
    <div class="summary">
      <div class="card">
        <div class="card-value">${results.filter((r) => r).length}</div>
        <div class="card-label">Tests Analyzed</div>
      </div>
      <div class="card">
        <div class="card-value">${results.reduce((sum, r) => sum + (r?.totalRequests || 0), 0).toLocaleString()}</div>
        <div class="card-label">Total Requests</div>
      </div>
      <div class="card">
        <div class="card-value">${((results.reduce((sum, r) => sum + (r?.errorRate || 0), 0) / results.filter((r) => r).length) * 100).toFixed(2)}%</div>
        <div class="card-label">Avg Error Rate</div>
      </div>
      <div class="card">
        <div class="card-value">${results.reduce((sum, r) => sum + (r?.meanResponseTime || 0), 0).toFixed(0)}</div>
        <div class="card-label">Avg Response Time (ms)</div>
      </div>
    </div>
    
    <div class="section">
      <h2>📈 Test Results</h2>
      <table>
        <thead>
          <tr>
            <th>Test Name</th>
            <th>Requests</th>
            <th>Mean (ms)</th>
            <th>P95 (ms)</th>
            <th>Min (ms)</th>
            <th>Max (ms)</th>
            <th>Error Rate</th>
            <th>Throughput</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${results
    .filter((r) => r)
    .map(
      (r) => `
          <tr>
            <td>${r.file}</td>
            <td>${r.totalRequests.toLocaleString()}</td>
            <td>${r.meanResponseTime.toFixed(2)}</td>
            <td>${r.p95ResponseTime.toFixed(2)}</td>
            <td>${r.minResponseTime.toFixed(2)}</td>
            <td>${r.maxResponseTime.toFixed(2)}</td>
            <td>${(r.errorRate * 100).toFixed(2)}%</td>
            <td>${r.throughput.toFixed(2)}</td>
            <td class="${r.errorRate < 0.01 ? 'status-pass' : r.errorRate < 0.05 ? 'status-warn' : 'status-fail'}">${r.status}</td>
          </tr>
          `
    )
    .join('')}
        </tbody>
      </table>
    </div>
    
    <div class="section">
      <h2>💡 Recommendations</h2>
      ${
  results.filter((r) => r && r.errorRate > 0.01).length > 0
    ? `
      <div class="recommendation">
        <h3>⚠️ High Error Rate Detected</h3>
        <p>Some tests showed error rates above 1%. Consider reviewing:</p>
        <ul>
          <li>Server error logs for root causes</li>
          <li>Database connection pool settings</li>
          <li>Rate limiting configuration</li>
          <li>Resource utilization (CPU, Memory)</li>
        </ul>
      </div>
      `
    : ''
}
      
      ${
  results.filter((r) => r && r.meanResponseTime > 2000).length > 0
    ? `
      <div class="recommendation">
        <h3>🐢 Slow Response Times</h3>
        <p>Average response times exceeded 2 seconds. Consider:</p>
        <ul>
          <li>Adding database indexes</li>
          <li>Implementing caching (Redis)</li>
          <li>Optimizing slow queries</li>
          <li>Horizontal scaling</li>
        </ul>
      </div>
      `
    : ''
}
      
      <div class="recommendation">
        <h3>✅ Performance Targets</h3>
        <ul>
          <li><strong>100K Users:</strong> Ensure system can handle 100,000 concurrent users</li>
          <li><strong>10M Transactions:</strong> Verify system can process 10M requests without degradation</li>
          <li><strong>Response Time:</strong> Target P95 < 2 seconds</li>
          <li><strong>Error Rate:</strong> Target < 1%</li>
        </ul>
      </div>
    </div>
  </div>
</body>
</html>
`;

  fs.writeFileSync(outputPath, html);
  console.log(`\n📊 HTML Report generated: ${outputPath}`);
}

/**
 * Export to CSV
 */
function exportToCSV(results, outputPath) {
  const headers = [
    'Test Name',
    'Total Requests',
    'Mean Response Time (ms)',
    'Min Response Time (ms)',
    'Max Response Time (ms)',
    'P50 (ms)',
    'P90 (ms)',
    'P95 (ms)',
    'P99 (ms)',
    'Error Count',
    'Error Rate (%)',
    'Throughput (req/s)',
    'Status'
  ];

  const rows = results
    .filter((r) => r)
    .map((r) => [
      r.file,
      r.totalRequests,
      r.meanResponseTime.toFixed(2),
      r.minResponseTime.toFixed(2),
      r.maxResponseTime.toFixed(2),
      r.p50ResponseTime.toFixed(2),
      r.p90ResponseTime.toFixed(2),
      r.p95ResponseTime.toFixed(2),
      r.p99ResponseTime.toFixed(2),
      r.errorCount,
      (r.errorRate * 100).toFixed(2),
      r.throughput.toFixed(2),
      r.status
    ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  fs.writeFileSync(outputPath, csv);
  console.log(`\n📊 CSV exported: ${outputPath}`);
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║         Load Test Results Analyzer                          ║
║         Target: 100K Users | 10M Transactions                ║
╚══════════════════════════════════════════════════════════════╝
  `);

  // Check if results directory exists
  if (!fs.existsSync(RESULTS_DIR)) {
    console.log(`\n❌ Results directory not found: ${RESULTS_DIR}`);
    console.log('   Run load tests first to generate results.');
    process.exit(1);
  }

  // Get all JSON files
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(RESULTS_DIR, f));

  if (files.length === 0) {
    console.log('\n❌ No test result files found.');
    process.exit(1);
  }

  console.log(`\n📂 Found ${files.length} result file(s)`);

  // Analyze each file
  const results = files.map((f) => analyzeResultFile(f));

  // Generate comparison report
  generateComparisonReport(results);

  // Generate detailed reports
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  // HTML Report
  const htmlPath = path.join(RESULTS_DIR, `analysis-report-${timestamp}.html`);
  generateHTMLReport(results, htmlPath);

  // CSV Export
  if (args.includes('--export') && args.includes('csv')) {
    const csvPath = path.join(RESULTS_DIR, `analysis-report-${timestamp}.csv`);
    exportToCSV(results, csvPath);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));

  const passingTests = results.filter((r) => r && r.errorRate < 0.01).length;
  const totalTests = results.filter((r) => r).length;

  console.log(`\n  Total Tests: ${totalTests}`);
  console.log(`  Passing: ${passingTests}`);
  console.log(`  Failing: ${totalTests - passingTests}`);
  console.log(`  Success Rate: ${((passingTests / totalTests) * 100).toFixed(1)}%`);

  console.log('\n✅ Analysis complete!');
}

main();
