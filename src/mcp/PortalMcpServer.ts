import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { PortalRejectionStore } from '../adapters/mongodb/PortalRejectionStore.js'
import { loadPortalCensuses } from '../adapters/portais/PortalCensusStore.js'
import { loadProjectBriefing } from '../adapters/smartsheet/SmartsheetBriefingAdapter.js'
import { buildPortalPendencyReport } from '../domain/services/PortalPendencyReportBuilder.js'
import { HSEDatabaseRepository } from '../domain/services/HSEDatabaseRepository.js'

export class PortalMcpServer {
  private server: Server
  private rejectionStore: PortalRejectionStore

  constructor(rejectionStore?: PortalRejectionStore) {
    this.rejectionStore = rejectionStore || new PortalRejectionStore()
    this.server = new Server(
      {
        name: 'hse-portal-bridge',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    this.registerHandlers()
  }

  private registerHandlers(): void {
    // 1. Listagem de Tools disponíveis para o Hermes
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'portal_get_active_rejections',
            description:
              'Obtém lista de recusas e reprovações de documentos nos portais de clientes (TDoc, Veriduss, eGestiona, etc.) que estão pendentes de análise.',
            inputSchema: {
              type: 'object',
              properties: {
                limit: {
                  type: 'number',
                  description: 'Limite máximo de registros a retornar (padrão 50)',
                },
              },
            },
          },
          {
            name: 'portal_record_rejection_plan',
            description:
              'Grava no MongoDB o diagnóstico do Hermes sobre o motivo da recusa e o plano de ação recomendado para a equipe (EHS, RH ou Campo).',
            inputSchema: {
              type: 'object',
              properties: {
                portalId: { type: 'string', description: 'ID do portal (ex: tdoc-sgre, veriduss-goldwind)' },
                workerName: { type: 'string', description: 'Nome completo do colaborador' },
                docTitle: { type: 'string', description: 'Título do documento recusado' },
                causeDiagnosis: { type: 'string', description: 'Diagnóstico da causa raiz identificada pelo Hermes' },
                recommendedAction: { type: 'string', description: 'Ação exata recomendada para aprovar o documento' },
                targetTeam: {
                  type: 'string',
                  enum: ['EHS', 'DO', 'RH', 'FIELD'],
                  description: 'Equipe responsável por executar a ação',
                },
                confidence: { type: 'number', description: 'Grau de confiança da análise (0 a 1)' },
              },
              required: [
                'portalId',
                'workerName',
                'docTitle',
                'causeDiagnosis',
                'recommendedAction',
                'targetTeam',
              ],
            },
          },
          {
            name: 'portal_query_playbook',
            description:
              'Consulta o banco de conhecimento no MongoDB por padrões anteriores de recusa para um cliente e tipo de documento.',
            inputSchema: {
              type: 'object',
              properties: {
                clientPattern: { type: 'string', description: 'Nome do cliente (ex: SGRE, Vestas, Goldwind)' },
                docType: { type: 'string', description: 'Tipo do documento (ex: ASO, NR-35, CNH)' },
              },
              required: ['clientPattern', 'docType'],
            },
          },
          {
            name: 'portal_get_unmonitored_gaps',
            description:
              'Retorna a lista de clientes e campanhas ativas que NÃO possuem API ou leitura automática de portal (ex: SharePoint, E-mail, AES, Engie) para intervenção estratégica do Hermes.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      }
    })

    // 2. Execução das Tools chamadas pelo Hermes
    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: args } = request.params

      try {
        await this.rejectionStore.connect()

        switch (name) {
          case 'portal_get_active_rejections': {
            const limit = Number((args as any)?.limit) || 50
            const rejections = await this.rejectionStore.getActiveRejections(limit)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(rejections, null, 2),
                },
              ],
            }
          }

          case 'portal_record_rejection_plan': {
            const p = args as any
            const ok = await this.rejectionStore.updateActionPlan(
              {
                portalId: p.portalId,
                workerName: p.workerName,
                docTitle: p.docTitle,
              },
              {
                causeDiagnosis: p.causeDiagnosis,
                recommendedAction: p.recommendedAction,
                targetTeam: p.targetTeam,
                confidence: p.confidence ?? 0.9,
                updatedAt: new Date().toISOString(),
              }
            )

            // Registra também no playbook coletivo se for um padrão reaproveitável
            await this.rejectionStore.savePlaybookEntry({
              clientPattern: p.portalId.split('-')[1]?.toUpperCase() || p.portalId,
              docType: p.docTitle,
              rejectionPattern: p.causeDiagnosis,
              rootCause: p.causeDiagnosis,
              standardAction: p.recommendedAction,
            })

            return {
              content: [
                {
                  type: 'text',
                  text: ok
                    ? `Plano de ação registrado com sucesso no MongoDB para ${p.workerName} (${p.docTitle}).`
                    : `Registro atualizado no playbook, mas pendência específica não encontrada em aberto.`,
                },
              ],
            }
          }

          case 'portal_query_playbook': {
            const { clientPattern, docType } = args as any
            const playbooks = await this.rejectionStore.findMatchingPlaybook(clientPattern, docType)
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(playbooks, null, 2),
                },
              ],
            }
          }

          case 'portal_get_unmonitored_gaps': {
            const censuses = loadPortalCensuses()
            const { projects } = await loadProjectBriefing()
            const baseRecords = new HSEDatabaseRepository().getAllRecords()
            const report = buildPortalPendencyReport({
              refDate: new Date(),
              censuses,
              projects,
              baseRecords,
            })

            const gapsSummary = report.gaps.map(g => ({
              client: g.client,
              projects: g.projects,
              scheduledPeople: g.people,
              nextStart: g.nextStart,
              method: g.portals.length ? g.portals[0].system : 'Manual / E-mail / SharePoint',
            }))

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(gapsSummary, null, 2),
                },
              ],
            }
          }

          default:
            throw new Error(`Ferramenta desconhecida: ${name}`)
        }
      } catch (err: any) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Erro ao executar ${name}: ${err?.message || String(err)}`,
            },
          ],
        }
      }
    })
  }

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    console.error('[PortalMcpServer] Ponte MCP para Hermes rodando via stdio.')
  }
}
