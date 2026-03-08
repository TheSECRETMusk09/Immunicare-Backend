# Immunicare Load & Stress Testing Guide

## Overview

This document describes the load testing and stress testing infrastructure for the Immunicare system, designed to handle **100,000 concurrent users** and **10,000,000 transactions**.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Test Scenarios](#test-scenarios)
3. [Running Tests](#running-tests)
4. [Test Results](#test-results)
5. [Performance Targets](#performance-targets)
6. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites

- Node.js 18+ installed
- Backend server running on `http://localhost:5000`
- At least 4GB RAM available for load testing

### Run All Tests

```bash
cd backend
node load-test-runner.js --all
```

### Run Specific Test

```bash
# Load test (10K users)
node load-test-runner.js --load

# Stress test (up to 100K users)
node load-test-runner.js --stress

# Scalability test (100K users target)
node load-test-runner.js --scalability

# Volume test (10M transactions)
node load-test-runner.js --volume

# Spike test
node load-test-runner.js --spike

# Endurance test (24 hours)
node load-test-runner.js --endurance
```

---

## Test Scenarios

### 1. Load Test (Normal Peak)

- **Users**: 10,000 concurrent
- **Duration**: 5 minutes
- **Purpose**: Verify system handles normal peak traffic

### 2. Stress Test (Breaking Point)

- **Users**: 10,000 → 100,000 (gradual increase)
- **Duration**: 1 hour
- **Purpose**: Find system breaking point

### 3. Scalability Test (100K Users)

- **Phases**:
  - Phase 1: 10,000 users (5 min)
  - Phase 2: 25,000 users (5 min)
  - Phase 3: 50,000 users (5 min)
  - Phase 4: 75,000 users (5 min)
  - Phase 5: 100,000 users (10 min)
- **Purpose**: Verify horizontal scalability

### 4. Volume Test (10M Transactions)

- **Transactions**: 10,000,000
- **Duration**: ~17 minutes at 10K RPS
- **Purpose**: Verify high transaction volume handling

### 5. Spike Test

- **Pattern**: 5K → 50K → 5K (repeated 3 times)
- **Purpose**: Test sudden traffic spike recovery

### 6. Endurance Test

- **Users**: 25,000 concurrent
- **Duration**: 24 hours
- **Purpose**: Detect memory leaks and stability issues

---

## Running Tests

### Using Built-in Loadtest

The project includes the `loadtest` package for running load tests.

```bash
# Basic load test
npx loadtest -n 10000 -c 100 http://localhost:5000/api/health

# Stress test with POST data
npx loadtest -n 100000 -c 1000 \
  -m POST \
  -T application/json \
  -d '{"username":"test","password":"test"}' \
  http://localhost:5000/api/auth/login
```

### Using k6 (Recommended)

[k6](https://k6.io) is a more powerful load testing tool.

#### Installation

```bash
# Windows
choco install k6

# macOS
brew install k6

# Linux
sudo apt-get install k6
```

#### Running k6 Tests

```bash
# Run load test
k6 run --env SCENARIO=load load-tests/k6-load-test.js

# Run stress test
k6 run --env SCENARIO=stress load-tests/k6-load-test.js

# Run scalability test (100K users)
k6 run --env SCENARIO=scalability load-tests/k6-load-test.js

# Run volume test (10M transactions)
k6 run --env SCENARIO=volume load-tests/k6-load-test.js

# Run with output to InfluxDB for Grafana
k6 run --out influxdb=http://localhost:8086/k6 load-tests/k6-load-test.js
```

### Using Custom Runner

```bash
# Run all scenarios
node load-test-runner.js

# Run specific scenario
node load-test-runner.js --scalability

# Generate report from results
node load-test-analyzer.js
```

---

## Test Results

### Results Directory

All test results are saved to: `backend/load-test-results/`

### Output Files

- `*-timestamp.json` - Raw test data
- `analysis-report-*.html` - HTML analysis report
- `analysis-report-*.csv` - CSV export for Excel

### Viewing Results

```bash
# Analyze all results
node load-test-analyzer.js

# Export to CSV
node load-test-analyzer.js --export csv
```

### Key Metrics

| Metric                  | Description                   | Target      |
| ----------------------- | ----------------------------- | ----------- |
| **Response Time (p95)** | 95th percentile response time | < 2 seconds |
| **Error Rate**          | Percentage of failed requests | < 1%        |
| **Throughput**          | Requests per second           | > 10,000    |
| **Concurrency**         | Simultaneous users            | 100,000     |

---

## Performance Targets

### 100K Users Target

| Metric              | Target    | Critical Threshold |
| ------------------- | --------- | ------------------ |
| Response Time (p95) | < 2s      | < 5s               |
| Error Rate          | < 1%      | < 5%               |
| Throughput          | > 10K RPS | > 5K RPS           |
| CPU Usage           | < 70%     | < 90%              |
| Memory Usage        | < 80%     | < 95%              |

### 10M Transactions Target

| Metric             | Target | Critical Threshold |
| ------------------ | ------ | ------------------ |
| Total Transactions | 10M    | 10M                |
| Transaction Rate   | > 8K/s | > 5K/s             |
| Success Rate       | > 99%  | > 95%              |
| Avg Response Time  | < 1s   | < 3s               |

---

## API Endpoints Tested

The load tests exercise the following endpoints:

| Endpoint                   | Method | Weight |
| -------------------------- | ------ | ------ |
| `/api/health`              | GET    | 20%    |
| `/api/auth/login`          | POST   | 15%    |
| `/api/auth/verify`         | GET    | 10%    |
| `/api/dashboard/stats`     | GET    | 15%    |
| `/api/infants`             | GET    | 10%    |
| `/api/vaccinations`        | GET    | 10%    |
| `/api/inventory`           | GET    | 8%     |
| `/api/appointments`        | GET    | 7%     |
| `/api/announcements`       | GET    | 5%     |
| `/api/notifications`       | GET    | 5%     |
| `/api/analytics/dashboard` | GET    | 5%     |

---

## Troubleshooting

### High Error Rates

1. Check server logs: `backend/logs/`
2. Verify database connections
3. Check rate limiting settings
4. Monitor server resources

### Slow Response Times

1. Add database indexes
2. Enable Redis caching
3. Optimize slow queries
4. Consider horizontal scaling

### Out of Memory

1. Increase Node.js heap size: `NODE_OPTIONS=--max-old-space-size=4096`
2. Reduce concurrent connections
3. Enable connection pooling

### Connection Refused

1. Ensure backend is running: `cd backend && npm start`
2. Check port 5000 is not blocked
3. Verify firewall settings

---

## Advanced Configuration

### Customizing Load Test

Edit [`load-test-config.js`](load-test-config.js) to customize:

- Target URL
- User concurrency
- Test duration
- Endpoint weights
- Success thresholds

### Environment Variables

```bash
# Set custom URL
export LOAD_TEST_URL=https://your-server.com

# Run with custom config
node load-test-runner.js --scalability
```

### Distributed Testing

For true 100K user simulation, run multiple load generators:

```bash
# Terminal 1
node load-test-runner.js --load &

# Terminal 2
node load-test-runner.js --load &
```

---

## Integration with Monitoring

### Prometheus Metrics

The backend exposes Prometheus metrics at `/metrics`:

```bash
# View metrics
curl http://localhost:5000/metrics
```

### Grafana Dashboard

Import the provided Grafana dashboard for real-time monitoring:

1. Open Grafana at `http://localhost:3000`
2. Add InfluxDB data source
3. Import `grafana-dashboard.json`

---

## Best Practices

1. **Run tests in isolation** - Stop other applications during testing
2. **Monitor resources** - Use `htop` or Task Manager
3. **Warm up the server** - Run a small test first
4. **Review logs** - Check for errors after each test
5. **Document results** - Save reports for comparison
6. **Test regularly** - Run weekly to detect degradation

---

## Support

For issues or questions:

1. Check the [troubleshooting section](#troubleshooting)
2. Review server logs in `backend/logs/`
3. Run tests with verbose output
4. Contact the development team

---

## License

ISC License - See LICENSE file for details
