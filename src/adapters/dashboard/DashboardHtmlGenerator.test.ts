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
    expect(html).toContain('Colaboradores em Alerta')
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

  it('deve conter suporte ao colapso total da barra lateral e modo de impressao', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain('sidebar-fully-hidden')
    expect(html).toContain('toggleSidebarFull()')
    expect(html).toContain('id="btnSidebarRestore"')
    expect(html).toContain('@media print')
    expect(html).toContain('printCockpit()')
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
})
