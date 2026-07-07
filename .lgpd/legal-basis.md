# Bases Legais por Atividade de Tratamento — PontuAll

**Última atualização**: 2026-07-07
**Perspectiva**: controladora = empresa cliente que instala o PontuAll.
**Nota**: nenhuma atividade trata dado sensível (Art. 5º, II) — não há biometria: o cartão NFC
carrega token opaco, não característica física do titular. Portanto todas as bases saem do
Art. 7º; nenhuma exige Art. 11.

**Consentimento não é a base de nada aqui** — e isso é deliberado: na relação de emprego há
desequilíbrio de poder, então consentimento raramente é "livre". As bases corretas são
obrigação legal, execução de contrato e legítimo interesse com LIA.

---

## A001 — Cadastro de funcionários

- **Finalidade**: administrar o quadro de pessoal e operar o controle de ponto
- **Dados tratados**: nome, e-mail?, telefone?, cargo, horário de almoço, status
- **Sensíveis?**: Não
- **Base legal**: **Art. 7º, V** (execução de contrato de trabalho do qual o titular é parte),
  em concurso com **Art. 7º, II** (obrigação legal — registro de empregados, CLT Art. 41)
- **Justificativa**: o cadastro é indispensável à execução do contrato de trabalho e exigido
  pela legislação trabalhista. Consentimento seria base errada (não livre na relação de emprego).
- **Atenção — aprendizes (14–17)**: dados de adolescentes exigem tratamento no melhor
  interesse (Art. 14, caput). Não exige consentimento parental para execução do contrato de
  aprendizagem, mas exige transparência reforçada.
- **Retenção**: vigência do contrato + prazo prescricional (definir em L5)
- **Revogação possível?**: Não (não é consentimento); titular pode exercer Art. 18 dentro dos limites do dever legal de guarda
- **Última revisão**: 2026-07-07

## A002 — Registro de ponto

- **Finalidade**: controle de jornada e apuração de horas trabalhadas
- **Dados tratados**: batidas (entrada/almoço/retorno/saída), data, origem da batida
- **Sensíveis?**: Não
- **Base legal**: **Art. 7º, II** (obrigação legal — CLT Art. 74, § 2º: registro obrigatório
  para estabelecimentos com mais de 20 empregados; Portaria MTP 671/2021). Para empresas ≤ 20
  empregados que optam pelo controle: **Art. 7º, V** (execução de contrato)
- **Justificativa**: registro de jornada é dever legal do empregador; onde não for obrigatório,
  é necessário à execução e comprovação do contrato de trabalho
- **Retenção**: dever legal de guarda — eliminação a pedido é **negável** com fundamento no
  Art. 16, I enquanto durar o prazo (definir em L5)
- **Revogação possível?**: Não
- **Última revisão**: 2026-07-07

## A003 — Autenticação e sessões

- **Finalidade**: identidade, login e controle de permissões
- **Dados tratados**: nome, e-mail, hash de senha, IP, user-agent, tokens, role
- **Sensíveis?**: Não
- **Base legal**: **Art. 7º, V** (execução de contrato — acesso ao sistema é parte da relação
  de trabalho). IP/user-agent nas sessões: acessório necessário à segurança da autenticação
- **Justificativa**: sem autenticação não há acesso seguro ao sistema que operacionaliza o
  contrato. Alternativa (legítimo interesse) daria menos previsibilidade
- **Retenção**: sessões/verificações expiradas devem ser purgadas (L5)
- **Revogação possível?**: Não
- **Última revisão**: 2026-07-07

## A004 — Cartões NFC e antifraude

- **Finalidade**: autenticar batidas por cartão e detectar clonagem
- **Dados tratados**: UID do cartão ↔ funcionário, hash de token, eventos de cartão
- **Sensíveis?**: Não (token opaco; sem biometria)
- **Base legal**: **Art. 7º, IX** (legítimo interesse — integridade do registro de jornada e
  prevenção a fraude)
- **Justificativa**: o interesse (registro fidedigno de jornada, antifraude) apoia a atividade
  da controladora e protege também os demais funcionários; dados mínimos e pseudonimizados
- **LIA**: [`lia/a004-cartoes-nfc.md`](./lia/a004-cartoes-nfc.md) ✅ aprovado
- **Retenção**: `card_events` — propor 12 meses (L5)
- **Revogação possível?**: Titular pode se opor (Art. 18, § 2º); alternativa disponível: OTP por e-mail
- **Última revisão**: 2026-07-07

## A005 — Log de segurança de batidas (OTP)

- **Finalidade**: prevenir abuso do fluxo OTP e investigar tentativas suspeitas
- **Dados tratados**: e-mail (hoje em claro — gap #10), employee_id, evento, sucesso
- **Sensíveis?**: Não
- **Base legal**: **Art. 7º, IX** (legítimo interesse — segurança do sistema)
- **Justificativa**: rate limiting e investigação exigem correlacionar tentativas por
  identificador; sem isso o fluxo OTP fica vulnerável a força bruta
- **LIA**: [`lia/a005-punch-auth-log.md`](./lia/a005-punch-auth-log.md) ✅ aprovado **com
  condição**: mascarar/hashear o e-mail (gap #10) e fixar retenção curta
- **Retenção**: propor 6–12 meses (L5)
- **Revogação possível?**: Oposição possível em tese; na prática atende-se via minimização + retenção curta
- **Última revisão**: 2026-07-07

## A006 — Trilha de auditoria de auth

- **Finalidade**: responsabilização e prestação de contas (Art. 6º, X); prova de integridade
  de ações administrativas (quem corrigiu qual batida)
- **Dados tratados**: actor_id/nome, ação, recurso, e-mail mascarado, IP, user-agent, hashes
- **Sensíveis?**: Não
- **Base legal**: **Art. 7º, IX** (legítimo interesse — accountability), reforçada pelo dever
  do Art. 6º, X. Para registros de incidente: **Art. 7º, II** (Res. 15/2024, Art. 10 — guarda
  de 5 anos)
- **Justificativa**: trilha imutável é a salvaguarda que viabiliza correção de ponto por admin
  sem risco de adulteração — protege o próprio titular
- **LIA**: [`lia/a006-audit-log.md`](./lia/a006-audit-log.md) ✅ aprovado
- **Retenção**: mínimo 5 anos p/ eventos ligados a incidentes (Res. 15/2024 Art. 10); demais definir em L5
- **Revogação possível?**: Não (a integridade da cadeia é a finalidade); dados já minimizados/mascarados
- **Última revisão**: 2026-07-07

## A007 — E-mails transacionais

- **Finalidade**: entregar OTP de batida e link de definição/reset de senha
- **Dados tratados**: nome, e-mail, token temporário
- **Sensíveis?**: Não
- **Base legal**: **Art. 7º, V** (execução de contrato — o envio é solicitado pelo titular ou
  necessário ao seu acesso)
- **Justificativa**: sem o e-mail o funcionário sem cartão não bate ponto nem define senha.
  Não é marketing — nenhum consentimento exigido
- **Compartilhamento**: provedor SMTP = operador da controladora → DPA + avaliação de
  transferência internacional (L4)
- **Retenção**: tokens expiram (24h/uso único); retenção no provedor fora do escopo do app
- **Revogação possível?**: N/A
- **Última revisão**: 2026-07-07

## A008 — Relatórios de frequência (.xlsx)

- **Finalidade**: folha de pagamento, fiscalização trabalhista, gestão de jornada
- **Dados tratados**: nome + batidas/horas do período
- **Sensíveis?**: Não
- **Base legal**: **Art. 7º, II** (obrigação legal — exibição à fiscalização/Justiça do
  Trabalho) + **Art. 7º, V** (folha de pagamento como execução do contrato)
- **Justificativa**: derivado direto de A002 com as mesmas finalidades legais
- **Retenção**: arquivo sai do controle do app — orientação de manuseio (backlog #13)
- **Revogação possível?**: Não
- **Última revisão**: 2026-07-07

---

## Resumo

| Base | Atividades |
|---|---|
| Art. 7º, II (obrigação legal) | A002, A008 (+ apoio em A001, A006) |
| Art. 7º, V (execução de contrato) | A001, A003, A007 (+ apoio em A002, A008) |
| Art. 7º, IX (legítimo interesse, com LIA) | A004, A005, A006 |
| Art. 7º, I (consentimento) | **nenhuma** (deliberado — relação de emprego) |
| Art. 11 (sensíveis) | **nenhuma** |
