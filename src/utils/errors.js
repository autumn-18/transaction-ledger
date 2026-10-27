/**
 * Error codes and the AppError class.
 *
 * WHY: every error the API returns has the same shape:
 *   { "success": false, "error": { "code": "...", "message": "...", ... } }
 * A machine-readable `code` lets the client handle errors with a simple
 * switch/if, instead of reading human messages that might change.
 */

const ErrorCodes = Object.freeze({
  // 400 Bad Request - the client sent something wrong
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_REQUEST_BODY: 'INVALID_REQUEST_BODY',
  INVALID_ACCOUNT_ID: 'INVALID_ACCOUNT_ID',
  INVALID_TRANSACTION_TYPE: 'INVALID_TRANSACTION_TYPE',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_PAGINATION: 'INVALID_PAGINATION',
  SAME_ACCOUNT_TRANSFER: 'SAME_ACCOUNT_TRANSFER',

  // 404 Not Found
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',

  // 405 Method Not Allowed
  TRANSACTION_IMMUTABLE: 'TRANSACTION_IMMUTABLE',

  // 409 Conflict - request is valid but clashes with existing data
  DUPLICATE_TRANSACTION: 'DUPLICATE_TRANSACTION',

  // 422 Unprocessable - request is valid but breaks a business rule
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  BALANCE_LIMIT_EXCEEDED: 'BALANCE_LIMIT_EXCEEDED',

  // 500 - our fault, not the client's
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
});

/**
 * An error we created on purpose, with an HTTP status and an error code.
 * Anything that is NOT an AppError is treated as an unexpected bug (500).
 */
class AppError extends Error {
  /**
   * @param {number} statusCode  HTTP status, e.g. 404
   * @param {string} code        one of ErrorCodes
   * @param {string} message     human-readable explanation
   * @param {object} [extra]     extra fields added to the error body
   *                              (e.g. { details: [...] } or { existing_transaction: {...} })
   */
  constructor(statusCode, code, message, extra = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

// Small factory helpers so services read nicely: throw errors.notFound(...)
const errors = {
  accountNotFound: (accountId) =>
    new AppError(404, ErrorCodes.ACCOUNT_NOT_FOUND, `Account '${accountId}' was not found`),

  invalidRequestBody: (message = 'Request body must be a valid JSON object') =>
    new AppError(400, ErrorCodes.INVALID_REQUEST_BODY, message),
};

module.exports = { AppError, ErrorCodes, errors };
