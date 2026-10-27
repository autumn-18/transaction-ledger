/**
 * Reusable validation building blocks.
 *
 * HOW validation works in this project:
 *  - Each validator checks ALL fields and collects every problem into a
 *    `fieldErrors` list, so the client can fix everything in one go instead
 *    of discovering errors one at a time.
 *  - If the list is not empty, we throw ONE AppError (HTTP 400).
 *  - If there is exactly one problem, its specific code is used at the top
 *    level (e.g. INVALID_AMOUNT). With several problems the top-level code is
 *    VALIDATION_ERROR, and each item in `details` still has its own code.
 */
const config = require('../config');
const { AppError, ErrorCodes, errors } = require('../utils/errors');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "100", "100.5", "100.50" are OK; "100.505" (3 decimals) is not.
const MAX_TWO_DECIMALS_REGEX = /^\d+(\.\d{1,2})?$/;

const TRANSACTION_TYPES = Object.freeze(['credit', 'debit']);

const isUuid = (value) => typeof value === 'string' && UUID_REGEX.test(value);

function throwIfErrors(fieldErrors) {
  if (fieldErrors.length === 0) return;
  if (fieldErrors.length === 1) {
    const [only] = fieldErrors;
    throw new AppError(400, only.code, only.message, { details: fieldErrors });
  }
  throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Request validation failed', {
    details: fieldErrors,
  });
}

/**
 * The body must be a JSON object: not missing, not an array, not a string.
 * (If Content-Type is not application/json, Express leaves req.body undefined.)
 */
function assertBodyIsObject(body) {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw errors.invalidRequestBody(
      'Request body must be a JSON object. Make sure the "Content-Type: application/json" header is set.'
    );
  }
}

/**
 * Reject fields we don't expect.
 * WHY: if a client sends { "name": "Ravi", "balance": 5000 } and we silently
 * ignored "balance", they might think it worked. Rejecting is clearer.
 */
function checkUnknownFields(body, allowedFields, fieldErrors, customMessages = {}) {
  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) {
      fieldErrors.push({
        field: key,
        code: ErrorCodes.VALIDATION_ERROR,
        message: customMessages[key] || `Unknown field '${key}' is not allowed`,
      });
    }
  }
}

/** Required text field. Returns the trimmed string (or undefined if invalid). */
function requiredString(value, field, maxLength, fieldErrors) {
  if (value === undefined || value === null) {
    fieldErrors.push({ field, code: ErrorCodes.VALIDATION_ERROR, message: `'${field}' is required` });
    return undefined;
  }
  if (typeof value !== 'string') {
    fieldErrors.push({ field, code: ErrorCodes.VALIDATION_ERROR, message: `'${field}' must be a string` });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    fieldErrors.push({ field, code: ErrorCodes.VALIDATION_ERROR, message: `'${field}' must not be empty` });
    return undefined;
  }
  if (trimmed.length > maxLength) {
    fieldErrors.push({
      field,
      code: ErrorCodes.VALIDATION_ERROR,
      message: `'${field}' must be at most ${maxLength} characters`,
    });
    return undefined;
  }
  return trimmed;
}

/** Optional text field. Missing/null => null. Empty string after trim => null. */
function optionalString(value, field, maxLength, fieldErrors) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    fieldErrors.push({ field, code: ErrorCodes.VALIDATION_ERROR, message: `'${field}' must be a string` });
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    fieldErrors.push({
      field,
      code: ErrorCodes.VALIDATION_ERROR,
      message: `'${field}' must be at most ${maxLength} characters`,
    });
    return undefined;
  }
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Money amount.
 * Rules: must be a JSON number, > 0, at most 2 decimal places, not too large.
 *
 * Returns the amount as a STRING with 2 decimals, e.g. 100.5 -> "100.50".
 * WHY a string? We pass it to PostgreSQL, which does exact NUMERIC maths.
 * Keeping it as a string avoids any JavaScript floating-point surprises.
 */
function amount(value, field, fieldErrors) {
  const code = ErrorCodes.INVALID_AMOUNT;
  if (value === undefined || value === null) {
    fieldErrors.push({ field, code, message: `'${field}' is required` });
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fieldErrors.push({ field, code, message: `'${field}' must be a number (e.g. 150.75), not a string` });
    return undefined;
  }
  if (value <= 0) {
    fieldErrors.push({ field, code, message: `'${field}' must be greater than 0` });
    return undefined;
  }
  if (value > config.money.maxAmount) {
    fieldErrors.push({ field, code, message: `'${field}' must not exceed ${config.money.maxAmount}` });
    return undefined;
  }
  if (!MAX_TWO_DECIMALS_REGEX.test(String(value))) {
    fieldErrors.push({ field, code, message: `'${field}' can have at most 2 decimal places` });
    return undefined;
  }
  return value.toFixed(2);
}

/** Transaction type: exactly "credit" or "debit". */
function transactionType(value, field, fieldErrors) {
  if (!TRANSACTION_TYPES.includes(value)) {
    fieldErrors.push({
      field,
      code: ErrorCodes.INVALID_TRANSACTION_TYPE,
      message: `'${field}' must be either 'credit' or 'debit'`,
    });
    return undefined;
  }
  return value;
}

/** An account ID (UUID) inside a request body. */
function accountId(value, field, fieldErrors) {
  if (value === undefined || value === null) {
    fieldErrors.push({ field, code: ErrorCodes.VALIDATION_ERROR, message: `'${field}' is required` });
    return undefined;
  }
  if (!isUuid(value)) {
    fieldErrors.push({ field, code: ErrorCodes.INVALID_ACCOUNT_ID, message: `'${field}' must be a valid UUID` });
    return undefined;
  }
  return value.toLowerCase();
}

module.exports = {
  TRANSACTION_TYPES,
  isUuid,
  throwIfErrors,
  assertBodyIsObject,
  checkUnknownFields,
  requiredString,
  optionalString,
  amount,
  transactionType,
  accountId,
};
