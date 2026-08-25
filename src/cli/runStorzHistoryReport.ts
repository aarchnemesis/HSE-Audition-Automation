import 'dotenv/config';
import ExcelJS from 'exceljs';
import path from 'path';
import { SmartsheetRPOAdapter } from '../adapters/smartsheet/SmartsheetRPOAdapter.js';
import { StorzPlaywrightScraper } from '../adapters/storz/StorzPlaywrightScraper.js';
import { classifyEmployeeProfile } from '../domain/services/EmployeeProfileClassifier.js';
import { DOC_CATALOG_MAP } from '../domain/services/ComplianceEngine.js';
import { StorzRequest } from '../domain/models/StorzRequest.js';

const REF_DATE = process.env.HSE_REF_DATE ? new Date(process.env.HSE_REF_DATE) : new Date();

/**
 * Gera um "Histórico do Aluno" — um registro por colaborador+curso, no molde do exemplo que a
 * analista de treinamentos mandou (extrato tipo transcript, não status de conformidade). Fonte é
 * só a Storz (é lá que mora o histórico de matrícula/conclusão de curso). Não tem carga horária
 * porque o Dossiê do Aluno na Storz não expõe esse dado — omitido em vez de inventado.
 */
async function exportToExcel(requests: StorzRequest[], outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Histórico do Aluno');

  sheet.columns = [
    { header: 'Colaborador', key: 'collaboratorName', width: 35 },
    { header: 'CPF', key: 'collaboratorCpf', width: 16 },
    { header: 'Código', key: 'trainingCode', width: 10 },
    { header: 'Nome do Curso', key: 'trainingName', width: 45 },
    { header: 'Modalidade', key: 'modality', width: 14 },
    { header: 'Data Matrícula', key: 'requestDate', width: 16 },
    { header: 'Data Conclusão', key: 'completionDate', width: 16 },
    { header: 'Situação', key: 'situacao', width: 18 },
    { header: 'Nº Matrícula (Storz)', key: 'id', width: 20 }
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '25386B' } }; // navy ArthWind
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

  const dateFmt = (d?: Date) => (d ? d.toLocaleDateString('pt-BR') : '');
  const situacaoColors: Record<string, string> = {
    APROVADO: 'DCFCE7',
    CONCLUIDO: 'DCFCE7',
    REPROVADO: 'FEE2E2',
    CANCELADO: 'FEE2E2',
    'EM ANDAMENTO': 'FEF9C3'
  };

  const sorted = [...requests].sort(
    (a, b) => a.collaboratorName.localeCompare(b.collaboratorName) || a.requestDate.getTime() - b.requestDate.getTime()
  );

  for (const req of sorted) {
    const situacao = req.rawSituacao || req.state;
    const row = sheet.addRow({
      collaboratorName: req.collaboratorName,
      collaboratorCpf: req.collaboratorCpf || '',
      trainingCode: req.trainingCode,
      trainingName: DOC_CATALOG_MAP[req.trainingCode] ? `${req.trainingName} (${DOC_CATALOG_MAP[req.trainingCode]})` : req.trainingName,
      modality: req.modality,
      requestDate: dateFmt(req.requestDate),
      completionDate: dateFmt(req.completionDate),
      situacao,
      id: req.id
    });

    const colorKey = situacao.toUpperCase();
    const bg = situacaoColors[colorKey];
    if (bg) {
      row.getCell('situacao').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    }
  }

  await workbook.xlsx.writeFile(outputPath);
}

async function main() {
  console.log('================================================================================');
  console.log('   HSE AUDIT AUTOMATION - HISTÓRICO DO ALUNO (STORZ)');
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`);
  console.log('================================================================================\n');

  const rpoAdapter = SmartsheetRPOAdapter.fromEnv(REF_DATE);
  if (!rpoAdapter) {
    console.error('❌ SMARTSHEET_API_TOKEN / SMARTSHEET_RPO_SHEET_ID não configurados no .env.');
    process.exit(1);
  }

  console.log('📊 Lendo planilha RPO via Smartsheet (só pra saber quem auditar — não editamos nada)...');
  const rpoInspectorsRaw = await rpoAdapter.readRPOData();
  const rpoInspectors = rpoInspectorsRaw.filter((i) => classifyEmployeeProfile(i.role) !== null);
  console.log(`   ${rpoInspectors.length} pessoa(s) ativa(s) (de ${rpoInspectorsRaw.length} linhas na RPO).`);

  console.log('🤖 Executando raspagem do histórico completo na plataforma Storz...');
  const storzScraper = new StorzPlaywrightScraper();
  const storzResult = await storzScraper.runAuditScrape({
    headless: true,
    targetCollaborators: rpoInspectors.map((i) => i.name)
  });
  console.log(`   ${storzResult.requests.length} matrícula(s)/curso(s) raspado(s).`);

  const outputPath = path.join(process.cwd(), 'scratch', 'historico_aluno_storz.xlsx');
  await exportToExcel(storzResult.requests, outputPath);
  console.log(`\n✅ Relatório gerado em: ${outputPath}\n`);
}

main().catch((err) => {
  console.error('Erro ao gerar Histórico do Aluno:', err);
  process.exit(1);
});
