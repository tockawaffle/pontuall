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

> **Atualização 2026-07-07**: o produto ganhou **autoatendimento** — o portal web
> `/portal` (servido pelo sidecar, login do próprio funcionário) cobre I, II e V sem
> intervenção do admin, e o desligamento (`employee_terminate`) envia automaticamente a
> cópia dos dados por e-mail. O quadro abaixo reflete isso.

| # | Direito (Art. 18) | Como atender hoje | Pendência |
|---|---|---|---|
| I | Confirmação de existência | **Self-service**: portal `/portal` (funcionário logado vê os próprios dados); ou admin consulta no painel | — |
| II | Acesso | **Self-service**: portal mostra cadastro + todas as batidas; no desligamento a cópia vai por e-mail automaticamente | — |
| III | Correção | Edição de cadastro (upsert) + correção de batida **com trilha de auditoria imutável** | — |
| IV | Anonimização/bloqueio/eliminação de dados desnecessários | Excedentes (ex.: telefone não utilizado) podem ser apagados via edição | — |
| V | Portabilidade | **Self-service**: botão "Baixar meus dados (JSON)" no portal (ISO 8601, estruturado); `.xlsx` continua disponível ao admin | — |
| VI | Eliminação | **Árvore de decisão em `../retention.md` §2** — vínculo ativo: negar com fundamento (Art. 16, I); desligado: `employee_terminate` + anonimização automática após o prazo | — |
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

## Features de produto (estado)

- ✅ **Feature 4 — implementada como portal web** (`/portal` no sidecar, 2026-07-07):
  optou-se por autoatendimento fora do quiosque — o funcionário loga com a própria conta,
  vê cadastro + batidas, baixa JSON e troca a senha. Requisito: conta de acesso criada e
  admin divulgar a URL (ela vai no e-mail de definição de senha). Funcionários só-NFC sem
  e-mail continuam pelo fluxo manual do admin.
- ✅ **Features 1–3** (terminate/anonimização/purga): implementadas 2026-07-07
  (`../retention.md` §3).
- Descartada: tela "seus dados" no terminal — o portal substitui sem ocupar o quiosque.
