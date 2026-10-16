import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { google } from 'googleapis'
import { parseDateFromFilename } from '../adapters/drive/certificateFilenameParser.js'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { DriveNomenclatureStandardizer } from '../domain/services/DriveNomenclatureStandardizer.js'
import { DrivePdfMerger } from '../domain/services/DrivePdfMerger.js'

export interface Fase2MergeFile {
  fileId: string
  fileName: string
  folderPath: string
  dateStr: string
  parsedDate?: Date | null
}

export interface Fase2MergeGroup {
  collab: string
  code: string
  docTitle: string
  latestDate: string
  proposedName: string
  folderId: string
  files: Fase2MergeFile[]
}

export interface Fase2ExecutionLog {
  collab: string
  code: string
  proposedName: string
  folderId: string
  filesCount: number
  mergedFileId?: string
  status: 'SUCESSO' | 'SIMULADO' | 'ERRO'
  error?: string
  timestamp: string
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const ELIGIBLE_CODES = new Set([
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '19',
  '20',
  '21',
  '22',
  '32',
])

export function buildFase2Groups(
  driveFiles: Array<{
    fileId: string
    fileName: string
    folderId: string
    folderPath: string
    collabName: string
  }>
): Fase2MergeGroup[] {
  const byCollab = new Map<string, typeof driveFiles>()
  for (const f of driveFiles) {
    if (!byCollab.has(f.collabName)) byCollab.set(f.collabName, [])
    byCollab.get(f.collabName)!.push(f)
  }

  const groups: Fase2MergeGroup[] = []

  for (const [collab, cFiles] of byCollab.entries()) {
    const byCode = new Map<string, typeof driveFiles>()
    for (const f of cFiles) {
      const m = f.fileName.match(/^(\d{1,2}(?:\.\d+)?)/)
      const code = m ? m[1] : null
      if (code && ELIGIBLE_CODES.has(code)) {
        if (!byCode.has(code)) byCode.set(code, [])
        byCode.get(code)!.push(f)
      }
    }

    for (const [code, fileGroup] of byCode.entries()) {
      if (fileGroup.length > 1) {
        const datedFiles = fileGroup.map(f => {
          const d = parseDateFromFilename(f.fileName)
          return {
            ...f,
            parsedDate: d,
            dateStr: d
              ? DriveNomenclatureStandardizer.formatDate(d)
              : 'SEM_DATA',
          }
        })

        // Ordena por data mais recente primeiro
        datedFiles.sort((a, b) => {
          const tA = a.parsedDate ? a.parsedDate.getTime() : 0
          const tB = b.parsedDate ? b.parsedDate.getTime() : 0
          return tB - tA
        })

        const latestDate = datedFiles[0].parsedDate
        const latestDateStr = datedFiles[0].dateStr

        const proposedName =
          DriveNomenclatureStandardizer.buildStandardFilename({
            code,
            collaboratorName: collab,
            date: latestDate,
            isMerged: true,
            originalFilename: datedFiles[0].fileName,
          })

        const cleanDocTitle = proposedName.split(' – ')[1] || `Doc ${code}`

        groups.push({
          collab,
          code,
          docTitle: cleanDocTitle,
          latestDate: latestDateStr,
          proposedName,
          folderId: fileGroup[0].folderId,
          files: datedFiles.map(df => ({
            fileId: df.fileId,
            fileName: df.fileName,
            folderPath: df.folderPath,
            dateStr: df.dateStr,
            parsedDate: df.parsedDate,
          })),
        })
      }
    }
  }

  // Ordena por Colaborador e Código
  return groups.sort((a, b) => {
    const cDiff = a.collab.localeCompare(b.collab)
    if (cDiff !== 0) return cDiff
    return a.code.localeCompare(b.code, undefined, { numeric: true })
  })
}

async function main() {
  console.log(
    '================================================================================'
  )
  console.log('   FASE 2: MESCLAGEM DE FORMAÇÃO E RECICLAGEM NO GOOGLE DRIVE')
  console.log(
    '================================================================================\n'
  )

  const isLive =
    process.argv.includes('--execute') || process.argv.includes('--run')
  const collabFilterArg = process.argv
    .find(a => a.startsWith('--collaborator='))
    ?.split('=')[1]
  const codeFilterArg = process.argv
    .find(a => a.startsWith('--code='))
    ?.split('=')[1]
  const limitArg = process.argv
    .find(a => a.startsWith('--limit='))
    ?.split('=')[1]
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity
  const delayArg = process.argv
    .find(a => a.startsWith('--delay='))
    ?.split('=')[1]
  const delayMs = delayArg ? parseInt(delayArg, 10) : 150

  const livePdfPath = path.join(
    process.cwd(),
    'scratch',
    'drive_all_live_pdfs.json'
  )
  if (!fs.existsSync(livePdfPath)) {
    throw new Error(
      `Arquivo base ${livePdfPath} não encontrado. Execute a varredura primeiro.`
    )
  }

  const allPdfs = JSON.parse(fs.readFileSync(livePdfPath, 'utf8'))
  let groups = buildFase2Groups(allPdfs)

  if (collabFilterArg) {
    const filterUpper = collabFilterArg.toUpperCase()
    groups = groups.filter(g => g.collab.toUpperCase().includes(filterUpper))
    console.log(
      `[Fase2] Filtro de colaborador: "${collabFilterArg}" -> ${groups.length} grupo(s) selecionado(s).`
    )
  }

  if (codeFilterArg) {
    groups = groups.filter(g => g.code === codeFilterArg)
    console.log(
      `[Fase2] Filtro de código: "${codeFilterArg}" -> ${groups.length} grupo(s) selecionado(s).`
    )
  }

  console.log(
    `[Fase2] Total de Grupos Elegíveis para Mesclagem: ${groups.length}`
  )
  if (!isLive) {
    console.log(
      '[Fase2] MODO SIMULAÇÃO ATIVO. (Passe --execute para aplicar alterações reais no Drive).\n'
    )
  } else {
    console.log(
      '[Fase2] ATENÇÃO: MODO EXECUÇÃO REAL ATIVO. PDFs serão mesclados diretamente no Google Drive!\n'
    )
  }

  const client = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth: client })

  const undoLogPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_undo_log.json'
  )
  const undoLogs = fs.existsSync(undoLogPath)
    ? JSON.parse(fs.readFileSync(undoLogPath, 'utf8'))
    : []

  const executionLogs: Fase2ExecutionLog[] = []
  let successCount = 0
  let errorCount = 0
  let processedCount = 0

  for (let i = 0; i < groups.length; i++) {
    if (processedCount >= limit) {
      console.log(
        `[Fase2] Limite de operações (${limit}) atingido. Encerrando lote.`
      )
      break
    }

    const g = groups[i]
    processedCount++
    const progress = `[${i + 1}/${groups.length}]`

    console.log(`${progress} [MESCLAR F+R] ${g.collab} | Cód ${g.code}`)
    console.log(`   Destino:   ${g.proposedName}`)
    console.log(`   Arquivos a mesclar (${g.files.length}):`)
    g.files.forEach(f => console.log(`      - [${f.dateStr}] ${f.fileName}`))

    if (!isLive) {
      executionLogs.push({
        collab: g.collab,
        code: g.code,
        proposedName: g.proposedName,
        folderId: g.folderId,
        filesCount: g.files.length,
        status: 'SIMULADO',
        timestamp: new Date().toISOString(),
      })
      continue
    }

    try {
      // 0. Verifica se o arquivo mesclado já existe na pasta de destino
      const searchTarget = await drive.files.list({
        q: `'${g.folderId}' in parents and name = '${g.proposedName.replace(/'/g, "\\'")}' and trashed = false`,
        fields: 'files(id, name)',
      })
      if (searchTarget.data.files && searchTarget.data.files.length > 0) {
        console.log(
          `   Arquivo mesclado já existe no Drive: ${g.proposedName} (${searchTarget.data.files[0].id}). Pulando grupo.`
        )
        successCount++
        executionLogs.push({
          collab: g.collab,
          code: g.code,
          proposedName: g.proposedName,
          folderId: g.folderId,
          filesCount: g.files.length,
          mergedFileId: searchTarget.data.files[0].id,
          status: 'SUCESSO',
          timestamp: new Date().toISOString(),
        })
        continue
      }

      // 1. Baixar os buffers de cada PDF
      const pdfBuffers: Array<{
        buffer: Buffer
        filename: string
        date?: Date | null
      }> = []
      for (const f of g.files) {
        const res = await drive.files.get(
          { fileId: f.fileId, alt: 'media' },
          { responseType: 'arraybuffer' }
        )
        pdfBuffers.push({
          buffer: Buffer.from(res.data as ArrayBuffer),
          filename: f.fileName,
          date: f.parsedDate,
        })
        await sleep(delayMs)
      }

      // 2. Mesclar os PDFs
      const mergedBuffer = await DrivePdfMerger.mergePdfs(pdfBuffers)

      // 3. Localizar ou criar subpasta Obsoletos
      const parentFolderId = g.folderId
      let obsoletosFolderId = ''

      const searchSub = await drive.files.list({
        q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
      })

      const existingObsoletos = searchSub.data.files?.find(f =>
        f.name?.toLowerCase().includes('obsoleto')
      )

      if (existingObsoletos?.id) {
        obsoletosFolderId = existingObsoletos.id
      } else {
        const createSub = await drive.files.create({
          requestBody: {
            name: '00.Obsoleto',
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId],
          },
          fields: 'id',
        })
        obsoletosFolderId = createSub.data.id || ''
        console.log(`   Subpasta 00.Obsoleto criada: ${obsoletosFolderId}`)
        await sleep(delayMs)
      }

      // 4. Fazer upload do PDF mesclado
      const uploadRes = await drive.files.create({
        requestBody: {
          name: g.proposedName,
          parents: [parentFolderId],
        },
        media: {
          mimeType: 'application/pdf',
          body: Readable.from(mergedBuffer),
        },
        fields: 'id, name',
      })

      const newMergedFileId = uploadRes.data.id || ''
      console.log(
        `   Upload do mesclado concluído: ${uploadRes.data.name} (ID: ${newMergedFileId})`
      )
      await sleep(delayMs)

      // 5. Mover arquivos originais para Obsoletos
      for (const f of g.files) {
        try {
          await drive.files.update({
            fileId: f.fileId,
            addParents: obsoletosFolderId,
            removeParents: parentFolderId,
            fields: 'id, parents',
          })
          console.log(`   Original movido para Obsoletos: ${f.fileName}`)
          await sleep(delayMs)

          undoLogs.push({
            fileId: f.fileId,
            collaborator: g.collab,
            previousName: f.fileName,
            renamedTo: `MOVIDO_PARA_OBSOLETOS:${obsoletosFolderId}`,
            timestamp: new Date().toISOString(),
          })
        } catch (mErr: any) {
          console.warn(
            `   Aviso ao mover ${f.fileId} para Obsoletos: ${mErr.message}`
          )
        }
      }

      successCount++
      executionLogs.push({
        collab: g.collab,
        code: g.code,
        proposedName: g.proposedName,
        folderId: g.folderId,
        filesCount: g.files.length,
        mergedFileId: newMergedFileId,
        status: 'SUCESSO',
        timestamp: new Date().toISOString(),
      })
    } catch (err: any) {
      console.error(
        `   Erro ao mesclar grupo ${g.collab} - ${g.code}:`,
        err.message
      )
      errorCount++
      executionLogs.push({
        collab: g.collab,
        code: g.code,
        proposedName: g.proposedName,
        folderId: g.folderId,
        filesCount: g.files.length,
        status: 'ERRO',
        error: err.message,
        timestamp: new Date().toISOString(),
      })
    }
  }

  // Grava logs
  const logOutputPath = path.join(
    process.cwd(),
    'scratch',
    'drive_fase2_execution_log.json'
  )
  fs.writeFileSync(
    logOutputPath,
    JSON.stringify(executionLogs, null, 2),
    'utf8'
  )
  if (isLive) {
    fs.writeFileSync(undoLogPath, JSON.stringify(undoLogs, null, 2), 'utf8')
  }

  console.log(
    '\n================================================================================'
  )
  console.log(`[Fase2] Concluído! Grupos processados: ${processedCount}`)
  if (isLive) {
    console.log(` - Sucesso: ${successCount}`)
    console.log(` - Erros:   ${errorCount}`)
    console.log(` - Log de Execução: ${logOutputPath}`)
    console.log(` - Undo Log Atualizado: ${undoLogPath}`)
  } else {
    console.log(` - Simulação salva em: ${logOutputPath}`)
  }
  console.log(
    '================================================================================'
  )
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('runDriveFase2Merge.ts') ||
    process.argv[1].endsWith('runDriveFase2Merge.js'))
) {
  main().catch(err => {
    console.error('[Fase2] Erro fatal:', err)
    process.exit(1)
  })
}
