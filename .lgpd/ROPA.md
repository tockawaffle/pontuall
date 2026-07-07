# ROPA — Registro de Operações de Tratamento (Art. 37 LGPD)

**Sistema**: PontuAll (controle de ponto self-hosted)
**Controlador**: {razão social, CNPJ, endereço, contato} ← preencher pela empresa cliente
**Encarregado / canal de privacidade**: {nome + e-mail} (ver `encarregado.md`)
**Operadores**: {provedor SMTP, host do PostgreSQL — preencher conforme `vendors/`; se
servidor próprio e sem SMTP: "nenhum"}
**Versão**: 1.0-draft · **Data**: 2026-07-07 · **Revisão**: semestral
**Formato**: modelo simplificado ANPD para ATPP (8 campos), pré-preenchido a partir do
código-fonte do sistema — as colunas de dados/finalidades/segurança são fixas do produto;
o cliente só preenche identificação, operadores e confirma prazos.

> Art. 37 destaca o registro de operações baseadas em **legítimo interesse** — aqui: A004,
> A005, A006 (LIAs em `lia/`).

## Operações como CONTROLADOR

| # | Operação / Finalidade | Hipótese legal | Titulares | Categorias de dados | Compartilhamento | Segurança | Retenção | Obs. |
|---|---|---|---|---|---|---|---|---|
| A001 | Cadastro de funcionários p/ administração de pessoal e operação do ponto | Art. 7º, V + II | Funcionários (pode incluir aprendizes 14–17) | nome, e-mail, telefone, cargo, horário de almoço | host do BD {se terceirizado} | RBAC, segredos no SO, trilha de auditoria | vínculo + 5 anos (anonimização) | delete inexistente no produto até feature 1 (`retention.md` §3) |
| A002 | Registro de batidas p/ controle de jornada (CLT Art. 74) | Art. 7º, II (+V) | idem | batidas, data, origem | idem + fiscalização/Justiça quando exigido | correção só por admin, auditada e imutável | vínculo + 5 anos (bloqueio → eliminação) | dever legal de guarda prevalece sobre eliminação (Art. 16, I) |
| A003 | Autenticação e sessões (acesso ao sistema) | Art. 7º, V | Funcionários com login | e-mail, hash de senha, IP, user-agent, tokens | host do BD | token fora do webview, rate limiting, senha ≥10 | sessões: expiração+30d; verificação: +7d | |
| A004 | **[LI]** Cartão NFC + detecção de clonagem | Art. 7º, IX — LIA `lia/a004` | Portadores de cartão | UID↔funcionário, hash de token, eventos | — | chaves derivadas por cartão, token hasheado | eventos: 12 meses | alternativa OTP p/ quem se opuser |
| A005 | **[LI]** Log de segurança do fluxo OTP | Art. 7º, IX — LIA `lia/a005` (condicionado) | Usuários de OTP | e-mail*, id, evento | — | RBAC | 6 meses | *mascarar (gap #10) |
| A006 | **[LI]** Trilha de auditoria de auth (Art. 6º, X) | Art. 7º, IX (+II p/ incidentes) | Atores do sistema | ator, ação, e-mail mascarado, IP, hashes | — | hash chain verificável, payload nunca armazenado | 5 anos (Res. 15/2024 Art. 10) | |
| A007 | E-mails transacionais (OTP, link de senha) | Art. 7º, V | Funcionários c/ e-mail | nome, e-mail, token temporário | **provedor SMTP {nome}** — DPA: {link}; transferência intl.: {ver `transfers/`} | tokens de uso único c/ expiração | tokens: minutos/24h | |
| A008 | Relatórios de frequência (.xlsx) p/ folha e fiscalização | Art. 7º, II + V | Funcionários | nome + batidas do período | destino dado pelo admin | — (arquivo em claro: manusear conforme manual) | ciclo de folha da empresa | |

## Operações como OPERADOR

Nenhuma — a empresa não trata dados por conta de terceiros neste sistema.

## Observações gerais

- Sem dados sensíveis (Art. 5º, II); sem biometria; sem decisão automatizada com efeito
  jurídico não revisável; sem larga escala → RIPD não obrigatório (`RIPD/INDEX.md`).
- Consentimento não é hipótese de nenhuma operação (relação de emprego — ver `legal-basis.md`).
- Versão pública (para titulares/due diligence): este arquivo já é publicável — não contém
  segredo comercial.

## Changelog

- v1.0-draft (2026-07-07): geração inicial a partir do inventário de código.
  ⏸ Pendente: revisão do Encarregado/jurídico da controladora para virar v1.0 final.
