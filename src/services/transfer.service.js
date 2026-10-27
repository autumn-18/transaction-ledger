/**
 * Money transfer: move `amount` from one account to another.
 *
 * A transfer creates, inside ONE database transaction:
 *   1. a row in `transfers`              (groups the two legs together)
 *   2. a DEBIT  on the source account     (source balance goes down)
 *   3. a CREDIT on the destination account (destination balance goes up)
 *
 * If ANY step fails (not enough money, destination limit exceeded, a crash,
 * a duplicate...), PostgreSQL rolls back ALL of them. Money is never
 * debited without being credited, and never credited out of thin air.
 */
const db = require('../db');
const accountRepo = require('../repositories/account.repository');
const transactionRepo = require('../repositories/transaction.repository');
const transferRepo = require('../repositories/transfer.repository');
const { errors } = require('../utils/errors');
const { toTransaction, toTransfer } = require('../utils/mappers');
const {
  postEntry,
  duplicateTransactionError,
  isDuplicateReferenceViolation,
} = require('./transaction.service');

/**
 * Lock both accounts, ALWAYS in the same order (sorted by ID).
 *
 * WHY sort? Deadlock prevention. Suppose at the same moment:
 *   request 1 transfers A -> B  (locks A, then wants B)
 *   request 2 transfers B -> A  (locks B, then wants A)
 * Each waits for the other forever = deadlock. If everyone locks the
 * "smaller" ID first, both requests try A first; one waits, the other
 * finishes, and there is no deadlock.
 */
async function lockAccountsInOrder(client, idA, idB) {
  const locked = {};
  for (const id of [idA, idB].sort()) {
    locked[id] = await accountRepo.findByIdForUpdate(client, id);
  }
  return locked;
}

async function transfer({ fromAccountId, toAccountId, amount, description, referenceId }) {
  try {
    return await db.withTransaction(async (client) => {
      const locked = await lockAccountsInOrder(client, fromAccountId, toAccountId);
      const fromAccount = locked[fromAccountId];
      const toAccount = locked[toAccountId];

      if (!fromAccount) throw errors.accountNotFound(fromAccountId);
      if (!toAccount) throw errors.accountNotFound(toAccountId);

      // Check duplicates on BOTH accounts before writing anything, so the
      // client gets a clear message about which side already used this reference.
      const existingOnSource = await transactionRepo.findByAccountAndReference(client, fromAccountId, referenceId);
      if (existingOnSource) {
        throw duplicateTransactionError(
          existingOnSource,
          `reference_id '${referenceId}' has already been used on the source account. No transfer was made and no balance changed.`
        );
      }
      const existingOnDestination = await transactionRepo.findByAccountAndReference(client, toAccountId, referenceId);
      if (existingOnDestination) {
        throw duplicateTransactionError(
          existingOnDestination,
          `reference_id '${referenceId}' has already been used on the destination account. No transfer was made and no balance changed.`
        );
      }

      const transferRow = await transferRepo.create(client, {
        fromAccountId,
        toAccountId,
        amount,
        description,
        referenceId,
      });

      // Debit first: if the source doesn't have enough money, this throws
      // INSUFFICIENT_BALANCE and the transfer row above is rolled back too.
      const debit = await postEntry(client, {
        account: fromAccount,
        type: 'debit',
        amount,
        description: description || `Transfer to account ${toAccountId}`,
        referenceId,
        transferId: transferRow.id,
      });

      const credit = await postEntry(client, {
        account: toAccount,
        type: 'credit',
        amount,
        description: description || `Transfer from account ${fromAccountId}`,
        referenceId,
        transferId: transferRow.id,
      });

      return {
        transfer: toTransfer(transferRow),
        transactions: {
          debit: toTransaction(debit.transaction),
          credit: toTransaction(credit.transaction),
        },
        balances: {
          from_account: { id: debit.account.id, balance: Number(debit.account.balance) },
          to_account: { id: credit.account.id, balance: Number(credit.account.balance) },
        },
      };
    });
  } catch (err) {
    if (isDuplicateReferenceViolation(err)) {
      const existing =
        (await transactionRepo.findByAccountAndReference(db, fromAccountId, referenceId)) ||
        (await transactionRepo.findByAccountAndReference(db, toAccountId, referenceId));
      if (existing) throw duplicateTransactionError(existing);
    }
    throw err;
  }
}

module.exports = { transfer };
