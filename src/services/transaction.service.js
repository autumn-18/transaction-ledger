/**
 * Transaction business logic: posting credits/debits and reading history.
 *
 * The order of checks when posting a transaction is deliberate:
 *   1. Validate input            -> 400  (done before we get here)
 *   2. Account exists?           -> 404
 *   3. Duplicate reference_id?   -> 409
 *   4. Enough balance (debit)?   -> 422
 *   5. Update balance + insert transaction, together, atomically.
 *
 * WHY check duplicates BEFORE balance? Think of a client retrying a debit
 * that already succeeded. The balance may now be too low for a SECOND debit,
 * but the honest answer is "you already did this" (409), not
 * "insufficient balance" (422).
 */
const db = require('../db');
const accountRepo = require('../repositories/account.repository');
const transactionRepo = require('../repositories/transaction.repository');
const { AppError, ErrorCodes, errors } = require('../utils/errors');
const { toTransaction } = require('../utils/mappers');

// PostgreSQL error codes we react to (see "Appendix A" of the PG docs)
const PG_UNIQUE_VIOLATION = '23505';
const PG_NUMERIC_OUT_OF_RANGE = '22003';
const DUPLICATE_CONSTRAINT = 'uq_transactions_account_reference';

function duplicateTransactionError(existingRow, message) {
  return new AppError(
    409,
    ErrorCodes.DUPLICATE_TRANSACTION,
    message ||
      `A transaction with reference_id '${existingRow.reference_id}' already exists for this account. No new transaction was created and the balance was not changed.`,
    { existing_transaction: toTransaction(existingRow) }
  );
}

function insufficientBalanceError(account, amount) {
  return new AppError(
    422,
    ErrorCodes.INSUFFICIENT_BALANCE,
    `Insufficient balance in account '${account.id}'`,
    { current_balance: Number(account.balance), requested_amount: Number(amount) }
  );
}

/**
 * Is this error the "same reference_id twice for one account" unique error?
 * Normally our own duplicate check catches duplicates first. This is the
 * safety net in case two identical requests ever slip past it at once:
 * the UNIQUE constraint in the database is the final judge.
 */
function isDuplicateReferenceViolation(err) {
  return err && err.code === PG_UNIQUE_VIOLATION && err.constraint === DUPLICATE_CONSTRAINT;
}

/**
 * Post ONE ledger entry (credit or debit) to an account and update its balance.
 *
 * MUST be called inside withTransaction(), AFTER the account row has been
 * locked with findByIdForUpdate(). It is shared by "add transaction" and
 * "transfer", so the money rules live in exactly one place.
 *
 * @returns {{ transaction: object, account: object }} raw DB rows
 */
async function postEntry(client, { account, type, amount, description, referenceId, transferId = null }) {
  const existing = await transactionRepo.findByAccountAndReference(client, account.id, referenceId);
  if (existing) throw duplicateTransactionError(existing);

  let updatedAccount;
  if (type === 'credit') {
    try {
      updatedAccount = await accountRepo.increaseBalance(client, account.id, amount);
    } catch (err) {
      // The new balance would not fit in NUMERIC(14,2).
      if (err.code === PG_NUMERIC_OUT_OF_RANGE) {
        throw new AppError(
          422,
          ErrorCodes.BALANCE_LIMIT_EXCEEDED,
          `This credit would make the balance of account '${account.id}' exceed the maximum allowed value`
        );
      }
      throw err;
    }
  } else {
    updatedAccount = await accountRepo.decreaseBalanceIfSufficient(client, account.id, amount);
    if (!updatedAccount) throw insufficientBalanceError(account, amount);
  }

  const transaction = await transactionRepo.create(client, {
    accountId: account.id,
    type,
    amount,
    description,
    referenceId,
    transferId,
  });

  return { transaction, account: updatedAccount };
}

/**
 * POST /api/accounts/:accountId/transactions
 */
async function addTransaction(accountId, { type, amount, description, referenceId }) {
  try {
    return await db.withTransaction(async (client) => {
      // Lock the account so no other request can change its balance until we finish.
      const account = await accountRepo.findByIdForUpdate(client, accountId);
      if (!account) throw errors.accountNotFound(accountId);

      const result = await postEntry(client, { account, type, amount, description, referenceId });

      return {
        transaction: toTransaction(result.transaction),
        account: { id: result.account.id, balance: Number(result.account.balance) },
      };
    });
  } catch (err) {
    if (isDuplicateReferenceViolation(err)) {
      // The transaction above was rolled back; read the row that "won".
      const existing = await transactionRepo.findByAccountAndReference(db, accountId, referenceId);
      if (existing) throw duplicateTransactionError(existing);
    }
    throw err;
  }
}

/**
 * GET /api/accounts/:accountId/transactions
 */
async function getTransactionHistory(accountId, { type, page, limit }) {
  // One read-only snapshot so the count and the rows always agree.
  return db.withTransaction(
    async (client) => {
      const account = await accountRepo.findById(client, accountId);
      if (!account) throw errors.accountNotFound(accountId);

      const totalRecords = await transactionRepo.countByAccount(client, accountId, type);
      const offset = (page - 1) * limit;
      const rows = await transactionRepo.listByAccount(client, accountId, { type, limit, offset });
      const totalPages = Math.ceil(totalRecords / limit); // 0 when there are no records

      return {
        data: rows.map(toTransaction),
        pagination: {
          page,
          limit,
          total_records: totalRecords,
          total_pages: totalPages,
          has_next_page: page < totalPages,
          has_previous_page: page > 1,
        },
        filters: { type: type || null }, // null = both credit and debit
      };
    },
    { readOnlySnapshot: true }
  );
}

module.exports = {
  postEntry,
  addTransaction,
  getTransactionHistory,
  duplicateTransactionError,
  isDuplicateReferenceViolation,
};
