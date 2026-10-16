import { DOC_CATALOG_MAP } from './ComplianceEngine.js'

export interface StandardizeOptions {
  code: string
  originalFilename?: string
  collaboratorName: string
  date?: Date | string | null
  aditivoDate?: Date | string | null
  isMerged?: boolean
  modality?: 'F' | 'Rec' | 'F+R' | 'AUTO'
  customQualifier?: string
}

const CANONICAL_DOC_NAMES: Record<string, string> = {
  '01': 'ASO',
  '02': 'Ordem de Serviço',
  '03': 'Ficha de Registro',
  '04': 'CTPS Digital',
  '05': 'Cartão de Vacina',
  '06': 'Ficha de EPI',
  '07': 'Seguro de Vida',
  '08': 'CNH',
  '09': 'Direção Defensiva',
  '10': 'NR-01 Integração',
  '11': 'NR-06 Uso EPI',
  '12': 'NR-10 Básico',
  '12.1': 'Carta NR-10',
  '13': 'NR-10 SEP',
  '14': 'NR-11 Uso de Talha',
  '15': 'NR-12 Segurança em Máquinas',
  '15.1': 'Carta NR-12',
  '16': 'GWO Primeiros Socorros',
  '17': 'GWO NR-17 Ergonomia',
  '18': 'NR-18 Integração de EHS',
  '19': 'GWO NR-23 Combate a Incêndio',
  '20': 'NR-33 Espaço Confinado',
  '20.1': 'Carta NR-33',
  '21': 'NR-35 Trabalho em Altura',
  '21.1': 'Carta NR-35',
  '22': 'LOTO',
  '23': 'CRT',
  '24': 'Diploma Técnico',
  '25': 'SIT (Vestas)',
  '26': 'ESO (Vestas)',
  '27': 'NR-07 Primeiros Socorros',
  '28': 'NR-33 Supervisor',
  '29': 'ATW Integração',
  '30': 'GWO WINDA',
  '31': 'Elevador (JASO)',
  '32': 'GWO ART',
  '34': 'CIPA (NR-05)',
  '40': 'Contrato de Prestação de Serviço',
  '40.1': 'Aditivo ao Contrato',
}

const COURSE_AND_CARTA_CODES = new Set([
  '09',
  '10',
  '11',
  '12',
  '12.1',
  '13',
  '14',
  '15',
  '15.1',
  '16',
  '17',
  '18',
  '19',
  '20',
  '20.1',
  '21',
  '21.1',
  '22',
  '25',
  '26',
  '27',
  '28',
  '29',
  '31',
  '32',
  '34',
])

export class DriveNomenclatureStandardizer {
  /**
   * Indica se o código corresponde a um Curso / Treinamento ou Carta de Anuência
   * que deve utilizar a data de início/realização/emissão no nome do arquivo (regra da Darliane).
   */
  static isCourseOrCartaCode(code: string): boolean {
    return COURSE_AND_CARTA_CODES.has(code.trim())
  }

  /**
   * Converte qualquer Date ou string ISO em DD.MM.AAAA
   */
  static formatDate(d?: Date | string | null): string {
    if (!d) return 'SEM_DATA'
    try {
      const dateObj = typeof d === 'string' ? new Date(d) : d
      if (isNaN(dateObj.getTime())) return 'SEM_DATA'
      const day = String(dateObj.getUTCDate()).padStart(2, '0')
      const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0')
      const year = dateObj.getUTCFullYear()
      return `${day}.${month}.${year}`
    } catch {
      return 'SEM_DATA'
    }
  }

  /**
   * Limpa o nome do colaborador (remove cargo, pontuação estranha e espaços duplos)
   */
  static cleanCollaboratorName(raw: string): string {
    if (!raw) return ''
    return raw
      .split(/[-–—_]/)[0]
      .trim()
      .replace(/\s+/g, ' ')
      .toUpperCase()
  }

  /**
   * Detecta se um arquivo representa Formação, Reciclagem ou Formação+Reciclagem
   */
  static detectModality(filename: string, textContent?: string): 'F' | 'Rec' | 'F+R' | null {
    const combined = `${filename} ${textContent || ''}`.toUpperCase()

    // 1. Caso F+R explícito no nome ou texto
    if (
      combined.includes('(F+R)') ||
      combined.includes('F+R') ||
      combined.includes('(F + R)') ||
      combined.includes('FORMAÇÃO + RECICLAGEM') ||
      combined.includes('FORMACAO + RECICLAGEM') ||
      combined.includes('FORMAÇÃO E RECICLAGEM')
    ) {
      return 'F+R'
    }

    // 2. Reciclagem explícita
    if (
      combined.includes('(REC)') ||
      combined.includes('RECICLAGEM') ||
      combined.includes('REFRESHER') ||
      combined.includes('PERIODICO') ||
      combined.includes('PERIÓDICO')
    ) {
      return 'Rec'
    }

    // 3. Formação / Capacitação inicial
    if (
      combined.includes('(F)') ||
      combined.includes('FORMAÇÃO') ||
      combined.includes('FORMACAO') ||
      combined.includes('CAPACITAÇÃO') ||
      combined.includes('CAPACITACAO') ||
      combined.includes('TREINAMENTO INICIAL')
    ) {
      return 'F'
    }

    return null
  }

  /**
   * Gera o nome padronizado oficial de acordo com a convenção da Arthwind
   */
  static buildStandardFilename(options: StandardizeOptions): string {
    const code = options.code.trim()
    const collab = this.cleanCollaboratorName(options.collaboratorName)

    // Se for Contrato (Doc 40) e houver data de fim do aditivo, a data do fim do aditivo tem precedência absoluta (pedido da Darliane)
    let targetDate = options.date
    if (code === '40' && options.aditivoDate) {
      targetDate = options.aditivoDate
    }

    const dateFormatted = this.formatDate(targetDate)

    // Base do nome do documento
    let docTitle = CANONICAL_DOC_NAMES[code] || DOC_CATALOG_MAP[code] || `Doc ${code}`
    docTitle = docTitle.split(' - ')[0].trim()

    // Trata qualificadores (ex: Supervisor, Vigia)
    const origUpper = (options.originalFilename || '').toUpperCase()
    let qualifier = options.customQualifier || ''
    if (!qualifier) {
      if (code === '20') {
        if (origUpper.includes('SUPERVISOR')) qualifier = 'Supervisor'
        else if (origUpper.includes('VIGIA')) qualifier = 'Vigia'
      }
    }

    // Modalidade: F, Rec ou F+R
    let modTag = ''
    if (options.isMerged || options.modality === 'F+R') {
      modTag = '(F+R)'
    } else if (options.modality === 'F') {
      modTag = '(F)'
    } else if (options.modality === 'Rec') {
      modTag = '(Rec)'
    } else if (options.modality === 'AUTO' || !options.modality) {
      const detected = this.detectModality(options.originalFilename || '')
      if (detected) modTag = `(${detected})`
    }

    // Caso especial para Contrato PJ + Aditivo (Doc 40)
    if (code === '40') {
      const hasAditivo =
        options.isMerged ||
        !!options.aditivoDate ||
        origUpper.includes('ADITIVO') ||
        origUpper.includes('04.1') ||
        origUpper.includes('40.1')
      if (hasAditivo) {
        docTitle = 'Contrato + Aditivo'
        modTag = '' // já está no título
      }
    }

    // Monta os componentes do nome
    const titleParts = [docTitle]
    if (qualifier) titleParts.push(qualifier)
    if (modTag) titleParts.push(modTag)

    const fullTitle = titleParts.join(' ').replace(/\s+/g, ' ').trim()

    // Formato Canônico: [Código] – [Título] – [Data] - [Nome do Colaborador].pdf
    return `${code} – ${fullTitle} – ${dateFormatted} - ${collab}.pdf`
  }
}
