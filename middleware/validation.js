/**
 * Request Validation Middleware
 * Uses express-validator for request validation
 */

const { body, param, query, validationResult } = require('express-validator');
const { ValidationError } = require('./errorHandler');

/**
 * Validation result handler
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorDetails = errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));
    return next(new ValidationError('Validation failed', errorDetails));
  }
  next();
};

/**
 * Common validation rules
 */
const commonValidations = {
  // ID validation
  id: param('id').isInt({ min: 1 }).withMessage('ID must be a positive integer'),

  // UUID validation
  uuid: param('id').isUUID().withMessage('ID must be a valid UUID'),

  // Pagination
  pagination: [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    handleValidationErrors
  ],

  // Date validation
  date: (field = 'date') =>
    body(field).isISO8601().withMessage(`${field} must be a valid ISO 8601 date`),

  // Email validation
  email: body('email').isEmail().normalizeEmail().withMessage('Must be a valid email address'),

  // Phone validation (Philippine format)
  phone: body('phone')
    .matches(/^(\+63|0)?[0-9]{10}$/)
    .withMessage('Must be a valid Philippine phone number'),

  // Password validation
  password: body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),

  // Simple password (for less strict requirements)
  simplePassword: body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),

  // Name validation
  name: (field = 'name') =>
    body(field)
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage(`${field} must be between 1 and 255 characters`)
      .matches(/^[a-zA-Z\s'-]+$/)
      .withMessage(`${field} contains invalid characters`),

  // Username validation
  username: body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),

  // Role validation
  role: body('role')
    .isIn([
      'super_admin',
      'admin',
      'doctor',
      'nurse',
      'midwife',
      'health_worker',
      'guardian',
      'user'
    ])
    .withMessage('Invalid role specified'),

  // Status validation
  appointmentStatus: body('status')
    .optional()
    .isIn(['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'])
    .withMessage('Invalid appointment status'),

  // Gender validation
  gender: body('gender')
    .optional()
    .isIn(['male', 'female', 'other'])
    .withMessage('Gender must be male, female, or other'),

  // Blood type validation
  bloodType: body('blood_type')
    .optional()
    .isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
    .withMessage('Invalid blood type'),

  // Required field
  required: (field, message = `${field} is required`) =>
    body(field).exists({ checkNull: true }).withMessage(message).notEmpty().withMessage(message),

  // Optional string
  optionalString: (field, maxLength = 255) =>
    body(field)
      .optional()
      .trim()
      .isLength({ max: maxLength })
      .withMessage(`${field} must be at most ${maxLength} characters`),

  // Integer validation
  integer: (field, min = 0) =>
    body(field).isInt({ min }).withMessage(`${field} must be a positive integer`),

  // Decimal validation
  decimal: (field, min = 0) =>
    body(field).isFloat({ min }).withMessage(`${field} must be a valid decimal number`),

  // Boolean validation
  boolean: (field) => body(field).optional().isBoolean().withMessage(`${field} must be a boolean`),

  // Array validation
  array: (field) => body(field).isArray().withMessage(`${field} must be an array`),

  // JSON validation
  json: (field) =>
    body(field).custom((value) => {
      if (typeof value === 'object') {
        return true;
      }
      try {
        JSON.parse(value);
        return true;
      } catch (e) {
        throw new Error(`${field} must be valid JSON`);
      }
    })
};

/**
 * Validation schemas for common entities
 */
const validationSchemas = {
  // User registration
  register: [
    commonValidations.required('username'),
    commonValidations.username,
    commonValidations.required('email'),
    commonValidations.email,
    commonValidations.required('password'),
    commonValidations.password,
    commonValidations.optionalString('first_name'),
    commonValidations.optionalString('last_name'),
    handleValidationErrors
  ],

  // User login
  login: [
    commonValidations.required('username', 'Username or email is required'),
    body('username').trim().notEmpty(),
    commonValidations.required('password'),
    handleValidationErrors
  ],

  // Guardian registration
  guardianRegister: [
    commonValidations.required('name'),
    body('name').trim().isLength({ min: 2, max: 255 }),
    commonValidations.required('email'),
    commonValidations.email,
    commonValidations.optionalString('phone', 20),
    commonValidations.optionalString('address', 500),
    commonValidations.optionalString('relationship', 50),
    handleValidationErrors
  ],

  // Infant/Patient registration
  infantRegister: [
    commonValidations.required('first_name'),
    body('first_name').trim().isLength({ min: 1, max: 100 }),
    commonValidations.required('last_name'),
    body('last_name').trim().isLength({ min: 1, max: 100 }),
    commonValidations.required('dob'),
    commonValidations.date('dob'),
    commonValidations.gender,
    commonValidations.required('guardian_id'),
    commonValidations.integer('guardian_id', 1),
    commonValidations.optionalString('birth_place', 255),
    commonValidations.decimal('birth_weight', 0),
    commonValidations.decimal('birth_length', 0),
    commonValidations.bloodType,
    handleValidationErrors
  ],

  // Appointment creation
  appointmentCreate: [
    commonValidations.required('infant_id'),
    commonValidations.integer('infant_id', 1),
    commonValidations.required('scheduled_date'),
    commonValidations.date('scheduled_date'),
    commonValidations.required('type'),
    body('type').trim().isLength({ min: 1, max: 100 }),
    commonValidations.optionalString('notes', 1000),
    commonValidations.optionalString('location', 255),
    commonValidations.integer('duration_minutes', 1),
    handleValidationErrors
  ],

  // Appointment update
  appointmentUpdate: [
    commonValidations.id,
    commonValidations.date('scheduled_date'),
    commonValidations.optionalString('type', 100),
    commonValidations.appointmentStatus,
    commonValidations.optionalString('notes', 1000),
    commonValidations.optionalString('location', 255),
    commonValidations.integer('duration_minutes', 1),
    handleValidationErrors
  ],

  // Vaccination record
  vaccinationRecord: [
    commonValidations.required('patient_id'),
    commonValidations.integer('patient_id', 1),
    commonValidations.required('vaccine_id'),
    commonValidations.integer('vaccine_id', 1),
    commonValidations.required('dose_no'),
    commonValidations.integer('dose_no', 1),
    commonValidations.required('admin_date'),
    commonValidations.date('admin_date'),
    commonValidations.optionalString('site_of_injection', 50),
    commonValidations.optionalString('reactions', 500),
    commonValidations.optionalString('notes', 1000),
    handleValidationErrors
  ],

  // Inventory item
  inventoryItem: [
    commonValidations.required('name'),
    body('name').trim().isLength({ min: 1, max: 255 }),
    commonValidations.required('vaccine_id'),
    commonValidations.integer('vaccine_id', 1),
    commonValidations.required('quantity'),
    commonValidations.integer('quantity', 0),
    commonValidations.required('expiry_date'),
    commonValidations.date('expiry_date'),
    commonValidations.optionalString('batch_number', 100),
    commonValidations.integer('minimum_stock', 0),
    handleValidationErrors
  ],

  // SMS verification
  smsVerification: [
    commonValidations.required('phoneNumber'),
    body('phoneNumber').trim().notEmpty(),
    commonValidations.optionalString('purpose', 50),
    handleValidationErrors
  ],

  // Password reset
  passwordReset: [
    commonValidations.required('newPassword'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    handleValidationErrors
  ],

  // Admin user update
  adminUpdate: [
    commonValidations.email,
    commonValidations.optionalString('contact', 50),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
    handleValidationErrors
  ]
};

/**
 * Sanitization middleware
 */
const sanitizeInput = (req, res, next) => {
  // Sanitize body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize params
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }

  next();
};

/**
 * Recursively sanitize an object
 */
const sanitizeObject = (obj) => {
  const sanitized = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (typeof value === 'string') {
        // Trim whitespace
        sanitized[key] = value.trim();
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = sanitizeObject(value);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map((item) => (typeof item === 'string' ? item.trim() : item));
      } else {
        sanitized[key] = value;
      }
    }
  }
  return sanitized;
};

module.exports = {
  commonValidations,
  validationSchemas,
  handleValidationErrors,
  sanitizeInput,
  body,
  param,
  query,
  validationResult
};
