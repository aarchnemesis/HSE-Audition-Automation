import { HSEDatabaseRecord } from '../../domain/services/HSEDatabaseRepository.js'
import { buildPortalPendencyReport } from '../../domain/services/PortalPendencyReportBuilder.js'
import {
  PortalsDashboardData,
  buildPortalsDashboardData,
} from '../../domain/services/PortalsDashboardData.js'
import { loadPortalCensuses } from '../portais/PortalCensusStore.js'
import { loadProjectBriefing } from '../smartsheet/SmartsheetBriefingAdapter.js'

/**
 * The Briefing comes from the committed cache first: the dashboard is rebuilt by a cron and must
 * never wait on (or fail because of) Smartsheet. An empty token makes the adapter read the cache;
 * only when no cache exists yet do we try the live sheet.
 */
async function loadBriefing() {
  try {
    return await loadProjectBriefing('')
  } catch {
    return await loadProjectBriefing()
  }
}

/**
 * Data for the "Portais de Clientes" tab. Any failure returns undefined and the tab renders its
 * empty state, so a portal-side problem can never stop the main dashboard from being generated.
 */
export async function loadPortalsDashboardData(
  records: HSEDatabaseRecord[],
  refDate: Date = new Date()
): Promise<PortalsDashboardData | undefined> {
  try {
    const censuses = loadPortalCensuses()
    if (!censuses.length) {
      console.warn('[PortalsTab] Nenhum censo em data/portais; aba sem dados.')
      return undefined
    }
    const { projects } = await loadBriefing()
    const report = buildPortalPendencyReport({
      refDate,
      censuses,
      projects,
      baseRecords: records,
    })
    const data = buildPortalsDashboardData(report, refDate)
    console.log(
      `[PortalsTab] ${data.summary.totalProjects} projetos, ${data.platforms.length} plataformas, ${data.summary.blockedPeople} bloqueado(s).`
    )
    return data
  } catch (err) {
    console.warn(
      `[PortalsTab] Falha ao montar a aba de portais (${(err as Error).message}); seguindo sem ela.`
    )
    return undefined
  }
}
