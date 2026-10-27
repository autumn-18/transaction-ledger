/**
 * Database migration script.  Run with:  npm run db:migrate
 *
 * What it does:
 *   1. Creates the database (e.g. "ledger_db") if it does not exist yet.
 *   2. Runs every .sql file in db/migrations/ that has NOT been run before,
 *      in filename order (001_..., 002_..., ...).
 *
 * WHY track migrations? So running the script twice is safe: already-applied
 * files are skipped instead of failing with "table already exists".
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const config = require('../src/config');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

// Safely quote a database name for use inside SQL ("my-db" -> "\"my-db\"").
const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

function connectionSettings(database) {
  const { host, port, user, password } = config.db;
  return { host, port, user, password, database };
}

/**
 * Make sure the target database exists.
 * We connect to the built-in "postgres" database to do this, because you
 * cannot connect to a database that doesn't exist yet.
 * @param {object} options.recreate  drop and re-create it (used by tests only)
 */
async function ensureDatabase(database, { recreate = false } = {}) {
  const admin = new Client(connectionSettings('postgres'));
  await admin.connect();
  try {
    if (recreate) {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
    }
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rowCount === 0) {
      await admin.query(`CREATE DATABASE ${quoteIdent(database)}`);
      console.log(`Created database "${database}"`);
    }
  } finally {
    await admin.end();
  }
}

async function applyMigrations(database) {
  const client = new Client(connectionSettings(database));
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query('SELECT filename FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((r) => r.filename));

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (alreadyApplied.has(file)) continue;

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      // Each migration runs in its own DB transaction: if any statement in the
      // file fails, nothing from that file is kept (no half-built schema).
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function migrate({ database = config.db.database, recreate = false } = {}) {
  await ensureDatabase(database, { recreate });
  await applyMigrations(database);
}

// Run directly from the command line ("node scripts/migrate.js")
if (require.main === module) {
  migrate()
    .then(() => {
      console.log(`Database "${config.db.database}" is up to date.`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}

module.exports = { migrate };
