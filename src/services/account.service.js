/**
 * Account business logic.
 */
const db = require('../db');
const accountRepo = require('../repositories/account.repository');
const { errors } = require('../utils/errors');
const { toAccount } = require('../utils/mappers');

async function createAccount({ name }) {
  const row = await accountRepo.create(db, { name });
  return toAccount(row);
}

async function getAccount(accountId) {
  const row = await accountRepo.findById(db, accountId);
  if (!row) throw errors.accountNotFound(accountId);
  return toAccount(row);
}

async function getBalance(accountId) {
  const account = await getAccount(accountId);
  return { account_id: account.id, balance: account.balance };
}

module.exports = { createAccount, getAccount, getBalance };
