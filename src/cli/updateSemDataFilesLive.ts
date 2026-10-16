import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import {
  buildExcelReport,
  buildSemDataItems,
} from './exportArquivosSemDataReport.js'

export interface TargetedUpdate {
  collaborator: string
  fileId: string
  folderId: string
  code: string
  docTitle: string
  date: string
  newName: string
  reason: string
}

export const TARGETED_SEM_DATA_UPDATES: TargetedUpdate[] = [
  {
    collaborator: 'THAYNA NOGUEIRA TAVARES',
    fileId: '1TVefB0hGdBcGAbJiDYoK7yXWnt3pc_ZW',
    folderId: '1SKFiH3l9aF5jccm9Rx3YgCEr4CD2d3L6',
    code: '07',
    docTitle: 'Seguro de Vida',
    date: '06.12.2026',
    newName: '07 – Seguro de Vida – 06.12.2026 - THAYNA NOGUEIRA TAVARES.pdf',
    reason:
      'Término de vigência confirmado na página 1 da apólice (06/12/2026 23:59).',
  },
  {
    collaborator: 'WERMESON DE OLIVEIRA FRANCO',
    fileId: '1NMVcqKyeeavppBv4wZbfPZJZFUPS6uTS',
    folderId: '1U85H7x6x7THXAeQRUDFF-wC0BOIu0b6l',
    code: '10',
    docTitle: 'NR-01 Integração EHS',
    date: '14.01.2026',
    newName:
      '10 – NR-01 Integração – 14.01.2026 - WERMESON DE OLIVEIRA FRANCO.pdf',
    reason:
      'Data de emissão confirmada no certificado de conclusão da NR-01 (14 de janeiro de 2026).',
  },
  {
    collaborator: 'NARDEL DELON NOVAIS ROCHA',
    fileId: '1xJc85PDw1s00--rfyra0dBlskirYP7kj',
    folderId: '1ajuUSnE_BIWzh_B6WSKlrRTWiZHC_7I2',
    code: '10',
    docTitle: 'NR-01 Integração EHS',
    date: '04.08.2024',
    newName:
      '10 – NR-01 Integração – 04.08.2024 - NARDEL DELON NOVAIS ROCHA.pdf',
    reason:
      'Data de conclusão do treinamento de NR-01 na Storz (4 de Agosto de 2024).',
  },
  {
    collaborator: 'THIAGO LIMA SANTOS SILVA',
    fileId: '1USqoVtoho0U2dZeTYJpER5CkNL6H7aHC',
    folderId: '13VIPrQtmXr_nZ-B2EQeuEP6xOsZD0aQH',
    code: '10',
    docTitle: 'NR-01 Integração EHS',
    date: '04.08.2024',
    newName:
      '10 – NR-01 Integração – 04.08.2024 - THIAGO LIMA SANTOS SILVA.pdf',
    reason:
      'Data de conclusão do treinamento de NR-01 na Storz compartilhada com a turma (4 de Agosto de 2024).',
  },
]

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   ATUALIZAÇÃO DE ARQUIVOS SEM_DATA NO GOOGLE DRIVE COM EVIDÊNCIAS CONFIRMADAS'
  )
  console.log(
    '================================================================================\n'
  )

  const isLive = process.argv.includes('--execute')

  if (!isLive) {
    console.log(
      '[UpdateSemData] MODO SIMULAÇÃO ATIVO. (Passe --execute para aplicar alterações reais no Drive).\n'
    )
  } else {
    console.log(
      '[UpdateSemData] ATENÇÃO: MODO EXECUÇÃO REAL ATIVO. Alterações serão aplicadas diretamente no Google Drive!\n'
    )
  }

  const client = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth: client })

  const simJsonPath = path.join(
    process.cwd(),
    'scratch',
    'simulacao_padronizacao_drive.json'
  )
  const execLogPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_execution_log.json'
  )
  const undoLogPath = path.join(
    process.cwd(),
    'scratch',
    'drive_padronizacao_undo_log.json'
  )

  const simItems = fs.existsSync(simJsonPath)
    ? JSON.parse(fs.readFileSync(simJsonPath, 'utf8'))
    : []
  const execLogs = fs.existsSync(execLogPath)
    ? JSON.parse(fs.readFileSync(execLogPath, 'utf8'))
    : []
  const undoLogs = fs.existsSync(undoLogPath)
    ? JSON.parse(fs.readFileSync(undoLogPath, 'utf8'))
    : []

  for (const upd of TARGETED_SEM_DATA_UPDATES) {
    console.log(`[Update] Colaborador: ${upd.collaborator}`)
    console.log(`         Cód:         ${upd.code} (${upd.docTitle})`)
    console.log(`         Novo Nome:   ${upd.newName}`)
    console.log(`         Motivo:      ${upd.reason}`)

    // 1. Obter nome atual no Drive
    let currentDriveName = ''
    try {
      const fileRes = await drive.files.get({
        fileId: upd.fileId,
        fields: 'id, name',
      })
      currentDriveName = fileRes.data.name || ''
      console.log(`         Nome Atual:  ${currentDriveName}`)
    } catch (err: any) {
      console.warn(
        `         Aviso ao buscar arquivo ${upd.fileId}: ${err.message}`
      )
    }

    if (isLive) {
      try {
        await drive.files.update({
          fileId: upd.fileId,
          requestBody: { name: upd.newName },
        })
        console.log(`         Status:      SUCESSO NO GOOGLE DRIVE`)

        // Adiciona ao undo log
        if (currentDriveName) {
          undoLogs.push({
            fileId: upd.fileId,
            collaborator: upd.collaborator,
            previousName: currentDriveName,
            renamedTo: upd.newName,
            timestamp: new Date().toISOString(),
          })
        }

        // Atualiza execLog
        const existingExec = execLogs.find((x: any) => x.fileId === upd.fileId)
        if (existingExec) {
          existingExec.targetName = upd.newName
          existingExec.timestamp = new Date().toISOString()
        } else {
          execLogs.push({
            fileId: upd.fileId,
            folderId: upd.folderId,
            collaborator: upd.collaborator,
            originalName: currentDriveName,
            targetName: upd.newName,
            action: 'RENOMEAR',
            status: 'SUCESSO',
            timestamp: new Date().toISOString(),
          })
        }

        // Atualiza simItems
        const existingSim = simItems.find((x: any) => x.fileId === upd.fileId)
        if (existingSim) {
          existingSim.date = upd.date
          existingSim.proposedName = upd.newName
        }
      } catch (err: any) {
        console.error(`         ERRO ao renomear ${upd.fileId}: ${err.message}`)
      }
    } else {
      console.log(
        `         Status:      SIMULADO (passe --execute para aplicar)`
      )
    }
    console.log(
      '--------------------------------------------------------------------------------'
    )
  }

  if (isLive) {
    fs.writeFileSync(simJsonPath, JSON.stringify(simItems, null, 2), 'utf8')
    fs.writeFileSync(execLogPath, JSON.stringify(execLogs, null, 2), 'utf8')
    fs.writeFileSync(undoLogPath, JSON.stringify(undoLogs, null, 2), 'utf8')
    console.log(
      '\n[UpdateSemData] Logs de simulação, execução e undo atualizados com sucesso.'
    )

    // Re-exportar o relatório atualizado de arquivos sem data
    console.log(
      '\n[UpdateSemData] Regenerando relatórios SEM_DATA (Excel e JSON)...'
    )
    const mappedItems = buildSemDataItems(simItems, execLogs)
    const jsonOutputPath = path.join(
      process.cwd(),
      'scratch',
      'arquivos_sem_data_drive.json'
    )
    const excelOutputPath = path.join(
      process.cwd(),
      'scratch',
      'arquivos_sem_data_drive.xlsx'
    )

    const permCount = mappedItems.filter(
      x => x.natureza === 'PERMANENTE / VITALÍCIO'
    ).length
    const actionCount = mappedItems.filter(
      x => x.natureza === 'TREINAMENTO / CONTRATUAL'
    ).length
    const distinctCollabs = new Set(mappedItems.map(x => x.collaborator)).size

    const jsonReport = {
      generatedAt: new Date().toISOString(),
      totalFiles: mappedItems.length,
      permanentCount: permCount,
      actionableCount: actionCount,
      distinctCollaborators: distinctCollabs,
      items: mappedItems,
    }
    fs.writeFileSync(
      jsonOutputPath,
      JSON.stringify(jsonReport, null, 2),
      'utf8'
    )
    await buildExcelReport(mappedItems, excelOutputPath)

    console.log(
      `[UpdateSemData] Relatório Excel atualizado: ${excelOutputPath}`
    )
    console.log(
      `[UpdateSemData] Novo total de arquivos SEM_DATA: ${mappedItems.length} (Restam apenas ${actionCount} com ação pontual).`
    )
  }

  console.log(
    '\n================================================================================'
  )
  console.log('   PROCESSAMENTO CONCLUÍDO COM SUCESSO!')
  console.log(
    '================================================================================'
  )
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('updateSemDataFilesLive.ts') ||
    process.argv[1].endsWith('updateSemDataFilesLive.js'))
) {
  main().catch(err => {
    console.error('[UpdateSemData] Erro fatal:', err)
    process.exit(1)
  })
}
