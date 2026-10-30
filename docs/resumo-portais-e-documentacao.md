# Resumo — Portais de Clientes, Documentação/SSOT & Automações EHS

**Período:** 27–30/10/2026  
**Branch:** `feat/portal-pendency-report` (criada a partir de `main`)  
**Escopo Global:**
1. Extração automatizada e auditoria de pendências nos portais de clientes (TDoc, eGestiona, Veriduss, Surisoft, Metacontratas).
2. Sincronização automatizada de WOs/Equipes ativas do Smartsheet (`ATW_OP_CT_001`) para a aba `BASE` da planilha do Massude no Google Drive (`1T4-m4FEqd1U3P_2Wgz1mtfpPME2BrJra`).
3. Aplicação do cruzamento dos portais na planilha de controle/homologação de clientes (teste em `1TRnxZ7wNrQ7yrIA7rdRkpdAWJvWVZMZm`).
4. Disparo de relatórios periódicos e testes para stakeholders (EHS e Coordenação de Operações) via SMTP (`joao.oliveira@arthwind.com.br`).
5. Reconciliação da documentação no Google Drive (SSOT) com o Dashboard HSE.

> **Atenção:** Todas as alterações estão contidas nesta branch fora da `main` (`feat/portal-pendency-report`). Não mesclar direto na `main` sem validação por PR limpo.

---

## 1. Portais de Clientes — Extração & Auditoria

### 1.1 Objetivo & Arquitetura
Cruzar os censos extraídos das plataformas de clientes com o **Briefing de Projetos** (Smartsheet) e a base de colaboradores HSE, identificando com precisão **quem está liberado, quem tem pendência documental impeditiva e quem não está cadastrado**, gerando filas de ação prioritárias para EHS e relatórios de prontidão para a Coordenação de Operações.

### 1.2 Plataformas Automatizadas em Campo (6 Portais Ativos)

| Portal | Cliente / Contratos | Método de Extração | Colaboradores no Censo | Status |
|---|---|---|---|---|
| **Veriduss** | Goldwind | REST JSON (`Strapi /api/documents`) | 13 | 🟢 100% Confiável |
| **Surisoft** | GE Vernova / Serena | Token de sessão + API interna (`/colaborador_requisitos_list`) | 44 | 🟢 100% Confiável |
| **eGestiona** | Vestas Latam | Scraping DOM / Grid de Semáforos DPE/DPR | 22 | 🟢 Operacional |
| **TDoc** | SGRE (Gamesa) | Playwright JSF / Keycloak OIDC | 18 | 🟡 JSF stateful (conserva dados) |
| **Metacontratas** | Ibitu Energia, Energimp, Repsol Chile | Playwright anti-bot + SSO hub.metadata.net + JSF | 17 | 🟢 100% Destravado e Confiável |
| **DGTSS** *(novo)* | Invenergy (Asa Branca, Chapada Piauí, São Zacarias) | Playwright ASP.NET / Cautus Digital (`IntegrationReport.aspx`) | 11 | 🟢 100% Automatizado e Confiável |

---

## 2. Destravamento do Metacontratas (Bypass reCAPTCHA & Multi-Contrato)

### 2.1 Desafio Técnico Resolvido
O Metacontratas implementa proteção Cloudflare / reCAPTCHA v3 e retornava recorrentemente `HTTP 428 Precondition Required` quando acessado via automação headless padrão. Além disso, a arquitetura de acesso é multi-tenant:
- Autenticação central em `https://hub.metadata.net/app/metalogin/accesos`.
- Painel de seleção de contratos em `https://hub.metadata.net/app/accesos?plataformaInicio=Metacontratas`.
- Requisição SSO interna POST `/login/v1/usuarios/56688/accesos/{id}/autenticar` que gera token JWT e redireciona para `cloud.metacontratas.com/acceso1` ou `acceso2`.
- Grid de trabalhadores em JSF (`TablaEmpleado.jsp`).

### 2.2 Solução Implementada (`MetacontratasScraper.ts`)
1. **Evasão Anti-Bot:**
   - Inicialização do Chromium com `--disable-blink-features=AutomationControlled`.
   - Headers realistas do Windows 10 / Chrome 130, locale `pt-BR`, timezone `America/Sao_Paulo`.
   - Autenticação bem-sucedida (HTTP 200 OK) com as credenciais corporativas da Darliane Caetano (`darliane.caetano@arthwind.com.br`).
   - Sessão e cookies persistidos em `scratch/portais/sessions/metacontratas-darliane.session.json`.
2. **Navegação Multi-Contrato:**
   - Mapeamento e clique automático nos botões de cada empresa/contrato (`IBITU ENERGIA S.A`, `ENERGIMP (CE e SC)`, `REPSOL CHILE`).
   - Tratamento de popups e redirecionamento de abas preservando a página mãe.
   - Extração estruturada da `TablaEmpleado.jsp`:
     - Nome do técnico, função, documento/DNI, status de conformidade global e pendências.
3. **Resultados Extraídos (`data/portais/metacontratas.census.json`):**
   - **IBITU ENERGIA S.A:** 10 colaboradores (3 com 100% dos documentos aprovados: Alison dos Santos Silva, Nardel Delon Pinho Ribeiro, Sérgio Luiz Santana de Souza; 7 com documentos pendentes/vencidos).
   - **ENERGIMP:** 6 colaboradores.
   - **REPSOL CHILE:** 1 colaborador.
   - Total: **17 técnicos mapeados** com conformidade real.

---

## 3. Automação do DGTSS — Invenergy (`DgtssScraper.ts`)

### 3.1 Contexto & Urgência Operacional
A Invenergy possui mobilizações iminentes em **4 dias** para os Complexos Eólicos *Asa Branca* e *Chapada Piauí*, além de equipe em campo em *Ventos de São Zacarias*. Era o **único gargalo desprotegido** na janela crítica de mobilização da Fase 1.

### 3.2 Solução Implementada
- **Autenticação:** Login automatizado em `https://invenergy.dgtss.com.br/lgn/login.aspx` (Cautus Digital / ASP.NET) com as credenciais da Darliane Caetano (`darliane.caetano@arthwind.com.br`). Persistência de sessão em `scratch/portais/sessions/dgtss-invenergy.session.json`.
- **Extração da Lista Geral:** Consulta automática em `MGI/IntegrationReport.aspx` acionando `#btnReport` e extraindo a tabela `gvIntegration` com os dados de integração e ASO de cada técnico.
- **Auditoria Granular de Anexos:** Navegação direta na tela de detalhes de cada colaborador (`MGI/IntegrationInsert.aspx?idI=...` na aba `#attach`), extraindo:
  - Documentos aprovados, reprovados e em análise na tabela `gvIntegrationAttachT`, capturando a nota exata do aprovador (ex.: *"Certificado não consta na Ordem de Serviço"*).
  - Documentos pendentes de envio na tabela `gvIntegrationAttachRemaining`.
- **Resultados (`data/portais/dgtss-invenergy.census.json`):**
  - **11 colaboradores auditados** com 100% dos seus anexos mapeados.
  - Alerta crítico gerado para as mobilizações de 4 dias: Francisco Elvison (NR-33 reprovada pela Mariana Zillo), Francisco Leonardo (ASO vencido), Wanderson Avelino e Francisco Vinicius.
- **CLI Criado:** `pnpm run dgtss-extract`.

---

## 4. Sincronização Smartsheet WOs → Planilha do Massude (Google Drive)

### 3.1 O Problema
A planilha oficial de controle de homologação do Massude (`1T4-m4FEqd1U3P_2Wgz1mtfpPME2BrJra`) dependia de digitação manual de técnicos alocados nas Ordens de Serviço (WOs). O Smartsheet `4246973141962628` (PAINEL DE CAMPANHAS) contém os dados em tempo real (Líder, Equipes 01/02/03, WO, Contrato, MOB).

### 3.2 O Sincronizador (`src/cli/syncSmartsheetToGoogleBase.ts`)
- Mapeia 82 campanhas ativas com 918 chaves indexadas na aba `BASE`.
- Preserva integralmente:
  - Fórmulas automáticas de SLA, status e filtros (Colunas J, K, L, M, S, V, W).
  - Linhas preenchidas manualmente pelo EHS (Colunas E, F, H - Status, Data de Solicitação e Liberação).
  - Desoculta linhas ocultas por filtros residuais do Excel.
- Detecta alterações de escopo, previsão de acesso (MOB) e novas WOs, inserindo técnicos não cadastrados com status "Pendente" e solicitando cadastro na data atual.
- Integrado ao `runAgentJob.ts` com o comando:
  ```bash
  npx tsx src/cli/syncSmartsheetToGoogleBase.ts --apply
  ```
- **Resultado do Dry-Run em 30/10:** A aba `BASE` do Massude já estava 100% compatibilizada com as campanhas ativas do Smartsheet.

---

## 5. Aplicação do Cruzamento dos Portais na Planilha de Homologação

### 5.1 Teste em Planilha Cópia (`src/cli/updateTestSheetFromPortals.ts`)
Para garantir segurança máxima antes de aplicar na planilha de produção do Massude, foi criado um script de cruzamento testado na planilha cópia (`1TRnxZ7wNrQ7yrIA7rdRkpdAWJvWVZMZm`):
- Carrega os censos dos 6 portais (SGRE 18, Vestas 22, Goldwind 13, GE/Serena 44, Metacontratas 17, Invenergy DGTSS 11).
- Cruza pelo nome normalizado do colaborador e pelo cliente da alocação.
- **Resultados consolidados na planilha de teste:**
  - **163 alocações analisadas com portais (75,5% da base total do Massude).**
  - **14 Liberados:** 100% de conformidade documental no portal (Status `Liberado` + Data de Liberação preenchida na Coluna H + Observação `Liberado 100% (X/X docs)`).
  - **66 Em análise / com pendência:** Colaborador existe no portal, mas tem documentos pendentes ou reprovados.
  - **83 Não cadastrados:** Técnico alocado no parque mas ainda não inserido na plataforma do cliente.
  - Destaque Invenergy (DGTSS): 11 em análise com pendências identificadas, 7 não cadastrados.
  - Destaque Energimp (Metacontratas): 3 liberados, 3 em análise, 3 não cadastrados.
  - Destaque SGRE (TDoc): 9 liberados, 15 em análise, 15 não cadastrados.
  - Destaque Goldwind (Veriduss): 2 liberados, 4 em análise, 15 não cadastrados.

---

## 6. Disparo de E-mails Teste para Stakeholders (EHS & Coordenação)

Executado em 30/10 via `src/cli/runPortalPendencyReport.ts` utilizando SMTP corporativo (`joao.oliveira@arthwind.com.br`):

1. **E-mail EHS — Fila de Documentação:**
   - **Assunto:** `Portais de clientes: fila de documentação (30/10/2026)`
   - **Destinatário de Teste:** `joao.oliveira@arthwind.com.br`
   - **Anexo:** `scratch/portais/pendencias-portais-2026-10-30.xlsx` (planilha detalhada de ações com abas: Resumo, Fila de Ação, Matriz por Projeto, Gaps de Portal).
   - **Conteúdo:** 30 projetos na janela ativa, 285 ações identificadas, sendo 27 prioridades críticas (técnicos com mobilização imediata e documentos pendentes no portal).
2. **E-mail Coordenação de Operações — Prontidão Documental:**
   - **Assunto:** `Prontidão documental das equipes nos clientes (30/10/2026)`
   - **Destinatário de Teste:** `joao.oliveira@arthwind.com.br`
   - **Conteúdo:** Visão executiva por parque/projeto indicando se a equipe escalada está apta ou impedida de acessar o parque, evitando deslocamentos com bloqueio em portaria.

---

## 7. Documentação / SSOT (Drive × Dashboard) — Histórico 27–29/10

- **Reconciliação Drive SSOT:** Unificação do My Drive SSOT com o drive compartilhado "TREINAMENTOS" (`13GqNi1s8mqzt24JwlIN-bz5tp_U95VX2`).
  - 174 cópias de documentos faltantes.
  - 119 arquivos de 9 colaboradores novos.
  - 465 versões mais recentes atualizadas (anteriores movidas para `00.Obsoletos`).
- **Limpeza e Estruturação:**
  - 724 documentos pessoais movidos para pastas `01. Documentos Pessoais`.
  - 52 placeholders "Doc 04.1" renomeados para "Contrato de Trabalho CLT".
  - 145 arquivos com problemas de data corrigidos (`data/pdf_content_cache.json`).
  - Fix da validade da CNH (10 anos para código 08) commitado e mesclado na main via PR #48.
- **Deploy do Dashboard HSE:**
  - Execução bem-sucedida do workflow `update_dashboard_daily.yml` na Vercel.

---

## 8. Mapa de Arquivos & Ferramentas (CLIs)

| Script / CLI | Finalidade |
|---|---|
| `dgtss-extract` | Automação Playwright do portal DGTSS (Invenergy). |
| `metacontratas-extract` | Automação Playwright do Metacontratas (Ibitu, Energimp, Repsol Chile). |
| `portal-report` | Cruzamento global dos 6 portais com o Briefing e geração do Excel + e-mails EHS/Coordenação. |
| `portal-coverage` | Mapeamento do inventário de plataformas EHS e status de automação. |
| `sync-wo` | Sincroniza campanhas/WOs do Smartsheet com a aba BASE da planilha do Massude. |
| `updateTestSheetFromPortals` | Aplica o cruzamento dos 6 portais preenchendo status, liberação e obs na planilha de teste. |
| `drive-reconcile` | Reconciliação do Drive SSOT com a 2ª fonte de treinamentos. |
| `drive-split-pessoal` | Organização de documentos pessoais em pastas dedicadas. |

---

## 9. Próximos Passos & Recomendações

1. **Homologação com o Massude:**
   - Apresentar a planilha de teste atualizada (`1TRnxZ7wNrQ7yrIA7rdRkpdAWJvWVZMZm`) cobrindo 75,5% da base.
   - Com o aval do Massude, rodar o preenchimento de status e liberação diretamente na planilha de produção oficial (`1T4-m4FEqd1U3P_2Wgz1mtfpPME2BrJra`).
2. **Automação Contínua (Cron / Agendamento):**
   - Agendar a extração dos portais e o disparo dos relatórios de pendência para rodar diariamente às 06:00 da manhã.
   - Configurar variáveis oficiais de produção: `PORTAL_EHS_EMAIL_TO` e `PORTAL_OPS_EMAIL_TO`.
3. **Expansão de Portais (Fase 2):**
   - Adicionar os próximos portais identificados no briefing: Seyses (Vestas México) e Pegasus (Nordex).
