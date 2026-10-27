/**
 * The single place that turns errors into HTTP responses.
 *
 * WHY one central handler? So every error, from any route, has the same
 * response shape. Controllers simply `throw`, and this function formats it.
 *
 * Express knows this is an error handler because it has FOUR arguments.
 */
const { AppError, ErrorCodes } = require('../utils/errors');

function sendError(res, statusCode, code, message, extra = {}) {
  res.status(statusCode).json({
    success: false,
    error: { code, message, ...extra },
  });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // 1. Errors we threw on purpose (validation, not found, duplicate, ...)
  if (err instanceof AppError) {
    return sendError(res, err.statusCode, err.code, err.message, err.extra);
  }

  // 2. The JSON body could not be parsed, e.g. {"name": "Ravi",}  (trailing comma)
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, ErrorCodes.INVALID_REQUEST_BODY, 'Request body contains invalid JSON');
  }
  if (err.type === 'entity.too.large') {
    return sendError(res, 413, ErrorCodes.INVALID_REQUEST_BODY, 'Request body is too large');
  }

  // 3. Anything else is a bug or an infrastructure problem (DB down, ...).
  //    Log the details for developers, but DON'T send them to the client:
  //    stack traces and SQL errors can reveal internal information.
  console.error('Unexpected error:', err);
  return sendError(res, 500, ErrorCodes.INTERNAL_SERVER_ERROR, 'Something went wrong. Please try again later.');
}

/** Requests that matched no route at all. */
function notFoundHandler(req, res) {
  sendError(res, 404, ErrorCodes.ROUTE_NOT_FOUND, `Route ${req.method} ${req.originalUrl} does not exist`);
}

module.exports = { errorHandler, notFoundHandler };
