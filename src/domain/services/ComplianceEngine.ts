import { Inspector, ParkRequirement, ParkComplianceResult, EHSStatus } from '../models/Certificate.js';
import { EHSEvaluator } from './EHSEvaluator.js';

export const DOC_CATALOG_MAP: Record<string, string> = {
  "01": "ASO - Atestado de Saúde Ocupacional",
  "02": "Ordem de Serviço",
  "03": "Ficha de Registro",
  "04": "CTPS Digital",
  "05": "Cartão de Vacina / SUS",
  "06": "Ficha de EPI / Checklist Altura",
  "07": "Seguro de Vida",
  "08": "CNH - Carteira de Habilitação",
  "09": "Direção Defensiva",
  "10": "NR-01 Integração EHS",
  "11": "NR-06 Uso de EPI",
  "12": "NR-10 Básico",
  "12.1": "Carta NR-10",
  "13": "NR-10 SEP",
  "14": "NR-11 Uso de Talha",
  "15": "NR-12 Segurança em Máquinas",
  "16": "GWO Primeiros Socorros",
  "17": "GWO NR-17 Ergonomia / Carga Manual",
  "18": "NR-18 Integração EHS",
  "19": "GWO NR-23 Combate a Incêndio",
  "20": "NR-33 Espaço Confinado",
  "21": "NR-35 / GWO Working at Heights",
  "22": "LOTO - Bloqueio e Etiquetagem",
  "23": "CRT - Conselho de Técnicos",
  "24": "Diploma Técnico",
  "25": "SIT (Vestas)",
  "26": "ESO (Vestas)",
  "29": "ATW Integração",
  "30": "GWO WINDA ID",
  "27": "NR-07 Primeiros Socorros",
  "28": "NR-33 Supervisor",
  "31": "Elevador (JASO)",
  "32": "GWO ART",
  // Código arbitrário — de propósito NÃO usamos "33" pra evitar reproduzir a confusão que já
  // existia no código (alguém usou o código "33" pensando no número da NR-33, quando o código
  // interno da NR-33 no catálogo é "20"). CIPA (NR-05) é anual, carga horária varia por grau de
  // risco — ver docs/Guia_Treinamentos_Normativos_SST_arTH.xlsx.
  "34": "CIPA (NR-05)"
};

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
  '10', '11', '12', '13', '14', '15', '17', '18', '19', '20', '21', '22', '34'
]);

export class ComplianceEngine {
  /**
   * Triangula o perfil do inspetor com a matriz de requisitos de um parque específico.
   */
  static evaluateInspectorForPark(
    inspector: Inspector,
    park: ParkRequirement,
    refDate: Date = new Date()
  ): ParkComplianceResult {
    let missingCount = 0;
    let expiredCount = 0;
    let warningCount = 0;
    let validCount = 0;

    const docDetails = park.requiredDocCodes.map((code) => {
      const reqName = DOC_CATALOG_MAP[code] || `Documento Código ${code}`;
      const cert = inspector.certificates.get(code);

      if (!cert) {
        missingCount++;
        return {
          code,
          reqName,
          status: 'AUSENTE' as EHSStatus,
          detail: 'Documento obrigatório não encontrado no cadastro do inspetor.'
        };
      }

      const evaluation = EHSEvaluator.evaluateDate(cert.expirationDate, refDate);

      if (evaluation.status === 'AUSENTE') {
        missingCount++;
      } else if (evaluation.status === 'VENCIDO') {
        expiredCount++;
      } else if (['VENCE_60', 'VENCE_30', 'VENCE_15', 'VENCE_07', 'INDETERMINADO'].includes(evaluation.status)) {
        warningCount++;
      } else {
        validCount++;
      }

      return {
        code,
        reqName,
        status: evaluation.status,
        detail: evaluation.detail
      };
    });

    let overallStatus: 'APTO' | 'APTO_COM_ATENCAO' | 'INAPTO';

    if (missingCount === 0 && expiredCount === 0) {
      if (warningCount === 0) {
        overallStatus = 'APTO';
      } else {
        overallStatus = 'APTO_COM_ATENCAO';
      }
    } else {
      overallStatus = 'INAPTO';
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
      docDetails
    };
  }
}
