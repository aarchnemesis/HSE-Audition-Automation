# HSE Audition Automation 🛡️

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Playwright](https://img.shields.io/badge/Playwright-1.41-green.svg)](https://playwright.dev/)
[![ExcelJS](https://img.shields.io/badge/ExcelJS-4.4-excel.svg)](https://github.com/exceljs/exceljs)
[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-Automated-blue.svg)](.github/workflows/ehs_storz_cron.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Plataforma completa em **TypeScript** com **Arquitetura Hexagonal (Ports & Adapters)** para automação de auditoria de conformidade EHS/HSE, raspagem de solicitações da plataforma **Storz via Playwright**, conciliação de auditoria tripla (Drive + RPO + Storz), filtro de modalidades (Presencial vs. Online), régua de prazos escalonados e simulação de mapa de aptidão geográfica.

---

## 🏛️ Arquitetura do Projeto (Ports & Adapters)

```text
HSE-Audition-Automation/
├── .github/
│   └── workflows/
│       └── ehs_storz_cron.yml           # 🤖 Automação remota no GitHub Actions (06:00 BRT)
├── src/
│   ├── domain/
│   │   ├── models/
│   │   │   ├── Certificate.ts           # Interfaces: Inspector, Certificate, EHSStatus, TrainingModality
│   │   │   └── StorzRequest.ts          # Modelo de solicitações da plataforma Storz
│   │   └── services/
│   │       ├── EHSEvaluator.ts          # 📅 Régua Escalonada EHS (60d, 30d, 15d, 7d, Vencidos)
│   │       ├── ComplianceEngine.ts      # 🎯 Motor de Triangulação Inspetor x Parque
│   │       ├── AuditTriangulator.ts     # 🧠 Motor de Auditoria Tripla (Drive + RPO + Storz)
│   │       ├── HSEDatabaseRepository.ts # 💾 Banco de Dados Central HSE (JSON/SQLite)
│   │       └── HSEFilterEngine.ts       # 🔍 Motor de Consultas & Exportador Excel Formatação Oficial
│   ├── ports/
│   │   ├── IDocumentProvider.ts         # Contrato para Provedores de Documentos (Drive/Cloud)
│   │   ├── IRPOExporter.ts              # Contrato para Leitura/Exportação da Planilha RPO
│   │   ├── IStorzProvider.ts            # Contrato para Coleta de dados da Storz
│   │   └── IEmailService.ts             # Contrato para Disparo de Alertas por E-mail
│   ├── adapters/
│   │   ├── drive/DriveFileSystemAdapter.ts # Mapeamento de PDFs e Pastas do Drive por Regex
│   │   ├── excel/ExcelRPOAdapter.ts        # Manipulação de planilhas Excel (ATW_ADM_002 - RPO - EHS)
│   │   ├── storz/
│   │   │   ├── StorzPlaywrightAdapter.ts  # Adaptador Storz com Cache Local JSON
│   │   │   └── StorzPlaywrightScraper.ts  # 🎭 Robô Playwright em TS para Automação Web na Storz
│   │   ├── email/DummyEmailService.ts     # 📧 Gerador de E-mails HTML de Alerta (/scratch/emails/)
│   │   └── arthnex/ArthnexPipelineAdapter.ts # 🚀 Ponto de encaixe futuro no pipeline Arthnex
│   └── cli/
│       ├── runTriangulation.ts          # CLI de Triangulação de Aptidão Básica
│       ├── runStorzAudit.ts             # CLI de Auditoria Tripla Storz + Alertas
│       └── runHSEReportExporter.ts      # 📊 CLI de Consolidação no Banco e Relatório Excel
└── scratch/
    ├── storz_cache.json                  # Cache local das solicitações raspadas da Storz
    ├── hse_database.json                # Banco de dados central consolidado EHS
    ├── hse_relatorio_consolidado.xlsx   # Relatório Excel formatado com cores de status EHS
    └── emails/                          # E-mails dummy em HTML gerados
```

---

## 📅 Régua Escalonada de Auditoria EHS

O sistema avalia a validade das certificações e treinamentos em **5 faixas de prazos**:

| Status EHS | Faixa de Prazo | Ação da Automação |
| :--- | :--- | :--- |
| `🟢 CONFORME` | **> 60 dias** | Certificado totalmente em dia. |
| `🔵 VENCE_60` | **31 a 60 dias** | Alerta Inicial 60d. Checa Storz para evitar pedidos duplicados. |
| `🟡 VENCE_30` | **16 a 30 dias** | Alerta Médio 30d. Reavalia se houve avanço na Storz/Drive. |
| `🟠 VENCE_15` | **8 a 15 dias** | Alerta Urgente 15d de reciclagem. |
| `🔴 VENCE_07` | **1 a 7 dias** | Alerta Crítico 7d pré-bloqueio. |
| `⛔ VENCIDO` | **<= 0 dias** | Bloqueio imediato do inspetor (Inapto para mobilização). |
| `🔵 SOLICITADO_STORZ` | **Solicitação Ativa** | Treinamento em andamento na Storz. Impede pedido duplicado. |

---

## ⚙️ Variáveis de Ambiente (.env)

```env
STORZ_URL=https://storz.exemplo.com
STORZ_USER=seu_usuario
STORZ_PASS=sua_senha
```

---

## 🚀 Como Executar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Executar a consolidação do Banco HSE, Filtros e Relatório Excel
npm run hse-report

# 3. Executar a Auditoria Tripla + Storz + Alertas por E-mail
npm run storz-audit

# 4. Executar a Triangulação de Aptidão por Parque
npm run triangulate
```

---

## 🤖 Automação Remota via GitHub Actions

O arquivo [`.github/workflows/ehs_storz_cron.yml`](.github/workflows/ehs_storz_cron.yml) roda automaticamente:
- **Frequência:** De segunda a sexta-feira às 06:00 BRT (09:00 UTC).
- **Ações:** Executa o robô Playwright na Storz, realiza a auditoria tripla, consolida o banco de dados, gera o relatório Excel formatado e dispara os alertas por e-mail.
- **Artifacts:** A planilha `hse_relatorio_consolidado.xlsx` fica disponível para download direto no GitHub.
