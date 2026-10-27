/**
 * Transfer repository. Like transactions, transfers are never updated or deleted.
 */

const COLUMNS = 'id, from_account_id, to_account_id, amount, description, reference_id, created_at';

async function create(db, { fromAccountId, toAccountId, amount, description, referenceId }) {
  const { rows } = await db.query(
    `INSERT INTO transfers (from_account_id, to_account_id, amount, description, reference_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [fromAccountId, toAccountId, amount, description, referenceId]
  );
  return rows[0];
}

module.exports = { create };
