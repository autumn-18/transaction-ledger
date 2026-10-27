const request = require('supertest');
const app = require('../src/app');

const api = () => request(app);

let counter = 0;
/** A reference_id that is unique across the whole test run. */
const uniqueRef = (prefix = 'ref') => `${prefix}-${Date.now()}-${++counter}`;

async function createAccount(name = 'Test User') {
  const res = await api().post('/api/accounts').send({ name });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function postTransaction(accountId, body) {
  return api().post(`/api/accounts/${accountId}/transactions`).send(body);
}

async function credit(accountId, amount, referenceId = uniqueRef('credit')) {
  const res = await postTransaction(accountId, { type: 'credit', amount, reference_id: referenceId });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function getBalance(accountId) {
  const res = await api().get(`/api/accounts/${accountId}/balance`);
  expect(res.status).toBe(200);
  return res.body.data.balance;
}

module.exports = { api, uniqueRef, createAccount, postTransaction, credit, getBalance };
