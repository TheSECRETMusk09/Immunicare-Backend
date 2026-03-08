/**
 * Validation Utilities for Immunicare Authentication System
 * Provides comprehensive input validation and sanitization
 */

const bcrypt = require('bcryptjs');

/**
 * Common passwords that are not allowed
 */
const COMMON_PASSWORDS = [
  'password',
  '123456',
  '12345678',
  '123456789',
  'qwerty',
  'abc123',
  'monkey',
  '1234567',
  'letmein',
  'trustno1',
  'dragon',
  'baseball',
  'iloveyou',
  'master',
  'sunshine',
  'ashley',
  'bailey',
  'passw0rd',
  'shadow',
  '123123',
  '654321',
  'superman',
  'qazwsx',
  'michael',
  'football',
  'password1',
  'password123',
  'admin123',
  'welcome',
  'welcome1',
  'hello',
  'hello123',
  'charlie',
  'donald',
  'password1!'
];

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {Object} Validation result with isValid and errors array
 */
const validatePasswordStrength = (password) => {
  const errors = [];

  if (!password || typeof password !== 'string') {
    return {
      isValid: false,
      errors: ['Password is required']
    };
  }

  // Minimum length check
  const minLength = parseInt(process.env.PASSWORD_MIN_LENGTH) || 8;
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long`);
  }

  // Maximum length check
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }

  // Uppercase check
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Lowercase check
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Number check
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Special character check
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push(
      'Password must contain at least one special character (!@#$%^&*()_+-=[]{};\':"\\|,.<>/?)'
    );
  }

  // Common password check
  if (COMMON_PASSWORDS.includes(password.toLowerCase())) {
    errors.push('Password is too common. Please choose a more secure password');
  }

  // Sequential characters check
  if (/(.)\1{2,}/.test(password)) {
    errors.push('Password cannot contain more than 2 consecutive identical characters');
  }

  // Check for keyboard patterns
  const keyboardPatterns = ['qwerty', 'asdfgh', 'zxcvbn', '12345', '54321'];
  const lowerPassword = password.toLowerCase();
  for (const pattern of keyboardPatterns) {
    if (lowerPassword.includes(pattern)) {
      errors.push('Password contains a keyboard pattern');
      break;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength: calculatePasswordStrength(password)
  };
};

/**
 * Calculate password strength score (0-100)
 * @param {string} password - Password to evaluate
 * @returns {number} Strength score
 */
const calculatePasswordStrength = (password) => {
  if (!password) {
    return 0;
  }

  let score = 0;
  const length = password.length;

  // Length contribution (max 25 points)
  score += Math.min(length * 2.5, 25);

  // Character variety (max 40 points)
  if (/[a-z]/.test(password)) {
    score += 10;
  }
  if (/[A-Z]/.test(password)) {
    score += 10;
  }
  if (/[0-9]/.test(password)) {
    score += 10;
  }
  if (/[^a-zA-Z0-9]/.test(password)) {
    score += 10;
  }

  // Bonus points (max 35 points)
  if (length >= 12) {
    score += 15;
  }
  if (
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password)
  ) {
    score += 20;
  }

  return Math.min(score, 100);
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {Object} Validation result
 */
const validateEmail = (email) => {
  const errors = [];

  if (!email || typeof email !== 'string') {
    return { isValid: false, errors: ['Email is required'] };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    errors.push('Invalid email format');
  }

  // Check for disposable email domains (basic list)
  const disposableDomains = ['tempmail.com', 'throwaway.com', 'fakeinbox.com'];
  const domain = email.split('@')[1]?.toLowerCase();
  if (disposableDomains.includes(domain)) {
    errors.push('Disposable email addresses are not allowed');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: email.toLowerCase().trim()
  };
};

/**
 * Validate phone number format (Philippines)
 * @param {string} phone - Phone number to validate
 * @returns {Object} Validation result
 */
const validatePhoneNumber = (phone) => {
  const errors = [];

  if (!phone || typeof phone !== 'string') {
    return { isValid: false, errors: ['Phone number is required'] };
  }

  // Philippine phone number formats
  const phoneRegex = /^(\+63|0)[0-9]{10}$/;
  const cleanedPhone = phone.replace(/[\s\-\(\)]/g, '');

  if (!phoneRegex.test(cleanedPhone)) {
    errors.push('Invalid phone number format. Use: 09XXXXXXXXX or +63XXXXXXXXX');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: cleanedPhone
  };
};

/**
 * Validate name fields
 * @param {string} name - Name to validate
 * @param {string} fieldName - Field name for error messages
 * @returns {Object} Validation result
 */
const validateName = (name, fieldName = 'Name') => {
  const errors = [];

  if (!name || typeof name !== 'string') {
    return { isValid: false, errors: [`${fieldName} is required`] };
  }

  const trimmed = name.trim();

  if (trimmed.length < 1) {
    errors.push(`${fieldName} cannot be empty`);
  }

  if (trimmed.length > 100) {
    errors.push(`${fieldName} must be less than 100 characters`);
  }

  // Check for invalid characters (allow letters, spaces, hyphens, apostrophes)
  const nameRegex = /^[a-zA-Z\s\-']+$/;
  if (!nameRegex.test(trimmed)) {
    errors.push(`${fieldName} contains invalid characters`);
  }

  // Check for multiple consecutive spaces
  if (/\s{2,}/.test(trimmed)) {
    errors.push(`${fieldName} cannot contain multiple consecutive spaces`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: trimmed.replace(/\s+/g, ' ') // Normalize spaces
  };
};

/**
 * Validate username
 * @param {string} username - Username to validate
 * @returns {Object} Validation result
 */
const validateUsername = (username) => {
  const errors = [];

  if (!username || typeof username !== 'string') {
    return { isValid: false, errors: ['Username is required'] };
  }

  const trimmed = username.trim();

  if (trimmed.length < 3) {
    errors.push('Username must be at least 3 characters long');
  }

  if (trimmed.length > 50) {
    errors.push('Username must be less than 50 characters');
  }

  // Username can only contain letters, numbers, and underscores
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(trimmed)) {
    errors.push('Username can only contain letters, numbers, and underscores');
  }

  // Cannot start or end with underscore
  if (trimmed.startsWith('_') || trimmed.endsWith('_')) {
    errors.push('Username cannot start or end with an underscore');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: trimmed.toLowerCase()
  };
};

/**
 * Check if password matches any of the historical passwords
 * @param {string} newPassword - New password
 * @param {string[]} historicalHashes - Array of password hashes
 * @returns {boolean} True if password matches any historical password
 */
const isPasswordInHistory = async (newPassword, historicalHashes) => {
  if (!historicalHashes || historicalHashes.length === 0) {
    return false;
  }

  for (const hash of historicalHashes) {
    const match = await bcrypt.compare(newPassword, hash);
    if (match) {
      return true;
    }
  }

  return false;
};

/**
 * Sanitize and validate address
 * @param {string} address - Address to validate
 * @returns {Object} Validation result
 */
const validateAddress = (address) => {
  const errors = [];

  if (!address) {
    return { isValid: true, sanitized: '' };
  }

  if (typeof address !== 'string') {
    return { isValid: false, errors: ['Address must be a string'] };
  }

  const trimmed = address.trim();

  if (trimmed.length > 500) {
    errors.push('Address must be less than 500 characters');
  }

  // Remove potentially dangerous characters but allow basic punctuation
  const sanitized = trimmed.replace(/[<>{}|\\^`]/g, '');

  return {
    isValid: errors.length === 0,
    errors,
    sanitized
  };
};

/**
 * Validate relationship field
 * @param {string} relationship - Relationship value
 * @returns {Object} Validation result
 */
const validateRelationship = (relationship) => {
  const validRelationships = ['mother', 'father', 'guardian', 'other', 'parent'];

  if (!relationship) {
    return { isValid: false, errors: ['Relationship is required'] };
  }

  if (!validRelationships.includes(relationship.toLowerCase())) {
    return {
      isValid: false,
      errors: [`Relationship must be one of: ${validRelationships.join(', ')}`]
    };
  }

  return {
    isValid: true,
    sanitized: relationship.toLowerCase()
  };
};

/**
 * Validate date of birth
 * @param {string} dob - Date of birth string
 * @returns {Object} Validation result
 */
const validateDateOfBirth = (dob) => {
  const errors = [];

  if (!dob) {
    return { isValid: true, sanitized: null };
  }

  const date = new Date(dob);

  if (isNaN(date.getTime())) {
    return { isValid: false, errors: ['Invalid date format'] };
  }

  const today = new Date();
  const minDate = new Date(today.getFullYear() - 120, today.getMonth(), today.getDate());

  if (date > today) {
    errors.push('Date of birth cannot be in the future');
  }

  if (date < minDate) {
    errors.push('Date of birth is too far in the past');
  }

  return {
    isValid: errors.length === 0,
    errors,
    sanitized: date.toISOString().split('T')[0]
  };
};

/**
 * Validate guardian registration input
 * @param {Object} data - Registration data
 * @returns {Object} Validation result
 */
const validateGuardianRegistration = (data) => {
  const errors = [];
  const validatedData = {};

  // Validate email
  const emailResult = validateEmail(data.email);
  if (!emailResult.isValid) {
    errors.push(...emailResult.errors);
  } else {
    validatedData.email = emailResult.sanitized;
  }

  // Validate password
  const passwordResult = validatePasswordStrength(data.password);
  if (!passwordResult.isValid) {
    errors.push(...passwordResult.errors);
  }

  // Validate confirm password
  if (data.password !== data.confirmPassword) {
    errors.push('Passwords do not match');
  }

  // Validate first name
  const firstNameResult = validateName(data.firstName, 'First name');
  if (!firstNameResult.isValid) {
    errors.push(...firstNameResult.errors);
  } else {
    validatedData.firstName = firstNameResult.sanitized;
  }

  // Validate last name
  const lastNameResult = validateName(data.lastName, 'Last name');
  if (!lastNameResult.isValid) {
    errors.push(...lastNameResult.errors);
  } else {
    validatedData.lastName = lastNameResult.sanitized;
  }

  // Validate phone
  const phoneResult = validatePhoneNumber(data.phone);
  if (!phoneResult.isValid) {
    errors.push(...phoneResult.errors);
  } else {
    validatedData.phone = phoneResult.sanitized;
  }

  // Validate address (optional)
  if (data.address) {
    const addressResult = validateAddress(data.address);
    if (!addressResult.isValid) {
      errors.push(...addressResult.errors);
    } else {
      validatedData.address = addressResult.sanitized;
    }
  }

  // Validate relationship
  const relationshipResult = validateRelationship(data.relationship);
  if (!relationshipResult.isValid) {
    errors.push(...relationshipResult.errors);
  } else {
    validatedData.relationship = relationshipResult.sanitized;
  }

  // Validate infant data (optional)
  if (data.infantName) {
    const infantNameResult = validateName(data.infantName, 'Infant name');
    if (!infantNameResult.isValid) {
      errors.push(...infantNameResult.errors);
    } else {
      validatedData.infantName = infantNameResult.sanitized;
    }
  }

  if (data.infantDob) {
    const dobResult = validateDateOfBirth(data.infantDob);
    if (!dobResult.isValid) {
      errors.push(...dobResult.errors);
    } else {
      validatedData.infantDob = dobResult.sanitized;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: validatedData
  };
};

/**
 * Validate login input
 * @param {Object} data - Login data
 * @returns {Object} Validation result
 */
const validateLoginInput = (data) => {
  const errors = [];

  if (!data.username || typeof data.username !== 'string') {
    errors.push('Username is required');
  }

  if (!data.password || typeof data.password !== 'string') {
    errors.push('Password is required');
  }

  if (data.username && data.username.length > 255) {
    errors.push('Username is too long');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  validatePasswordStrength,
  calculatePasswordStrength,
  validateEmail,
  validatePhoneNumber,
  validateName,
  validateUsername,
  validateAddress,
  validateRelationship,
  validateDateOfBirth,
  validateGuardianRegistration,
  validateLoginInput,
  isPasswordInHistory,
  COMMON_PASSWORDS
};
