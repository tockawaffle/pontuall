# Portal admin punch management + report opt-out

**Date:** 2026-07-10
**Status:** Approved design, pending implementation plan

## Goal

Three features for the employee self-service portal (`sidecar/portal/`, served
by the Bun sidecar):

1. **Admin punch management.** Administrators can view *every* employee's punches
   from the portal and fully manage them — correct any punch field and delete a
   day — so corrections can happen from a browser instead of only at the kiosk.
2. **Report opt-out.** An administrator can hide *themselves* from the Excel
   attendance report via a self-service toggle in the portal.
3. **External / proxied-domain access.** The portal must work when reached
   through one or more proxied public domains (cloudflared, playit, a VPN
   hostname) simultaneously, without Better Auth rejecting the request origin.

"Done" means: an administrator logged into the portal sees an admin panel that
lists all employees, shows a selected employee's punch history, and lets them
edit/delete punches — with every action authorized server-side and audit-logged;
those edits reconcile into the kiosk; and an admin can flip a checkbox that keeps
their rows out of the generated report. A non-admin session sees none of this and
cannot reach any of the new endpoints.

## Security posture (non-negotiable)

The portal binds to `0.0.0.0` and is reachable from any device on the LAN, so
every new capability is enforced **server-side, independent of the client**:

- **Session required.** Every `/portal/admin/*` route resolves the Better Auth
  session from the request cookies (`auth.api.getSession`). No session → `401`.
  These routes are exempt from the `x-pontuall-key` shared-key gate exactly like
  `/portal/data`, and each self-guards.
- **Permission-checked, not role-checked.** Authorization uses the authoritative
  `auth.api.userHasPermission` (the same mechanism `/internal/has-permission`
  uses), never a role string read off the session:
  - read others' punches + list employees: `punch: ["read-others"]`
  - edit a punch: `punch: ["write-others"]` **and** `hours: ["edit"]`
  - delete a day: additionally `punch: ["delete-others"]`
  - report-visibility toggle: `punch: ["delete-others"]` as the administrator
    marker (administrators hold it; supervisors do not — see
    `sidecar/src/permissions.ts`).
  A stale or forged role string cannot pass these checks. Failure → `403`.
- **Audit on read and write.** Listing employees, reading another person's
  punches, every edit, every delete, and the report-visibility change each write
  a hash-chained `logAudit` entry (actor = the admin, resource = masked employee
  email). Reads are logged because preventing unauthorized *extraction* of PII
  matters as much as preventing writes.
- **Input validation.** Employee ID must resolve to a real employee; date must
  parse (`YYYY-MM-DD`); time must parse (`HH:MM`); field name must be one of the
  four known punch fields. Anything malformed → `400`, no DB write.
- **Client flag is cosmetic.** `/portal/data` returns the caller's access level
  only so the SPA decides whether to *render* the admin panel. It is never the
  security boundary; each endpoint enforces permission on its own.

## Architecture context

- The portal is served by the sidecar, which already reads `employees` and
  `time_entries` straight from Postgres via Prisma `$queryRaw`
  (`sidecar/src/portal.ts`). Browsers cannot call Tauri commands, so portal
  writes go sidecar → Postgres. This is consistent with the existing
  offline-first model: Postgres is the source of truth; the kiosk mirrors it into
  SQLite last-write-wins by `updated_at`.
- The kiosk (`src-tauri/`) reconciles on a cycle: `run_sync` flushes the offline
  outbox to Postgres, then `pull_master_data` pulls `employees` + `time_entries`
  back into SQLite. `pull_from_pg` upserts LWW by `updated_at` but is
  **upsert-only** — it never removes local rows deleted elsewhere.

## Feature 1 — Admin punch management

### New sidecar endpoints

All under `/portal/admin/*`, all session- + permission-guarded per the security
posture above. Shapes mirror the existing `/portal/data` conventions.

| Method + path | Permission | Behavior |
|---|---|---|
| `GET /portal/admin/employees` | `punch:read-others` | Returns `[{ id, name, role }]` for the picker. Audit: `portal/admin-employees-list`. |
| `GET /portal/admin/punches?employeeId=` | `punch:read-others` | Returns the employee's full punch history (same entry shape as `/portal/data`: date, clockIn, lunchOut, lunchReturn, clockOut, totalHours). Audit: `portal/admin-punch-read`. |
| `POST /portal/admin/punch` | `punch:write-others` + `hours:edit` | Body `{ employeeId, date, field, value }` where `field ∈ {clockIn, lunchOut, lunchReturn, clockOut}` and `value` is `HH:MM` local. Upserts `time_entries` on `(employee_id, work_date)`, sets the one column, `updated_at = now()`, and merges `punch_sources[field] = "portal_admin"`. Audit: `portal/punch-edit`. |
| `POST /portal/admin/punch/delete` | `punch:write-others` + `hours:edit` + `punch:delete-others` | Body `{ employeeId, date }`. Deletes the day from Postgres `time_entries`. Audit: `portal/punch-delete`. |

Notes:

- `value` is a local `HH:MM`; the endpoint converts to a UTC timestamp on the
  given `work_date` using the sidecar's timezone (same wall-clock convention the
  kiosk uses via `parse_local_time`). The four fields map to columns
  `clock_in / lunch_out / lunch_return / clock_out`.
- `punch_sources` is JSON `{ field: source }`; the write merges rather than
  overwrites, matching `merge_punch_source` in the kiosk.

A shared helper `requirePunchAdmin(request, permissions)` resolves the session
and runs `userHasPermission`, returning either the authenticated user or an early
`Response` (401/403). Every admin route starts with it.

### Reconciliation with the kiosk

- **Edits** propagate with no kiosk change: the row lands in Postgres with
  `updated_at = now()`, and the next `run_sync` LWW-upserts it into SQLite.
- **Deletes** need a fix, because `pull_from_pg` is upsert-only. Add a **reap
  step to `run_sync`** — after the outbox flush and `pull_master_data` — that
  deletes any local `time_entries` whose `(employee_id, work_date)` no longer
  exists in Postgres. Placed *only* in `run_sync`, never in the standalone
  `pull_master_data` path used by the `get_users_and_cache` command: `run_sync`
  has already flushed the outbox, so there is no local-only pending row that a
  reap could wrongly delete. Implement as a new `time_entries` repo function
  (e.g. `reap_deleted(pg, lite)`) that reads the set of `(employee_id,
  work_date)` keys present in Postgres and deletes local rows absent from it.

### Portal client (`sidecar/portal/`)

- `/portal/data` response gains `accessLevel` (derived from the Better Auth
  session role via `normalizeAccessLevel`) and `excludeFromReport` (Feature 2).
- When `accessLevel === "administrator"`, the SPA reveals an **admin panel**:
  employee `<select>`, month/year filters (reuse the existing filter UI), and a
  punch table where each row has inline time-edit inputs per field and a
  delete-day action. Editing a field → `POST /portal/admin/punch`; deleting →
  `POST /portal/admin/punch/delete`; both re-fetch `/portal/admin/punches` on
  success.
- Non-admin sessions are unchanged: they see only their own `/portal/data` view.
- New client code lives alongside `app.ts` / `index.html` / `dom.ts`. The admin
  panel is additive markup hidden by default and shown only when the server says
  the caller is an administrator (cosmetic gate; endpoints enforce).

## Feature 2 — Report opt-out (self-service, admins only)

### Schema

Add `exclude_from_report BOOLEAN NOT NULL DEFAULT false` to `employees`
(migration `0006` — `0005` is already taken by `app_config`):

- `src-tauri/migrations/postgres/0006_employee_exclude_from_report.sql`
- `src-tauri/migrations/sqlite/0006_employee_exclude_from_report.sql`
- Add the field to the `Employee` struct and `UserExternal`
  (`src-tauri/src/db/models.rs`), threaded through the SQLite/PG upsert binds and
  `pull_from_pg` so it round-trips in sync.

The sidecar reads/writes this column via `$queryRaw` (the `employees` table is
not a Prisma model), so no Prisma schema change.

### Sidecar endpoint

`POST /portal/admin/report-visibility` — body `{ hidden: boolean }`. Guarded by
`punch:delete-others` (administrator marker). Updates **only the caller's own**
employee row (`WHERE auth_user_id = session.user.id`), setting
`exclude_from_report = $hidden` and `updated_at = now()` so the change syncs to
the kiosk. Audit: `portal/report-visibility` with the new value. `/portal/data`
returns the current value so the checkbox reflects state.

### Report generation

`create_excel_relatory` (`src-tauri/src/excel/create.rs`) filters out excluded
employees **authoritatively in Rust**, not from the frontend payload: it reads
the set of excluded employee IDs from the local `employees` mirror and skips any
user in the incoming `users` map whose ID is in that set. This holds even if a
tampered frontend re-sends a flag-stripped payload.

### Portal UI

A "Não aparecer nos relatórios" checkbox in the admin's own portal section, bound
to `excludeFromReport` from `/portal/data`, toggling via the endpoint above.

## Feature 3 — External / proxied-domain access (multi-origin)

### Problem

Better Auth validates the request `Origin` against `trustedOrigins` on
state-changing requests; an origin that isn't listed is rejected, so portal
sign-in fails. A cloudflared/playit domain is not a local NIC, so
`publicOrigins()` never auto-detects it. Worse, the sidecar spawn
(`src-tauri/src/auth/sidecar.rs`) does **not** pass the configured public URL as
env, and `set_advanced_config_cmd` does not push it either — the configured
`public_url` only reaches the sidecar lazily, as a side effect of sending a
password-setup email. So `runtime.publicOrigin` is typically `null` and no
proxied domain is trusted. The operator needs several proxied domains trusted at
once.

### Design

Keep `public_url` (single) as the canonical base for **emailed links** (emails
need one stable URL) and add a separate **list** of additional trusted origins
for the auth origin check. Better Auth trusts the union of: built-in LAN origins
(auto-detected) + `public_url` + the trusted-origins list.

**Storage — `app_config`, not the keyring.** Domain config is non-secret, so
both `public_url` and the new `trusted_origins` live in the existing synced
`app_config` key/value table (`src-tauri/src/db/repo/config.rs`; keys
`public_url` and `trusted_origins`, the latter newline-separated), read via
`config::get_local` and written via `config::set_local` + an `upsert_app_config`
outbox enqueue (so it replicates to Postgres). No new table or migration —
`app_config` already exists. This also directly serves the requirement that the
Rust backend hold the values so it can pass them to the sidecar / Better Auth.

**One-time migration.** `public_url` currently lives in the keyring
(`KEYRING_PUBLIC_URL`). On startup, if `app_config` has no `public_url` key but
the keyring does, copy the keyring value into `app_config` (then the keyring
entry is ignored). `sidecar_port` stays in the keyring — it is not domain config.

**Rust config (`src-tauri/src/misc/advanced.rs`):**
- `configured_public_url()` and new `configured_trusted_origins()` read from
  `app_config` (via the local SQLite pool) instead of the keyring; both become
  async / take the DB state.
- `AdvancedConfigDto` gains `trusted_origins: Vec<String>` (camelCase
  `trustedOrigins`); `get_advanced_config_cmd` returns it.
- `set_advanced_config_cmd` accepts `trusted_origins: Vec<String>`, validates
  each (trim, strip trailing slash, must start `http://` or `https://`, drop
  empties, dedupe — same rule as the existing `public_url` check), persists to
  `app_config`, then pushes to the running sidecar.

**Sidecar spawn (`src-tauri/src/auth/sidecar.rs`):** read the two values from
`app_config` and pass `.env("PONTUALL_PUBLIC_URL", …)` and
`.env("PONTUALL_TRUSTED_ORIGINS", …join(","))` so trust is established at boot
without waiting for a push. Ordering is safe: `db::init_sqlite()` runs in
`.setup()` (main.rs) and the sidecar is spawned later from the
`start_backend_services` command (`sidecar::start`), so the SQLite pool is always
available when the spawn reads `app_config`.

**Sidecar runtime (`sidecar/src/runtime.ts`):** `runtime` gains
`trustedOrigins: string[]`; parse `PONTUALL_TRUSTED_ORIGINS` (comma-separated) at
boot.

**Sidecar auth (`sidecar/src/auth.ts`):** the `trustedOrigins` callback appends
`...runtime.trustedOrigins` (deduped with the existing LAN + `publicOrigin`
set).

**Runtime push (`sidecar/src/index.ts`):** new shared-key-gated
`POST /internal/public-origins/push`, body
`{ publicOrigin?: string | null, trustedOrigins?: string[] }`, normalizes and
sets `runtime.publicOrigin` / `runtime.trustedOrigins`. Called by
`set_advanced_config_cmd` (via a new `push_public_origins` method on the auth
client, mirroring the existing `smtp/push` and `work-hours/push` methods) so a
domain change takes effect without a sidecar restart.

**Frontend (`src/components/main/Admin.tsx`, `src/lib/Tauri/index.ts`):** the
Advanced settings card ("Avançado — rede e links de senha") gains a small
add/remove list editor for trusted origins; `advancedForm` carries
`trustedOrigins: string[]`; `GetAdvancedConfig` returns them and
`SetAdvancedConfig` sends them. This screen is already gated by
`EditHierarchy`.

Origins are stored/compared as bare origins (`scheme://host[:port]`, no path).

## Explicitly out of scope

- The kiosk commands `update_cache_hour_data` / `delete_time_entry_day` are not
  permission-gated at the command level today (the frontend gates them). This
  spec does **not** change that; only the new portal endpoints are hardened.
- No changes to NFC/card flows, OTP, or the missed-punch scheduler.
- Supervisors do not get the portal admin panel (administrators only, per the
  product decision).

## Verification

- Non-admin session: `/portal/admin/*` all return 401/403; SPA shows no admin
  panel.
- Admin session: can list employees, read another employee's punches, edit a
  field (row updates; `punch_sources.<field> == "portal_admin"`), delete a day.
- A portal edit appears in the kiosk after a sync cycle; a portal delete is gone
  from the kiosk's SQLite mirror after a sync cycle (reap works).
- Admin toggles report opt-out → their rows are absent from a freshly generated
  Excel report; clearing it restores them.
- Audit log contains entries for the admin's reads, edits, deletes, and the
  visibility toggle, and the chain still verifies.
- With two proxied domains saved in Advanced settings, portal sign-in succeeds
  over both (no origin rejection) and over the LAN, with no sidecar restart after
  saving; emailed reset links still use the single `public_url`.
