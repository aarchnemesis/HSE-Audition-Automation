import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { google } from 'googleapis'
import { DriveNomenclatureStandardizer } from '../domain/services/DriveNomenclatureStandardizer.js'
import { DOC_CATALOG_MAP } from '../domain/services/ComplianceEngine.js'

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

async function main() {
  console.log('\n================================================================================')
  console.log('  SIMULAÇÃO DE PADRONIZAÇÃO E MESCLAGEM DO GOOGLE DRIVE (FASE 1 - DRY RUN)')
  console.log('================================================================================\n')

  const client = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth: client })

  const driveCachePath = path.join(process.cwd(), 'data', 'drive_inspectors_cache.json')
  const pdfCachePath = path.join(process.cwd(), 'data', 'pdf_content_cache.json')

  if (!fs.existsSync(driveCachePath) || !fs.existsSync(pdfCachePath)) {
    console.error('Caches de auditoria não encontrados.')
    process.exit(1)
  }

  const driveInspectors = JSON.parse(fs.readFileSync(driveCachePath, 'utf8'))
  const pdfCache = JSON.parse(fs.readFileSync(pdfCachePath, 'utf8'))

  const pdfMap = new Map<string, any>()
  for (const entry of pdfCache) {
    if (entry.fileId) pdfMap.set(entry.fileId, entry)
  }

  console.log(`[DryRun] Analisando ${driveInspectors.length} pastas de colaboradores...`)

  const simRows: CollabFileSim[] = []
  let renameCount = 0
  let mergeCount = 0

  for (const insp of driveInspectors) {
    const rawName = insp.name.trim()
    const cleanName = DriveNomenclatureStandardizer.cleanCollaboratorName(rawName)
    const folderId = insp.id

    // Agrupa arquivos por norma para checar duplicidades / mesclagens
    const filesByCode: Record<string, any[]> = {}

    for (const [codeKey, cert] of Object.entries(insp.certificates as Record<string, any>)) {
      let fileId = ''
      if (cert.sourcePath && cert.sourcePath.includes('/file/d/')) {
        const m = cert.sourcePath.match(/\/file\/d\/([^\/]+)/)
        if (m) fileId = m[1]
      }
      const cached = fileId ? pdfMap.get(fileId) : null
      const effectiveCode = cert.code || codeKey
      const groupCode = (effectiveCode === '40.1') ? '40' : effectiveCode

      if (!filesByCode[groupCode]) filesByCode[groupCode] = []
      filesByCode[groupCode].push({
        cert,
        cached,
        effectiveCode,
        fileId,
      })
    }

    for (const [groupCode, items] of Object.entries(filesByCode)) {
      const isMergeGroup = items.length > 1 && ['12', '13', '14', '15', '16', '17', '19', '20', '21', '22', '32', '40'].includes(groupCode)

      if (isMergeGroup) {
        mergeCount++
        // Determina a data mais recente
        const sortedByExp = [...items].sort((a, b) => {
          const tA = a.cert.expirationDate ? new Date(a.cert.expirationDate).getTime() : 0
          const tB = b.cert.expirationDate ? new Date(b.cert.expirationDate).getTime() : 0
          return tB - tA
        })
        const latestDate = sortedByExp[0]?.cert.expirationDate || sortedByExp[0]?.cached?.expirationDate

        const proposedMergedName = DriveNomenclatureStandardizer.buildStandardFilename({
          code: groupCode,
          collaboratorName: cleanName,
          date: latestDate,
          isMerged: true,
        })

        for (const item of items) {
          simRows.push({
            folderId,
            collaborator: cleanName,
            fileId: item.fileId,
            currentName: item.cert.filename,
            code: item.effectiveCode,
            docTitle: DOC_CATALOG_MAP[item.effectiveCode] || `Doc ${item.effectiveCode}`,
            modality: DriveNomenclatureStandardizer.detectModality(item.cert.filename) || 'Avulso',
            date: DriveNomenclatureStandardizer.formatDate(item.cert.expirationDate || item.cached?.expirationDate),
            proposedName: proposedMergedName,
            action: 'MESCLAR',
            mergeGroupId: `${cleanName}_${groupCode}`,
          })
        }
      } else {
        // Documentos individuais
        for (const item of items) {
          const expDate = item.cert.expirationDate || item.cached?.expirationDate
          const proposedName = DriveNomenclatureStandardizer.buildStandardFilename({
            code: item.effectiveCode,
            originalFilename: item.cert.filename,
            collaboratorName: cleanName,
            date: expDate,
          })

          const isIdentical = item.cert.filename === proposedName
          if (!isIdentical) renameCount++

          simRows.push({
            folderId,
            collaborator: cleanName,
            fileId: item.fileId,
            currentName: item.cert.filename,
            code: item.effectiveCode,
            docTitle: DOC_CATALOG_MAP[item.effectiveCode] || `Doc ${item.effectiveCode}`,
            modality: DriveNomenclatureStandardizer.detectModality(item.cert.filename) || 'Avulso',
            date: DriveNomenclatureStandardizer.formatDate(expDate),
            proposedName,
            action: isIdentical ? 'MANTER' : 'RENOMEAR',
          })
        }
      }
    }
  }

  // Exporta para Planilha Excel
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Simulação Padronização')

  ws.columns = [
    { header: 'Colaborador', key: 'collaborator', width: 35 },
    { header: 'Código', key: 'code', width: 8 },
    { header: 'Documento / Treinamento', key: 'docTitle', width: 32 },
    { header: 'Ação Recomendada', key: 'action', width: 16 },
    { header: 'Nome Atual no Drive', key: 'currentName', width: 55 },
    { header: 'Novo Nome Padronizado Proposto', key: 'proposedName', width: 55 },
    { header: 'Data Válida', key: 'date', width: 14 },
    { header: 'Modalidade', key: 'modality', width: 12 },
    { header: 'ID do Arquivo no Drive', key: 'fileId', width: 36 },
  ]

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } }

  for (const r of simRows) {
    const row = ws.addRow(r)
    if (r.action === 'MESCLAR') {
      row.getCell('action').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }
      row.getCell('action').font = { color: { argb: 'FF6D28D9' }, bold: true }
    } else if (r.action === 'RENOMEAR') {
      row.getCell('action').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } }
      row.getCell('action').font = { color: { argb: 'FF92400E' }, bold: true }
    } else {
      row.getCell('action').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } }
      row.getCell('action').font = { color: { argb: 'FF166534' } }
    }
  }

  const outExcel = path.join(process.cwd(), 'scratch', 'simulacao_padronizacao_drive.xlsx')
  const outJson = path.join(process.cwd(), 'scratch', 'simulacao_padronizacao_drive.json')

  await wb.xlsx.writeFile(outExcel)
  fs.writeFileSync(outJson, JSON.stringify(simRows, null, 2), 'utf8')

  console.log('\n--- RESULTADO DA SIMULAÇÃO (DRY RUN) ---')
  console.log(`Total de Arquivos Mapeados: ${simRows.length}`)
  console.log(`Arquivos para Renomeação: ${renameCount}`)
  console.log(`Grupos para Mesclagem (F+R ou Contrato+Aditivo): ${mergeCount}`)
  console.log(`Planilha de Simulação gerada com sucesso: ${outExcel}`)
  console.log(`Arquivo JSON gerado com sucesso: ${outJson}`)
}

main().catch(err => {
  console.error('[DryRun] Erro:', err)
  process.exit(1)
})
