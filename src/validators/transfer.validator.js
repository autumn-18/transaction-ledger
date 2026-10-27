const { ErrorCodes } = require('../utils/errors');
const v = require('./common');

/**
 * POST /api/transfers
 */
function validateCreateTransfer(body) {
  v.assertBodyIsObject(body);
  const fieldErrors = [];

  v.checkUnknownFields(
    body,
    ['from_account_id', 'to_account_id', 'amount', 'description', 'reference_id'],
    fieldErrors
  );

  const fromAccountId = v.accountId(body.from_account_id, 'from_account_id', fieldErrors);
  const toAccountId = v.accountId(body.to_account_id, 'to_account_id', fieldErrors);
  const amount = v.amount(body.amount, 'amount', fieldErrors);
  const description = v.optionalString(body.description, 'description', 500, fieldErrors);
  const referenceId = v.requiredString(body.reference_id, 'reference_id', 100, fieldErrors);

  if (fromAccountId && toAccountId && fromAccountId === toAccountId) {
    fieldErrors.push({
      field: 'to_account_id',
      code: ErrorCodes.SAME_ACCOUNT_TRANSFER,
      message: 'Source and destination accounts must be different',
    });
  }

  v.throwIfErrors(fieldErrors);
  return { fromAccountId, toAccountId, amount, description, referenceId };
}

module.exports = { validateCreateTransfer };
