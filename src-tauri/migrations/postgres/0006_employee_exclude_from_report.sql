-- Admins may hide themselves from the attendance report (self-service toggle
-- in the portal). Non-sensitive; defaults to visible.
ALTER TABLE employees ADD COLUMN exclude_from_report BOOLEAN NOT NULL DEFAULT false;
