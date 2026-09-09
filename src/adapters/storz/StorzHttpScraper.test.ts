import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StorzHttpScraper } from './StorzHttpScraper.js'

describe('StorzHttpScraper', () => {
  const testCacheDir = path.join(process.cwd(), 'scratch', 'test_cache')
  const testCachePath = path.join(testCacheDir, 'storz_test_cache.json')

  beforeEach(() => {
    if (!fs.existsSync(testCacheDir)) {
      fs.mkdirSync(testCacheDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(testCachePath)) {
      fs.unlinkSync(testCachePath)
    }
    vi.restoreAllMocks()
  })

  it('loads empty array when cache does not exist', () => {
    const scraper = new StorzHttpScraper(testCachePath)
    const cached = scraper.loadCache()
    expect(cached).toEqual([])
  })

  it('falls back to cache when no credentials are provided', async () => {
    const initialData = [
      {
        id: 'TEST-123',
        collaboratorName: 'TEST USER',
        trainingCode: '21',
        trainingName: 'NR-35 Trabalho em Altura',
        modality: 'PRESENCIAL',
        requestDate: new Date('2026-08-01T00:00:00.000Z'),
        state: 'CONCLUIDO',
      },
    ]
    fs.writeFileSync(testCachePath, JSON.stringify(initialData), 'utf-8')

    const scraper = new StorzHttpScraper(testCachePath)
    const result = await scraper.runAuditScrape({
      username: '',
      password: '',
      targetCollaborators: ['TEST USER'],
    })

    expect(result.success).toBe(true)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].id).toBe('TEST-123')
    expect(result.requests[0].collaboratorName).toBe('TEST USER')
  })

  it('returns empty requests when targetCollaborators is empty', async () => {
    const scraper = new StorzHttpScraper(testCachePath)
    // Mock global fetch to simulate successful auth
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/admin/auth/index.php')) {
        return Promise.resolve({
          headers: new Headers({ 'set-cookie': 'PHPSESSID=mock_session;' }),
          text: () =>
            Promise.resolve(
              '<html><body><script>var csrfToken = "mock_csrf";</script></body></html>'
            ),
        })
      }
      if (url.includes('/admin/api/v2/router.php?action=authLogin')) {
        return Promise.resolve({
          headers: new Headers(),
          json: () =>
            Promise.resolve({
              error: false,
              result: {
                arrPessoa: {
                  user_handle: 12345,
                  chave_pessoa: 'mock_elc',
                },
              },
            }),
        })
      }
      if (url.includes('/admin/main.php')) {
        return Promise.resolve({
          headers: new Headers(),
          text: () =>
            Promise.resolve('<script>var BEARER = "mock_bearer_jwt";</script>'),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    const result = await scraper.runAuditScrape({
      username: 'user_test',
      password: 'pass_test',
      targetCollaborators: [],
    })

    expect(result.success).toBe(true)
    expect(result.requests).toEqual([])
  })

  it('handles user search and dossier download via mock fetch', async () => {
    const scraper = new StorzHttpScraper(testCachePath)

    const sampleDossieHtml = `
      <html>
        <body>
          <p>CPF: 123.456.789-00</p>
          <table>
            <tr>
              <td>Turma: [STORZ] - NR35 TRABALHO EM ALTURA / Tipo: Turma Contínua</td>
              <td>Situação do aluno: Aprovado</td>
              <td>Cod. Matrícula: 998877</td>
              <td>Iniciado: 01/08/2026</td>
              <td>Concluído: 05/08/2026</td>
              <td>Progresso: 100%</td>
            </tr>
          </table>
        </body>
      </html>
    `

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/admin/auth/index.php')) {
        return Promise.resolve({
          headers: new Headers({ 'set-cookie': 'PHPSESSID=mock_session;' }),
          text: () =>
            Promise.resolve(
              '<html><body><script>var csrfToken = "mock_csrf";</script></body></html>'
            ),
        })
      }
      if (url.includes('/admin/api/v2/router.php?action=authLogin')) {
        return Promise.resolve({
          headers: new Headers(),
          json: () =>
            Promise.resolve({
              error: false,
              result: {
                arrPessoa: {
                  user_handle: 12345,
                  chave_pessoa: 'mock_elc',
                },
              },
            }),
        })
      }
      if (url.includes('/admin/main.php')) {
        return Promise.resolve({
          headers: new Headers(),
          text: () =>
            Promise.resolve('<script>var BEARER = "mock_bearer_jwt";</script>'),
        })
      }
      if (url.includes('/v2/users/searchUsers')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  handle: 54321,
                  ds_nome: 'ALEXANDRE SILVA',
                },
              ],
            }),
        })
      }
      if (url.includes('/relatorios/dossie_do_aluno/index.php')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(sampleDossieHtml),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    const result = await scraper.runAuditScrape({
      username: 'user_test',
      password: 'pass_test',
      targetCollaborators: ['ALEXANDRE SILVA'],
    })

    expect(result.success).toBe(true)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0]).toMatchObject({
      collaboratorName: 'ALEXANDRE SILVA',
      collaboratorCpf: '123.456.789-00',
      trainingCode: '21',
      id: '998877',
      state: 'CONCLUIDO',
    })
  })

  it('preserves requestDate from cache for uninitiated courses (immutable firstSeenAt)', async () => {
    const tenDaysAgo = new Date('2026-08-30T10:00:00.000Z')
    const initialCache = [
      {
        id: 'MAT-555',
        collaboratorName: 'ALEXANDRE SILVA',
        trainingCode: '10',
        trainingName: 'NR-01 Integração EHS',
        modality: 'ONLINE',
        requestDate: tenDaysAgo,
        state: 'SOLICITADO',
        rawSituacao: 'Não iniciado',
      },
    ]
    fs.writeFileSync(testCachePath, JSON.stringify(initialCache), 'utf-8')

    const uninitiatedDossieHtml = `
      <html>
        <body>
          CPF: 123.456.789-00
          <table>
            <tr>
              <td>Turma: [STORZ] - NR1 - DISPOSIÇÕES GERAIS / Tipo: Turma Contínua</td>
              <td>Situação do aluno: Não iniciado</td>
              <td>Cod. Matrícula: MAT-555</td>
              <td>Iniciado: -</td>
              <td>Concluído: -</td>
              <td>Progresso: 0%</td>
            </tr>
          </table>
        </body>
      </html>
    `

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/admin/auth/index.php')) {
        return Promise.resolve({
          headers: new Headers({ 'set-cookie': 'PHPSESSID=mock_session;' }),
          text: () =>
            Promise.resolve(
              '<html><body><script>var csrfToken = "mock_csrf";</script></body></html>'
            ),
        })
      }
      if (url.includes('/admin/api/v2/router.php?action=authLogin')) {
        return Promise.resolve({
          headers: new Headers(),
          json: () =>
            Promise.resolve({
              error: false,
              result: {
                arrPessoa: {
                  user_handle: 12345,
                  chave_pessoa: 'mock_elc',
                },
              },
            }),
        })
      }
      if (url.includes('/admin/main.php')) {
        return Promise.resolve({
          headers: new Headers(),
          text: () =>
            Promise.resolve('<script>var BEARER = "mock_bearer_jwt";</script>'),
        })
      }
      if (url.includes('/v2/users/searchUsers')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [
                {
                  handle: 54321,
                  ds_nome: 'ALEXANDRE SILVA',
                },
              ],
            }),
        })
      }
      if (url.includes('/relatorios/dossie_do_aluno/index.php')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(uninitiatedDossieHtml),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })

    vi.stubGlobal('fetch', fetchMock)

    const scraper = new StorzHttpScraper(testCachePath)
    const result = await scraper.runAuditScrape({
      username: 'user_test',
      password: 'pass_test',
      targetCollaborators: ['ALEXANDRE SILVA'],
    })

    expect(result.success).toBe(true)
    expect(result.requests).toHaveLength(1)
    expect(result.requests[0].id).toBe('MAT-555')
    expect(result.requests[0].requestDate.toISOString()).toBe(
      tenDaysAgo.toISOString()
    )
  })
})
