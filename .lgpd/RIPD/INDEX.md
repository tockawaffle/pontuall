# RIPD — Índice e avaliação de necessidade — PontuAll

**Data**: 2026-07-07 · **Metodologia**: teste cumulativo da Res. CD/ANPD nº 2/2022, Art. 4º
(critério geral **E** critério específico), aplicado às 8 atividades do `../data-map.md`.

## Teste

**Critério geral** — pelo menos um:
- (a) *Larga escala?* **Não** — público-alvo do produto é pequena empresa; dezenas a centenas
  de titulares por instalação (threshold prático ANPD: ~2 milhões).
- (b) *Afeta significativamente interesses e direitos fundamentais?* **Não** — controle de
  jornada é tratamento trabalhista ordinário, previsto em lei, sem escoragem, ranqueamento ou
  efeito além da relação de emprego.

**Critério específico** — pelo menos um:
- (a) *Tecnologias emergentes/inovadoras?* Não — NFC MIFARE com token rotativo não é biometria
  nem IA; é autenticador físico convencional.
- (b) *Vigilância de zonas públicas?* Não.
- (c) *Decisões unicamente automatizadas/profiling?* Não — o bloqueio automático de cartão
  suspeito de clonagem é medida de segurança pontual, sem perfil comportamental, com revisão
  humana disponível (admin desbloqueia/reemite); a apuração de horas segue regra determinística
  da CLT, revisável com trilha de auditoria.
- (d) *Sensíveis ou de crianças/adolescentes/idosos?* Sensíveis: não. Adolescentes: possível
  presença incidental de aprendizes — não é tratamento *dirigido* a adolescentes; ver
  `../eca-digital.md`.

## Conclusão

**Nenhuma atividade atinge o critério geral** (e apenas marginalmente o específico, via
aprendizes incidentais). Como o teste é **cumulativo**, **RIPD não é obrigatório** para o
PontuAll na configuração atual.

Registre-se: a ANPD pode exigir RIPD a qualquer tempo (Art. 38; Art. 10, § 3º para legítimo
interesse) — os LIAs em `../lia/` e este índice são a base pronta para elaborá-lo em dias,
não semanas, se exigido.

## Gatilhos de reavaliação

Refazer este teste se o produto ganhar: biometria (ex.: migração para leitor de digital),
geolocalização, módulo multi-empresa em nuvem (escala), scoring/ranking de funcionários, ou
qualquer tratamento dirigido a menores.

## RIPDs produzidos

Nenhum (não requerido). — 0 riscos pendentes; riscos operacionais tratados em
`../gaps.md` e `../incidents/runbook.md`.
