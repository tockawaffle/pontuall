# DSAR — Workflow para o PontuAll (Art. 18 LGPD)

**Versão**: v1 · **Data**: 2026-07-07
**Contexto**: app desktop self-hosted; titulares = funcionários da controladora. **Não há
endpoint web público** — o "canal DSAR" é organizacional: o funcionário pede ao RH/admin
(presencialmente, por e-mail ou ao canal do Encarregado), e o admin executa no app.

**SLA**: resposta completa em **15 dias corridos** (Art. 19, II). Se a controladora for ATPP
(micro/pequena empresa — provável para o público do PontuAll), **30 dias** (Res. 2/2022,
Art. 14). Recomendação: mirar 15 mesmo assim.

## Intake e verificação de identidade

- Canais: (1) pedido direto ao RH/admin; (2) e-mail ao canal do Encarregado (L12).
- Identidade: funcionário presencial → verificação trivial. Por e-mail → responder apenas ao
  e-mail cadastrado em `employees.email`. **Não exigir documentos extras** (Art. 6º, III).
- Registrar o pedido: data, titular, direito exercido → planilha/`log` do Encarregado +
  evento no audit log (`dsar:received`, `dsar:fulfilled` / `dsar:rejected` com motivo).
  Guardar por 5 anos.

## Mapa dos 9 direitos → capacidade no produto

| # | Direito (Art. 18) | Como atender hoje | Pendência |
|---|---|---|---|
| I | Confirmação de existência | Admin consulta o funcionário no painel; resposta imediata | — |
| II | Acesso | Export `.xlsx` do funcionário (relatório individual de frequência) + leitura do cadastro | ⚠️ export não inclui cadastro completo (telefone, role, cartões) — ver Feature 4 |
| III | Correção | Edição de cadastro (upsert) + correção de batida **com trilha de auditoria imutável** | — |
| IV | Anonimização/bloqueio/eliminação de dados desnecessários | Excedentes (ex.: telefone não utilizado) podem ser apagados via edição | — |
| V | Portabilidade | `.xlsx` é estruturado e interoperável — aceitável | Feature 4 melhora (JSON completo) |
| VI | Eliminação | **Árvore de decisão em `../retention.md` §2** — vínculo ativo: negar com fundamento (Art. 16, I); desligado: anonimizar | 🔴 depende de `employee_terminate` + job (gaps #1/#2) |
| VII | Info sobre compartilhamento | Responder com base em `../data-map.md` (operadores: SMTP/host do banco) — vai ao aviso de privacidade (L9) | L9 |
| VIII | Info sobre não consentir | N/A na prática — nenhuma atividade usa consentimento (ver `../legal-basis.md`); informar isso ao titular | L9 |
| IX | Revogação de consentimento | N/A — sem tratamento baseado em consentimento. Oposição (Art. 18 §2) ao cartão NFC: oferecer OTP como alternativa | — |

**Art. 20 (decisão automatizada)**: o bloqueio automático de cartão suspeito de clonagem é
decisão automatizada de segurança; revisão humana já é possível (admin desbloqueia). Informar
no aviso de privacidade.

## Roteiro do admin (colar no manual do produto)

1. Recebeu pedido → anote a data (o prazo corre em dias corridos).
2. Identifique o direito na tabela acima e execute a ação no painel.
3. **Eliminação**: siga `../retention.md` §2 — se houver dever de guarda, a resposta é
   parcialmente negativa **com fundamento legal e prazo** (modelo abaixo).
4. Responda por escrito ao titular e guarde a resposta.

### Modelo de resposta (eliminação com retenção legal)

> Recebemos seu pedido de eliminação em {data}. Os dados de cadastro e contato foram
> {eliminados/anonimizados}. Os registros de jornada (batidas de ponto) serão mantidos de
> forma bloqueada até {data}, por obrigação legal de guarda (CLT Art. 74 e Portaria MTP
> 671/2021; LGPD Art. 16, I), e eliminados após esse prazo. Qualquer dúvida, contate o
> Encarregado: {contato}.

## Features de produto recomendadas (backlog do desenvolvedor)

- **Feature 4 — Export individual completo**: comando "exportar dados do funcionário"
  (JSON: cadastro + batidas + cartões + eventos relevantes), botão no painel admin. Cobre
  II e V de uma vez e vira diferencial de venda ("DSAR em 1 clique").
- **Features 1–3** (terminate/anonimização/purga): já especificadas em `../retention.md` §3
  — são pré-requisito do direito VI.
- **Tela "seus dados" no terminal** (baixa prioridade): funcionário vê o próprio cadastro e
  batidas após autenticar por OTP/cartão.
