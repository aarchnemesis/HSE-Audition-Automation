import { Collection, Db, MongoClient } from 'mongodb'

export interface PortalRejectionRecord {
  id?: string
  portalId: string
  portalName: string
  workerName: string
  docTitle: string
  docCode?: string
  rejectionReasonRaw: string
  observedAt: string
  client?: string
  windfarm?: string
  status: 'PENDING_ANALYSIS' | 'ANALYZED' | 'RESOLVED'
  actionPlan?: {
    causeDiagnosis: string
    recommendedAction: string
    targetTeam: 'EHS' | 'DO' | 'RH' | 'FIELD'
    confidence: number
    updatedAt: string
  }
}

export interface RejectionPlaybook {
  clientPattern: string
  docType: string
  rejectionPattern: string
  rootCause: string
  standardAction: string
  timesEncountered: number
  lastSeenAt: string
}

export class PortalRejectionStore {
  private client: MongoClient | null = null
  private db: Db | null = null
  private readonly uri: string
  private readonly dbName: string

  constructor(
    uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
    dbName = process.env.MONGODB_DB_NAME || 'hse_portais'
  ) {
    this.uri = uri
    this.dbName = dbName
  }

  async connect(): Promise<Db> {
    if (this.db) return this.db
    this.client = new MongoClient(this.uri, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 3000,
    })
    await this.client.connect()
    this.db = this.client.db(this.dbName)
    await this.ensureIndexes(this.db)
    return this.db
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.db = null
    }
  }

  private async ensureIndexes(db: Db): Promise<void> {
    try {
      await db.collection('portal_rejections').createIndex(
        { portalId: 1, workerName: 1, docTitle: 1 },
        { unique: false }
      )
      await db.collection('portal_rejections').createIndex({ status: 1 })
      await db.collection('portal_action_playbooks').createIndex(
        { clientPattern: 1, docType: 1, rejectionPattern: 1 },
        { unique: true }
      )
    } catch {
      // Ignora falhas em ambientes sem permissão de índice
    }
  }

  private getRejectionsCollection(): Collection<PortalRejectionRecord> {
    if (!this.db) throw new Error('MongoDB não conectado. Chame connect() primeiro.')
    return this.db.collection<PortalRejectionRecord>('portal_rejections')
  }

  private getPlaybooksCollection(): Collection<RejectionPlaybook> {
    if (!this.db) throw new Error('MongoDB não conectado. Chame connect() primeiro.')
    return this.db.collection<RejectionPlaybook>('portal_action_playbooks')
  }

  /**
   * Salva ou atualiza uma recusa observada em um portal.
   */
  async recordRejection(rejection: Omit<PortalRejectionRecord, 'status'> & { status?: PortalRejectionRecord['status'] }): Promise<void> {
    const col = this.getRejectionsCollection()
    const filter = {
      portalId: rejection.portalId,
      workerName: rejection.workerName,
      docTitle: rejection.docTitle,
      rejectionReasonRaw: rejection.rejectionReasonRaw,
    }

    const update = {
      $set: {
        ...rejection,
        status: rejection.status || 'PENDING_ANALYSIS',
        observedAt: rejection.observedAt || new Date().toISOString(),
      },
    }

    await col.updateOne(filter, update, { upsert: true })
  }

  /**
   * Retorna recusas pendentes ou ativas.
   */
  async getActiveRejections(limit = 100): Promise<PortalRejectionRecord[]> {
    const col = this.getRejectionsCollection()
    return await col
      .find({ status: { $in: ['PENDING_ANALYSIS', 'ANALYZED'] } })
      .sort({ observedAt: -1 })
      .limit(limit)
      .toArray()
  }

  /**
   * Atualiza a análise e o plano de ação gerados pelo Hermes para uma recusa.
   */
  async updateActionPlan(
    filter: { portalId: string; workerName: string; docTitle: string },
    plan: NonNullable<PortalRejectionRecord['actionPlan']>
  ): Promise<boolean> {
    const col = this.getRejectionsCollection()
    const res = await col.updateOne(filter, {
      $set: {
        actionPlan: plan,
        status: 'ANALYZED',
      },
    })
    return res.matchedCount > 0
  }

  /**
   * Registra ou incrementa um aprendizado (playbook) no banco para consultas futuras.
   */
  async savePlaybookEntry(entry: Omit<RejectionPlaybook, 'timesEncountered' | 'lastSeenAt'>): Promise<void> {
    const col = this.getPlaybooksCollection()
    const filter = {
      clientPattern: entry.clientPattern,
      docType: entry.docType,
      rejectionPattern: entry.rejectionPattern,
    }

    await col.updateOne(
      filter,
      {
        $set: {
          rootCause: entry.rootCause,
          standardAction: entry.standardAction,
          lastSeenAt: new Date().toISOString(),
        },
        $inc: { timesEncountered: 1 },
      },
      { upsert: true }
    )
  }

  /**
   * Consulta playbooks existentes para encontrar soluções conhecidas para um padrão de recusa.
   */
  async findMatchingPlaybook(clientPattern: string, docType: string): Promise<RejectionPlaybook[]> {
    const col = this.getPlaybooksCollection()
    return await col
      .find({
        clientPattern: new RegExp(clientPattern, 'i'),
        docType: new RegExp(docType, 'i'),
      })
      .sort({ timesEncountered: -1 })
      .toArray()
  }
}
