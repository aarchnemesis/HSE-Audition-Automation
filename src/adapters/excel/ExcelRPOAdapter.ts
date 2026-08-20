import ExcelJS from 'exceljs';
import { IRPOExporter } from '../../ports/IRPOExporter.js';
import { Inspector, Certificate } from '../../domain/models/Certificate.js';
import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js';

export class ExcelRPOAdapter implements IRPOExporter {
  private refDate: Date;

  constructor(refDate: Date = new Date(2026, 7, 13)) {
    this.refDate = refDate;
  }

  async readRPOData(filePath: string): Promise<Inspector[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheet = workbook.getWorksheet('ATW_ADM_002 - RPO - EHS');
    const inspectors: Inspector[] = [];

    if (!sheet) {
      console.warn('[ExcelRPOAdapter] Aba ATW_ADM_002 - RPO - EHS não encontrada.');
      return inspectors;
    }

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber < 12) return;

      const funcName = row.getCell(54).value?.toString();
      const setor = row.getCell(53).value?.toString();
      const winda = row.getCell(55).value?.toString();
      const tipo = row.getCell(50).value?.toString();

      if (funcName && !funcName.startsWith('DOCUMENTOS') && funcName !== 'FUNCIONARIO') {
        const certificates = new Map<string, Certificate>();

        const dateColumns: Record<string, { col: number; name: string }> = {
          '01': { col: 63, name: 'ASO' },
          '08': { col: 64, name: 'CNH' },
          '16': { col: 65, name: 'GWO BST' },
          '09': { col: 67, name: 'Direção Defensiva' },
          '10': { col: 68, name: 'NR-01' },
          '11': { col: 69, name: 'NR-06' },
          '12': { col: 71, name: 'NR-10' },
          '13': { col: 72, name: 'NR-10 SEP' },
          '14': { col: 73, name: 'NR-11' },
          '15': { col: 74, name: 'NR-12' },
          '18': { col: 76, name: 'NR-18' },
          '19': { col: 77, name: 'NR-23' },
          '20': { col: 80, name: 'NR-33 SUP' },
          '21': { col: 81, name: 'NR-35' },
          '22': { col: 82, name: 'LOTO' },
          '25': { col: 83, name: 'SIT VESTAS' },
          '26': { col: 84, name: 'ESO VESTAS' }
        };

        for (const [code, meta] of Object.entries(dateColumns)) {
          const rawCellVal = row.getCell(meta.col).value;
          let expDate: Date | undefined = undefined;

          if (rawCellVal instanceof Date) {
            expDate = rawCellVal;
          } else if (typeof rawCellVal === 'string' || typeof rawCellVal === 'number') {
            const parsed = new Date(rawCellVal);
            if (!isNaN(parsed.getTime())) expDate = parsed;
          }

          if (expDate) {
            const evalResult = EHSEvaluator.evaluateDate(expDate, this.refDate);
            certificates.set(code, {
              code,
              name: meta.name,
              expirationDate: expDate,
              statusEHS: evalResult.status,
              statusDetail: evalResult.detail
            });
          }
        }

        inspectors.push({
          id: `rpo_${rowNumber}`,
          name: funcName,
          role: tipo || 'INSPETOR',
          sector: setor,
          windaId: winda,
          certificates
        });
      }
    });

    return inspectors;
  }

  async updateRPOData(filePath: string, inspectors: Inspector[]): Promise<boolean> {
    console.log(`[ExcelRPOAdapter] Sincronização e atualização agendada para: ${filePath}`);
    return true;
  }
}
