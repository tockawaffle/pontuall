-- Punch security: audit log + punch source tracking on time entries

CREATE TABLE punch_auth_log (
    id          TEXT PRIMARY KEY,
    employee_id TEXT,
    email       TEXT,
    event_type  TEXT NOT NULL,
    success     INTEGER NOT NULL DEFAULT 0,
    details     TEXT,
    created_at  TEXT NOT NULL
);

CREATE INDEX idx_punch_auth_log_employee ON punch_auth_log (employee_id, created_at);
CREATE INDEX idx_punch_auth_log_email ON punch_auth_log (email, created_at);

ALTER TABLE time_entries ADD COLUMN punch_sources TEXT;
