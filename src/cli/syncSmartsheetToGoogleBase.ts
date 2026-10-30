import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'

// IDs de Configuração
const SMARTSHEET_SHEET_ID = '4246973141962628' // ATW_OP_CT_001_PAINEL DE CAMPANHAS
const GOOGLE_DRIVE_FILE_ID = process.env.MASSUDE_SHEET_DRIVE_ID || '1T4-m4FEqd1U3P_2Wgz1mtfpPME2BrJra' // ArthWind_Controle_Homologacao_Clientes_v36.xlsx

interface CampaignAllocation {
  wo: string
  contrato: string
  empresa: string
  parque: string
  escopo: string
  statusCampanha: string
  previsaoAcesso: string | null
  colaboradores: string[]
}

interface NewBaseEntry {
  cliente: string
  empreendimento: string
  colaborador: string
  atividade: string
  status: string
  solicitacaoCadastro: Date
  previsaoAcesso: Date | null
  observacoes: string
}

interface UpdateBaseEntry {
  rowNumber: number
  cliente: string
  empreendimento: string
  colaborador: string
  changes: {
    field: string
    oldValue: any
    newValue: any
    colIndex: number
  }[]
}

interface ExistingRowRef {
  rowNumber: number
  cliente: string
  empreendimento: string
  colaborador: string
  atividade: string
  status: string
  previsaoAcesso: any
  observacoes: string
}

function normalizeStr(s: any): string {
  if (!s) return ''
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function formatDateSafe(d: any): string | null {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  if (isNaN(dt.getTime())) return null
  return dt.toISOString().split('T')[0]
}

function cleanTechnicianName(raw: string): string | null {
  if (!raw) return null
  let clean = raw
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/^(principal|secundario|secundário|lider|líder|resp|tecnico|técnico)\s*:\s*/i, '')
    .replace(/^[-–—\s]+|[-–—\s]+$/g, '')
    .trim()

  const upper = clean.toUpperCase()
  if (
    clean.length < 3 ||
    ['-', '--', 'TBD', 'N/A', 'NA', 'A DEFINIR', 'SEM EQUIPE', 'SEM LIDER', 'INDEFINIDO'].includes(upper)
  ) {
    return null
  }
  return clean
}

async function fetchSmartsheetCampaigns(): Promise<CampaignAllocation[]> {
  const token = process.env.SMARTSHEET_API_TOKEN
  if (!token) {
    throw new Error('SMARTSHEET_API_TOKEN não configurado no .env')
  }

  console.log(`[SyncSmartsheet] Buscando campanhas no Smartsheet (${SMARTSHEET_SHEET_ID})...`)
  const url = `https://api.smartsheet.com/2.0/sheets/${SMARTSHEET_SHEET_ID}?pageSize=1000&page=1`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!res.ok) {
    throw new Error(`Falha ao obter dados do Smartsheet: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as any
  const colMap: Record<number, string> = {}
  data.columns.forEach((c: any) => {
    colMap[c.id] = c.title
  })

  const allocations: CampaignAllocation[] = []

  for (const r of data.rows) {
    const row: Record<string, any> = {}
    r.cells.forEach((cell: any) => {
      if (cell.value !== undefined && cell.value !== null) {
        row[colMap[cell.columnId]] = cell.value
      }
    })

    const wo = String(row['WO'] || '').trim()
    const parque = String(row['PARQUE'] || '').trim()
    const empresa = String(row['EMPRESA'] || '').trim()
    const escopo = String(row['ESCOPO'] || 'Operacional').trim()
    const contrato = String(row['CONTRATO'] || '').trim()
    const statusCampanha = String(row['STATUS'] || 'Previsto').trim()
    const mob = row['MOB'] || row['INICIO PROGRAMADO'] || row['INICIO [A]'] || row['INICIO'] || null

    if (!wo || !parque) continue
    if (['Cancelado', 'Encerrado', 'Concluído'].includes(statusCampanha)) continue

    const rawTechFields = [
      row['LIDER'],
      row['EQUIPE 01'],
      row['EQUIPE 02'],
      row['EQUIPE 03']
    ].filter(Boolean)

    if (rawTechFields.length === 0) continue

    const colabsSet = new Set<string>()
    for (const field of rawTechFields) {
      const parts = String(field).split(/[\r\n,;/]+/)
      for (const part of parts) {
        const name = cleanTechnicianName(part)
        if (name) colabsSet.add(name)
      }
    }

    if (colabsSet.size === 0) continue

    allocations.push({
      wo,
      contrato,
      empresa,
      parque,
      escopo,
      statusCampanha,
      previsaoAcesso: mob ? String(mob).split('T')[0] : null,
      colaboradores: Array.from(colabsSet)
    })
  }

  console.log(`[SyncSmartsheet] Total de campanhas ativas mapeadas com técnicos: ${allocations.length}`)
  return allocations
}

export async function runSync(options: { dryRun?: boolean; targetFileId?: string } = {}) {
  const isDryRun = options.dryRun !== false
  const targetFileId = options.targetFileId || process.env.MASSUDE_SHEET_DRIVE_ID || GOOGLE_DRIVE_FILE_ID

  console.log('================================================================================')
  console.log('   HSE AUDIT AUTOMATION — SYNC SMARTSHEET WOs -> GOOGLE SHEETS BASE')
  console.log(`   Modo: ${isDryRun ? 'DRY-RUN (Simulação sem gravação)' : 'APPLY (Atualização real no Drive)'}`)
  console.log(`   Alvo: ${targetFileId}`)
  console.log('================================================================================\n')

  // 1. Obter alocações do Smartsheet
  const campaigns = await fetchSmartsheetCampaigns()

  // 2. Conectar com o Google Drive e baixar a planilha do Massude
  console.log(`\n[SyncSmartsheet] Conectando ao Google Drive via getAuthorizedClient()...`)
  const auth = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth })

  console.log(`[SyncSmartsheet] Baixando planilha (ID: ${targetFileId})...`)
  const localTmpPath = path.resolve(process.cwd(), 'scratch/Controle_Homologacao_Temp.xlsx')
  if (!fs.existsSync(path.dirname(localTmpPath))) {
    fs.mkdirSync(path.dirname(localTmpPath), { recursive: true })
  }

  const driveRes = await drive.files.get(
    { fileId: targetFileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  )
  fs.writeFileSync(localTmpPath, Buffer.from(driveRes.data as ArrayBuffer))
  console.log(`[SyncSmartsheet] Planilha baixada com sucesso (${(fs.statSync(localTmpPath).size / 1024).toFixed(1)} KB)`)

  const backupPath = path.resolve(process.cwd(), `scratch/backup_massude_${Date.now()}.xlsx`)
  fs.copyFileSync(localTmpPath, backupPath)
  console.log(`[SyncSmartsheet] Backup de segurança salvo em: ${backupPath}`)

  // 3. Abrir planilha com ExcelJS
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(localTmpPath)
  const baseSheet = workbook.getWorksheet('BASE')
  if (!baseSheet) {
    throw new Error('Aba "BASE" não encontrada na planilha!')
  }

  // 4. Indexar registros existentes na aba BASE e garantir que todas as linhas fiquem visíveis (sem filtros residuais ocultando linhas)
  const existingMap = new Map<string, ExistingRowRef>()
  let lastRowNumber = 3

  for (let r = 1; r <= baseSheet.rowCount; r++) {
    const row = baseSheet.getRow(r)
    row.hidden = false
    if (r >= 4) {
      const cli = row.getCell(1).text?.trim()
      const emp = row.getCell(2).text?.trim()
      const col = row.getCell(3).text?.trim()
      const atividade = row.getCell(4).text?.trim()
      const status = row.getCell(5).text?.trim()
      const previsaoAcesso = row.getCell(9).value
      const observacoes = row.getCell(17).text?.trim()

      if (emp && col) {
        const ref: ExistingRowRef = {
          rowNumber: r,
          cliente: cli,
          empreendimento: emp,
          colaborador: col,
          atividade,
          status,
          previsaoAcesso,
          observacoes
        }
        existingMap.set(`${normalizeStr(emp)}::${normalizeStr(col)}`, ref)
        if (cli) existingMap.set(`${normalizeStr(cli)}::${normalizeStr(emp)}::${normalizeStr(col)}`, ref)
        lastRowNumber = Math.max(lastRowNumber, r)
      }
    }
  }

  // Desocultar linhas da aba PAINEL e ajustar filtros para (TODOS) se existir
  const painelSheet = workbook.getWorksheet('PAINEL')
  if (painelSheet) {
    painelSheet.getCell('B4').value = '(TODOS)'
    painelSheet.getCell('B5').value = '(TODOS)'
    painelSheet.getCell('B6').value = '(TODOS)'
    for (let r = 1; r <= painelSheet.rowCount; r++) {
      painelSheet.getRow(r).hidden = false
    }
  }

  console.log(`[SyncSmartsheet] Registros existentes na aba BASE: ${existingMap.size} chaves indexadas (última linha: ${lastRowNumber})`)

  // 5. Comparar e identificar novas entradas e atualizações
  const toInsert: NewBaseEntry[] = []
  const toUpdate: UpdateBaseEntry[] = []
  const today = new Date()
  const processedKeys = new Set<string>()

  for (const camp of campaigns) {
    for (const tec of camp.colaboradores) {
      const keyCliEmpCol = `${normalizeStr(camp.empresa)}::${normalizeStr(camp.parque)}::${normalizeStr(tec)}`
      const keyEmpCol = `${normalizeStr(camp.parque)}::${normalizeStr(tec)}`

      const existing = existingMap.get(keyCliEmpCol) || existingMap.get(keyEmpCol)

      if (existing) {
        // Registro já existe: verificar se há alterações de metadados no Smartsheet
        if (processedKeys.has(keyCliEmpCol) || processedKeys.has(keyEmpCol)) continue
        processedKeys.add(keyCliEmpCol)
        processedKeys.add(keyEmpCol)

        const changes: { field: string; oldValue: any; newValue: any; colIndex: number }[] = []

        // A. Previsão de Acesso (MOB)
        if (camp.previsaoAcesso) {
          const newMobStr = formatDateSafe(camp.previsaoAcesso)
          const currentMobStr = formatDateSafe(existing.previsaoAcesso)
          if (newMobStr && currentMobStr !== newMobStr) {
            changes.push({
              field: 'Previsão de Acesso (MOB)',
              oldValue: currentMobStr || 'Vazio',
              newValue: new Date(camp.previsaoAcesso),
              colIndex: 9
            })
          }
        }

        // B. Atividade / Escopo
        if (camp.escopo && (!existing.atividade || existing.atividade.trim() === '')) {
          changes.push({
            field: 'Atividade',
            oldValue: existing.atividade || 'Vazio',
            newValue: camp.escopo,
            colIndex: 4
          })
        }

        // C. WO / Contrato nas Observações
        if (camp.wo && !existing.observacoes.includes(camp.wo)) {
          const newObs = existing.observacoes
            ? `${existing.observacoes} | Nova WO: ${camp.wo}${camp.contrato ? ' / ' + camp.contrato : ''}`
            : `WO: ${camp.wo}${camp.contrato ? ' | Contrato: ' + camp.contrato : ''}`
          changes.push({
            field: 'Observações (WO/Contrato)',
            oldValue: existing.observacoes,
            newValue: newObs,
            colIndex: 17
          })
        }

        if (changes.length > 0) {
          toUpdate.push({
            rowNumber: existing.rowNumber,
            cliente: existing.cliente,
            empreendimento: existing.empreendimento,
            colaborador: existing.colaborador,
            changes
          })
        }
        continue
      }

      // Registro novo
      if (processedKeys.has(keyCliEmpCol) || processedKeys.has(keyEmpCol)) continue
      processedKeys.add(keyCliEmpCol)
      processedKeys.add(keyEmpCol)

      toInsert.push({
        cliente: camp.empresa,
        empreendimento: camp.parque,
        colaborador: tec,
        atividade: camp.escopo,
        status: 'Pendente',
        solicitacaoCadastro: today,
        previsaoAcesso: camp.previsaoAcesso ? new Date(camp.previsaoAcesso) : null,
        observacoes: `WO: ${camp.wo}${camp.contrato ? ' | Contrato: ' + camp.contrato : ''}`
      })
    }
  }

  console.log(`\n================================================================================`)
  console.log(`   DIAGNÓSTICO DE SINCRONIZAÇÃO:`)
  console.log(`   - Novas alocações para inserir na aba BASE:     ${toInsert.length}`)
  console.log(`   - Alocações existentes com atualizações:       ${toUpdate.length}`)
  console.log(`================================================================================`)

  if (toInsert.length === 0 && toUpdate.length === 0) {
    console.log('[SyncSmartsheet] A aba BASE já está 100% atualizada com o Smartsheet.')
    if (!isDryRun) {
      console.log('[SyncSmartsheet] Salvando e garantindo que todas as linhas fiquem visíveis no Google Drive...')
      await workbook.xlsx.writeFile(localTmpPath)
      await drive.files.update({
        fileId: targetFileId,
        media: {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          body: fs.createReadStream(localTmpPath)
        }
      })
      console.log('[SyncSmartsheet] Planilha atualizada e desocultada com sucesso no Google Drive.')
    }
    return { insertedCount: 0, updatedCount: 0 }
  }

  if (toUpdate.length > 0) {
    console.log('\nExemplos de atualizações detectadas no Smartsheet:')
    toUpdate.slice(0, 5).forEach((item, idx) => {
      console.log(`  ${idx + 1}. Linha ${item.rowNumber}: [${item.cliente}] ${item.colaborador} (${item.empreendimento})`)
      item.changes.forEach(c => {
        console.log(`     • ${c.field}: "${c.oldValue}" -> "${c.newValue instanceof Date ? (formatDateSafe(c.newValue) || c.newValue) : c.newValue}"`)
      })
    })
    if (toUpdate.length > 5) {
      console.log(`  ... e mais ${toUpdate.length - 5} colaboradores atualizados.`)
    }
  }

  if (toInsert.length > 0) {
    console.log('\nExemplos de novas linhas a serem criadas na BASE:')
    toInsert.slice(0, 5).forEach((item, idx) => {
      console.log(`  ${idx + 1}. [${item.cliente}] ${item.empreendimento}`)
      console.log(`     Técnico: ${item.colaborador} | Atividade: ${item.atividade}`)
      console.log(`     Obs: ${item.observacoes} | Previsão Acesso: ${item.previsaoAcesso ? item.previsaoAcesso.toISOString().split('T')[0] : 'S/D'}`)
    })
    if (toInsert.length > 5) {
      console.log(`  ... e mais ${toInsert.length - 5} técnicos novos.`)
    }
  }

  if (isDryRun) {
    console.log('\n[SyncSmartsheet] Modo DRY-RUN ativado: nenhuma alteração gravada.')
    console.log('Execute com "--apply" para efetivar a inclusão/atualização na planilha.')
    return { insertedCount: toInsert.length, updatedCount: toUpdate.length, dryRun: true }
  }

  // 6. Aplicar Atualizações em Linhas Existentes
  if (toUpdate.length > 0) {
    console.log(`\n[SyncSmartsheet] Aplicando ${toUpdate.length} atualizações em linhas existentes...`)
    for (const item of toUpdate) {
      const row = baseSheet.getRow(item.rowNumber)
      for (const change of item.changes) {
        row.getCell(change.colIndex).value = change.newValue
      }
      row.commit()
    }
  }

  // 7. Inserir Novas Linhas Preservando Fórmulas
  if (toInsert.length > 0) {
    console.log(`\n[SyncSmartsheet] Inserindo ${toInsert.length} novas linhas na aba BASE a partir da linha ${lastRowNumber + 1}...`)
    let currentRow = lastRowNumber + 1
    for (const entry of toInsert) {
      const row = baseSheet.getRow(currentRow)
      const n = currentRow
      row.hidden = false

      row.getCell(1).value = entry.cliente
      row.getCell(2).value = entry.empreendimento
      row.getCell(3).value = entry.colaborador
      row.getCell(4).value = entry.atividade
      row.getCell(5).value = entry.status
      row.getCell(6).value = entry.solicitacaoCadastro
      if (entry.previsaoAcesso) {
        row.getCell(9).value = entry.previsaoAcesso
      }

      // Fórmulas automáticas de cálculo (Colunas J, K, L, M, S, V, W)
      row.getCell(10).value = { formula: `IF($H${n}="","",IF($F${n}<>"",$H${n}-$F${n},IF($G${n}<>"",$H${n}-$G${n},"")))` }
      row.getCell(11).value = { formula: `IF(OR($E${n}="Liberado",$E${n}="Cancelado",$H${n}<>""),"",IF($F${n}<>"",TODAY()-$F${n},IF($G${n}<>"",TODAY()-$G${n},"")))` }
      row.getCell(12).value = { formula: `IF($E${n}="Liberado","Concluído",IF(OR($E${n}="Cancelado",$E${n}="Reprovado"),"Encerrado",IF(AND($I${n}<>"",$I${n}<TODAY()),"Crítico",IF($K${n}="","",IF($K${n}>SLA_CRITICO,"Crítico",IF($K${n}>SLA_ATENCAO,"Atenção","No prazo"))))))` }
      row.getCell(13).value = { formula: `IF($C${n}="","",IF(AND($H${n}<>"",OR(AND($F${n}<>"",$H${n}<$F${n}),AND($G${n}<>"",$H${n}<$G${n}))),"Datas inconsistentes",IF(COUNTIFS($A$4:$A$993,$A${n},$B$4:$B$993,$B${n},$C$4:$C$993,$C${n})>1,"Registro duplicado",IF(AND($I${n}<>"",$I${n}<TODAY(),$E${n}<>"Liberado",$E${n}<>"Cancelado"),"ACESSO VENCIDO",IF($E${n}="","Sem status",IF(AND($E${n}="Liberado",$H${n}=""),"Liberado sem data de liberação",IF(AND(OR($P${n}>0,$T${n}<>""),$R${n}=""),"Reprovação sem causa classificada","")))))))` }
      row.getCell(17).value = entry.observacoes
      row.getCell(19).value = { formula: `IF($R${n}="","",IFERROR(VLOOKUP($R${n},TAB_CAUSAS,2,0),"Causa não cadastrada"))` }
      row.getCell(22).value = { formula: `IF(AND(OR(PAINEL!$B$4="(TODOS)",$A${n}=PAINEL!$B$4),OR(PAINEL!$B$5="(TODOS)",$B${n}=PAINEL!$B$5),OR(PAINEL!$B$6="(TODOS)",$E${n}=PAINEL!$B$6),$C${n}<>""),MAX(V$3:V${n - 1})+1,"")` }
      row.getCell(23).value = { formula: `IF(AND($C${n}='POR COLABORADOR'!$B$4,$C${n}<>""),MAX(W$3:W${n - 1})+1,"")` }

      row.commit()
      currentRow++
    }
  }

  // 8. Salvar XLSX localmente e fazer upload no Google Drive
  console.log(`[SyncSmartsheet] Salvando arquivo temporário...`)
  await workbook.xlsx.writeFile(localTmpPath)

  console.log(`[SyncSmartsheet] Fazendo upload da planilha atualizada para o Google Drive...`)
  await drive.files.update({
    fileId: targetFileId,
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(localTmpPath)
    }
  })

  console.log(`\n✓ [SyncSmartsheet] SUCESSO: ${toInsert.length} novos técnicos inseridos e ${toUpdate.length} atualizações aplicadas na aba BASE do Google Drive!`)
  return { insertedCount: toInsert.length, updatedCount: toUpdate.length, dryRun: false }
}

// Execução CLI
if (process.argv[1] && process.argv[1].includes('syncSmartsheetToGoogleBase')) {
  const isApply = process.argv.includes('--apply')
  runSync({ dryRun: !isApply })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[SyncSmartsheet] Erro fatal:', err)
      process.exit(1)
    })
}
