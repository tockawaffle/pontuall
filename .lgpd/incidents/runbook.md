# Runbook de Incidente de Segurança — PontuAll

**Versão**: v1 (preparatório) · **Data**: 2026-07-07
**Norma**: Art. 48 LGPD + Resolução CD/ANPD nº 15/2024 (RCIS)
**Quem executa**: a **controladora** (empresa que opera o PontuAll), coordenada pelo
Encarregado/responsável designado (L12).

## Prazos que não podem ser perdidos

| Ação | Prazo | Base |
|---|---|---|
| Notificar ANPD (portal https://www.gov.br/anpd) | **3 dias úteis** desde o conhecimento de que dados pessoais foram afetados | Res. 15/2024, Art. 6º |
| Notificar titulares afetados | **3 dias úteis** (mesmo gatilho) | Art. 9º |
| Empresa ATPP (micro/pequena — provável p/ usuários do PontuAll) | prazos **em dobro (6 dias úteis)**, salvo risco à integridade física/moral | Res. 2/2022 + 15/2024 |
| Complementar a comunicação inicial | até 20 dias úteis | Res. 15/2024 |
| Registrar TODO incidente (mesmo não notificado) | guardar **5 anos** em `log.md` | Art. 10 |

## Notificar ou não? (Art. 5º — teste cumulativo A **e** B)

**A.** O incidente pode acarretar risco ou dano relevante aos titulares?
**B.** Envolve alguma categoria: I sensíveis · II crianças/adolescentes/**idosos** ·
III financeiros · **IV autenticação em sistemas** · V sigilo legal · VI larga escala?

No PontuAll, a categoria **IV (dados de autenticação)** é o gatilho mais provável: hashes de
senha, tokens de sessão e tokens de cartão são dados de autenticação. Se houver **aprendizes
menores** no quadro, a categoria **II** também entra. Larga escala (VI) é improvável
(pequenas empresas).

- A **e** B → notificar ANPD + titulares.
- Só A, ou nenhum → **registrar em `log.md` mesmo assim** (obrigatório, Art. 10).
- Na dúvida sobre "risco relevante": decidir por escrito com o Encarregado; conservador = notificar.

## Cenários prováveis do PontuAll (triagem pré-pronta)

### C1 — Roubo/furto do terminal Windows
O `offline.db` fica **sem criptografia** no `%APPDATA%` (gap #4): nomes, e-mails, telefones,
batidas e hashes de tokens de cartão vazam com a máquina, mesmo sem login no app.
- Contenção: trocar credenciais do Postgres (a URI fica no Credential Manager — considerar
  comprometida se a sessão Windows for acessível), invalidar segredo Better Auth, **trocar a
  `card_master_key` e reprovisionar cartões** (chaves MIFARE derivam dela), revogar sessões.
- Teste Art. 5º: A provável sim (identidade + rotina de jornada) · B: IV (autenticação).
  **Tendência: notificável.** Se disco era BitLocker → risco cai; documentar e possivelmente
  não notificar.

### C2 — Comprometimento do PostgreSQL
Banco inteiro (A001–A006).
- Contenção: isolar o servidor, trocar credenciais, `sslmode=require`, snapshot para perícia.
- Teste Art. 5º: A sim · B: IV (hashes de senha/sessões na base Better Auth). **Notificável.**

### C3 — Vazamento de credenciais SMTP
Terceiro pode ler/enviar e-mails: nomes, e-mails, OTPs e links de senha em trânsito.
- Contenção: revogar a credencial no provedor, reconfigurar, invalidar links pendentes
  (expiração 24h ajuda), verificar logs de acesso do provedor.
- Teste Art. 5º: OTPs/links = autenticação (IV), mas expiram rápido; risco relevante depende
  do que foi acessado. Avaliar caso a caso; registrar sempre.

### C4 — Cartão clonado detectado (`card:clone_detected`)
O app **já contém** a resposta: bloqueia o cartão e alerta. Um clone de cartão isolado
normalmente **não** é incidente notificável (token opaco, sem dado pessoal no cartão além do
vínculo) — é fraude trabalhista, tratada internamente.
- Ação: investigar quem usou, reemitir cartão, registrar em `log.md` (Art. 10 vale para todos).

## Fluxo geral (T+0 → T+72h)

1. **T+0 — Detecção**: registrar **timestamp exato** do conhecimento de afetação a dados
   pessoais (marco do prazo). Acionar Encarregado.
2. **T+0–4h — Contenção**: isolar, preservar evidências (não destruir nada — inclusive o
   `auth_audit_log`, que é hash-chained e serve de prova), revogar credenciais/sessões,
   comunicação interna need-to-know.
3. **T+4–24h — Avaliação**: categorias e nº de titulares (discriminar adolescentes/idosos),
   causa raiz preliminar, aplicar teste Art. 5º, decidir por escrito.
4. **T+24–72h — Comunicação** (se notificável):
   - **ANPD — 12 itens** (Art. 6º, § 2º): natureza/categoria dos dados; nº de titulares
     (discriminando crianças/adolescentes/idosos); medidas de segurança antes/depois; riscos;
     motivo de eventual demora; mitigação; data do incidente e do conhecimento; dados do
     Encarregado; identificação do controlador (+ declaração ATPP); identificação do
     operador; descrição com causa; total de titulares nas atividades afetadas.
   - **Titulares — 7 itens** (Art. 9º), **linguagem simples**, individualizada (e-mail — o
     app tem os endereços; presencial serve e é natural numa empresa pequena): natureza dos
     dados; medidas de segurança; riscos; motivo de demora; mitigação; data do conhecimento;
     contato do Encarregado.
5. **T+72h+ — Pós-incidente**: forense, causa raiz, atualizar `log.md`, plano de remediação,
   complemento à ANPD ≤ 20 dias úteis, lições → atualizar este runbook.

## Tabletop (anual)

Simular C1 (roubo do terminal) cronometrando até a "notificação". Se passar de 3 dias úteis
(6 se ATPP), o processo está quebrado. Registrar resultado aqui.

## Prevenção pendente (refs `../gaps.md`)

- gap #4: criptografar `offline.db` (elimina o pior ramo do C1)
- gap #5: exigir/alertar TLS no Postgres (reduz C2)
- Recomendar BitLocker no terminal no manual de instalação
