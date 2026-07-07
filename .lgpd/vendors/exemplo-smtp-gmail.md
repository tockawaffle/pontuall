# Operador — (exemplo) Google Workspace / Gmail SMTP

- **Razão social / país**: Google LLC (EUA); no Brasil, Google Brasil Internet Ltda.
- **Serviço**: envio de e-mails transacionais via SMTP (OTP de batida, link de senha)
- **Finalidade do tratamento**: entrega de e-mail em nome da controladora (A007)
- **Dados compartilhados**: nome, e-mail do funcionário, corpo do e-mail (OTP/link com token
  temporário de uso único)
- **Atividades afetadas**: A007
- **Tier**: Alto
- **DPA**: Google Cloud/Workspace Data Processing Addendum — incorporado aos termos da conta;
  confirmar aceite no admin console
- **Localização dos dados**: exterior (infra global Google)
- **Transferência internacional**: **Sim** — exige hipótese do Art. 33. Google adota
  cláusulas contratuais; registrar avaliação em `.lgpd/transfers/smtp-gmail.md` (Res. 19/2024)
- **Certificações**: ISO 27001, ISO 27701, SOC 2/3
- **Notificação de incidente**: prevista no DPA ("without undue delay") — verificar
  compatibilidade com Res. 15/2024 (3 dias úteis; ATPP 6)
- **Mitigação embutida no produto**: OTP e links expiram (24h/uso único) — dado vazado no
  provedor perde valor rapidamente
- **Última revisão**: 2026-07-07 · **Próxima**: 2027-01-07 · **Owner**: {admin da controladora}
