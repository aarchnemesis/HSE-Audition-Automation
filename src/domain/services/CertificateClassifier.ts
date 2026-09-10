import { DOC_CATALOG_MAP } from './ComplianceEngine.js'

export interface ClassificationResult {
  code: string | null
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
  source: 'SEMANTIC' | 'PREFIX' | 'NONE'
  matchedTerm?: string
}

/**
 * Remove acentos e converte para maiúsculas para comparação textual padronizada.
 */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/_/g, ' ')
}

/**
 * Verifica se uma string começa com formato de data (DMY ou ISO)
 */
export function startsWithDate(filename: string): boolean {
  const norm = normalizeText(filename).trim()
  const dmyMatch = norm.match(/^(\d{2})[\s\.\/-](\d{2})[\s\.\/-](\d{2,4})/)
  const isoMatch = norm.match(/^(\d{4})[\.\/-](\d{2})[\.\/-](\d{2})/)
  return Boolean(dmyMatch || isoMatch)
}

/**
 * Remove o prefixo de data do início do nome de um arquivo, se houver.
 */
export function stripDatePrefix(filename: string): string {
  return filename
    .replace(/^(\d{2,4})[\s\.\/_-](\d{2})[\s\.\/_-](\d{2,4})[\s_-]*/, '')
    .trim()
}

/**
 * Regras semânticas de alta prioridade baseadas em termos normativos.
 * A ordem de prioridade importa (termos mais específicos primeiro, ex.: NR10 SEP antes de NR10).
 */
const SEMANTIC_RULES: Array<{
  regex: RegExp
  code: string
  matchedTerm: string
}> = [
  // GWO ART (Advanced Rescue) - módulos Nacelle/Hub
  {
    regex:
      /\b(?:ART-?H|ART-?N|ART-?HR|ART-?NR|GWO\s+ART|ADVANCED\s+RESCUE|HUB[\s,]+SPINNER|NACELLE[\s,]+TORRE)\b/i,
    code: '32',
    matchedTerm: 'GWO ART',
  },
  // NR-10 SEP (Sistema Elétrico de Potência) - deve vir antes de NR-10 Básico
  {
    regex:
      /\b(?:NR\s*[-_]?\s*10\s*[-_]?\s*SEP|SEP\b|SISTEMA\s+ELETRICO\s+DE\s+POTENCIA|SISTORZA\s+ELETRICO\s+DE\s+POTENCIA)\b/i,
    code: '13',
    matchedTerm: 'NR-10 SEP',
  },
  // Carta NR-10
  {
    regex: /\bCARTA\s+(?:DE\s+)?(?:ANUENCIA\s+)?NR\s*[-_]?\s*10\b/i,
    code: '12.1',
    matchedTerm: 'Carta NR-10',
  },
  // NR-10 Básico
  {
    regex:
      /\b(?:NR\s*[-_]?\s*10\b|SEGURANCA\s+EM\s+INSTALACOES\s+(?:E\s+SERVICOS\s+EM\s+)?ELETRICIDADE|ELETRICA\s+BASICO)\b/i,
    code: '12',
    matchedTerm: 'NR-10 Básico',
  },
  // Carta NR-35
  {
    regex: /\bCARTA\s+(?:DE\s+)?(?:ANUENCIA\s+)?NR\s*[-_]?\s*35\b/i,
    code: '21.1',
    matchedTerm: 'Carta NR-35',
  },
  // NR-35 / GWO Working at Heights
  {
    regex:
      /\b(?:NR\s*[-_]?\s*35\b|TRABALHO\s+EM\s+ALTURA|WORKING\s+AT\s+HEIGHTS|WAH\b)\b/i,
    code: '21',
    matchedTerm: 'NR-35',
  },
  // NR-33 Supervisor - deve vir antes de NR-33 Vigia/Trabalhador
  {
    regex:
      /(?:NR\s*[-_]?\s*33[^\n]*\bSUPERVISOR\b|\bSUPERVISOR\b[^\n]*NR\s*[-_]?\s*33|\bSUPERVISOR\s*(?:DE\s+)?(?:ESPACO\s+CONFINADO|ENTRADA)\b)/i,
    code: '28',
    matchedTerm: 'NR-33 Supervisor',
  },
  // NR-33 Espaço Confinado (Vigia / Trabalhador)
  {
    regex:
      /(?:NR\s*[-_]?\s*33\b|ESPACO\s+CONFINADO|TRABALHADOR\s+E\s+VIGIA|TRABALHADOR\s+AUTORIZADO|\bVIGIA\b)/i,
    code: '20',
    matchedTerm: 'NR-33',
  },
  // NR-11 Uso de Talha / Ponte Rolante / Paleteira
  {
    regex:
      /\b(?:NR\s*[-_]?\s*11\b|TALHA|PALETEIRA|PONTE\s+ROLANTE|MOVIMENTACAO\s+DE\s+CARGA)\b/i,
    code: '14',
    matchedTerm: 'NR-11',
  },
  // NR-12 Máquinas e Equipamentos
  {
    regex:
      /\b(?:NR\s*[-_]?\s*12\b|MAQUINAS\s+E\s+EQUIPAMENTOS|SEGURANCA\s+NO\s+TRABALHO\s+EM\s+MAQUINAS)\b/i,
    code: '15',
    matchedTerm: 'NR-12',
  },
  // GWO NR-17 / Ergonomia / Carga Manual
  {
    regex:
      /\b(?:NR\s*[-_]?\s*17\b|ERGONOMIA|MANUSEIO\s+MANUAL\s+DE\s+CARGAS?|CARGA\s+MANUAL|MANUAL\s+HANDLING)\b/i,
    code: '17',
    matchedTerm: 'GWO NR-17',
  },
  // GWO Primeiros Socorros (BST)
  {
    regex: /\b(?:GWO\s+BST\s+PRIMEIROS|FIRST\s+AID|GWO\s+FA\b)\b/i,
    code: '16',
    matchedTerm: 'GWO Primeiros Socorros',
  },
  // NR-07 Primeiros Socorros
  {
    regex: /\b(?:NR\s*[-_]?\s*0?7\b|PRIMEIROS\s+SOCORROS)\b/i,
    code: '27',
    matchedTerm: 'NR-07 Primeiros Socorros',
  },
  // GWO NR-23 / Combate a Incêndio
  {
    regex:
      /\b(?:NR\s*[-_]?\s*23\b|COMBATE\s+A\s+INCENDIO|PREVENCAO\s+E\s+COMBATE\s+A\s+INCENDIO|FIRE\s+AWARENESS)\b/i,
    code: '19',
    matchedTerm: 'GWO NR-23',
  },
  // NR-18 Construção
  {
    regex:
      /\b(?:NR\s*[-_]?\s*18\b|CONSTRUCAO\s+CIVIL|CONDICOES\s+E\s+MEIO\s+AMBIENTE\s+NA\s+INDUSTRIA\s+DA\s+CONSTRUCAO)\b/i,
    code: '18',
    matchedTerm: 'NR-18',
  },
  // NR-06 Uso de EPI
  {
    regex:
      /\b(?:NR\s*[-_]?\s*0?6\b|USO\s+DE\s+EPI|EQUIPAMENTO\s+DE\s+PROTECAO\s+INDIVIDUAL)\b/i,
    code: '11',
    matchedTerm: 'NR-06',
  },
  // NR-01 Integração EHS / GRO / PGR
  {
    regex:
      /\b(?:NR\s*[-_]?\s*0?1\b|DISPOSICOES\s+GERAIS|GERENCIAMENTO\s+DE\s+RISCOS\s+OCUPACIONAIS|GRO\b|PGR\b|INTEGRACAO\s+EHS|INTEGRACAO\s+GRO)\b/i,
    code: '10',
    matchedTerm: 'NR-01',
  },
  // CIPA (NR-05)
  {
    regex:
      /\b(?:NR\s*[-_]?\s*0?5\b|CIPA\b|COMISSAO\s+INTERNA\s+DE\s+PREVENCAO)\b/i,
    code: '34',
    matchedTerm: 'CIPA (NR-05)',
  },
  // LOTO Bloqueio e Etiquetagem
  {
    regex:
      /\b(?:LOTO\b|BLOQUEIO\s+E\s+ETIQUETAGEM|LOCKOUT\s+TAGOUT|BLOQUEIO\s+DE\s+ENERGIA)\b/i,
    code: '22',
    matchedTerm: 'LOTO',
  },
  // ASO - Atestado de Saúde Ocupacional
  {
    regex:
      /\b(?:ASO\b|ATESTADO\s+DE\s+SAUDE\s+OCUPACIONAL|EXAME\s+MEDICO\s+OCUPACIONAL)\b/i,
    code: '01',
    matchedTerm: 'ASO',
  },
  // CNH - Carteira Nacional de Habilitação
  {
    regex:
      /\b(?:CNH\b|CARTEIRA\s+NACIONAL\s+DE\s+HABILITACAO|HABILITACAO\s+DE\s+MOTORISTA)\b/i,
    code: '08',
    matchedTerm: 'CNH',
  },
  // Direção Defensiva
  {
    regex: /\b(?:DIRECAO\s+DEFENSIVA|DEFENSIVE\s+DRIVING)\b/i,
    code: '09',
    matchedTerm: 'Direção Defensiva',
  },
  // Vestas SIT
  {
    regex:
      /\b(?:VESTAS\s+SIT|SIT\s+VESTAS|VESTAS.*SIT|SAFETY\s+IN\s+TOWERS)\b/i,
    code: '25',
    matchedTerm: 'SIT (Vestas)',
  },
  // Vestas ESO
  {
    regex:
      /\b(?:VESTAS\s+ESO|ESO\s+VESTAS|VESTAS.*ESO|ELECTRICAL\s+SAFETY\s+OPERATOR)\b/i,
    code: '26',
    matchedTerm: 'ESO (Vestas)',
  },
  // Elevador (JASO / Avanti)
  {
    regex:
      /\b(?:ELEVADOR\b|JASO\b|AVANTI\b|OPERACAO\s+DE\s+ELEVADOR|CREMALHEIRA)\b/i,
    code: '31',
    matchedTerm: 'Elevador (JASO)',
  },
  // GWO WINDA ID
  {
    regex: /\b(?:WINDA\s+ID|WINDA\b|GWO\s+WINDA)\b/i,
    code: '30',
    matchedTerm: 'GWO WINDA ID',
  },
  // CTPS Digital
  {
    regex: /\b(?:CTPS\b|CARTEIRA\s+DE\s+TRABALHO)\b/i,
    code: '04',
    matchedTerm: 'CTPS Digital',
  },
  // Cartão de Vacina / SUS
  {
    regex:
      /\b(?:CARTAO\s+DE\s+VACINA|VACINA\b|COMPROVANTE\s+DE\s+VACINACAO)\b/i,
    code: '05',
    matchedTerm: 'Cartão de Vacina / SUS',
  },
  // Ficha de EPI
  {
    regex:
      /\b(?:FICHA\s+DE\s+EPI|CHECKLIST\s+ALTURA|TERMO\s+DE\s+ENTREGA\s+DE\s+EPI)\b/i,
    code: '06',
    matchedTerm: 'Ficha de EPI',
  },
  // Seguro de Vida
  {
    regex: /\b(?:SEGURO\s+DE\s+VIDA|APOLICE\s+DE\s+SEGURO)\b/i,
    code: '07',
    matchedTerm: 'Seguro de Vida',
  },
  // CRT - Conselho dos Técnicos
  {
    regex: /\b(?:CRT\b|CFT\b|CONSELHO\s+DE\s+TECNICOS)\b/i,
    code: '23',
    matchedTerm: 'CRT',
  },
  // Diploma Técnico
  {
    regex:
      /\b(?:DIPLOMA\s+TECNICO|DIPLOMA\b|CERTIFICADO\s+DE\s+CONCLUSAO\s+DE\s+CURSO\s+TECNICO)\b/i,
    code: '24',
    matchedTerm: 'Diploma Técnico',
  },
  // Contrato PJ / Aditivo
  {
    regex: /\b(?:ADITIVO\s+(?:AO\s+)?CONTRATO|ADITIVO\s+CONTRATUAL)\b/i,
    code: '40.1',
    matchedTerm: 'Aditivo ao Contrato (PJ)',
  },
  {
    regex:
      /\b(?:CONTRATO\s+PJ|CONTRATO\s+DE\s+PRESTACAO\s+DE\s+SERVICO|CONTRATO\s+PILOTO)\b/i,
    code: '40',
    matchedTerm: 'Contrato PJ',
  },
]

export class CertificateClassifier {
  /**
   * Classifica um arquivo a partir de seu nome (e opcionalmente texto interno extraído de PDF).
   * Prioriza SEMÂNTICA da norma em vez de número prefixo puro.
   */
  static classify(
    filename: string,
    extractedText?: string
  ): ClassificationResult {
    if (!filename || filename.toLowerCase() === 'desktop.ini') {
      return { code: null, confidence: 'NONE', source: 'NONE' }
    }

    // 1. Caso o arquivo comece com DATA (ex.: 27 08 2026, 30-08-2026, 2026-08-27)
    // Os números iniciais são a DATA e NUNCA o código do documento!
    if (startsWithDate(filename)) {
      const cleanFilename = stripDatePrefix(filename)
      const normFilename = normalizeText(cleanFilename)

      for (const rule of SEMANTIC_RULES) {
        if (rule.regex.test(normFilename)) {
          return {
            code: rule.code,
            confidence: 'HIGH',
            source: 'SEMANTIC',
            matchedTerm: rule.matchedTerm,
          }
        }
      }

      if (extractedText) {
        const normText = normalizeText(extractedText)
        for (const rule of SEMANTIC_RULES) {
          if (rule.regex.test(normText)) {
            return {
              code: rule.code,
              confidence: 'HIGH',
              source: 'SEMANTIC',
              matchedTerm: `${rule.matchedTerm} (via PDF)`,
            }
          }
        }
      }

      // Se começa com data e não conseguimos identificar a norma, não adivinhe código
      return { code: null, confidence: 'NONE', source: 'NONE' }
    }

    // 2. O arquivo NÃO começa com data.
    // Verifica se possui prefixo explícito no formato: "XX - " ou "XX.X - " ou "XX – "
    const prefixMatch = filename.match(/^(\d{1,2}(\.\d+)?|\d{2})\s*[-–]/)
    let prefixCode: string | null = null
    if (prefixMatch) {
      prefixCode = prefixMatch[1]
      if (prefixCode.length === 1) prefixCode = `0${prefixCode}`
    }

    // Trata casos específicos de convenção de pasta Drone/LPS (04 e 04.1)
    if (prefixCode === '04.1') {
      return {
        code: '04.1',
        confidence: 'HIGH',
        source: 'PREFIX',
        matchedTerm: 'Aditivo ao Contrato (04.1)',
      }
    }
    if (prefixCode === '04' && /contrato/i.test(filename)) {
      return {
        code: '04',
        confidence: 'HIGH',
        source: 'PREFIX',
        matchedTerm: 'Contrato (04)',
      }
    }

    // Executa análise semântica sobre o texto do arquivo
    const normFilename = normalizeText(filename)
    let semanticMatch: { code: string; matchedTerm: string } | null = null

    for (const rule of SEMANTIC_RULES) {
      if (rule.regex.test(normFilename)) {
        semanticMatch = { code: rule.code, matchedTerm: rule.matchedTerm }
        break
      }
    }

    if (!semanticMatch && extractedText) {
      const normText = normalizeText(extractedText)
      for (const rule of SEMANTIC_RULES) {
        if (rule.regex.test(normText)) {
          semanticMatch = {
            code: rule.code,
            matchedTerm: `${rule.matchedTerm} (via PDF)`,
          }
          break
        }
      }
    }

    // Se temos semântica E prefixo:
    if (semanticMatch && prefixCode) {
      // Se forem iguais (ex.: prefixo 01 e ASO, ou prefixo 17 e NR-17), perfeito
      if (semanticMatch.code === prefixCode) {
        return {
          code: prefixCode,
          confidence: 'HIGH',
          source: 'SEMANTIC',
          matchedTerm: semanticMatch.matchedTerm,
        }
      }

      // Se houver CONTRADIÇÃO (ex.: prefixo diz 14 = NR-11, mas o texto diz claramente NR-10 Básico):
      // A semântica da norma prevalece sobre o erro de digitação do número prefixo!
      return {
        code: semanticMatch.code,
        confidence: 'HIGH',
        source: 'SEMANTIC',
        matchedTerm: `${semanticMatch.matchedTerm} (sobrepôs prefixo ${prefixCode})`,
      }
    }

    // Se temos apenas semântica (ex.: "Certificado NR-35.pdf" sem prefixo numérico):
    if (semanticMatch) {
      return {
        code: semanticMatch.code,
        confidence: 'HIGH',
        source: 'SEMANTIC',
        matchedTerm: semanticMatch.matchedTerm,
      }
    }

    // Se temos apenas prefixo (sem termo semântico reconhecido, ex.: "02 - Ordem de Serviço"):
    if (prefixCode && DOC_CATALOG_MAP[prefixCode]) {
      return {
        code: prefixCode,
        confidence: 'MEDIUM',
        source: 'PREFIX',
        matchedTerm: DOC_CATALOG_MAP[prefixCode],
      }
    }

    // Também suporta prefixo sem hífen (ex.: "01 ASO") se o código for válido
    const loosePrefixMatch = filename.match(/^(\d{1,2}(\.\d+)?|\d{2})\b/)
    if (loosePrefixMatch) {
      let raw = loosePrefixMatch[1]
      if (raw.length === 1) raw = `0${raw}`
      if (DOC_CATALOG_MAP[raw]) {
        return {
          code: raw,
          confidence: 'LOW',
          source: 'PREFIX',
          matchedTerm: DOC_CATALOG_MAP[raw],
        }
      }
    }

    // 4. Não identificado com segurança - quarentena para conferência humana
    return {
      code: null,
      confidence: 'NONE',
      source: 'NONE',
    }
  }
}
