const db = require('../src/db');
const { api, createAccount, postTransaction } = require('./helpers');

afterAll(() => db.pool.end());

const history = (accountId, query = '') => api().get(`/api/accounts/${accountId}/transactions${query}`);

describe('GET /api/accounts/:id/transactions', () => {
  let acc;

  // 5 credits + 3 debits, posted one after another so created_at increases.
  beforeAll(async () => {
    acc = await createAccount('History');
    for (let i = 1; i <= 5; i++) {
      await postTransaction(acc.id, { type: 'credit', amount: 100 * i, reference_id: `c${i}` });
    }
    for (let i = 1; i <= 3; i++) {
      await postTransaction(acc.id, { type: 'debit', amount: i, reference_id: `d${i}` });
    }
  });

  test('returns all types, latest first, with default pagination', async () => {
    const res = await history(acc.id);
    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.reference_id)).toEqual(['d3', 'd2', 'd1', 'c5', 'c4', 'c3', 'c2', 'c1']);
    expect(res.body.pagination).toEqual({
      page: 1,
      limit: 10,
      total_records: 8,
      total_pages: 1,
      has_next_page: false,
      has_previous_page: false,
    });
    expect(res.body.filters).toEqual({ type: null });

    // created_at really is in descending order
    const times = res.body.data.map((t) => new Date(t.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  test('filters by type=credit', async () => {
    const res = await history(acc.id, '?type=credit');
    expect(res.body.data).toHaveLength(5);
    expect(res.body.data.every((t) => t.type === 'credit')).toBe(true);
    expect(res.body.pagination.total_records).toBe(5);
  });

  test('filters by type=debit', async () => {
    const res = await history(acc.id, '?type=debit');
    expect(res.body.data.map((t) => t.reference_id)).toEqual(['d3', 'd2', 'd1']);
  });

  test('empty ?type= means both types', async () => {
    const res = await history(acc.id, '?type=');
    expect(res.body.pagination.total_records).toBe(8);
  });

  test('paginates correctly across pages without gaps or repeats', async () => {
    const p1 = await history(acc.id, '?page=1&limit=3');
    const p2 = await history(acc.id, '?page=2&limit=3');
    const p3 = await history(acc.id, '?page=3&limit=3');

    expect(p1.body.pagination).toMatchObject({ page: 1, limit: 3, total_records: 8, total_pages: 3, has_next_page: true, has_previous_page: false });
    expect(p3.body.pagination).toMatchObject({ page: 3, has_next_page: false, has_previous_page: true });

    const all = [...p1.body.data, ...p2.body.data, ...p3.body.data].map((t) => t.reference_id);
    expect(all).toEqual(['d3', 'd2', 'd1', 'c5', 'c4', 'c3', 'c2', 'c1']);
  });

  test('pagination combined with a type filter', async () => {
    const res = await history(acc.id, '?type=credit&page=2&limit=2');
    expect(res.body.data.map((t) => t.reference_id)).toEqual(['c3', 'c2']);
    expect(res.body.pagination).toMatchObject({ total_records: 5, total_pages: 3 });
  });

  test('a page beyond the last page returns an empty list (not an error)', async () => {
    const res = await history(acc.id, '?page=99&limit=10');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total_pages).toBe(1);
  });

  test('an account with no transactions returns an empty list', async () => {
    const empty = await createAccount();
    const res = await history(empty.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toMatchObject({ total_records: 0, total_pages: 0 });
  });

  test.each([
    ['page=0', 'INVALID_PAGINATION'],
    ['page=-1', 'INVALID_PAGINATION'],
    ['page=abc', 'INVALID_PAGINATION'],
    ['page=1.5', 'INVALID_PAGINATION'],
    ['limit=0', 'INVALID_PAGINATION'],
    ['limit=101', 'INVALID_PAGINATION'],
    ['page=1&page=2', 'INVALID_PAGINATION'],
    ['type=refund', 'INVALID_TRANSACTION_TYPE'],
  ])('?%s -> 400 %s', async (query, code) => {
    const res = await history(acc.id, `?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
  });

  test('unknown account -> 404', async () => {
    const res = await history('00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  test('only returns transactions of the requested account', async () => {
    const other = await createAccount();
    await postTransaction(other.id, { type: 'credit', amount: 1, reference_id: 'c1' }); // same ref, other account
    const res = await history(acc.id);
    expect(res.body.data.every((t) => t.account_id === acc.id)).toBe(true);
    expect(res.body.pagination.total_records).toBe(8);
  });
});
