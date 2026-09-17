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
    expect(html).toContain('id="cockpitKpiApto"')
    expect(html).toContain('id="cockpitKpiAlerta"')
    expect(html).toContain('id="cockpitKpiBloqueado"')
    expect(html).toContain('id="cockpitKpiStorz"')
    expect(html).toContain('ASO (01) e CNH (08) estão desconsiderados')
  })

  it('deve conter a logica de exclusao de ASO (01) e CNH (08) no script do Cockpit', () => {
    const html = buildDashboardHtml(sampleRecords)
    expect(html).toContain("r.docCode !== '01' && r.docCode !== '08'")
    expect(html).toContain('function getCollabOperationalHealth')
    expect(html).toContain('function renderCockpit')
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
})
