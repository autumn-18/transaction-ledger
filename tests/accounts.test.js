const db = require('../src/db');
const { api, createAccount } = require('./helpers');

afterAll(() => db.pool.end());

describe('POST /api/accounts', () => {
  test('creates an account with balance 0 and system-generated id/created_at', async () => {
    const res = await api().post('/api/accounts').send({ name: '  Ravi Kumar  ' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ name: 'Ravi Kumar', balance: 0 }); // name is trimmed
    expect(res.body.data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(res.body.data.created_at).toString()).not.toBe('Invalid Date');
  });

  test.each([
    ['missing name', {}],
    ['empty name', { name: '' }],
    ['whitespace-only name', { name: '   ' }],
    ['non-string name', { name: 123 }],
    ['name too long', { name: 'a'.repeat(256) }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await api().post('/api/accounts').send(body);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('name');
  });

  test('does not allow the client to set an initial balance', async () => {
    const res = await api().post('/api/accounts').send({ name: 'Rich', balance: 1000000 });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('balance');
  });

  test('does not allow the client to set id or created_at', async () => {
    const res = await api()
      .post('/api/accounts')
      .send({ name: 'X', id: '11111111-1111-1111-1111-111111111111', created_at: '2020-01-01' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['created_at', 'id']);
  });

  test('rejects malformed JSON with INVALID_REQUEST_BODY', async () => {
    const res = await api().post('/api/accounts').set('Content-Type', 'application/json').send('{"name": "Ravi",');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST_BODY');
  });

  test('rejects a JSON array body', async () => {
    const res = await api().post('/api/accounts').send([{ name: 'Ravi' }]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST_BODY');
  });

  test('rejects a request without a JSON content type', async () => {
    const res = await api().post('/api/accounts').set('Content-Type', 'text/plain').send('name=Ravi');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST_BODY');
  });
});

describe('GET /api/accounts/:id and /balance', () => {
  test('returns the account and its balance', async () => {
    const account = await createAccount('Asha');

    const accRes = await api().get(`/api/accounts/${account.id}`);
    expect(accRes.status).toBe(200);
    expect(accRes.body.data).toEqual(account);

    const balRes = await api().get(`/api/accounts/${account.id}/balance`);
    expect(balRes.status).toBe(200);
    expect(balRes.body.data).toEqual({ account_id: account.id, balance: 0 });
  });

  test('accepts an upper-case UUID', async () => {
    const account = await createAccount();
    const res = await api().get(`/api/accounts/${account.id.toUpperCase()}/balance`);
    expect(res.status).toBe(200);
    expect(res.body.data.account_id).toBe(account.id);
  });

  test('returns 404 ACCOUNT_NOT_FOUND for an unknown (valid) UUID', async () => {
    const res = await api().get('/api/accounts/00000000-0000-4000-8000-000000000000/balance');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  test('returns 400 INVALID_ACCOUNT_ID for a malformed id', async () => {
    const res = await api().get('/api/accounts/12345/balance');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ACCOUNT_ID');
  });
});

describe('unknown routes', () => {
  test('return 404 ROUTE_NOT_FOUND in the standard error shape', async () => {
    const res = await api().get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND', message: expect.any(String) },
    });
  });
});
