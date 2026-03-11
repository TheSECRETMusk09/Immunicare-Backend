/**
 * WebSocket Connection Metrics and Monitoring
 * Tracks reconnection rate, latency by device, and connection health
 */

const EventEmitter = require('events');

class WebSocketMetrics extends EventEmitter {
  constructor(options = {}) {
    super();
    this.connections = new Map();
    this.metrics = {
      connections: {
        total: 0,
        active: 0,
        peak: 0,
        mobile: 0,
        desktop: 0,
        tablet: 0,
      },
      reconnections: {
        total: 0,
        successful: 0,
        failed: 0,
        byDevice: {
          mobile: 0,
          desktop: 0,
          tablet: 0,
        },
      },
      latency: {
        connect: [],
        message: [],
        reconnection: [],
        byDevice: {
          mobile: { connect: [], message: [] },
          desktop: { connect: [], message: [] },
          tablet: { connect: [], message: [] },
        },
      },
      events: {
        received: 0,
        sent: 0,
        dropped: 0,
      },
      errors: {
        total: 0,
        byType: {},
      },
    };

    this.latencyMaxHistory = options.latencyMaxHistory || 1000;
    this.alertThresholds = {
      reconnectionRate: 0.1, // 10% of connections
      averageLatency: 2000, // 2 seconds
      mobileLatency: 3000, // 3 seconds
      connectionFailureRate: 0.05, // 5%
      eventDropRate: 0.01, // 1%
    };

    // Start periodic metrics collection
    // Disable background interval in test runs to prevent Jest open-handle leaks.
    this.metricsInterval = null;
    const shouldStartCollector =
      options.enableCollector !== false &&
      process.env.NODE_ENV !== 'test' &&
      process.env.JEST_WORKER_ID === undefined;

    if (shouldStartCollector) {
      this.metricsInterval = setInterval(() => {
        this.collectMetrics();
      }, 30000); // Every 30 seconds
    }
  }

  /**
   * Detect device type from user agent
   * @param {string} userAgent - User agent string
   * @returns {string} Device type
   */
  detectDeviceType(userAgent = '') {
    if (/Mobile|Android|iPhone|iPod/i.test(userAgent)) {
      return 'mobile';
    } else if (/iPad|Tablet/i.test(userAgent)) {
      return 'tablet';
    }
    return 'desktop';
  }

  /**
   * Track new connection
   * @param {string} socketId - Socket identifier
   * @param {Object} metadata - Connection metadata
   */
  trackConnection(socketId, metadata = {}) {
    const deviceType = this.detectDeviceType(metadata.userAgent);

    this.connections.set(socketId, {
      id: socketId,
      deviceType,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      metadata,
      latency: {
        connect: metadata.connectTime || 0,
        lastMessage: 0,
      },
      reconnections: 0,
    });

    this.metrics.connections.total++;
    this.metrics.connections.active++;
    this.metrics.connections[deviceType]++;

    if (this.metrics.connections.active > this.metrics.connections.peak) {
      this.metrics.connections.peak = this.metrics.connections.active;
    }

    // Track connection latency
    if (metadata.connectTime) {
      this.trackLatency('connect', metadata.connectTime, deviceType);
    }

    this.emit('connection:added', { socketId, deviceType, metadata });
  }

  /**
   * Track disconnection
   * @param {string} socketId - Socket identifier
   * @param {string} reason - Disconnect reason
   */
  trackDisconnection(socketId, reason = 'unknown') {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    const { deviceType } = connection;

    this.metrics.connections.active--;
    this.metrics.connections[deviceType]--;

    this.connections.delete(socketId);

    this.emit('connection:removed', { socketId, reason, deviceType });
  }

  /**
   * Track reconnection attempt
   * @param {string} socketId - Socket identifier
   * @param {string} deviceType - Device type
   * @param {boolean} success - Whether reconnection succeeded
   * @param {number} duration - Reconnection duration in ms
   */
  trackReconnection(socketId, deviceType, success, duration) {
    this.metrics.reconnections.total++;
    this.metrics.reconnections.byDevice[deviceType]++;

    if (success) {
      this.metrics.reconnections.successful++;
    } else {
      this.metrics.reconnections.failed++;
    }

    // Track reconnection latency
    this.trackLatency('reconnection', duration, deviceType);

    // Update connection record
    const connection = this.connections.get(socketId);
    if (connection) {
      connection.reconnections++;
      connection.lastActivity = Date.now();
    }

    // Check reconnection rate
    this.checkReconnectionRate();

    this.emit('reconnection', { socketId, deviceType, success, duration });
  }

  /**
   * Track message latency
   * @param {string} type - Latency type (connect, message, reconnection)
   * @param {number} duration - Latency in milliseconds
   * @param {string} deviceType - Device type
   */
  trackLatency(type, duration, deviceType) {
    // Add to general latency tracking
    this.metrics.latency[type].push(duration);

    if (this.metrics.latency[type].length > this.latencyMaxHistory) {
      this.metrics.latency[type].shift();
    }

    // Add to device-specific tracking
    if (deviceType && this.metrics.latency.byDevice[deviceType]) {
      this.metrics.latency.byDevice[deviceType][type]?.push(duration);
    }

    // Check latency alerts
    this.checkLatencyAlerts(type, duration, deviceType);
  }

  /**
   * Track message event
   * @param {string} direction - 'sent' or 'received'
   * @param {string} event - Event name
   * @param {string} socketId - Socket identifier
   */
  trackMessage(direction, event, socketId) {
    if (direction === 'sent') {
      this.metrics.events.sent++;
    } else {
      this.metrics.events.received++;
    }

    const connection = this.connections.get(socketId);
    if (connection) {
      connection.lastActivity = Date.now();
    }
  }

  /**
   * Track dropped message
   * @param {string} reason - Drop reason
   */
  trackDroppedMessage(reason) {
    this.metrics.events.dropped++;
    this.checkDropRate();
  }

  /**
   * Track error
   * @param {string} errorType - Error type
   * @param {string} socketId - Socket identifier
   * @param {Object} details - Error details
   */
  trackError(errorType, socketId, details = {}) {
    this.metrics.errors.total++;

    if (!this.metrics.errors.byType[errorType]) {
      this.metrics.errors.byType[errorType] = 0;
    }
    this.metrics.errors.byType[errorType]++;

    this.emit('error', { errorType, socketId, details });
  }

  /**
   * Get average latency
   * @param {string} type - Latency type
   * @returns {number} Average latency
   */
  getAverageLatency(type) {
    const latencies = this.metrics.latency[type];
    if (latencies.length === 0) {
      return 0;
    }
    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }

  /**
   * Get latency by device type
   * @param {string} deviceType - Device type
   * @param {string} latencyType - Latency type
   * @returns {number} Average latency
   */
  getDeviceLatency(deviceType, latencyType) {
    const latencies = this.metrics.latency.byDevice[deviceType]?.[latencyType];
    if (!latencies || latencies.length === 0) {
      return 0;
    }
    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }

  /**
   * Get reconnection rate
   * @returns {number} Reconnection rate as decimal
   */
  getReconnectionRate() {
    const total = this.metrics.connections.total;
    if (total === 0) {
      return 0;
    }
    return this.metrics.reconnections.total / total;
  }

  /**
   * Get connection health score
   * @returns {number} Health score (0-100)
   */
  getHealthScore() {
    let score = 100;

    // Deduct for reconnection rate
    const reconRate = this.getReconnectionRate();
    if (reconRate > this.alertThresholds.reconnectionRate) {
      score -= (reconRate * 100);
    }

    // Deduct for average latency
    const avgLatency = this.getAverageLatency('message');
    if (avgLatency > this.alertThresholds.averageLatency) {
      score -= ((avgLatency / this.alertThresholds.averageLatency) - 1) * 10;
    }

    // Deduct for errors
    if (this.metrics.errors.total > 0) {
      score -= Math.min(this.metrics.errors.total, 20);
    }

    return Math.max(0, score);
  }

  /**
   * Check reconnection rate against threshold
   */
  checkReconnectionRate() {
    const rate = this.getReconnectionRate();
    if (rate > this.alertThresholds.reconnectionRate) {
      this.emit('alert', {
        type: 'HIGH_RECONNECTION_RATE',
        severity: 'warning',
        message: `Reconnection rate (${(rate * 100).toFixed(1)}%) exceeds threshold`,
        data: {
          rate,
          total: this.metrics.reconnections.total,
          successful: this.metrics.reconnections.successful,
          failed: this.metrics.reconnections.failed,
        },
      });
    }
  }

  /**
   * Check latency alerts
   * @param {string} type - Latency type
   * @param {number} duration - Latency duration
   * @param {string} deviceType - Device type
   */
  checkLatencyAlerts(type, duration, deviceType) {
    let threshold = this.alertThresholds.averageLatency;

    if (deviceType === 'mobile') {
      threshold = this.alertThresholds.mobileLatency;
    }

    if (duration > threshold) {
      this.emit('alert', {
        type: 'HIGH_LATENCY',
        severity: 'warning',
        message: `${type} latency (${duration}ms) exceeds threshold for ${deviceType}`,
        data: { type, duration, deviceType, threshold },
      });
    }
  }

  /**
   * Check event drop rate
   */
  checkDropRate() {
    const total = this.metrics.events.sent + this.metrics.events.received;
    if (total === 0) {
      return;
    }

    const dropRate = this.metrics.events.dropped / total;
    if (dropRate > this.alertThresholds.eventDropRate) {
      this.emit('alert', {
        type: 'HIGH_EVENT_DROP_RATE',
        severity: 'error',
        message: `Event drop rate (${(dropRate * 100).toFixed(1)}%) exceeds threshold`,
        data: { dropRate },
      });
    }
  }

  /**
   * Collect and emit current metrics
   */
  collectMetrics() {
    const metrics = this.getMetrics();
    this.emit('metrics:collected', metrics);

    // Clean up old latency data
    this.cleanupOldLatencyData();
  }

  /**
   * Clean up old latency data to prevent memory leaks
   */
  cleanupOldLatencyData() {
    const maxAge = 3600000; // 1 hour
    const cutoff = Date.now() - maxAge;

    // Clean up is automatic as we maintain fixed-size arrays
    // But we can trim if arrays get too large
    for (const type of ['connect', 'message', 'reconnection']) {
      if (this.metrics.latency[type].length > this.latencyMaxHistory) {
        this.metrics.latency[type] = this.metrics.latency[type].slice(-this.latencyMaxHistory);
      }
    }
  }

  /**
   * Get current metrics
   * @returns {Object} Current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      computed: {
        averageLatency: {
          connect: this.getAverageLatency('connect'),
          message: this.getAverageLatency('message'),
          reconnection: this.getAverageLatency('reconnection'),
        },
        deviceLatency: {
          mobile: {
            connect: this.getDeviceLatency('mobile', 'connect'),
            message: this.getDeviceLatency('mobile', 'message'),
          },
          desktop: {
            connect: this.getDeviceLatency('desktop', 'connect'),
            message: this.getDeviceLatency('desktop', 'message'),
          },
          tablet: {
            connect: this.getDeviceLatency('tablet', 'connect'),
            message: this.getDeviceLatency('tablet', 'message'),
          },
        },
        reconnectionRate: this.getReconnectionRate(),
        healthScore: this.getHealthScore(),
        dropRate: this.metrics.events.sent > 0
          ? this.metrics.events.dropped / this.metrics.events.sent
          : 0,
      },
    };
  }

  /**
   * Get mobile vs desktop comparison
   * @returns {Object} Comparison data
   */
  getMobileVsDesktopComparison() {
    return {
      connections: {
        mobile: this.metrics.connections.mobile,
        desktop: this.metrics.connections.desktop,
        tablet: this.metrics.connections.tablet,
      },
      latency: {
        mobile: {
          connect: this.getDeviceLatency('mobile', 'connect'),
          message: this.getDeviceLatency('mobile', 'message'),
        },
        desktop: {
          connect: this.getDeviceLatency('desktop', 'connect'),
          message: this.getDeviceLatency('desktop', 'message'),
        },
        tablet: {
          connect: this.getDeviceLatency('tablet', 'connect'),
          message: this.getDeviceLatency('tablet', 'message'),
        },
      },
      reconnections: {
        mobile: this.metrics.reconnections.byDevice.mobile,
        desktop: this.metrics.reconnections.byDevice.desktop,
        tablet: this.metrics.reconnections.byDevice.tablet,
      },
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics.connections.total = 0;
    this.metrics.connections.active = 0;
    this.metrics.connections.peak = 0;
    this.metrics.connections.mobile = 0;
    this.metrics.connections.desktop = 0;
    this.metrics.connections.tablet = 0;

    this.metrics.reconnections.total = 0;
    this.metrics.reconnections.successful = 0;
    this.metrics.reconnections.failed = 0;
    this.metrics.reconnections.byDevice = { mobile: 0, desktop: 0, tablet: 0 };

    this.metrics.latency = {
      connect: [],
      message: [],
      reconnection: [],
      byDevice: {
        mobile: { connect: [], message: [] },
        desktop: { connect: [], message: [] },
        tablet: { connect: [], message: [] },
      },
    };

    this.metrics.events = { received: 0, sent: 0, dropped: 0 };
    this.metrics.errors = { total: 0, byType: {} };
  }

  /**
   * Gracefully shutdown
   */
  shutdown() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    this.removeAllListeners();
  }
}

module.exports = WebSocketMetrics;
