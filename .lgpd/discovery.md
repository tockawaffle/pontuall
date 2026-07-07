# Discovery — Inventário técnico (L1, Fase 1)

**Data**: 2026-07-06 · **Fonte**: código-fonte (reverse-engineered)

## Contexto de papéis

PontuAll é **software self-hosted distribuído** (instalador Windows). Não há servidor do
desenvolvedor, telemetria, updater ou analytics (verificado: `tauri.conf.json`, `Cargo.toml` —
apenas plugins shell/dialog/single-instance; nenhum SDK de tracking no frontend).

- **Controladora** (Art. 5º, VI): a empresa cliente que instala o app.
- **Titulares**: funcionários da empresa cliente.
- **Desenvolvedor**: fornecedor de software; não trata dados dos titulares em operação normal.
- **Operadores da controladora**: o provedor SMTP que ela configurar; o host do PostgreSQL
  se for gerenciado por terceiro (ex.: RDS, Neon).

## Onde vivem dados pessoais

| Local | O quê | Evidência |
|---|---|---|
| PostgreSQL `pontuall_{empresa}` | tudo abaixo | `src-tauri/migrations/postgres/` |
| SQLite `%APPDATA%/PontuAll/offline.db` | espelho local **sem criptografia** | `src-tauri/src/db/` (sem sqlcipher) |
| Gerenciador de Credenciais Windows | URI do Postgres, segredo auth, chave mestra dos cartões | README, serviço `PontuAll` |
| Arquivos `.xlsx` exportados | relatórios de frequência (nome + batidas) | `src-tauri/src/excel/` |
| E-mails enviados via SMTP do cliente | nome, e-mail, OTP, link de senha | `sidecar/src/mail.ts` |

## Tabelas com dados pessoais

### `employees` (Postgres + espelho SQLite)
`name`, `email` (opcional, único), `phone` (opcional), `role` (cargo), `lunch_time`, `status`,
`auth_user_id`. **Não existe operação de delete** — apenas upsert (`db/repo/employees.rs`).

### `time_entries`
Batidas por dia (`clock_in`, `lunch_out`, `lunch_return`, `clock_out`) + `punch_sources`
(card/manual_otp). Delete apenas por dia (correção administrativa). Dados de jornada = dados
trabalhistas com dever legal de guarda (CLT Art. 74; Portaria MTP 671/2021).

### `cards` / `card_events`
UID do cartão NFC vinculado a `employee_id`, hash SHA-256 do token (token bruto só no cartão),
eventos (provisioned, tap_ok, clone_detected...). Sem retenção definida para `card_events`.

### `punch_auth_log` (migration 0002)
Log de tentativas de OTP/punch com **e-mail em claro** e `employee_id`. Append-only, sem
retenção definida. Contraste: o audit log do sidecar mascara e-mails.

### Sidecar Better Auth (Prisma → mesmo Postgres)
- `user`: nome, e-mail, `image?`, role, ban/banReason
- `session`: token, **ipAddress**, **userAgent**
- `account`: hash de senha (scrypt via Better Auth)
- `verification`: tokens de verificação/reset
- `auth_audit_log`: trilha **hash-chained append-only** com e-mails mascarados, sem payload
  bruto — código cita explicitamente LGPD Art. 6º, X (`sidecar/src/audit.ts`)

## Controles de segurança existentes (Art. 46)

| Controle | Status |
|---|---|
| Trilha de auditoria imutável (hash chain + verificação) | ✅ `auth_audit_log` |
| Sessão nunca exposta ao webview (anti-XSS) | ✅ `AuthState` em memória no Rust |
| Verificação Authenticode do sidecar antes do spawn | ✅ `auth/signature.rs` |
| Segredos no Windows Credential Manager | ✅ |
| Rate limiting em endpoints de credencial | ✅ `sidecar/src/auth.ts` |
| Senha mínima 10 chars, reset revoga sessões | ✅ |
| Tokens de cartão: opacos, rotativos, hash no banco | ✅ `card/` |
| Detecção de clonagem de cartão | ✅ (detecção, não prevenção — MIFARE Classic) |
| Criptografia em repouso do espelho SQLite | ❌ inexistente |
| TLS obrigatório/alertado na conexão Postgres | ❌ depende da URI do cliente, sem aviso |
| Criptografia em repouso do Postgres | ⚠️ responsabilidade do cliente, sem orientação |

## Transparência e direitos do titular

- **Política/aviso de privacidade**: inexistente (nem template para a controladora).
- **DSAR (Art. 18)**: sem fluxo. Export `.xlsx` por funcionário cobre parcialmente
  acesso/portabilidade, mas não há eliminação/anonimização de funcionário.
- **Encarregado**: não aplicável ao desenvolvedor (não trata dados); a controladora cliente
  precisa do seu — produto não orienta.

## Transferência internacional / operadores

Nenhuma feita pelo produto. Potencial da controladora: SMTP (ex.: Gmail/SES = EUA) e Postgres
gerenciado. Produto deve orientar (Arts. 33–36; Res. 19/2024).

## Menores

Produto de ambiente de trabalho. Possibilidade real: **aprendizes (14–17 anos)** como
funcionários → Art. 14 LGPD (melhor interesse) recai sobre a controladora. ECA Digital
(Lei 15.211/2025) improvável de aplicar: não é produto direcionado a menores nem de acesso
provável por menores como plataforma digital — registrar avaliação formal em L10.
