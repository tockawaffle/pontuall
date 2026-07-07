# Transferências internacionais — Guia (Arts. 33–36 + Res. CD/ANPD nº 19/2024)

O PontuAll não transfere dados ao exterior por conta própria. Transferência internacional só
existe se **você** (controladora) escolher operador fora do Brasil:

- **SMTP estrangeiro** (Gmail, SES us-east-1, Mailgun…) → transferência de nome/e-mail/tokens
- **PostgreSQL gerenciado fora do Brasil** → transferência do banco inteiro
- **Backup em nuvem estrangeira** → idem

## Como regularizar (em ordem de preferência)

1. **Evitar**: escolher região Brasil (ex.: AWS `sa-east-1`, GCP `southamerica-east1`) —
   sem transferência, nada a fazer.
2. **Cláusulas-Padrão Contratuais brasileiras** (Res. 19/2024, Anexo II): verificar se o
   contrato/DPA do provedor as incorpora integralmente e sem alteração. O prazo de adaptação
   de contratos antigos encerrou em ago/2025 — contratos novos já devem vir com elas ou
   equivalente reconhecido.
3. Outras hipóteses do Art. 33 (decisão de adequação, normas corporativas globais, selos) —
   conforme o provedor.

## Registro

Por operador estrangeiro, criar `{slug}.md` aqui com: país, hipótese do Art. 33 usada,
documento que a comprova (link do DPA/SCCs), data da verificação.
