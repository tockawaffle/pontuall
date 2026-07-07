# LGPD Audit Status

**Projeto**: PontuAll — relógio de ponto NFC self-hosted (Tauri + Next.js + Better Auth sidecar + PostgreSQL)
**Cenário**: B — Legacy retrofit
**Início**: 2026-07-06 · **Concluído (fase documental)**: 2026-07-07
**Encarregado**: N/A para o desenvolvedor; orientação à controladora em `encarregado.md`

## Nota de papéis (vale para todos os artefatos)

O PontuAll é **produto self-hosted sem telemetria**: quem trata os dados (funcionários =
titulares) é a **empresa cliente que instala o app** (controladora). O desenvolvedor não é
controlador nem operador em operação normal. A conformidade tem dois planos:
**(P)** privacy-by-design no produto (Art. 46, § 2º) e **(D)** artefatos que o produto entrega
à controladora.

## Pipeline B — concluído

- [x] L0 — Setup `.lgpd/`
- [x] L1 — Gap analysis (aprovado em checkpoint) → `gaps.md`
- [x] L2 — Data mapping → `data-map.md` (8 atividades; 0 sensíveis; 0 alto risco)
- [x] L3 — Base legal → `legal-basis.md` + 3 LIAs (`lia/`); zero consentimento (deliberado)
- [x] L4 — Vendors → `vendors/` (guia + templates) + `transfers/` (Res. 19/2024)
- [x] L5 — Retenção/eliminação → `retention.md` (11 entidades; 3 features de produto especificadas)
- [x] L6 — Anonimização → absorvido em L5 (sem pipeline de analytics no produto)
- [x] L7 — DSAR → `dsar/workflow.md` (9 direitos mapeados; prazo 15d/30d ATPP)
- [x] L8 — Incidentes → `incidents/runbook.md` (4 cenários triados) + `incidents/log.md`
- [x] L9 — Aviso de privacidade → `policies/privacy-policy-v1-draft.md` ⏸ **revisão jurídica pendente**
- [x] L10 — ECA Digital → `eca-digital.md` (**não aplicável**; ressalva Art. 14 p/ aprendizes)
- [x] L11 — RIPD → `RIPD/INDEX.md` (**não obrigatório** — Res. 2/2022 Art. 4º não atingido)
- [x] L12 — Encarregado → `encarregado.md` (desenvolvedor: N/A; controladora: orientação ATPP)
- [x] L13 — Relatório final (este arquivo) + ROPA pré-preenchido → `ROPA.md` (draft)

## Relatório final — o que a auditoria concluiu

### Pontos fortes (manter)
1. Trilha de auditoria hash-chained com minimização (Art. 6º, X) — `sidecar/src/audit.ts`
2. Zero telemetria/vendors próprios — minimização exemplar
3. Arquitetura de sessão/segredos/cartões acima da média (Art. 46)
4. Schema enxuto (Art. 6º, III)

### O que falta — REMEDIAÇÃO PRIORIZADA

**Código (produto) — ordem de prioridade:**
| # | Item | Ref | Esforço |
|---|---|---|---|
| 1 | Feature "desligar funcionário" (`terminated_at` + bloqueio de cartões + remoção de login) | `retention.md` §3 F1; gap #1 | médio |
| 2 | Job diário de retenção/purga + anonimização de desligados | `retention.md` §3 F2; gap #2 | médio |
| 3 | Mascarar e-mail em `punch_auth_log` (condição do LIA A005) | gap #10 | baixo |
| 4 | Aviso quando URI Postgres sem TLS | gap #5 | baixo |
| 5 | Checkpoint do hash chain p/ poda do audit log | `retention.md` §3 F3 | baixo |
| 6 | Export individual completo (JSON) — "DSAR em 1 clique" | `dsar/workflow.md` F4 | médio |
| 7 | Criptografia do `offline.db` (SQLCipher/DPAPI) ou doc BitLocker obrigatório | gap #4 | alto |

**Documentação (entregar com o produto):**
| # | Item | Estado |
|---|---|---|
| 8 | Aviso de privacidade (template) | draft pronto — **revisão jurídica** |
| 9 | ROPA pré-preenchido | draft pronto — revisão |
| 10 | Kit da controladora no manual: encarregado, DSAR, runbook, vendors | conteúdo pronto em `.lgpd/` — falta empacotar na doc do produto |
| 11 | E-mail de contato privacidade/segurança no README | pendente |

### Dívidas que NÃO existem (avaliadas e descartadas com registro)
- RIPD (não obrigatório) · ECA Digital (não aplicável) · Consent ledger (nenhuma atividade
  usa consentimento) · Cláusulas-padrão do desenvolvedor (não transfere dados)

## Artefatos

`discovery.md` · `gaps.md` · `data-map.md` · `legal-basis.md` · `lia/` (3) · `retention.md` ·
`dsar/workflow.md` · `incidents/runbook.md` + `log.md` · `policies/privacy-policy-v1-draft.md` ·
`eca-digital.md` · `RIPD/INDEX.md` · `encarregado.md` · `ROPA.md` · `vendors/` (4) · `transfers/`

## Próximos passos

1. Revisão jurídica do aviso de privacidade e do ROPA (⏸ únicos itens travados em humano)
2. Implementar itens 1–5 de código (fecham os gaps críticos)
3. Revisão anual deste diretório ou a cada feature que toque dado pessoal
