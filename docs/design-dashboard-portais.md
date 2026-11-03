# Especificação de Design UI/UX — Dashboard de Portais de Clientes (HSE & Operações)

Este documento serve como guia completo de design de interface (wireframes, componentes, métricas e modelo de dados) para a criação e integração da aba **Portais de Clientes** no dashboard web da Arthwind publicado via Vercel.

---

## 1. Objetivos da Interface

1. **Visibilidade Operacional Instantânea**: Permitir que a Diretoria e as Coordenações de Operações e EHS identifiquem em menos de 5 segundos se há algum bloqueio de entrada de equipe nos parques eólicos.
2. **Centralização Multicliente**: Consolidar numa única tela os dados vindos de portais heterogêneos (*Suricatta/GE, eGestiona/Vestas, TDoc/Gamesa, Veriduss/Goldwind, Metacontratas, DGTSS/Invenergy*) e os canais de contingência manual (*SharePoint e E-mail*).
3. **Ponte com o Agente Hermes (Prometheus)**: Exibir o histórico de recusas documentais com o motivo apontado pela plataforma do cliente e o playbook de ação recomendado.
4. **Design System Arthwind**: Dark mode moderno, tipografia limpa (Inter / Segoe UI), badges de status de alta densidade informativa e total responsividade (Desktop e Mobile).

---

## 2. Arquitetura de Informação & Layout

```
+--------------------------------------------------------------------------------------------------+
| HEADER: [Logo Arthwind]  DASHBOARD HSE & PORTAIS   [Filtro Global: Data / Status]  [Última Sync] |
+--------------------------------------------------------------------------------------------------+
| NAV TABS:  [ 1. Panorama HSE Geral ]    |   [★ 2. Portais de Clientes ]   |   [ 3. Auditoria RPO ]|
+--------------------------------------------------------------------------------------------------+
| KPI CARDS:                                                                                       |
|  [ 30 Projetos Ativos ]  [ 73% Portais Auto ]  [ 161 Ações Alocadas ]  [ 12 Bloqueios Críticos ] |
+--------------------------------------------------------------------------------------------------+
| BARRA DE CONTROLE & FILTROS:                                                                     |
|  [🔍 Buscar Colaborador/Projeto] [Cliente ▼] [Status Portal ▼] [Tipo Canal ▼] [Exportar Excel]  |
+--------------------------------------------------------------------------------------------------+
| GRID PRINCIPAL (2 COLUNAS OU TABS SECUNDÁRIAS):                                                  |
|                                                                                                  |
| [ COLUNA ESQUERDA: Status por Projeto/Parque ]      [ COLUNA DIREITA: Detalhamento por Técnico ] |
|  - Complexo Campo Formoso (GE / Suricatta)           - Nome: João Silva | Função: Téc. Eólico    |
|    Status: 4/5 Liberados [1 Pendente]                  - Portal: Suricatta (GE Vernova)          |
|  - Complexo Folha Larga (Vestas / eGestiona)           - ASO: [Válido até 14/05/2027]            |
|    Status: 100% Liberado                               - GWO BST: [Vencido em 01/11 - RECUSADO]  |
|  - Parque Dom Inocêncio (SGRE / TDoc)                  - Motivo Cliente: "Falta carimbo médico"  |
|    Status: [2 Recusas Documentais]                     - Hermes Playbook: "Reemitir com CRM"    |
+--------------------------------------------------------------------------------------------------+
| SEÇÃO INFERIOR: CANAIS MANUAIS & GAPS (SharePoint / E-mail)                                      |
|  - Lista de projetos onde a liberação é via e-mail ou link restrito do cliente (NAWP Peru, etc.) |
+--------------------------------------------------------------------------------------------------+
```

---

## 3. Componentes & Indicadores-Chave (KPIs)

### 3.1. Cartões de Métricas (Header KPIs)
* **Projetos na Janela**: `30` (Projetos com mobilização nos próximos 15 dias).
* **Cobertura Automatizada**: `73%` (22 projetos monitorados diretamente via API/Scraper).
* **Colaboradores Alocados**: `161` ações de pessoas com escalas ativas.
* **Alertas de Ação Imediata**: `X` recusas ativas com necessidade de reenvio de documento.
* **Projetos em Canal Manual**: `8` projetos (SharePoint / E-mail).

### 3.2. Badges de Status Semânticos
* `[LIBERADO]` (Verde `#10b981`): Todos os documentos obrigatórios do projeto estão aprovados no portal do cliente.
* `[EM ANÁLISE]` (Azul `#3b82f6`): Documentos submetidos aguardando aprovação do EHS do cliente.
* `[PENDÊNCIA]` (Amarelo `#f59e0b`): Documento a vencer (< 15 dias) ou documento não anexado.
* `[RECUSADO]` (Vermelho `#ef4444`): Documento rejeitado pelo portal do cliente (gatilho do Hermes).
* `[CANAL MANUAL]` (Roxo `#8b5cf6`): Validação via SharePoint / E-mail sem API direta.

---

## 4. Estrutura dos Dados para o Frontend (JSON Schema)

Para que o HTML do dashboard consuma esses dados dinamicamente, a VPS gera um arquivo consolidado:

```json
{
  "updatedAt": "2026-11-03T08:00:00.000Z",
  "summary": {
    "totalProjects": 30,
    "automatedProjects": 22,
    "manualProjects": 8,
    "totalActions": 161,
    "criticalRejections": 3
  },
  "platforms": [
    {
      "id": "surisoft-ge",
      "name": "GE Vernova (Suricatta)",
      "type": "API",
      "status": "ONLINE",
      "collaboratorsCount": 44
    },
    {
      "id": "egestiona-vestas",
      "name": "Vestas LatAm (eGestiona)",
      "type": "SCRAPER",
      "status": "ONLINE",
      "collaboratorsCount": 22
    }
  ],
  "projects": [
    {
      "projectName": "Complexo Eólico Campo Formoso",
      "client": "GE Vernova",
      "platform": "Suricatta",
      "channelType": "AUTOMATED",
      "startDate": "2026-11-05",
      "status": "ATTENTION",
      "collaborators": [
        {
          "name": "PEDRO SILVA",
          "cpf": "***.456.789-**",
          "role": "Técnico de Manutenção",
          "overallStatus": "BLOCKED",
          "documents": [
            {
              "docName": "ASO Admissional / Periódico",
              "status": "APPROVED",
              "expiryDate": "2027-04-12"
            },
            {
              "docName": "GWO Working at Heights",
              "status": "REJECTED",
              "rejectionReason": "Certificado sem assinatura digital verificável ou ilegível",
              "hermesPlaybook": "Coletar segunda via no portal da Storz LMS e carimbar com hash de autenticação."
            }
          ]
        }
      ]
    }
  ],
  "manualGaps": [
    {
      "projectName": "Parque Eólico Wayra II",
      "client": "NAWP Peru",
      "channel": "SharePoint Interno",
      "allocatedCount": 4,
      "focalPoint": "massude.afonso@arthwind.com.br"
    }
  ]
}
```

---

## 5. Funcionalidades de Interação (UX)

1. **Filtros Rápidos em 1 Clique**:
   * *Ver apenas Bloqueados / Recusados* (Filtro de incêndio para o início do turno).
   * *Filtrar por Cliente* (Vestas, GE, Gamesa, Goldwind, CPFL, Invenergy).
   * *Filtrar por Janela* (Mobilizações hoje, em 48h, em 7 dias).

2. **Gaveta Lateral de Detalhes (Drawer Modal)**:
   * Ao clicar em um técnico com documento recusado, abre uma gaveta à direita exibindo:
     * O histórico da recusa no portal.
     * O link direto para a pasta do colaborador no Google Drive da Arthwind para pegar o arquivo correto.
     * O plano de ação sugerido pelo Hermes.

3. **Exportação Rápida**:
   * Botão para download instantâneo do Excel gerado pelo cron (`pendencias-portais.xlsx`).
   * Botão para copiar texto resumido para WhatsApp da Coordenação de Campo.

---

## 6. Próximo Passo de Implementação no Código

1. O script de geração do dashboard (`src/domain/services/DashboardHtmlGenerator.ts`) pode incluir uma nova aba navegável (`#tab-portais`) ou ser gerado como `docs/portais.html`.
2. A estilização reutilizará o CSS já aprovado no `public/index.html` para manter 100% de consistência visual.
3. No cron `/usr/local/bin/hse-dashboard`, a compilação do dashboard incluirá a leitura de `data/portais/portal_coverage.json` e dos dados consolidados de recusas.
