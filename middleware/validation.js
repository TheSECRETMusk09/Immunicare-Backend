const { body, param, query, validationResult } = require('express-validator');
const { ValidationError } = require('./errorHandler');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errList = errors.array().map((error) => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));
    return next(new ValidationError('Validation failed', errList));
  }
  next();
};

const commonValidations = {
  id: param('id').isInt({ min: 1 }).withMessage('ID must be a positive integer'),

  uuid: param('id').isUUID().withMessage('ID must be a valid UUID'),

  pagination: [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    handleValidationErrors
  ],

  date: (field = 'date') =>
    body(field).isISO8601().withMessage(`${field} must be a valid ISO 8601 date`),

  email: body('email').isEmail().normalizeEmail().withMessage('Must be a valid email address'),

  phone: body('phone')
    .matches(/^(\+63|0)?[0-9]{10}$/)
    .withMessage('Must be a valid Philippine phone number'),

  password: body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),

  simplePassword: body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),

  name: (field = 'name') =>
    body(field)
      .trim()
      .isLength({ min: 1, max: 255 })
      .withMessage(`${field} must be between 1 and 255 characters`)
      .matches(/^[a-zA-Z\s'-]+$/)
      .withMessage(`${field} contains invalid characters`),

  username: body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),

  role: body('role')
    .isIn([
      'super_admin',
      'system_admin',
      'admin',
      'doctor',
      'nurse',
      'midwife',
      'healthcare_worker',
      'guardian',
      'user',
    ])
    .withMessage('Invalid role specified'),

  appointmentStatus: body('status')
    .optional()
    .isIn(['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'])
    .withMessage('Invalid appointment status'),

  gender: body('gender')
    .optional()
    .isIn(['male', 'female', 'other'])
    .withMessage('Gender must be male, female, or other'),

  bloodType: body('blood_type')
    .optional()
    .isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
    .withMessage('Invalid blood type'),

  required: (field, message = `${field} is required`) =>
    body(field).exists({ checkNull: true }).withMessage(message).notEmpty().withMessage(message),

  optionalString: (field, maxLength = 255) =>
    body(field)
      .optional()
      .trim()
      .isLength({ max: maxLength })
      .withMessage(`${field} must be at most ${maxLength} characters`),

  integer: (field, min = 0) =>
    body(field).isInt({ min }).withMessage(`${field} must be a positive integer`),

  decimal: (field, min = 0) =>
    body(field).isFloat({ min }).withMessage(`${field} must be a valid decimal number`),

  boolean: (field) => body(field).optional().isBoolean().withMessage(`${field} must be a boolean`),

  array: (field) => body(field).isArray().withMessage(`${field} must be an array`),

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

const validationSchemas = {
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

  login: [
    commonValidations.required('username', 'Username or email is required'),
    body('username').trim().notEmpty(),
    commonValidations.required('password'),
    handleValidationErrors
  ],

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

  smsVerification: [
    commonValidations.required('phoneNumber'),
    body('phoneNumber').trim().notEmpty(),
    commonValidations.optionalString('purpose', 50),
    handleValidationErrors
  ],

  passwordReset: [
    commonValidations.required('newPassword'),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    handleValidationErrors
  ],

  adminUpdate: [
    commonValidations.email,
    commonValidations.optionalString('contact', 50),
    body('is_active').optional().isBoolean().withMessage('is_active must be a boolean'),
    handleValidationErrors
  ]
};

const sanitizeInput = (req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = scrubObj(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    req.query = scrubObj(req.query);
  }

  if (req.params && typeof req.params === 'object') {
    req.params = scrubObj(req.params);
  }

  next();
};

const scrubObj = (obj) => {
  const sanitized = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      if (typeof value === 'string') {
        sanitized[key] = value.trim();
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = scrubObj(value);
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
