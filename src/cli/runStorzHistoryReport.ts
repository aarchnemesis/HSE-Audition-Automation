import 'dotenv/config';
import ExcelJS from 'exceljs';
import path from 'path';
import { SmartsheetRPOAdapter } from '../adapters/smartsheet/SmartsheetRPOAdapter.js';
import { StorzPlaywrightScraper } from '../adapters/storz/StorzPlaywrightScraper.js';
import { classifyEmployeeProfile } from '../domain/services/EmployeeProfileClassifier.js';
import { DOC_CATALOG_MAP } from '../domain/services/ComplianceEngine.js';
import { StorzRequest } from '../domain/models/StorzRequest.js';
import { groupRetests, RetestAttempt } from '../domain/services/RetestTracker.js';

const REF_DATE = process.env.HSE_REF_DATE ? new Date(process.env.HSE_REF_DATE) : new Date();

/**
 * Gera um "Histórico do Aluno" — um registro por colaborador+curso, no molde do exemplo que a
 * analista de treinamentos mandou (extrato tipo transcript, não status de conformidade). Fonte é
 * só a Storz (é lá que mora o histórico de matrícula/conclusão de curso). Não tem carga horária
 * porque o Dossiê do Aluno na Storz não expõe esse dado — omitido em vez de inventado.
 */
const dateFmt = (d?: Date) => (d ? d.toLocaleDateString('pt-BR') : '');
const situacaoColors: Record<string, string> = {
  APROVADO: 'DCFCE7',
  CONCLUIDO: 'DCFCE7',
  REPROVADO: 'FEE2E2',
  CANCELADO: 'FEE2E2',
  'EM ANDAMENTO': 'FEF9C3'
};
const docLabel = (code: string, name: string) => (DOC_CATALOG_MAP[code] ? `${name} (${DOC_CATALOG_MAP[code]})` : name);

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '25386B' } }; // navy ArthWind
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
}

/**
 * Aba principal: um registro por matrícula, no molde do exemplo da analista de treinamentos —
 * mas com colunas extras de tentativa (Nº da tentativa / total) pra já mostrar reteste aqui
 * também, sem precisar ir na outra aba pra correlacionar.
 */
function buildHistorySheet(workbook: ExcelJS.Workbook, requests: StorzRequest[]): void {
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
    { header: 'Tentativa', key: 'attemptNumber', width: 12 },
    { header: 'Nº Matrícula (Storz)', key: 'id', width: 20 }
  ];
  styleHeader(sheet);

  const groups = groupRetests(requests);
  const attemptByRequestId = new Map<string, RetestAttempt>();
  for (const group of groups) {
    for (const attempt of group.attempts) attemptByRequestId.set(attempt.request.id, attempt);
  }

  const sorted = [...requests].sort(
    (a, b) => a.collaboratorName.localeCompare(b.collaboratorName) || a.requestDate.getTime() - b.requestDate.getTime()
  );

  for (const req of sorted) {
    const situacao = req.rawSituacao || req.state;
    const attempt = attemptByRequestId.get(req.id);
    const totalAttempts = groups.find((g) => g.collaboratorName === req.collaboratorName && g.trainingCode === req.trainingCode)?.attempts.length || 1;

    const row = sheet.addRow({
      collaboratorName: req.collaboratorName,
      collaboratorCpf: req.collaboratorCpf || '',
      trainingCode: req.trainingCode,
      trainingName: docLabel(req.trainingCode, req.trainingName),
      modality: req.modality,
      requestDate: dateFmt(req.requestDate),
      completionDate: dateFmt(req.completionDate),
      situacao,
      attemptNumber: totalAttempts > 1 ? `${attempt?.attemptNumber || 1}/${totalAttempts}` : '',
      id: req.id
    });

    const bg = situacaoColors[situacao.toUpperCase()];
    if (bg) row.getCell('situacao').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  }
}

/**
 * Aba dedicada — controle de reteste: só quem já reprovou pelo menos uma vez em algum curso.
 * Mostra se o reteste já foi feito e aprovado, ou se ainda está pendente (reprovou e não tem
 * aprovação depois disso, seja porque não refez ou porque reprovou de novo).
 */
function buildRetestSheet(workbook: ExcelJS.Workbook, requests: StorzRequest[]): void {
  const sheet = workbook.addWorksheet('Controle de Retestes');

  sheet.columns = [
    { header: 'Colaborador', key: 'collaboratorName', width: 35 },
    { header: 'Código', key: 'trainingCode', width: 10 },
    { header: 'Nome do Curso', key: 'trainingName', width: 45 },
    { header: 'Nº Tentativas', key: 'totalAttempts', width: 14 },
    { header: 'Data da Reprovação', key: 'failedDate', width: 18 },
    { header: 'Reteste Aprovado?', key: 'retestApproved', width: 18 },
    { header: 'Data do Reteste Aprovado', key: 'retestApprovedDate', width: 22 },
    { header: 'Situação Atual', key: 'latestOutcome', width: 16 }
  ];
  styleHeader(sheet);

  const groups = groupRetests(requests).filter((g) => g.hasFailedAttempt);
  groups.sort((a, b) => (a.pendingRetest === b.pendingRetest ? 0 : a.pendingRetest ? -1 : 1) || a.collaboratorName.localeCompare(b.collaboratorName));

  for (const group of groups) {
    const firstFailed = group.attempts.find((a) => a.outcome === 'REPROVADO')!;
    const approvedRetest = group.retestApproved ? [...group.attempts].reverse().find((a) => a.outcome === 'APROVADO') : undefined;

    const row = sheet.addRow({
      collaboratorName: group.collaboratorName,
      trainingCode: group.trainingCode,
      trainingName: docLabel(group.trainingCode, firstFailed.request.trainingName),
      totalAttempts: group.attempts.length,
      failedDate: dateFmt(firstFailed.request.requestDate),
      retestApproved: group.retestApproved ? 'SIM' : 'NÃO',
      retestApprovedDate: approvedRetest ? dateFmt(approvedRetest.request.completionDate || approvedRetest.request.requestDate) : '',
      latestOutcome: group.latestOutcome
    });

    const bg = group.pendingRetest ? 'FEE2E2' : 'DCFCE7';
    row.getCell('retestApproved').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
  }

  console.log(`   ${groups.filter((g) => g.pendingRetest).length} pessoa(s) com reprovação pendente de reteste aprovado (de ${groups.length} com reprovação em algum momento).`);
}

async function exportToExcel(requests: StorzRequest[], outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  buildHistorySheet(workbook, requests);
  buildRetestSheet(workbook, requests);
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
