const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const loadBackendEnv = require('../config/loadEnv');
const { normalizeRole, CANONICAL_ROLES } = require('../middleware/rbac');
loadBackendEnv();

const parseOriginList = (...values) =>
  values
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

const normalizeOrigin = (value) => {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsed = new URL(trimmedValue);
    return `${parsed.protocol}//${parsed.host}`.toLowerCase();
  } catch (_error) {
    return null;
  }
};

const getAllowedOrigins = () => {
  const runtimeEnv = process.env.NODE_ENV || 'development';
  const isProductionLikeEnv = runtimeEnv === 'production' || runtimeEnv === 'hostinger';
  const configuredOrigins = parseOriginList(
    process.env.CORS_ALLOWED_ORIGINS,
    process.env.CORS_ORIGIN,
    process.env.FRONTEND_URL,
    process.env.CLIENT_URL,
    process.env.SOCKET_CORS_ORIGIN,
  )
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  const canonicalProductionOrigins = ['https://immunicareph.site', 'https://www.immunicareph.site']
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);
  const devOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://localhost:3000',
    'https://127.0.0.1:3000',
  ]
    .map((value) => normalizeOrigin(value))
    .filter(Boolean);

  const productionOrigins =
    configuredOrigins.length > 0
      ? [...canonicalProductionOrigins, ...configuredOrigins]
      : canonicalProductionOrigins;

  if (isProductionLikeEnv) {
    return Array.from(new Set(productionOrigins));
  }

  return Array.from(new Set([...productionOrigins, ...devOrigins]));
};

const getRoleRoomNames = (role) => {
  const canonicalRole = normalizeRole(role);

  if (canonicalRole === CANONICAL_ROLES.SYSTEM_ADMIN) {
    return ['SYSTEM_ADMIN', 'system_admin', 'admin'];
  }

  if (canonicalRole === CANONICAL_ROLES.GUARDIAN) {
    return ['GUARDIAN', 'guardian'];
  }

  return role ? [String(role)] : [];
};

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId
    this.userSockets = new Map(); // userId -> Set of socketIds
  }

  initialize(server) {
    const runtimeEnv = process.env.NODE_ENV || 'development';
    const isProductionLikeEnv = runtimeEnv === 'production' || runtimeEnv === 'hostinger';
    const allowedOrigins = getAllowedOrigins();
    const socketPath = process.env.SOCKET_PATH || '/socket.io';
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret) {
      throw new Error('JWT_SECRET is required for socket authentication');
    }

    this.io = new Server(server, {
      path: socketPath,
      cors: {
        origin: (origin, callback) => {
          logger.info('[SocketIO CORS] Checking origin', { origin });

          // Allow requests with no origin (like server-to-server or proxy)
          if (!origin) {
            logger.info('[SocketIO CORS] No origin, allowing request');
            return callback(null, true);
          }

          const normalizedOrigin = normalizeOrigin(origin);
          logger.info('[SocketIO CORS] Normalized origin', { origin, normalizedOrigin });
          logger.info('[SocketIO CORS] Allowed origins', { allowedOrigins });

          if (normalizedOrigin && allowedOrigins.indexOf(normalizedOrigin) !== -1) {
            logger.info('[SocketIO CORS] Origin allowed', { origin, normalizedOrigin });
            callback(null, true);
          } else {
            // Allow any localhost origin for development
            if (
              !isProductionLikeEnv &&
              (origin.includes('localhost') || origin.includes('127.0.0.1'))
            ) {
              logger.info('[SocketIO CORS] Localhost origin allowed (dev mode)', { origin });
              return callback(null, true);
            }
            logger.warn('[SocketIO CORS] Origin NOT allowed', {
              origin,
              normalizedOrigin,
              allowedOrigins,
            });
            callback(new Error('Not allowed by CORS'));
          }
        },
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Resilient client-server communication settings
      transports: ['websocket', 'polling'], // Graceful degradation
      pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT) || 60000, // Heartbeat timeout
      pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL) || 25000, // Heartbeat interval
      connectTimeout: parseInt(process.env.SOCKET_CONNECT_TIMEOUT) || 45000,
      allowEIO3: true,
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

        if (!token) {
          return next(new Error('Authentication error: No token provided'));
        }

        const decoded = jwt.verify(token, jwtSecret);
        socket.userId = decoded.userId || decoded.id;
        socket.userRole = normalizeRole(decoded.runtime_role || decoded.role_type || decoded.role) || decoded.role || null;
        socket.guardianId = decoded.guardian_id || decoded.guardianId || null;
        socket.clinicId = decoded.clinic_id || decoded.clinicId || decoded.facility_id || decoded.facilityId || null;

        next();
      } catch (error) {
        logger.warn('Socket authentication failed', {
          message: error.message,
        });
        next(new Error('Authentication error: Invalid token'));
      }
    });

    // Connection handler
    this.io.on('connection', (socket) => {
      const userId = socket.userId;
      const socketId = socket.id;

      logger.info(`User connected: ${userId}, Socket ID: ${socketId}`);

      // Track user connections
      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId).add(socketId);
      this.connectedUsers.set(socketId, userId);

      // Join user-specific room
      socket.join(`user:${userId}`);

      // Join role-based rooms
      if (socket.userRole) {
        getRoleRoomNames(socket.userRole).forEach((roleName) => {
          socket.join(`role:${roleName}`);
        });
      }

      // Join clinic-based rooms
      if (socket.clinicId) {
        socket.join(`clinic:${socket.clinicId}`);
      }

      if (socket.guardianId) {
        socket.join(`guardian:${socket.guardianId}`);
      }

      // Handle join custom rooms
      socket.on('join-room', (room) => {
        socket.join(room);
        logger.info(`User ${userId} joined room: ${room}`);
      });

      // Handle leave custom rooms
      socket.on('leave-room', (room) => {
        socket.leave(room);
        logger.info(`User ${userId} left room: ${room}`);
      });

      // Handle notification read status
      socket.on('notification-read', async (data) => {
        try {
          const { notificationId } = data;
          // Emit to all user's sockets
          this.io.to(`user:${userId}`).emit('notification-updated', {
            notificationId,
            status: 'read',
            userId,
          });
        } catch (error) {
          logger.error('Error handling notification-read:', error);
        }
      });

      // Handle notification dismissed
      socket.on('notification-dismissed', async (data) => {
        try {
          const { notificationId } = data;
          this.io.to(`user:${userId}`).emit('notification-updated', {
            notificationId,
            status: 'dismissed',
            userId,
          });
        } catch (error) {
          logger.error('Error handling notification-dismissed:', error);
        }
      });

      // Handle typing indicator
      socket.on('typing-start', (data) => {
        const { room } = data;
        socket.to(room).emit('user-typing', { userId, isTyping: true });
      });

      socket.on('typing-stop', (data) => {
        const { room } = data;
        socket.to(room).emit('user-typing', { userId, isTyping: false });
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        logger.info(`User disconnected: ${userId}, Socket ID: ${socketId}`);

        // Remove socket from tracking
        this.connectedUsers.delete(socketId);

        if (this.userSockets.has(userId)) {
          this.userSockets.get(userId).delete(socketId);

          // Clean up if no more sockets for user
          if (this.userSockets.get(userId).size === 0) {
            this.userSockets.delete(userId);
          }
        }
      });

      // Send welcome message
      socket.emit('connected', {
        message: 'Successfully connected to notification server',
        userId,
        timestamp: new Date().toISOString(),
      });
    });

    logger.info('Socket.io server initialized');
    return this.io;
  }

  // Send notification to specific user
  sendToUser(userId, event, data) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return false;
    }

    this.io.to(`user:${userId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Notification sent to user ${userId}: ${event}`);
    return true;
  }

  // Send notification with acknowledgment (Reliable Messaging)
  async sendWithAck(userId, event, data, timeout = 5000) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return { success: false, error: 'Socket not initialized' };
    }

    const socketIds = this.getUserSocketIds(userId);
    if (socketIds.size === 0) {
      return { success: false, error: 'User not connected' };
    }

    const promises = [];

    for (const socketId of socketIds) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        promises.push(new Promise((resolve) => {
          socket.timeout(timeout).emit(event, {
            ...data,
            timestamp: new Date().toISOString(),
          }, (err, response) => {
            if (err) {
              resolve({ socketId, status: 'timeout' });
            } else {
              resolve({ socketId, status: 'ack', response });
            }
          });
        }));
      }
    }

    const results = await Promise.all(promises);
    return { success: true, results };
  }

  // Send notification to all users with a specific role
  sendToRole(role, event, data) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return false;
    }

    const roleRooms = getRoleRoomNames(role);
    if (roleRooms.length === 0) {
      logger.warn(`No resolved role rooms found for role ${role}`);
      return false;
    }

    let broadcaster = this.io;

    roleRooms.forEach((roleRoom) => {
      broadcaster = broadcaster.to(`role:${roleRoom}`);
    });

    broadcaster.emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Notification sent to role ${role}: ${event}`);
    return true;
  }

  // Send notification to all users in a clinic
  sendToClinic(clinicId, event, data) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return false;
    }

    this.io.to(`clinic:${clinicId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Notification sent to clinic ${clinicId}: ${event}`);
    return true;
  }

  // Send notification to all connected users
  broadcast(event, data) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return false;
    }

    this.io.emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Broadcast notification: ${event}`);
    return true;
  }

  // Send notification to specific room
  sendToRoom(room, event, data) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return false;
    }

    this.io.to(room).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Notification sent to room ${room}: ${event}`);
    return true;
  }

  // Get connected users count
  getConnectedUsersCount() {
    return this.userSockets.size;
  }

  // Check if user is connected
  isUserConnected(userId) {
    return this.userSockets.has(userId) && this.userSockets.get(userId).size > 0;
  }

  // Get user's socket IDs
  getUserSocketIds(userId) {
    return this.userSockets.get(userId) || new Set();
  }

  // Send notification with priority
  sendPriorityNotification(userId, notification) {
    const event = notification.priority >= 4 ? 'critical-notification' : 'notification';

    return this.sendToUser(userId, event, {
      notification,
      priority: notification.priority,
    });
  }

  // Send alert to relevant users
  sendAlert(alert, targetUsers = []) {
    const event = alert.severity === 'critical' ? 'critical-alert' : 'alert';

    if (targetUsers.length > 0) {
      targetUsers.forEach((userId) => {
        this.sendToUser(userId, event, { alert });
      });
    } else {
      this.broadcast(event, { alert });
    }
  }

  // Send notification with action buttons
  sendActionableNotification(userId, notification, actions = []) {
    return this.sendToUser(userId, 'actionable-notification', {
      notification,
      actions,
    });
  }

  // Send notification update
  sendNotificationUpdate(userId, notificationId, update) {
    return this.sendToUser(userId, 'notification-updated', {
      notificationId,
      ...update,
    });
  }

  // Send notification deletion
  sendNotificationDeletion(userId, notificationId) {
    return this.sendToUser(userId, 'notification-deleted', {
      notificationId,
    });
  }

  // Send bulk notifications
  sendBulkNotifications(userIds, event, data) {
    let successCount = 0;

    userIds.forEach((userId) => {
      if (this.sendToUser(userId, event, data)) {
        successCount++;
      }
    });

    logger.info(`Bulk notification sent: ${successCount}/${userIds.length} users`);
    return { successCount, total: userIds.length };
  }

  // Send notification to a guardian specifically
  sendToGuardian(guardianId, event, data) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return false;
    }

    // Guardians use the same user ID system but with a 'guardian:' prefix for rooms
    this.io.to(`user:${guardianId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });

    // Also emit to guardian-specific room
    this.io.to(`guardian:${guardianId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Notification sent to guardian ${guardianId}: ${event}`);
    return true;
  }

  // Send notification to all guardians
  sendToAllGuardians(event, data) {
    return this.sendToRole(CANONICAL_ROLES.GUARDIAN, event, data);
  }

  // Get server statistics
  getStats() {
    return {
      connectedUsers: this.getConnectedUsersCount(),
      totalConnections: this.connectedUsers.size,
      rooms: this.io ? this.io.sockets.adapter.rooms.size : 0,
    };
  }
}

// Export singleton instance
const socketService = new SocketService();
module.exports = socketService;
