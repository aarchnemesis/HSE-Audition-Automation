import 'dotenv/config'
import { PortalRejectionStore } from '../adapters/mongodb/PortalRejectionStore.js'
import { RejectionAnalyzer } from '../domain/services/RejectionAnalyzer.js'

async function main() {
  console.log('[AnalyzeRejections] Iniciando motor de triagem e análise de recusas...')

  const mongoUri =
    process.env.MONGODB_URI ||
    'mongodb://arthwind_admin:arthwind_mongo_2026%21@127.0.0.1:27017/arthwind_db?authSource=admin'
  const dbName = process.env.MONGODB_DB_NAME || 'arthwind_db'

  const store = new PortalRejectionStore(mongoUri, dbName)
  const analyzer = new RejectionAnalyzer()

  try {
    await store.connect()
    console.log('[AnalyzeRejections] Conectado ao MongoDB.')

    const activeRejections = await store.getActiveRejections(500)
    console.log(`[AnalyzeRejections] Encontradas ${activeRejections.length} recusas ativas no MongoDB.`)

    let analyzedCount = 0
    let playbooksUpdated = 0

    for (const rej of activeRejections) {
      // Se ainda não tiver plano ou estiver pendente, analisa
      if (rej.status === 'PENDING_ANALYSIS' || !rej.actionPlan) {
        const analysis = analyzer.analyze({
          portalId: rej.portalId,
          docTitle: rej.docTitle,
          rejectionReasonRaw: rej.rejectionReasonRaw,
          workerName: rej.workerName,
        })

        const plan = analyzer.toActionPlan(analysis)
        const updated = await store.updateActionPlan(
          {
            portalId: rej.portalId,
            workerName: rej.workerName,
            docTitle: rej.docTitle,
          },
          plan
        )

        if (updated) {
          analyzedCount++
          // Grava no catálogo de playbooks para enriquecimento contínuo
          await store.savePlaybookEntry({
            clientPattern: rej.portalId,
            docType: rej.docTitle,
            rejectionPattern: (rej.rejectionReasonRaw || '').slice(0, 150),
            rootCause: analysis.causeDiagnosis,
            standardAction: analysis.recommendedAction,
          })
          playbooksUpdated++
        }
      }
    }

    console.log(
      `[AnalyzeRejections] Concluído com sucesso! Recusas analisadas: ${analyzedCount}. Playbooks atualizados: ${playbooksUpdated}.`
    )
  } catch (err) {
    console.error('[AnalyzeRejections] Erro ao executar motor de triagem:', err)
    process.exit(1)
  } finally {
    await store.close()
  }
}

main().catch(err => {
  console.error('[AnalyzeRejections] Falha fatal:', err)
  process.exit(1)
})
