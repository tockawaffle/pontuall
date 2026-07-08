# PontuAll — Project-Specific Context

PontuAll is a Windows kiosk app for employee time tracking via NFC smart cards.
Stack: **Tauri 2 (Rust)** + **Next.js 16 / React 19 (webview)** + **Better Auth sidecar (Bun/TypeScript)**.
Package manager: **Bun**. Target: `x86_64-pc-windows-msvc` only.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Next.js webview  (src/)                                 │
│  React 19 · Radix UI · shadcn/ui · Tailwind CSS 4       │
│  Calls Rust via Tauri invoke() — never direct I/O        │
└────────────────────────┬─────────────────────────────────┘
                         │ Tauri IPC
┌────────────────────────▼─────────────────────────────────┐
│  Tauri app  (src-tauri/src/)                             │
│  Modules: auth · card · db · excel · misc                │
│  Manages: DbState (SQLite + PgPool) · AuthState          │
│  Spawns the auth sidecar on setup completion             │
└──────────┬───────────────────────┬───────────────────────┘
           │ sqlx                  │ HTTP localhost
    ┌──────▼──────┐      ┌─────────▼──────────┐
    │  SQLite     │      │  Better Auth        │
    │  offline.db │      │  sidecar (Bun exe)  │
    │  local mirror│     │  → PostgreSQL       │
    └──────┬──────┘      └────────────────────┘
           │ outbox sync
    ┌──────▼──────┐
    │ PostgreSQL  │
    └─────────────┘
```

---

## Critical Invariants — Never Break These

**1. Session token stays in Rust.**
`AuthState::current_session` holds the Better Auth session token. The webview never receives it. An XSS in the webview cannot steal it. Do not pass session tokens through IPC responses.

**2. Write to SQLite first, then sync to Postgres.**
The app is offline-capable. Every data mutation must land in the local SQLite `offline.db` and queue an outbox entry. Postgres is written via `sync.rs`, not directly from command handlers (unless clearly intentional and documented).

**3. Use `pg_if_online()`, never unwrap `pg` directly.**
`DbState.pg` is `RwLock<Option<PgPool>>`. Always call `db.pg_if_online().await` in command handlers. Accessing `pg.read().await.as_ref().unwrap()` bypasses the offline guard and will panic when offline.

**4. SQL constants use Postgres `$N` syntax; call `lite_sql()` for SQLite.**
All shared SQL is written with `$1, $2, ...` (Postgres style). Before executing on SQLite, wrap with `lite_sql(sql)` which rewrites to `?1, ?2, ...`. Never write SQLite-specific `?` placeholders in a shared constant.

**5. Verify sidecar signature before spawning (Windows, release).**
`auth::signature::verify_sidecar()` checks the Authenticode cert fingerprint at `src-tauri/signing/cert-fingerprint.txt`. This runs in release mode on Windows. Do not remove or short-circuit this check — it prevents a compromised sidecar binary from receiving `DATABASE_URL` and `BETTER_AUTH_SECRET`.

**6. Kiosk model: one privileged user at a time.**
`AuthState` is designed for a single active session. Do not introduce multi-session state without rethinking the entire kiosk security model.

---

## Flavors: Prod vs. Test

`src-tauri/src/app_flavor.rs` gates all flavor-sensitive constants:

| | Prod | Test flavor |
|---|---|---|
| Feature flag | (default) | `--features test-flavor` |
| App name | `PontuAll` | `PontuAll Test` |
| Data dir | `%APPDATA%/PontuAll` | `%APPDATA%/PontuAll Test` |
| Sidecar binary | `pontuall-auth` | `pontuall-auth-test` |
| Default port | `3435` | `3436` |
| Tauri config | `tauri.conf.json` | `tauri.conf.test.json` |

The test flavor installs and runs in parallel with prod — different data, different port, different keyring entries. When running dev or build commands, append `:test` to use it.

---

## Running the App

```powershell
# First time (or after sidecar changes): build the auth sidecar
bun run sidecar:build          # prod
bun run sidecar:build:test     # test flavor

# Development
bun run tauri:dev              # prod
bun run tauri:dev:test         # test flavor

# Production build
bun run tauri:build
bun run tauri:build:test
```

The sidecar must be rebuilt whenever `sidecar/src/` changes. It is **not** auto-rebuilt by `tauri dev`.

---

## Module Map

| Path | Responsibility |
|------|---------------|
| `src/` | Next.js webview — UI only, no direct I/O |
| `src/components/main/` | Core app screens (Home, Admin, Settings, etc.) |
| `src/components/splashscreen/` | First-run setup wizard |
| `src/components/ui/` | shadcn/ui primitives — edit sparingly |
| `src-tauri/src/auth/` | Session management, sidecar lifecycle, permissions |
| `src-tauri/src/card/` | Smart card NFC reader (APDU commands, provisioning) |
| `src-tauri/src/db/` | SQLite + Postgres pools, migrations, sync, repo layer |
| `src-tauri/src/db/repo/` | Per-entity query functions (employees, time_entries, outbox, cards) |
| `src-tauri/src/excel/` | Excel report generation |
| `src-tauri/src/misc/` | SMTP, manual punch OTP, advanced config, version |
| `sidecar/src/` | Better Auth server (TypeScript/Bun) |
| `src-tauri/migrations/sqlite/` | SQLite schema migrations |
| `src-tauri/migrations/postgres/` | Postgres schema migrations |
| `scripts/` | PowerShell build helpers (signing, test variant) |

---

## Auth Roles

Three roles exist in Better Auth: `employee`, `supervisor`, `administrator`.
Role checks are enforced in `auth::permissions` and `auth::guard` on the Rust side.
Do not gate features on the frontend alone — always verify server-side via an `auth_session_has_permission` call or a guarded command.

---

## Adding a New Tauri Command

1. Define the async fn in the appropriate module (e.g., `db::commands`).
2. Annotate with `#[tauri::command]`.
3. Register it in `main.rs` inside `invoke_handler!(tauri::generate_handler![...])`.
4. Call it from the frontend with `invoke("command_name", { args })`.

Missing step 3 is the most common mistake — the command silently does not exist on the IPC layer.

---

## Database — What to Know

- **Migrations run automatically** on pool creation (`sqlx::migrate!(...).run(&pool)`).
- **SQLite** stores a mirror of employees and time entries for offline operation. Schema: `migrations/sqlite/`.
- **Postgres** is the canonical store. Schema: `migrations/postgres/`.
- **Outbox** (`db/repo/outbox.rs`): every local write enqueues a sync record. `db/sync.rs` drains it when Postgres is reachable.
- **Tests**: `db/mod.rs` has integration tests using an in-memory SQLite DB. Run with `cargo test`. The `postgres_roundtrip` test is `#[ignore]` and requires `TEST_PG_URI` env var.

---

## Sidecar — What to Know

- The sidecar is a compiled Bun executable (`sidecar/src/index.ts`).
- It runs Better Auth against Postgres and exposes HTTP on localhost.
- The Rust side communicates with it using a per-launch shared key (`PONTUALL_SHARED_KEY` env var + `x-pontuall-key` header) to block other local processes from accessing the auth API.
- The employee self-service portal (`sidecar/src/portal.ts`) is bundled into the sidecar and served as HTML — it is not part of the Next.js build.
- On Windows release builds, the sidecar is Authenticode-signed. The Rust layer verifies the cert fingerprint before spawning it.
