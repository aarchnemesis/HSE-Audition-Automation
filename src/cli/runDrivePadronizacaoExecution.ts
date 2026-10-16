import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { DrivePdfMerger } from '../domain/services/DrivePdfMerger.js'

interface CollabFileSim {
  folderId: string
  collaborator: string
  fileId: string
  currentName: string
  code: string
  docTitle: string
  modality: string
  date: string
  proposedName: string
  action: 'MANTER' | 'RENOMEAR' | 'MESCLAR'
  mergeGroupId?: string
}

interface ExecutionLogEntry {
  fileId: string
  folderId: string
  collaborator: string
  originalName: string
  targetName: string
  action: 'RENOMEAR' | 'MESCLAR' | 'IGNORADO'
  status: 'SUCESSO' | 'ERRO' | 'SIMULADO'
  error?: string
  timestamp: string
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function main() {
  console.log('\n================================================================================')
  console.log('   EXECUÇÃO DE PADRONIZAÇÃO E MESCLAGEM NO GOOGLE DRIVE')
  console.log('================================================================================\n')

  const isLive = process.argv.includes('--execute') || process.argv.includes('--run')
  const collabFilterArg = process.argv.find(a => a.startsWith('--collaborator='))?.split('=')[1]
  const limitArg = process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity
  const delayArg = process.argv.find(a => a.startsWith('--delay='))?.split('=')[1]
  const delayMs = delayArg ? parseInt(delayArg, 10) : 150

  const simJsonPath = path.join(process.cwd(), 'scratch', 'simulacao_padronizacao_drive.json')
  if (!fs.existsSync(simJsonPath)) {
    console.error('[DriveExec] Arquivo simulacao_padronizacao_drive.json não encontrado. Execute o Dry-Run primeiro.')
    process.exit(1)
  }

  const allItems: CollabFileSim[] = JSON.parse(fs.readFileSync(simJsonPath, 'utf8'))
  let itemsToProcess = allItems

  if (collabFilterArg) {
    const filterUpper = collabFilterArg.toUpperCase()
    itemsToProcess = itemsToProcess.filter(i => i.collaborator.toUpperCase().includes(filterUpper))
    console.log(`[DriveExec] Filtro de colaborador: "${collabFilterArg}" -> ${itemsToProcess.length} arquivo(s) selecionado(s).`)
  }

  if (!isLive) {
    console.log('[DriveExec] MODO SEGURO / SIMULAÇÃO ATIVO. (Passe --execute para aplicar alterações reais no Drive).\n')
  } else {
    console.log('[DriveExec] ATENÇÃO: MODO EXECUÇÃO REAL ATIVO. Alterações serão aplicadas diretamente no Google Drive!\n')
  }

  const client = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth: client })

  const executionLogs: ExecutionLogEntry[] = []
  const undoLog: Array<{ fileId: string; previousName: string; updatedName: string; timestamp: string }> = []
  const undoLogPath = path.join(process.cwd(), 'scratch', 'drive_padronizacao_undo_log.json')
  const execLogPath = path.join(process.cwd(), 'scratch', 'drive_padronizacao_execution_log.json')

  let renameSuccessCount = 0
  let renameErrorCount = 0
  let mergeSuccessCount = 0
  let mergeErrorCount = 0
  let totalProcessed = 0

  // 1. Processa MESCLAGENS primeiro
  const mergeItems = itemsToProcess.filter(i => i.action === 'MESCLAR')
  const mergeGroups = new Map<string, CollabFileSim[]>()
  for (const m of mergeItems) {
    if (!m.mergeGroupId) continue
    if (!mergeGroups.has(m.mergeGroupId)) mergeGroups.set(m.mergeGroupId, [])
    mergeGroups.get(m.mergeGroupId)!.push(m)
  }

  console.log(`[DriveExec] Total de Grupos para Mesclagem: ${mergeGroups.size}`)

  for (const [groupId, groupFiles] of mergeGroups.entries()) {
    if (totalProcessed >= limit) break
    const primary = groupFiles[0]
    const proposedMergedName = primary.proposedName
    const folderId = primary.folderId
    const collab = primary.collaborator

    console.log(`\n[MESCLAR] Grupo: ${groupId}`)
    console.log(`   Colaborador: ${collab}`)
    console.log(`   Novo Arquivo: ${proposedMergedName}`)
    console.log(`   Arquivos de Origem (${groupFiles.length}):`)
    for (const f of groupFiles) {
      console.log(`     - [${f.fileId}] ${f.currentName}`)
    }

    if (!isLive) {
      for (const f of groupFiles) {
        executionLogs.push({
          fileId: f.fileId,
          folderId,
          collaborator: collab,
          originalName: f.currentName,
          targetName: proposedMergedName,
          action: 'MESCLAR',
          status: 'SIMULADO',
          timestamp: new Date().toISOString(),
        })
      }
      totalProcessed++
      continue
    }

    try {
      // Baixa os buffers de cada arquivo
      const pdfBuffers: Array<{ buffer: Buffer; filename: string }> = []
      for (const f of groupFiles) {
        if (!f.fileId) continue
        const res = await drive.files.get(
          { fileId: f.fileId, alt: 'media' },
          { responseType: 'arraybuffer' }
        )
        pdfBuffers.push({
          buffer: Buffer.from(res.data as ArrayBuffer),
          filename: f.currentName,
        })
        await sleep(delayMs)
      }

      if (pdfBuffers.length < 2) {
        console.warn(`   Aviso: Menos de 2 buffers baixados para o grupo ${groupId}. Pulando mesclagem.`)
        continue
      }

      // Mescla com DrivePdfMerger
      const mergedBuffer = await DrivePdfMerger.mergePdfs(pdfBuffers)

      // Cria ou localiza subpasta "Obsoletos" na pasta do colaborador
      const parentFolderId = folderId
      let obsoletosFolderId = ''

      const searchSub = await drive.files.list({
        q: `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
      })

      const existingObsoletos = searchSub.data.files?.find(
        sf => sf.name?.toLowerCase().includes('obsoleto')
      )

      if (existingObsoletos?.id) {
        obsoletosFolderId = existingObsoletos.id
      } else {
        const createSub = await drive.files.create({
          requestBody: {
            name: 'Obsoletos',
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentFolderId],
          },
          fields: 'id',
        })
        obsoletosFolderId = createSub.data.id || ''
        console.log(`   Criada subpasta "Obsoletos" (id: ${obsoletosFolderId})`)
        await sleep(delayMs)
      }

      // Faz upload do PDF mesclado na pasta do colaborador
      const uploadRes = await drive.files.create({
        requestBody: {
          name: proposedMergedName,
          parents: [parentFolderId],
        },
        media: {
          mimeType: 'application/pdf',
          body: Readable.from(mergedBuffer),
        },
        fields: 'id, name',
      })

      console.log(`   Upload do PDF mesclado concluído com sucesso! (ID: ${uploadRes.data.id})`)

      // Move os arquivos originais para a pasta Obsoletos
      for (const f of groupFiles) {
        if (!f.fileId || !obsoletosFolderId) continue
        try {
          await drive.files.update({
            fileId: f.fileId,
            addParents: obsoletosFolderId,
            removeParents: parentFolderId,
            fields: 'id, parents',
          })
          console.log(`   Original movido para Obsoletos: ${f.currentName}`)
          await sleep(delayMs)
        } catch (mErr: any) {
          console.warn(`   Aviso ao mover ${f.fileId} para Obsoletos:`, mErr?.message || mErr)
        }
      }

      mergeSuccessCount++
      totalProcessed++

      for (const f of groupFiles) {
        executionLogs.push({
          fileId: f.fileId,
          folderId,
          collaborator: collab,
          originalName: f.currentName,
          targetName: proposedMergedName,
          action: 'MESCLAR',
          status: 'SUCESSO',
          timestamp: new Date().toISOString(),
        })
      }
    } catch (err: any) {
      console.error(`   Erro ao mesclar grupo ${groupId}:`, err?.message || err)
      mergeErrorCount++
      for (const f of groupFiles) {
        executionLogs.push({
          fileId: f.fileId,
          folderId,
          collaborator: collab,
          originalName: f.currentName,
          targetName: proposedMergedName,
          action: 'MESCLAR',
          status: 'ERRO',
          error: err?.message || String(err),
          timestamp: new Date().toISOString(),
        })
      }
    }
  }

  // 2. Processa RENOMEAÇÕES individuais
  const renameItems = itemsToProcess.filter(i => i.action === 'RENOMEAR')
  console.log(`\n[DriveExec] Total de Arquivos para Renomeação: ${renameItems.length}`)

  for (let idx = 0; idx < renameItems.length; idx++) {
    if (totalProcessed >= limit) {
      console.log(`[DriveExec] Limite de operações (${limit}) atingido. Encerrando lote.`)
      break
    }

    const item = renameItems[idx]
    if (!item.fileId) {
      console.warn(`[DriveExec] Item sem fileId: ${item.currentName}. Pulando.`)
      continue
    }

    if (item.currentName === item.proposedName) {
      continue
    }

    const progress = `[${idx + 1}/${renameItems.length}]`
    console.log(`${progress} [RENOMEAR] ${item.collaborator}`)
    console.log(`   Atual:    ${item.currentName}`)
    console.log(`   Proposto: ${item.proposedName}`)

    if (!isLive) {
      executionLogs.push({
        fileId: item.fileId,
        folderId: item.folderId,
        collaborator: item.collaborator,
        originalName: item.currentName,
        targetName: item.proposedName,
        action: 'RENOMEAR',
        status: 'SIMULADO',
        timestamp: new Date().toISOString(),
      })
      totalProcessed++
      continue
    }

    try {
      await drive.files.update({
        fileId: item.fileId,
        requestBody: {
          name: item.proposedName,
        },
        fields: 'id, name',
      })

      renameSuccessCount++
      totalProcessed++

      executionLogs.push({
        fileId: item.fileId,
        folderId: item.folderId,
        collaborator: item.collaborator,
        originalName: item.currentName,
        targetName: item.proposedName,
        action: 'RENOMEAR',
        status: 'SUCESSO',
        timestamp: new Date().toISOString(),
      })

      undoLog.push({
        fileId: item.fileId,
        previousName: item.currentName,
        updatedName: item.proposedName,
        timestamp: new Date().toISOString(),
      })

      console.log(`   OK (Renomeado)`)
      await sleep(delayMs)
    } catch (err: any) {
      renameErrorCount++
      console.error(`   FALHOU:`, err?.message || err)
      executionLogs.push({
        fileId: item.fileId,
        folderId: item.folderId,
        collaborator: item.collaborator,
        originalName: item.currentName,
        targetName: item.proposedName,
        action: 'RENOMEAR',
        status: 'ERRO',
        error: err?.message || String(err),
        timestamp: new Date().toISOString(),
      })
      await sleep(delayMs * 2)
    }
  }

  // Grava logs
  fs.writeFileSync(execLogPath, JSON.stringify(executionLogs, null, 2), 'utf8')
  if (undoLog.length > 0) {
    fs.writeFileSync(undoLogPath, JSON.stringify(undoLog, null, 2), 'utf8')
  }

  console.log('\n================================================================================')
  console.log('  RESUMO DA EXECUÇÃO')
  console.log('================================================================================')
  console.log(`Modo:                     ${isLive ? 'EXECUÇÃO AO VIVO (DRIVE)' : 'SIMULAÇÃO (DRY RUN)'}`)
  console.log(`Total de Itens Tratados:  ${totalProcessed}`)
  console.log(`Renomeações Sucesso:      ${renameSuccessCount}`)
  console.log(`Renomeações Falhas:       ${renameErrorCount}`)
  console.log(`Mesclagens Sucesso:       ${mergeSuccessCount}`)
  console.log(`Mesclagens Falhas:        ${mergeErrorCount}`)
  console.log(`Log de Execução Gravado:  ${execLogPath}`)
  if (undoLog.length > 0) {
    console.log(`Log de Desfazer (Undo):   ${undoLogPath}`)
  }
  console.log('================================================================================\n')
}

main().catch(err => {
  console.error('[DriveExec] Erro fatal:', err)
  process.exit(1)
})
