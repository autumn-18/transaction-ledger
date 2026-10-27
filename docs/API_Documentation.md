# Transaction Ledger — API Documentation

**Base URL:** `http://localhost:3000`
**Content type:** every request with a body must send `Content-Type: application/json`.

## Contents

- [Response format](#response-format)
- [Error codes](#error-codes)
- [Health check](#health-check)
- [1. Create account](#1-create-account)
- [2. Get account](#2-get-account)
- [3. Get account balance](#3-get-account-balance)
- [4. Add transaction](#4-add-transaction)
- [5. Get transaction history](#5-get-transaction-history)
- [6. Transfer money](#6-transfer-money)
- [7. Edit / delete a transaction (not allowed)](#7-edit--delete-a-transaction-not-allowed)
- [Endpoint summary](#endpoint-summary)

---

## Response format

**Success**

```json
{
  "success": true,
  "data": { }
}
```

**Error** (same format for every error, from every endpoint)

```json
{
  "success": false,
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "'amount' must be greater than 0",
    "details": [
      { "field": "amount", "code": "INVALID_AMOUNT", "message": "'amount' must be greater than 0" }
    ]
  }
}
```

**Data types**

| Type | Format |
|---|---|
| IDs | UUID string, e.g. `"578b937c-a7c3-496f-bd0c-0196c65dcdc0"` |
| Money | JSON number, max 2 decimals, e.g. `1500.75` |
| Timestamps | ISO 8601 in UTC, e.g. `"2026-10-27T18:32:03.435Z"` |

---

## Error codes

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | A field is missing/invalid, an unknown field was sent, or several fields are invalid at once |
| 400 | `INVALID_REQUEST_BODY` | Body is not valid JSON, is not a JSON object, or `Content-Type` is not `application/json` |
| 400 | `INVALID_ACCOUNT_ID` | An account ID is not a valid UUID |
| 400 | `INVALID_TRANSACTION_TYPE` | `type` is not `credit` or `debit` |
| 400 | `INVALID_AMOUNT` | `amount` missing, not a number, ≤ 0, more than 2 decimals, or too large |
| 400 | `INVALID_PAGINATION` | `page`/`limit` not a positive whole number, or `limit` > 100 |
| 400 | `SAME_ACCOUNT_TRANSFER` | Transfer source and destination are the same account |
| 404 | `ACCOUNT_NOT_FOUND` | No account with that ID |
| 404 | `ROUTE_NOT_FOUND` | URL/method doesn't exist |
| 405 | `TRANSACTION_IMMUTABLE` | Tried to PUT/PATCH/DELETE a transaction |
| 409 | `DUPLICATE_TRANSACTION` | `reference_id` already used for this account |
| 413 | `INVALID_REQUEST_BODY` | Body larger than 10 KB |
| 422 | `INSUFFICIENT_BALANCE` | Debit/transfer amount is more than the balance |
| 422 | `BALANCE_LIMIT_EXCEEDED` | Credit would push the balance above 999,999,999,999.99 |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected server problem (details are logged on the server, not sent to the client) |

**Order of checks** for write requests: validation (400) → account exists (404) → duplicate (409) → business rules (422).

---

## Health check

`GET /health`

```json
200 OK
{ "success": true, "data": { "status": "ok" } }
```

---

## 1. Create account

`POST /api/accounts`

Creates an account. The system generates `id` and `created_at`; `balance` always starts at `0`.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | ✅ | 1–255 characters after trimming spaces |

Any other field (`balance`, `id`, `created_at`, …) is rejected.

**Example request**

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "Ravi Kumar"}'
```

**201 Created**

```json
{
  "success": true,
  "data": {
    "id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
    "name": "Ravi Kumar",
    "balance": 0,
    "created_at": "2026-10-27T18:32:03.367Z"
  }
}
```

**Errors**

| Case | Response |
|---|---|
| `name` missing / empty / not a string / too long | `400 VALIDATION_ERROR` |
| `balance` sent | `400 VALIDATION_ERROR` — *"'balance' cannot be set by the client…"* |
| Invalid JSON / no JSON content type | `400 INVALID_REQUEST_BODY` |

```json
400 Bad Request
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "'balance' cannot be set by the client. Every new account starts with a balance of 0; add money with a credit transaction.",
    "details": [
      {
        "field": "balance",
        "code": "VALIDATION_ERROR",
        "message": "'balance' cannot be set by the client. Every new account starts with a balance of 0; add money with a credit transaction."
      }
    ]
  }
}
```

---

## 2. Get account

`GET /api/accounts/:accountId`

**200 OK**

```json
{
  "success": true,
  "data": {
    "id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
    "name": "Ravi Kumar",
    "balance": 749.5,
    "created_at": "2026-10-27T18:32:03.367Z"
  }
}
```

**Errors:** `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`

---

## 3. Get account balance

`GET /api/accounts/:accountId/balance`

```bash
curl http://localhost:3000/api/accounts/578b937c-a7c3-496f-bd0c-0196c65dcdc0/balance
```

**200 OK**

```json
{
  "success": true,
  "data": {
    "account_id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
    "balance": 749.5
  }
}
```

**404 Not Found**

```json
{
  "success": false,
  "error": {
    "code": "ACCOUNT_NOT_FOUND",
    "message": "Account '00000000-0000-0000-0000-000000000000' was not found"
  }
}
```

**400 Bad Request** (malformed ID)

```json
{
  "success": false,
  "error": {
    "code": "INVALID_ACCOUNT_ID",
    "message": "'not-a-uuid' is not a valid account ID (expected a UUID)"
  }
}
```

---

## 4. Add transaction

`POST /api/accounts/:accountId/transactions`

Adds a credit or debit to the account **and** updates its balance, as **one atomic operation**.

- `credit` → balance **increases** by `amount`
- `debit` → balance **decreases** by `amount`; rejected if the balance is too low

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `type` | string | ✅ | "credit" or "debit" (lower-case) |
| `amount` | number | ✅ | > 0, max 2 decimals, ≤ 999999999999.99. Must be a JSON number, not a string. |
| `reference_id` | string | ✅ | 1–100 characters after trimming. **Unique per account.** |
| `description` | string | ❌ | Up to 500 characters |

The account comes from the URL. `account_id`, `id`, `created_at` in the body are rejected.

**Example request**

```bash
curl -X POST http://localhost:3000/api/accounts/578b937c-a7c3-496f-bd0c-0196c65dcdc0/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "credit", "amount": 1000, "description": "Salary", "reference_id": "salary-oct-2026"}'
```

**201 Created** — returns the transaction and the account's new balance

```json
{
  "success": true,
  "data": {
    "transaction": {
      "id": "45d2ffd1-ae13-4bd5-9159-26b85b2d08c5",
      "account_id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
      "type": "credit",
      "amount": 1000,
      "description": "Salary",
      "reference_id": "salary-oct-2026",
      "transfer_id": null,
      "created_at": "2026-10-27T18:32:03.435Z"
    },
    "account": {
      "id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
      "balance": 1000
    }
  }
}
```

`transfer_id` is `null` for normal transactions; for transfer legs it holds the transfer's ID.

### Duplicate `reference_id` → 409

Sending the same `reference_id` again **for the same account** creates nothing and leaves the balance unchanged. The original transaction is returned so the client can see what was recorded.

```json
409 Conflict
{
  "success": false,
  "error": {
    "code": "DUPLICATE_TRANSACTION",
    "message": "A transaction with reference_id 'salary-oct-2026' already exists for this account. No new transaction was created and the balance was not changed.",
    "existing_transaction": {
      "id": "45d2ffd1-ae13-4bd5-9159-26b85b2d08c5",
      "account_id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
      "type": "credit",
      "amount": 1000,
      "description": "Salary",
      "reference_id": "salary-oct-2026",
      "transfer_id": null,
      "created_at": "2026-10-27T18:32:03.435Z"
    }
  }
}
```

The **same `reference_id` on a different account is allowed.**

### Insufficient balance → 422

```json
422 Unprocessable Entity
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance in account '578b937c-a7c3-496f-bd0c-0196c65dcdc0'",
    "current_balance": 1000,
    "requested_amount": 5000
  }
}
```

Nothing is saved, so the same `reference_id` can be retried later.

### Validation errors → 400 (several at once)

Request body `{"type": "loan", "amount": -1.234}`:

```json
400 Bad Request
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "type", "code": "INVALID_TRANSACTION_TYPE", "message": "'type' must be either 'credit' or 'debit'" },
      { "field": "amount", "code": "INVALID_AMOUNT", "message": "'amount' must be greater than 0" },
      { "field": "reference_id", "code": "VALIDATION_ERROR", "message": "'reference_id' is required" }
    ]
  }
}
```

**All errors for this endpoint**

| Case | Response |
|---|---|
| Malformed account ID in URL | `400 INVALID_ACCOUNT_ID` |
| Invalid `type` | `400 INVALID_TRANSACTION_TYPE` |
| Invalid `amount` | `400 INVALID_AMOUNT` |
| Missing/blank `reference_id`, bad `description`, unknown field | `400 VALIDATION_ERROR` |
| Bad JSON | `400 INVALID_REQUEST_BODY` |
| Account doesn't exist | `404 ACCOUNT_NOT_FOUND` |
| Duplicate `reference_id` | `409 DUPLICATE_TRANSACTION` |
| Debit larger than balance | `422 INSUFFICIENT_BALANCE` |
| Credit would exceed max balance | `422 BALANCE_LIMIT_EXCEEDED` |

---

## 5. Get transaction history

`GET /api/accounts/:accountId/transactions`

Returns the account's transactions, **newest first** (by `created_at`, ties broken by `id`).

**Query parameters**

| Param | Default | Rules |
|---|---|---|
| `type` | *(none: both)* | `credit` or `debit`. Missing or empty = both types. |
| `page` | `1` | Whole number ≥ 1 |
| `limit` | `10` | Whole number from 1 to 100 |

**Example request**

```bash
curl "http://localhost:3000/api/accounts/578b937c-a7c3-496f-bd0c-0196c65dcdc0/transactions?type=debit&page=1&limit=2"
```

**200 OK**

```json
{
  "success": true,
  "data": [
    {
      "id": "ca89798e-d239-48cd-8917-1fa13b4789b3",
      "account_id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
      "type": "debit",
      "amount": 100,
      "description": "Transfer to account e746b8a7-e58f-4a6d-88c4-dbe62e3abf08",
      "reference_id": "tr-001",
      "transfer_id": "f7458aa1-6270-46fe-8659-65e60eed14eb",
      "created_at": "2026-10-27T18:40:11.902Z"
    },
    {
      "id": "1b0b6f9e-5c1e-4c55-9a3e-3f1b2d7c9e10",
      "account_id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
      "type": "debit",
      "amount": 250.5,
      "description": "Groceries",
      "reference_id": "bill-7781",
      "transfer_id": null,
      "created_at": "2026-10-27T18:35:47.120Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 2,
    "total_records": 2,
    "total_pages": 1,
    "has_next_page": false,
    "has_previous_page": false
  },
  "filters": {
    "type": "debit"
  }
}
```

| Pagination field | Meaning |
|---|---|
| `page` | Current page |
| `limit` | Page size |
| `total_records` | Number of matching transactions (after the type filter) |
| `total_pages` | `ceil(total_records / limit)`; `0` when there are none |
| `has_next_page` / `has_previous_page` | Convenience flags for "Next"/"Previous" buttons |

`filters.type` is `null` when both types are returned.

A `page` beyond the last page returns `200` with `"data": []`.

**Errors**

| Case | Response |
|---|---|
| `page`/`limit` invalid (`0`, `-1`, `abc`, `1.5`, `limit=101`, repeated param) | `400 INVALID_PAGINATION` |
| `type` not credit/debit | `400 INVALID_TRANSACTION_TYPE` |
| Malformed account ID | `400 INVALID_ACCOUNT_ID` |
| Account doesn't exist | `404 ACCOUNT_NOT_FOUND` |

```json
400 Bad Request
{
  "success": false,
  "error": {
    "code": "INVALID_PAGINATION",
    "message": "'page' must be at least 1",
    "details": [{ "field": "page", "code": "INVALID_PAGINATION", "message": "'page' must be at least 1" }]
  }
}
```

---

## 6. Transfer money

`POST /api/transfers`

Moves money from one account to another. In **one atomic database transaction** it:

1. creates a `transfers` record,
2. adds a **debit** to the source account,
3. adds a **credit** to the destination account.

If any step fails, **everything is rolled back**: no balance changes and no rows are saved.

**Body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `from_account_id` | string (UUID) | ✅ | Must exist |
| `to_account_id` | string (UUID) | ✅ | Must exist, must differ from `from_account_id` |
| `amount` | number | ✅ | Same rules as transactions |
| `reference_id` | string | ✅ | Used for both legs; must not already exist on **either** account |
| `description` | string | ❌ | Up to 500 chars. If omitted, legs get "Transfer to/from account …" |

**Example request**

```bash
curl -X POST http://localhost:3000/api/transfers \
  -H "Content-Type: application/json" \
  -d '{
        "from_account_id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
        "to_account_id":   "e746b8a7-e58f-4a6d-88c4-dbe62e3abf08",
        "amount": 250.5,
        "reference_id": "t1"
      }'
```

**201 Created**

```json
{
  "success": true,
  "data": {
    "transfer": {
      "id": "f7458aa1-6270-46fe-8659-65e60eed14eb",
      "from_account_id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
      "to_account_id": "e746b8a7-e58f-4a6d-88c4-dbe62e3abf08",
      "amount": 250.5,
      "description": null,
      "reference_id": "t1",
      "created_at": "2026-10-27T18:32:03.565Z"
    },
    "transactions": {
      "debit": {
        "id": "ca89798e-d239-48cd-8917-1fa13b4789b3",
        "account_id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0",
        "type": "debit",
        "amount": 250.5,
        "description": "Transfer to account e746b8a7-e58f-4a6d-88c4-dbe62e3abf08",
        "reference_id": "t1",
        "transfer_id": "f7458aa1-6270-46fe-8659-65e60eed14eb",
        "created_at": "2026-10-27T18:32:03.566Z"
      },
      "credit": {
        "id": "83b48644-b200-4dc7-a32f-20c09e8a525f",
        "account_id": "e746b8a7-e58f-4a6d-88c4-dbe62e3abf08",
        "type": "credit",
        "amount": 250.5,
        "description": "Transfer from account 578b937c-a7c3-496f-bd0c-0196c65dcdc0",
        "reference_id": "t1",
        "transfer_id": "f7458aa1-6270-46fe-8659-65e60eed14eb",
        "created_at": "2026-10-27T18:32:03.568Z"
      }
    },
    "balances": {
      "from_account": { "id": "578b937c-a7c3-496f-bd0c-0196c65dcdc0", "balance": 749.5 },
      "to_account":   { "id": "e746b8a7-e58f-4a6d-88c4-dbe62e3abf08", "balance": 250.5 }
    }
  }
}
```

**Errors**

| Case | Response |
|---|---|
| Missing/malformed IDs, bad amount, missing `reference_id` | `400` (`VALIDATION_ERROR` / `INVALID_ACCOUNT_ID` / `INVALID_AMOUNT`) |
| Same source and destination | `400 SAME_ACCOUNT_TRANSFER` |
| Source or destination doesn't exist | `404 ACCOUNT_NOT_FOUND` (message names the missing ID) |
| `reference_id` already used on source or destination | `409 DUPLICATE_TRANSACTION` |
| Source balance too low | `422 INSUFFICIENT_BALANCE` |
| Destination would exceed max balance | `422 BALANCE_LIMIT_EXCEEDED` (the source debit is rolled back) |

---

## 7. Edit / delete a transaction (not allowed)

`PUT`, `PATCH` or `DELETE` on `/api/accounts/:accountId/transactions` or `/api/accounts/:accountId/transactions/:transactionId`

Transactions are immutable. These requests always fail, and the database also blocks `UPDATE`/`DELETE` with a trigger.

```json
405 Method Not Allowed
Allow: GET, POST
{
  "success": false,
  "error": {
    "code": "TRANSACTION_IMMUTABLE",
    "message": "Transactions are immutable and cannot be edited or deleted. To correct a mistake, post a new opposite transaction (e.g. a credit to undo a debit)."
  }
}
```

---

## Endpoint summary

| Method | Path | Purpose | Success |
|---|---|---|---|
| GET | `/health` | Health check | 200 |
| POST | `/api/accounts` | Create account | 201 |
| GET | `/api/accounts/:accountId` | Get account | 200 |
| GET | `/api/accounts/:accountId/balance` | Get balance | 200 |
| POST | `/api/accounts/:accountId/transactions` | Add credit/debit | 201 |
| GET | `/api/accounts/:accountId/transactions` | History (filter, paginate, latest first) | 200 |
| POST | `/api/transfers` | Transfer between accounts | 201 |
| PUT/PATCH/DELETE | `/api/accounts/:accountId/transactions[/:id]` | Not allowed | 405 |
