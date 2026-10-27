# Transaction Ledger API

A simple, consistent **transaction ledger** built with **Node.js, Express and PostgreSQL**.

It lets you:

- create accounts
- add **credit** (money in) and **debit** (money out) transactions
- read an account's **balance** and **transaction history** (filtering, pagination, latest first)
- **transfer** money between two accounts atomically

The main goal is **data integrity**: balances can never go wrong, duplicates are never recorded twice, and ledger records can never be edited or deleted.

> Full endpoint reference: **[docs/API.md](docs/API.md)**

---

## Table of contents

1. [Tech stack](#1-tech-stack)
2. [Project structure](#2-project-structure)
3. [Setup from scratch](#3-setup-from-scratch)
4. [Try the API](#4-try-the-api)
5. [Run the tests](#5-run-the-tests)
6. [How data integrity is guaranteed](#6-how-data-integrity-is-guaranteed)
7. [Database design](#7-database-design)
8. [Assumptions](#8-assumptions)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Tech stack

| What | Why |
|---|---|
| **Node.js 18+** | JavaScript runtime |
| **Express 5** | Web framework. Version 5 passes errors from `async` handlers to the error handler automatically, so controllers need no `try/catch`. |
| **PostgreSQL 13+** | Relational database with real transactions, row locks, `NUMERIC` (exact money) and constraints |
| **pg** (node-postgres) | PostgreSQL driver, used with plain SQL (no ORM) so you can see exactly what runs |
| **dotenv** | Loads settings from a `.env` file |
| **Jest + Supertest** | Automated tests that call the real API against a real test database |

---

## 2. Project structure

```
transaction-ledger/
├── db/
│   └── migrations/
│       └── 001_create_ledger_schema.sql   # tables, constraints, indexes, immutability triggers
├── docs/
│   └── API.md                             # API documentation
├── scripts/
│   └── migrate.js                         # creates the DB (if needed) and runs migrations
├── src/
│   ├── app.js                             # builds the Express app (used by server + tests)
│   ├── server.js                          # starts the HTTP server
│   ├── config/index.js                    # all settings in one place
│   ├── db/index.js                        # connection pool + withTransaction() helper
│   ├── routes/                            # URL -> controller mapping
│   ├── controllers/                       # HTTP layer: read request, send response
│   ├── validators/                        # check incoming data, build 400 errors
│   ├── services/                          # business rules (balance, duplicates, transfers)
│   ├── repositories/                      # the ONLY place with SQL
│   ├── middlewares/                       # account-ID check, error handler, 404 handler
│   └── utils/                             # AppError + error codes, DB-row -> JSON mappers
├── tests/                                 # 91 automated tests
├── .env.example                           # copy to .env
├── docker-compose.yml                     # optional: PostgreSQL in Docker
└── package.json
```

### How one request flows through the layers

```
HTTP request
   │
   ▼
routes        "POST /api/accounts/:accountId/transactions -> addTransaction"
   │
   ▼
middleware    is :accountId a valid UUID?  (no -> 400)
   │
   ▼
controller    calls the validator, then the service, then sends JSON
   │
   ▼
validator     type/amount/reference_id OK?  (no -> 400 with details)
   │
   ▼
service       BEGIN → lock account → duplicate? → enough money? → update balance + insert row → COMMIT
   │
   ▼
repository    runs the SQL
   │
   ▼
PostgreSQL    constraints and triggers check everything one last time
```

**Why layers?** Each file has one job. If you want to change *how data is stored*, you only touch repositories. If you want to change *a business rule*, you only touch services. That keeps the code easy to read and change.

---

## 3. Setup from scratch

### Step 1 — Install the prerequisites

- **Node.js 18 or newer** → https://nodejs.org (check with `node -v`)
- **PostgreSQL 13 or newer**, either:
  - **Option A:** installed on your computer → https://www.postgresql.org/download/ (remember the password you set for the `postgres` user), **or**
  - **Option B:** **Docker Desktop** → https://www.docker.com/products/docker-desktop/

### Step 2 — Get the code and install packages

```bash
cd transaction-ledger
npm install
```

### Step 3 — Start PostgreSQL

**Option A (local install):** make sure the PostgreSQL service is running. On Windows it usually starts automatically (check *Services* → `postgresql-x64-16`). On macOS with Homebrew: `brew services start postgresql@16`.

**Option B (Docker):**

```bash
docker compose up -d
```

This starts PostgreSQL 16 on port 5432 with user `postgres` / password `postgres`.

### Step 4 — Create your `.env` file

```bash
# macOS / Linux / Git Bash
cp .env.example .env

# Windows Command Prompt
copy .env.example .env
```

Open `.env` and set `DB_PASSWORD` (and the others, if needed) to match your PostgreSQL.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the API listens on |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `postgres` | PostgreSQL user |
| `DB_PASSWORD` | `postgres` | PostgreSQL password |
| `DB_NAME` | `ledger_db` | Database for the app |
| `DB_NAME_TEST` | `ledger_test` | Database for tests (**wiped on every test run**) |
| `DB_POOL_MAX` | `10` | Max open DB connections |

### Step 5 — Create the database and tables

```bash
npm run db:migrate
```

Expected output:

```
Created database "ledger_db"
Applied migration 001_create_ledger_schema.sql
Database "ledger_db" is up to date.
```

You can run this command again at any time; already-applied migrations are skipped.

### Step 6 — Start the API

```bash
npm run dev     # restarts automatically when you edit code (nodemon)
# or
npm start       # plain node
```

You should see `Ledger API running on http://localhost:3000`.

Quick check: open http://localhost:3000/health in a browser → `{"success":true,"data":{"status":"ok"}}`.

### Available scripts

| Command | What it does |
|---|---|
| `npm run db:migrate` | Create the database if missing and apply new migrations |
| `npm run dev` | Start with auto-reload |
| `npm start` | Start normally |
| `npm test` | Rebuild the **test** database and run all tests |

---

## 4. Try the API

The examples use `curl` (works in macOS/Linux terminals and **Git Bash** on Windows). On Windows you can also use **Postman**: same URLs, set the body to *raw → JSON*.

```bash
# 1. Create two accounts (copy the "id" values from the responses)
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Ravi Kumar"}'

curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Asha Verma"}'

# 2. Add money to Ravi's account (replace <RAVI_ID>)
curl -X POST http://localhost:3000/api/accounts/<RAVI_ID>/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "credit", "amount": 1000, "description": "Salary", "reference_id": "salary-oct-2026"}'

# 3. Send the SAME request again -> 409 DUPLICATE_TRANSACTION, balance unchanged

# 4. Spend some money
curl -X POST http://localhost:3000/api/accounts/<RAVI_ID>/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "debit", "amount": 250.50, "description": "Groceries", "reference_id": "bill-7781"}'

# 5. Check the balance -> 749.5
curl http://localhost:3000/api/accounts/<RAVI_ID>/balance

# 6. Transfer 100 from Ravi to Asha
curl -X POST http://localhost:3000/api/transfers \
  -H "Content-Type: application/json" \
  -d '{"from_account_id": "<RAVI_ID>", "to_account_id": "<ASHA_ID>", "amount": 100, "reference_id": "tr-001"}'

# 7. History: only debits, 5 per page, page 1
curl "http://localhost:3000/api/accounts/<RAVI_ID>/transactions?type=debit&page=1&limit=5"
```

---

## 5. Run the tests

```bash
npm test
```

The tests:

- drop and re-create the **test** database (`DB_NAME_TEST`). Your normal `ledger_db` is never touched.
- call the real API (via Supertest) against a real PostgreSQL. Nothing is mocked.
- cover every requirement: validation, duplicates, insufficient balance, pagination, sorting, transfers, rollback, immutability, **concurrency** (10 debits at once, 5 identical requests at once, 20 opposite transfers at once), and a final check that **every account's balance equals the sum of its ledger entries**.

Expected: `Tests: 91 passed, 91 total`.

---

## 6. How data integrity is guaranteed

Every important rule is protected **twice**: once in the code (for clear error messages) and once in the database (so even a bug or a manual SQL query can't break it).

| Requirement | In the code | In the database |
|---|---|---|
| Client can't set initial balance | Validator rejects `balance` in the body | `balance DEFAULT 0` |
| Balance never negative | Debit uses `UPDATE … WHERE balance >= amount` | `CHECK (balance >= 0)` |
| Same `reference_id` once per account | Duplicate lookup before writing → 409 | `UNIQUE (account_id, reference_id)` |
| Type is credit/debit, amount > 0 | Validator → 400 | `CHECK` constraints |
| **Immutability** | No update/delete endpoints; PUT/PATCH/DELETE → 405 | Trigger blocks `UPDATE`/`DELETE` on `transactions` and `transfers` |
| Accounts with history can't vanish | No delete endpoint | Foreign keys with `ON DELETE RESTRICT` |
| **Atomicity** | `withTransaction()`: `BEGIN` … `COMMIT`, or `ROLLBACK` on any error | PostgreSQL transactions |
| **Two requests at the same time** | Account row locked with `SELECT … FOR UPDATE` | Row-level locks |
| No deadlocks in transfers | Both accounts locked in sorted-ID order | — |
| Exact money maths | Amounts sent to SQL as strings; maths done by PostgreSQL | `NUMERIC(14,2)`, never `FLOAT` |
| History count matches rows | Count + rows read in one `REPEATABLE READ` snapshot | — |

### Why the row lock matters (simple example)

Balance is ₹1,000. Two debits of ₹800 arrive at the same instant.

- **Without a lock:** both read ₹1,000, both say "enough money", balance becomes **−₹600**. ❌
- **With `FOR UPDATE`:** request 2 *waits* until request 1 commits, then reads ₹200 and is rejected. ✅

### You can verify balance consistency yourself

```sql
-- Should return ZERO rows
SELECT a.id, a.balance,
       COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0) AS ledger_sum
  FROM accounts a
  LEFT JOIN transactions t ON t.account_id = a.id
 GROUP BY a.id, a.balance
HAVING a.balance <> COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0);
```

---

## 7. Database design

```
accounts                        transfers                          transactions (the ledger)
─────────────────────           ─────────────────────────          ─────────────────────────────
id          UUID  PK            id               UUID  PK          id            UUID  PK
name        VARCHAR(255)        from_account_id  UUID  FK→accounts account_id    UUID  FK→accounts
balance     NUMERIC(14,2)       to_account_id    UUID  FK→accounts type          'credit' | 'debit'
created_at  TIMESTAMPTZ         amount           NUMERIC(14,2)     amount        NUMERIC(14,2)
                                description      VARCHAR(500)      description   VARCHAR(500)
                                reference_id     VARCHAR(100)      reference_id  VARCHAR(100)
                                created_at       TIMESTAMPTZ       transfer_id   UUID  FK→transfers (nullable)
                                                                   created_at    TIMESTAMPTZ
                                                                   UNIQUE (account_id, reference_id)
```

- A normal credit/debit creates **one** `transactions` row (`transfer_id = NULL`).
- A transfer creates **one** `transfers` row and **two** `transactions` rows (a debit and a credit) that point to it with `transfer_id`.
- Index `(account_id, created_at DESC, id DESC)` makes the "history, newest first" query fast.

See `db/migrations/001_create_ledger_schema.sql`. Every constraint there is commented.

---

## 8. Assumptions

1. **One currency.** All amounts are in a single currency (e.g. INR); no currency field or conversion.
2. **Money format.** `amount` must be a JSON **number** (e.g. `150.75`, not `"150.75"`), greater than 0, with **at most 2 decimal places**, and at most `999999999999.99`. Balances are stored as `NUMERIC(14,2)`; a credit that would push a balance above that limit is rejected with `BALANCE_LIMIT_EXCEEDED`.
3. **Amounts are returned as JSON numbers** (e.g. `749.5`). Because all maths happens inside PostgreSQL with exact `NUMERIC`, no precision is lost.
4. **Account IDs are UUIDs** generated by the database. A malformed ID returns `400 INVALID_ACCOUNT_ID`; a well-formed but unknown ID returns `404 ACCOUNT_NOT_FOUND`.
5. **The transaction's account comes from the URL**: `POST /api/accounts/:accountId/transactions`. Sending `account_id` in the body is rejected, so there's no confusion about which one wins.
6. **Duplicates.** A request is a duplicate when the same `reference_id` already exists **for that account**, no matter whether the amount/type/description match. The response is `409 DUPLICATE_TRANSACTION` and includes the original transaction (`existing_transaction`) so the client can see what was recorded.
7. **A rejected request does not use up its `reference_id`.** If a debit fails for insufficient balance, nothing is saved, so the same `reference_id` can be retried later.
8. **`reference_id` and `name` are trimmed** of leading/trailing spaces. `" abc "` and `"abc"` count as the same reference. Matching is case-sensitive (`"ABC"` ≠ `"abc"`).
9. **`description` is optional** (max 500 characters). For transfers without a description, the two legs get automatic text like `Transfer to account <id>`.
10. **Transfers.** Both legs use the transfer's `reference_id`. The transfer is rejected with 409 if that `reference_id` was already used on **either** the source or the destination account. Transferring to the same account is rejected (`400 SAME_ACCOUNT_TRANSFER`).
11. **Unknown fields are rejected** (400) rather than silently ignored, e.g. `balance`, `id`, `created_at`.
12. **Transaction type is case-sensitive**: only lower-case `credit` and `debit` are accepted.
13. **Pagination**: `page` defaults to 1, `limit` defaults to 10, maximum `limit` is 100. A page beyond the last one returns an empty list (200), not an error. An empty `?type=` is treated as "no filter".
14. **Validation runs first**, so a request that is both invalid and for an unknown account gets 400 (not 404). Order of checks: 400 → 404 → 409 → 422.
15. **Insufficient balance and balance-limit errors use 422** (request is well-formed but breaks a business rule); duplicates use **409** (conflict with existing data).
16. **No authentication/authorization**, as it was not part of the requirements. In a real system every endpoint would require a logged-in user who owns the account.
17. **Accounts cannot be updated or deleted** through the API (not required). In the database, an account with transactions can't be deleted at all.
18. **Database administrators are trusted.** The triggers stop `UPDATE`/`DELETE` on ledger rows, but someone with full DB rights could still drop the trigger or the table.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `password authentication failed for user "postgres"` | `DB_PASSWORD` in `.env` doesn't match your PostgreSQL password |
| `connect ECONNREFUSED 127.0.0.1:5432` | PostgreSQL isn't running (start the service, or `docker compose up -d`) |
| `permission denied to create database` | Use a user that can create databases, or create `ledger_db` / `ledger_test` manually, then re-run `npm run db:migrate` |
| `EADDRINUSE :::3000` | Port 3000 is busy. Change `PORT` in `.env` |
| `function gen_random_uuid() does not exist` | Your PostgreSQL is older than 13. Upgrade, or use the Docker option |
| Every POST returns `INVALID_REQUEST_BODY` | Add the header `Content-Type: application/json` (in Postman: Body → raw → JSON) |
