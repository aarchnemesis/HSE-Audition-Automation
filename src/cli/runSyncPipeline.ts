import 'dotenv/config'
import { HSEDataPipeline } from '../domain/services/HSEDataPipeline.js'

const refDateArg = process.argv
  .find(a => a.startsWith('--ref-date='))
  ?.split('=')[1]
const REF_DATE = refDateArg
  ? new Date(refDateArg)
  : process.env.HSE_REF_DATE
    ? new Date(process.env.HSE_REF_DATE)
    : new Date()

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   HSE AUDIT AUTOMATION - PIPELINE DE SINCRONIZAÇÃO UNIFICADA (SSOT)'
  )
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(
    '================================================================================\n'
  )

  const pipeline = new HSEDataPipeline()
  const result = await pipeline.executeSync({ refDate: REF_DATE })

  console.log(
    '\n================================================================================'
  )
  console.log('   RESUMO DA BASE ÚNICA CONSOLIDADA (SSOT)')
  console.log(
    '================================================================================'
  )
  console.log(` - Data de Referência: ${result.metadata.refDate}`)
  console.log(` - Pastas no Drive: ${result.metadata.driveFoldersCount}`)
  console.log(
    ` - Colaboradores na RPO (Total / Ativos): ${result.metadata.rpoTotalCount} / ${result.metadata.rpoActiveCount}`
  )
  console.log(
    ` - Roster EHS (Campo / Treinamentos): ${result.metadata.ehsRosterCount}`
  )
  console.log(
    ` - Matrículas Storz: ${result.metadata.storzRequestsCount} (${result.metadata.storzSource})`
  )
  console.log(
    ` - Registros de Conformidade EHS: ${result.metadata.complianceTotalRecords}`
  )
  console.log(
    ` - Divergências Drive x RPO: ${result.metadata.divergencesCount}`
  )
  for (const [kind, count] of Object.entries(
    result.metadata.divergencesByKind
  )) {
    console.log(`    * ${kind}: ${count}`)
  }
  console.log(
    '\nBase de dados SSOT atualizada com sucesso em data/ e scratch/.'
  )
}

main().catch(err => {
  console.error('[SSOT Sync] Erro fatal durante a sincronização:', err)
  process.exit(1)
})
