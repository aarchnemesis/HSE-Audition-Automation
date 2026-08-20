import 'dotenv/config';
import { createDriveAdapter } from '../adapters/drive/driveAdapterFactory.js';
import { ComplianceEngine } from '../domain/services/ComplianceEngine.js';
import { ParkRequirement } from '../domain/models/Certificate.js';

const REF_DATE = process.env.HSE_REF_DATE ? new Date(process.env.HSE_REF_DATE) : new Date();

const PARKS: ParkRequirement[] = [
  {
    id: 'park_vestas_01',
    parkName: 'Parque Eólico Serra dos Ventos',
    clientName: 'Vestas',
    description: 'Parque Eólico com aerogeradores Vestas. Exige certificações específicas Vestas e GWO.',
    requiredDocCodes: ['01', '08', '12', '13', '21', '25', '26', '30']
  },
  {
    id: 'park_voltalia_02',
    parkName: 'Parque Solar Sol do Sertão',
    clientName: 'Voltalia',
    description: 'Parque Solar com áreas de média/alta tensão e espaços confinados. Exige NR-33 e LOTO.',
    requiredDocCodes: ['01', '08', '10', '12', '14', '20', '22']
  }
];

async function main() {
  console.log('================================================================================');
  console.log(`   HSE AUDIT AUTOMATION - RELATÓRIO DE APTIDÃO TS (${REF_DATE.toLocaleDateString('pt-BR')})`);
  console.log('================================================================================\n');

  const driveAdapter = createDriveAdapter(REF_DATE);
  const targetInspectors = await driveAdapter.getInspectors();

  console.log(`[DriveFileSystemAdapter] Inspetores processados: ${targetInspectors.length}\n`);

  for (const inspector of targetInspectors) {
    console.log(`👤 INSPETOR: ${inspector.name} (${inspector.role})`);
    console.log(`   Total de certificados identificados: ${inspector.certificates.size}`);
    console.log('-'.repeat(80));

    for (const park of PARKS) {
      const result = ComplianceEngine.evaluateInspectorForPark(inspector, park, REF_DATE);

      console.log(`\n   🏞️  AVALIAÇÃO PARA: ${result.parkName} (Cliente: ${result.clientName})`);
      console.log(`   Descrição: ${park.description}`);
      console.log('\n   Matriz de Requisitos do Parque:');
      console.log(`   ${'Cód'.padEnd(5)} | ${'Requisito'.padEnd(35)} | ${'Status'.padEnd(16)} | Detalhes`);
      console.log('   ' + '-'.repeat(85));

      for (const doc of result.docDetails) {
        console.log(
          `   ${doc.code.padEnd(5)} | ${doc.reqName.substring(0, 35).padEnd(35)} | [${doc.status.padEnd(14)}] | ${doc.detail}`
        );
      }

      console.log('\n   -----------------------------------------------------------------');
      let statusFormatted = '';
      if (result.overallStatus === 'APTO') {
        statusFormatted = '🟢 APTO (100% Conforme)';
      } else if (result.overallStatus === 'APTO_COM_ATENCAO') {
        statusFormatted = `🟡 APTO COM ATENÇÃO (${result.warningDocsCount} doc(s) prestes a vencer)`;
      } else {
        statusFormatted = `🔴 INAPTO (${result.missingDocsCount} ausente(s), ${result.expiredDocsCount} vencido(s))`;
      }
      console.log(`   RESULTADO FINAL DA APTIDÃO: ${statusFormatted}`);
      console.log('   -----------------------------------------------------------------\n');
    }

    console.log('='.repeat(80) + '\n');
  }
}

main().catch((err) => {
  console.error('Erro na execução:', err);
});
