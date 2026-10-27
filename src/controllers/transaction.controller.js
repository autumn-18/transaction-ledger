const transactionService = require('../services/transaction.service');
const {
  validateCreateTransaction,
  validateHistoryQuery,
} = require('../validators/transaction.validator');
const { AppError, ErrorCodes } = require('../utils/errors');

async function addTransaction(req, res) {
  const input = validateCreateTransaction(req.body);
  const result = await transactionService.addTransaction(req.params.accountId, input);
  res.status(201).json({ success: true, data: result });
}

async function getTransactionHistory(req, res) {
  const query = validateHistoryQuery(req.query);
  const result = await transactionService.getTransactionHistory(req.params.accountId, query);
  res.status(200).json({ success: true, ...result });
}

/**
 * Any PUT / PATCH / DELETE on a transaction lands here.
 * WHY have a handler at all instead of a plain 404? A 405 with a clear
 * message tells the client exactly why: ledger records can't be changed.
 */
function rejectModification(req, res) {
  res.set('Allow', 'GET, POST');
  throw new AppError(
    405,
    ErrorCodes.TRANSACTION_IMMUTABLE,
    'Transactions are immutable and cannot be edited or deleted. To correct a mistake, post a new opposite transaction (e.g. a credit to undo a debit).'
  );
}

module.exports = { addTransaction, getTransactionHistory, rejectModification };
