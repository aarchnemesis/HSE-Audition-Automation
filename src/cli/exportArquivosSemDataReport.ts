import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'

interface SimulationItem {
  folderId: string
  collaborator: string
  fileId: string
  currentName: string
  code: string
  docTitle: string
  modality: string
  date: string
  proposedName: string
  action: string
}

interface ExecutionLogItem {
  fileId: string
  folderId: string
  collaborator: string
  originalName: string
  targetName: string
  action: string
  status: string
  timestamp: string
}

interface DocMetadataDefinition {
  category: string
  natureza: 'PERMANENTE / VITALÍCIO' | 'TREINAMENTO / CONTRATUAL'
  defaultDiagnostico: string
  defaultOrientacao: string
}

const DOC_METADATA_MAP: Record<string, DocMetadataDefinition> = {
  '05': {
    category: 'Documentação Pessoal e Saúde',
    natureza: 'PERMANENTE / VITALÍCIO',
    defaultDiagnostico:
      'Cartão de Vacina / SUS registra histórico de imunizações aplicadas. Não possui data de expiração/validade periódica na rotina de SSMA.',
    defaultOrientacao:
      'Nenhuma ação necessária. Documento permanente vitalício válido para fins de auditoria de campo.',
  },
  '23': {
    category: 'Habilitação Profissional',
    natureza: 'PERMANENTE / VITALÍCIO',
    defaultDiagnostico:
      'Registro no Conselho dos Técnicos Industriais (CRT/CFT). O cartão profissional comprova a habilitação técnica sem prazo de expiração impresso na carteira.',
    defaultOrientacao:
      'Nenhuma ação necessária. Caso o cliente solicite certidão de regularidade anual de quitação, emitir certidão de quitação avulsa.',
  },
  '24': {
    category: 'Formação Acadêmica',
    natureza: 'PERMANENTE / VITALÍCIO',
    defaultDiagnostico:
      'Diploma ou certificado de conclusão de curso técnico profissionalizante (Eletrotécnica, Mecânica, etc.). Documento acadêmico de validade perpétua.',
    defaultOrientacao:
      'Nenhuma ação necessária. Documento de validade definitiva e permanente.',
  },
  '03': {
    category: 'Documentação Cadastral / Societária',
    natureza: 'PERMANENTE / VITALÍCIO',
    defaultDiagnostico:
      'Comprovante cadastral (CCMEI, Cartão CNPJ, Consulta QSA ou Ficha de Registro de Empregado), emitido para comprovação societária/admissional sem termo final de vigência.',
    defaultOrientacao:
      'Nenhuma ação necessária. Atualizar apenas em caso de alteração no contrato social, quadro societário ou regime tributário.',
  },
  '04': {
    category: 'Documentação Trabalhista',
    natureza: 'PERMANENTE / VITALÍCIO',
    defaultDiagnostico:
      'CTPS Digital (Carteira de Trabalho e Previdência Social Digital) comprovando vínculo empregatício com a empresa prestadora.',
    defaultOrientacao:
      'Nenhuma ação necessária. Documento comprobatório de vínculo funcional permanente.',
  },
  '04.1': {
    category: 'Documentação Cadastral / Trabalhista',
    natureza: 'PERMANENTE / VITALÍCIO',
    defaultDiagnostico:
      'Comprovante avulso de recibo de evento de admissão/cadastro do colaborador no eSocial.',
    defaultOrientacao:
      'Nenhuma ação necessária. Documento comprobatório de registro inicial no eSocial.',
  },
  '30': {
    category: 'Identificação Global Eólica',
    natureza: 'PERMANENTE / VITALÍCIO',
    defaultDiagnostico:
      'Comprovante de identificação global GWO WINDA ID ou passaporte de fabricante (GE). Funciona como registro perpétuo de identificação na indústria eólica.',
    defaultOrientacao:
      'Nenhuma ação necessária. Os treinamentos específicos associados ao WINDA (BST/BTT) já possuem validades monitoradas em seus códigos individuais.',
  },
  '10': {
    category: 'Treinamento Obrigatório de Segurança',
    natureza: 'TREINAMENTO / CONTRATUAL',
    defaultDiagnostico:
      'Certificado de NR-01 (Integração EHS) sem data identificada no nome do arquivo original ou scan com baixa legibilidade OCR.',
    defaultOrientacao:
      'Caso o cliente ou a auditoria questione pontualmente, abrir o arquivo diretamente pelo link do Google Drive para conferir a data no certificado e renomear com a data correspondente.',
  },
  '07': {
    category: 'Apólice de Seguro de Vida',
    natureza: 'TREINAMENTO / CONTRATUAL',
    defaultDiagnostico:
      'Apólice ou comprovante de seguro de vida coletivo/individual com padrão de digitação de data não reconhecido ou ausente no nome original.',
    defaultOrientacao:
      'Caso a auditoria contratual solicite evidência de vigência, abrir pelo link direto do Drive, verificar o período de cobertura na apólice e atualizar a data se necessário.',
  },
  '31': {
    category: 'Treinamento Operacional Específico',
    natureza: 'TREINAMENTO / CONTRATUAL',
    defaultDiagnostico:
      'Certificado de treinamento operacional em elevador de cremalheira/toplift sem data explícita no nome do arquivo original.',
    defaultOrientacao:
      'Caso seja requerido para liberação de acesso ao parque, abrir pelo link direto do Drive, identificar a data de emissão e renomear pontualmente.',
  },
}

export interface MappedSemDataItem {
  seq: number
  collaborator: string
  code: string
  docTitle: string
  category: string
  natureza: 'PERMANENTE / VITALÍCIO' | 'TREINAMENTO / CONTRATUAL'
  currentName: string
  originalName: string
  diagnostico: string
  orientacao: string
  driveUrl: string
  folderUrl: string
  fileId: string
  folderId: string
  executionStatus: string
}

export function buildSemDataItems(
  simItems: SimulationItem[],
  execItems: ExecutionLogItem[]
): MappedSemDataItem[] {
  const execMap = new Map<string, ExecutionLogItem>()
  for (const item of execItems) {
    execMap.set(item.fileId, item)
  }

  const rawSemData = simItems.filter(
    x =>
      x.date === 'SEM_DATA' ||
      (x.proposedName && x.proposedName.includes('SEM_DATA'))
  )

  // Ordenar por: Natureza (Treinamentos/Contratuais primeiro para fácil visualização de ações pontuais), depois Código, depois Colaborador
  const sorted = [...rawSemData].sort((a, b) => {
    const natA = DOC_METADATA_MAP[a.code]?.natureza || 'PERMANENTE / VITALÍCIO'
    const natB = DOC_METADATA_MAP[b.code]?.natureza || 'PERMANENTE / VITALÍCIO'
    if (natA !== natB) {
      return natA === 'TREINAMENTO / CONTRATUAL' ? -1 : 1
    }
    const codeDiff = a.code.localeCompare(b.code, undefined, { numeric: true })
    if (codeDiff !== 0) return codeDiff
    return a.collaborator.localeCompare(b.collaborator)
  })

  return sorted.map((item, index) => {
    const meta = DOC_METADATA_MAP[item.code] || {
      category: 'Outros Documentos',
      natureza: 'PERMANENTE / VITALÍCIO' as const,
      defaultDiagnostico:
        'Documento sem data explícita identificada no arquivo.',
      defaultOrientacao: 'Consultar via link direto do Google Drive.',
    }

    const execLog = execMap.get(item.fileId)
    const currentName = execLog?.targetName || item.proposedName
    const originalName = execLog?.originalName || item.currentName

    let diagnostico = meta.defaultDiagnostico
    let orientacao = meta.defaultOrientacao

    // Casos específicos com diagnóstico enriquecido
    if (item.collaborator === 'THAYNA NOGUEIRA TAVARES' && item.code === '07') {
      diagnostico =
        'Apólice com data original digitada sem ponto ("0612.2026" em vez de "06.12.2026"). Vigência provável informada no arquivo original: 06.12.2026.'
      orientacao =
        'Caso solicitado pelo cliente/auditoria contratual, renomear pontualmente no Drive para "07 – Seguro de Vida – 06.12.2026 - THAYNA NOGUEIRA TAVARES.pdf".'
    } else if (
      item.collaborator === 'RAMON RAMIRES COSTA CIRINO' &&
      item.code === '07'
    ) {
      diagnostico =
        'Arquivo original "Seguro de vida Ramon.pdf" sem data no título original.'
      orientacao =
        'Abrir pelo link direto do Drive, verificar o período de vigência na apólice e atualizar a data se requerido.'
    } else if (
      item.collaborator === 'ALISSON MATEUS ALMEIDA DA COSTA' &&
      item.code === '10'
    ) {
      diagnostico =
        'Arquivo original "Francisco Fabircio - Nr1.zip" é um pacote compactado (.zip) contendo documentos de integração NR-01.'
      orientacao =
        'Abrir pelo link direto do Drive caso necessite descompactar ou extrair o certificado em PDF individual.'
    } else if (
      item.collaborator === 'WERMESON DE OLIVEIRA FRANCO' &&
      item.code === '10'
    ) {
      diagnostico =
        'Arquivo digitalizado de NR-01 ("NR_1___DISPOSICOES_GERAIS...") sem data no título e sem data legível via OCR.'
      orientacao =
        'Abrir pelo link direto do Drive para checar a data de conclusão visualmente caso a auditoria exija.'
    } else if (
      item.collaborator === 'WERMESON DE OLIVEIRA FRANCO' &&
      item.code === '31'
    ) {
      diagnostico =
        'Arquivo original "ELEVADOR TOPLIFT.pdf" sem data no título.'
      orientacao =
        'Abrir pelo link direto do Drive para checar a data de conclusão visualmente caso a auditoria exija.'
    } else if (
      item.collaborator === 'NARDEL DELON NOVAIS ROCHA' &&
      item.code === '10'
    ) {
      diagnostico =
        'Arquivo original "NR01 - integração Delon.pdf" sem data no título.'
      orientacao =
        'Abrir pelo link direto do Drive para checar a data de conclusão visualmente caso a auditoria exija.'
    } else if (
      item.collaborator === 'THIAGO LIMA SANTOS SILVA' &&
      item.code === '10'
    ) {
      diagnostico =
        'Certificado digital com codificação especial de caracteres ("THIAGO LIMA SANTOS SILVA_NR1 - Disposi+º+Áes Gerais...") sem data no título.'
      orientacao =
        'Abrir pelo link direto do Drive para checar a data de conclusão visualmente caso a auditoria exija.'
    }

    return {
      seq: index + 1,
      collaborator: item.collaborator,
      code: item.code,
      docTitle: item.docTitle,
      category: meta.category,
      natureza: meta.natureza,
      currentName,
      originalName,
      diagnostico,
      orientacao,
      driveUrl: `https://drive.google.com/file/d/${item.fileId}/view`,
      folderUrl: `https://drive.google.com/drive/folders/${item.folderId}`,
      fileId: item.fileId,
      folderId: item.folderId,
      executionStatus: execLog?.status || 'SUCESSO',
    }
  })
}

export function buildExcelReport(
  mappedItems: MappedSemDataItem[],
  outputPath: string
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Arthwind Automation System'
  wb.lastModifiedBy = 'Pedro Oliveira'
  wb.created = new Date()
  wb.modified = new Date()

  // -------------------------------------------------------------
  // ABA 1: Visão Executiva & Categorias
  // -------------------------------------------------------------
  const wsResumo = wb.addWorksheet('Resumo Executivo & Categorias', {
    views: [{ showGridLines: true }],
  })

  // Largura das colunas do resumo
  wsResumo.columns = [
    { key: 'colA', width: 8 },
    { key: 'colB', width: 32 },
    { key: 'colC', width: 32 },
    { key: 'colD', width: 28 },
    { key: 'colE', width: 14 },
    { key: 'colF', width: 12 },
    { key: 'colG', width: 50 },
    { key: 'colH', width: 55 },
  ]

  // Banner Superior
  wsResumo.mergeCells('A2:H2')
  const bannerCell = wsResumo.getCell('A2')
  bannerCell.value =
    'ARTHWIND SERVICES & CONSULTING - GESTÃO DE DOCUMENTOS E AUDITORIA HSE'
  bannerCell.font = {
    name: 'Segoe UI',
    size: 14,
    bold: true,
    color: { argb: 'FFFFFF' },
  }
  bannerCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '1B365D' }, // Navy corporativo
  }
  bannerCell.alignment = { vertical: 'middle', horizontal: 'center' }
  wsResumo.getRow(2).height = 36

  wsResumo.mergeCells('A3:H3')
  const subBanner = wsResumo.getCell('A3')
  subBanner.value =
    'MAPEAMENTO DE ARQUIVOS COM NOMENCLATURA "SEM_DATA" NO GOOGLE DRIVE'
  subBanner.font = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: 'FFFFFF' },
  }
  subBanner.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '25386B' },
  }
  subBanner.alignment = { vertical: 'middle', horizontal: 'center' }
  wsResumo.getRow(3).height = 24

  wsResumo.mergeCells('A4:H4')
  const descCell = wsResumo.getCell('A4')
  descCell.value =
    'Mapeamento consolidado das 99 pastas de colaboradores. Permite consulta ágil e intervenção pontual caso solicitada pela auditoria.'
  descCell.font = {
    name: 'Segoe UI',
    size: 10,
    italic: true,
    color: { argb: '475569' },
  }
  descCell.alignment = { vertical: 'middle', horizontal: 'center' }
  wsResumo.getRow(4).height = 20

  // Cards de Métricas (KPIs)
  const totalCount = mappedItems.length
  const permCount = mappedItems.filter(
    x => x.natureza === 'PERMANENTE / VITALÍCIO'
  ).length
  const actionCount = mappedItems.filter(
    x => x.natureza === 'TREINAMENTO / CONTRATUAL'
  ).length
  const distinctCollabs = new Set(mappedItems.map(x => x.collaborator)).size

  // Row 6 e 7: Cards
  wsResumo.mergeCells('A6:B6')
  wsResumo.mergeCells('A7:B7')
  wsResumo.getCell('A6').value = 'TOTAL ARQUIVOS SEM_DATA'
  wsResumo.getCell('A6').font = {
    size: 9,
    bold: true,
    color: { argb: '64748B' },
  }
  wsResumo.getCell('A6').alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }
  wsResumo.getCell('A7').value = totalCount
  wsResumo.getCell('A7').font = {
    size: 18,
    bold: true,
    color: { argb: '1E293B' },
  }
  wsResumo.getCell('A7').alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }
  wsResumo.getCell('A6').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'F1F5F9' },
  }
  wsResumo.getCell('A7').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'F1F5F9' },
  }

  wsResumo.mergeCells('C6:D6')
  wsResumo.mergeCells('C7:D7')
  wsResumo.getCell('C6').value = 'DOCUMENTOS PERMANENTES / VITALÍCIOS'
  wsResumo.getCell('C6').font = {
    size: 9,
    bold: true,
    color: { argb: '065F46' },
  }
  wsResumo.getCell('C6').alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }
  wsResumo.getCell('C7').value =
    `${permCount} (${((permCount / totalCount) * 100).toFixed(1)}%)`
  wsResumo.getCell('C7').font = {
    size: 18,
    bold: true,
    color: { argb: '047857' },
  }
  wsResumo.getCell('C7').alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }
  wsResumo.getCell('C6').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'ECFDF5' },
  }
  wsResumo.getCell('C7').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'ECFDF5' },
  }

  wsResumo.mergeCells('E6:F6')
  wsResumo.mergeCells('E7:F7')
  wsResumo.getCell('E6').value = 'AJUSTES PONTUAIS (SE EXIGIDO)'
  wsResumo.getCell('E6').font = {
    size: 9,
    bold: true,
    color: { argb: '92400E' },
  }
  wsResumo.getCell('E6').alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }
  wsResumo.getCell('E7').value =
    `${actionCount} (${((actionCount / totalCount) * 100).toFixed(1)}%)`
  wsResumo.getCell('E7').font = {
    size: 18,
    bold: true,
    color: { argb: 'B45309' },
  }
  wsResumo.getCell('E7').alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }
  wsResumo.getCell('E6').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FEF3C7' },
  }
  wsResumo.getCell('E7').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FEF3C7' },
  }

  wsResumo.mergeCells('G6:H6')
  wsResumo.mergeCells('G7:H7')
  wsResumo.getCell('G6').value = 'COLABORADORES IMPACTADOS'
  wsResumo.getCell('G6').font = {
    size: 9,
    bold: true,
    color: { argb: '1E40AF' },
  }
  wsResumo.getCell('G6').alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }
  wsResumo.getCell('G7').value = `${distinctCollabs} de 99`
  wsResumo.getCell('G7').font = {
    size: 18,
    bold: true,
    color: { argb: '1D4ED8' },
  }
  wsResumo.getCell('G7').alignment = {
    horizontal: 'center',
    vertical: 'middle',
  }
  wsResumo.getCell('G6').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'EFF6FF' },
  }
  wsResumo.getCell('G7').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'EFF6FF' },
  }

  wsResumo.getRow(6).height = 18
  wsResumo.getRow(7).height = 30

  // Tabela Consolidada por Código
  const tableHeaderRowIndex = 9
  const tableHeaderRow = wsResumo.getRow(tableHeaderRowIndex)
  tableHeaderRow.values = [
    'Cód.',
    'Documento',
    'Categoria Documental',
    'Natureza',
    'Qtd. Arquivos',
    '% Total',
    'Diagnóstico Técnico',
    'Diretriz Operacional / Ação da Gestão',
  ]
  tableHeaderRow.height = 28
  tableHeaderRow.font = {
    name: 'Segoe UI',
    size: 10,
    bold: true,
    color: { argb: 'FFFFFF' },
  }
  tableHeaderRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '25386B' },
  }
  tableHeaderRow.alignment = { vertical: 'middle', horizontal: 'center' }

  // Agrupamento por código
  const groupsByCode = new Map<
    string,
    {
      code: string
      docTitle: string
      category: string
      natureza: 'PERMANENTE / VITALÍCIO' | 'TREINAMENTO / CONTRATUAL'
      count: number
      diagnostico: string
      orientacao: string
    }
  >()

  for (const item of mappedItems) {
    if (!groupsByCode.has(item.code)) {
      const meta = DOC_METADATA_MAP[item.code]
      groupsByCode.set(item.code, {
        code: item.code,
        docTitle: item.docTitle,
        category: meta?.category || 'Outros',
        natureza: meta?.natureza || 'PERMANENTE / VITALÍCIO',
        count: 0,
        diagnostico: meta?.defaultDiagnostico || '',
        orientacao: meta?.defaultOrientacao || '',
      })
    }
    const g = groupsByCode.get(item.code)!
    g.count++
  }

  // Ordenar grupos: Treinamentos/Contratuais primeiro, depois por quantidade descrescente
  const sortedGroups = Array.from(groupsByCode.values()).sort((a, b) => {
    if (a.natureza !== b.natureza) {
      return a.natureza === 'TREINAMENTO / CONTRATUAL' ? -1 : 1
    }
    return b.count - a.count
  })

  let currentRowIdx = tableHeaderRowIndex + 1
  for (const g of sortedGroups) {
    const row = wsResumo.getRow(currentRowIdx)
    row.values = [
      g.code,
      g.docTitle,
      g.category,
      g.natureza,
      g.count,
      Number((g.count / totalCount).toFixed(4)),
      g.diagnostico,
      g.orientacao,
    ]
    row.height = 36
    row.font = { name: 'Segoe UI', size: 9 }

    // Alinhamentos
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' }
    row.getCell(6).numFmt = '0.0%'
    row.getCell(7).alignment = {
      horizontal: 'left',
      vertical: 'middle',
      wrapText: true,
    }
    row.getCell(8).alignment = {
      horizontal: 'left',
      vertical: 'middle',
      wrapText: true,
    }

    // Destaque de cor por natureza
    if (g.natureza === 'TREINAMENTO / CONTRATUAL') {
      row.getCell(4).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FEF3C7' },
      }
      row.getCell(4).font = {
        name: 'Segoe UI',
        size: 9,
        bold: true,
        color: { argb: '92400E' },
      }
    } else {
      row.getCell(4).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'ECFDF5' },
      }
      row.getCell(4).font = {
        name: 'Segoe UI',
        size: 9,
        bold: true,
        color: { argb: '065F46' },
      }
    }

    // Bordas finas
    for (let c = 1; c <= 8; c++) {
      row.getCell(c).border = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } },
      }
    }

    currentRowIdx++
  }

  // Linha Totalizadora
  const totalRow = wsResumo.getRow(currentRowIdx)
  totalRow.values = [
    'TOTAL',
    '',
    '',
    '',
    totalCount,
    1.0,
    'Total consolidado de arquivos indexados como SEM_DATA no Google Drive.',
    'Apenas 7 arquivos (4,7%) demandam verificação manual se requerido.',
  ]
  totalRow.height = 24
  totalRow.font = { name: 'Segoe UI', size: 10, bold: true }
  totalRow.alignment = { vertical: 'middle' }
  totalRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
  totalRow.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' }
  totalRow.getCell(6).alignment = { horizontal: 'right', vertical: 'middle' }
  totalRow.getCell(6).numFmt = '0.0%'
  for (let c = 1; c <= 8; c++) {
    totalRow.getCell(c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'F1F5F9' },
    }
    totalRow.getCell(c).border = {
      top: { style: 'medium', color: { argb: '94A3B8' } },
      bottom: { style: 'medium', color: { argb: '94A3B8' } },
    }
  }

  // Seção de Diretrizes Operacionais
  const notesStart = currentRowIdx + 2
  wsResumo.mergeCells(`A${notesStart}:H${notesStart}`)
  const notesHeader = wsResumo.getCell(`A${notesStart}`)
  notesHeader.value =
    'DIRETRIZES OPERACIONAIS PARA A EQUIPE (DARLIANE / RH / COORDENAÇÃO)'
  notesHeader.font = {
    name: 'Segoe UI',
    size: 11,
    bold: true,
    color: { argb: '1E293B' },
  }
  notesHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'E2E8F0' },
  }
  notesHeader.alignment = { vertical: 'middle', horizontal: 'left' }
  wsResumo.getRow(notesStart).height = 26

  const guidelines = [
    '1. DOCUMENTOS VITALÍCIOS (95,3% - 143 arquivos): Cartões de Vacina (05), Diplomas (24), CRT (23), Fichas Cadastrais/CCMEI (03), CTPS (04), eSocial (04.1) e WINDA ID (30) não possuem data de expiração/vencimento contratual nas auditorias de SSMA. A nomenclatura "SEM_DATA" é tecnicamente correta e suficiente.',
    '2. DOCUMENTOS PASSÍVEIS DE AJUSTE PONTUAL (4,7% - 7 arquivos): Apenas 4 arquivos de NR-01 (10), 2 de Seguro de Vida (07) e 1 de Elevador Toplift (31) podem conter data de conclusão/vigência no corpo do documento.',
    '3. ATUAÇÃO SOB DEMANDA: Não é necessário realizar varreduras manuais no Drive. Caso alguma auditoria de cliente solicite especificamente um desses 7 documentos, basta acessar a Aba 2 deste relatório, filtrar o colaborador e clicar no link direto "Abrir Arquivo" para consultar ou renomear.',
  ]

  for (let i = 0; i < guidelines.length; i++) {
    const rowIdx = notesStart + 1 + i
    wsResumo.mergeCells(`A${rowIdx}:H${rowIdx}`)
    const cell = wsResumo.getCell(`A${rowIdx}`)
    cell.value = guidelines[i]
    cell.font = { name: 'Segoe UI', size: 9.5, color: { argb: '334155' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    wsResumo.getRow(rowIdx).height = 24
  }

  // -------------------------------------------------------------
  // ABA 2: Mapeamento Detalhado (150 Docs)
  // -------------------------------------------------------------
  const wsDetalhe = wb.addWorksheet('Arquivos SEM_DATA (Drive)', {
    views: [
      {
        state: 'frozen',
        xSplit: 2,
        ySplit: 1,
        showGridLines: true,
      },
    ],
  })

  wsDetalhe.columns = [
    { key: 'seq', width: 6 },
    { key: 'collaborator', width: 36 },
    { key: 'code', width: 8 },
    { key: 'docTitle', width: 24 },
    { key: 'natureza', width: 28 },
    { key: 'currentName', width: 48 },
    { key: 'originalName', width: 44 },
    { key: 'diagnostico', width: 46 },
    { key: 'orientacao', width: 48 },
    { key: 'driveLink', width: 16 },
    { key: 'folderLink', width: 16 },
    { key: 'fileId', width: 36 },
  ]

  const detHeader = wsDetalhe.getRow(1)
  detHeader.values = [
    '#',
    'Colaborador',
    'Cód.',
    'Documento',
    'Natureza Documental',
    'Nome Atual no Google Drive',
    'Nome Original Anterior',
    'Diagnóstico Técnico / Motivo',
    'Diretriz / Ação Recomendada',
    'Arquivo no Drive',
    'Pasta no Drive',
    'ID do Arquivo (Google Drive)',
  ]
  detHeader.height = 30
  detHeader.font = {
    name: 'Segoe UI',
    size: 10,
    bold: true,
    color: { argb: 'FFFFFF' },
  }
  detHeader.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '25386B' },
  }
  detHeader.alignment = { vertical: 'middle', horizontal: 'center' }

  mappedItems.forEach((item, index) => {
    const rowIdx = index + 2
    const row = wsDetalhe.getRow(rowIdx)

    row.values = [
      item.seq,
      item.collaborator,
      item.code,
      item.docTitle,
      item.natureza,
      item.currentName,
      item.originalName,
      item.diagnostico,
      item.orientacao,
      { text: 'Abrir Arquivo', hyperlink: item.driveUrl },
      { text: 'Abrir Pasta', hyperlink: item.folderUrl },
      item.fileId,
    ]
    row.height = 24
    row.font = { name: 'Segoe UI', size: 9 }

    // Alinhamentos
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(2).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(4).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(5).alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(6).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(7).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(8).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(9).alignment = { horizontal: 'left', vertical: 'middle' }
    row.getCell(10).alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(11).alignment = { horizontal: 'center', vertical: 'middle' }
    row.getCell(12).alignment = { horizontal: 'center', vertical: 'middle' }

    // Estilo dos hyperlinks
    row.getCell(10).font = {
      name: 'Segoe UI',
      size: 9,
      color: { argb: '1D4ED8' },
      underline: true,
      bold: true,
    }
    row.getCell(11).font = {
      name: 'Segoe UI',
      size: 9,
      color: { argb: '1D4ED8' },
      underline: true,
      bold: true,
    }

    // Cores sutis para Natureza Documental
    if (item.natureza === 'TREINAMENTO / CONTRATUAL') {
      row.getCell(5).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FEF3C7' },
      }
      row.getCell(5).font = {
        name: 'Segoe UI',
        size: 9,
        bold: true,
        color: { argb: '92400E' },
      }
    } else {
      row.getCell(5).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'ECFDF5' },
      }
      row.getCell(5).font = {
        name: 'Segoe UI',
        size: 9,
        bold: true,
        color: { argb: '065F46' },
      }
    }

    // Zebrado suave nas outras células
    if (index % 2 === 1) {
      for (const colIdx of [1, 2, 3, 4, 6, 7, 8, 9, 12]) {
        row.getCell(colIdx).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F8FAFC' },
        }
      }
    }

    // Bordas finas
    for (let c = 1; c <= 12; c++) {
      row.getCell(c).border = {
        top: { style: 'thin', color: { argb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
        left: { style: 'thin', color: { argb: 'E2E8F0' } },
        right: { style: 'thin', color: { argb: 'E2E8F0' } },
      }
    }
  })

  // Ativar autofiltro na tabela inteira
  wsDetalhe.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: mappedItems.length + 1, column: 12 },
  }

  return wb.xlsx.writeFile(outputPath)
}

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   MAPEAMENTO DE ARQUIVOS COM NOMENCLATURA SEM_DATA NO GOOGLE DRIVE'
  )
  console.log(
    '================================================================================\n'
  )

  const simPath = path.join(
    process.cwd(),
    'scratch',
    'simulacao_padronizacao_drive.json'
  )
  const execPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_execution_log.json'
  )

  if (!fs.existsSync(simPath)) {
    throw new Error(`Arquivo de simulacao nao encontrado: ${simPath}`)
  }
  if (!fs.existsSync(execPath)) {
    throw new Error(`Arquivo de log de execucao nao encontrado: ${execPath}`)
  }

  const simItems: SimulationItem[] = JSON.parse(
    fs.readFileSync(simPath, 'utf8')
  )
  const execItems: ExecutionLogItem[] = JSON.parse(
    fs.readFileSync(execPath, 'utf8')
  )

  console.log(`[SemDataExporter] Itens da simulacao: ${simItems.length}`)
  console.log(
    `[SemDataExporter] Operacoes executadas no Drive: ${execItems.length}`
  )

  const mappedItems = buildSemDataItems(simItems, execItems)
  console.log(
    `[SemDataExporter] Total de arquivos SEM_DATA mapeados: ${mappedItems.length}`
  )

  const permCount = mappedItems.filter(
    x => x.natureza === 'PERMANENTE / VITALÍCIO'
  ).length
  const actionCount = mappedItems.filter(
    x => x.natureza === 'TREINAMENTO / CONTRATUAL'
  ).length
  const distinctCollabs = new Set(mappedItems.map(x => x.collaborator)).size

  console.log(` - Documentos Permanentes / Vitalícios: ${permCount}`)
  console.log(` - Documentos Passíveis de Ajuste Pontual: ${actionCount}`)
  console.log(` - Colaboradores com arquivos SEM_DATA: ${distinctCollabs}`)

  // 1. Exportar JSON consolidado
  const jsonOutputPath = path.join(
    process.cwd(),
    'scratch',
    'arquivos_sem_data_drive.json'
  )
  const jsonReport = {
    generatedAt: new Date().toISOString(),
    totalFiles: mappedItems.length,
    permanentCount: permCount,
    actionableCount: actionCount,
    distinctCollaborators: distinctCollabs,
    items: mappedItems,
  }
  fs.writeFileSync(jsonOutputPath, JSON.stringify(jsonReport, null, 2), 'utf8')
  console.log(`\n[SemDataExporter] Base JSON gerada em: ${jsonOutputPath}`)

  // 2. Exportar Planilha Excel Executiva
  const excelOutputPath = path.join(
    process.cwd(),
    'scratch',
    'arquivos_sem_data_drive.xlsx'
  )
  await buildExcelReport(mappedItems, excelOutputPath)
  console.log(`[SemDataExporter] Planilha Excel gerada em: ${excelOutputPath}`)

  console.log(
    '\n================================================================================'
  )
  console.log('   MAPEAMENTO CONCLUÍDO COM SUCESSO!')
  console.log(
    '================================================================================'
  )
}

// Executar CLI se chamado diretamente
if (
  process.argv[1] &&
  (process.argv[1].endsWith('exportArquivosSemDataReport.ts') ||
    process.argv[1].endsWith('exportArquivosSemDataReport.js'))
) {
  main().catch(err => {
    console.error('[SemDataExporter] Erro fatal:', err)
    process.exit(1)
  })
}
