/**
 * WebSocket Connection Multiplexer
 * Manages multiple logical connections over a single physical connection
 * for improved performance and reduced resource usage
 */

const EventEmitter = require('events');

class WebSocketMultiplexer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.channels = new Map();
    this.connections = new Map();
    this.maxConnections = options.maxConnections || 100;
    this.connectionTimeout = options.connectionTimeout || 30000;
    this.heartbeatInterval = options.heartbeatInterval || 25000;
    this.heartbeatTimeout = options.heartbeatTimeout || 60000;

    // Start connection cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveConnections();
    }, 60000);
  }

  /**
   * Register a new physical connection
   * @param {string} socketId - Unique socket identifier
   * @param {Object} socket - Socket.io socket instance
   * @param {Object} userData - User authentication data
   */
  registerConnection(socketId, socket, userData) {
    if (this.connections.size >= this.maxConnections) {
      socket.emit('error', { message: 'Maximum connections reached' });
      socket.disconnect();
      return false;
    }

    const connection = {
      socketId,
      socket,
      userData,
      channels: new Set(),
      lastActivity: Date.now(),
      connectedAt: Date.now(),
      deviceType: this.detectDeviceType(socket),
      isMultiplexed: false,
    };

    this.connections.set(socketId, connection);

    // Set up connection handlers
    this.setupConnectionHandlers(socketId, socket);

    // Start heartbeat
    this.startHeartbeat(socketId);

    this.emit('connection:registered', { socketId, userData });
    return true;
  }

  /**
   * Detect device type from connection
   * @param {Object} socket - Socket.io socket
   * @returns {string} Device type
   */
  detectDeviceType(socket) {
    const userAgent = socket.handshake?.headers?.['user-agent'] || '';

    if (/Mobile|Android|iPhone|iPad|iPod/i.test(userAgent)) {
      if (/iPad|Tablet/i.test(userAgent)) {
        return 'tablet';
      }
      return 'mobile';
    }
    return 'desktop';
  }

  /**
   * Set up event handlers for a connection
   * @param {string} socketId - Socket identifier
   * @param {Object} socket - Socket.io socket
   */
  setupConnectionHandlers(socketId, socket) {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    // Channel subscription
    socket.on('subscribe', (channel) => {
      this.subscribeToChannel(socketId, channel);
    });

    // Channel unsubscription
    socket.on('unsubscribe', (channel) => {
      this.unsubscribeFromChannel(socketId, channel);
    });

    // Multiplexed message
    socket.on('multiplex:send', (data) => {
      this.handleMultiplexedMessage(socketId, data);
      connection.lastActivity = Date.now();
    });

    // Heartbeat response
    socket.on('pong', () => {
      connection.lastActivity = Date.now();
    });

    // Disconnection
    socket.on('disconnect', (reason) => {
      this.handleDisconnect(socketId, reason);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error(`Socket ${socketId} error:`, error);
      this.emit('connection:error', { socketId, error });
    });
  }

  /**
   * Subscribe a connection to a channel
   * @param {string} socketId - Socket identifier
   * @param {string} channel - Channel name
   */
  subscribeToChannel(socketId, channel) {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    // Create channel if not exists
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }

    // Add connection to channel
    this.channels.get(channel).add(socketId);
    connection.channels.add(channel);

    // Mark connection as multiplexed if subscribed to multiple channels
    if (connection.channels.size > 1) {
      connection.isMultiplexed = true;
    }

    connection.socket.emit('subscribed', { channel });
    this.emit('channel:subscribed', { socketId, channel });
  }

  /**
   * Unsubscribe a connection from a channel
   * @param {string} socketId - Socket identifier
   * @param {string} channel - Channel name
   */
  unsubscribeFromChannel(socketId, channel) {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    // Remove from channel
    const channelConnections = this.channels.get(channel);
    if (channelConnections) {
      channelConnections.delete(socketId);

      // Clean up empty channels
      if (channelConnections.size === 0) {
        this.channels.delete(channel);
      }
    }

    connection.channels.delete(channel);

    // Update multiplexed status
    if (connection.channels.size <= 1) {
      connection.isMultiplexed = false;
    }

    connection.socket.emit('unsubscribed', { channel });
    this.emit('channel:unsubscribed', { socketId, channel });
  }

  /**
   * Handle multiplexed messages
   * @param {string} socketId - Sender socket identifier
   * @param {Object} data - Message data
   */
  handleMultiplexedMessage(socketId, data) {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    const { channel, event, payload } = data;

    // Validate channel subscription
    if (!connection.channels.has(channel)) {
      connection.socket.emit('error', {
        message: `Not subscribed to channel: ${channel}`,
      });
      return;
    }

    // Broadcast to all subscribers in channel except sender
    this.broadcastToChannel(channel, event, payload, socketId);

    this.emit('message:multiplexed', {
      socketId,
      channel,
      event,
      payload,
    });
  }

  /**
   * Broadcast a message to all connections in a channel
   * @param {string} channel - Channel name
   * @param {string} event - Event name
   * @param {*} payload - Message payload
   * @param {string} excludeSocketId - Socket to exclude (sender)
   */
  broadcastToChannel(channel, event, payload, excludeSocketId = null) {
    const channelConnections = this.channels.get(channel);
    if (!channelConnections) {
      return;
    }

    const message = {
      channel,
      event,
      payload,
      timestamp: Date.now(),
    };

    for (const socketId of channelConnections) {
      if (socketId === excludeSocketId) {
        continue;
      }

      const connection = this.connections.get(socketId);
      if (connection && connection.socket.connected) {
        // Check if connection is multiplexed
        if (connection.isMultiplexed) {
          connection.socket.emit('multiplex:receive', message);
        } else {
          connection.socket.emit(event, payload);
        }
      }
    }
  }

  /**
   * Start heartbeat for a connection
   * @param {string} socketId - Socket identifier
   */
  startHeartbeat(socketId) {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    const heartbeat = setInterval(() => {
      if (!this.connections.has(socketId)) {
        clearInterval(heartbeat);
        return;
      }

      const lastActivity = Date.now() - connection.lastActivity;

      if (lastActivity > this.heartbeatTimeout) {
        // Connection timed out
        console.warn(`Connection ${socketId} timed out`);
        connection.socket.disconnect();
        this.handleDisconnect(socketId, 'timeout');
        clearInterval(heartbeat);
        return;
      }

      // Send ping
      connection.socket.emit('ping', { timestamp: Date.now() });
    }, this.heartbeatInterval);

    connection.heartbeat = heartbeat;
  }

  /**
   * Handle connection disconnect
   * @param {string} socketId - Socket identifier
   * @param {string} reason - Disconnect reason
   */
  handleDisconnect(socketId, reason) {
    const connection = this.connections.get(socketId);
    if (!connection) {
      return;
    }

    // Clear heartbeat
    if (connection.heartbeat) {
      clearInterval(connection.heartbeat);
    }

    // Unsubscribe from all channels
    for (const channel of connection.channels) {
      this.unsubscribeFromChannel(socketId, channel);
    }

    // Remove connection
    this.connections.delete(socketId);

    this.emit('connection:disconnected', { socketId, reason });
  }

  /**
   * Clean up inactive connections
   */
  cleanupInactiveConnections() {
    const now = Date.now();

    for (const [socketId, connection] of this.connections) {
      const inactiveTime = now - connection.lastActivity;

      if (inactiveTime > this.connectionTimeout) {
        console.warn(`Cleaning up inactive connection: ${socketId}`);
        connection.socket.disconnect();
        this.handleDisconnect(socketId, 'cleanup');
      }
    }
  }

  /**
   * Get connection statistics
   * @returns {Object} Connection stats
   */
  getStats() {
    const stats = {
      totalConnections: this.connections.size,
      maxConnections: this.maxConnections,
      totalChannels: this.channels.size,
      multiplexedConnections: 0,
      deviceTypes: {
        mobile: 0,
        tablet: 0,
        desktop: 0,
      },
      channelStats: {},
    };

    for (const connection of this.connections.values()) {
      if (connection.isMultiplexed) {
        stats.multiplexedConnections++;
      }

      stats.deviceTypes[connection.deviceType]++;
    }

    for (const [channel, connections] of this.channels) {
      stats.channelStats[channel] = connections.size;
    }

    return stats;
  }

  /**
   * Get mobile-specific connection metrics
   * @returns {Object} Mobile connection metrics
   */
  getMobileMetrics() {
    const mobileConnections = [];

    for (const [socketId, connection] of this.connections) {
      if (connection.deviceType === 'mobile') {
        mobileConnections.push({
          socketId,
          connectedAt: connection.connectedAt,
          lastActivity: connection.lastActivity,
          channels: Array.from(connection.channels),
          isMultiplexed: connection.isMultiplexed,
          latency: Date.now() - connection.lastActivity,
        });
      }
    }

    return {
      count: mobileConnections.length,
      averageLatency: mobileConnections.reduce((sum, c) => sum + c.latency, 0) / mobileConnections.length || 0,
      multiplexedCount: mobileConnections.filter(c => c.isMultiplexed).length,
      connections: mobileConnections,
    };
  }

  /**
   * Gracefully shut down multiplexer
   */
  shutdown() {
    clearInterval(this.cleanupInterval);

    // Disconnect all connections
    for (const [socketId, connection] of this.connections) {
      connection.socket.disconnect();
      this.handleDisconnect(socketId, 'shutdown');
    }

    this.removeAllListeners();
  }
}

module.exports = WebSocketMultiplexer;
