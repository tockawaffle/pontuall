-- Ids are TEXT (UUIDs or legacy 16-char ids, generated in Rust) so the same
-- models and queries work against both Postgres and the SQLite offline mirror.

CREATE TABLE employees (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE,
    phone         TEXT,
    role          TEXT NOT NULL DEFAULT '',
    lunch_time    TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    -- permission bitflags; bit 50 is the highest used, fits in BIGINT
    permissions   BIGINT NOT NULL DEFAULT 0,
    -- BetterAuth "user".id; NULL for punch-only employees without a login
    auth_user_id  TEXT UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE time_entries (
    id           TEXT PRIMARY KEY,
    employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_date    DATE NOT NULL,
    clock_in     TIMESTAMPTZ,
    lunch_out    TIMESTAMPTZ,
    lunch_return TIMESTAMPTZ,
    clock_out    TIMESTAMPTZ,
    updated_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (employee_id, work_date)
);

CREATE INDEX idx_time_entries_work_date ON time_entries (work_date);

CREATE TABLE cards (
    id                 TEXT PRIMARY KEY,
    uid                TEXT NOT NULL UNIQUE,
    employee_id        TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    -- sha256 hex of the current token; the raw token lives only on the card
    active_token_hash  TEXT NOT NULL,
    -- set before writing a new token to the card, promoted to active after
    -- a verified card write; guarantees a token validates exactly once even
    -- if the process dies between the card write and the DB promote
    pending_token_hash TEXT,
    token_counter      BIGINT NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'active', -- active | blocked | clone_suspected
    provisioned_at     TIMESTAMPTZ NOT NULL,
    last_seen_at       TIMESTAMPTZ
);

CREATE TABLE card_events (
    id         TEXT PRIMARY KEY,
    card_id    TEXT REFERENCES cards(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL, -- provisioned | tap_ok | clone_detected | blocked | unknown_card
    details    TEXT,
    created_at TIMESTAMPTZ NOT NULL
);
