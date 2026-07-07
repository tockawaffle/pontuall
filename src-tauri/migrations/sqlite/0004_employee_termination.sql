-- LGPD retention (.lgpd/retention.md §3): terminated employees keep their
-- time entries for the legal retention window and are anonymized afterwards.
ALTER TABLE employees ADD COLUMN terminated_at TEXT;
