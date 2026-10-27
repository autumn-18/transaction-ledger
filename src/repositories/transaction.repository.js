/**
 * Transaction repository: SQL for the transactions (ledger) table.
 *
 * Notice there is NO update() and NO delete() here, on purpose:
 * ledger rows are immutable. 
 */

const COLUMNS =
  'id, account_id, type, amount, description, reference_id, transfer_id, created_at';

async function create(db, { accountId, type, amount, description, referenceId, transferId = null }) {
  const { rows } = await db.query(
    `INSERT INTO transactions (account_id, type, amount, description, reference_id, transfer_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [accountId, type, amount, description, referenceId, transferId]
  );
  return rows[0];
}

async function findByAccountAndReference(db, accountId, referenceId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM transactions WHERE account_id = $1 AND reference_id = $2`,
    [accountId, referenceId]
  );
  return rows[0] || null;
}

/**
 * `$2::text IS NULL OR type = $2` means:
 *   - if no type filter was given (NULL), every row matches
 *   - otherwise only rows of that type match
 
 */
async function countByAccount(db, accountId, type) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS total
       FROM transactions
      WHERE account_id = $1 AND ($2::text IS NULL OR type = $2)`,
    [accountId, type]
  );
  return rows[0].total;
}

/**
 * Newest first. `id DESC` is a tie-breaker: if two rows had the exact same
 * timestamp, the order would otherwise be random and a row could show up on
 * two pages (or on none). A tie-breaker keeps pagination stable.
 */
async function listByAccount(db, accountId, { type, limit, offset }) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
       FROM transactions
      WHERE account_id = $1 AND ($2::text IS NULL OR type = $2)
      ORDER BY created_at DESC, id DESC
      LIMIT $3 OFFSET $4`,
    [accountId, type, limit, offset]
  );
  return rows;
}

module.exports = {
  create,
  findByAccountAndReference,
  countByAccount,
  listByAccount,
};
