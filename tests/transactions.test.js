const db = require('../src/db');
const { api, uniqueRef, createAccount, postTransaction, credit, getBalance } = require('./helpers');

afterAll(() => db.pool.end());

const countRows = async (accountId) =>
  (await db.query('SELECT COUNT(*)::int AS n FROM transactions WHERE account_id = $1', [accountId])).rows[0].n;

describe('POST /api/accounts/:id/transactions - balance rules', () => {
  test('credit increases the balance', async () => {
    const acc = await createAccount();
    const res = await postTransaction(acc.id, {
      type: 'credit',
      amount: 1500.75,
      description: 'Salary',
      reference_id: 'salary-oct',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.transaction).toMatchObject({
      account_id: acc.id,
      type: 'credit',
      amount: 1500.75,
      description: 'Salary',
      reference_id: 'salary-oct',
      transfer_id: null,
    });
    expect(res.body.data.account).toEqual({ id: acc.id, balance: 1500.75 });
    expect(await getBalance(acc.id)).toBe(1500.75);
  });

  test('debit decreases the balance', async () => {
    const acc = await createAccount();
    await credit(acc.id, 1000);
    const res = await postTransaction(acc.id, { type: 'debit', amount: 399.99, reference_id: uniqueRef() });

    expect(res.status).toBe(201);
    expect(res.body.data.account.balance).toBe(600.01);
  });

  test('a debit of the exact full balance is allowed (balance becomes 0)', async () => {
    const acc = await createAccount();
    await credit(acc.id, 250);
    const res = await postTransaction(acc.id, { type: 'debit', amount: 250, reference_id: uniqueRef() });
    expect(res.status).toBe(201);
    expect(res.body.data.account.balance).toBe(0);
  });

  test('decimal maths is exact (0.1 + 0.2 = 0.3)', async () => {
    const acc = await createAccount();
    await credit(acc.id, 0.1);
    await credit(acc.id, 0.2);
    expect(await getBalance(acc.id)).toBe(0.3);
  });

  test('debit with insufficient balance is rejected and changes nothing', async () => {
    const acc = await createAccount();
    await credit(acc.id, 100);
    const res = await postTransaction(acc.id, { type: 'debit', amount: 100.01, reference_id: uniqueRef() });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
      current_balance: 100,
      requested_amount: 100.01,
    });
    expect(await getBalance(acc.id)).toBe(100);
    expect(await countRows(acc.id)).toBe(1); // only the original credit
  });

  test('a rejected debit does NOT burn the reference_id (it can be used later)', async () => {
    const acc = await createAccount();
    const ref = uniqueRef();
    const first = await postTransaction(acc.id, { type: 'debit', amount: 50, reference_id: ref });
    expect(first.status).toBe(422);

    await credit(acc.id, 50);
    const second = await postTransaction(acc.id, { type: 'debit', amount: 50, reference_id: ref });
    expect(second.status).toBe(201);
  });

  test('returns 404 when the account does not exist', async () => {
    const res = await postTransaction('00000000-0000-4000-8000-000000000000', {
      type: 'credit',
      amount: 10,
      reference_id: uniqueRef(),
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  test('returns 400 for a malformed account id', async () => {
    const res = await postTransaction('abc', { type: 'credit', amount: 10, reference_id: uniqueRef() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ACCOUNT_ID');
  });

  test('credit that would overflow the maximum balance is rejected', async () => {
    const acc = await createAccount();
    await credit(acc.id, 999999999999.99);
    const res = await postTransaction(acc.id, { type: 'credit', amount: 1, reference_id: uniqueRef() });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BALANCE_LIMIT_EXCEEDED');
    expect(await getBalance(acc.id)).toBe(999999999999.99);
  });
});

describe('POST /api/accounts/:id/transactions - duplicate reference_id', () => {
  test('same reference_id on the same account: 409, no new row, balance unchanged', async () => {
    const acc = await createAccount();
    const ref = uniqueRef();
    const first = await postTransaction(acc.id, { type: 'credit', amount: 500, reference_id: ref });
    expect(first.status).toBe(201);

    const second = await postTransaction(acc.id, { type: 'credit', amount: 500, reference_id: ref });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(second.body.error.existing_transaction.id).toBe(first.body.data.transaction.id);

    expect(await getBalance(acc.id)).toBe(500);
    expect(await countRows(acc.id)).toBe(1);
  });

  test('duplicate is detected even if the second request has a different amount/type', async () => {
    const acc = await createAccount();
    const ref = uniqueRef();
    await postTransaction(acc.id, { type: 'credit', amount: 500, reference_id: ref });
    const res = await postTransaction(acc.id, { type: 'debit', amount: 1, reference_id: ref });
    expect(res.status).toBe(409);
    expect(await getBalance(acc.id)).toBe(500);
  });

  test('retrying a successful debit returns 409 (not 422) even if balance is now too low', async () => {
    const acc = await createAccount();
    await credit(acc.id, 100);
    const ref = uniqueRef();
    expect((await postTransaction(acc.id, { type: 'debit', amount: 100, reference_id: ref })).status).toBe(201);

    const retry = await postTransaction(acc.id, { type: 'debit', amount: 100, reference_id: ref });
    expect(retry.status).toBe(409);
    expect(await getBalance(acc.id)).toBe(0);
  });

  test('reference_id is compared after trimming spaces', async () => {
    const acc = await createAccount();
    await postTransaction(acc.id, { type: 'credit', amount: 5, reference_id: 'abc' });
    const res = await postTransaction(acc.id, { type: 'credit', amount: 5, reference_id: '  abc  ' });
    expect(res.status).toBe(409);
  });

  test('the same reference_id CAN be used on different accounts', async () => {
    const a = await createAccount('A');
    const b = await createAccount('B');
    const ref = uniqueRef();
    expect((await postTransaction(a.id, { type: 'credit', amount: 10, reference_id: ref })).status).toBe(201);
    expect((await postTransaction(b.id, { type: 'credit', amount: 20, reference_id: ref })).status).toBe(201);
    expect(await getBalance(a.id)).toBe(10);
    expect(await getBalance(b.id)).toBe(20);
  });
});

describe('POST /api/accounts/:id/transactions - validation', () => {
  let acc;
  beforeAll(async () => {
    acc = await createAccount();
  });

  test.each([
    ['missing type', { amount: 10, reference_id: 'r' }, 'INVALID_TRANSACTION_TYPE'],
    ['invalid type', { type: 'refund', amount: 10, reference_id: 'r' }, 'INVALID_TRANSACTION_TYPE'],
    ['upper-case type', { type: 'CREDIT', amount: 10, reference_id: 'r' }, 'INVALID_TRANSACTION_TYPE'],
    ['missing amount', { type: 'credit', reference_id: 'r' }, 'INVALID_AMOUNT'],
    ['zero amount', { type: 'credit', amount: 0, reference_id: 'r' }, 'INVALID_AMOUNT'],
    ['negative amount', { type: 'credit', amount: -5, reference_id: 'r' }, 'INVALID_AMOUNT'],
    ['string amount', { type: 'credit', amount: '10', reference_id: 'r' }, 'INVALID_AMOUNT'],
    ['3 decimal places', { type: 'credit', amount: 10.123, reference_id: 'r' }, 'INVALID_AMOUNT'],
    ['amount too large', { type: 'credit', amount: 1e13, reference_id: 'r' }, 'INVALID_AMOUNT'],
    ['missing reference_id', { type: 'credit', amount: 10 }, 'VALIDATION_ERROR'],
    ['blank reference_id', { type: 'credit', amount: 10, reference_id: '   ' }, 'VALIDATION_ERROR'],
    ['numeric reference_id', { type: 'credit', amount: 10, reference_id: 42 }, 'VALIDATION_ERROR'],
    ['non-string description', { type: 'credit', amount: 10, reference_id: 'r', description: 5 }, 'VALIDATION_ERROR'],
    ['account_id in body', { type: 'credit', amount: 10, reference_id: 'r', account_id: 'x' }, 'VALIDATION_ERROR'],
  ])('%s -> 400 %s', async (_label, body, code) => {
    const res = await postTransaction(acc.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
    expect(await getBalance(acc.id)).toBe(0);
  });

  test('several problems at once are all reported', async () => {
    const res = await postTransaction(acc.id, { type: 'x', amount: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toEqual(['type', 'amount', 'reference_id']);
  });

  test('validation happens before the account lookup (400 wins over 404)', async () => {
    const res = await postTransaction('00000000-0000-4000-8000-000000000000', { type: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('Immutability through the API', () => {
  test.each(['put', 'patch', 'delete'])('%s on a transaction returns 405 and changes nothing', async (method) => {
    const acc = await createAccount();
    const { transaction } = await credit(acc.id, 100);

    const res = await api()[method](`/api/accounts/${acc.id}/transactions/${transaction.id}`).send({ amount: 1 });
    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('TRANSACTION_IMMUTABLE');

    const { rows } = await db.query('SELECT amount FROM transactions WHERE id = $1', [transaction.id]);
    expect(rows[0].amount).toBe('100.00');
    expect(await getBalance(acc.id)).toBe(100);
  });
});
