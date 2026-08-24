import 'dotenv/config';
import { createDriveAdapter } from '../adapters/drive/driveAdapterFactory.js';
import { SmartsheetRPOAdapter } from '../adapters/smartsheet/SmartsheetRPOAdapter.js';
import { StorzPlaywrightScraper } from '../adapters/storz/StorzPlaywrightScraper.js';
import { AuditTriangulator } from '../domain/services/AuditTriangulator.js';
import { HSEDatabaseRepository } from '../domain/services/HSEDatabaseRepository.js';
import { HSEFilterEngine } from '../domain/services/HSEFilterEngine.js';
import { buildRoster } from '../domain/services/InspectorRosterBuilder.js';
import { buildPendencyDigest } from '../domain/services/PendencyDigestBuilder.js';
import { PRESENCIAL_REQUIRED_DOC_CODES } from '../domain/services/ComplianceEngine.js';
import { DummyEmailService } from '../adapters/email/DummyEmailService.js';
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js';
import { IEmailService } from '../ports/IEmailService.js';
import { Inspector, ParkRequirement } from '../domain/models/Certificate.js';

const REF_DATE = process.env.HSE_REF_DATE ? new Date(process.env.HSE_REF_DATE) : new Date();
const EMAIL_RECIPIENT = process.env.HSE_EMAIL_TO || 'operacoes.ehs@arthwind.com';

const MODALITY_REQUIREMENTS: ParkRequirement['requiredModalities'] = Object.fromEntries(
  Array.from(PRESENCIAL_REQUIRED_DOC_CODES, (code) => [code, 'PRESENCIAL' as const])
);

async function main() {
  console.log('================================================================================');
  console.log(`   HSE AUDIT AUTOMATION - CONSOLIDAÇÃO DE DADOS, STORZ PLAYWRIGHT & FILTROS`);
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`);
  console.log('================================================================================\n');

  // 1. Instanciar Adaptadores e Repositórios
  const driveAdapter = createDriveAdapter(REF_DATE);
  const rpoAdapter = SmartsheetRPOAdapter.fromEnv(REF_DATE);
  const storzScraper = new StorzPlaywrightScraper();
  const dbRepo = new HSEDatabaseRepository();
  const filterEngine = new HSEFilterEngine(dbRepo);

  // 2. Montar o universo de pessoas a auditar. A RPO é quem decide "quem existe" — cobre campo
  //    E administrativo/visibilidade, diferente do Drive que só tem pasta pra quem é campo. Sem
  //    RPO configurada, cai pro comportamento antigo (só quem tem pasta no Drive, perfil CAMPO).
  const driveInspectors = await driveAdapter.getInspectors();
  console.log(`[DriveAdapter] Inspetores lidos do Drive: ${driveInspectors.length}`);

  let roster: { inspector: Inspector; requiredDocCodes: string[]; profile: string; hasDriveFolder: boolean }[];
  if (rpoAdapter) {
    const rpoInspectors = await rpoAdapter.readRPOData();
    console.log(`[SmartsheetRPOAdapter] Pessoas lidas da RPO: ${rpoInspectors.length}`);
    roster = buildRoster(rpoInspectors, driveInspectors);
    console.log(`[Roster] ${roster.length} pessoa(s) no universo de auditoria (excluídos os desligados).`);
  } else {
    console.log('[Roster] SMARTSHEET_API_TOKEN/SMARTSHEET_RPO_SHEET_ID não configurados — usando só quem tem pasta no Drive (perfil CAMPO).');
    roster = driveInspectors.map((inspector) => ({
      inspector,
      requiredDocCodes: ['01', '08', '12', '13', '21', '22', '25', '26', '30'],
      profile: 'CAMPO',
      hasDriveFolder: true
    }));
  }

  // 3. Executar Raspagem/Leitura na Storz (Dossiê do Aluno por colaborador)
  console.log('🤖 Executando raspagem / auditoria na plataforma Storz...');
  const storzResult = await storzScraper.runAuditScrape({
    headless: true,
    targetCollaborators: roster.map((r) => r.inspector.name)
  });
  console.log(`[StorzScraper] Finalizado. Total de matrículas/cursos raspados: ${storzResult.requests.length}\n`);

  // 4. Rodar a Auditoria Tripla — o pacote de documentos exigido varia por perfil (campo x
  //    administrativo), mas o cruzamento com Drive/Storz é o mesmo para todo mundo.
  const auditResults = roster.map(({ inspector, requiredDocCodes, profile }) => {
    const park: ParkRequirement = {
      id: `perfil_${profile.toLowerCase()}`,
      parkName: `Perfil ${profile}`,
      clientName: '-',
      description: `Requisitos do perfil ${profile}`,
      requiredDocCodes,
      requiredModalities: MODALITY_REQUIREMENTS
    };
    return AuditTriangulator.performTripleAudit(inspector, park, storzResult.requests, REF_DATE);
  });

  // 5. Salvar o Instantâneo Consolidado no Banco de Dados HSE
  dbRepo.saveAuditSnapshot(auditResults, roster.map((r) => r.inspector));

  // 6. Testar Consultas / Filtros para a Equipe HSE
  console.log('\n================================================================================');
  console.log('   🔍 TESTANDO FILTROS DA EQUIPE HSE NO BANCO DE DADOS');
  console.log('================================================================================');

  // Consulta 1: Mostrar todas as solicitações ativas na Storz
  const storzPendingRecords = filterEngine.query({ storzOnly: true });
  console.log(`\n📌 Consulta 1: Solicitações em Andamento na Storz (${storzPendingRecords.length} resultado(s)):`);
  storzPendingRecords.forEach((r) => {
    console.log(` - Inspetor: ${r.inspectorName} | Doc: ${r.docCode} (${r.docName}) | Storz ID: ${r.storzRequestId} [${r.storzState}]`);
  });

  // Consulta 2: Mostrar itens com vencimento em 30 dias, solicitados ou em andamento na Storz
  const warningRecords = filterEngine.query({ statusEHS: ['VENCE_30', 'SOLICITADO_STORZ', 'STORZ_EM_ANDAMENTO'] });
  console.log(`\n⚠️ Consulta 2: Itens em Alerta (Vence 30d ou Storz) (${warningRecords.length} resultado(s)):`);
  warningRecords.forEach((r) => {
    console.log(` - ${r.inspectorName} | ${r.docName} | Status: ${r.statusEHS} | Details: ${r.detail}`);
  });

  // 7. Exportar o Relatório Excel Formato Oficial para HSE
  console.log('\n================================================================================');
  console.log('   📊 GERANDO RELATÓRIO EXCEL CONSOLIDADO PARA A EQUIPE HSE');
  console.log('================================================================================');
  const excelPath = await filterEngine.exportToExcel(dbRepo.getAllRecords());
  console.log(`✅ Relatório gerado em: ${excelPath}\n`);

  // 8. Enviar o resumo diário — um único e-mail agrupando todo mundo com pendência, em vez de
  //    um e-mail por inspetor. Frequência de disparo ainda não definida com o time de HSE.
  console.log('================================================================================');
  console.log('   📧 ENVIANDO RESUMO DIÁRIO DE PENDÊNCIAS');
  console.log('================================================================================');
  const emailService: IEmailService = SmtpEmailService.fromEnv() || new DummyEmailService();
  const digestGroups = buildPendencyDigest(dbRepo.getAllRecords());
  const digestRes = await emailService.sendDailyDigest(EMAIL_RECIPIENT, digestGroups, REF_DATE);
  console.log(`   ${digestGroups.length} pessoa(s) com pendência incluída(s) no resumo.`);
  console.log(`   Resumo ${digestRes.success ? 'enviado' : 'falhou'}${digestRes.filePath ? ` (${digestRes.filePath})` : ''}\n`);
}

main().catch((err) => {
  console.error('Erro na execução do relatório HSE:', err);
});
