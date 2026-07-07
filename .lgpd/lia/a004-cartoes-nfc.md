# LIA — A004 Cartões NFC e antifraude

- **Atividade**: a004-cartoes-nfc
- **Controlador**: empresa cliente (preencher razão social na adoção)
- **Data**: 2026-07-07 · **Versão**: 1 · **Próxima revisão**: 2027-07-07

## 1. Teste de Finalidade

- **Interesse legítimo**: garantir que a batida de ponto foi feita pelo próprio funcionário e
  detectar cartões clonados — integridade do registro de jornada.
- **Lícito, específico e real?** Sim — fraude de ponto ("bater por colega", clonagem de
  MIFARE Classic) é risco concreto e documentado; a cifra Crypto-1 do cartão é quebrada.
- **Quem se beneficia?** Controladora (registro fidedigno), titulares (jornada correta paga
  corretamente; ninguém bate por eles) e coletividade de funcionários.
- **Prejuízo sem o tratamento**: registros de jornada não confiáveis, fraude indetectável,
  passivo trabalhista.

## 2. Teste de Necessidade

- **Estritamente necessário?** Sim — a detecção exige vincular o cartão (UID + token rotativo)
  ao funcionário e registrar eventos de uso.
- **Forma menos invasiva?** O desenho atual já é a forma menos invasiva: token opaco (não
  biometria), hash no banco, token bruto só no cartão. Alternativas mais invasivas (biometria,
  câmera) foram evitadas.
- **Dados mínimos?** Sim — UID, hashes, contador, eventos. Nenhum dado adicional do titular.

## 3. Teste de Balanceamento

| Fator | Avaliação |
|---|---|
| Expectativa razoável do titular | **Alta** — funcionário sabe que o cartão registra o ponto dele; é a função do objeto |
| Impacto potencial | **Leve** — pior caso: cartão bloqueado por suspeita de clone, resolvido com reemissão; há fallback por OTP |
| Categoria do dado | Comum/pseudonimizado (token ↔ id interno) |
| Vulnerabilidade do titular | Possíveis adolescentes aprendizes — impacto não muda (mesma finalidade protetiva) |
| Forma de coleta | Observada, mas transparente (o toque é ato consciente do titular) |
| Salvaguardas | Minimização, hash SHA-256, chave mestra no Credential Manager, trilha de auditoria |

**Conclusão**: o interesse **prevalece** — finalidade protetiva, dados mínimos e
pseudonimizados, impacto residual leve e reversível, alternativa (OTP) disponível a quem se
opuser ao cartão.

## 4. Salvaguardas adotadas

- [x] Minimização de dados
- [x] Pseudonimização (token opaco, hash)
- [x] Acesso restrito (RBAC)
- [x] Trilha de auditoria
- [ ] Transparência ativa → incluir no aviso de privacidade (L9)
- [ ] Limitação de retenção de `card_events` → definir em L5
- [x] Mecanismo de oposição: batida por OTP como alternativa ao cartão

## 5. RIPD necessário?

Não — sem perfilamento, decisão automatizada com efeito jurídico, sensíveis ou larga escala
(Res. 2/2022, Art. 4º). Bloqueio de cartão suspeito é medida de segurança revisável por humano.

## 6. Decisão

- [x] Aprovo o uso de legítimo interesse para esta atividade

**Responsável**: pendente (Encarregado da controladora — L12) · **Data**: 2026-07-07
