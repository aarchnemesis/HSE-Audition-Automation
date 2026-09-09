import {
  EHSStatus,
  Inspector,
  ParkComplianceResult,
  ParkRequirement,
} from '../models/Certificate.js'
import { EHSEvaluator } from './EHSEvaluator.js'

export const DOC_CATALOG_MAP: Record<string, string> = {
  '01': 'ASO - Atestado de Saúde Ocupacional',
  '02': 'Ordem de Serviço',
  '03': 'Ficha de Registro',
  '04': 'CTPS Digital',
  '05': 'Cartão de Vacina / SUS',
  '06': 'Ficha de EPI / Checklist Altura',
  '07': 'Seguro de Vida',
  '08': 'CNH - Carteira de Habilitação',
  '09': 'Direção Defensiva',
  '10': 'NR-01 Integração EHS',
  '11': 'NR-06 Uso de EPI',
  '12': 'NR-10 Básico',
  '12.1': 'Carta NR-10',
  '13': 'NR-10 SEP',
  '14': 'NR-11 Uso de Talha',
  '15': 'NR-12 Segurança em Máquinas',
  '16': 'GWO Primeiros Socorros',
  '17': 'GWO NR-17 Ergonomia / Carga Manual',
  '18': 'NR-18 Integração EHS',
  '19': 'GWO NR-23 Combate a Incêndio',
  '20': 'NR-33 Espaço Confinado',
  '21': 'NR-35 / GWO Working at Heights',
  '22': 'LOTO - Bloqueio e Etiquetagem',
  '23': 'CRT - Conselho de Técnicos',
  '24': 'Diploma Técnico',
  '25': 'SIT (Vestas)',
  '26': 'ESO (Vestas)',
  '29': 'ATW Integração',
  '30': 'GWO WINDA ID',
  '27': 'NR-07 Primeiros Socorros',
  '28': 'NR-33 Supervisor',
  '31': 'Elevador (JASO)',
  '32': 'GWO ART',
  // Código arbitrário — de propósito NÃO usamos "33" pra evitar reproduzir a confusão que já
  // existia no código (alguém usou o código "33" pensando no número da NR-33, quando o código
  // interno da NR-33 no catálogo é "20"). CIPA (NR-05) é anual, carga horária varia por grau de
  // risco — ver docs/Guia_Treinamentos_Normativos_SST_arTH.xlsx.
  '34': 'CIPA (NR-05)',
  // "40"/"40.1" são códigos remapeados (não são o que a Storz/RPO usam) — nas pastas de Drone
  // Insp. Equipamento e LPS-SPDA, o código "04" no nome do arquivo colide com "CTPS Digital"
  // (usado nas pastas de Inspetores/Técnicos). Ver BRANCH_CODE_REMAP em GoogleDriveOAuthAdapter.ts.
  '40': 'Contrato de Prestação de Serviço (PJ)',
  '40.1': 'Aditivo ao Contrato (PJ)',
}

/**
 * Códigos de documento que a Storz pode plausivelmente ter (treinamentos normativos: NR, GWO,
 * LOTO, CIPA). A Storz é uma empresa de treinamentos — não faz sentido buscar lá documentos
 * pessoais/médicos (ASO, CTPS, vacina), de trânsito (CNH) ou certificações de terceiros
 * (SIT/ESO Vestas, GWO WINDA ID, CRT, Diploma). Usado pra restringir QUANDO o AuditTriangulator
 * sequer tenta casar um documento com uma solicitação na Storz — mantido em sincronia com o que
 * `classifyTrainingCode` (dossieParser.ts) consegue de fato classificar a partir de nomes reais
 * de turma raspados.
 */
export const STORZ_SEARCHABLE_DOC_CODES = new Set([
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '28',
  '34',
])

/**
 * Documentos/Treinamentos que exigem modalidade PRESENCIAL:
 * 1. Saúde Ocupacional: ASO (código 01) — exame médico clínico presencial (PCMSO/NR-07).
 * 2. Documentação Oficial: CNH (código 08) — documento oficial de habilitação com renovação presencial.
 * 3. Treinamento Prático em Altura: NR-35 (código 21 / GWO Working at Heights).
 * 4. Treinamentos Práticos GWO BST & ART:
 *    - 16: GWO Primeiros Socorros (First Aid / NR-07 / NR-01)
 *    - 17: GWO NR-17 Ergonomia / Carga Manual (Manual Handling / NR-17)
 *    - 19: GWO NR-23 Combate a Incêndio (Fire Awareness / NR-23)
 *    - 30: GWO WINDA ID
 *    - 32: GWO ART (Advanced Rescue Training)
 *
 * Todo o restante do catálogo (NR-01, NR-06, NR-10 Básico, NR-10 SEP, NR-11, NR-12, NR-18,
 * NR-33 Vigia, NR-33 Supervisor, LOTO, CIPA, Treinamentos Vestas e Elevadores/JASO, etc.)
 * é considerado REMOTO (EAD / LMS Storz / Plataforma Online), podendo ser realizado remotamente.
 */
export const PRESENCIAL_REQUIRED_DOC_CODES = new Set([
  '01', // ASO (Saúde Ocupacional - Exame Clínico Presencial)
  '08', // CNH (Documentação Oficial Presencial)
  '21', // NR-35 / GWO Working at Heights
  '16', // GWO Primeiros Socorros
  '17', // GWO NR-17 Ergonomia / Carga Manual
  '19', // GWO NR-23 Combate a Incêndio
  '30', // GWO WINDA ID
  '32', // GWO ART
])

export function getTrainingModality(
  docCode: string,
  docName?: string
): 'PRESENCIAL' | 'ONLINE' {
  const upper = (docName || '').toUpperCase()

  // Treinamentos Vestas (25, 26) e de Elevador (31, JASO, Cremalheira) são estritamente REMOTOS (ONLINE)
  if (
    docCode === '25' ||
    docCode === '26' ||
    docCode === '31' ||
    upper.includes('VESTAS') ||
    upper.includes('ELEVADOR') ||
    upper.includes('JASO') ||
    upper.includes('CREMALHEIRA')
  ) {
    return 'ONLINE'
  }

  if (PRESENCIAL_REQUIRED_DOC_CODES.has(docCode)) {
    return 'PRESENCIAL'
  }

  if (
    upper.includes('GWO') ||
    upper.includes('NR-35') ||
    upper.includes('NR 35') ||
    upper.includes('NR35') ||
    upper.includes('ASO') ||
    upper.includes('CNH')
  ) {
    return 'PRESENCIAL'
  }
  return 'ONLINE'
}

/**
 * Carga horária regulamentar e prática em horas (baseado no Guia de Treinamentos SST da ArthWind,
 * Normas Regulamentadoras MTP e padrões GWO).
 */
export const COURSE_WORKLOAD_HOURS: Record<string, number> = {
  '09': 8, // Direção Defensiva
  '10': 4, // NR-01 Integração EHS / GRO
  '11': 4, // NR-06 Uso de EPI / EPC
  '12': 40, // NR-10 Básico Eletricidade
  '12.1': 4, // Carta NR-10
  '13': 40, // NR-10 SEP Complementar
  '14': 8, // NR-11 Uso de Talha / Paleteira
  '15': 8, // NR-12 Máquinas e Equipamentos
  '16': 14, // GWO Primeiros Socorros (Reciclagem: 7h)
  '17': 4, // GWO NR-17 Ergonomia / Carga Manual
  '18': 4, // NR-18 Básico Construção
  '19': 4, // GWO NR-23 Combate a Incêndio
  '20': 16, // NR-33 Espaço Confinado (Vigia / Trabalhador)
  '21': 16, // NR-35 / GWO Working at Heights
  '22': 4, // LOTO Bloqueio e Etiquetagem
  '27': 8, // NR-07 Primeiros Socorros
  '28': 40, // NR-33 Supervisor
  '29': 4, // ATW Integração
  '31': 8, // Elevador JASO
  '32': 21, // GWO ART (Advanced Rescue Training)
  '34': 16, // CIPA NR-05 (Grau de Risco 3)
}

/**
 * Retorna a carga horária em horas considerando se a turma é de iniciação/formação ou reciclagem/periódica.
 */
export function getCourseWorkloadHours(
  docCode: string,
  docName?: string
): number {
  const upper = (docName || '').toUpperCase()
  if (
    docCode === '20' &&
    (upper.includes('PERIÓDICO') ||
      upper.includes('PERIODICO') ||
      upper.includes('RECICLAGEM'))
  ) {
    return 8 // NR-33 Vigia periódico é 8h
  }
  if (
    docCode === '28' &&
    (upper.includes('PERIÓDICO') ||
      upper.includes('PERIODICO') ||
      upper.includes('RECICLAGEM'))
  ) {
    return 8 // NR-33 Supervisor periódico é 8h
  }
  if (
    docCode === '12' &&
    (upper.includes('PERIÓDICO') ||
      upper.includes('PERIODICO') ||
      upper.includes('RECICLAGEM'))
  ) {
    return 16 // NR-10 Básico periódico é 8-16h
  }
  if (
    docCode === '13' &&
    (upper.includes('PERIÓDICO') ||
      upper.includes('PERIODICO') ||
      upper.includes('RECICLAGEM'))
  ) {
    return 16 // NR-10 SEP periódico é 8-16h
  }
  if (
    docCode === '16' &&
    (upper.includes('REFRESHER') || upper.includes('RECICLAGEM'))
  ) {
    return 7 // GWO First Aid Refresher
  }
  if (
    docCode === '21' &&
    (upper.includes('PERIÓDICO') ||
      upper.includes('PERIODICO') ||
      upper.includes('RECICLAGEM') ||
      upper.includes('NR-35') ||
      upper.includes('NR 35'))
  ) {
    return 8 // NR-35 periódico ou padrão 8h
  }
  return COURSE_WORKLOAD_HOURS[docCode] || 8
}

/**
 * Documentos ELETIVOS: não são pra todo mundo, mas quem TEM precisa ter a validade monitorada
 * (reciclagem/vencimento) igual qualquer outro documento. Quem NÃO tem NÃO aparece em lugar
 * nenhum (Excel, dashboard, e-mail) — não é uma pendência, é "não se aplica a essa pessoa".
 * Confirmado com o usuário em 22 e 25/08/2026:
 *   - SIT/ESO (Vestas): exigido pelo cliente/parque específico, nem todo mundo trabalha com Vestas.
 *   - Elevador (JASO): exigência de EHS de parque a parque, pra o inspetor operar o elevador da
 *     turbina com segurança quando estiver naquele parque — não é do perfil CAMPO como um todo.
 *   - CIPA (NR-05): só quem é membro eleito da comissão precisa, não é do perfil de ninguém por
 *     padrão — mas enquanto for membro, o treinamento tem que estar em dia.
 * Esses três precisam estar em CAMPO_REQUIRED_DOC_CODES pra sequer serem avaliados pelo
 * AuditTriangulator (que só itera sobre `requiredDocCodes`) — sem isso, mesmo quem TEM o
 * documento nunca aparece em relatório nenhum. Ver filtro de ausente em AuditTriangulator.ts e
 * HSEDatabaseRepository.ts.
 */
export const ELECTIVE_DOC_CODES = new Set([
  '25', // SIT (Vestas)
  '26', // ESO (Vestas)
  '28', // NR-33 Supervisor
  '31', // Elevador (JASO)
  '34', // CIPA (NR-05)
])

export class ComplianceEngine {
  /**
   * Triangula o perfil do inspetor com a matriz de requisitos de um parque específico.
   */
  static evaluateInspectorForPark(
    inspector: Inspector,
    park: ParkRequirement,
    refDate: Date = new Date()
  ): ParkComplianceResult {
    let missingCount = 0
    let expiredCount = 0
    let warningCount = 0
    let validCount = 0

    const docDetails = park.requiredDocCodes.map(code => {
      const reqName = DOC_CATALOG_MAP[code] || `Documento Código ${code}`
      const cert = inspector.certificates.get(code)

      if (!cert) {
        missingCount++
        return {
          code,
          reqName,
          status: 'AUSENTE' as EHSStatus,
          detail:
            'Documento obrigatório não encontrado no cadastro do inspetor.',
        }
      }

      const evaluation = EHSEvaluator.evaluateDate(cert.expirationDate, refDate)

      if (evaluation.status === 'AUSENTE') {
        missingCount++
      } else if (evaluation.status === 'VENCIDO') {
        expiredCount++
      } else if (
        [
          'VENCE_60',
          'VENCE_30',
          'VENCE_15',
          'VENCE_07',
          'INDETERMINADO',
        ].includes(evaluation.status)
      ) {
        warningCount++
      } else {
        validCount++
      }

      return {
        code,
        reqName,
        status: evaluation.status,
        detail: evaluation.detail,
      }
    })

    let overallStatus: 'APTO' | 'APTO_COM_ATENCAO' | 'INAPTO'

    if (missingCount === 0 && expiredCount === 0) {
      if (warningCount === 0) {
        overallStatus = 'APTO'
      } else {
        overallStatus = 'APTO_COM_ATENCAO'
      }
    } else {
      overallStatus = 'INAPTO'
    }

    return {
      inspectorName: inspector.name,
      parkName: park.parkName,
      clientName: park.clientName,
      overallStatus,
      missingDocsCount: missingCount,
      expiredDocsCount: expiredCount,
      warningDocsCount: warningCount,
      storzPendingCount: 0,
      validDocsCount: validCount,
      docDetails,
    }
  }
}
