import 'dotenv/config';
import ExcelJS from 'exceljs';
import path from 'path';
import { createDriveAdapter } from '../adapters/drive/driveAdapterFactory.js';
import { SmartsheetRPOAdapter, RPO_TRACKED_DOC_CODES } from '../adapters/smartsheet/SmartsheetRPOAdapter.js';
import { DriveRpoAuditor } from '../domain/services/DriveRpoAuditor.js';

const REF_DATE = process.env.HSE_REF_DATE ? new Date(process.env.HSE_REF_DATE) : new Date();

async function exportToExcel(items: ReturnType<typeof DriveRpoAuditor.compare>, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Auditoria Drive x RPO');

  sheet.columns = [
    { header: 'Colaborador', key: 'inspectorName', width: 35 },
    { header: 'Código', key: 'docCode', width: 10 },
    { header: 'Documento', key: 'docName', width: 30 },
    { header: 'Validade Drive', key: 'driveExpiration', width: 16 },
    { header: 'Validade RPO', key: 'rpoExpiration', width: 16 },
    { header: 'Divergente', key: 'divergent', width: 12 },
    { header: 'Tipo', key: 'divergenceKind', width: 18 },
    { header: 'Detalhes', key: 'detail', width: 60 }
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0F172A' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  const dateFmt = (d?: Date) => (d ? d.toLocaleDateString('pt-BR') : '');

  for (const item of items) {
    const row = sheet.addRow({
      inspectorName: item.inspectorName,
      docCode: item.docCode,
      docName: item.docName,
      driveExpiration: dateFmt(item.driveExpiration),
      rpoExpiration: dateFmt(item.rpoExpiration),
      divergent: item.divergent ? 'SIM' : 'NÃO',
      divergenceKind: item.divergenceKind || '',
      detail: item.detail
    });

    if (item.divergent) {
      const cell = row.getCell('divergent');
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } };
      cell.font = { color: { argb: '991B1B' }, bold: true };
    }
  }

  await workbook.xlsx.writeFile(outputPath);
}

async function main() {
  console.log('================================================================================');
  console.log('   HSE AUDIT AUTOMATION - AUDITORIA DRIVE x RPO (SOMENTE LEITURA)');
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`);
  console.log('================================================================================\n');

  const rpoAdapter = SmartsheetRPOAdapter.fromEnv(REF_DATE);
  if (!rpoAdapter) {
    console.error('❌ SMARTSHEET_API_TOKEN / SMARTSHEET_RPO_SHEET_ID não configurados no .env.');
    process.exit(1);
  }

  const driveAdapter = createDriveAdapter(REF_DATE);

  console.log('📂 Lendo inspetores do Drive...');
  const driveInspectors = await driveAdapter.getInspectors();
  console.log(`   ${driveInspectors.length} inspetor(es) encontrado(s) no Drive.`);

  console.log('📊 Lendo planilha RPO via Smartsheet (somente leitura)...');
  const rpoInspectors = await rpoAdapter.readRPOData();
  console.log(`   ${rpoInspectors.length} linha(s) encontrada(s) na RPO.`);

  console.log('\n🔍 Comparando Drive x RPO...');
  const items = DriveRpoAuditor.compare(driveInspectors, rpoInspectors, Array.from(RPO_TRACKED_DOC_CODES));
  const divergences = items.filter((i) => i.divergent);
  console.log(`   ${items.length} combinação(ões) comparada(s), ${divergences.length} divergência(s) encontrada(s).`);

  const byKind: Record<string, number> = {};
  for (const d of divergences) {
    byKind[d.divergenceKind!] = (byKind[d.divergenceKind!] || 0) + 1;
  }
  console.log('\n   Por tipo:');
  for (const [kind, count] of Object.entries(byKind)) {
    console.log(`   - ${kind}: ${count}`);
  }

  const outputPath = path.join(process.cwd(), 'scratch', 'auditoria_drive_rpo.xlsx');
  await exportToExcel(items, outputPath);
  console.log(`\n✅ Relatório gerado em: ${outputPath}`);
  console.log('   (Somente leitura — nada foi alterado na planilha RPO/Smartsheet.)\n');
}

main().catch((err) => {
  console.error('Erro na auditoria Drive x RPO:', err);
  process.exit(1);
});
