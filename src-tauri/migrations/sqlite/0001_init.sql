-- SQLite twin of the Postgres schema. Timestamps are TEXT in RFC 3339 (UTC),
-- dates are TEXT "YYYY-MM-DD"; both map to chrono types through sqlx.

CREATE TABLE employees (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE,
    phone         TEXT,
    role          TEXT NOT NULL DEFAULT '',
    lunch_time    TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    permissions   INTEGER NOT NULL DEFAULT 0,
    auth_user_id  TEXT UNIQUE,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
);

CREATE TABLE time_entries (
    id           TEXT PRIMARY KEY,
    employee_id  TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    work_date    TEXT NOT NULL,
    clock_in     TEXT,
    lunch_out    TEXT,
    lunch_return TEXT,
    clock_out    TEXT,
    updated_at   TEXT NOT NULL,
    UNIQUE (employee_id, work_date)
);

CREATE INDEX idx_time_entries_work_date ON time_entries (work_date);

CREATE TABLE cards (
    id                 TEXT PRIMARY KEY,
    uid                TEXT NOT NULL UNIQUE,
    employee_id        TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    active_token_hash  TEXT NOT NULL,
    pending_token_hash TEXT,
    token_counter      INTEGER NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'active',
    provisioned_at     TEXT NOT NULL,
    last_seen_at       TEXT
);

CREATE TABLE card_events (
    id         TEXT PRIMARY KEY,
    card_id    TEXT REFERENCES cards(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    details    TEXT,
    created_at TEXT NOT NULL
);

-- Offline write-ahead queue replayed against Postgres on reconnect.
CREATE TABLE sync_outbox (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    op_type    TEXT NOT NULL, -- upsert_time_entry | upsert_employee | card_token_rotate | card_status
    payload    TEXT NOT NULL, -- JSON
    created_at TEXT NOT NULL,
    synced_at  TEXT
);
