# PontuAll

Desktop time-clock (ponto) app for small businesses. Employees punch in/out
with NFC cards on an ACR122U reader; administrators manage employees, correct
punches, and export attendance reports.

Built with **Tauri 2** (Rust backend) + **Next.js 14** (static export) +
**PostgreSQL** (with an offline SQLite mirror) + **BetterAuth** for
authentication.

## Architecture

```
┌─────────────────────────────────────────────┐
│ Tauri app (Rust)                              │
│                                               │
│  Webview (Next.js static export)              │
│    └─ invoke() ──▶ Tauri commands             │
│                                               │
│  DbState:  PostgreSQL pool (online)           │
│            SQLite mirror  (always)            │
│            outbox → replayed on reconnect     │
│                                               │
│  AuthState ──HTTP(127.0.0.1)──▶ BetterAuth    │
│                                  sidecar (Bun)│
│                                       │       │
│  CardService (PC/SC worker) ──▶ ACR122U       │
└──────────────────────────────────────┼───────┘
                                        ▼
                                   PostgreSQL
```

- **Database.** PostgreSQL is authoritative. A local SQLite database
  (`%APPDATA%/PontuAll/offline.db`) mirrors master data and buffers writes
  while offline; a `sync_outbox` table is replayed against Postgres on
  reconnect (last-write-wins on `updated_at`). Reachability is polled with
  `SELECT 1` every 30s. See `src-tauri/src/db/`.
  - **Single terminal per company database.** Multi-terminal offline use with
    rolling card tokens is unsafe — the sync detects a counter conflict and
    blocks the affected card rather than silently overwriting a newer token.

- **Authentication.** A [BetterAuth](https://better-auth.com) sidecar (`sidecar/`)
  handles identity, sessions, and **all permission checks** via the admin
  plugin's access-control roles (`employee`, `supervisor`, `administrator`).
  Auth data lives in the same PostgreSQL database, accessed through **Prisma**
  (`sidecar/prisma/schema.prisma`) instead of raw SQL. The Rust backend spawns
  the sidecar, brokers **all** auth traffic to it, and enforces permissions on
  Tauri commands by calling `POST /admin/has-permission`. The session token is
  held only in the Rust backend (`AuthState`, in memory) and is never exposed to
  the webview, so an XSS in the view cannot exfiltrate a session; privileged
  commands resolve the active session from backend state rather than a
  frontend-supplied argument. Because the token is in-memory only, a full app
  restart requires re-login. Employee records keep a local `permissions` mirror
  for NFC-only staff and role sync, but the Better Auth role is authoritative
  once a login exists.

- **Cards (rolling token, clone detection).** MIFARE Classic 1K cards store
  only an opaque one-time token behind per-card keys derived from a master
  secret. Every successful tap verifies the token against the database, then
  writes a fresh one (pending-token protocol, so a token validates exactly
  once even if a step fails). A stale token means a clone diverged: the card
  is blocked and a `card:clone_detected` event is emitted. See
  `src-tauri/src/card/`.
  - MIFARE Classic's Crypto-1 is broken; the rolling token is the real
    security boundary. This is clone **detection** (on first divergent use),
    not prevention. For prevention, move card stock to DESFire/NTAG 424.

## Secrets (Windows Credential Manager, service `PontuAll`)

| Entry               | Purpose                                             |
|---------------------|-----------------------------------------------------|
| `postgres_uri`      | PostgreSQL server URI (with credentials)            |
| `app_name`          | Company/app name → database `pontuall_{app_name}`   |
| `better_auth_secret`| BetterAuth signing secret (32 random bytes)         |
| `card_master_key`   | Master key for per-card MIFARE key derivation       |

> **Back up `card_master_key`.** Losing it (Windows reinstall, profile change)
> makes every provisioned card unwritable. A SuperUser can export/import it via
> the `export_card_master_key` / `import_card_master_key` commands.

## Development

Prerequisites: [Bun](https://bun.sh), the Rust toolchain, a PostgreSQL server,
and the Windows **Smart Card** service (`SCardSvr`) running for card features.

```sh
bun install
bun run sidecar:build   # compiles the auth sidecar into src-tauri/binaries/
bun run tauri:dev       # dev-builds the sidecar + frontend and launches the app
```

`bun run tauri:build` produces an installer bundling the sidecar executable.

### First run

The splashscreen walks through: work hours → PostgreSQL URI + app name →
first administrator account. The database is created and migrated
automatically.

## Tests

```sh
cd src-tauri
cargo test                                          # unit tests (no hardware/DB)
TEST_PG_URI=postgres://user:pass@host:port \
  cargo test postgres_roundtrip -- --ignored        # against a live PostgreSQL
```

Unit tests cover the MIFARE access-bits encoding (validated against the NXP
MF1S50 datasheet), per-card key derivation, the clone-detection state machine,
APDU builders, and the SQLite/PostgreSQL repositories.
