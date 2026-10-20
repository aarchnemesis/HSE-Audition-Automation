import { describe, expect, it } from 'vitest'
import { HSEDatabaseRecord } from '../../domain/services/HSEDatabaseRepository.js'
import { buildDashboardHtml } from './DashboardHtmlGenerator.js'

describe('DashboardHtmlGenerator', () => {
  const sampleRecords: HSEDatabaseRecord[] = [
    {
      inspectorId: 'COL-001',
      inspectorName: 'Carlos Silva',
      role: 'Inspetor de Qualidade',
      sector: 'Operações',
      docCode: '01',
      docName: 'ASO',
      statusEHS: 'VENCIDO',
      detail: 'Vencido em 10/08/2026',
      modality: 'PRESENCIAL',
      lastUpdated: '2026-09-17T00:00:00.000Z',
    },
    {
      inspectorId: 'COL-001',
      inspectorName: 'Carlos Silva',
      role: 'Inspetor de Qualidade',
      sector: 'Operações',
      docCode: '08',
      docName: 'CNH',
      statusEHS: 'VENCIDO',
      detail: 'Vencido em 01/09/2026',
      modality: 'PRESENCIAL',
      lastUpdated: '2026-09-17T00:00:00.000Z',
    },
    {
      inspectorId: 'COL-001',
      inspectorName: 'Carlos Silva',
      role: 'Inspetor de Qualidade',
      sector: 'Operações',
      docCode: '10',
      docName: 'NR-01 Integração',
      statusEHS: 'CONFORME',
      detail: 'Válido até 10/10/2027',
      modality: 'ONLINE',
      lastUpdated: '2026-09-17T00:00:00.000Z',
    },
    {
      inspectorId: 'COL-001',
      inspectorName: 'Carlos Silva',
      role: 'Inspetor de Qualidade',
      sector: 'Operações',
      docCode: '12',
      docName: 'NR-10 Básico',
      statusEHS: 'CONFORME',
      detail: 'Válido até 15/12/2027',
      modality: 'ONLINE',
      lastUpdated: '2026-09-17T00:00:00.000Z',
    },
    {
      inspectorId: 'COL-002',
      inspectorName: 'Mariana Souza',
      role: 'Técnica de Operações',
      sector: 'Operações',
      docCode: '12',
      docName: 'NR-10 Básico',
      statusEHS: 'VENCIDO',
      detail: 'Vencido em 10/09/2026',
      modality: 'ONLINE',
      lastUpdated: '2026-09-17T00:00:00.000Z',
    },
  ]

  it('deve gerar o HTML contendo a visualizacao #view-cockpit', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('id="view-cockpit"')
    expect(html).toContain('Cockpit Operacional')
  })

  it('deve incluir o card de KPI executivo e escopo operacional', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('id="cockpitKpiTotal"')
    expect(html).toContain('Colaboradores Ativos')
    expect(html).toContain('Colaboradores Aptos')
    expect(html).toContain('Aptos que vencem em at&eacute; 30 d')
    expect(html).toContain('Colaboradores Bloqueados')
    expect(html).toContain('Colaboradores em Treinamento')
    expect(html).toContain('Linha de frente')
    expect(html).toContain('id="cockpitKpiApto"')
    expect(html).toContain('id="cockpitKpiAlerta"')
    expect(html).toContain('id="cockpitKpiBloqueado"')
    expect(html).toContain('id="cockpitKpiStorz"')
    expect(html).toContain('id="cockpitScopeDesc"')
    expect(html).toContain('ASO (01), GWO BST e NRs regulamentares')
  })

  it('deve conter seletores de segmento de equipe e exigencia de parque', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('id="cockpitSeg-FRONTLINE"')
    expect(html).toContain('id="cockpitSeg-LEADERS"')
    expect(html).toContain('id="cockpitSeg-OFFICE"')
    expect(html).toContain('id="cockpitPark-BASIC"')
    expect(html).toContain('id="cockpitPark-ART"')
    expect(html).toContain('id="cockpitPark-NR33_RESGATE"')
  })

  it('deve conter a logica de saude operacional com suporte a segmentacao e parque', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('function getCollabOperationalHealth')
    expect(html).toContain('function renderCockpit')
    expect(html).toContain('cockpitSegment')
    expect(html).toContain('cockpitParkScope')
    expect(html).toContain('ISENTO_CAMPO')
  })

  it('deve usar navegacao unica na barra superior, sem barra lateral, e manter o modo de impressao', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).not.toContain('class="sidebar"')
    expect(html).not.toContain('toggleSidebar')
    expect(html).toContain('aria-label="Navegação principal"')
    expect(html).toContain("switchNav('rpo')")
    expect(html).toContain('id="freshnessBar"')
    expect(html).toContain('@media print')
    expect(html).toContain('printCockpit()')
  })

  it('deve incluir a paleta de comandos com atalho Ctrl K para telas e colaboradores', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('id="cmdk"')
    expect(html).toContain('openCmdk()')
    expect(html).toContain('function cmdkBuild')
    expect(html).toContain('openCollabModal(p.name)')
  })

  it('keeps people with a future expiry as fit for the field and shows days on the cards', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('Seguem aptos para campo')
    expect(html).toContain('com vencimento em até 30 d')
    expect(html).toContain('function overdueLabel')
    expect(html).toContain('function cockpitUrgency')
    expect(html).toContain(
      "const isMobilizavel = (status === 'APTO' || status === 'ALERTA');"
    )
  })

  it('flags RPO divergences that flip a document between valid and expired', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('function rpoFlipsStatus')
    expect(html).toContain('id="rpoChip-IMPACT"')
    expect(html).toContain("let rpoSubTab = 'IMPACT'")
    expect(html).toContain("let rpoSortCol = 'DIFF'")
  })

  it('renders the expiry agenda, the compliance trend and Drive evidence links', () => {
    const html = buildDashboardHtml(sampleRecords, {
      complianceHistory: [
        {
          date: '2026-10-18',
          documents: 10,
          onTime: 8,
          expiringSoon: 1,
          expired: 1,
          missing: 0,
        },
        {
          date: '2026-10-19',
          documents: 10,
          onTime: 9,
          expiringSoon: 0,
          expired: 1,
          missing: 0,
        },
      ],
    })
    expect(html).toContain('id="agendaList"')
    expect(html).toContain('id="trendBox"')
    expect(html).toContain('function renderAgenda')
    expect(html).toContain('function renderTrend')
    expect(html).toContain('"onTime":9')
    expect(html).toContain('function evidenceLink')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('deve inicializar com o Cockpit Operacional como tela ativa padrao', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain("switchNav('cockpit')")
    expect(html).toContain("let currentViewKey = 'cockpit'")
  })

  it('deve configurar scrollagem em tela e layout vertical de impressao para o Cockpit', () => {
    const html = buildDashboardHtml(sampleRecords)
    // Scroll em tela
    expect(html).toContain('#view-cockpit {')
    expect(html).toContain('overflow-y: auto')
    expect(html).toContain('#view-cockpit::-webkit-scrollbar')

    // Cabecalho executivo e rodape de impressao
    expect(html).toContain('class="cockpit-print-header"')
    expect(html).toContain('id="cockpitPrintSubtitle"')
    expect(html).toContain('id="cockpitPrintDate"')
    expect(html).toContain('class="cockpit-print-footer"')
    expect(html).toContain('id="cockpitPrintFooterMeta"')

    // Lista vertical e quebra de pagina protegida no print
    expect(html).toContain('.cockpit-grid {')
    expect(html).toContain('flex-direction: column !important')
    expect(html).toContain('page-break-inside: avoid !important')
    expect(html).toContain('break-inside: avoid !important')
    expect(html).toContain('.tab-view:not(.active)')
  })

  it('deve incluir ASO no cockpit apenas em caso de bloqueio (vencido/ausente) e nao em alerta (<=30d)', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain("if (code !== '01')")
    expect(html).toContain('alertItems.push(r)')
  })

  it('deve ordenar registros do prontuario do mais proximo de vencer ate o mais longe', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('<th>Validade</th>')
    expect(html).toContain('function getSortKey(r)')
    expect(html).toContain('const sortedRecords = [...p.records].sort')
  })

  it('deve conter suporte aos filtros e badges de validacao manual da RPO (Opcao B)', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('id="rpoChip-ACTIONABLE_DIV"')
    expect(html).toContain('id="rpoChip-PENDENTE_BACKUP"')
    expect(html).toContain('id="rpoKpiActionable"')
    expect(html).toContain('id="rpoKpiPendenteBackup"')
    expect(html).toContain('Pendente Backup Drive')
    expect(html).toContain('RPO Validado')
  })

  it('deve conter controles de filtros cascateaveis e ordenacao alfabetica na auditoria RPO', () => {
    const html = buildDashboardHtml(sampleRecords)
    // Filtros e seletores
    expect(html).toContain('id="rpoCollabFilter"')
    expect(html).toContain('id="rpoDocFilter"')
    expect(html).toContain('id="rpoSortFilter"')
    expect(html).toContain('id="btnResetRpoFilters"')
    expect(html).toContain('id="rpoCounterBadge"')

    // Cabecalhos ordenaveis interativos
    expect(html).toContain("toggleRpoSort('NAME')")
    expect(html).toContain("toggleRpoSort('DOC')")
    expect(html).toContain("toggleRpoSort('KIND')")
    expect(html).toContain("toggleRpoSort('TRUSTED_EXP')")
    expect(html).toContain("toggleRpoSort('RPO_EXP')")
    expect(html).toContain("toggleRpoSort('DIFF')")
    expect(html).toContain('id="rpoSortIcon-NAME"')

    // Logica JS de ordenacao e filtros cascateaveis
    expect(html).toContain('updateRpoFilterDropdownOptions')
    expect(html).toContain('onRpoCollabChange')
    expect(html).toContain('onRpoDocChange')
    expect(html).toContain('toggleRpoSort')
    expect(html).toContain('resetRpoFilters')
    // default order is by impact (largest gap first); alphabetical stays one click away
    expect(html).toContain("rpoSortCol = 'DIFF'")
    expect(html).toContain("rpoSortDir = 'DESC'")
    expect(html).toContain('<option value="NAME_ASC">')
    expect(html).toContain("localeCompare(b.inspectorName || '', 'pt-BR')")
  })

  it('deve conter a faixa de consequencia operacional, modulos de parque e unidades nos KPIs (refinamento visual)', () => {
    const html = buildDashboardHtml(sampleRecords)
    // Faixa de consequencia e modulos de parque
    expect(html).toContain('id="matrixConsequenceRow"')
    expect(html).toContain('Bloqueia mobilização')
    expect(html).toContain(
      'Não bloqueia &middot; restringe alocação por parque'
    )
    expect(html).toContain('Módulos de Parque')
    expect(html).toContain('group-parque')
    expect(html).toContain('consequence-header')

    // Unidades explicitas nos KPIs
    expect(html).toContain('Em Dia &middot; % dos docs')
    expect(html).toContain('A vencer (&le;60 d) &middot; docs')
    expect(html).toContain('Vencidos (Drive) &middot; docs')
    expect(html).toContain('Ausentes (sem Doc) &middot; docs')
    expect(html).toContain('Storz Ativas &middot; matrículas')
    expect(html).toContain('Colaboradores Ativos &middot; pessoas')
    expect(html).toContain('Colaboradores Aptos &middot; % das pessoas')

    // Cores WCAG de alto contraste
    expect(html).toContain('--status-crit: #DC2626;')
    expect(html).toContain('--brand-coral: #DC2626;')
  })
})
