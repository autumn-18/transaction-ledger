/**
 * Account repository: the ONLY place that writes SQL for the accounts table.
 *
 * WHY a repository layer? Services describe business rules ("debit needs
 * enough money"); repositories describe how data is stored (SQL). Keeping
 * them apart makes both easier to read, test and change.
 *
 * Every function takes `db` as its first argument. It can be the pool (for a
 * simple read) or a transaction client (for work inside BEGIN/COMMIT).
 *
 * ALWAYS use $1, $2 placeholders, never string concatenation.
 * WHY: placeholders make SQL injection impossible.
 */

const COLUMNS = 'id, name, balance, created_at';

async function create(db, { name }) {
  // balance and created_at are NOT passed: the database defaults fill them.
  const { rows } = await db.query(
    `INSERT INTO accounts (name) VALUES ($1) RETURNING ${COLUMNS}`,
    [name]
  );
  return rows[0];
}

async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM accounts WHERE id = $1`, [id]);
  return rows[0] || null;
}

/**
 * Read an account AND lock its row until the current DB transaction ends.
 *
 * WHY lock? Imagine balance = 1000 and two debits of 800 arrive at the same
 * moment. Without a lock, both read 1000, both think "enough money", and the
 * balance ends at -600. With FOR UPDATE, the second request WAITS until the
 * first one commits, then reads the new balance (200) and is rejected.
 */
async function findByIdForUpdate(db, id) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM accounts WHERE id = $1 FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
}

/** balance = balance + amount. PostgreSQL does the maths exactly. */
async function increaseBalance(db, id, amount) {
  const { rows } = await db.query(
    `UPDATE accounts SET balance = balance + $2 WHERE id = $1 RETURNING ${COLUMNS}`,
    [id, amount]
  );
  return rows[0] || null;
}

/**
 * balance = balance - amount, but ONLY if there is enough money.
 * Returns null when the balance is too low (no row matched the WHERE).
 * WHY compare inside SQL? The comparison is exact (NUMERIC), and it is done
 * on the locked, up-to-date row, so it can never be based on stale data.
 */
async function decreaseBalanceIfSufficient(db, id, amount) {
  const { rows } = await db.query(
    `UPDATE accounts SET balance = balance - $2
      WHERE id = $1 AND balance >= $2
      RETURNING ${COLUMNS}`,
    [id, amount]
  );
  return rows[0] || null;
}

module.exports = {
  create,
  findById,
  findByIdForUpdate,
  increaseBalance,
  decreaseBalanceIfSufficient,
};
