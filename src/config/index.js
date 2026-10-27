/**
 * Central place for configuration.
 *
 * WHY: instead of reading process.env all over the code, every file imports
 * settings from here. If a setting changes name, we fix it in ONE place.
 */
require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test'; // Jest sets NODE_ENV=test automatically

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    // Tests use their own database so they never touch your real data.
    database: isTest
      ? process.env.DB_NAME_TEST || 'ledger_test'
      : process.env.DB_NAME || 'ledger_db',
    max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
  },
  pagination: {
    defaultPage: 1,
    defaultLimit: 10,
    maxLimit: 100, // stop a client asking for 1,000,000 rows at once
  },
  money: {
    // NUMERIC(14,2) in the DB => largest value is 999,999,999,999.99
    maxAmount: 999999999999.99,
  },
};

module.exports = config;
