# Gap Analysis e Plano de Remediação — 2026-07-06

> **Atualização 2026-07-07**: gaps #1, #2, #5 e #10 resolvidos em código (comando
> `employee_terminate` com envio dos dados ao titular, job de retenção/anonimização,
> aviso de TLS, e-mail mascarado no punch_auth_log, poda ancorada do audit log).
> Ver tabela de remediação em `STATUS.md`. Abertos: #3 (aviso de privacidade — revisão
> jurídica), #4 (criptografia do offline.db) e itens de documentação.

Escopo: produto PontuAll v0.2.0 (self-hosted). Dois planos de conformidade:
**(P)** privacy-by-design no produto (Art. 46, § 2º) e **(D)** documentação/artefatos que o
produto entrega à empresa cliente (controladora) para ela cumprir a LGPD.

## Matriz de gaps

| # | Item | Status | Evidência | Severidade |
|---|---|---|---|---|
| 1 | Eliminação/anonimização de funcionário | 🔴 RED | `employees` só tem upsert; e-mail em claro em `punch_auth_log`; sem reconciliação com dever de guarda trabalhista (Arts. 15–16, 18 VI vs CLT Art. 74) | **Crítica** |
| 2 | Retenção definida | 🔴 RED | nenhuma tabela tem TTL/purge: `punch_auth_log`, `card_events`, `session`, `verification`, `auth_audit_log` crescem para sempre (Art. 15, I; Art. 16) | **Crítica** |
| 3 | Aviso de privacidade ao funcionário | 🔴 RED | nenhum texto no app nem template para a controladora (Art. 9º; Art. 6º, VI) | **Alta** |
| 4 | Criptografia em repouso do espelho SQLite | 🔴 RED | `offline.db` em claro no `%APPDATA%` de um terminal de recepção (Art. 46) | **Alta** |
| 5 | TLS ao Postgres não exigido/alertado | 🟡 YELLOW | URI livre do cliente, sem aviso para `sslmode=disable` (Art. 46) | **Alta** |
| 6 | Fluxo DSAR documentado (Art. 18, 9 direitos; prazo 15 dias — Art. 19, II) | 🔴 RED | export `.xlsx` por funcionário cobre parte de acesso/portabilidade; sem fluxo de eliminação/revisão | **Alta** |
| 7 | ROPA (Art. 37) | 🔴 RED | inexistente; produto pode entregar pré-preenchido (o schema é fixo!) | **Alta** |
| 8 | Base legal documentada por atividade | 🔴 RED | nenhuma (Art. 7º) | **Alta** |
| 9 | Runbook de incidente (Art. 48; Res. 15/2024: 3 dias úteis, registro 5 anos) | 🔴 RED | nenhum; vazamento do banco do cliente pegaria a controladora sem plano | **Alta** |
| 10 | E-mail em claro em `punch_auth_log` | 🟡 YELLOW | migration 0002; sidecar mascara, o Rust não (Art. 6º, III) | **Média** |
| 11 | Orientação sobre operadores da controladora (SMTP, Postgres gerenciado) + transferência internacional | 🟡 YELLOW | nenhuma doc (Art. 39; Arts. 33–36; Res. 19/2024) | **Média** |
| 12 | Relatórios `.xlsx` sem orientação de manuseio | 🟡 YELLOW | arquivo em claro com dados de todos (Art. 46) | **Média** |
| 13 | Encarregado (Art. 41; Res. 18/2024) — orientar controladora; ATPP pode ter dispensa (Res. 2/2022, Art. 11) mas precisa de canal | 🟡 YELLOW | sem doc | **Média** |
| 14 | Menores: aprendizes 14–17 (Art. 14 LGPD) + avaliação ECA Digital | 🟡 YELLOW | sem avaliação registrada | **Baixa** |
| 15 | RIPD (Art. 38) | 🟢 provável N/A | pequeno porte, sem dados sensíveis/biometria, sem larga escala, sem profiling (Res. 2/2022, Art. 4º) — registrar avaliação formal | **Baixa** |
| 16 | Trilha de auditoria imutável (Art. 6º, X) | 🟢 GREEN | `auth_audit_log` hash-chained + verificação | — |
| 17 | Telemetria/tracking do desenvolvedor | 🟢 GREEN | inexistente — minimização exemplar | — |
| 18 | Segurança de sessão/segredos/cartões | 🟢 GREEN | ver discovery.md | — |
| 19 | Minimização do schema | 🟢 GREEN | só nome, e-mail?, phone?, cargo, batidas | — |

## Resumo

- **2 críticos** (retenção + eliminação — são o mesmo eixo)
- **7 altos**
- **5 médios**
- **2 baixos**
- 4 itens já GREEN — o produto tem base de segurança acima da média

## Ações imediatas (sprint atual) — Crítica/Alta + baixo esforço

1. **Definir política de retenção + anonimização de funcionário desligado** — feature no
   produto: comando "desligar funcionário" que anonimiza `employees.name/email/phone` e
   `punch_auth_log.email` após o prazo de guarda, preservando `time_entries` (dever legal,
   Art. 16, I). → skills `lgpd-retention-erasure` + `lgpd-dsar` (L5/L7)
2. **Template de aviso de privacidade para funcionários** — entregue com o instalador +
   tela "seus dados" no app. → skill `lgpd-privacy-policy` (L9) ⏸ CHECKPOINT
3. **Runbook de incidente para a controladora** — `.lgpd/incidents/runbook.md` + doc de
   produto. → skill `lgpd-incident-response` (L8)
4. **Aviso de TLS na conexão Postgres** — warning no setup quando URI sem `sslmode=require`.
   (código, pequeno)

## Próximas 2–4 semanas

5. **Data map + ROPA pré-preenchido** (o schema é fixo — dá para gerar 90% pronto para
   qualquer cliente) → `lgpd-data-mapping` (L2) + `lgpd-ropa`
6. **Base legal por atividade** → `lgpd-legal-basis` (L3)
7. **Guia de operadores da controladora** (SMTP, Postgres gerenciado, transferência
   internacional) → `lgpd-vendor-audit` (L4) + `lgpd-international-transfer`
8. **Mascarar e-mail em `punch_auth_log`** + job de purga (migration + código)

## Próximo trimestre

9. **Criptografia do espelho SQLite** (SQLCipher ou DPAPI) → `lgpd-encryption-keys`
10. **Avaliação formal RIPD = N/A** documentada → `lgpd-ripd` (L11)
11. **Avaliação menores/aprendizes + ECA Digital** → `lgpd-eca-digital-minors` (L10)
12. **Doc do Encarregado para a controladora** → `lgpd-dpo-encarregado` (L12)

## Backlog

13. Guia de manuseio dos relatórios `.xlsx` (senha/pasta restrita)
14. Programa de governança (Art. 50) — quando houver equipe
