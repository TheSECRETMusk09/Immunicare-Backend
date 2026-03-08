/**
 * Input Sanitization Middleware
 * Provides comprehensive input validation and sanitization for the Immunicare API
 */

// Internal helper functions (not exported directly)
const createSanitizationMiddleware = () => {
  return (req, res, next) => {
    try {
      // Sanitize request body
      if (req.body && typeof req.body === 'object') {
        req.body = sanitizeObjectInternal(req.body);
      }

      // Sanitize query parameters
      if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObjectInternal(req.query);
      }

      // Sanitize URL parameters
      if (req.params && typeof req.params === 'object') {
        req.params = sanitizeObjectInternal(req.params);
      }

      next();
    } catch (error) {
      console.error('Sanitization error:', error);
      // Continue even if sanitization fails - let individual routes handle validation
      next();
    }
  };
};

/**
 * Recursively sanitize an object - internal version
 */
const sanitizeObjectInternal = (obj) => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObjectInternal(item));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Only allow alphanumeric, underscore, hyphen keys
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '');
        sanitized[sanitizedKey] = sanitizeObjectInternal(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * Recursively sanitize an object
 */
const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Only allow alphanumeric, underscore, hyphen keys
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_-]/g, '');
        sanitized[sanitizedKey] = sanitizeObject(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * Sanitize a string value
 */
const sanitizeString = (value) => {
  if (!value || typeof value !== 'string') {
    return value;
  }

  // Trim whitespace
  let sanitized = value.trim();

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove XSS patterns FIRST - before encoding
  // Remove script tags (both opening and closing, even if incomplete)
  sanitized = sanitized.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  sanitized = sanitized.replace(/<script[^>]*>/gi, '');
  sanitized = sanitized.replace(/<\/script>/gi, '');

  // Remove event handler attributes (onclick, onerror, onload, etc.)
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=\s*[^\s>]+/gi, '');

  // Remove javascript: URLs
  sanitized = sanitized.replace(/javascript\s*:/gi, '');

  // Then encode HTML entities to prevent any remaining XSS
  sanitized = encodeHTML(sanitized);

  // Remove common SQL injection patterns (but don't break valid data)
  // Only remove obvious SQL injection attempts
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION)\b)/gi,
    /(';\s*--)/g,
    /(\/\*.*?\*\/)/g,
    /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
    /(\bAND\b\s+\d+\s*=\s*\d+)/gi
  ];

  // Check for suspicious patterns that indicate attack
  const isSuspicious = sqlPatterns.some((pattern) => pattern.test(sanitized));

  // If suspicious, return empty string (but log the attempt)
  if (isSuspicious) {
    console.warn('Potential SQL injection attempt detected:', sanitized.substring(0, 100));
    return '';
  }

  return sanitized;
};

/**
 * Encode HTML entities
 */
const encodeHTML = (str) => {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

/**
 * Validate email format
 */
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate phone number format (Philippines)
 */
const validatePhone = (phone) => {
  // Allow various formats: +63, 0, digits only
  const phoneRegex = /^(\+63|0)?[9]\d{9}$/;
  return phoneRegex.test(phone.replace(/[\s-]/g, ''));
};

/**
 * Validate date format
 */
const validateDate = (date) => {
  const dateObj = new Date(date);
  return !isNaN(dateObj.getTime());
};

/**
 * Validate UUID format
 */
const validateUUID = (uuid) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
};

/**
 * Sanitize filename for upload
 */
const sanitizeFilename = (filename) => {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase() // Convert to lowercase
    .substring(0, 255);
};

/**
 * Validate numeric input
 */
const validateNumeric = (value, options = {}) => {
  const { min, max, integer = false } = options;
  const num = integer ? parseInt(value) : parseFloat(value);

  if (isNaN(num)) {
    return false;
  }

  if (min !== undefined && num < min) {
    return false;
  }

  if (max !== undefined && num > max) {
    return false;
  }

  return true;
};

/**
 * Sanitize search query
 */
const sanitizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Remove potentially dangerous characters but allow common search chars
  return query
    .replace(/[<>'\"%;()&+]/g, '') // Remove special chars
    .replace(/\\+/g, '') // Remove backslashes
    .trim()
    .substring(0, 200); // Limit length
};

/**
 * Create validation rules for common fields
 */
const validationRules = {
  id: {
    validate: (value) => validateNumeric(value, { min: 1 }),
    error: 'Invalid ID format'
  },
  uuid: {
    validate: (value) => validateUUID(value),
    error: 'Invalid UUID format'
  },
  email: {
    validate: (value) => validateEmail(value),
    error: 'Invalid email format'
  },
  phone: {
    validate: (value) => validatePhone(value),
    error: 'Invalid phone number format'
  },
  date: {
    validate: (value) => validateDate(value),
    error: 'Invalid date format'
  },
  string: {
    validate: (value) => typeof value === 'string' && value.length > 0,
    error: 'Invalid string format'
  },
  numeric: {
    validate: (value) => validateNumeric(value),
    error: 'Invalid numeric value'
  },
  integer: {
    validate: (value) => validateNumeric(value, { integer: true }),
    error: 'Invalid integer value'
  }
};

/**
 * Validate request data against rules
 */
const validateData = (data, rules) => {
  const errors = [];

  for (const [field, rule] of Object.entries(rules)) {
    if (data[field] !== undefined) {
      if (!rule.validate(data[field])) {
        errors.push({
          field,
          message: rule.error
        });
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Sanitize request middleware - sanitizes body, query, and params
 * @param {Object} options - Options for sanitization
 * @param {string[]} options.excludeFields - Fields to exclude from sanitization
 * @param {string[]} options.fields - Only sanitize these fields (if not provided, sanitize all)
 */
const sanitizeRequest = (options = {}) => {
  const { excludeFields = [], fields = [] } = options;

  return (req, res, next) => {
    try {
      // Sanitize request body
      if (req.body && typeof req.body === 'object') {
        if (fields.length > 0) {
          // Only sanitize specified fields
          const sanitizedBody = { ...req.body };
          for (const field of fields) {
            if (sanitizedBody[field] !== undefined && !excludeFields.includes(field)) {
              sanitizedBody[field] = sanitizeObject(sanitizedBody[field]);
            }
          }
          req.body = sanitizedBody;
        } else if (excludeFields.length > 0) {
          // Exclude specified fields - keep them as-is, sanitize everything else
          const sanitizedBody = {};
          for (const key of Object.keys(req.body)) {
            if (excludeFields.includes(key)) {
              // Keep excluded fields unchanged
              sanitizedBody[key] = req.body[key];
            } else {
              // Sanitize other fields
              sanitizedBody[key] = sanitizeObject(req.body[key]);
            }
          }
          req.body = sanitizedBody;
        } else {
          req.body = sanitizeObject(req.body);
        }
      }

      // Sanitize query parameters
      if (req.query && typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
      }

      // Sanitize URL parameters
      if (req.params && typeof req.params === 'object') {
        req.params = sanitizeObject(req.params);
      }

      next();
    } catch (error) {
      console.error('Sanitization error:', error);
      next();
    }
  };
};

/**
 * Sanitize a specific field in the request
 * @param {string} field - The field name to sanitize
 * @param {string} type - The type of sanitization ('email', 'phone', etc.)
 */
const sanitizeField = (field, type) => {
  return (req, res, next) => {
    try {
      if (req.body && req.body[field] !== undefined) {
        const value = req.body[field];

        switch (type) {
        case 'email':
          // Normalize email to lowercase and trim
          if (typeof value === 'string') {
            req.body[field] = value.toLowerCase().trim();
          }
          break;
        case 'phone':
          // Remove XSS patterns but keep phone formatting
          if (typeof value === 'string') {
            // Remove script tags (both complete and incomplete)
            let sanitized = value.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
            sanitized = sanitized.replace(/<script[^>]*>/gi, '');
            sanitized = sanitized.replace(/<\/script>/gi, '');
            // Remove event handlers
            sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
            sanitized = sanitized.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
            sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
            sanitized = sanitized.replace(/on\w+\s*=\s*[^\s>]+/gi, '');
            req.body[field] = sanitized;
          }
          break;
        default:
          // Default sanitization
          req.body[field] = sanitizeString(value);
        }
      }
      next();
    } catch (error) {
      console.error('Field sanitization error:', error);
      next();
    }
  };
};

/**
 * Deep sanitize an object - recursively sanitize all string values
 * @param {any} obj - The object to sanitize
 * @returns {any} - The sanitized object
 */
const deepSanitize = (obj) => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return sanitizeString(obj);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepSanitize(item));
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        sanitized[key] = deepSanitize(obj[key]);
      }
    }
    return sanitized;
  }

  return obj;
};

/**
 * Content Security Policy middleware
 */
const contentSecurityPolicy = (req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    'default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\';'
  );
  next();
};

/**
 * Prevent prototype pollution middleware
 */
const preventPrototypePollution = (req, res, next) => {
  try {
    // Check and sanitize body
    if (req.body && typeof req.body === 'object') {
      req.body = removeDangerousKeys(req.body);
    }

    // Check and sanitize query
    if (req.query && typeof req.query === 'object') {
      req.query = removeDangerousKeys(req.query);
    }

    next();
  } catch (error) {
    console.error('Prototype pollution prevention error:', error);
    next();
  }
};

/**
 * Remove dangerous keys that could cause prototype pollution
 */
const removeDangerousKeys = (obj) => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  const dangerousPatterns = ['__proto__', 'constructor.prototype', 'prototype'];

  const result = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      // Skip dangerous keys
      if (dangerousPatterns.some((pattern) => key.includes(pattern))) {
        continue;
      }
      result[key] = removeDangerousKeys(obj[key]);
    }
  }

  return result;
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
  // Additional exports for testing
  sanitizeRequest,
  sanitizeField,
  deepSanitize,
  contentSecurityPolicy,
  preventPrototypePollution
};
