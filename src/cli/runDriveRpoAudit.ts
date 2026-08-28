import 'dotenv/config';
import ExcelJS from 'exceljs';
import path from 'path';
import { createDriveAdapter } from '../adapters/drive/driveAdapterFactory.js';
import { SmartsheetRPOAdapter, RPO_TRACKED_DOC_CODES } from '../adapters/smartsheet/SmartsheetRPOAdapter.js';
import { StorzPlaywrightScraper } from '../adapters/storz/StorzPlaywrightScraper.js';
import { StorzPlaywrightAdapter } from '../adapters/storz/StorzPlaywrightAdapter.js';
import { Inspector } from '../domain/models/Certificate.js';
import { DriveRpoAuditor } from '../domain/services/DriveRpoAuditor.js';
import { classifyEmployeeProfile } from '../domain/services/EmployeeProfileClassifier.js';
import { matchesInspector } from '../domain/services/InspectorMatcher.js';
import { DummyEmailService } from '../adapters/email/DummyEmailService.js';
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js';
import { IEmailService } from '../ports/IEmailService.js';

const REF_DATE = process.env.HSE_REF_DATE ? new Date(process.env.HSE_REF_DATE) : new Date();
const EMAIL_RECIPIENT = process.env.HSE_EMAIL_TO || 'joao.oliveira@arthwind.com.br';

async function exportToExcel(items: ReturnType<typeof DriveRpoAuditor.compare>, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Auditoria Drive x RPO');

  sheet.columns = [
    { header: 'Colaborador', key: 'inspectorName', width: 35 },
    { header: 'Código', key: 'docCode', width: 10 },
    { header: 'Documento', key: 'docName', width: 30 },
    { header: 'Validade Drive', key: 'driveExpiration', width: 16 },
    { header: 'Validade Storz (estimada)', key: 'storzExpiration', width: 20 },
    { header: 'Validade RPO', key: 'rpoExpiration', width: 16 },
    { header: 'Fonte Confiável', key: 'trustedSource', width: 14 },
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
      storzExpiration: dateFmt(item.storzExpiration),
      rpoExpiration: dateFmt(item.rpoExpiration),
      trustedSource: item.trustedSource || '',
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
  const driveAdapter = createDriveAdapter(REF_DATE);

  console.log('📂 Lendo inspetores do Drive...');
  const driveInspectorsRaw = await driveAdapter.getInspectors();
  console.log(`   ${driveInspectorsRaw.length} inspetor(es) encontrado(s) no Drive.`);

  let rpoInspectors: Inspector[] = [];
  let driveInspectors = driveInspectorsRaw;

  if (rpoAdapter) {
    console.log('📊 Lendo planilha RPO via Smartsheet (somente leitura)...');
    const rpoInspectorsRaw = await rpoAdapter.readRPOData();
    console.log(`   ${rpoInspectorsRaw.length} linha(s) encontrada(s) na RPO.`);

    const desligadoInspectors = rpoInspectorsRaw.filter((i) => classifyEmployeeProfile(i.role) === null);
    rpoInspectors = rpoInspectorsRaw.filter((i) => classifyEmployeeProfile(i.role) !== null);
    console.log(`   ${rpoInspectors.length} pessoa(s) ativa(s) após excluir ${desligadoInspectors.length} desligado(s).`);

    driveInspectors = driveInspectorsRaw.filter(
      (d) => !desligadoInspectors.some((deslig) => matchesInspector(deslig, d.name, d.cpf))
    );
    console.log(`   ${driveInspectors.length} pasta(s) do Drive após excluir desligados (de ${driveInspectorsRaw.length}).`);
  } else {
    console.log('⚠️  SMARTSHEET_API_TOKEN / SMARTSHEET_RPO_SHEET_ID não configurados — executando comparação com base disponível.');
  }

  console.log('🤖 Executando raspagem / auditoria na plataforma Storz...');
  const storzScraper = new StorzPlaywrightScraper();
  const storzResult = await storzScraper.runAuditScrape({
    headless: true,
    targetCollaborators: rpoInspectors.map((i) => i.name)
  });
  let storzRequests = storzResult.requests;
  if (storzRequests.length === 0) {
    const storzAdapter = new StorzPlaywrightAdapter();
    storzRequests = await storzAdapter.getAllRequests();
  }
  console.log(`   ${storzRequests.length} matrícula(s)/curso(s) carregada(s) da Storz.`);

  console.log('\n🔍 Comparando Drive + Storz (confiáveis) x RPO (digitada)...');
  const items = DriveRpoAuditor.compare(driveInspectors, rpoInspectors, Array.from(RPO_TRACKED_DOC_CODES), storzRequests);
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

  console.log('================================================================================');
  console.log('   📧 ENVIANDO RESUMO DA AUDITORIA DRIVE+STORZ x RPO');
  console.log('================================================================================');
  const emailService: IEmailService = SmtpEmailService.fromEnv() || new DummyEmailService();
  const emailRes = await emailService.sendEmail({
    to: EMAIL_RECIPIENT,
    subject: `Auditoria RPO — ${divergences.length} divergência(s) de digitação encontrada(s)`,
    htmlContent: buildDivergenceSummaryHtml(divergences, REF_DATE)
  });
  console.log(`   Resumo ${emailRes.success ? 'enviado' : 'falhou'}\n`);
}

function buildDivergenceSummaryHtml(divergences: ReturnType<typeof DriveRpoAuditor.compare>, refDate: Date): string {
  const dateFmt = (d?: Date) => (d ? d.toLocaleDateString('pt-BR') : '—');
  const kindLabel: Record<string, string> = {
    SOMENTE_DRIVE: 'Só existe no Drive',
    SOMENTE_STORZ: 'Só existe na Storz',
    SOMENTE_RPO: 'Só existe na RPO',
    DATA_DIVERGENTE: 'Data divergente'
  };

  const rows = divergences
    .slice(0, 200) // e-mail não é o relatório completo — o xlsx anexado ao artifact do workflow é
    .map((d) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${d.inspectorName}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${d.docName}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${kindLabel[d.divergenceKind || ''] || d.divergenceKind}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${dateFmt(d.driveExpiration)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${dateFmt(d.storzExpiration)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${dateFmt(d.rpoExpiration)}</td>
      </tr>`)
    .join('');

  return `
    <p>Auditoria semanal Drive + Storz (fontes confiáveis) x RPO (digitada à mão) — data de referência ${refDate.toLocaleDateString('pt-BR')}.</p>
    <p><strong>${divergences.length}</strong> divergência(s) encontrada(s). O relatório completo em Excel está disponível como artifact desta execução no GitHub Actions.</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="background:#f1f5f9;text-align:left;">
          <th style="padding:6px 10px;">Colaborador</th>
          <th style="padding:6px 10px;">Documento</th>
          <th style="padding:6px 10px;">Tipo</th>
          <th style="padding:6px 10px;">Drive</th>
          <th style="padding:6px 10px;">Storz (estimado)</th>
          <th style="padding:6px 10px;">RPO</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${divergences.length > 200 ? `<p><em>Mostrando as primeiras 200 de ${divergences.length} — ver o Excel completo no artifact.</em></p>` : ''}
  `;
}

main().catch((err) => {
  console.error('Erro na auditoria Drive x RPO:', err);
  process.exit(1);
});
