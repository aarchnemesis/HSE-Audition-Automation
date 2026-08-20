import { Inspector } from '../models/Certificate.js';
import { DOC_CATALOG_MAP } from './ComplianceEngine.js';
import { matchesInspector } from './InspectorMatcher.js';

export type DriveRpoDivergenceKind = 'SOMENTE_DRIVE' | 'SOMENTE_RPO' | 'DATA_DIVERGENTE';

export interface DriveRpoComparisonItem {
  inspectorName: string;
  docCode: string;
  docName: string;
  driveExpiration?: Date;
  rpoExpiration?: Date;
  divergent: boolean;
  divergenceKind?: DriveRpoDivergenceKind;
  detail: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Pequena tolerância pra não gerar ruído por diferença de 1 dia entre "data de emissão + validade
// calculada" (Drive) e a data-limite gravada manualmente na RPO — divergências reais tendem a ser
// de semanas/meses, não de 1-2 dias.
const DATE_TOLERANCE_DAYS = 2;

export class DriveRpoAuditor {
  /**
   * Compara os certificados encontrados no Drive com os registros da planilha RPO, pessoa por
   * pessoa e documento por documento. Gera um item por combinação (inspetor, docCode) que existe
   * em pelo menos uma das duas fontes — SOMENTE LEITURA, não altera nada em nenhum dos dois lados.
   */
  static compare(driveInspectors: Inspector[], rpoInspectors: Inspector[], docCodes?: string[]): DriveRpoComparisonItem[] {
    const items: DriveRpoComparisonItem[] = [];

    for (const driveInspector of driveInspectors) {
      const rpoInspector = rpoInspectors.find((r) => matchesInspector(driveInspector, r.name));

      const codesToCheck = docCodes || this.unionOfCodes(driveInspector, rpoInspector);

      for (const code of codesToCheck) {
        const driveCert = driveInspector.certificates.get(code);
        const rpoCert = rpoInspector?.certificates.get(code);

        if (!driveCert && !rpoCert) continue;

        const docName = DOC_CATALOG_MAP[code] || `Documento Código ${code}`;

        if (driveCert && !rpoCert) {
          items.push({
            inspectorName: driveInspector.name,
            docCode: code,
            docName,
            driveExpiration: driveCert.expirationDate,
            divergent: true,
            divergenceKind: 'SOMENTE_DRIVE',
            detail: `Certificado presente no Drive, mas sem registro correspondente na planilha RPO (${rpoInspector ? 'pessoa encontrada na RPO' : 'pessoa não encontrada na RPO'}).`
          });
          continue;
        }

        if (!driveCert && rpoCert) {
          items.push({
            inspectorName: driveInspector.name,
            docCode: code,
            docName,
            rpoExpiration: rpoCert.expirationDate,
            divergent: true,
            divergenceKind: 'SOMENTE_RPO',
            detail: 'Registro presente na planilha RPO, mas nenhum certificado correspondente encontrado no Drive.'
          });
          continue;
        }

        // Ambos presentes — compara as datas de validade com tolerância
        if (driveCert!.expirationDate && rpoCert!.expirationDate) {
          const diffDays = Math.abs(driveCert!.expirationDate.getTime() - rpoCert!.expirationDate.getTime()) / ONE_DAY_MS;
          if (diffDays > DATE_TOLERANCE_DAYS) {
            items.push({
              inspectorName: driveInspector.name,
              docCode: code,
              docName,
              driveExpiration: driveCert!.expirationDate,
              rpoExpiration: rpoCert!.expirationDate,
              divergent: true,
              divergenceKind: 'DATA_DIVERGENTE',
              detail: `Datas de validade divergem em ${Math.round(diffDays)} dia(s) entre Drive e RPO.`
            });
            continue;
          }
        }

        items.push({
          inspectorName: driveInspector.name,
          docCode: code,
          docName,
          driveExpiration: driveCert!.expirationDate,
          rpoExpiration: rpoCert!.expirationDate,
          divergent: false,
          detail: 'Drive e RPO consistentes.'
        });
      }
    }

    return items;
  }

  private static unionOfCodes(driveInspector: Inspector, rpoInspector: Inspector | undefined): string[] {
    const codes = new Set<string>(driveInspector.certificates.keys());
    if (rpoInspector) {
      for (const code of rpoInspector.certificates.keys()) codes.add(code);
    }
    return Array.from(codes);
  }
}
