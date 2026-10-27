/**
 * Database access helpers.
 *
 * A "pool" keeps a few open connections to PostgreSQL and lends them out.
 * WHY: opening a new connection for every request is slow; reusing is fast.
 */
const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool(config.db);

// If an idle connection breaks (e.g. DB restarted), log it instead of crashing.
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Run a simple, single query (no DB transaction needed).
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run several queries as ONE atomic unit (a database transaction).
 *
 *   BEGIN  -> run all the work -> COMMIT      (everything is saved)
 *   BEGIN  -> something throws  -> ROLLBACK   (NOTHING is saved)
 *
 * WHY this matters for a ledger: "insert transaction" and "update balance"
 * must both happen or both not happen. If the server crashed in between,
 * PostgreSQL automatically rolls back the unfinished transaction.
 *
 * IMPORTANT: every query inside `work` must use the `client` it receives.
 * A query sent through `pool` would run on a different connection, i.e.
 * OUTSIDE this transaction.
 *
 * @param {(client: import('pg').PoolClient) => Promise<any>} work
 * @param {object}  [options]
 * @param {boolean} [options.readOnlySnapshot] 
 * 
 */
async function withTransaction(work, { readOnlySnapshot = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query(readOnlySnapshot ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr.message);
    }
    throw err; // let the caller / error handler decide what to tell the client
  } finally {
    client.release(); // always give the connection back to the pool
  }
}

module.exports = { pool, query, withTransaction };
