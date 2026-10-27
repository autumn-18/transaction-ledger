/**
 * Data-integrity tests: database-level protections and behaviour under
 * many simultaneous requests (concurrency).
 */
const db = require('../src/db');
const { api, uniqueRef, createAccount, postTransaction, credit, getBalance } = require('./helpers');

afterAll(() => db.pool.end());

describe('Database-level immutability (triggers)', () => {
  test('UPDATE on a transaction is blocked by the database itself', async () => {
    const acc = await createAccount();
    const { transaction } = await credit(acc.id, 100);
    await expect(db.query('UPDATE transactions SET amount = 1 WHERE id = $1', [transaction.id])).rejects.toThrow(
      /immutable/
    );
  });

  test('DELETE on a transaction is blocked by the database itself', async () => {
    const acc = await createAccount();
    const { transaction } = await credit(acc.id, 100);
    await expect(db.query('DELETE FROM transactions WHERE id = $1', [transaction.id])).rejects.toThrow(/immutable/);
  });

  test('an account with transactions cannot be deleted (foreign key RESTRICT)', async () => {
    const acc = await createAccount();
    await credit(acc.id, 1);
    await expect(db.query('DELETE FROM accounts WHERE id = $1', [acc.id])).rejects.toThrow(/foreign key/);
  });

  test('the database refuses a negative balance even if the code had a bug', async () => {
    const acc = await createAccount();
    await expect(db.query('UPDATE accounts SET balance = -1 WHERE id = $1', [acc.id])).rejects.toThrow(
      /chk_accounts_balance_non_negative/
    );
  });

  test('the database refuses a duplicate (account_id, reference_id) even if the code had a bug', async () => {
    const acc = await createAccount();
    await credit(acc.id, 1, 'x');
    await expect(
      db.query("INSERT INTO transactions (account_id, type, amount, reference_id) VALUES ($1, 'credit', 1, 'x')", [acc.id])
    ).rejects.toThrow(/uq_transactions_account_reference/);
  });

  test('the database refuses invalid type and non-positive amount', async () => {
    const acc = await createAccount();
    await expect(
      db.query("INSERT INTO transactions (account_id, type, amount, reference_id) VALUES ($1, 'loan', 1, 'y')", [acc.id])
    ).rejects.toThrow(/chk_transactions_type/);
    await expect(
      db.query("INSERT INTO transactions (account_id, type, amount, reference_id) VALUES ($1, 'credit', 0, 'z')", [acc.id])
    ).rejects.toThrow(/chk_transactions_amount_positive/);
  });
});

describe('Concurrency', () => {
  test('10 simultaneous debits of 100 on a balance of 500: exactly 5 succeed, balance ends at 0', async () => {
    const acc = await createAccount();
    await credit(acc.id, 500);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        postTransaction(acc.id, { type: 'debit', amount: 100, reference_id: uniqueRef('debit') })
      )
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 422)).toHaveLength(5);
    expect(await getBalance(acc.id)).toBe(0);
  });

  test('5 simultaneous requests with the SAME reference_id create exactly one transaction', async () => {
    const acc = await createAccount();
    const ref = uniqueRef('same');

    const results = await Promise.all(
      Array.from({ length: 5 }, () => postTransaction(acc.id, { type: 'credit', amount: 100, reference_id: ref }))
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(await getBalance(acc.id)).toBe(100);
  });

  test('opposite transfers A->B and B->A at the same time do not deadlock and conserve money', async () => {
    const a = await createAccount('A');
    const b = await createAccount('B');
    await credit(a.id, 1000);
    await credit(b.id, 1000);

    const requests = [];
    for (let i = 0; i < 20; i++) {
      const [from, to] = i % 2 === 0 ? [a.id, b.id] : [b.id, a.id];
      requests.push(
        api().post('/api/transfers').send({ from_account_id: from, to_account_id: to, amount: 10, reference_id: uniqueRef('t') })
      );
    }
    const results = await Promise.all(requests);

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect((await getBalance(a.id)) + (await getBalance(b.id))).toBe(2000); // no money created or lost
  });
});

describe('Balance consistency', () => {
  test('for EVERY account, balance = sum(credits) - sum(debits)', async () => {
    // Runs after all the tests above (and in the other files), so it checks a lot of real data.
    const { rows } = await db.query(`
      SELECT a.id, a.balance,
             COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0) AS ledger_sum
        FROM accounts a
        LEFT JOIN transactions t ON t.account_id = a.id
       GROUP BY a.id, a.balance
      HAVING a.balance <> COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0)`);
    expect(rows).toEqual([]); // no account where they differ
  });
});
