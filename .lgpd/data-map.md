# Mapa de Dados — PontuAll

**Versão**: v1
**Data**: 2026-07-06
**Perspectiva**: empresa cliente que instala o PontuAll (**controladora**). O desenvolvedor
não trata dados em operação normal (sem telemetria/servidor central — ver `discovery.md`).
**Owner global**: Encarregado da controladora (pendente — ver L12)

> Bases legais são indicativas até L3 (`legal-basis.md`). Retenções são **propostas
> preliminares** a confirmar em L5 (`lgpd-retention-erasure`) — hoje o produto não
> implementa nenhuma (gap #2).

## Atividades de Tratamento

### A001 — Cadastro de funcionários

| Campo | Valor |
|---|---|
| Slug | a001-cadastro-funcionarios |
| Finalidade | Administração do quadro de pessoal e operação do ponto |
| Base legal | Art. 7º, V (execução de contrato de trabalho) + Art. 7º, II (registro de empregados — CLT) — confirmar em L3 |
| Categorias de titulares | Funcionários; **pode incluir adolescentes (aprendizes 14–17)** |
| Sensíveis? | Não |
| Dados | nome, e-mail?, telefone?, cargo, horário de almoço, status, vínculo com login |
| Fonte | Coletado do titular/RH no cadastro pelo administrador |
| Sistemas | `employees` (Postgres) + espelho `offline.db` (SQLite, **sem criptografia**) |
| Operadores | Host do PostgreSQL, se gerenciado por terceiro |
| Transferência intl. | Só se o Postgres/host for no exterior — avaliar por cliente (L4) |
| Retenção | Vigência do contrato + prazo prescricional trabalhista — definir em L5. Hoje: **indefinida (gap #1/#2)** |
| Segurança | RBAC via Better Auth; segredos no Credential Manager; SQLite sem criptografia (gap #4) |
| Alto risco? | Não (Res. 2/2022, Art. 4º: sem larga escala, sem sensíveis, sem profiling) |
| RIPD | N/A (registrar avaliação em L11) |
| Owner | RH/administrador da controladora |

### A002 — Registro de ponto (batidas)

| Campo | Valor |
|---|---|
| Slug | a002-registro-ponto |
| Finalidade | Controle de jornada de trabalho e apuração de horas |
| Base legal | Art. 7º, II (obrigação legal — CLT Art. 74; Portaria MTP 671/2021) — confirmar em L3 |
| Categorias de titulares | Funcionários; pode incluir adolescentes (aprendizes) |
| Sensíveis? | Não |
| Dados | entrada, saída de almoço, retorno, saída, data, origem da batida (cartão/OTP) |
| Fonte | Observado — gerado pelo toque do cartão ou OTP do titular |
| Sistemas | `time_entries` (Postgres) + espelho SQLite + `sync_outbox` (fila offline) |
| Operadores | Host do PostgreSQL, se terceirizado |
| Transferência intl. | Idem A001 |
| Retenção | Dever legal de guarda (registros de jornada) — prazo a fixar em L5; **não elegível a eliminação a pedido enquanto vigorar o dever legal (Art. 16, I)** |
| Segurança | Correções só por admin com trilha de auditoria; RBAC |
| Alto risco? | Não |
| RIPD | N/A |
| Owner | RH/administrador |

### A003 — Autenticação e sessões

| Campo | Valor |
|---|---|
| Slug | a003-autenticacao |
| Finalidade | Identidade, login e controle de permissões (RBAC) |
| Base legal | Art. 7º, V (execução do contrato) + Art. 7º, IX (legítimo interesse — segurança) — confirmar em L3 |
| Categorias de titulares | Funcionários com login (admins, supervisores, employees) |
| Sensíveis? | Não |
| Dados | nome, e-mail, hash de senha (scrypt), **IP, user-agent**, tokens de sessão/verificação, role, ban/banReason |
| Fonte | Coletado do titular; IP/user-agent observados |
| Sistemas | `user`, `session`, `account`, `verification` (Postgres via Prisma/Better Auth sidecar) |
| Operadores | Host do PostgreSQL, se terceirizado |
| Transferência intl. | Idem A001 |
| Retenção | Sessões expiram, mas linhas não são purgadas; `verification` idem — **definir purga em L5 (gap #2)** |
| Segurança | Token nunca no webview; sidecar assinado; rate limiting; senha mín. 10 |
| Alto risco? | Não |
| RIPD | N/A |
| Owner | Administrador |

### A004 — Cartões NFC e antifraude (detecção de clonagem)

| Campo | Valor |
|---|---|
| Slug | a004-cartoes-nfc |
| Finalidade | Autenticar a batida por cartão e detectar cartões clonados |
| Base legal | Art. 7º, IX (legítimo interesse — prevenção a fraude na jornada) — exige LIA em L3 |
| Categorias de titulares | Funcionários portadores de cartão |
| Sensíveis? | **Não** — token opaco rotativo; **não há biometria** |
| Dados | UID do cartão ↔ `employee_id`, hash do token, contador, status, eventos (tap_ok, clone_detected...) |
| Fonte | Observado — leitor NFC |
| Sistemas | `cards`, `card_events` (Postgres) + espelho SQLite; token bruto só no cartão físico |
| Operadores | — |
| Transferência intl. | — |
| Retenção | `card_events` sem purga — **definir em L5 (gap #2)** |
| Segurança | Chaves MIFARE derivadas por cartão de chave mestra no Credential Manager; token hasheado (SHA-256) |
| Alto risco? | Não |
| RIPD | N/A |
| Owner | Administrador |

### A005 — Log de segurança de batidas (OTP/punch)

| Campo | Valor |
|---|---|
| Slug | a005-punch-auth-log |
| Finalidade | Prevenir abuso do fluxo OTP (rate limiting, investigação) |
| Base legal | Art. 7º, IX (legítimo interesse — segurança) — confirmar em L3 |
| Categorias de titulares | Funcionários que batem ponto por OTP |
| Sensíveis? | Não |
| Dados | **e-mail em claro (gap #10)**, employee_id, tipo de evento, sucesso, detalhes |
| Fonte | Observado |
| Sistemas | `punch_auth_log` (Postgres + SQLite) |
| Retenção | **Indefinida — gap #2**; propor prazo curto (ex.: 6–12 meses) em L5 |
| Segurança | Append-only por convenção (sem hash chain) |
| Alto risco? | Não |
| RIPD | N/A |
| Owner | Administrador |

### A006 — Trilha de auditoria de auth (accountability)

| Campo | Valor |
|---|---|
| Slug | a006-audit-log |
| Finalidade | Responsabilização e prestação de contas (Art. 6º, X); prova de integridade |
| Base legal | Art. 7º, IX (legítimo interesse) / Art. 6º, X — confirmar em L3 |
| Categorias de titulares | Atores de chamadas à API de auth (admins e funcionários) |
| Sensíveis? | Não |
| Dados | actor_id/nome, ação, recurso, **e-mail mascarado**, IP, user-agent, hash do payload (sem payload bruto) |
| Fonte | Observado |
| Sistemas | `auth_audit_log` (Postgres) — hash-chained, append-only, com verificação |
| Retenção | Indefinida; para logs de incidente, mínimo **5 anos** (Res. 15/2024, Art. 10) — fixar em L5 |
| Segurança | Hash chain SHA-256 + `verifyAuditChain()` |
| Alto risco? | Não |
| RIPD | N/A |
| Owner | Administrador |

### A007 — E-mails transacionais (OTP e definição de senha)

| Campo | Valor |
|---|---|
| Slug | a007-emails-transacionais |
| Finalidade | Entregar OTP de batida e link de definição/reset de senha |
| Base legal | Art. 7º, V (execução de contrato — necessário ao serviço) — confirmar em L3 |
| Categorias de titulares | Funcionários com e-mail cadastrado |
| Sensíveis? | Não |
| Dados | nome, e-mail, OTP/link com token temporário |
| Fonte | Cadastro (A001) |
| Sistemas | Trânsito via **SMTP configurado pela controladora** |
| Operadores | **Provedor SMTP da controladora (ex.: Gmail, SES, Mailgun) — operador; exige DPA/avaliação (gap #11, L4)** |
| Transferência intl. | **Provável** (maioria dos SMTP é no exterior) — Arts. 33–36 + Res. 19/2024 (L4) |
| Retenção | No produto: tokens expiram (link 24h); retenção no provedor SMTP fora do controle do app |
| Segurança | TLS conforme config SMTP; tokens de uso único |
| Alto risco? | Não |
| RIPD | N/A |
| Owner | Administrador |

### A008 — Relatórios de frequência (.xlsx)

| Campo | Valor |
|---|---|
| Slug | a008-relatorios-xlsx |
| Finalidade | Folha de pagamento, fiscalização trabalhista, gestão |
| Base legal | Art. 7º, II (obrigação legal) + V (contrato) — confirmar em L3 |
| Categorias de titulares | Funcionários |
| Sensíveis? | Não |
| Dados | nome + batidas/horas do período |
| Fonte | Derivado de A001+A002 |
| Sistemas | Arquivo `.xlsx` **em claro** no disco escolhido pelo admin (gap #12) |
| Operadores | Depende do destino que o admin der ao arquivo (e-mail, drive...) — orientar |
| Retenção | Fora do controle do app — orientar manuseio (backlog #13) |
| Segurança | Nenhuma no arquivo em si |
| Alto risco? | Não |
| RIPD | N/A |
| Owner | RH/administrador |

## Checklist de qualidade

- [x] Toda tabela com dados pessoais coberta (employees, time_entries, cards, card_events, punch_auth_log, user, session, account, verification, auth_audit_log, sync_outbox)
- [x] Integrações de terceiros listadas (SMTP; host Postgres; **não há SDKs de tracking**)
- [ ] Base legal explícita → pendente L3
- [x] Alto risco avaliado: **nenhuma atividade** (Res. 2/2022, Art. 4º)
- [x] Menores flagados: A001/A002 podem incluir aprendizes (14–17) → Art. 14 LGPD; avaliação ECA Digital em L10
- [ ] Retenção definida → pendente L5 (hoje tudo indefinido — gap #2)
