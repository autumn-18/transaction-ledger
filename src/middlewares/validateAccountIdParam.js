const { isUuid } = require('../validators/common');
const { AppError, ErrorCodes } = require('../utils/errors');

/**
 * Checks the :accountId part of the URL.
 *
 * WHY two different errors?
 *   - "abc" is not even a valid ID           -> 400 INVALID_ACCOUNT_ID
 *   - a valid UUID that is not in the DB     -> 404 ACCOUNT_NOT_FOUND (in the service)
 * Also, without this check PostgreSQL would throw "invalid input syntax for
 * type uuid", which would surface as an ugly 500 error.
 */
function validateAccountIdParam(req, res, next, value) {
  if (!isUuid(value)) {
    return next(
      new AppError(400, ErrorCodes.INVALID_ACCOUNT_ID, `'${value}' is not a valid account ID (expected a UUID)`)
    );
  }
  req.params.accountId = value.toLowerCase();
  return next();
}

module.exports = { validateAccountIdParam };
