import 'dotenv/config'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { CertificateClassifier } from '../domain/services/CertificateClassifier.js'
import { DriveNomenclatureStandardizer } from '../domain/services/DriveNomenclatureStandardizer.js'
import { DrivePdfMerger } from '../domain/services/DrivePdfMerger.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function parseDateDmy(str: string): Date | null {
  if (!str) return null
  const norm = str.replace(/_/g, ' ')
  // 1. Padrão DMY: DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY ou DD MM YYYY
  const dmyMatch = norm.match(
    /(?:^|\D)(\d{2})[\s\.\/-](\d{2})[\s\.\/-](\d{2,4})(?:\D|$)/
  )
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10)
    const month = parseInt(dmyMatch[2], 10) - 1
    let year = parseInt(dmyMatch[3], 10)
    if (year < 100) year += 2000
    if (
      month >= 0 &&
      month <= 11 &&
      day >= 1 &&
      day <= 31 &&
      year >= 1990 &&
      year <= 2045
    ) {
      return new Date(Date.UTC(year, month, day))
    }
  }
  // 2. Padrão ISO: YYYY-MM-DD
  const isoMatch = norm.match(
    /(?:^|\D)(\d{4})[\.\/-](\d{2})[\.\/-](\d{2})(?:\D|$)/
  )
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10)
    const month = parseInt(isoMatch[2], 10) - 1
    const day = parseInt(isoMatch[3], 10)
    if (
      month >= 0 &&
      month <= 11 &&
      day >= 1 &&
      day <= 31 &&
      year >= 1990 &&
      year <= 2045
    ) {
      return new Date(Date.UTC(year, month, day))
    }
  }
  return null
}

export function subtractValidityYears(expDate: Date, code: string): Date {
  const annualCodes = new Set(['01', '06', '20', '28', '34'])
  const years = annualCodes.has(code) ? 1 : 2
  return new Date(
    Date.UTC(
      expDate.getUTCFullYear() - years,
      expDate.getUTCMonth(),
      expDate.getUTCDate()
    )
  )
}

export function resolveCourseStartDate(
  fileId: string,
  origName: string,
  currentName: string,
  code: string,
  preCacheMap: Map<string, any>
): Date | null {
  // 1. Prioridade absoluta: data que já constava no nome original antes da Fase 1 (se <= 2026)
  const dOrig = parseDateDmy(origName)
  if (dOrig && dOrig.getUTCFullYear() <= 2026) {
    return dOrig
  }

  // 2. Data de emissão (issueDate) extraída do conteúdo do PDF antes da Fase 1 (se <= 2026)
  const cached = preCacheMap.get(fileId)
  if (cached?.issueDate) {
    const dCache = new Date(cached.issueDate)
    if (!isNaN(dCache.getTime()) && dCache.getUTCFullYear() <= 2026) {
      return dCache
    }
  }

  // 3. Se a data presente no nome atual ou original for > 2026 (vencimento), subtrai a validade da norma
  const dCurr = parseDateDmy(currentName) || dOrig
  if (dCurr) {
    if (dCurr.getUTCFullYear() > 2026) {
      return subtractValidityYears(dCurr, code)
    }
    return dCurr
  }

  // 4. Fallback para expirationDate do cache subtraindo a validade
  if (cached?.expirationDate) {
    const dExp = new Date(cached.expirationDate)
    if (!isNaN(dExp.getTime()) && dExp.getUTCFullYear() < 2040) {
      if (dExp.getUTCFullYear() > 2026) {
        return subtractValidityYears(dExp, code)
      }
      return dExp
    }
  }

  return null
}

export function resolveTrueFileCode(
  origName: string,
  firstTargetName: string
): string {
  const up = origName.toUpperCase()

  // Cartas de Anuência explícitas no nome original
  if (/\bCARTA\b.*NR\s*[-–_]?\s*10|^12\.[12]\b/i.test(origName)) return '12.1'
  if (/\bCARTA\b.*NR\s*[-–_]?\s*12|^15\.1\b|^16\.1\b/i.test(origName))
    return '15.1'
  if (/\bCARTA\b.*NR\s*[-–_]?\s*33|^20\.1\b/i.test(origName)) return '20.1'
  if (/\bCARTA\b.*NR\s*[-–_]?\s*35|^21\.1\b/i.test(origName)) return '21.1'

  // Documentos específicos que tinham numeração de ramo ou subcódigo no nome original
  if (/^14\.1\b/i.test(origName) && /NR\s*[-–_]?\s*11|TALHA/i.test(origName))
    return '14'
  if (/^06\b|^06\.1\b/i.test(origName) && /EPI|CHECKLIST/i.test(origName))
    return '06'
  if (/^02\b/i.test(origName) && /ORDEM\s+DE\s+SERVI|OS\b/i.test(origName))
    return '02'
  if (/^27\b|^28\b|^33\b|^35\b/i.test(origName) && /ELEVADOR/i.test(origName))
    return '31'
  if (/^31\b/i.test(origName) && /CIPA|NR\s*[-–_]?\s*0?5/i.test(origName))
    return '34'
  if (/\bSART[-_]?[HN]\b|\bART[-_]?[HN]R?\b/i.test(origName)) return '32'

  // Classificação semântica/prefixo direta sobre o nome original (sem ruído de páginas secundárias)
  const classified = CertificateClassifier.classify(origName)
  if (classified.code) {
    if (classified.code === '04.1') {
      return '04'
    }
    // Se no nome original era "20 – NR – 33 (Supervisor...)", mantemos '20' quando estamos agrupando NR-33
    // ou usamos o código do primeiro target se for compatível
    const firstCodeMatch = firstTargetName.match(/^(\d{1,2}(?:\.\d+)?)/)
    const firstCode = firstCodeMatch ? firstCodeMatch[1] : null
    if (classified.code === '28' && firstCode === '20') {
      return '20'
    }
    return classified.code
  }

  const m = firstTargetName.match(/^(\d{1,2}(?:\.\d+)?)/)
  return m ? m[1] : '00'
}

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   ATUALIZACAO DE DATAS DOS CURSOS PARA DATA DE INICIO (PADRAO DARLIANE)'
  )
  console.log(
    '================================================================================\n'
  )

  const isLive =
    process.argv.includes('--execute') || process.argv.includes('--run')
  const delayArg = process.argv
    .find(a => a.startsWith('--delay='))
    ?.split('=')[1]
  const delayMs = delayArg ? parseInt(delayArg, 10) : 120

  // Carrega cache pre-Fase 1 do git (commit 9e6085a)
  let preCache: any[] = []
  try {
    const rawCache = execSync('git show 9e6085a:data/pdf_content_cache.json', {
      maxBuffer: 50 * 1024 * 1024,
    }).toString('utf8')
    preCache = JSON.parse(rawCache)
  } catch {
    const fallbackPath = path.join(
      process.cwd(),
      'data',
      'pdf_content_cache.json'
    )
    if (fs.existsSync(fallbackPath)) {
      preCache = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'))
    }
  }
  const preCacheMap = new Map<string, any>(preCache.map(p => [p.fileId, p]))

  const execLogPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_execution_log.json'
  )
  const fase2GroupsPath = path.join(
    process.cwd(),
    'scratch',
    'fase2_merge_groups.json'
  )
  const fase2LogPath = path.join(
    process.cwd(),
    'scratch',
    'drive_fase2_execution_log.json'
  )

  const execLog: any[] = JSON.parse(fs.readFileSync(execLogPath, 'utf8'))
  const fase2Groups: any[] = JSON.parse(
    fs.readFileSync(fase2GroupsPath, 'utf8')
  )
  const fase2Log: any[] = JSON.parse(fs.readFileSync(fase2LogPath, 'utf8'))

  // Mapa de fileId -> lista de operações na Fase 1
  const p1ByFileId = new Map<string, any[]>()
  for (const entry of execLog) {
    if (!p1ByFileId.has(entry.fileId)) p1ByFileId.set(entry.fileId, [])
    p1ByFileId.get(entry.fileId)!.push(entry)
  }

  // Mapa de fileId -> originalName antes da Fase 1
  const origNameByFileId = new Map<string, string>()
  for (const [fId, logs] of p1ByFileId.entries()) {
    origNameByFileId.set(fId, logs[0].originalName)
  }

  // Conjunto de todos os fileIds que entraram nos 170 grupos da Fase 2
  const fase2FileIds = new Set<string>()
  for (const g of fase2Groups) {
    for (const f of g.files) {
      fase2FileIds.add(f.fileId)
    }
  }

  // IDs atualizados manualmente em updateSemDataFilesLive.ts que devem ser preservados ou tratados
  const manualKeepIds = new Set([
    '1mR4fB7p37mG6m33uC-c-W6u88p_s2y2B', // Thayna Seguro
    '12iC_l7V0W8T6c-X6W0A2m_8xS6r-Y2v1', // Ramon Seguro
    '1wP-V7rT3zX8qL5nM2k-J9hF4dG1sA6b0', // Alisson ZIP
  ])

  // -------------------------------------------------------------------------
  // PARTE 1: Planejamento dos 170 Grupos da Fase 2 (F+R)
  // -------------------------------------------------------------------------
  interface Fase2UpdatePlan {
    type: 'RENAME_MERGED' | 'UNMERGE_AND_RESTORE' | 'SEPARATE_AND_REMERGE'
    collab: string
    code: string
    folderId: string
    mergedFileId: string
    oldMergedName: string
    newMergedName?: string
    validFiles: Array<{
      fileId: string
      origName: string
      trueCode: string
      startDate: Date | null
      restoredName: string
    }>
    separatedFiles: Array<{
      fileId: string
      origName: string
      trueCode: string
      startDate: Date | null
      restoredName: string
    }>
  }

  const fase2Plans: Fase2UpdatePlan[] = []

  for (let i = 0; i < fase2Groups.length; i++) {
    const g = fase2Groups[i]
    const logEntry = fase2Log[i]
    const mergedFileId = logEntry?.mergedFileId || ''

    const validFiles: Fase2UpdatePlan['validFiles'] = []
    const separatedFiles: Fase2UpdatePlan['separatedFiles'] = []

    for (const f of g.files) {
      const origName = origNameByFileId.get(f.fileId) || f.fileName
      const trueCode = resolveTrueFileCode(origName, f.fileName)

      const isCarta =
        ['12.1', '15.1', '20.1', '21.1'].includes(trueCode) ||
        /\bCARTA\b/i.test(origName)

      const isWrongCourse =
        !isCarta &&
        trueCode !== g.code &&
        !(g.code === '20' && trueCode === '28') &&
        !(
          g.code === '19' &&
          /^15\s*[-–]/i.test(origName) &&
          /INC[EÊ]NDIO|NR\s*[-–]?\s*23/i.test(origName)
        ) &&
        !(
          g.code === '15' &&
          /^16\s*[-–]/i.test(origName) &&
          /NR\s*[-–]?\s*12/i.test(origName)
        ) &&
        // Certificados específicos de pilotagem de drone em código 19 que não são GWO NR-23
        (/\bINSPE[CÇ][AÃ]O\s+EXTERNA\s+DE\s+P[AÁ]S|\bPILOTOS\s+UAS\s+PRO\b/i.test(
          origName
        ) ||
          trueCode !== g.code)

      const effectiveCodeForDate = isCarta || isWrongCourse ? trueCode : g.code
      const startDate = resolveCourseStartDate(
        f.fileId,
        origName,
        f.fileName,
        effectiveCodeForDate,
        preCacheMap
      )

      const restoredName = DriveNomenclatureStandardizer.buildStandardFilename({
        code: effectiveCodeForDate,
        collaboratorName: g.collab,
        date: startDate,
        originalFilename: origName,
      })

      if (isCarta || isWrongCourse) {
        separatedFiles.push({
          fileId: f.fileId,
          origName,
          trueCode: effectiveCodeForDate,
          startDate,
          restoredName,
        })
      } else {
        validFiles.push({
          fileId: f.fileId,
          origName,
          trueCode: g.code,
          startDate,
          restoredName,
        })
      }
    }

    // Ordena validFiles pela data de início mais recente primeiro
    validFiles.sort((a, b) => {
      const tA = a.startDate ? a.startDate.getTime() : 0
      const tB = b.startDate ? b.startDate.getTime() : 0
      return tB - tA
    })

    if (separatedFiles.length === 0) {
      const latestStart = validFiles[0]?.startDate || null
      const newMergedName = DriveNomenclatureStandardizer.buildStandardFilename(
        {
          code: g.code,
          collaboratorName: g.collab,
          date: latestStart,
          isMerged: true,
          originalFilename: validFiles[0]?.origName,
        }
      )
      fase2Plans.push({
        type: 'RENAME_MERGED',
        collab: g.collab,
        code: g.code,
        folderId: g.folderId,
        mergedFileId,
        oldMergedName: g.proposedName,
        newMergedName,
        validFiles,
        separatedFiles: [],
      })
    } else if (validFiles.length < 2) {
      fase2Plans.push({
        type: 'UNMERGE_AND_RESTORE',
        collab: g.collab,
        code: g.code,
        folderId: g.folderId,
        mergedFileId,
        oldMergedName: g.proposedName,
        validFiles,
        separatedFiles,
      })
    } else {
      const latestStart = validFiles[0]?.startDate || null
      const newMergedName = DriveNomenclatureStandardizer.buildStandardFilename(
        {
          code: g.code,
          collaboratorName: g.collab,
          date: latestStart,
          isMerged: true,
          originalFilename: validFiles[0]?.origName,
        }
      )
      fase2Plans.push({
        type: 'SEPARATE_AND_REMERGE',
        collab: g.collab,
        code: g.code,
        folderId: g.folderId,
        mergedFileId,
        oldMergedName: g.proposedName,
        newMergedName,
        validFiles,
        separatedFiles,
      })
    }
  }

  // -------------------------------------------------------------------------
  // PARTE 2: Planejamento dos Arquivos Individuais da Fase 1
  // -------------------------------------------------------------------------
  interface IndividualUpdatePlan {
    fileId: string
    collaborator: string
    origName: string
    currentDriveName: string
    newTargetName: string
    trueCode: string
    reason: 'COURSE_START_DATE' | 'FIX_MULTI_RENAME_CODE'
  }

  const individualPlans: IndividualUpdatePlan[] = []

  for (const [fileId, logs] of p1ByFileId.entries()) {
    if (fase2FileIds.has(fileId)) continue
    if (manualKeepIds.has(fileId)) continue

    // Se o arquivo participou de mesclagem de Contrato+Aditivo (código 40) na Fase 1, não renomear como curso
    const hadContractMerge = logs.some((l: any) => l.action === 'MESCLAR')
    if (hadContractMerge) continue

    const firstLog = logs[0]
    const lastLog = logs[logs.length - 1]
    const origName: string = firstLog.originalName
    const currentDriveName: string = lastLog.targetName
    const collab: string = firstLog.collaborator

    // Passaporte: manter com a data de vencimento / nome original
    if (/\b(?:pas+aporte|passport)\b/i.test(origName)) continue
    // Alisson ZIP
    if (origName.toLowerCase().endsWith('.zip')) continue

    const trueCode = resolveTrueFileCode(origName, firstLog.targetName)
    const currCodeMatch = currentDriveName.match(/^(\d{1,2}(?:\.\d+)?)/)
    const currCode = currCodeMatch ? currCodeMatch[1] : ''

    const isCourseOrCarta =
      DriveNomenclatureStandardizer.isCourseOrCartaCode(trueCode)

    if (isCourseOrCarta) {
      const startDate = resolveCourseStartDate(
        fileId,
        origName,
        currentDriveName,
        trueCode,
        preCacheMap
      )
      const newTargetName = DriveNomenclatureStandardizer.buildStandardFilename(
        {
          code: trueCode,
          collaboratorName: collab,
          date: startDate,
          originalFilename: origName,
        }
      )

      if (newTargetName !== currentDriveName) {
        individualPlans.push({
          fileId,
          collaborator: collab,
          origName,
          currentDriveName,
          newTargetName,
          trueCode,
          reason:
            trueCode !== currCode
              ? 'FIX_MULTI_RENAME_CODE'
              : 'COURSE_START_DATE',
        })
      }
    } else if (trueCode !== currCode) {
      // Documento pessoal (ex: 02 Ordem de Serviço, 06 Ficha de EPI, 07 Seguro, 23 CRT)
      // que foi sobrescrito na Fase 1 por um código de curso (ex: 12, 27, 31, 32)
      const matchingLog = logs.find((l: any) =>
        l.targetName.startsWith(`${trueCode} –`)
      )
      if (matchingLog && matchingLog.targetName !== currentDriveName) {
        individualPlans.push({
          fileId,
          collaborator: collab,
          origName,
          currentDriveName,
          newTargetName: matchingLog.targetName,
          trueCode,
          reason: 'FIX_MULTI_RENAME_CODE',
        })
      } else if (['02', '06', '07', '23', '24', '30'].includes(trueCode)) {
        const currDate = parseDateDmy(currentDriveName)
        const newTargetName =
          DriveNomenclatureStandardizer.buildStandardFilename({
            code: trueCode,
            collaboratorName: collab,
            date: currDate,
            originalFilename: origName,
          })
        if (newTargetName !== currentDriveName) {
          individualPlans.push({
            fileId,
            collaborator: collab,
            origName,
            currentDriveName,
            newTargetName,
            trueCode,
            reason: 'FIX_MULTI_RENAME_CODE',
          })
        }
      }
    }
  }

  const countRenameMerged = fase2Plans.filter(
    p => p.type === 'RENAME_MERGED'
  ).length
  const countUnmerge = fase2Plans.filter(
    p => p.type === 'UNMERGE_AND_RESTORE'
  ).length
  const countRemerge = fase2Plans.filter(
    p => p.type === 'SEPARATE_AND_REMERGE'
  ).length
  const countIndStartDate = individualPlans.filter(
    p => p.reason === 'COURSE_START_DATE'
  ).length
  const countIndFixCode = individualPlans.filter(
    p => p.reason === 'FIX_MULTI_RENAME_CODE'
  ).length

  console.log('--- RESUMO DO PLANO DE AJUSTE ---')
  console.log(`1. Grupos F+R (Fase 2) - Total: ${fase2Plans.length}`)
  console.log(
    `   - Apenas atualizar data para Início no arquivo F+R: ${countRenameMerged}`
  )
  console.log(
    `   - Desfazer mesclagem de Curso + Carta (restaurar avulsos com data de início): ${countUnmerge}`
  )
  console.log(
    `   - Separar Carta e remesclar apenas Cursos F+R com data de início: ${countRemerge}`
  )
  console.log(
    `\n2. Arquivos Individuais de Cursos e Cartas - Total a atualizar: ${individualPlans.length}`
  )
  console.log(
    `   - Troca de Data de Vencimento -> Data de Início: ${countIndStartDate}`
  )
  console.log(
    `   - Correção de Código + Data de Início (ex: Carta 15.1/20.1, NR-33): ${countIndFixCode}`
  )

  console.log('\n--- EXEMPLOS DE ATUALIZACAO F+R (FASE 2) ---')
  fase2Plans
    .filter(p => p.type === 'RENAME_MERGED')
    .slice(0, 8)
    .forEach(p => {
      console.log(`  ANTES:  ${p.oldMergedName}`)
      console.log(`  DEPOIS: ${p.newMergedName}`)
    })

  console.log('\n--- EXEMPLOS DE ATUALIZACAO DE CURSOS INDIVIDUAIS ---')
  individualPlans.slice(0, 12).forEach(p => {
    console.log(`  ORIG:   ${p.origName}`)
    console.log(`  ANTES:  ${p.currentDriveName}`)
    console.log(`  DEPOIS: ${p.newTargetName}`)
  })

  if (!isLive) {
    console.log(
      '\n[Modo Simulação] Passe --execute para aplicar as alterações no Google Drive.'
    )
    return
  }

  console.log(
    '\n[EXECUÇÃO AO VIVO] Aplicando atualizações diretamente no Google Drive...\n'
  )
  const client = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth: client })

  let f2Success = 0
  let f2Errors = 0
  let indSuccess = 0
  let indErrors = 0

  // Executa Parte 1 (Fase 2)
  for (let i = 0; i < fase2Plans.length; i++) {
    const p = fase2Plans[i]
    const progress = `[Fase2 ${i + 1}/${fase2Plans.length}]`
    try {
      if (p.type === 'RENAME_MERGED' && p.newMergedName) {
        if (p.oldMergedName !== p.newMergedName && p.mergedFileId) {
          await drive.files.update({
            fileId: p.mergedFileId,
            requestBody: { name: p.newMergedName },
            fields: 'id, name',
          })
          await sleep(delayMs)
        }
        console.log(`${progress} [RENAME F+R] ${p.newMergedName}`)
        f2Success++
      } else if (p.type === 'UNMERGE_AND_RESTORE') {
        // Localiza subpasta Obsoletos
        const subRes = await drive.files.list({
          q: `'${p.folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)',
        })
        const obsFolder = subRes.data.files?.find(f =>
          f.name?.toLowerCase().includes('obsoleto')
        )
        const obsFolderId = obsFolder?.id || ''

        const allToRestore = [...p.validFiles, ...p.separatedFiles]
        for (const rf of allToRestore) {
          const fileMeta = await drive.files.get({
            fileId: rf.fileId,
            fields: 'id, parents',
          })
          const parents = fileMeta.data.parents || []
          const needMove = !parents.includes(p.folderId) && parents.length > 0
          await drive.files.update({
            fileId: rf.fileId,
            ...(needMove
              ? {
                  addParents: p.folderId,
                  removeParents: parents.join(','),
                }
              : {}),
            requestBody: { name: rf.restoredName },
            fields: 'id, name, parents',
          })
          await sleep(delayMs)
        }

        // Move o mesclado indevido para Obsoletos
        if (p.mergedFileId && obsFolderId) {
          const mergedMeta = await drive.files.get({
            fileId: p.mergedFileId,
            fields: 'id, parents',
          })
          const mParents = mergedMeta.data.parents || []
          const needMoveObs =
            !mParents.includes(obsFolderId) && mParents.length > 0
          if (needMoveObs) {
            await drive.files.update({
              fileId: p.mergedFileId,
              addParents: obsFolderId,
              removeParents: mParents.join(','),
              fields: 'id, parents',
            })
            await sleep(delayMs)
          }
        }
        console.log(
          `${progress} [UNMERGE CARTA] ${p.collab} | Cód ${p.code} (${allToRestore.length} arquivos restaurados)`
        )
        f2Success++
      } else if (p.type === 'SEPARATE_AND_REMERGE' && p.newMergedName) {
        const subRes = await drive.files.list({
          q: `'${p.folderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id, name)',
        })
        const obsFolder = subRes.data.files?.find(f =>
          f.name?.toLowerCase().includes('obsoleto')
        )
        const obsFolderId = obsFolder?.id || ''

        // 1. Restaura apenas os separatedFiles (ex: Carta 15.1 / 20.1) para a pasta ativa
        for (const sf of p.separatedFiles) {
          const fileMeta = await drive.files.get({
            fileId: sf.fileId,
            fields: 'id, parents',
          })
          const parents = fileMeta.data.parents || []
          const needMove = !parents.includes(p.folderId) && parents.length > 0
          await drive.files.update({
            fileId: sf.fileId,
            ...(needMove
              ? {
                  addParents: p.folderId,
                  removeParents: parents.join(','),
                }
              : {}),
            requestBody: { name: sf.restoredName },
            fields: 'id, name, parents',
          })
          await sleep(delayMs)
        }

        // 2. Baixa e mescla apenas os validFiles
        const pdfBuffers: Array<{
          buffer: Buffer
          filename: string
          date?: Date | null
        }> = []
        for (const vf of p.validFiles) {
          const res = await drive.files.get(
            { fileId: vf.fileId, alt: 'media' },
            { responseType: 'arraybuffer' }
          )
          pdfBuffers.push({
            buffer: Buffer.from(res.data as ArrayBuffer),
            filename: vf.restoredName,
            date: vf.startDate,
          })
          await sleep(delayMs)
        }

        const mergedBuffer = await DrivePdfMerger.mergePdfs(pdfBuffers)

        // 3. Atualiza o próprio mergedFileId com o novo conteúdo e novo nome
        if (p.mergedFileId) {
          await drive.files.update({
            fileId: p.mergedFileId,
            requestBody: { name: p.newMergedName },
            media: {
              mimeType: 'application/pdf',
              body: Readable.from(mergedBuffer),
            },
            fields: 'id, name',
          })
          await sleep(delayMs)
        } else if (obsFolderId) {
          await drive.files.create({
            requestBody: {
              name: p.newMergedName,
              parents: [p.folderId],
            },
            media: {
              mimeType: 'application/pdf',
              body: Readable.from(mergedBuffer),
            },
            fields: 'id, name',
          })
          await sleep(delayMs)
        }

        console.log(`${progress} [REMERGE F+R] ${p.newMergedName}`)
        f2Success++
      }
    } catch (err: any) {
      f2Errors++
      console.error(
        `${progress} ERRO em ${p.collab} (${p.code}):`,
        err?.message || err
      )
    }
  }

  // Executa Parte 2 (Arquivos Individuais)
  for (let i = 0; i < individualPlans.length; i++) {
    const p = individualPlans[i]
    const progress = `[Indiv ${i + 1}/${individualPlans.length}]`
    try {
      await drive.files.update({
        fileId: p.fileId,
        requestBody: { name: p.newTargetName },
        fields: 'id, name',
      })
      indSuccess++
      if ((i + 1) % 50 === 0 || i === individualPlans.length - 1) {
        console.log(`${progress} OK: ${p.newTargetName}`)
      }
      await sleep(delayMs)
    } catch (err: any) {
      indErrors++
      console.error(
        `${progress} ERRO em ${p.fileId} (${p.currentDriveName}):`,
        err?.message || err
      )
    }
  }

  const reportPath = path.join(
    process.cwd(),
    'scratch',
    'drive_start_date_update_log.json'
  )
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        f2Success,
        f2Errors,
        indSuccess,
        indErrors,
        fase2Plans,
        individualPlans,
      },
      null,
      2
    ),
    'utf8'
  )

  console.log(
    '\n================================================================================'
  )
  console.log('   CONCLUIDO!')
  console.log(`   - Grupos F+R atualizados: ${f2Success} (Erros: ${f2Errors})`)
  console.log(
    `   - Cursos/Cartas individuais atualizados: ${indSuccess} (Erros: ${indErrors})`
  )
  console.log(`   - Log salvo em: ${reportPath}`)
  console.log(
    '================================================================================'
  )
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('updateCoursesToStartDate.ts') ||
    process.argv[1].endsWith('updateCoursesToStartDate.js'))
) {
  main().catch(err => {
    console.error('[UpdateCoursesStartDate] Erro fatal:', err)
    process.exit(1)
  })
}
