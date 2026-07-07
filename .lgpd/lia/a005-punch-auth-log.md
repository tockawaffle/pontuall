# LIA — A005 Log de segurança de batidas (OTP)

- **Atividade**: a005-punch-auth-log
- **Controlador**: empresa cliente (preencher razão social na adoção)
- **Data**: 2026-07-07 · **Versão**: 1 · **Próxima revisão**: 2027-07-07

## 1. Teste de Finalidade

- **Interesse legítimo**: impedir abuso do fluxo de OTP (força bruta, enumeração de e-mails,
  batidas fraudulentas) e permitir investigação de tentativas suspeitas.
- **Lícito, específico e real?** Sim — o OTP é o fallback sem cartão; sem rate limiting por
  identificador o fluxo é atacável trivialmente.
- **Quem se beneficia?** Controladora e titulares (ninguém solicita OTP em nome de outro).
- **Prejuízo sem o tratamento**: OTP vira vetor de fraude de ponto e de spam de e-mail.

## 2. Teste de Necessidade

- **Estritamente necessário?** O registro do evento e de um identificador do alvo, sim
  (`ensure_can_request_otp`/`ensure_can_verify_otp` dependem dele).
- **Forma menos invasiva?** **Sim, existe**: e-mail mascarado ou hasheado cumpre a mesma
  função de correlação. → condição de aprovação (gap #10).
- **Dados mínimos?** Quase — o e-mail em claro excede o necessário.

## 3. Teste de Balanceamento

| Fator | Avaliação |
|---|---|
| Expectativa razoável do titular | **Média-alta** — logs de segurança em sistemas corporativos são prática esperada |
| Impacto potencial | **Leve** — dados de tentativa de autenticação, sem conteúdo |
| Categoria do dado | Comum (e-mail corporativo, ids) |
| Vulnerabilidade do titular | Possíveis aprendizes — sem agravamento |
| Forma de coleta | Observada |
| Salvaguardas | RBAC; append-only; retenção **hoje indefinida** (corrigir) |

**Conclusão**: o interesse **prevalece**, condicionado a: (1) mascarar/hashear o e-mail;
(2) retenção máxima de 6–12 meses (L5). Sem essas correções, a necessidade (Art. 10, II)
fica frágil.

## 4. Salvaguardas adotadas

- [x] Acesso restrito (RBAC)
- [ ] Minimização — **pendente: mascarar e-mail (gap #10)**
- [ ] Limitação de retenção — **pendente L5 (gap #2)**
- [ ] Transparência ativa → aviso de privacidade (L9)

## 5. RIPD necessário?

Não (Res. 2/2022, Art. 4º — nenhum critério específico atingido).

## 6. Decisão

- [x] Aprovo **com condições** (mascaramento + retenção curta; prazo: próxima release)

**Responsável**: pendente (Encarregado da controladora — L12) · **Data**: 2026-07-07
