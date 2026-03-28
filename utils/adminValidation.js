const isNil = (value) => value === undefined || value === null;

const isBlank = (value) => {
  if (isNil(value)) {
    return true;
  }
  return String(value).trim().length === 0;
};

const sanitizeText = (
  value,
  { trim = true, maxLength = null, preserveNewLines = false } = {},
) => {
  if (isNil(value)) {
    return '';
  }

  let next = String(value);
  if (!preserveNewLines) {
    next = next.replace(/\s+/g, ' ');
  }

  if (trim) {
    next = next.trim();
  }

  if (Number.isInteger(maxLength) && maxLength > 0) {
    next = next.slice(0, maxLength);
  }

  return next;
};

const sanitizeIdentifier = (
  value,
  { maxLength = 30, allowDash = true, upperCase = true } = {},
) => {
  if (isNil(value)) {
    return '';
  }

  const allowedRegex = allowDash ? /[^A-Za-z0-9-]/g : /[^A-Za-z0-9]/g;
  let next = String(value).replace(allowedRegex, '');

  if (upperCase) {
    next = next.toUpperCase();
  }

  return next.slice(0, maxLength);
};

const normalizeEnumValue = (value, allowedValues = [], fallback = '') => {
  const normalized = sanitizeText(value);
  if (!normalized || !Array.isArray(allowedValues)) {
    return fallback;
  }

  const matchedValue = allowedValues.find(
    (allowedValue) =>
      String(allowedValue).toLowerCase() === normalized.toLowerCase(),
  );

  return matchedValue ?? fallback;
};

const parseDateValue = (value) => {
  if (isBlank(value)) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

const validateDateRange = ({
  startDate,
  endDate,
  startKey = 'startDate',
  endKey = 'endDate',
  startLabel = 'Start date',
  endLabel = 'End date',
} = {}) => {
  const errors = {};

  const parsedStart = parseDateValue(startDate);
  const parsedEnd = parseDateValue(endDate);

  if (!isBlank(startDate) && !parsedStart) {
    errors[startKey] = `${startLabel} is invalid.`;
  }

  if (!isBlank(endDate) && !parsedEnd) {
    errors[endKey] = `${endLabel} is invalid.`;
  }

  if (parsedStart && parsedEnd && parsedEnd < parsedStart) {
    errors[endKey] = `${endLabel} cannot be earlier than ${startLabel.toLowerCase()}.`;
  }

  return errors;
};

const validateNumberRange = (
  value,
  {
    label = 'Value',
    required = false,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    integer = false,
  } = {},
) => {
  if (isBlank(value)) {
    return {
      value: null,
      error: required ? `${label} is required.` : null,
    };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return {
      value: null,
      error: `${label} must be a valid number.`,
    };
  }

  if (integer && !Number.isInteger(parsed)) {
    return {
      value: null,
      error: `${label} must be a whole number.`,
    };
  }

  if (parsed < min || parsed > max) {
    return {
      value: null,
      error: `${label} must be between ${min} and ${max}.`,
    };
  }

  return {
    value: parsed,
    error: null,
  };
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }
  return fallback;
};

const normalizeIntegerArray = (
  value,
  {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    unique = true,
  } = {},
) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= min && entry <= max);

  if (!unique) {
    return normalized;
  }

  return normalized.filter((entry, index, arr) => arr.indexOf(entry) === index);
};

const sanitizePayloadObject = (payload, maxDepth = 4) => {
  if (maxDepth <= 0) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((entry) => sanitizePayloadObject(entry, maxDepth - 1));
  }

  if (payload && typeof payload === 'object') {
    return Object.entries(payload).reduce((acc, [key, value]) => {
      acc[key] = sanitizePayloadObject(value, maxDepth - 1);
      return acc;
    }, {});
  }

  if (typeof payload === 'string') {
    return sanitizeText(payload, { preserveNewLines: true });
  }

  return payload;
};

const hasFieldErrors = (errors = {}) =>
  Object.values(errors).some((value) => Boolean(value));

const respondValidationError = (
  res,
  fields,
  message = 'Validation failed',
  status = 400,
) => {
  console.error('\n❌ VALIDATION ERROR RESPONSE:');
  console.error('Message:', message);
  console.error('Fields:', JSON.stringify(fields, null, 2));
  
  res.status(status).json({
    success: false,
    message,
    error: message,
    fields,
  });
};

module.exports = {
  hasFieldErrors,
  isBlank,
  normalizeBoolean,
  normalizeEnumValue,
  normalizeIntegerArray,
  parseDateValue,
  respondValidationError,
  sanitizeIdentifier,
  sanitizePayloadObject,
  sanitizeText,
  validateDateRange,
  validateNumberRange,
};
