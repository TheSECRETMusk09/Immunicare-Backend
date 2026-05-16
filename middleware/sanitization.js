const sanitizeKeys = (key) => key.replace(/[^a-zA-Z0-9_-]/g, '');

const sanitizeMarkup = (value) => {
  let cleaned = value.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  cleaned = cleaned.replace(/<script[^>]*>/gi, '');
  cleaned = cleaned.replace(/<\/script>/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
  cleaned = cleaned.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  cleaned = cleaned.replace(/on\w+\s*=\s*[^\s>]+/gi, '');
  return cleaned;
};

const sanitizeString = (value) => {
  if (!value || typeof value !== 'string') return value;

  let sanitized = value.trim().replace(/\0/g, '');
  sanitized = sanitizeMarkup(sanitized);
  sanitized = sanitized.replace(/javascript\s*:/gi, '');
  sanitized = encodeHTML(sanitized);

  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION)\b)/gi,
    /(';\s*--)/g,
    /(\/\*.*?\*\/)/g,
    /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
    /(\bAND\b\s+\d+\s*=\s*\d+)/gi,
  ];

  if (sqlPatterns.some((p) => p.test(sanitized))) {
    console.warn('Potential SQL injection attempt detected:', sanitized.substring(0, 100));
    return '';
  }

  return sanitized;
};

const sanitizeRecursive = (value, cleanObjectKeys = true) => {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRecursive(item, cleanObjectKeys));
  }

  if (typeof value === 'object') {
    const out = {};
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const nextKey = cleanObjectKeys ? sanitizeKeys(key) : key;
      out[nextKey] = sanitizeRecursive(value[key], cleanObjectKeys);
    }
    return out;
  }

  return value;
};

const sanitizeObjectInternal = (value) => sanitizeRecursive(value);
const sanitizeObject = (value) => sanitizeRecursive(value);

const createSanitizationMiddleware = () => (req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') req.body = sanitizeObjectInternal(req.body);
    if (req.query && typeof req.query === 'object') req.query = sanitizeObjectInternal(req.query);
    if (req.params && typeof req.params === 'object') req.params = sanitizeObjectInternal(req.params);
    next();
  } catch (error) {
    console.error('Sanitization error:', error);
    next();
  }
};

const encodeHTML = (str) =>
  str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const validatePhone = (phone) =>
  /^(\+63|0)?[9]\d{9}$/.test(phone.replace(/[\s-]/g, ''));

const validateDate = (date) => !isNaN(new Date(date).getTime());

const validateUUID = (uuid) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid);

const sanitizeFilename = (filename) =>
  filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase()
    .substring(0, 255);

const validateNumeric = (value, options = {}) => {
  const { min, max, integer = false } = options;
  const num = integer ? parseInt(value) : parseFloat(value);
  if (isNaN(num)) return false;
  if (min !== undefined && num < min) return false;
  if (max !== undefined && num > max) return false;
  return true;
};

const sanitizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') return '';
  return query.replace(/[<>'"%;()&+]/g, '').replace(/\\+/g, '').trim().substring(0, 200);
};

const validationRules = {
  id: { validate: (v) => validateNumeric(v, { min: 1 }), error: 'Invalid ID format' },
  uuid: { validate: validateUUID, error: 'Invalid UUID format' },
  email: { validate: validateEmail, error: 'Invalid email format' },
  phone: { validate: validatePhone, error: 'Invalid phone number format' },
  date: { validate: validateDate, error: 'Invalid date format' },
  string: { validate: (v) => typeof v === 'string' && v.length > 0, error: 'Invalid string format' },
  numeric: { validate: validateNumeric, error: 'Invalid numeric value' },
  integer: { validate: (v) => validateNumeric(v, { integer: true }), error: 'Invalid integer value' },
};

const validateData = (data, rules) => {
  const errors = [];
  for (const [field, rule] of Object.entries(rules)) {
    if (data[field] !== undefined && !rule.validate(data[field])) {
      errors.push({ field, message: rule.error });
    }
  }
  return { isValid: errors.length === 0, errors };
};

const sanitizeRequest = (options = {}) => {
  const { excludeFields = [], fields = [] } = options;

  return (req, res, next) => {
    try {
      if (req.body && typeof req.body === 'object') {
        if (fields.length > 0) {
          const body = { ...req.body };
          for (const field of fields) {
            if (body[field] !== undefined && !excludeFields.includes(field)) {
              body[field] = sanitizeObject(body[field]);
            }
          }
          req.body = body;
        } else if (excludeFields.length > 0) {
          const body = {};
          for (const key of Object.keys(req.body)) {
            body[key] = excludeFields.includes(key) ? req.body[key] : sanitizeObject(req.body[key]);
          }
          req.body = body;
        } else {
          req.body = sanitizeObject(req.body);
        }
      }

      if (req.query && typeof req.query === 'object') req.query = sanitizeObject(req.query);
      if (req.params && typeof req.params === 'object') req.params = sanitizeObject(req.params);

      next();
    } catch (error) {
      console.error('Sanitization error:', error);
      next();
    }
  };
};

const sanitizeField = (field, type) => (req, res, next) => {
  try {
    if (req.body && req.body[field] !== undefined) {
      const value = req.body[field];
      if (type === 'email') {
        if (typeof value === 'string') req.body[field] = value.toLowerCase().trim();
      } else if (type === 'phone') {
        if (typeof value === 'string') req.body[field] = sanitizeMarkup(value);
      } else {
        req.body[field] = sanitizeString(value);
      }
    }
    next();
  } catch (error) {
    console.error('Field sanitization error:', error);
    next();
  }
};

const deepSanitize = (value) => sanitizeRecursive(value, false);

const contentSecurityPolicy = (req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self';",
  );
  next();
};

const removeDangerousKeys = (obj) => {
  if (obj == null || typeof obj !== 'object') return obj;

  const dangerous = ['__proto__', 'constructor.prototype', 'prototype'];
  const result = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    if (dangerous.some((p) => key.includes(p))) continue;
    result[key] = removeDangerousKeys(obj[key]);
  }

  return result;
};

const preventPrototypePollution = (req, res, next) => {
  try {
    if (req.body && typeof req.body === 'object') req.body = removeDangerousKeys(req.body);
    if (req.query && typeof req.query === 'object') req.query = removeDangerousKeys(req.query);
    next();
  } catch (error) {
    console.error('Prototype pollution prevention error:', error);
    next();
  }
};

module.exports = {
  createSanitizationMiddleware,
  sanitizeString,
  sanitizeObject,
  sanitizeFilename,
  sanitizeSearchQuery,
  validateEmail,
  validatePhone,
  validateDate,
  validateUUID,
  validateNumeric,
  validationRules,
  validateData,
  encodeHTML,
  sanitizeRequest,
  sanitizeField,
  deepSanitize,
  contentSecurityPolicy,
  preventPrototypePollution,
};
