const db = require('../src/db');
const { api, uniqueRef, createAccount, credit, getBalance, postTransaction } = require('./helpers');

afterAll(() => db.pool.end());

const transfer = (body) => api().post('/api/transfers').send(body);
const MISSING = '00000000-0000-4000-8000-000000000000';
const MISSING_2 = '11111111-1111-4111-8111-111111111111';

const ledgerRowCount = async () =>
  (await db.query('SELECT (SELECT COUNT(*) FROM transactions)::int AS t, (SELECT COUNT(*) FROM transfers)::int AS tr')).rows[0];

describe('POST /api/transfers', () => {
  test('moves money: debit on source, credit on destination, linked by transfer_id', async () => {
    const from = await createAccount('From');
    const to = await createAccount('To');
    await credit(from.id, 1000);

    const res = await transfer({
      from_account_id: from.id,
      to_account_id: to.id,
      amount: 250.25,
      description: 'Rent share',
      reference_id: 'rent-oct',
    });

    expect(res.status).toBe(201);
    const { transfer: t, transactions, balances } = res.body.data;
    expect(t).toMatchObject({ from_account_id: from.id, to_account_id: to.id, amount: 250.25, reference_id: 'rent-oct' });
    expect(transactions.debit).toMatchObject({ account_id: from.id, type: 'debit', amount: 250.25, transfer_id: t.id });
    expect(transactions.credit).toMatchObject({ account_id: to.id, type: 'credit', amount: 250.25, transfer_id: t.id });
    expect(balances).toEqual({
      from_account: { id: from.id, balance: 749.75 },
      to_account: { id: to.id, balance: 250.25 },
    });
    expect(await getBalance(from.id)).toBe(749.75);
    expect(await getBalance(to.id)).toBe(250.25);
  });

  test('legs get an automatic description when none is given', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await credit(from.id, 10);
    const res = await transfer({ from_account_id: from.id, to_account_id: to.id, amount: 5, reference_id: uniqueRef() });
    expect(res.body.data.transactions.debit.description).toBe(`Transfer to account ${to.id}`);
    expect(res.body.data.transactions.credit.description).toBe(`Transfer from account ${from.id}`);
  });

  test('insufficient balance: 422 and NOTHING is written (no transfer row, no legs)', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await credit(from.id, 100);
    const before = await ledgerRowCount();

    const res = await transfer({ from_account_id: from.id, to_account_id: to.id, amount: 100.01, reference_id: uniqueRef() });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await getBalance(from.id)).toBe(100);
    expect(await getBalance(to.id)).toBe(0);
    expect(await ledgerRowCount()).toEqual(before);
  });

  test('ATOMICITY: if the credit leg fails AFTER the debit leg succeeded, the debit is rolled back', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await credit(from.id, 500);
    await credit(to.id, 999999999999.99); // destination is full: any credit will overflow
    const before = await ledgerRowCount();

    const res = await transfer({ from_account_id: from.id, to_account_id: to.id, amount: 1, reference_id: uniqueRef() });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BALANCE_LIMIT_EXCEEDED');
    expect(await getBalance(from.id)).toBe(500); // the debit did NOT stick
    expect(await getBalance(to.id)).toBe(999999999999.99);
    expect(await ledgerRowCount()).toEqual(before);
  });

  test('source account not found -> 404', async () => {
    const to = await createAccount();
    const res = await transfer({ from_account_id: MISSING, to_account_id: to.id, amount: 1, reference_id: uniqueRef() });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  test('destination account not found -> 404, source unchanged', async () => {
    const from = await createAccount();
    await credit(from.id, 50);
    const res = await transfer({ from_account_id: from.id, to_account_id: MISSING, amount: 10, reference_id: uniqueRef() });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain(MISSING);
    expect(await getBalance(from.id)).toBe(50);
  });

  test('same source and destination -> 400 SAME_ACCOUNT_TRANSFER', async () => {
    const acc = await createAccount();
    const res = await transfer({ from_account_id: acc.id, to_account_id: acc.id, amount: 1, reference_id: uniqueRef() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SAME_ACCOUNT_TRANSFER');
  });

  test('same account written in different letter case is still the same account', async () => {
    const acc = await createAccount();
    const res = await transfer({ from_account_id: acc.id, to_account_id: acc.id.toUpperCase(), amount: 1, reference_id: uniqueRef() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SAME_ACCOUNT_TRANSFER');
  });

  test('repeating a transfer with the same reference_id -> 409, money moves only once', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await credit(from.id, 100);
    const body = { from_account_id: from.id, to_account_id: to.id, amount: 30, reference_id: uniqueRef() };

    expect((await transfer(body)).status).toBe(201);
    const again = await transfer(body);

    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(await getBalance(from.id)).toBe(70);
    expect(await getBalance(to.id)).toBe(30);
  });

  test('reference_id already used on the DESTINATION account -> 409, nothing moves', async () => {
    const from = await createAccount();
    const to = await createAccount();
    await credit(from.id, 100);
    const ref = uniqueRef();
    await postTransaction(to.id, { type: 'credit', amount: 1, reference_id: ref });

    const res = await transfer({ from_account_id: from.id, to_account_id: to.id, amount: 10, reference_id: ref });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('destination');
    expect(await getBalance(from.id)).toBe(100);
    expect(await getBalance(to.id)).toBe(1);
  });

  test.each([
    ['missing from_account_id', { to_account_id: MISSING, amount: 1, reference_id: 'r' }, 'VALIDATION_ERROR'],
    ['malformed to_account_id', { from_account_id: MISSING, to_account_id: 'abc', amount: 1, reference_id: 'r' }, 'INVALID_ACCOUNT_ID'],
    ['zero amount', { from_account_id: MISSING, to_account_id: MISSING_2, amount: 0, reference_id: 'r' }, 'INVALID_AMOUNT'],
    ['missing reference_id', { from_account_id: MISSING, to_account_id: MISSING_2, amount: 1 }, 'VALIDATION_ERROR'],
  ])('%s -> 400 %s', async (_label, body, code) => {
    const res = await transfer(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });
});
