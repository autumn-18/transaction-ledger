/**
 * Controllers are the "HTTP layer": they read the request, call the
 * validator and the service, and send the response. They contain no
 * business rules and no SQL.
 *
 * Express 5 automatically catches errors thrown inside async handlers and
 * passes them to the error-handling middleware, so no try/catch is needed here.
 */
const accountService = require('../services/account.service');
const { validateCreateAccount } = require('../validators/account.validator');

async function createAccount(req, res) {
  const input = validateCreateAccount(req.body);
  const account = await accountService.createAccount(input);
  res.status(201).json({ success: true, data: account }); // 201 = Created
}

async function getAccount(req, res) {
  const account = await accountService.getAccount(req.params.accountId);
  res.status(200).json({ success: true, data: account });
}

async function getBalance(req, res) {
  const balance = await accountService.getBalance(req.params.accountId);
  res.status(200).json({ success: true, data: balance });
}

module.exports = { createAccount, getAccount, getBalance };
