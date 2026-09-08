import 'dotenv/config'
import { createDriveAdapter } from '../adapters/drive/driveAdapterFactory.js'
import { DummyEmailService } from '../adapters/email/DummyEmailService.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import { StorzPlaywrightAdapter } from '../adapters/storz/StorzPlaywrightAdapter.js'
import { ParkRequirement } from '../domain/models/Certificate.js'
import { AuditTriangulator } from '../domain/services/AuditTriangulator.js'
import { getRequiredDocCodesForProfile } from '../domain/services/EmployeeProfileClassifier.js'
import { IEmailService } from '../ports/IEmailService.js'

const EMAIL_RECIPIENT =
  process.env.HSE_EMAIL_TO || 'joao.oliveira@arthwind.com.br'

const REF_DATE = process.env.HSE_REF_DATE
  ? new Date(process.env.HSE_REF_DATE)
  : new Date()

const PARKS_WITH_MODALITY: ParkRequirement[] = [
  {
    id: 'park_vestas_01',
    parkName: 'Parque Eólico Serra dos Ventos',
    clientName: 'Vestas',
    description: 'Exige NR-35 PRESENCIAL e treinamentos específicos Vestas.',
    requiredDocCodes: getRequiredDocCodesForProfile('CAMPO'),
    requiredModalities: {
      '21': 'PRESENCIAL',
      '22': 'PRESENCIAL',
    },
    location: {
      city: 'Serra do Mel',
      state: 'RN',
      lat: -5.1687,
      lng: -37.0264,
    },
  },
  {
    id: 'park_voltalia_02',
    parkName: 'Parque Solar Sol do Sertão',
    clientName: 'Voltalia',
    description: 'Exige NR-33 Espaço Confinado e LOTO PRESENCIAL.',
    requiredDocCodes: ['01', '08', '10', '12', '14', '20', '22'],
    requiredModalities: {
      '20': 'PRESENCIAL',
      '22': 'PRESENCIAL',
    },
    location: {
      city: 'Oliveira dos Brejinhos',
      state: 'BA',
      lat: -12.3167,
      lng: -42.8958,
    },
  },
]

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    `   HSE AUDIT AUTOMATION - AUDITORIA TRIPLA (DRIVE + RPO + STORZ) & MAPA TS`
  )
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(
    '================================================================================\n'
  )

  const driveAdapter = createDriveAdapter(REF_DATE)
  const storzAdapter = new StorzPlaywrightAdapter()
  const emailService: IEmailService =
    SmtpEmailService.fromEnv() || new DummyEmailService()

  const targetInspectors = await driveAdapter.getInspectors()

  if (targetInspectors[0]) {
    targetInspectors[0].location = {
      city: 'Mossoró',
      state: 'RN',
      lat: -5.1878,
      lng: -37.3442,
    }
  }
  if (targetInspectors[1]) {
    targetInspectors[1].location = {
      city: 'Salvador',
      state: 'BA',
      lat: -12.9777,
      lng: -38.5016,
    }
  }

  const storzRequests = await storzAdapter.getAllRequests()
  console.log(
    `[StorzPlaywrightAdapter] Total de solicitações encontradas na Storz: ${storzRequests.length}\n`
  )

  for (const inspector of targetInspectors) {
    console.log(`👤 INSPETOR: ${inspector.name} (${inspector.role})`)
    console.log(
      `   📍 Localização Atual/Base: ${inspector.location?.city}/${inspector.location?.state}`
    )
    console.log(
      `   Total de certificados no Drive: ${inspector.certificates.size}`
    )
    console.log('-'.repeat(85))

    for (const park of PARKS_WITH_MODALITY) {
      const auditRes = AuditTriangulator.performTripleAudit(
        inspector,
        park,
        storzRequests,
        REF_DATE
      )

      console.log(
        `\n   🏞️  AVALIAÇÃO PARA: ${auditRes.parkName} (Cliente: ${auditRes.clientName})`
      )
      console.log(
        `   📍 Localização do Parque: ${park.location?.city}/${park.location?.state}`
      )

      console.log('\n   Matriz de Conciliação Tripla (Drive vs RPO vs Storz):')
      console.log(
        `   ${'Cód'.padEnd(5)} | ${'Requisito'.padEnd(30)} | ${'Status EHS'.padEnd(18)} | Detalhes & Storz`
      )
      console.log('   ' + '-'.repeat(85))

      for (const item of auditRes.auditItems) {
        console.log(
          `   ${item.code.padEnd(5)} | ${item.reqName.substring(0, 30).padEnd(30)} | [${item.status.padEnd(16)}] | ${item.detail}`
        )
      }

      console.log(
        '\n   -----------------------------------------------------------------'
      )
      let statusFormatted = ''
      if (auditRes.overallStatus === 'APTO') {
        statusFormatted = '🟢 APTO (100% Conforme)'
      } else if (auditRes.overallStatus === 'APTO_COM_ATENCAO') {
        statusFormatted = `🟡 APTO COM ATENÇÃO (${auditRes.warningDocsCount} doc(s) a vencer, ${auditRes.storzPendingCount} solicitado(s) na Storz)`
      } else {
        statusFormatted = `🔴 INAPTO (${auditRes.missingDocsCount} ausente(s), ${auditRes.expiredDocsCount} vencido(s))`
      }
      console.log(`   RESULTADO FINAL DA APTIDÃO: ${statusFormatted}`)
      console.log(
        '   -----------------------------------------------------------------\n'
      )

      if (
        auditRes.warningDocsCount > 0 ||
        auditRes.storzPendingCount > 0 ||
        auditRes.expiredDocsCount > 0
      ) {
        const emailRes = await emailService.sendEHSAlert(
          EMAIL_RECIPIENT,
          inspector.name,
          park.parkName,
          auditRes.auditItems
        )
        console.log(
          `   📧 Alerta de e-mail ${emailRes.success ? 'enviado' : 'falhou'}${emailRes.filePath ? ` (${emailRes.filePath})` : ''}`
        )
      }
    }

    console.log('='.repeat(85) + '\n')
  }

  console.log(
    '================================================================================'
  )
  console.log('   🗺️  SIMULAÇÃO DO MAPA ILUMINADO DE APTIDÃO GEOGRÁFICA')
  console.log(
    '================================================================================'
  )
  console.log(
    ' Selecionar Parque Destino: "Parque Solar Sol do Sertão (Oliveira dos Brejinhos/BA)"'
  )
  console.log('\n Status Iluminado no Mapa:')
  console.log(
    '  🟢 Adriano Cirilo Garcia Lima | Base: Salvador/BA   | Status: APTO COM ATENÇÃO (LOTO em andamento Storz) | Distância: ~430 km'
  )
  console.log(
    '  🟢 Adenilço Queiroz da Silva   | Base: Mossoró/RN   | Status: APTO (100% Conforme)                      | Distância: ~980 km'
  )
  console.log(
    ' 👉 Recomendação de Alocação Eficiente: Adriano Cirilo (Menor custo de mobilização)'
  )
  console.log(
    '================================================================================\n'
  )
}

main().catch(err => {
  console.error('Erro na auditoria Storz:', err)
  process.exit(1)
})
