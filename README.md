<div align="center">

# PontuAll

**Relógio de ponto NFC self-hosted para pequenas empresas.**
Funcionários batem o ponto com um toque do cartão. O ponto continua funcionando quando a internet cai. Seus registros ficam no seu próprio banco de dados.

[![publish](https://github.com/tockawaffle/pontuall/actions/workflows/build.yml/badge.svg)](https://github.com/tockawaffle/pontuall/actions/workflows/build.yml)
[![versão](https://img.shields.io/github/v/release/tockawaffle/pontuall?include_prereleases&label=vers%C3%A3o)](https://github.com/tockawaffle/pontuall/releases/latest)
[![plataforma](https://img.shields.io/badge/plataforma-Windows%2010%2B-0078D6)](https://github.com/tockawaffle/pontuall/releases/latest)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri&logoColor=white)](https://tauri.app)

[Download](#primeiros-passos) · [Primeira execução](#primeira-execução) · [Desenvolvimento](#desenvolvimento) · [Arquitetura](#arquitetura) · [Modelo de segurança](#modelo-de-segurança)

</div>

---

O PontuAll é um terminal de ponto desktop para a recepção de uma pequena empresa: uma máquina
Windows, um leitor NFC e um banco PostgreSQL sob o seu controle. Serve para quem não quer pagar
assinatura de ponto na nuvem e prefere manter os registros de frequência dentro de casa.

**O que o torna diferente:**

- **Offline-first.** O PostgreSQL é a fonte de verdade, mas um espelho local em SQLite mantém o
  terminal batendo ponto durante quedas de rede. As gravações ficam guardadas e são reenviadas
  automaticamente quando a conexão volta.
- **Cartões com detecção de clonagem.** Os cartões carregam um token rotativo de uso único. Um
  cartão clonado diverge no primeiro uso, é bloqueado e gera um alerta. Não existe ID estático
  para copiar.
- **Sem mensalidade e sem telemetria.** Seu banco de dados, seu servidor SMTP, seu hardware.
- **Segurança levada a sério.** As sessões nunca chegam ao webview, toda checagem de permissão
  passa pelo [Better Auth](https://better-auth.com), e o app se recusa a iniciar um sidecar de
  autenticação que não tenha sido assinado pelo seu certificado.

## Funcionalidades

**Para funcionários**
- Entrada, saída e intervalo de almoço com um toque do cartão NFC, ou com um código de uso
  único enviado por e-mail
- Definição de senha em autoatendimento via link por e-mail

**Para administradores**
- Gestão de funcionários com papéis (`employee`, `supervisor`, `administrator`)
- Correção de batidas com trilha de auditoria à prova de adulteração
- Provisionamento, substituição e bloqueio/desbloqueio de cartões
- Relatórios de frequência exportados para Excel (`.xlsx`)
- Configuração de SMTP para e-mails de OTP e de senha

## Primeiros passos

**Requisitos**

|                   |                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Sistema           | Windows 10/11 (64 bits)                                                                                             |
| Banco de dados    | Um servidor PostgreSQL acessível (o app cria e migra o próprio banco)                                               |
| Leitor de cartões | ACS **ACR122U** (opcional, usado só para ponto por NFC; requer o serviço Cartão Inteligente do Windows, `SCardSvr`) |
| Cartões           | MIFARE Classic 1K (opcional)                                                                                        |
| SMTP              | Qualquer conta SMTP (opcional, para OTP e e-mails de senha)                                                         |

**Instalação**

1. Baixe o instalador mais recente (`PontuAll_x.y.z_x64-setup.exe`) em
   [Releases](https://github.com/tockawaffle/pontuall/releases/latest).
2. Execute-o. O SmartScreen do Windows vai alertar sobre um editor desconhecido, porque o
   instalador é assinado com o certificado do próprio projeto e não com um certificado pago
   (veja [Assinatura de código](#assinatura-de-código)). Escolha "Mais informações → Executar
   assim mesmo".

### Primeira execução

A tela de abertura conduz toda a configuração, nesta ordem:

1. **Jornada de trabalho**: o horário contra o qual as batidas são conferidas.
2. **Banco de dados**: URI do PostgreSQL + nome da empresa. O banco
   (`pontuall_{empresa}`) é criado e migrado automaticamente.
3. **Primeiro administrador**: a conta que você usará para cadastrar o restante.

Depois disso: provisione cartões pelo painel administrativo ou convide funcionários por e-mail
para ponto por senha/OTP.

> **Um terminal por banco de dados.** Os tokens rotativos dos cartões tornam inseguro o uso
> *offline* com múltiplos terminais. A sincronização detecta conflito no contador do token e
> bloqueia o cartão afetado em vez de sobrescrever silenciosamente um token mais novo.

## Desenvolvimento

Pré-requisitos: [Bun](https://bun.sh), toolchain Rust (MSVC), PowerShell 7 (`pwsh`) e um
servidor PostgreSQL. Para os recursos de cartão, o serviço Cartão Inteligente do Windows e um
ACR122U.

```sh
bun install
bun run tauri:dev       # compila o sidecar de auth + frontend e abre o app
bun run tauri:build     # produz o instalador assinado (MSI + NSIS)
```

### Assinatura de código

Os binários de release (app, sidecar de autenticação, instalador) são assinados com
Authenticode. O app verifica a assinatura do sidecar contra uma impressão digital de
certificado fixada em tempo de build antes de iniciá-lo, então um `pontuall-auth.exe` trocado
ou adulterado é recusado antes que qualquer segredo chegue a ele.

Configuração única por máquina de build:

```powershell
.\scripts\generate-signing-cert.ps1   # certificado autoassinado + fingerprint fixada
```

Compilar sem isso ainda funciona, mas o build mostra um aviso de que a verificação do sidecar
ficará desativada.

O CI assina os releases da mesma forma. Cadastre dois secrets no repositório e o workflow
importa o certificado antes do build (sem eles, o build sai sem assinatura):

| Secret                      | Conteúdo                                          |
| --------------------------- | ------------------------------------------------- |
| `SIGNING_CERT_PFX_BASE64`   | Base64 do PFX exportado (`Export-PfxCertificate`) |
| `SIGNING_CERT_PFX_PASSWORD` | A senha do PFX                                    |

### Testes

```sh
cd src-tauri
cargo test                                          # testes unitários (sem hardware/BD)
TEST_PG_URI=postgres://user:pass@host:port \
  cargo test postgres_roundtrip -- --ignored        # contra um PostgreSQL real
```

Os testes unitários cobrem a codificação dos access bits do MIFARE (validada contra o datasheet
NXP MF1S50), a derivação de chaves por cartão, a máquina de estados de detecção de clone, os
construtores de APDU e os repositórios SQLite/PostgreSQL.

## Arquitetura

```
┌─────────────────────────────────────────────┐
│ App Tauri (Rust)                              │
│                                               │
│  Webview (Next.js static export)              │
│    └─ invoke() ──▶ comandos Tauri             │
│                                               │
│  DbState:  pool PostgreSQL (online)           │
│            espelho SQLite  (sempre)           │
│            outbox → reenviado ao reconectar   │
│                                               │
│  AuthState ──HTTP(127.0.0.1)──▶ BetterAuth    │
│                                  sidecar (Bun)│
│                                       │       │
│  CardService (worker PC/SC) ──▶ ACR122U       │
└──────────────────────────────────────┼───────┘
                                        ▼
                                   PostgreSQL
```

- **Banco de dados.** O PostgreSQL é a fonte de verdade. Um banco SQLite local
  (`%APPDATA%/PontuAll/offline.db`) espelha os dados mestres e guarda gravações enquanto
  offline. Uma tabela `sync_outbox` é reenviada ao Postgres na reconexão (o último a escrever
  vence, por `updated_at`). A conectividade é sondada com `SELECT 1` a cada 30s. Veja
  `src-tauri/src/db/`.

- **Autenticação.** Um sidecar [Better Auth](https://better-auth.com) (`sidecar/`) cuida de
  identidade, sessões e todas as checagens de permissão, pelos papéis de controle de acesso
  do plugin admin. Os dados de auth vivem no mesmo banco PostgreSQL, acessados via Prisma
  (`sidecar/prisma/schema.prisma`). O backend Rust inicia o sidecar (após verificar sua
  assinatura), intermedia todo o tráfego de auth e aplica permissões nos comandos Tauri
  chamando `POST /admin/has-permission`. O token de sessão fica apenas no backend Rust
  (`AuthState`, em memória) e nunca é exposto ao webview, então um XSS na view não consegue
  exfiltrar sessão; comandos privilegiados resolvem a sessão ativa a partir do estado do
  backend, não de um argumento vindo do frontend. Como o token é somente em memória, reiniciar
  o app exige novo login. Os registros de funcionários mantêm um espelho local de `permissions`
  para equipe que só usa NFC e para sincronização de papéis, mas o papel do Better Auth é o
  autoritativo quando existe um login.

- **Cartões (token rotativo, detecção de clone).** Cartões MIFARE Classic 1K armazenam apenas
  um token opaco de uso único protegido por chaves derivadas, por cartão, de um segredo mestre.
  Cada toque bem-sucedido verifica o token contra o banco e grava um novo (protocolo de token
  pendente: um token valida exatamente uma vez, mesmo se alguma etapa falhar). Um token
  defasado significa que um clone divergiu: o cartão é bloqueado e um evento
  `card:clone_detected` é emitido. Veja `src-tauri/src/card/`.

## Modelo de segurança

O que o app garante e o que ele não garante:

- **Cartões fazem *detecção* de clonagem, não prevenção.** A cifra Crypto-1 do MIFARE Classic é
  quebrada; a fronteira de segurança real é o token rotativo, que pega o clone no primeiro
  uso divergente. Para prevenção de verdade, migre o estoque de cartões para DESFire/NTAG 424.
- **Integridade do sidecar.** O sidecar de autenticação recebe as credenciais do banco e o
  segredo de auth pelo ambiente. Por isso o app fixa a impressão digital do certificado em
  tempo de build e recusa qualquer binário cuja assinatura Authenticode não corresponda
  (`src-tauri/src/auth/signature.rs`).
- **Certificado autoassinado.** A assinatura ancora a confiança no *seu* certificado, não no
  repositório de raízes do Windows. Isso impede a troca silenciosa de binários, mas não remove
  os avisos do SmartScreen; para isso seria preciso um certificado EV/OV pago.
- **Segredos** ficam no Gerenciador de Credenciais do Windows (serviço `PontuAll`):

  | Entrada              | Finalidade                                                 |
  | -------------------- | ---------------------------------------------------------- |
  | `postgres_uri`       | URI do servidor PostgreSQL (com credenciais)               |
  | `app_name`           | Nome da empresa/app → banco `pontuall_{app_name}`          |
  | `better_auth_secret` | Segredo de assinatura do Better Auth (32 bytes aleatórios) |
  | `card_master_key`    | Chave mestra para derivação das chaves MIFARE por cartão   |

  > **Faça backup da `card_master_key`.** Perdê-la (reinstalação do Windows, troca de perfil)
  > torna todos os cartões provisionados não regraváveis. Um SuperUser pode exportá-la e
  > importá-la pelos comandos `export_card_master_key` / `import_card_master_key`.
