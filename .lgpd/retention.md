# Política de Retenção e Eliminação — PontuAll

**Versão**: v1 (proposta) · **Data**: 2026-07-07 · **Base**: Arts. 15–16, 18 VI, Art. 12 LGPD
**Hierarquia aplicada**: retenção legal obrigatória > retenção contratual > vontade do titular.

> Os prazos trabalhistas abaixo são os praticados de forma conservadora no mercado; a
> controladora deve **validar com advogado trabalhista** antes de adotar (esta auditoria não
> é aconselhamento jurídico).

## Tabela de retenção (regra por entidade)

| Entidade | Prazo | Gatilho | Fonte/critério | Ação pós-prazo |
|---|---|---|---|---|
| `employees` (identidade: nome, e-mail, telefone) | vínculo + **5 anos** após desligamento | `status=terminated` + data | CLT Art. 11 (créditos: 5 anos, até 2 após extinção do contrato) — janela conservadora | **ANONYMIZE** (ver §3) |
| `time_entries` (jornada) | vínculo + **5 anos** após desligamento | idem | CLT Art. 74 + Portaria MTP 671/2021; prova em reclamatória | **BLOCK_AND_RETAIN** durante o prazo (uso só para defesa/fiscalização), depois **HARD_DELETE** ou manter agregado anônimo |
| `cards` | imediato no desligamento ou substituição | devolução/bloqueio do cartão | necessidade (Art. 6º, III) | **HARD_DELETE** (já existe `cards::delete`) |
| `card_events` | **12 meses** | rolling | LIA A004 — investigação de fraude tem valor decrescente | **HARD_DELETE** |
| `punch_auth_log` | **6 meses** | rolling | analogia Marco Civil Art. 15 (logs de acesso a aplicação); LIA A005 | **HARD_DELETE** (e mascarar e-mail já na escrita — gap #10) |
| `session` (Better Auth) | expiração + **30 dias** | `expiresAt` | necessidade; margem para investigação de sessão | **HARD_DELETE** |
| `verification` | expiração + **7 dias** | `expiresAt` | tokens mortos não têm finalidade | **HARD_DELETE** |
| `user`/`account` (Better Auth) | no desligamento | remoção do login | login sem vínculo ativo não tem finalidade | **HARD_DELETE** via `auth_admin_remove_user` (já existe) |
| `auth_audit_log` | **5 anos** | rolling | Res. 15/2024, Art. 10 (registro de incidentes) + accountability | **HARD_DELETE** com checkpoint de cadeia (§4) |
| `sync_outbox` | após confirmação de sync | flush | operacional | **HARD_DELETE** (já ocorre) |
| Relatórios `.xlsx` | fora do app | — | orientar no manual (backlog #13) | responsabilidade da controladora |

## 1. Por que anonimizar (e não deletar) o funcionário

`time_entries` precisa sobreviver 5 anos (dever de guarda) e referencia `employees.id`
(FK ON DELETE CASCADE — hard delete do funcionário **destruiria os registros de jornada que a
lei manda guardar**). A saída correta (Art. 12): anonimização irreversível da identidade,
mantendo a linha:

- `name` → `"Ex-funcionário {6 primeiros chars do id}"`
- `email` → `NULL` · `phone` → `NULL` · `auth_user_id` → `NULL`
- `punch_auth_log.email` das linhas do titular → `NULL` (ou já mascarado na escrita)
- Better Auth `user` → removido via admin API (revoga sessões em cascata)

Após isso, `time_entries` deixa de apontar para pessoa identificável fora da folha de
pagamento arquivada da controladora — atende Art. 18, VI dentro do limite do Art. 16, I.

## 2. Resposta a pedido de eliminação (Art. 18, VI) — decisão

```
Pedido de eliminação do titular
├── Vínculo ativo → NEGAR eliminação de cadastro/jornada (Art. 16, I — dever legal
│   e execução do contrato); eliminar o que for excedente (ex.: telefone se não usado)
├── Desligado, dentro do prazo de guarda → anonimizar identidade (§1) SE a folha/arquivo
│   físico da controladora bastar como prova; senão BLOCK_AND_RETAIN e informar prazo
└── Desligado, prazo vencido → anonimização/eliminação completa
Sempre: registrar no audit log + responder em 15 dias (Art. 19, II; ATPP: 30 — Res. 2/2022 Art. 14)
```

## 3. Especificação de implementação (produto)

**Feature 1 — Desligar funcionário** (não existe hoje; gap #1):
comando Tauri `employee_terminate` que: marca `status='terminated'` + `terminated_at`
(nova coluna, migration 0004), bloqueia/apaga cartões do funcionário, chama
`auth_admin_remove_user` se houver login. Auditado.

**Feature 2 — Job de retenção** (gap #2): no boot + a cada 24h (o terminal fica ligado):

```sql
DELETE FROM punch_auth_log WHERE created_at < now() - interval '6 months';
DELETE FROM card_events    WHERE created_at < now() - interval '12 months';
DELETE FROM session        WHERE "expiresAt" < now() - interval '30 days';
DELETE FROM verification   WHERE "expiresAt" < now() - interval '7 days';
-- anonimização de desligados com prazo vencido:
UPDATE employees SET name = 'Ex-funcionário ' || left(id, 6), email = NULL, phone = NULL,
       auth_user_id = NULL, updated_at = now()
WHERE status = 'terminated' AND terminated_at < now() - interval '5 years'
  AND email IS NOT NULL;
```

Executar em **ambos** os bancos (Postgres e espelho SQLite) ou deixar o sync propagar; cada
execução gera evento no audit log (`retention:purge`, contagens por tabela).

**Feature 3 — checkpoint do hash chain**: para podar `auth_audit_log` > 5 anos sem quebrar a
verificação, gravar uma linha-âncora (`action='chain:checkpoint'`) cujo `prev_hash` é o
`self_hash` da última linha podada; `verifyAuditChain()` passa a aceitar início em âncora.

**Config**: prazos ficam em tabela `retention_rules` (ou constantes documentadas) com os
defaults acima; a controladora pode aumentar, nunca zerar.

## 4. Backups e espelho

- `offline.db` (SQLite): purga na mesma rotina; arquivo hoje sem criptografia (gap #4) —
  a anonimização reduz o dano, não substitui a criptografia.
- Backups do Postgres: documentar que expiram em ciclo ≤ o prazo da tabela mais longa e que
  restauração reaplica o job de retenção antes de voltar ao ar.

## Status

- Regras definidas: 11 entidades, zero "indefinido" restante **na política**.
- Implementação no produto: pendente (features 1–3) — refs gaps #1, #2, #10.
