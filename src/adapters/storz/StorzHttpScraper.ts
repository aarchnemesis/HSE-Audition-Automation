import fs from 'fs'
import path from 'path'
import { StorzRequest } from '../../domain/models/StorzRequest.js'
import { getCourseWorkloadHours } from '../../domain/services/ComplianceEngine.js'
import { calculateIdealSlaDays } from '../../domain/services/TrainingPaceCalculator.js'
import {
  classifyTrainingCode,
  mapSituacaoToState,
  parseBrDate,
  parseDossieText,
} from './dossieParser.js'

export interface StorzScrapeOptions {
  username?: string
  password?: string
  targetCollaborators?: string[]
  headless?: boolean
  maxRetries?: number
}

export interface StorzScrapeResult {
  success: boolean
  requests: StorzRequest[]
  log: string[]
}

interface StorzAuthSession {
  handle: number
  elcToken: string
  bearerToken: string
  cookies: string
}

export class StorzHttpScraper {
  private cacheFilePath: string
  private isCustomCachePath: boolean

  constructor(cacheFilePath?: string) {
    this.isCustomCachePath = Boolean(cacheFilePath)
    this.cacheFilePath =
      cacheFilePath || path.join(process.cwd(), 'scratch', 'storz_cache.json')
  }

  async runAuditScrape(
    options?: StorzScrapeOptions
  ): Promise<StorzScrapeResult> {
    const logs: string[] = []
    const log = (msg: string) => {
      console.log(`[StorzHttpScraper] ${msg}`)
      logs.push(msg)
    }

    const user = options?.username || process.env.STORZ_USER
    const pass = options?.password || process.env.STORZ_PASS

    if (!user || !pass) {
      log(
        '⚠️ Credentials (STORZ_USER/STORZ_PASS) not configured. Loading cache.'
      )
      const cached = this.loadCache()
      return { success: true, requests: cached, log: logs }
    }

    const maxRetries = options?.maxRetries ?? 3
    let lastError: unknown

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) {
        const backoffMs = 1500 * 2 ** (attempt - 2)
        log(
          `⏳ Attempt ${attempt}/${maxRetries} after ${backoffMs}ms backoff...`
        )
        await new Promise(resolve => setTimeout(resolve, backoffMs))
      }

      try {
        const requests = await this.scrapeDirect(user, pass, options, log)
        this.saveCache(requests)
        return { success: true, requests, log: logs }
      } catch (err) {
        lastError = err
        log(
          `⚠️ Attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }

    log(
      `❌ All ${maxRetries} attempts failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    )
    const cached = this.loadCache()
    return { success: false, requests: cached, log: logs }
  }

  private async scrapeDirect(
    user: string,
    pass: string,
    options: StorzScrapeOptions | undefined,
    log: (msg: string) => void
  ): Promise<StorzRequest[]> {
    log('⚡ Step 1: Authenticating via direct HTTP API...')
    const session = await this.authenticate(user, pass)
    log(
      `🔑 Authenticated successfully. User handle: ${session.handle}, elc: ${session.elcToken}`
    )

    const targets = options?.targetCollaborators ?? []
    if (targets.length === 0) {
      log('⚠️ No targetCollaborators provided.')
      return []
    }

    const existingCache = this.loadCache()
    const previousMap = new Map<string, StorzRequest>(
      existingCache.map(r => [r.id, r])
    )
    const scrapedRequests: StorzRequest[] = []

    for (const collaboratorName of targets) {
      log(`🔍 Resolving collaborator: "${collaboratorName}" via REST API...`)
      const resolvedUser = await this.searchUserByName(
        collaboratorName,
        session
      )

      if (!resolvedUser) {
        log(`⚠️ Collaborator "${collaboratorName}" not found in Storz.`)
        continue
      }

      log(
        `📄 Fetching student dossier for "${resolvedUser.name}" (ID: ${resolvedUser.handle})...`
      )
      const dossie = await this.fetchDossie(
        session.elcToken,
        resolvedUser.handle,
        session.cookies
      )

      if (!dossie) {
        log(`⚠️ Failed to parse dossier for "${collaboratorName}".`)
        continue
      }

      for (const course of dossie.courses) {
        let trainingCode = classifyTrainingCode(course.turma)
        if (!trainingCode) {
          trainingCode = '99'
        }

        const matriculaId =
          course.codMatricula ||
          `DOSSIE-${collaboratorName}-${course.turma}`.slice(0, 60)

        const iniciadoDate = parseBrDate(course.iniciado)
        const concluidoDate = parseBrDate(course.concluido)

        // Se o curso já tem data oficial de início na Storz, usamos a data real de início.
        // Se o curso foi reprovado/cancelado sem acesso (progresso 0% ou sem data de início), a data de conclusão
        // é na verdade a data em que o prazo expirou na Storz — a matrícula ocorreu (duration) dias antes.
        const durationDays =
          course.tempoCursoDias !== undefined
            ? Number.parseInt(course.tempoCursoDias, 10)
            : 60
        const prog =
          course.progresso !== undefined
            ? Number.parseInt(course.progresso, 10)
            : undefined
        const state = mapSituacaoToState(course.situacao)
        const isReprovadoWithoutAccess =
          (state === 'CANCELADO' ||
            (course.situacao || '').toUpperCase().includes('REPROV')) &&
          (!prog || prog === 0) &&
          !iniciadoDate

        const existing = previousMap.get(matriculaId)
        let requestDate: Date
        if (iniciadoDate) {
          requestDate = iniciadoDate
        } else if (concluidoDate && isReprovadoWithoutAccess) {
          // Retroage o prazo regulamentar para estimar a data real da matrícula que expirou nesta data
          requestDate = new Date(
            concluidoDate.getTime() - durationDays * 24 * 60 * 60 * 1000
          )
        } else if (concluidoDate) {
          requestDate = concluidoDate
        } else if (existing?.requestDate) {
          requestDate = new Date(existing.requestDate)
        } else {
          requestDate = new Date()
        }

        const workloadHours = getCourseWorkloadHours(trainingCode, course.turma)
        const idealSlaDays = calculateIdealSlaDays(workloadHours)

        scrapedRequests.push({
          id: matriculaId,
          collaboratorName,
          collaboratorCpf: dossie.cpf,
          trainingCode,
          trainingName: course.turma,
          modality: course.turma.toUpperCase().includes('ONLINE')
            ? 'ONLINE'
            : 'PRESENCIAL',
          requestDate,
          completionDate: concluidoDate,
          state,
          rawSituacao: course.situacao || undefined,
          progressPercent: prog,
          courseDurationDays: durationDays,
          workloadHours,
          idealSlaDays,
          notes: undefined,
        })
      }
    }

    log(`✅ Scrape complete. Total records gathered: ${scrapedRequests.length}`)
    return scrapedRequests
  }

  private async authenticate(
    user: string,
    pass: string
  ): Promise<StorzAuthSession> {
    const cookieJar = new Map<string, string>()

    const mergeCookies = (header: string[] | string | null | undefined) => {
      if (!header) return
      const list = Array.isArray(header) ? header : [header]
      for (const item of list) {
        const [pair] = item.split(';')
        const [k, v] = pair.split('=')
        if (k && v && v !== 'deleted') {
          cookieJar.set(k.trim(), v.trim())
        }
      }
    }

    const serializeCookies = () =>
      Array.from(cookieJar.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')

    // Step 1: Initial page request to get CSRF token
    const loginPageRes = await fetch(
      'https://storz.sistemaescudo.com.br/admin/auth/index.php'
    )
    const loginPageHtml = await loginPageRes.text()
    mergeCookies(
      loginPageRes.headers.getSetCookie
        ? loginPageRes.headers.getSetCookie()
        : loginPageRes.headers.get('set-cookie')
    )

    const csrfMatch = loginPageHtml.match(
      /var csrfToken\s*=\s*["']([^"']+)["']/
    )
    const csrfToken = csrfMatch ? csrfMatch[1] : ''

    // Step 2: Auth login API call
    const authRes = await fetch(
      'https://storz.sistemaescudo.com.br/admin/api/v2/router.php?action=authLogin',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializeCookies(),
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          ds_login: user,
          ds_senha: pass,
          is_reset: '',
          token_deeplink: '',
          token_lista: '',
          id_unidade: '0',
        }),
      }
    )

    mergeCookies(
      authRes.headers.getSetCookie
        ? authRes.headers.getSetCookie()
        : authRes.headers.get('set-cookie')
    )

    const authJson: any = await authRes.json()
    if (authJson.error) {
      throw new Error(
        `Storz login failed: ${authJson.message || 'Invalid credentials'}`
      )
    }

    const arrPessoa = authJson.result?.arrPessoa
    const handle = arrPessoa?.user_handle
    const elcToken = arrPessoa?.chave_pessoa

    if (!handle || !elcToken) {
      throw new Error('Storz auth response missing user handle or elc token.')
    }

    // Step 3: Session bootstrap to get full cookies and Bearer token
    const mainRes = await fetch(
      `https://storz.sistemaescudo.com.br/admin/main.php?elc=${elcToken}`,
      {
        headers: { Cookie: serializeCookies() },
      }
    )
    mergeCookies(
      mainRes.headers.getSetCookie
        ? mainRes.headers.getSetCookie()
        : mainRes.headers.get('set-cookie')
    )

    const mainHtml = await mainRes.text()
    const bearerMatch = mainHtml.match(/var BEARER\s*=\s*['"]([^'"]+)['"]/)
    const bearerToken = bearerMatch ? bearerMatch[1] : ''

    return {
      handle,
      elcToken,
      bearerToken,
      cookies: serializeCookies(),
    }
  }

  private async searchUserByName(
    collaboratorName: string,
    session: StorzAuthSession
  ): Promise<{ handle: number; name: string } | null> {
    const searchName = collaboratorName.trim()
    const searchRes = await fetch(
      'https://api.sistemaescudo.com.br/v2/users/searchUsers',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.bearerToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          ds_nome: searchName,
          id_pessoa: session.handle,
        }),
      }
    )

    if (!searchRes.ok) {
      return null
    }

    const searchJson: any = await searchRes.json()
    const list: any[] = searchJson.data || []
    if (list.length === 0) return null

    const targetUpper = searchName.toUpperCase()
    // Exact or best match
    const match =
      list.find(u => u.ds_nome?.toUpperCase() === targetUpper) ||
      list.find(u => u.ds_nome?.toUpperCase().includes(targetUpper)) ||
      list[0]

    return {
      handle: match.handle,
      name: match.ds_nome,
    }
  }

  private async fetchDossie(elcToken: string, handle: number, cookies: string) {
    const fd = new URLSearchParams()
    fd.append('saida', 'VIEW')
    fd.append('pessoa', String(handle))

    const dossieRes = await fetch(
      `https://storz.sistemaescudo.com.br/relatorios/dossie_do_aluno/index.php?elc=${elcToken}`,
      {
        method: 'POST',
        headers: {
          Cookie: cookies,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: fd.toString(),
      }
    )

    if (!dossieRes.ok) {
      return null
    }

    const html = await dossieRes.text()
    // Strip tags to get clean inner text for parseDossieText
    const cleanText = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/tr>/gi, '\n')
      .replace(/<\/td>/gi, '\t')
      .replace(/<[^>]+>/g, '')

    return parseDossieText(cleanText)
  }

  public loadCache(): StorzRequest[] {
    const candidates = this.isCustomCachePath
      ? [this.cacheFilePath]
      : [
          this.cacheFilePath,
          path.join(process.cwd(), 'data', 'storz_cache.json'),
          path.join(process.cwd(), 'scratch', 'storz_cache.json'),
        ]

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf-8')
          const data = JSON.parse(raw)
          if (Array.isArray(data) && data.length > 0) {
            return data.map((item: any) => {
              const workloadHours =
                item.workloadHours ||
                getCourseWorkloadHours(item.trainingCode, item.trainingName)
              const idealSlaDays =
                item.idealSlaDays || calculateIdealSlaDays(workloadHours)
              return {
                ...item,
                workloadHours,
                idealSlaDays,
                requestDate: new Date(item.requestDate),
                scheduledDate: item.scheduledDate
                  ? new Date(item.scheduledDate)
                  : undefined,
                completionDate: item.completionDate
                  ? new Date(item.completionDate)
                  : undefined,
              }
            })
          }
        } catch (e) {
          console.warn(
            `[StorzHttpScraper] Error reading JSON cache at ${p}:`,
            e
          )
        }
      }
    }
    return []
  }

  private saveCache(requests: StorzRequest[]): void {
    if (!requests || requests.length === 0) return

    const targets = this.isCustomCachePath
      ? [this.cacheFilePath]
      : [
          this.cacheFilePath,
          path.join(process.cwd(), 'data', 'storz_cache.json'),
        ]

    for (const target of targets) {
      const dir = path.dirname(target)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(target, JSON.stringify(requests, null, 2), 'utf-8')
    }
  }
}
