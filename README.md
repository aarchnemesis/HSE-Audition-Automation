# HSE Audition Automation

Plataforma em **TypeScript** com **Arquitetura Hexagonal (Ports & Adapters)** e **Fonte Unica da Verdade (SSOT)** para automacao de conformidade EHS/HSE, integracao de dados de treinamento e qualificacao de equipes de campo da ArthWind.

A plataforma unifica tres fontes de dados:
1. **Google Drive**: Varredura automatizada de certificados reais (PDFs) em pastas organizadas por colaboradores via Google Drive API (OAuth 2.0).
2. **Smartsheet**: Leitura da matriz oficial de colaboradores e datas digitadas (`ATW_ADM_002 - RPO - EHS`) via Smartsheet API v2.
3. **Storz LMS**: Coleta em tempo real de matriculas, situacoes de conclusao/reprovacao e retestes via API REST do LMS Storz.

O sistema alimenta tanto o dashboard interativo publicado na Vercel quanto relatorios oficiais em Excel e alertas por e-mail (SMTP).

---

## Arquitetura do Sistema (SSOT)

```text
HSE-Audition-Automation/
├── .github/workflows/
│   ├── update_dashboard_daily.yml     # Atualizacao diaria do dashboard (06:45 e 17:45 BRT)
│   ├── do_history_report.yml          # Historico do aluno para DO (seg a sex, 03:45 BRT)
│   ├── ehs_storz_cron.yml             # Resumo semanal EHS de pendencias (seg, 04:15 BRT)
│   └── drive_rpo_audit.yml            # Auditoria de divergencias de digitacao (seg, 04:30 BRT)
├── data/                              # Snapshots persistentes versionados no Git (SSOT)
│   ├── hse_database.json              # Banco consolidado de conformidade EHS
│   ├── rpo_divergences.json           # Divergencias calculadas Drive/Storz x RPO
│   ├── drive_inspectors_cache.json    # Cache local de pastas e certificados do Drive
│   ├── rpo_inspectors_cache.json      # Cache local de colaboradores da RPO
│   ├── storz_cache.json               # Cache local de matriculas da Storz
│   └── sync_metadata.json             # Metadados e telemetria da ultima sincronizacao
├── public/
│   └── index.html                     # Dashboard HTML autocontido publicado na Vercel
├── src/
│   ├── adapters/
│   │   ├── dashboard/                 # Geradores de HTML do dashboard (HSE e DO)
│   │   ├── drive/                     # Google Drive OAuth Adapter e extratores de PDFs
│   │   ├── email/                     # Servicos SMTP e templates de e-mail institucionais
│   │   ├── smartsheet/                # Adaptador para a API do Smartsheet
│   │   └── storz/                     # Scraper e parser de dossies da Storz
│   ├── domain/
│   │   ├── models/                    # Modelos de dados (Certificate, StorzRequest)
│   │   └── services/                  # Motores de conformidade, SSOT pipeline e triangulacao
│   ├── ports/                         # Interfaces e contratos (Ports)
│   └── cli/
│       ├── runAgentJob.ts             # Runner central unificado para agentes e crons
│       ├── runHSEReportExporter.ts    # Sincronizacao SSOT e exportador do relatorio HSE
│       ├── runStorzHistoryReport.ts   # Relatorio de Historico do Aluno e envio para DO
│       └── runDriveRpoAudit.ts        # Auditoria de digitacao Drive x RPO
└── scratch/                           # Diretorio de trabalho temporario local
```

---

## Auto-Cura e Resiliencia (Self-Healing)

O motor central (`HSEDataPipeline.ts`) possui mecanismo de auto-cura:
- **Google Drive API**: Caso a API retorne erro, timeout ou rate limit, o pipeline recorre automaticamente ao `data/drive_inspectors_cache.json`.
- **Smartsheet API**: Caso a planilha nao seja encontrada (404) ou a permissao oscile, o pipeline recorre ao `data/rpo_inspectors_cache.json` ou reconstroi os dados a partir de `rpo_divergences.json`.
- **Storz LMS**: Caso a conexao direta falhe, recorre ao `data/storz_cache.json`.
- **SMTP**: Falhas no envio de e-mails sao registradas como aviso sem interromper a geracao e publicacao do dashboard na Vercel.

---

## Execucao das Rotinas via Agente

Para executar rotinas a partir de um agente autonomo ou script, utilize o runner unificado:

```bash
# Atualizar dashboard e fazer push para a Vercel
pnpm run agent:dashboard

# Gerar e enviar relatorio de DO para Mayana Gomes e Joao Oliveira
pnpm run agent:do

# Gerar relatorio HSE e enviar resumo diario/semanal para a equipe de EHS
pnpm run agent:hse

# Executar auditoria de divergencias de digitacao Drive x RPO
pnpm run agent:rpo

# Executar dashboard + relatorio de DO em sequencia
pnpm run agent:all
```

---

## Configuracao do Ambiente (.env)

Copie o arquivo `.env.example` para `.env` e preencha as credenciais:

```bash
cp .env.example .env
```

Variaveis essenciais:
- `STORZ_URL`, `STORZ_USER`, `STORZ_PASS`: Credenciais da plataforma Storz.
- `HSE_DRIVE_FOLDER_ID`: IDs das 4 pastas raiz do Google Drive.
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`: Autenticacao do Google Drive em modo servidor / CI.
- `SMARTSHEET_API_TOKEN`, `SMARTSHEET_RPO_SHEET_ID`: Acesso a planilha RPO.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: Configuracao de envio de e-mails.
- `DO_EMAIL_TO`: Destinatarios do relatorio de DO.
- `HSE_EMAIL_TO`: Destinatarios dos alertas de EHS.

---

## Agendamento Sugerido para Crontab Local / Agente

Caso deseje transferir os crons do GitHub Actions para um servidor proprio ou crontab do agente:

```cron
# 1. Atualizacao Diaria do Dashboard (2x ao dia: 06:45 e 17:45 BRT)
45 6,17 * * * cd /caminho/do/projeto && pnpm run agent:dashboard >> scratch/dashboard_cron.log 2>&1

# 2. Relatorio de DO (Mayana Gomes) - Segunda a Sexta as 07:00 BRT
0 7 * * 1-5 cd /caminho/do/projeto && pnpm run agent:do >> scratch/do_cron.log 2>&1

# 3. Resumo Semanal EHS - Segunda-feira as 07:15 BRT
15 7 * * 1 cd /caminho/do/projeto && pnpm run agent:hse >> scratch/hse_cron.log 2>&1

# 4. Auditoria de Digitacao RPO - Segunda-feira as 07:30 BRT
30 7 * * 1 cd /caminho/do/projeto && pnpm run agent:rpo >> scratch/rpo_cron.log 2>&1
```

---

## Testes e Qualidade de Codigo

```bash
# Executar suite completa de testes unitarios
pnpm test

# Verificacao estatica de tipos
pnpm run typecheck

# Linter e formatador de codigo
pnpm run check
pnpm run check:write
```
