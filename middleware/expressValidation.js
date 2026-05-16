const { body, param, validationResult } = require('express-validator');
const logger = require('../config/logger');

const fmtValErr = (errors) => {
  return errors.array().map((error) => ({
    field: error.path || error.param,
    message: error.msg,
    value: error.value,
    location: error.location,
  }));
};

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    logger.warn('Validation failed:', {
      path: req.path,
      method: req.method,
      errors: errors.array(),
      user: req.user?.id,
    });

    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: fmtValErr(errors),
      },
    });
  }

  next();
};

const infantValidationRules = [
  body('first_name')
    .trim()
    .escape()
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('First name must be between 1 and 100 characters'),

  body('last_name')
    .trim()
    .escape()
    .notEmpty()
    .withMessage('Last name is required')
    .isLength({ min: 1, max: 100 })
    .withMessage('Last name must be between 1 and 100 characters'),

  body('date_of_birth')
    .notEmpty()
    .withMessage('Date of birth is required')
    .isISO8601()
    .withMessage('Date of birth must be a valid date')
    .custom((value) => {
      const dob = new Date(value);
      const today = new Date();
      if (dob > today) {
        throw new Error('Date of birth cannot be in the future');
      }
      return true;
    }),

  body('gender')
    .optional()
    .trim()
    .escape()
    .isIn(['male', 'female', 'other'])
    .withMessage('Gender must be male, female, or other'),

  body('guardian_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Guardian ID must be a positive integer'),

  body('clinic_id')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Clinic ID must be a positive integer'),

  body('allergies')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 500 })
    .withMessage('Allergies description must not exceed 500 characters'),

  body('medical_notes')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 1000 })
    .withMessage('Medical notes must not exceed 1000 characters'),
];

const appointmentValidationRules = [
  body('infant_id')
    .notEmpty()
    .withMessage('Infant ID is required')
    .isInt({ min: 1 })
    .withMessage('Infant ID must be a positive integer'),

  body('scheduled_date')
    .notEmpty()
    .withMessage('Scheduled date is required')
    .isISO8601()
    .withMessage('Scheduled date must be a valid ISO 8601 date')
    .custom((value) => {
      const scheduledDate = new Date(value);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (scheduledDate < today) {
        throw new Error('Scheduled date cannot be in the past');
      }
      return true;
    }),

  body('type')
    .trim()
    .escape()
    .notEmpty()
    .withMessage('Appointment type is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Appointment type must be between 2 and 100 characters'),

  body('duration_minutes')
    .optional()
    .isInt({ min: 5, max: 240 })
    .withMessage('Duration must be between 5 and 240 minutes'),

  body('notes')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 1000 })
    .withMessage('Notes must not exceed 1000 characters'),

  body('location')
    .optional()
    .trim()
    .escape()
    .isLength({ max: 200 })
    .withMessage('Location must not exceed 200 characters'),

  body('status')
    .optional()
    .trim()
    .escape()
    .isIn(['scheduled', 'pending', 'attended', 'cancelled', 'no_show'])
    .withMessage('Status must be one of: scheduled, pending, attended, cancelled, no_show'),
];

const appointmentIdValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Appointment ID must be a positive integer'),
];

const infantIdValidation = [
  param('id')
    .isInt({ min: 1 })
    .withMessage('Infant ID must be a positive integer'),
];

const phoneValidationRules = [
  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^\+?[\d\s-()]+$/)
    .withMessage('Phone number contains invalid characters')
    .isLength({ min: 10, max: 20 })
    .withMessage('Phone number must be between 10 and 20 characters'),
];

const emailValidationRules = [
  body('email')
    .trim()
    .escape()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail()
    .isLength({ max: 255 })
    .withMessage('Email must not exceed 255 characters'),
];

module.exports = {
  handleValidationErrors,
  infantValidationRules,
  appointmentValidationRules,
  appointmentIdValidation,
  infantIdValidation,
  phoneValidationRules,
  emailValidationRules,
};
