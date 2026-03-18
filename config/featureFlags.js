/**
 * Feature Flags Configuration
 * Used for gradual rollout of new features
 */

const featureFlags = {
  // Transfer-In Features
  TRANSFER_IN_ENABLED: {
    name: 'Transfer-In System',
    description: 'Enable guardian transfer-in from other health centers',
    enabled: true, // Default enabled
    rolloutPercentage: 100, // 0-100
    allowedRoles: ['admin', 'guardian'],
    environment: ['development', 'production'],
    config: {
      autoApproveEnabled: true,
      requireDocumentUpload: true,
      maxVaccinesPerSubmission: 10,
    },
  },

  // Smart Scheduling Features
  SMART_SCHEDULING_ENABLED: {
    name: 'Smart Appointment Scheduling',
    description: 'AI-powered appointment slot recommendations',
    enabled: true,
    rolloutPercentage: 100,
    allowedRoles: ['admin', 'guardian'],
    environment: ['development', 'production'],
    config: {
      weekendAvoidance: true,
      holidayAvoidance: true,
      minIntervalDays: 28,
      stockCheckEnabled: true,
    },
  },

  // Notification Features
  ADVANCED_NOTIFICATIONS_ENABLED: {
    name: 'Advanced Notifications',
    description: 'Channel selection, quiet hours, batching, debouncing',
    enabled: true,
    rolloutPercentage: 100,
    allowedRoles: ['admin', 'guardian'],
    environment: ['development', 'production'],
    config: {
      channelSelection: true,
      quietHours: true,
      batching: true,
      debouncing: true,
      defaultDebounceMinutes: 10,
      defaultBatchIntervalMinutes: 60,
    },
  },

  // Auto-Notification Features
  AUTO_NOTIFICATIONS_ENABLED: {
    name: 'Automated Notifications',
    description: 'Automatic notifications for appointments, overdue vaccines, etc.',
    enabled: true,
    rolloutPercentage: 100,
    allowedRoles: ['admin', 'guardian'],
    environment: ['development', 'production'],
    config: {
      appointmentReminders: true,
      vaccineDueWarnings: true,
      missedAppointmentFollowUp: true,
      stockAlerts: true,
      overdueWarnings: true,
    },
  },

  // Admin Validation Queue
  TRANSFER_IN_VALIDATION_QUEUE: {
    name: 'Transfer-In Validation Queue',
    description: 'Admin queue for reviewing transfer-in cases',
    enabled: true,
    rolloutPercentage: 100,
    allowedRoles: ['admin'],
    environment: ['development', 'production'],
    config: {
      autoApproveClearRecords: true,
      priorityHighOverdue: true,
      requireAuditTrail: true,
    },
  },

  // Vaccine Rules Engine
  VACCINE_RULES_ENGINE: {
    name: 'Vaccine Rules Engine',
    description: 'Auto-calculate next doses and vaccine status',
    enabled: true,
    rolloutPercentage: 100,
    allowedRoles: ['admin', 'guardian'],
    environment: ['development', 'production'],
    config: {
      useOfficialSchedule: true,
      allowCustomSchedules: false,
      statusClassifications: ['upcoming', 'due_soon', 'overdue', 'ready'],
    },
  },

  // Delivery Tracking
  NOTIFICATION_DELIVERY_TRACKING: {
    name: 'Notification Delivery Tracking',
    description: 'Track notification delivery status and attempts',
    enabled: true,
    rolloutPercentage: 100,
    allowedRoles: ['admin'],
    environment: ['development', 'production'],
    config: {
      trackAttempts: true,
      trackDeliveryTime: true,
      trackFailureReasons: true,
    },
  },
};

/**
 * Check if a feature is enabled for a specific role
 */
const isFeatureEnabled = (featureName, userRole) => {
  const feature = featureFlags[featureName];
  if (!feature) {
    console.warn(`Unknown feature flag: ${featureName}`);
    return false;
  }

  // Check environment
  const env = process.env.NODE_ENV || 'development';
  if (!feature.environment.includes(env)) {
    return false;
  }

  // Check rollout percentage
  const random = Math.random() * 100;
  if (random > feature.rolloutPercentage) {
    return false;
  }

  // Check role
  if (!feature.allowedRoles.includes(userRole)) {
    return false;
  }

  return feature.enabled;
};

/**
 * Get feature configuration
 */
const getFeatureConfig = (featureName) => {
  const feature = featureFlags[featureName];
  return feature ? feature.config : null;
};

/**
 * Get all feature flags
 */
const getAllFeatureFlags = (userRole) => {
  const result = {};
  for (const [key, value] of Object.entries(featureFlags)) {
    result[key] = {
      enabled: isFeatureEnabled(key, userRole),
      name: value.name,
      description: value.description,
      config: value.config,
    };
  }
  return result;
};

/**
 * Update feature flag (admin only)
 */
const updateFeatureFlag = (featureName, updates) => {
  if (!featureFlags[featureName]) {
    throw new Error(`Unknown feature flag: ${featureName}`);
  }

  // In production, this would update a database
  // For now, we update the in-memory config
  Object.assign(featureFlags[featureName], updates);

  return featureFlags[featureName];
};

module.exports = {
  featureFlags,
  isFeatureEnabled,
  getFeatureConfig,
  getAllFeatureFlags,
  updateFeatureFlag,
};
