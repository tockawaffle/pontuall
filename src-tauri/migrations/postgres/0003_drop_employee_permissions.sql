-- Roles and access control live in Better Auth; employees only store auth_user_id.
ALTER TABLE employees DROP COLUMN IF EXISTS permissions;
