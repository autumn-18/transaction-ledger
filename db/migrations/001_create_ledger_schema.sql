-- =============================================================================
-- 001_create_ledger_schema.sql
--
-- Creates the three tables of the ledger:
--   accounts      -> who holds money and how much they have right now
--   transfers     -> one row per "move money from A to B" request
--   transactions  -> the ledger itself: every credit/debit, one row each
--
-- WHY so many constraints?
-- The Node.js code already validates everything. But code can have bugs, and
-- someone might one day connect to the database directly. Constraints are the
-- LAST line of defence: even if the code is wrong, the database will refuse
-- to store bad data.
-- =============================================================================

-- gen_random_uuid() is built into PostgreSQL 13+. We use UUIDs instead of
-- 1, 2, 3... so IDs can't be guessed and never clash across systems.

-- -----------------------------------------------------------------------------
-- ACCOUNTS
-- -----------------------------------------------------------------------------
CREATE TABLE accounts (
    id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Name is required and cannot be only spaces.
    name        VARCHAR(255)  NOT NULL,

    -- NUMERIC (not FLOAT!) because money must be exact.
    -- FLOAT would store 0.1 + 0.2 as 0.30000000000000004.
    -- NUMERIC(14,2) = up to 12 digits before the dot, exactly 2 after.
    -- DEFAULT 0 -> every new account starts empty; the API never lets the
    -- client choose a starting balance.
    balance     NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- TIMESTAMPTZ stores the moment in UTC, so time zones never confuse us.
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT chk_accounts_name_not_blank   CHECK (length(btrim(name)) > 0),

    -- Safety net for "insufficient balance": even if the code forgot to check,
    -- the database would refuse to let a balance go below zero.
    CONSTRAINT chk_accounts_balance_non_negative CHECK (balance >= 0)
);

-- -----------------------------------------------------------------------------
-- TRANSFERS
-- A transfer is ONE business action that creates TWO ledger rows
-- (a debit on the source, a credit on the destination). This table groups
-- those two rows together so we can always see they belong to each other.
-- -----------------------------------------------------------------------------
CREATE TABLE transfers (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    from_account_id  UUID          NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    to_account_id    UUID          NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount           NUMERIC(14,2) NOT NULL,
    description      VARCHAR(500),
    reference_id     VARCHAR(100)  NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT chk_transfers_amount_positive     CHECK (amount > 0),
    CONSTRAINT chk_transfers_reference_not_blank CHECK (length(btrim(reference_id)) > 0),
    -- Sending money to yourself makes no sense, so the DB forbids it too.
    CONSTRAINT chk_transfers_different_accounts  CHECK (from_account_id <> to_account_id)
);

-- -----------------------------------------------------------------------------
-- TRANSACTIONS (the ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE transactions (
    id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ON DELETE RESTRICT: an account that has history can never be deleted,
    -- otherwise we would lose the ledger rows that explain its balance.
    account_id    UUID          NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,

    type          VARCHAR(6)    NOT NULL,
    amount        NUMERIC(14,2) NOT NULL,
    description   VARCHAR(500),
    reference_id  VARCHAR(100)  NOT NULL,

    -- Filled only when this row is one leg of a transfer; NULL otherwise.
    transfer_id   UUID          REFERENCES transfers(id) ON DELETE RESTRICT,

    -- clock_timestamp() = the real time this row was written.
    -- (now() would give the time the DB transaction STARTED, which can be
    -- earlier than the moment we actually got the lock and wrote the row.
    -- That could make "latest first" ordering slightly wrong.)
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT chk_transactions_type             CHECK (type IN ('credit', 'debit')),
    CONSTRAINT chk_transactions_amount_positive  CHECK (amount > 0),
    CONSTRAINT chk_transactions_reference_not_blank CHECK (length(btrim(reference_id)) > 0),

    -- THE duplicate-protection rule:
    -- the same reference_id can appear only once PER ACCOUNT.
    -- (account A, 'ref-1') and (account B, 'ref-1') are both allowed.
    CONSTRAINT uq_transactions_account_reference UNIQUE (account_id, reference_id)
);

-- Index for the history API: "all rows of one account, newest first".
-- Without it, PostgreSQL would scan the whole table for every request.
CREATE INDEX idx_transactions_account_created
    ON transactions (account_id, created_at DESC, id DESC);

CREATE INDEX idx_transactions_transfer_id
    ON transactions (transfer_id)
    WHERE transfer_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- IMMUTABILITY
-- Ledger rows must never change. The API has no edit/delete endpoints, but
-- this trigger also stops anyone running UPDATE or DELETE directly in SQL.
-- Mistakes are fixed by adding a NEW opposite transaction, never by editing.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prevent_ledger_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% on table "%" is not allowed: ledger records are immutable',
        TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_transactions_immutable
    BEFORE UPDATE OR DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();

CREATE TRIGGER trg_transfers_immutable
    BEFORE UPDATE OR DELETE ON transfers
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_modification();
