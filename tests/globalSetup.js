/**
 * Runs ONCE before all tests: wipes and rebuilds the TEST database
 * (DB_NAME_TEST, default "ledger_test") so every run starts clean.
 * database (DB_NAME) is never touched.
 */
const { migrate } = require('../scripts/migrate');
const config = require('../src/config');

module.exports = async () => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Refusing to reset a database outside NODE_ENV=test');
  }
  await migrate({ database: config.db.database, recreate: true });
};
