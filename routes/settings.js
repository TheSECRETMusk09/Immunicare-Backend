const express = require('express');
const { body, param, validationResult } = require('express-validator');
const UserSettings = require('../models/UserSettings');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Middleware to authenticate all settings routes
router.use(authenticateToken);

// Validation middleware
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
  }
  next();
};

// Get all settings for the current user
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;
    const settings = await UserSettings.getGroupedSettings(userId);
    const summary = await UserSettings.getSummary(userId);

    res.json({
      success: true,
      data: settings,
      summary,
    });
  } catch (error) {
    console.error('Get settings error:', error);
    // Return empty data instead of 500 error if table doesn't exist
    res.json({
      success: true,
      data: {},
      summary: {},
      message: 'Settings table may not be initialized',
    });
  }
});

// GET /api/settings/summary - Get settings summary (MUST be before /:category)
router.get('/summary', async (req, res) => {
  try {
    const userId = req.user.id;
    const summary = await UserSettings.getSummary(userId);

    if (!summary) {
      return res.json({
        success: true,
        data: {
          totalSettings: 0,
          lastUpdated: null,
          categories: ['general', 'profile', 'security', 'notification'],
        },
      });
    }

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Get settings summary error:', error);
    res.json({
      success: true,
      data: {
        totalSettings: 0,
        lastUpdated: null,
        categories: ['general', 'profile', 'security', 'notification'],
      },
    });
  }
});

// GET /api/settings/facility - Get facility information (MUST be before /:category)
router.get('/facility', async (req, res) => {
  try {
    const pool = require('../db');
    const clinicId = req.user.clinic_id || req.user.facility_id;

    let facilityInfo = null;

    if (clinicId) {
      const facilityResult = await pool.query(
        'SELECT id, name, address, contact, region FROM clinics WHERE id = $1',
        [clinicId],
      );

      if (facilityResult.rows.length > 0) {
        const clinic = facilityResult.rows[0];
        facilityInfo = {
          id: clinic.id,
          name: clinic.name,
          address: clinic.address,
          contact: clinic.contact,
          region: clinic.region,
          barangay: 'BARANGAY SAN NICOLAS', // Default values since clinics table doesn't have these fields
          city: 'PASIG CITY',
          province: 'NCR',
          facility_type: 'health_center',
          facility_subtype: null,
          region: clinic.region,
          contact_number: clinic.contact,
          email: null,
        };
      }
    }

    if (!facilityInfo) {
      facilityInfo = {
        name: 'San Nicolas Health Center Pasig City',
        barangay: 'BARANGAY SAN NICOLAS',
        city: 'PASIG CITY',
        province: 'NCR',
      };
    }

    res.json({
      success: true,
      data: facilityInfo,
    });
  } catch (error) {
    console.error('Get facility info error:', error);
    res.json({
      success: true,
      data: {
        name: 'San Nicolas Health Center Pasig City',
        barangay: 'BARANGAY SAN NICOLAS',
        city: 'PASIG CITY',
        province: 'NCR',
      },
    });
  }
});

// GET /api/settings/export - Export settings (MUST be before /:category)
router.get('/export', async (req, res) => {
  try {
    const userId = req.user.id;
    const settings = await UserSettings.getGroupedSettings(userId);

    res.json({
      success: true,
      data: settings,
      exportedAt: new Date().toISOString(),
      userId,
    });
  } catch (error) {
    console.error('Export settings error:', error);
    res.status(500).json({
      error: 'Failed to export settings',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// GET /api/settings/audit/log - Get audit log (MUST be before /:category)
router.get('/audit/log', async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const auditLog = await UserSettings.getAuditLog(userId, limit, offset);

    res.json({
      success: true,
      data: auditLog,
      pagination: {
        limit,
        offset,
        count: auditLog.length,
      },
    });
  } catch (error) {
    console.error('Get audit log error:', error);
    res.status(500).json({
      error: 'Failed to retrieve audit log',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Get settings by category
router.get(
  '/:category',
  [
    param('category')
      .isIn(['general', 'profile', 'security', 'notification'])
      .withMessage('Invalid category'),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { category } = req.params;

      const settings = await UserSettings.getByCategory(userId, category);
      const settingsObject = {};
      settings.forEach((setting) => {
        settingsObject[setting.settingsKey] = UserSettings.parseValue(
          setting.settingsValue,
          setting.valueType,
        );
      });

      res.json({
        success: true,
        category,
        data: settingsObject,
      });
    } catch (error) {
      console.error('Get category settings error:', error);
      res.status(500).json({
        error: 'Failed to retrieve category settings',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

// Get a specific setting
router.get(
  '/:category/:key',
  [
    param('category')
      .isIn(['general', 'profile', 'security', 'notification'])
      .withMessage('Invalid category'),
    param('key').notEmpty().withMessage('Setting key is required'),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { category, key } = req.params;

      const setting = await UserSettings.getSetting(userId, category, key);

      if (!setting) {
        return res.status(404).json({
          error: 'Setting not found',
          category,
          key,
        });
      }

      res.json({
        success: true,
        data: {
          category: setting.category,
          key: setting.settingsKey,
          value: UserSettings.parseValue(setting.settingsValue, setting.valueType),
          type: setting.valueType,
          updatedAt: setting.updatedAt,
        },
      });
    } catch (error) {
      console.error('Get setting error:', error);
      res.status(500).json({
        error: 'Failed to retrieve setting',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

// Update a single setting
router.put(
  '/:category/:key',
  [
    param('category')
      .isIn(['general', 'profile', 'security', 'notification'])
      .withMessage('Invalid category'),
    param('key').notEmpty().withMessage('Setting key is required'),
    body('value').notEmpty().withMessage('Value is required'),
    body('type')
      .optional()
      .isIn(['string', 'boolean', 'number', 'json'])
      .withMessage('Invalid value type'),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { category, key } = req.params;
      const { value, type = 'string' } = req.body;

      // Validate the setting
      const validationErrors = UserSettings.validateSetting(category, key, value, type);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: 'Validation failed',
          details: validationErrors,
        });
      }

      const setting = new UserSettings({
        userId,
        category,
        settingsKey: key,
        settingsValue: value,
        valueType: type,
      });

      const updatedSetting = await setting.save();

      res.json({
        success: true,
        message: 'Setting updated successfully',
        data: {
          category: updatedSetting.category,
          key: updatedSetting.settingsKey,
          value: UserSettings.parseValue(updatedSetting.settingsValue, updatedSetting.valueType),
          type: updatedSetting.valueType,
          updatedAt: updatedSetting.updatedAt,
        },
      });
    } catch (error) {
      console.error('Update setting error:', error);
      res.status(500).json({
        error: 'Failed to update setting',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

// Update multiple settings
router.put(
  '/',
  [
    body('settings').isArray({ min: 1 }).withMessage('Settings must be a non-empty array'),
    body('settings.*.category')
      .isIn(['general', 'profile', 'security', 'notification'])
      .withMessage('Invalid category'),
    body('settings.*.key').notEmpty().withMessage('Setting key is required'),
    body('settings.*.value').notEmpty().withMessage('Value is required'),
    body('settings.*.type')
      .optional()
      .isIn(['string', 'boolean', 'number', 'json'])
      .withMessage('Invalid value type'),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { settings } = req.body;

      // Validate all settings
      const allValidationErrors = [];
      settings.forEach((setting) => {
        const errors = UserSettings.validateSetting(
          setting.category,
          setting.key,
          setting.value,
          setting.type || 'string',
        );
        if (errors.length > 0) {
          allValidationErrors.push({
            category: setting.category,
            key: setting.key,
            errors,
          });
        }
      });

      if (allValidationErrors.length > 0) {
        return res.status(400).json({
          error: 'Validation failed',
          details: allValidationErrors,
        });
      }

      const updatedSettings = await UserSettings.updateMultiple(userId, settings);

      res.json({
        success: true,
        message: `${updatedSettings.length} setting(s) updated successfully`,
        data: updatedSettings.map((s) => ({
          category: s.category,
          key: s.settingsKey,
          value: UserSettings.parseValue(s.settingsValue, s.valueType),
          type: s.valueType,
          updatedAt: s.updatedAt,
        })),
      });
    } catch (error) {
      console.error('Update multiple settings error:', error);
      res.status(500).json({
        error: 'Failed to update settings',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

// Reset settings to defaults for a category
router.post(
  '/:category/reset',
  [
    param('category')
      .isIn(['general', 'profile', 'security', 'notification'])
      .withMessage('Invalid category'),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { category } = req.params;

      const settings = await UserSettings.resetToDefaults(userId, category);

      res.json({
        success: true,
        message: `${category} settings reset to defaults`,
        data: settings.map((s) => ({
          category: s.category,
          key: s.settingsKey,
          value: UserSettings.parseValue(s.settingsValue, s.valueType),
          type: s.valueType,
          updatedAt: s.updatedAt,
        })),
      });
    } catch (error) {
      console.error('Reset settings error:', error);
      res.status(500).json({
        error: 'Failed to reset settings',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

// Delete a specific setting
router.delete(
  '/:category/:key',
  [
    param('category')
      .isIn(['general', 'profile', 'security', 'notification'])
      .withMessage('Invalid category'),
    param('key').notEmpty().withMessage('Setting key is required'),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { category, key } = req.params;

      const setting = await UserSettings.getSetting(userId, category, key);

      if (!setting) {
        return res.status(404).json({
          error: 'Setting not found',
          category,
          key,
        });
      }

      await setting.delete();

      res.json({
        success: true,
        message: 'Setting deleted successfully',
        data: {
          category,
          key,
        },
      });
    } catch (error) {
      console.error('Delete setting error:', error);
      res.status(500).json({
        error: 'Failed to delete setting',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

// Import settings from backup
router.post(
  '/import',
  [
    body('settings').isObject().withMessage('Settings must be an object'),
    body('settings.general')
      .optional()
      .isObject()
      .withMessage('General settings must be an object'),
    body('settings.profile')
      .optional()
      .isObject()
      .withMessage('Profile settings must be an object'),
    body('settings.security')
      .optional()
      .isObject()
      .withMessage('Security settings must be an object'),
    body('settings.notification')
      .optional()
      .isObject()
      .withMessage('Notification settings must be an object'),
    validateRequest,
  ],
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { settings } = req.body;

      const settingsArray = [];
      const categories = ['general', 'profile', 'security', 'notification'];

      categories.forEach((category) => {
        if (settings[category]) {
          Object.entries(settings[category]).forEach(([key, value]) => {
            const type =
              typeof value === 'boolean'
                ? 'boolean'
                : typeof value === 'number'
                  ? 'number'
                  : 'string';
            settingsArray.push({
              category,
              key,
              value,
              type,
            });
          });
        }
      });

      if (settingsArray.length === 0) {
        return res.status(400).json({
          error: 'No valid settings provided',
        });
      }

      const updatedSettings = await UserSettings.updateMultiple(userId, settingsArray);

      res.json({
        success: true,
        message: `${updatedSettings.length} setting(s) imported successfully`,
        data: updatedSettings.map((s) => ({
          category: s.category,
          key: s.settingsKey,
          value: UserSettings.parseValue(s.settingsValue, s.valueType),
          type: s.valueType,
          updatedAt: s.updatedAt,
        })),
      });
    } catch (error) {
      console.error('Import settings error:', error);
      res.status(500).json({
        error: 'Failed to import settings',
        message: process.env.NODE_ENV === 'development' ? error.message : undefined,
      });
    }
  },
);

module.exports = router;
