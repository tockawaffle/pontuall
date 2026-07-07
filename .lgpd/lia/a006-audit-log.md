# LIA — A006 Trilha de auditoria de auth

- **Atividade**: a006-audit-log
- **Controlador**: empresa cliente (preencher razão social na adoção)
- **Data**: 2026-07-07 · **Versão**: 1 · **Próxima revisão**: 2027-07-07

## 1. Teste de Finalidade

- **Interesse legítimo**: responsabilização e prestação de contas (Art. 6º, X) — provar quem
  fez o quê no sistema de auth, inclusive correções administrativas de ponto, com garantia de
  não-adulteração (hash chain).
- **Lícito, específico e real?** Sim — correção de batida por admin sem trilha imutável
  permitiria fraude trabalhista indetectável, contra o próprio titular.
- **Quem se beneficia?** Titulares (prova de integridade das próprias batidas), controladora
  (accountability perante ANPD e Justiça do Trabalho).
- **Prejuízo sem o tratamento**: impossibilidade de demonstrar conformidade (Art. 6º, X) e de
  investigar adulteração.

## 2. Teste de Necessidade

- **Estritamente necessário?** Sim — accountability exige actor, ação, recurso, resultado e
  momento.
- **Forma menos invasiva?** Já implementada: e-mails mascarados, payload nunca armazenado
  (só hash SHA-256), sem credenciais.
- **Dados mínimos?** Sim.

## 3. Teste de Balanceamento

| Fator | Avaliação |
|---|---|
| Expectativa razoável do titular | **Alta** — auditoria de ações administrativas é esperada e protege o funcionário |
| Impacto potencial | **Leve** — metadados de ações no sistema |
| Categoria do dado | Comum, mascarado/hasheado |
| Vulnerabilidade do titular | Sem agravamento |
| Forma de coleta | Observada, documentada no código |
| Salvaguardas | Hash chain verificável, mascaramento, sem payload bruto, RBAC |

**Conclusão**: o interesse **prevalece** — é a atividade com melhor desenho de privacidade do
produto; a imutabilidade serve ao titular.

## 4. Salvaguardas adotadas

- [x] Minimização (e-mail mascarado, payload só como hash)
- [x] Pseudonimização parcial
- [x] Integridade verificável (`verifyAuditChain()`)
- [x] Acesso restrito
- [ ] Transparência ativa → aviso de privacidade (L9)
- [ ] Política de retenção formal → L5 (mínimo 5 anos p/ incidentes — Res. 15/2024, Art. 10)

## 5. RIPD necessário?

Não (Res. 2/2022, Art. 4º).

## 6. Decisão

- [x] Aprovo o uso de legítimo interesse para esta atividade

**Responsável**: pendente (Encarregado da controladora — L12) · **Data**: 2026-07-07
