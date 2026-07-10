# Portal Admin Punch Management + Report Opt-out + External Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators view and fully manage every employee's punches from the self-service portal, let admins hide themselves from the Excel report, and make the portal work behind multiple proxied public domains.

**Architecture:** The portal is served by the Bun sidecar, which reads/writes the shared PostgreSQL directly (Prisma `$queryRaw`). New `/portal/admin/*` endpoints are session- + permission-gated (Better Auth `userHasPermission`) and audit-logged. Kiosk (Rust) reconciles edits via its existing offline-first sync (LWW by `updated_at`); portal deletes are reaped from the kiosk's SQLite mirror during `run_sync`. Domain config (`public_url` + `trusted_origins`) moves to the synced `app_config` table and is fed to Better Auth's `trustedOrigins`.

**Tech Stack:** Rust (Tauri, sqlx, chrono), Bun + TypeScript (Better Auth, Prisma), React/Next.js (portal is vanilla TS bundled by Bun).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-10-portal-admin-punch-management-design.md` — every requirement there is in scope.
- **Security is server-side.** Every `/portal/admin/*` route resolves the Better Auth session AND checks `auth.api.userHasPermission`. A client-side flag is never a security boundary.
- **Permissions (exact):** read others / list employees → `{ punch: ["read-others"] }`; edit punch → `{ punch: ["write-others"], hours: ["edit"] }`; delete day → `{ punch: ["write-others"], hours: ["edit"], punch: ["delete-others"] }` (send `{ punch: ["delete-others"] }` since only administrators hold it); report-visibility toggle → `{ punch: ["delete-others"] }`.
- **Punch source label** for portal edits: `"portal_admin"`.
- **Audit** every admin read and write via `logAudit` (`sidecar/src/audit.ts`), actor = session user, resource = `maskEmail(...)`.
- **Migrations** are numbered SQL files in `src-tauri/migrations/{postgres,sqlite}/`. Next free number is `0006` (`0005` = `app_config`). Add both backends.
- **No new secrets in the keyring.** Domain config lives in `app_config`. `sidecar_port` stays in the keyring.
- **Language:** user-facing strings are pt-BR, matching existing copy.
- **Commit** after each task with the shown message.

---

## Task 1: Move domain config to `app_config` (Rust)

Relocate `public_url` from the keyring to the synced `app_config` table, add a `trusted_origins` list, and migrate the existing keyring value once. This task does not yet push to the sidecar (Task 3) — it only persists and exposes the values.

**Files:**
- Modify: `src-tauri/src/misc/advanced.rs` (whole file rewrite below)
- Modify: `src-tauri/src/auth/client.rs:293-303` (thread `public_url` into `send_password_setup`)
- Modify: `src-tauri/src/auth/commands.rs:203`, `:221` (compute + pass `public_url`)
- Modify: `src-tauri/src/auth/sidecar.rs:58` (already uses `configured_port()` — leave; `configured_public_url` call there added in Task 3)
- Test: `src-tauri/src/misc/advanced.rs` (inline `#[cfg(test)]`)

**Interfaces:**
- Produces:
  - `advanced::configured_public_url(db: &DbState) -> Option<String>` (async)
  - `advanced::configured_trusted_origins(db: &DbState) -> Vec<String>` (async)
  - `advanced::migrate_domain_config_from_keyring(db: &DbState) -> Result<(), DbError>` (async)
  - `advanced::save_advanced(db, port: u16, public_url: &str, trusted_origins: &[String]) -> Result<(), DbError>` (async)
  - `AdvancedConfigDto { port: u16, public_url: String, trusted_origins: Vec<String> }`
- Consumes: `config::{get_local,set_local,upsert_pg}`, `outbox::enqueue`, `keyring_get` (existing).

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/misc/advanced.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DbState;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    async fn memory_db() -> DbState {
        let options = SqliteConnectOptions::new().filename(":memory:").foreign_keys(true);
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
        sqlx::migrate!("./migrations/sqlite").run(&pool).await.unwrap();
        DbState::new(pool)
    }

    #[tokio::test]
    async fn saves_and_reads_domain_config() {
        let db = memory_db().await;
        assert_eq!(configured_public_url(&db).await, None);
        assert!(configured_trusted_origins(&db).await.is_empty());

        save_advanced(
            &db,
            4000,
            "https://ponto.example.com/",
            &["https://a.trycloudflare.com".into(), " ".into(), "https://b.playit.gg/".into()],
        )
        .await
        .unwrap();

        assert_eq!(configured_public_url(&db).await, Some("https://ponto.example.com".into()));
        assert_eq!(
            configured_trusted_origins(&db).await,
            vec!["https://a.trycloudflare.com".to_string(), "https://b.playit.gg".to_string()],
        );
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test saves_and_reads_domain_config`
Expected: FAIL — `save_advanced` / `configured_trusted_origins` not found (compile error).

- [ ] **Step 3: Rewrite `src-tauri/src/misc/advanced.rs`**

```rust
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::app_flavor::DEFAULT_SIDECAR_PORT;
use crate::auth::guard;
use crate::auth::permissions::PermissionAction;
use crate::db::error::DbError;
use crate::db::repo::{config, outbox};
use crate::db::{keyring_get, keyring_set, DbState};

pub(crate) const KEYRING_SIDECAR_PORT: &str = "sidecar_port";
/// Legacy keyring key; value is migrated into `app_config` on startup.
pub(crate) const KEYRING_PUBLIC_URL: &str = "public_url";

const KEY_PUBLIC_URL: &str = "public_url";
const KEY_TRUSTED_ORIGINS: &str = "trusted_origins";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdvancedConfigDto {
    pub port: u16,
    pub public_url: String,
    pub trusted_origins: Vec<String>,
}

/// Port the auth sidecar should listen on. Stays in the keyring — it is not
/// domain config and is read before the DB pool in some paths.
pub(crate) fn configured_port() -> u16 {
    keyring_get(KEYRING_SIDECAR_PORT)
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(DEFAULT_SIDECAR_PORT)
}

fn normalize_origin(raw: &str) -> Option<String> {
    let t = raw.trim().trim_end_matches('/');
    if t.is_empty() { None } else { Some(t.to_string()) }
}

/// Base URL for e-mailed links (domain / reverse proxy), from `app_config`.
pub(crate) async fn configured_public_url(db: &DbState) -> Option<String> {
    let raw = config::get_local(&db.lite, KEY_PUBLIC_URL).await.ok()??;
    normalize_origin(&raw)
}

/// Additional origins trusted by Better Auth's CSRF/origin check (proxied
/// domains), stored newline-separated in `app_config`.
pub(crate) async fn configured_trusted_origins(db: &DbState) -> Vec<String> {
    let Some(raw) = config::get_local(&db.lite, KEY_TRUSTED_ORIGINS).await.ok().flatten() else {
        return Vec::new();
    };
    raw.lines().filter_map(normalize_origin).collect()
}

async fn save_config(db: &DbState, key: &str, value: &str) -> Result<(), DbError> {
    config::set_local(&db.lite, key, value).await?;

    #[derive(Serialize)]
    struct OutboxPayload<'a> {
        key: &'a str,
        value: &'a str,
    }
    outbox::enqueue(&db.lite, "upsert_app_config", &OutboxPayload { key, value }).await?;

    if let Some(pg) = db.pg_if_online().await {
        let _ = config::upsert_pg(&pg, key, value).await;
    }
    Ok(())
}

/// One-time move of the legacy keyring `public_url` into `app_config`. No-op
/// once `app_config` holds the key.
pub(crate) async fn migrate_domain_config_from_keyring(db: &DbState) -> Result<(), DbError> {
    if config::get_local(&db.lite, KEY_PUBLIC_URL).await?.is_some() {
        return Ok(());
    }
    if let Ok(value) = keyring_get(KEYRING_PUBLIC_URL) {
        if let Some(normalized) = normalize_origin(&value) {
            save_config(db, KEY_PUBLIC_URL, &normalized).await?;
        }
    }
    Ok(())
}

/// Persists port (keyring) + public URL and trusted origins (app_config).
pub(crate) async fn save_advanced(
    db: &DbState,
    port: u16,
    public_url: &str,
    trusted_origins: &[String],
) -> Result<(), DbError> {
    keyring_set(KEYRING_SIDECAR_PORT, &port.to_string())?;

    let public = public_url.trim().trim_end_matches('/');
    save_config(db, KEY_PUBLIC_URL, public).await?;

    let mut seen = std::collections::HashSet::new();
    let list: Vec<String> = trusted_origins
        .iter()
        .filter_map(|o| normalize_origin(o))
        .filter(|o| seen.insert(o.clone()))
        .collect();
    save_config(db, KEY_TRUSTED_ORIGINS, &list.join("\n")).await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn get_advanced_config_cmd(app: AppHandle) -> Result<AdvancedConfigDto, DbError> {
    let db = app.state::<DbState>();
    Ok(AdvancedConfigDto {
        port: configured_port(),
        public_url: configured_public_url(&db).await.unwrap_or_default(),
        trusted_origins: configured_trusted_origins(&db).await,
    })
}

#[tauri::command]
pub(crate) async fn set_advanced_config_cmd(
    app: AppHandle,
    port: u16,
    public_url: String,
    trusted_origins: Vec<String>,
) -> Result<bool, DbError> {
    guard::require_current(&app, PermissionAction::EditHierarchy)
        .await
        .map_err(|e| DbError::InvalidInput(e.to_string()))?;

    if port < 1024 {
        return Err(DbError::InvalidInput("a porta deve ser 1024 ou maior".into()));
    }
    let validate = |value: &str| -> Result<(), DbError> {
        let t = value.trim().trim_end_matches('/');
        if !t.is_empty() && !t.starts_with("http://") && !t.starts_with("https://") {
            return Err(DbError::InvalidInput(
                "os endereços devem começar com http:// ou https://".into(),
            ));
        }
        Ok(())
    };
    validate(&public_url)?;
    for origin in &trusted_origins {
        validate(origin)?;
    }

    let db = app.state::<DbState>();
    save_advanced(&db, port, &public_url, &trusted_origins).await?;

    // Push to the running sidecar so the change applies without a restart.
    // (push_public_origins added in Task 3.)
    let auth = app.state::<crate::auth::AuthState>();
    let public = configured_public_url(&db).await;
    let origins = configured_trusted_origins(&db).await;
    if let Err(e) = auth.push_public_origins(public.as_deref(), &origins).await {
        eprintln!("[advanced] public-origins push failed: {e}");
    }
    Ok(true)
}
```

> NOTE for implementer: the `push_public_origins` call will not compile until Task 3. If implementing strictly task-by-task, temporarily comment out the "Push to the running sidecar" block; Task 3 Step 3 restores it.

- [ ] **Step 4: Update `send_password_setup` to take `public_url`**

In `src-tauri/src/auth/client.rs`, change the signature and body (lines ~293-303):

```rust
    pub(crate) async fn send_password_setup(
        &self,
        email: &str,
        smtp: &crate::misc::smtp::SmtpConfigDto,
        public_url: Option<&str>,
        actor: Option<&UserLoggedDto>,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/password-setup/send", self.base_url().await?);
        let mut body = json!({ "email": email, "smtp": smtp });
        if let Some(public_url) = public_url {
            body["publicBaseUrl"] = json!(public_url);
        }
```

- [ ] **Step 5: Update the two callers in `src-tauri/src/auth/commands.rs`**

At line ~203 (the create-with-login command, `db` in scope):

```rust
    let public_url = crate::misc::advanced::configured_public_url(&db).await;
    auth.send_password_setup(&email, &smtp, public_url.as_deref(), Some(&actor)).await.map_err(|e| {
        AuthError::Internal(format!(
            "conta criada, mas o e-mail com o link de senha falhou ({e}) — use \"Enviar link de senha\" na aba Logins"
        ))
    })?;
```

At line ~220 (`auth_admin_send_password_reset`, only `app` in scope):

```rust
    let auth = app.state::<AuthState>();
    let db = app.state::<crate::db::DbState>();
    let public_url = crate::misc::advanced::configured_public_url(&db).await;
    auth.send_password_setup(email.trim(), &smtp, public_url.as_deref(), Some(&actor))
        .await
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd src-tauri && cargo test saves_and_reads_domain_config`
Expected: PASS. Then `cargo build` — expect it to fail only on the missing `push_public_origins` if not commented out (that is Task 3); otherwise clean.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/misc/advanced.rs src-tauri/src/auth/client.rs src-tauri/src/auth/commands.rs
git commit -m "feat: store domain config in app_config, add trusted_origins"
```

---

## Task 2: Sidecar trusts configured origins + push endpoint (TypeScript)

**Files:**
- Modify: `sidecar/src/runtime.ts` (add `trustedOrigins`, boot parse)
- Modify: `sidecar/src/auth.ts:24-31` (append `runtime.trustedOrigins`)
- Modify: `sidecar/src/index.ts` (add `POST /internal/public-origins/push`)

**Interfaces:**
- Produces: `runtime.trustedOrigins: string[]`; endpoint `POST /internal/public-origins/push` body `{ publicOrigin?: string | null, trustedOrigins?: string[] }`.
- Consumes: env `PONTUALL_PUBLIC_URL`, `PONTUALL_TRUSTED_ORIGINS` (set by Rust in Task 3).

- [ ] **Step 1: Extend `sidecar/src/runtime.ts`**

Replace the `runtime` object and add a boot parser:

```typescript
export const runtime: {
    smtp: SmtpConfig | null;
    publicOrigin: string | null;
    trustedOrigins: string[];
} = {
    smtp: null,
    publicOrigin: null,
    trustedOrigins: [],
};
```

Add below `configuredPublicOrigin()`:

```typescript
/** Extra origins (proxied domains) trusted by Better Auth, from the env the
 * Rust parent sets at spawn. Comma-separated, trailing slashes stripped. */
export function configuredTrustedOrigins(): string[] {
    const raw = process.env.PONTUALL_TRUSTED_ORIGINS?.trim();
    if (!raw) return [];
    return raw
        .split(",")
        .map((o) => o.trim().replace(/\/+$/, ""))
        .filter((o) => o.length > 0);
}
```

- [ ] **Step 2: Seed the trusted origins at boot in `sidecar/src/index.ts`**

Just after the existing `runtime.publicOrigin = ...` assignment (around line 30), add:

```typescript
runtime.trustedOrigins = configuredTrustedOrigins();
```

And add `configuredTrustedOrigins` to the import from `./runtime` (line 11).

- [ ] **Step 3: Append trusted origins in `sidecar/src/auth.ts`**

Change the `trustedOrigins` callback (lines 24-31) to:

```typescript
    trustedOrigins: () => [
        "http://tauri.localhost",
        "tauri://localhost",
        "http://localhost:3000",
        `http://127.0.0.1:${port}`,
        ...publicOrigins(port),
        ...(runtime.publicOrigin ? [runtime.publicOrigin] : []),
        ...runtime.trustedOrigins,
    ],
```

- [ ] **Step 4: Add the push endpoint in `sidecar/src/index.ts`**

Next to the other `/internal/*` handlers (e.g. after `/internal/smtp/push`), add:

```typescript
		if (url.pathname === "/internal/public-origins/push" && request.method === "POST") {
			const body = (await request.json()) as {
				publicOrigin?: string | null;
				trustedOrigins?: string[];
			};
			if (body.publicOrigin !== undefined) {
				const value = body.publicOrigin?.trim().replace(/\/+$/, "");
				runtime.publicOrigin = value && value.length > 0 ? value : null;
			}
			if (Array.isArray(body.trustedOrigins)) {
				runtime.trustedOrigins = body.trustedOrigins
					.map((o) => o.trim().replace(/\/+$/, ""))
					.filter((o) => o.length > 0);
			}
			return Response.json({ ok: true });
		}
```

- [ ] **Step 5: Type-check the sidecar**

Run: `cd sidecar && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add sidecar/src/runtime.ts sidecar/src/auth.ts sidecar/src/index.ts
git commit -m "feat: sidecar trusts configured proxied origins + push endpoint"
```

---

## Task 3: Feed origins to the sidecar (Rust spawn env + push method)

**Files:**
- Modify: `src-tauri/src/auth/client.rs` (add `push_public_origins`)
- Modify: `src-tauri/src/auth/sidecar.rs` (migrate keyring, pass env, best-effort push)

**Interfaces:**
- Produces: `AuthState::push_public_origins(&self, public_origin: Option<&str>, trusted: &[String]) -> Result<(), AuthError>`.
- Consumes: Task 1 `advanced::{configured_public_url, configured_trusted_origins, migrate_domain_config_from_keyring}`; Task 2 endpoint.

- [ ] **Step 1: Add `push_public_origins` to `src-tauri/src/auth/client.rs`**

Next to `push_smtp_config` (around line 627):

```rust
    /// Pushes the public origin (e-mail base) and the extra trusted origins to
    /// the sidecar so Better Auth's origin check accepts proxied domains
    /// without a restart.
    pub(crate) async fn push_public_origins(
        &self,
        public_origin: Option<&str>,
        trusted: &[String],
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/public-origins/push", self.base_url().await?);
        self.request(reqwest::Method::POST, url, None)
            .json(&json!({ "publicOrigin": public_origin, "trustedOrigins": trusted }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }
```

- [ ] **Step 2: Migrate + pass env at spawn in `src-tauri/src/auth/sidecar.rs`**

At the top of `start()`, after `let state = app.state::<AuthState>();` and the idempotency check, add the one-time migration and read the values:

```rust
    let db_state = app.state::<DbState>();
    crate::misc::advanced::migrate_domain_config_from_keyring(&db_state)
        .await
        .map_err(|e| AuthError::Internal(e.to_string()))?;
    let public_url = crate::misc::advanced::configured_public_url(&db_state).await;
    let trusted_origins = crate::misc::advanced::configured_trusted_origins(&db_state).await;
```

Then extend the command builder (after the existing `.env("PONTUALL_SHARED_KEY", ...)`):

```rust
        .env("PONTUALL_PUBLIC_URL", public_url.clone().unwrap_or_default())
        .env("PONTUALL_TRUSTED_ORIGINS", trusted_origins.join(","));
```

> `DbState` is already imported in this file (see the `use crate::db::{... DbState ...}` line).

- [ ] **Step 3: Restore the push block in `set_advanced_config_cmd`**

If it was commented out in Task 1 Step 3, uncomment the "Push to the running sidecar" block now that `push_public_origins` exists.

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/auth/client.rs src-tauri/src/auth/sidecar.rs src-tauri/src/misc/advanced.rs
git commit -m "feat: feed public + trusted origins to sidecar at spawn and on change"
```

---

## Task 4: Advanced settings UI — trusted origins editor (frontend)

**Files:**
- Modify: `src/lib/Tauri/index.ts:273-285` (`GetAdvancedConfig` / `SetAdvancedConfig`)
- Modify: `src/components/main/Admin.tsx` (form state, load, save, UI list editor)

**Interfaces:**
- Consumes: `get_advanced_config_cmd` now returns `{ port, publicUrl, trustedOrigins }`; `set_advanced_config_cmd` takes `{ port, publicUrl, trustedOrigins }`.

- [ ] **Step 1: Update the Tauri wrappers in `src/lib/Tauri/index.ts`**

```typescript
    public static async GetAdvancedConfig() {
        return this.command<{
            port: number;
            publicUrl: string;
            trustedOrigins: string[];
        }>("get_advanced_config_cmd", {});
    }

    public static async SetAdvancedConfig(
        port: number,
        publicUrl: string,
        trustedOrigins: string[]
    ) {
        return this.command<boolean>("set_advanced_config_cmd", {
            port,
            publicUrl,
            trustedOrigins,
        });
    }
```

- [ ] **Step 2: Form state in `src/components/main/Admin.tsx:117`**

```tsx
    const [advancedForm, setAdvancedForm] = useState<{
        port: string;
        publicUrl: string;
        trustedOrigins: string[];
    }>({port: "3435", publicUrl: "", trustedOrigins: []});
```

- [ ] **Step 3: Load handler in `src/components/main/Admin.tsx:162-166`**

```tsx
                setAdvancedForm({
                    port: String(config.port),
                    publicUrl: config.publicUrl,
                    trustedOrigins: config.trustedOrigins ?? [],
                });
```

- [ ] **Step 4: Save handler in `src/components/main/Admin.tsx:357-363`**

```tsx
            await TauriApi.SetAdvancedConfig(
                Number(advancedForm.port),
                advancedForm.publicUrl,
                advancedForm.trustedOrigins.map((o) => o.trim()).filter((o) => o.length > 0)
            );
```

- [ ] **Step 5: Insert the list editor UI** (in `Admin.tsx`, after the public-url `<div className="space-y-2">…</div>` that ends at line ~895, before the save-button `<div className="sm:col-span-2">`):

```tsx
                            <div className="space-y-2 sm:col-span-2">
                                <Label>Domínios externos confiáveis</Label>
                                <p className="text-xs text-muted-foreground">
                                    Domínios proxy (cloudflared, playit, VPN) pelos quais o
                                    portal é acessado. Cada um precisa começar com http:// ou
                                    https://.
                                </p>
                                {advancedForm.trustedOrigins.map((origin, i) => (
                                    <div key={i} className="flex gap-2">
                                        <Input
                                            type="url"
                                            placeholder="https://ponto.trycloudflare.com"
                                            value={origin}
                                            onChange={(e) =>
                                                setAdvancedForm((p) => {
                                                    const next = [...p.trustedOrigins];
                                                    next[i] = e.target.value;
                                                    return {...p, trustedOrigins: next};
                                                })
                                            }
                                        />
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() =>
                                                setAdvancedForm((p) => ({
                                                    ...p,
                                                    trustedOrigins: p.trustedOrigins.filter(
                                                        (_, j) => j !== i
                                                    ),
                                                }))
                                            }
                                        >
                                            Remover
                                        </Button>
                                    </div>
                                ))}
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() =>
                                        setAdvancedForm((p) => ({
                                            ...p,
                                            trustedOrigins: [...p.trustedOrigins, ""],
                                        }))
                                    }
                                >
                                    Adicionar domínio
                                </Button>
                            </div>
```

> If `Button` in this file does not accept `variant="secondary"`, drop the prop — the import is `@/components/ui/button`; check its variants.

- [ ] **Step 6: Type-check the frontend**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/Tauri/index.ts src/components/main/Admin.tsx
git commit -m "feat: manage multiple trusted proxied domains in Advanced settings"
```

---

## Task 5: `exclude_from_report` column + model plumbing (Rust)

**Files:**
- Create: `src-tauri/migrations/postgres/0006_employee_exclude_from_report.sql`
- Create: `src-tauri/migrations/sqlite/0006_employee_exclude_from_report.sql`
- Modify: `src-tauri/src/db/models.rs` (`Employee`, `UserExternal`, `to_user_external`)
- Modify: `src-tauri/src/db/repo/employees.rs` (UPSERT columns + bind)
- Test: `src-tauri/src/db/mod.rs` (extend the existing roundtrip test)

**Interfaces:**
- Produces: `Employee.exclude_from_report: bool`, `UserExternal.exclude_from_report: bool`.

- [ ] **Step 1: Create the Postgres migration**

`src-tauri/migrations/postgres/0006_employee_exclude_from_report.sql`:

```sql
-- Admins may hide themselves from the attendance report (self-service toggle
-- in the portal). Non-sensitive; defaults to visible.
ALTER TABLE employees ADD COLUMN exclude_from_report BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Create the SQLite migration**

`src-tauri/migrations/sqlite/0006_employee_exclude_from_report.sql`:

```sql
ALTER TABLE employees ADD COLUMN exclude_from_report INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 3: Add the field to the `Employee` struct** (`src-tauri/src/db/models.rs`, after `updated_at`):

```rust
    pub updated_at: DateTime<Utc>,
    pub exclude_from_report: bool,
}
```

Add to `UserExternal` (after `auth_user_id`). `#[serde(default)]` keeps the Excel command's deserialization robust if the frontend payload ever omits it:

```rust
    pub(crate) auth_user_id: Option<String>,
    #[serde(default)]
    pub(crate) exclude_from_report: bool,
}
```

In `to_user_external`, set it (after `auth_user_id: self.auth_user_id.clone(),`):

```rust
            auth_user_id: self.auth_user_id.clone(),
            exclude_from_report: self.exclude_from_report,
        }
```

- [ ] **Step 4: Thread it through the employees UPSERT** (`src-tauri/src/db/repo/employees.rs`)

Change `UPSERT` to include the column:

```rust
const UPSERT: &str = "\
INSERT INTO employees (id, name, email, phone, role, lunch_time, status, auth_user_id, terminated_at, created_at, updated_at, exclude_from_report) \
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
ON CONFLICT (id) DO UPDATE SET \
  name = excluded.name, email = excluded.email, phone = excluded.phone, \
  role = excluded.role, lunch_time = excluded.lunch_time, status = excluded.status, \
  auth_user_id = excluded.auth_user_id, \
  terminated_at = excluded.terminated_at, \
  updated_at = excluded.updated_at, \
  exclude_from_report = excluded.exclude_from_report \
WHERE employees.updated_at <= excluded.updated_at";
```

Add the bind at the end of `bind_upsert` (after `.bind(e.updated_at)`):

```rust
        .bind(e.updated_at)
        .bind(e.exclude_from_report)
}
```

Add `bool: sqlx::Type<DB> + sqlx::Encode<'q, DB>,` to the `where` clause of `bind_upsert`.

- [ ] **Step 5: Add the field to every `Employee { ... }` literal.** There are four construction sites — add `exclude_from_report: false,` (after `updated_at: ...,`) to each:
  - `src-tauri/src/db/commands.rs:74` (`insert_new_user`)
  - `src-tauri/src/auth/commands.rs:109` (create-with-login)
  - `src-tauri/src/db/mod.rs:159` (test helper `employee`)
  - `src-tauri/src/db/retention.rs:156` (test helper `employee`)

  (Sites that mutate an `Employee` read from the DB — e.g. `update_employee`, `employee_terminate` — need no change.)

- [ ] **Step 6: Extend the roundtrip test** in `src-tauri/src/db/mod.rs` `employee_and_punch_roundtrip`, after the first `employees::upsert`:

```rust
        // exclude_from_report defaults false and round-trips.
        assert!(!listed[0].exclude_from_report);
        let mut hidden = employee("emp2", "Bob");
        hidden.exclude_from_report = true;
        employees::upsert(&db, &hidden).await.unwrap();
        let bob = employees::find_local(&db.lite, "emp2").await.unwrap().unwrap();
        assert!(bob.exclude_from_report);
```

- [ ] **Step 7: Run tests**

Run: `cd src-tauri && cargo test employee_and_punch_roundtrip`
Expected: PASS. Then `cargo build` — clean (fix any other `Employee {…}` literals the compiler flags, e.g. in `commands.rs` termination paths where structs are read from DB, not constructed — those are fine).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/migrations src-tauri/src/db/models.rs src-tauri/src/db/repo/employees.rs src-tauri/src/db/mod.rs src-tauri/src/db/commands.rs src-tauri/src/auth/commands.rs src-tauri/src/db/retention.rs
git commit -m "feat: add employees.exclude_from_report column and model plumbing"
```

---

## Task 6: Report skips excluded employees (Rust, authoritative)

**Files:**
- Modify: `src-tauri/src/excel/create.rs` (read excluded IDs from local DB, skip)
- Test: `src-tauri/src/excel/create.rs` (inline test of the skip-set helper)

**Interfaces:**
- Consumes: `Employee.exclude_from_report` (Task 5), `employees::list_local`.

- [ ] **Step 1: Add a testable helper + failing test** in `src-tauri/src/excel/create.rs`

Add near the top (after imports):

```rust
/// IDs of employees flagged to stay out of the report.
fn excluded_ids(employees: &[crate::db::models::Employee]) -> std::collections::HashSet<String> {
    employees
        .iter()
        .filter(|e| e.exclude_from_report)
        .map(|e| e.id.clone())
        .collect()
}
```

Add at the bottom (replace the commented-out test module or add a new one):

```rust
#[cfg(test)]
mod exclude_tests {
    use super::excluded_ids;
    use crate::db::models::Employee;
    use chrono::Utc;

    fn emp(id: &str, hidden: bool) -> Employee {
        let now = Utc::now();
        Employee {
            id: id.into(), name: id.into(), email: None, phone: None,
            role: "r".into(), lunch_time: None, status: "active".into(),
            auth_user_id: None, terminated_at: None, created_at: now,
            updated_at: now, exclude_from_report: hidden,
        }
    }

    #[test]
    fn only_flagged_ids_are_excluded() {
        let set = excluded_ids(&[emp("a", false), emp("b", true)]);
        assert!(!set.contains("a"));
        assert!(set.contains("b"));
        assert_eq!(set.len(), 1);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test only_flagged_ids_are_excluded`
Expected: FAIL — `excluded_ids` not found until Step 1 saved; if saved, PASS. (This helper is trivial; the real behavior is the loop skip below.)

- [ ] **Step 3: Apply the skip in `create_excel_relatory`**

After `guard::require_current(...)` and before building the workbook, load the excluded set:

```rust
    let excluded = {
        let state = app.state::<crate::db::DbState>();
        let all = crate::db::repo::employees::list_local(&state.lite)
            .await
            .unwrap_or_default();
        excluded_ids(&all)
    };
```

Add `use tauri::Manager;` at the top if not present (needed for `app.state`). Then in the main write loop `for (name, users) in users.iter() {` add as the first line of the body:

```rust
    for (name, users) in users.iter() {
        if excluded.contains(&users.id) {
            continue;
        }
```

And in the earlier data-collection loop `for (name, user) in users.iter() {` add:

```rust
    for (name, user) in users.iter() {
        if excluded.contains(&user.id) {
            continue;
        }
```

- [ ] **Step 4: Run tests + build**

Run: `cd src-tauri && cargo test only_flagged_ids_are_excluded && cargo build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/excel/create.rs
git commit -m "feat: exclude flagged employees from the Excel report"
```

---

## Task 7: Report-visibility endpoint + portal data flag (sidecar)

**Files:**
- Modify: `sidecar/src/portal.ts` (`loadPortalExport` returns `excludeFromReport`; add `setReportVisibility`)
- Modify: `sidecar/src/index.ts` (`/portal/data` includes `accessLevel` + `excludeFromReport`; add `POST /portal/admin/report-visibility`)

**Interfaces:**
- Produces: `setReportVisibility(authUserId: string, hidden: boolean): Promise<number>` (rows affected); a shared `requireAdmin` helper (defined here, reused in Tasks 9-10).

- [ ] **Step 1: Extend `loadPortalExport` in `sidecar/src/portal.ts`**

Add `exclude_from_report` to the `EmployeeRow` type and the SELECT, and return it:

```typescript
type EmployeeRow = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    lunch_time: string | null;
    created_at: Date;
    exclude_from_report: boolean;
};
```

In the query add the column:

```typescript
    const employees = await prisma.$queryRaw<EmployeeRow[]>`
        SELECT id, name, email, phone, role, lunch_time, created_at, exclude_from_report
        FROM employees WHERE auth_user_id = ${authUserId}
    `;
```

In the returned object add (inside `employee: { ... }`):

```typescript
            createdAt: employee.created_at.toISOString(),
            excludeFromReport: employee.exclude_from_report,
```

- [ ] **Step 2: Add `setReportVisibility` to `sidecar/src/portal.ts`**

```typescript
/** Sets the caller's own report-visibility flag. Returns rows affected. */
export async function setReportVisibility(
    authUserId: string,
    hidden: boolean,
): Promise<number> {
    const affected = await prisma.$executeRaw`
        UPDATE employees SET exclude_from_report = ${hidden}, updated_at = now()
        WHERE auth_user_id = ${authUserId}
    `;
    return affected;
}
```

Add `setReportVisibility` to the exports and to the import in `index.ts`.

- [ ] **Step 3: Add a shared admin gate in `sidecar/src/index.ts`**

Above the `Bun.serve(...)` call (after imports), add:

```typescript
type AdminGate =
    | { ok: true; user: { id: string; name: string | null; email: string | null } }
    | { ok: false; response: Response };

/** Resolves the session and checks the given Better Auth permissions. */
async function requireAdmin(
    request: Request,
    permissions: Record<string, string[]>,
): Promise<AdminGate> {
    let session = null;
    try {
        session = await auth.api.getSession({ headers: request.headers });
    } catch {
        // treated as unauthenticated
    }
    if (!session?.user) {
        return { ok: false, response: Response.json({ error: "não autenticado" }, { status: 401 }) };
    }
    let allowed = false;
    try {
        const result = await auth.api.userHasPermission({
            body: { userId: session.user.id, permissions },
        });
        allowed = Boolean(result?.success);
    } catch {
        allowed = false;
    }
    if (!allowed) {
        return { ok: false, response: Response.json({ error: "acesso negado" }, { status: 403 }) };
    }
    return {
        ok: true,
        user: {
            id: session.user.id,
            name: session.user.name ?? null,
            email: session.user.email ?? null,
        },
    };
}

/** Better Auth role → PontuAll access level, for cosmetic UI gating. */
function accessLevel(role?: string | null): "employee" | "supervisor" | "administrator" {
    const v = (role ?? "employee").toLowerCase();
    if (v.includes("admin")) return "administrator";
    if (v.includes("supervisor")) return "supervisor";
    return "employee";
}
```

- [ ] **Step 4: Exempt `/portal/admin/*` from the shared-key gate**

In the `fetch` handler, alongside `isPortalData`, add:

```typescript
			const isPortalAdmin = url.pathname.startsWith("/portal/admin/");
```

and include it in the gate condition:

```typescript
			if (!isAuthApi && !isHealth && !isPortalData && !isPortalAdmin) {
```

- [ ] **Step 5: Include `accessLevel` in the `/portal/data` response**

In the `isPortalData` branch, after loading `data`, attach the access level from the session (the session is already resolved there as `session`):

```typescript
				const data = await loadPortalExport(session.user.id);
				if (!data) {
					return Response.json(
						{ error: "nenhum funcionário vinculado a esta conta" },
						{ status: 404 },
					);
				}
				const withRole = { ...(data as object), accessLevel: accessLevel(session.user.role) };
```

and return `withRole` instead of `data` in that branch's `Response.json(...)`. (`excludeFromReport` already rides inside `data.employee`.)

- [ ] **Step 6: Add the report-visibility route in `sidecar/src/index.ts`**

```typescript
			if (url.pathname === "/portal/admin/report-visibility" && request.method === "POST") {
				const gate = await requireAdmin(request, { punch: ["delete-others"] });
				if (!gate.ok) return gate.response;
				const body = (await request.json()) as { hidden?: boolean };
				if (typeof body.hidden !== "boolean") {
					return Response.json({ error: "hidden (boolean) obrigatório" }, { status: 400 });
				}
				const affected = await setReportVisibility(gate.user.id, body.hidden);
				void logAudit({
					actorId: gate.user.id,
					actorName: gate.user.name,
					actorType: "admin",
					action: "portal/report-visibility",
					resource: maskEmail(gate.user.email ?? ""),
					success: affected > 0,
					ipAddress: server.requestIP(request)?.address ?? null,
					userAgent: request.headers.get("user-agent"),
					payload: { hidden: body.hidden },
				});
				return Response.json({ ok: true, hidden: body.hidden });
			}
```

- [ ] **Step 7: Type-check**

Run: `cd sidecar && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add sidecar/src/portal.ts sidecar/src/index.ts
git commit -m "feat: portal report-visibility toggle + access level in portal data"
```

---

## Task 8: Report opt-out checkbox in the portal (client)

**Files:**
- Modify: `sidecar/portal/index.html` (checkbox, admin-only container)
- Modify: `sidecar/portal/app.ts` (type, render, toggle handler)

**Interfaces:**
- Consumes: `/portal/data` now returns `accessLevel` and `employee.excludeFromReport`; `POST /portal/admin/report-visibility`.

- [ ] **Step 1: Extend the `PortalData` type in `sidecar/portal/app.ts`**

```typescript
type PortalData = {
    employee: {
        name: string;
        email: string | null;
        phone: string | null;
        role: string;
        lunchTime: string | null;
        createdAt: string;
        excludeFromReport: boolean;
    };
    timeEntries: PortalTimeEntry[];
    generatedAt: string;
    accessLevel: "employee" | "supervisor" | "administrator";
};
```

- [ ] **Step 2: Add the admin block to `sidecar/portal/index.html`**

Inside `<div id="portal" hidden>`, just before the closing `<p class="lgpd">`, add:

```html
        <div id="admin-report-visibility" hidden>
            <details>
                <summary>Opções de administrador</summary>
                <label style="display:flex;gap:8px;align-items:center;margin-top:8px">
                    <input id="report-visibility" type="checkbox">
                    Não aparecer nos relatórios
                </label>
            </details>
        </div>
```

- [ ] **Step 3: Render + wire the checkbox in `sidecar/portal/app.ts`**

In `render(data)`, after the portal is shown (`portal.hidden = false;`), add:

```typescript
    const adminBlock = el<HTMLDivElement>("admin-report-visibility");
    const reportChk = el<HTMLInputElement>("report-visibility");
    if (data.accessLevel === "administrator") {
        adminBlock.hidden = false;
        reportChk.checked = data.employee.excludeFromReport;
    } else {
        adminBlock.hidden = true;
    }
```

At the bottom of the file (near the other listeners), add:

```typescript
el<HTMLInputElement>("report-visibility").addEventListener("change", async (e) => {
    const checkbox = e.currentTarget as HTMLInputElement;
    clearMsg();
    try {
        const res = await fetch("/portal/admin/report-visibility", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hidden: checkbox.checked }),
        });
        if (!res.ok) {
            checkbox.checked = !checkbox.checked;
            show("error", "Não foi possível salvar a preferência.");
            return;
        }
        if (exportData) exportData.employee.excludeFromReport = checkbox.checked;
        show("success", "Preferência salva.");
    } catch {
        checkbox.checked = !checkbox.checked;
        show("error", "Falha de conexão — tente novamente.");
    }
});
```

- [ ] **Step 4: Type-check the portal**

Run: `cd sidecar && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add sidecar/portal/index.html sidecar/portal/app.ts
git commit -m "feat: admin report opt-out checkbox in the portal"
```

---

## Task 9: Admin punch read endpoints (sidecar)

**Files:**
- Modify: `sidecar/src/portal.ts` (`loadAdminEmployees`, `loadEmployeePunches`)
- Modify: `sidecar/src/index.ts` (`GET /portal/admin/employees`, `GET /portal/admin/punches`)

**Interfaces:**
- Produces: `loadAdminEmployees(): Promise<{ id, name, role }[]>`; `loadEmployeePunches(employeeId: string): Promise<PortalTimeEntry[]>` (same entry shape as `loadPortalExport`).
- Consumes: `requireAdmin` (Task 7).

- [ ] **Step 1: Add the loaders to `sidecar/src/portal.ts`**

```typescript
/** All employees, for the admin punch-management picker. */
export async function loadAdminEmployees(): Promise<
    { id: string; name: string; role: string }[]
> {
    return prisma.$queryRaw<{ id: string; name: string; role: string }[]>`
        SELECT id, name, role FROM employees ORDER BY name ASC
    `;
}

/** One employee's full punch history, same shape as loadPortalExport entries. */
export async function loadEmployeePunches(employeeId: string): Promise<
    {
        date: string;
        clockIn: string | null;
        lunchOut: string | null;
        lunchReturn: string | null;
        clockOut: string | null;
        totalHours: string | null;
    }[]
> {
    const entries = await prisma.$queryRaw<TimeEntryRow[]>`
        SELECT work_date, clock_in, lunch_out, lunch_return, clock_out
        FROM time_entries WHERE employee_id = ${employeeId}
        ORDER BY work_date DESC
    `;
    return entries.map((e) => ({
        date: e.work_date.toISOString().slice(0, 10),
        clockIn: e.clock_in?.toISOString() ?? null,
        lunchOut: e.lunch_out?.toISOString() ?? null,
        lunchReturn: e.lunch_return?.toISOString() ?? null,
        clockOut: e.clock_out?.toISOString() ?? null,
        totalHours: totalHours(e),
    }));
}
```

Add both to the exports and to the `index.ts` import.

- [ ] **Step 2: Add the routes in `sidecar/src/index.ts`**

```typescript
			if (url.pathname === "/portal/admin/employees" && request.method === "GET") {
				const gate = await requireAdmin(request, { punch: ["read-others"] });
				if (!gate.ok) return gate.response;
				const employees = await loadAdminEmployees();
				void logAudit({
					actorId: gate.user.id, actorName: gate.user.name, actorType: "admin",
					action: "portal/admin-employees-list", success: true,
					ipAddress: server.requestIP(request)?.address ?? null,
					userAgent: request.headers.get("user-agent"),
				});
				return Response.json({ employees });
			}

			if (url.pathname === "/portal/admin/punches" && request.method === "GET") {
				const gate = await requireAdmin(request, { punch: ["read-others"] });
				if (!gate.ok) return gate.response;
				const employeeId = url.searchParams.get("employeeId") ?? "";
				if (!employeeId) {
					return Response.json({ error: "employeeId obrigatório" }, { status: 400 });
				}
				const entries = await loadEmployeePunches(employeeId);
				void logAudit({
					actorId: gate.user.id, actorName: gate.user.name, actorType: "admin",
					action: "portal/admin-punch-read", resource: `employee:${employeeId}`,
					success: true, ipAddress: server.requestIP(request)?.address ?? null,
					userAgent: request.headers.get("user-agent"),
				});
				return Response.json({ entries });
			}
```

- [ ] **Step 3: Type-check**

Run: `cd sidecar && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add sidecar/src/portal.ts sidecar/src/index.ts
git commit -m "feat: admin punch read endpoints (list employees, read punches)"
```

---

## Task 10: Admin punch edit + delete endpoints (sidecar)

**Files:**
- Modify: `sidecar/src/portal.ts` (`setPunchField`, `deletePunchDay`)
- Modify: `sidecar/src/index.ts` (`POST /portal/admin/punch`, `POST /portal/admin/punch/delete`)

**Interfaces:**
- Produces: `setPunchField(employeeId, dateISO, field, localTime)`, `deletePunchDay(employeeId, dateISO)`.
- Consumes: `requireAdmin` (Task 7).

- [ ] **Step 1: Add the writers to `sidecar/src/portal.ts`**

```typescript
const PUNCH_COLUMN: Record<string, string> = {
    clockIn: "clock_in",
    lunchOut: "lunch_out",
    lunchReturn: "lunch_return",
    clockOut: "clock_out",
};

/** Sets one punch field (local HH:MM on the given ISO date). Merges
 * punch_sources[column] = "portal_admin". Postgres is authoritative; the kiosk
 * pulls this row LWW by updated_at. */
export async function setPunchField(
    employeeId: string,
    dateISO: string,
    field: string,
    localTime: string,
): Promise<void> {
    const column = PUNCH_COLUMN[field];
    if (!column) throw new Error("campo inválido");
    const ts = new Date(`${dateISO}T${localTime}:00`);
    if (Number.isNaN(ts.getTime())) throw new Error("hora inválida");

    // punch_sources is TEXT — merge in JS.
    const existing = await prisma.$queryRaw<{ punch_sources: string | null }[]>`
        SELECT punch_sources FROM time_entries
        WHERE employee_id = ${employeeId} AND work_date = ${dateISO}::date
    `;
    const sources: Record<string, string> = existing[0]?.punch_sources
        ? (JSON.parse(existing[0].punch_sources) as Record<string, string>)
        : {};
    sources[column] = "portal_admin";
    const sourcesJson = JSON.stringify(sources);

    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
        `INSERT INTO time_entries (id, employee_id, work_date, ${column}, updated_at, punch_sources)
         VALUES ($1, $2, $3::date, $4, now(), $5)
         ON CONFLICT (employee_id, work_date) DO UPDATE SET
           ${column} = EXCLUDED.${column},
           updated_at = EXCLUDED.updated_at,
           punch_sources = EXCLUDED.punch_sources`,
        id,
        employeeId,
        dateISO,
        ts,
        sourcesJson,
    );
}

/** Deletes an employee's whole day from Postgres. The kiosk reaps the local
 * mirror row on its next sync (see run_sync). */
export async function deletePunchDay(employeeId: string, dateISO: string): Promise<void> {
    await prisma.$executeRaw`
        DELETE FROM time_entries
        WHERE employee_id = ${employeeId} AND work_date = ${dateISO}::date
    `;
}
```

`column` comes only from the fixed `PUNCH_COLUMN` whitelist, so the interpolation into `$executeRawUnsafe` is safe. Add both functions to the exports and the `index.ts` import.

- [ ] **Step 2: Add the routes in `sidecar/src/index.ts`**

```typescript
			if (url.pathname === "/portal/admin/punch" && request.method === "POST") {
				const gate = await requireAdmin(request, { punch: ["write-others"], hours: ["edit"] });
				if (!gate.ok) return gate.response;
				const body = (await request.json()) as {
					employeeId?: string; date?: string; field?: string; value?: string;
				};
				const okDate = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "");
				const okTime = /^\d{2}:\d{2}$/.test(body.value ?? "");
				const okField = ["clockIn", "lunchOut", "lunchReturn", "clockOut"].includes(body.field ?? "");
				if (!body.employeeId || !okDate || !okTime || !okField) {
					return Response.json({ error: "parâmetros inválidos" }, { status: 400 });
				}
				try {
					await setPunchField(body.employeeId, body.date!, body.field!, body.value!);
				} catch (e) {
					return Response.json({ error: e instanceof Error ? e.message : "erro" }, { status: 400 });
				}
				void logAudit({
					actorId: gate.user.id, actorName: gate.user.name, actorType: "admin",
					action: "portal/punch-edit", resource: `employee:${body.employeeId}`,
					success: true, ipAddress: server.requestIP(request)?.address ?? null,
					userAgent: request.headers.get("user-agent"),
					payload: { date: body.date, field: body.field },
				});
				return Response.json({ ok: true });
			}

			if (url.pathname === "/portal/admin/punch/delete" && request.method === "POST") {
				const gate = await requireAdmin(request, { punch: ["delete-others"] });
				if (!gate.ok) return gate.response;
				const body = (await request.json()) as { employeeId?: string; date?: string };
				const okDate = /^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "");
				if (!body.employeeId || !okDate) {
					return Response.json({ error: "parâmetros inválidos" }, { status: 400 });
				}
				await deletePunchDay(body.employeeId, body.date!);
				void logAudit({
					actorId: gate.user.id, actorName: gate.user.name, actorType: "admin",
					action: "portal/punch-delete", resource: `employee:${body.employeeId}`,
					success: true, ipAddress: server.requestIP(request)?.address ?? null,
					userAgent: request.headers.get("user-agent"),
					payload: { date: body.date },
				});
				return Response.json({ ok: true });
			}
```

> The edit route checks `write-others` + `hours:edit`; the delete route checks `delete-others` (an administrator-only capability, which also implies they can write). This matches the spec's gating.

- [ ] **Step 3: Type-check + bundle**

Run: `cd sidecar && bunx tsc --noEmit && bun run build`
Expected: no type errors; bundle succeeds.

- [ ] **Step 4: Commit**

```bash
git add sidecar/src/portal.ts sidecar/src/index.ts
git commit -m "feat: admin punch edit + delete endpoints (portal_admin source, audited)"
```

---

## Task 11: Portal admin panel UI (client)

**Files:**
- Modify: `sidecar/portal/index.html` (admin panel markup)
- Modify: `sidecar/portal/app.ts` (fetch employees/punches, edit/delete handlers)

**Interfaces:**
- Consumes: `/portal/admin/employees`, `/portal/admin/punches?employeeId=`, `/portal/admin/punch`, `/portal/admin/punch/delete`; `accessLevel` from `/portal/data`.

- [ ] **Step 1: Add the admin panel markup to `sidecar/portal/index.html`**

Inside `<div id="portal" hidden>`, after the existing `</div>` that closes `.actions` (before `<details>` for change-password), add:

```html
        <div id="admin-panel" hidden>
            <h2>Gerenciar pontos (administrador)</h2>
            <div class="filters">
                <select id="admin-employee"><option value="">Selecione um funcionário</option></select>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr><th>Data</th><th>Entrada</th><th>Almoço — saída</th>
                            <th>Almoço — retorno</th><th>Saída</th><th>Ações</th></tr>
                    </thead>
                    <tbody id="admin-entries"></tbody>
                </table>
            </div>
            <p id="admin-no-entries" class="no-entries" hidden>Nenhum registro para este funcionário.</p>
        </div>
```

- [ ] **Step 2: Populate the panel in `render(data)` in `sidecar/portal/app.ts`**

Extend the admin gating added in Task 8 Step 3 to also show the panel and load employees:

```typescript
    if (data.accessLevel === "administrator") {
        adminBlock.hidden = false;
        reportChk.checked = data.employee.excludeFromReport;
        el<HTMLDivElement>("admin-panel").hidden = false;
        void loadAdminEmployees();
    } else {
        adminBlock.hidden = true;
        el<HTMLDivElement>("admin-panel").hidden = true;
    }
```

- [ ] **Step 3: Add the admin logic at the bottom of `sidecar/portal/app.ts`**

```typescript
type AdminEntry = {
    date: string;
    clockIn: string | null;
    lunchOut: string | null;
    lunchReturn: string | null;
    clockOut: string | null;
    totalHours: string | null;
};

const FIELD_OF_INDEX: ("clockIn" | "lunchOut" | "lunchReturn" | "clockOut")[] = [
    "clockIn", "lunchOut", "lunchReturn", "clockOut",
];

async function loadAdminEmployees(): Promise<void> {
    const res = await fetch("/portal/admin/employees");
    if (!res.ok) return;
    const { employees } = (await res.json()) as { employees: { id: string; name: string }[] };
    const sel = el<HTMLSelectElement>("admin-employee");
    sel.innerHTML = '<option value="">Selecione um funcionário</option>';
    for (const emp of employees) {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = emp.name;
        sel.append(opt);
    }
}

function timeInput(value: string | null): string {
    // ISO -> HH:MM for the <input type="time">.
    if (!value) return "";
    const d = new Date(value);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function loadAdminPunches(employeeId: string): Promise<void> {
    const tbody = el<HTMLTableSectionElement>("admin-entries");
    tbody.innerHTML = "";
    if (!employeeId) {
        el<HTMLParagraphElement>("admin-no-entries").hidden = true;
        return;
    }
    const res = await fetch(`/portal/admin/punches?employeeId=${encodeURIComponent(employeeId)}`);
    if (!res.ok) {
        show("error", "Não foi possível carregar os pontos.");
        return;
    }
    const { entries } = (await res.json()) as { entries: AdminEntry[] };
    el<HTMLParagraphElement>("admin-no-entries").hidden = entries.length > 0;
    for (const entry of entries) {
        const tr = document.createElement("tr");

        const dateTd = document.createElement("td");
        dateTd.textContent = fmtDate(entry.date);
        tr.append(dateTd);

        const values = [entry.clockIn, entry.lunchOut, entry.lunchReturn, entry.clockOut];
        values.forEach((value, i) => {
            const td = document.createElement("td");
            const input = document.createElement("input");
            input.type = "time";
            input.value = timeInput(value);
            input.addEventListener("change", () => {
                if (!input.value) return;
                void savePunch(employeeId, entry.date, FIELD_OF_INDEX[i], input.value);
            });
            td.append(input);
            tr.append(td);
        });

        const actionTd = document.createElement("td");
        const del = document.createElement("button");
        del.type = "button";
        del.className = "secondary";
        del.textContent = "Excluir dia";
        del.addEventListener("click", () => void deletePunch(employeeId, entry.date));
        actionTd.append(del);
        tr.append(actionTd);

        tbody.append(tr);
    }
}

async function savePunch(
    employeeId: string,
    dateISO: string,
    field: string,
    value: string,
): Promise<void> {
    clearMsg();
    const res = await fetch("/portal/admin/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, date: dateISO, field, value }),
    });
    if (res.ok) {
        show("success", "Ponto atualizado.");
    } else {
        show("error", "Não foi possível salvar o ponto.");
    }
}

async function deletePunch(employeeId: string, dateISO: string): Promise<void> {
    clearMsg();
    const res = await fetch("/portal/admin/punch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, date: dateISO }),
    });
    if (res.ok) {
        show("success", "Dia excluído.");
        void loadAdminPunches(employeeId);
    } else {
        show("error", "Não foi possível excluir o dia.");
    }
}

el<HTMLSelectElement>("admin-employee").addEventListener("change", (e) => {
    void loadAdminPunches((e.currentTarget as HTMLSelectElement).value);
});
```

> `fmtDate`, `show`, `clearMsg`, `el`, and `exportData` already exist in `app.ts`. The date rows are keyed to the ISO `entry.date` returned by the endpoint, which is exactly what the punch write endpoint expects.

- [ ] **Step 4: Type-check + bundle**

Run: `cd sidecar && bunx tsc --noEmit && bun run build`
Expected: no errors; bundle succeeds.

- [ ] **Step 5: Commit**

```bash
git add sidecar/portal/index.html sidecar/portal/app.ts
git commit -m "feat: portal admin panel to view and manage all employees' punches"
```

---

## Task 12: Reap portal-deleted rows from the kiosk mirror (Rust)

**Files:**
- Modify: `src-tauri/src/db/repo/time_entries.rs` (`reap_local_absent`, `reap_deleted`)
- Modify: `src-tauri/src/db/sync.rs` (`run_sync` calls reap after pull)
- Test: `src-tauri/src/db/repo/time_entries.rs` (inline test of `reap_local_absent`)

**Interfaces:**
- Produces: `time_entries::reap_deleted(pg, lite) -> Result<usize, DbError>` and the testable core `reap_local_absent(lite, present) -> Result<usize, DbError>`.

- [ ] **Step 1: Write the failing test** in `src-tauri/src/db/repo/time_entries.rs`

```rust
#[cfg(test)]
mod reap_tests {
    use super::*;
    use crate::db::DbState;
    use chrono::{NaiveDate, Utc};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::collections::HashSet;

    async fn mem() -> DbState {
        let opts = SqliteConnectOptions::new().filename(":memory:").foreign_keys(true);
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(opts).await.unwrap();
        sqlx::migrate!("./migrations/sqlite").run(&pool).await.unwrap();
        DbState::new(pool)
    }

    #[tokio::test]
    async fn reaps_only_rows_absent_centrally() {
        let db = mem().await;
        // Need a parent employee row for the FK.
        crate::db::repo::employees::upsert_local(
            &db.lite,
            &crate::db::models::Employee {
                id: "e1".into(), name: "E".into(), email: None, phone: None,
                role: "r".into(), lunch_time: None, status: "active".into(),
                auth_user_id: None, terminated_at: None,
                created_at: Utc::now(), updated_at: Utc::now(), exclude_from_report: false,
            },
        ).await.unwrap();

        let keep = NaiveDate::from_ymd_opt(2026, 7, 3).unwrap();
        let gone = NaiveDate::from_ymd_opt(2026, 7, 4).unwrap();
        set_field(&db, "e1", keep, UpdateKey::ClockIn, Utc::now(), None).await.unwrap();
        set_field(&db, "e1", gone, UpdateKey::ClockIn, Utc::now(), None).await.unwrap();

        let mut present = HashSet::new();
        present.insert(("e1".to_string(), keep));

        let removed = reap_local_absent(&db.lite, &present).await.unwrap();
        assert_eq!(removed, 1);
        assert!(find_local(&db.lite, "e1", keep).await.unwrap().is_some());
        assert!(find_local(&db.lite, "e1", gone).await.unwrap().is_none());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test reaps_only_rows_absent_centrally`
Expected: FAIL — `reap_local_absent` not found.

- [ ] **Step 3: Implement the reap functions** in `src-tauri/src/db/repo/time_entries.rs`

```rust
/// Deletes local rows whose (employee_id, work_date) is not in `present`.
/// Safe to call only after the outbox is flushed (no local-only pending rows).
pub(crate) async fn reap_local_absent(
    lite: &SqlitePool,
    present: &std::collections::HashSet<(String, NaiveDate)>,
) -> Result<usize, DbError> {
    let local = list_local(lite).await?;
    let mut removed = 0usize;
    for e in local {
        if !present.contains(&(e.employee_id.clone(), e.work_date)) {
            sqlx::query("DELETE FROM time_entries WHERE id = ?1")
                .bind(&e.id)
                .execute(lite)
                .await?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// Removes local time entries that no longer exist in Postgres (e.g. deleted
/// from the portal). Postgres is authoritative for the row set.
pub(crate) async fn reap_deleted(pg: &PgPool, lite: &SqlitePool) -> Result<usize, DbError> {
    let rows = sqlx::query_as::<_, TimeEntry>("SELECT employee_id, work_date FROM time_entries")
        .fetch_all(pg)
        .await?;
    let present: std::collections::HashSet<(String, NaiveDate)> =
        rows.into_iter().map(|e| (e.employee_id, e.work_date)).collect();
    reap_local_absent(lite, &present).await
}
```

> `query_as::<_, TimeEntry>` with a partial `SELECT employee_id, work_date` will fail — `TimeEntry` needs all columns. Use a tuple instead:

```rust
    let rows: Vec<(String, NaiveDate)> =
        sqlx::query_as("SELECT employee_id, work_date FROM time_entries")
            .fetch_all(pg)
            .await?;
    let present: std::collections::HashSet<(String, NaiveDate)> = rows.into_iter().collect();
```

Use that tuple form in `reap_deleted`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test reaps_only_rows_absent_centrally`
Expected: PASS.

- [ ] **Step 5: Call reap in `run_sync`** (`src-tauri/src/db/sync.rs`), right after `pull_master_data(app).await?;`:

```rust
    pull_master_data(app).await?;

    // The outbox is now flushed, so any local time entry missing centrally was
    // deleted elsewhere (e.g. the portal). Remove those stale mirror rows.
    if let Some(pg) = state.pg_if_online().await {
        if let Err(e) = time_entries::reap_deleted(&pg, &state.lite).await {
            eprintln!("[sync] reap failed: {e}");
        }
    }
```

- [ ] **Step 6: Build + full Rust test run**

Run: `cd src-tauri && cargo test`
Expected: all tests pass; clean build.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/repo/time_entries.rs src-tauri/src/db/sync.rs
git commit -m "feat: reap portal-deleted time entries from the kiosk mirror on sync"
```

---

## Task 13: End-to-end manual verification

No automated harness exists for the sidecar HTTP layer or the browser portal, so verify the runtime behavior by hand.

**Files:** none (verification only).

- [ ] **Step 1: Build everything**

Run: `cd src-tauri && cargo build` then `cd sidecar && bun run build` then (repo root) `bunx tsc --noEmit`.
Expected: all clean.

- [ ] **Step 2: Launch the app**

Run: `bun run tauri:dev`
Log in as an administrator in the kiosk; ensure the sidecar is up (`[auth] pontuall-auth listening…`).

- [ ] **Step 3: External access** — in Settings → Avançado, add two trusted origins (e.g. `https://a.example.com`, `https://b.example.com`), save. Confirm no restart is required and (if you have a tunnel) portal sign-in over one of those domains succeeds. Without a tunnel, confirm the saved values reload correctly via `GetAdvancedConfig` (reopen the settings screen).

- [ ] **Step 4: Report opt-out** — open `/portal` in a browser, log in as the admin, expand "Opções de administrador", tick "Não aparecer nos relatórios". Generate an Excel report from the kiosk (Relatórios) — the admin's rows are absent. Untick, regenerate — rows return.

- [ ] **Step 5: Admin punch management** — in the portal admin panel, pick an employee, edit a clock-in time (row updates, success toast). In the kiosk, trigger a sync (or wait a cycle) and confirm the edited value appears. Delete a day in the portal; after a sync, confirm the day is gone in the kiosk too.

- [ ] **Step 6: Authorization** — sign into the portal as a non-admin (employee). Confirm no admin panel is shown, and that `curl` to `/portal/admin/employees` with that session cookie returns 403, and with no cookie returns 401.

- [ ] **Step 7: Audit** — in the kiosk (Logins/Auditoria, or via `/internal/audit/list`), confirm entries exist for `portal/admin-employees-list`, `portal/admin-punch-read`, `portal/punch-edit`, `portal/punch-delete`, `portal/report-visibility`, and that `/internal/audit/verify` still reports a valid chain.

- [ ] **Step 8: Commit** (if any doc/notes changed; otherwise skip). No code changes expected in this task.

---

## Self-Review notes

- **Spec coverage:** Feature 1 → Tasks 9-12 (+ audit, reap). Feature 2 → Tasks 5-8. Feature 3 → Tasks 1-4. Security posture → `requireAdmin` (Task 7), used by every admin route (Tasks 7, 9, 10); audit in every admin handler. Verification → Task 13.
- **Type consistency:** the entry shape `{ date, clockIn, lunchOut, lunchReturn, clockOut, totalHours }` is identical across `loadPortalExport`, `loadEmployeePunches`, and the client `AdminEntry`. `requireAdmin` returns a discriminated union used the same way in all routes. `push_public_origins(Option<&str>, &[String])` matches the `{ publicOrigin, trustedOrigins }` endpoint body.
- **Ordering caveat:** Task 1's `set_advanced_config_cmd` references `push_public_origins`, which lands in Task 3 — the plan calls this out and offers a comment-out/restore path so each task builds independently.
