# Resumo — Portais de Clientes & Documentação/SSOT

**Período:** 27–29/10/2026
**Branch:** `feat/portal-pendency-report` (criada a partir de `main`)
**Escopo:** duas frentes sequenciais — (1) relatório e extração de pendências nos portais de clientes; (2) reconciliação da documentação no Drive (SSOT) com o dashboard, e o deploy do dashboard.

> `origin/development` está ~13k linhas atrás da `main` (PRs #46/#47 foram direto pra main), por isso tudo parte da `main`.

---

## Parte 1 — Portais de clientes (pendência & extração)

### Objetivo
Cruzar os censos dos portais de clientes com o Smartsheet "Briefing - Projetos" (quem vai pra qual cliente/parque e quando) e a base HSE, respondendo **"quem não consegue entrar em qual parque e quem precisa agir"** — o que os HTMLs por-portal (feitos no Gemini) não respondiam.

### Decisões do João
- **Público:** EHS/documentação + coordenação de operações (não diretoria, não colaboradores).
- **Canal:** só e-mail.
- **Prioridade:** clientes com equipe em campo (pelo Briefing).
- Portais com reCAPTCHA/OTP: sessão salva renovada por humano.

### Mapa de acesso por portal (tiers)
- **T1 — REST JSON:** Veriduss (Strapi `/api/documents`).
- **T2 — login por token + scrape JSF:** TDoc (Keycloak OIDC, 3 instâncias).
- **T3 — formulário simples, sem captcha/2FA:** eGestiona (4), Surisoft, Sercae, DGTSS, SG3, Storz, TechSocial, Tesseg, Datalife, Dokify, Sertras, TAPFIN, ComplyWorks, Portal One, Seyses (2).
- **T4 — reCAPTCHA:** Atlas, Greenlegis, Obrasoft, ContractWeb, WeHandle, Senior → sessão renovada por humano.
- **T5 — 2FA real:** Adapts Pro/WEG (mfa_code), WINDA (authcode).
- **T6 — federado/manual:** SharePoint ×6, MS Forms ×2, Smartsheet, Ariba, Metacontratas (SSO), Drive, SINIR.

### O que foi construído
- **`portal-report`** (commit `bd2cb2e`): relatório de pendências cruzando censos × Briefing × base HSE; e-mail pra EHS (fila de ação + Excel) e pra coordenação (prontidão por projeto).
- **`portal-coverage`** (`09c5406`): mapeia toda plataforma da planilha de credenciais EHS e sua cobertura.
- **`SmartsheetCredentialVault`**: lê os logins da planilha em runtime (segredos só em memória; `clientCode` vem do subdomínio).
- **Extractors** (cada um com o *parser* isolado como módulo puro testado; navegação Playwright marcada *verify-live*):
  - **Veriduss** (`7eda6ca`): REST — o único alvo JSON. Confiável.
  - **eGestiona** (`18207ac`): grid de semáforos DPR/DPE/ativo → docs reais (grosso). DPE vermelho = bloqueio de acesso ao parque.
  - **TDoc** (`ec235bc`, `18207ac`): JSF tarefas→trabalhadores→docs via Keycloak. O mais difícil (stateful).
  - **Surisoft** (`ea31447`): lê o token de cada trabalhador no botão `exibirRequisitosColaborador`, POST na API interna `/consultas/colaborador_requisitos_list` → JSON. Confiável (44 trabalhadores).
- **`PortalLoginHarness`** (login por config), **`PortalSessionStore`** (saúde de sessão, sem rede). CLIs: `portal-login`, `portal-sessions`, `veriduss-extract`, `egestiona-extract`, `tdoc-extract`, `surisoft-extract`. Sessões em `scratch/portais/sessions` (gitignored).
- **415 testes verdes.** Camada confiável hoje: Veriduss (REST), Surisoft (DOM token + API interna), eGestiona (grid).

### Achados em execução real (27/10)
- Playwright chromium precisava `pnpm exec playwright install chromium`.
- **eGestiona Vestas Latam:** senha expirada no portal (lado planilha — gestão renova).
- **TDoc SGRE:** login + tarefas + colaboradores funcionam, mas o JSF (tdoc 8.3.69) guarda a última tarefa/trabalhador aberta **por conta** na sessão do servidor e retoma nela — as execuções caem no meio de um trabalhador, a lista some e a navegação volta. Precisa de uma passada interativa focada (provável reset "Voltar"-out). Os CLIs agora **recusam sobrescrever um censo com scrape vazio** (antes clobbava o bom dado do Gemini).

### Pendências dos portais (retomar depois)
- Rodar `veriduss-extract` contra sessão real pra substituir o censo Gemini; verificar seletores Tier-3 ao vivo.
- Próximo build: módulo de token do TDoc (reusa Keycloak dos 3 portais), depois ampliar o registro do harness.
- Recipients `PORTAL_OPS_EMAIL_TO`; cron na VPS.
- Vestas Latam / censos do Gemini parecem montados à mão — re-extrair antes de confiar.
- Gemini embutiu um token Smartsheet hardcoded em `smartsheet-provider.ts` → parado em `scratch/gemini-portais/`, não commitado. Censos crus têm CPF e são gitignored.

---

## Parte 2 — Documentação / SSOT (Drive × Dashboard)

### O problema
O dashboard (auditoria Drive × RPO) lê 4 pastas no **My Drive** do João (01 Inspetores, 02 Líderes & EHS, 03 Drone, 04 LPS-SPDA). Descobriu-se uma **segunda fonte**: o **drive compartilhado "TREINAMENTOS"** (`13GqNi1s8mqzt24JwlIN-bz5tp_U95VX2`), onde a equipe realmente atualiza os documentos. O My Drive era um subconjunto → o dashboard apontava **falso "faltando"** e **falso "vencido"**. SSOT quebrado.

### Decisões do João
- Direção: copiar **2ª fonte → My Drive SSOT** (não mexer no drive da equipe). Vira sync recorrente.
- Escopo fase 1: preencher faltantes **+** atualizar os mais novos (original velho → `00.Obsoletos`) **+** trazer os colaboradores que só existem na 2ª fonte.
- **Padrão de data:** a data no nome é sempre o **início/emissão**, nunca o vencimento (exceção: contratos 40/40.1).
- Nada é apagado; tudo reversível (undo log).

### Fase 1 — reconciliação (commits `6c23cec`, `a4a3f1d`, `577454c`)
`DriveSourceReconciler` (puro, testado) + `DriveTreeScanner` + CLI `drive-reconcile`. Executado e revisado em etapas:
- **COPY_MISSING:** 174 cópias.
- **NEW_COLLAB:** 119 arquivos (9 colaboradores novos, ramo 01).
- **UPDATE_NEWER:** 465 versões novas (original → Obsoletos) + 7 com data futura (typo) separados pra revisão manual.
- Bug corrigido: o *supersede* removia o pai errado (docs em subpastas); correção = buscar os pais reais. Remediação idempotente via `runDriveObsoleteStragglers`.

### Fase 2 e itens de limpeza (29/10)
- **Cache de conteúdo** (`4d27292`, `1897caf`): `buildContentCacheForFiles` extraiu os 507 UNCLASSIFIED (pdf-parse + OCR + inspector) → `data/pdf_content_cache.json`.
- **Item 1 — treinamentos recuperados** (`8eaa338`): relatório com guarda de falso-positivo (nome específico vence match de conteúdo); 18 ações de confiança ALTA executadas (8 cópias + 10 updates); 9 BAIXA no Excel amarelo pra revisão manual.
- **SEM_DATA** (`fe33d66`): 145 nomes corrigidos (61 data real do cache, 84 token removido em códigos permanentes; guarda do proxy de 2076).
- **Item 2 — split pessoal × treinamento** (`0f78a6d`): `drive-split-pessoal` classifica cada arquivo e move os documentos pessoais mal-arquivados pra "01. Documentos Pessoais" (cria quando falta). **724 movidos, 17 pastas criadas, 0 erros.** Decisão do João: ASO(01) = pessoal; Ordem de Serviço(02) e Ficha de EPI(06) ficam.
- **Item 3 — placeholders "Doc 04.1"** (`e84e012`): 52 renomeados pra "Contrato de Trabalho CLT" **mantendo o código inicial** (ele é load-bearing — o audit extrai o código do nome e remapeia 04.1→40.1).
- **Item 4 — 7 datas futuras:** avaliados um a um; **todos mantidos como SSOT** (datas do src2 são typos impossíveis ou irrelevantes; sobrescrever só introduziria erro). Sem escrita.
- **Item 5 — sem data no nome** (`1e986cd`): `drive-undated-report` separou 630 sem data em correto-sem-data (permanente/pessoal: 344 + civis sem código: 207) e faltando-data. Extraído conteúdo de 85 (52 ganharam data) e **46 preenchidos** com data real. 33 restantes pra revisão manual.

### Validação (auditoria Drive × RPO, ref 29/10)
1511 combinações, 481 divergências: **DRIVE_SEM_DATA caiu pra 4** (era o problema central), falso-faltando (SOMENTE_RPO 85) despencou (era 128 só no ramo 01 antes). Rodar a auditoria **antes e depois** da fase 2 deu números **idênticos** → a movimentação para "Documentos Pessoais" **não criou faltantes** (o scanner é recursivo).

### Deploy do dashboard (Vercel)
- O dashboard é regenerado pelo workflow **`update_dashboard_daily.yml`** (GitHub Actions), que roda **na `main`**, lê o Drive ao vivo, gera `public/index.html` + `data/` e dá `push origin HEAD:main` → **a Vercel publica**. O runtime do dashboard já estava na main; os CLIs de manutenção criados aqui **não** são necessários pra ele.
- Em 29/10 o workflow foi disparado (`gh workflow run update_dashboard_daily.yml`, sem e-mail), concluiu com sucesso e publicou o commit de dados `3dbdc18` na main → dashboard atualizado refletindo o Drive limpo.
- **Confirmado:** o scanner (`GoogleDriveOAuthAdapter.scanFolderRecursive`) desce em todas as subpastas menos `obsolet`/`^00.`/`outros` — **lê a "01. Documentos Pessoais"**, então os docs movidos continuam contabilizados.

---

## Ferramentas (CLIs) adicionadas nesta branch

| Script | Para quê |
|---|---|
| `drive-reconcile` | Cruza a 2ª fonte (drive TREINAMENTOS) com o SSOT; copia faltantes/mais-novos. Report-only por padrão; `--execute`. |
| `drive-split-pessoal` | Fase 2: classifica pessoal × treinamento e move pessoal mal-arquivado pra "Documentos Pessoais". |
| `drive-fix-doc041` | Corrige títulos placeholder "Doc 04.1" → "Contrato de Trabalho CLT" (mantendo o código). |
| `drive-undated-report` | Bucketiza arquivos sem data; alimenta extração e preenchimento. |
| (apoio) `buildContentCacheForFiles`, `runDriveFixSemData`, `runDriveObsoleteStragglers`, `runDriveRecoverTrainingReport` | Cache de conteúdo, correção de SEM_DATA, remediação de Obsoletos, recuperação de treinamentos. |
| `portal-report`, `portal-coverage`, `portal-login`, `portal-sessions`, `veriduss-extract`, `egestiona-extract`, `tdoc-extract`, `surisoft-extract` | Portais (ver Parte 1). |

Todas as escritas no Drive têm **undo log** em `scratch/drive_padronizacao_undo_log.json` (nada apagado; superados vão pra `00.Obsoletos`).

---

## Commits (branch `feat/portal-pendency-report`, acima da `main`)

**Portais:** `bd2cb2e`, `09c5406`, `7eda6ca`, `ec235bc`, `18207ac`, `d1b9d90`, `ea31447`.
**Documentação/SSOT:** `6c23cec`, `a4a3f1d`, `577454c`, `4d27292`, `fe33d66`, `8eaa338`, `1897caf`, `0f78a6d`, `e84e012`, `1e986cd`.

> A branch está muito à frente da main e **divergiu** dela (a main tem correções recentes que a branch não tem, e vice-versa). **Não mesclar a branch inteira na main** — causaria conflito nos `data/` e subiria os extratores de portais inacabados. Se quiser preservar os CLIs de manutenção na main, abrir um **PR limpo só com os arquivos de drive**.

---

## Pendências abertas / próximos passos

**Documentação (revisão manual, não automatizável com segurança):**
- 9 treinamentos recuperados de confiança BAIXA (`scratch/treinamentos_recuperados.xlsx`, linhas amarelas).
- 33 arquivos sem data (`scratch/item5_revisao_manual.json`): 28 sem data extraível, 5 com nome malformado (sem colaborador).

**Portais (retomar a seguir):**
- Verificar seletores Tier-3 ao vivo; módulo de token do TDoc; ampliar o harness.
- Senhas expiradas no portal (ex.: Vestas Latam) → gestão renova.
- `PORTAL_OPS_EMAIL_TO` e cron na VPS.

**Infra:**
- VPS Hostinger (Coolify) hospeda stock Hermes; o dashboard HSE é Vercel. Confirmar escopo antes de qualquer mudança em produção.
