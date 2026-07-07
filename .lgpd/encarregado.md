# Encarregado (DPO) — Art. 41 LGPD + Res. CD/ANPD nº 18/2024

**Data**: 2026-07-07

## Papel 1 — Desenvolvedor do PontuAll (tockawaffle)

O desenvolvedor **não trata dados pessoais dos titulares finais** em operação normal (sem
telemetria, sem nuvem própria — `discovery.md`). Sem atividade de tratamento, **não há
obrigação de Encarregado** para o produto em si.

Atenção a duas exceções que criariam a obrigação:

1. **Suporte técnico com acesso a banco de cliente** (ex.: cliente envia dump para debug):
   nesse momento o desenvolvedor vira **operador** — recomenda-se: nunca aceitar dumps com
   dados reais (pedir anonimização antes), ou formalizar DPA pontual.
2. **Se o projeto ganhar serviço hospedado/telemetria** no futuro → designar Encarregado e
   refazer este pipeline como controlador.

Boa prática de custo zero: publicar um **e-mail de contato para privacidade/segurança** no
README/site (também serve como canal de vulnerability disclosure).

## Papel 2 — Controladora (empresa cliente) — orientação para o manual do produto

- A maioria dos clientes-alvo é **ATPP** (micro/pequena empresa — Res. 2/2022). O Art. 11 da
  Res. 2/2022 **dispensa a designação formal** de Encarregado para ATPP, **mas exige manter
  um canal de comunicação** com titulares e ANPD.
- **Recomendação: designar mesmo assim** — custo baixo, proteção alta. Pode ser:
  - pessoa natural interna (ex.: responsável de RH — avaliar conflito de interesse:
    Res. 18/2024, Art. 2º, II; quem decide sobre os dados não deve fiscalizar a si mesmo);
  - pessoa jurídica/DPO externo (comum em pequenas empresas).
- **Formalizar** por ato escrito (ata/portaria interna) — a ANPD pode pedir o documento
  (Res. 18/2024, Art. 3º, § 2º).
- **Divulgar em destaque** no site da empresa (ou, sem site, no mural/documentos internos
  acessíveis aos funcionários): nome + e-mail, em português (Res. 18/2024, Arts. 9º e 13).
- **Atribuições mínimas** (Art. 41, § 2º): receber reclamações dos titulares e comunicações
  da ANPD, orientar funcionários, executar as demais tarefas — na prática deste produto:
  operar o workflow DSAR (`dsar/workflow.md`), o runbook de incidentes
  (`incidents/runbook.md`) e revisar os artefatos `.lgpd/` anualmente.

### Bloco pronto para preencher (controladora)

```
Encarregado pela Proteção de Dados — {Razão social}
Designado por: {ata/portaria nº}    Data: {data}
Tipo: {PF | PJ}    Nome: {…}    Responsável técnico (se PJ): {…}
Contato: {e-mail}  {telefone opcional}
Conflito de interesse avaliado em {data}: {sem conflito | mitigado por …}
Divulgação: {URL do site | mural/admissão}
```

## Pendência

- [ ] Desenvolvedor: publicar e-mail de contato de privacidade/segurança no README
- [ ] Manual do produto: incluir a orientação do Papel 2 na doc de instalação
