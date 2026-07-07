# Operadores — Guia para a controladora (empresa cliente)

**Data**: 2026-07-07 · **Base**: Art. 39 (operador segue instruções do controlador) e
Art. 42 (responsabilidade solidária do controlador por danos do operador).

## Situação do PontuAll

O produto **não embute nenhum operador**: sem telemetria, sem analytics, sem cloud do
desenvolvedor (verificado no código — `discovery.md`). Os únicos operadores possíveis são os
que **você, cliente, escolhe** ao configurar:

| Operador | Quando existe | Dados que recebe | Atividade |
|---|---|---|---|
| Provedor SMTP | Se configurar e-mail (OTP/senha) | nome, e-mail, OTP/link de senha | A007 |
| Host do PostgreSQL | Se o banco for gerenciado por terceiro (RDS, Neon, Supabase...) | **todo o banco** (A001–A006) | todas |
| Destino de backups | Se fizer backup do banco em nuvem de terceiro | idem | todas |

Se o PostgreSQL roda em servidor próprio da empresa e não há SMTP configurado, **você não tem
operadores** para esta aplicação — nada a formalizar, e o cartão NFC continua funcionando.

## Tiering

| Tier | Operador | Por quê | Revisão |
|---|---|---|---|
| **Crítico** | Host do PostgreSQL / backups | Acesso ao banco inteiro (funcionários + jornada + auth) | Trimestral |
| **Alto** | Provedor SMTP | PII comum recorrente (nome, e-mail, tokens de acesso) | Semestral |

## Checklist mínimo por operador (antes de contratar)

1. **DPA disponível?** Sem DPA/termos de tratamento de dados → **não use** (Art. 39).
   Provedores grandes têm DPA padrão autoexecutável (AWS, Google, Microsoft) — verifique se a
   conta o incorpora.
2. **Onde ficam os dados?** Se fora do Brasil → transferência internacional (Arts. 33–36).
   Preencher avaliação em `.lgpd/transfers/` (ver L4b). Preferir região `sa-east-1`/Brasil
   quando o provedor oferecer — elimina a questão.
3. **Certificações**: SOC 2 / ISO 27001 são o mínimo esperado para tier Crítico.
4. **Comunicação de incidentes**: o contrato prevê aviso ao controlador em prazo que permita
   cumprir os 3 dias úteis da Res. 15/2024? (ATPP: 6 dias úteis)
5. **Subprocessadores**: lista pública e direito de objeção?
6. **TLS obrigatório** na conexão (para Postgres: `sslmode=require` na URI — o app aceita
   qualquer URI hoje, gap #5).

## Critérios eliminatórios

- Não assina/oferece DPA → **não pode ser usado**
- País sem cláusulas-padrão adotáveis e sem outra hipótese do Art. 33 → **não pode ser usado**
- Histórico recente de incidentes não comunicados → substituir
- Sem logs/auditoria de acesso → risco alto, escalonar

## Como documentar

Copie `template-vendor.md` para `{vendor-slug}.md` neste diretório e preencha ao contratar.
Exemplos pré-preenchidos: `exemplo-smtp-gmail.md`, `exemplo-postgres-local.md`.
