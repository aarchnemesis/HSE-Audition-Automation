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

function parseDateFromFilename(filename: string): Date | null {
  const normalized = filename.replace(/_/g, ' ')
  // Caso período: "a DD.MM.YYYY" (ex.: 12.03.2026 a 11.05.2027)
  const periodMatch = normalized.match(/a\s+(\d{2})[\s\.\/-](\d{2})[\s\.\/-](\d{2,4})/i)
  if (periodMatch) {
    const day = parseInt(periodMatch[1], 10)
    const month = parseInt(periodMatch[2], 10) - 1
    let year = parseInt(periodMatch[3], 10)
    if (year < 100) year += 2000
    return new Date(Date.UTC(year, month, day))
  }
  const dmyMatch = normalized.match(/(?:^|\D)(\d{2})[\s\.\/-](\d{2})[\s\.\/-](\d{2,4})(?:\D|$)/)
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10)
    const month = parseInt(dmyMatch[2], 10) - 1
    let year = parseInt(dmyMatch[3], 10)
    if (year < 100) year += 2000
    if (year >= 1990 && year <= 2040) return new Date(Date.UTC(year, month, day))
  }
  return null
}

function resolveContractAditivoDate(items: any[]): { date: Date | null; hasAditivo: boolean } {
  let aditivoDate: Date | null = null

  // 1. Prioridade absoluta: data de fim do aditivo (pedido da Darliane)
  for (const item of items) {
    const fn = (item.cert.filename || '').toUpperCase()
    const isAditivo = fn.includes('ADITIVO') || (item.effectiveCode === '40.1' && !fn.includes('CONTRATO PJ'))

    if (isAditivo) {
      const fnDate = parseDateFromFilename(item.cert.filename)
      if (fnDate && (!aditivoDate || fnDate.getTime() > aditivoDate.getTime())) {
        aditivoDate = fnDate
      }
      const exp = item.cert.expirationDate ? new Date(item.cert.expirationDate) : null
      if (exp && !isNaN(exp.getTime()) && exp.getUTCFullYear() < 2050) {
        if (!aditivoDate || exp.getTime() > aditivoDate.getTime()) {
          aditivoDate = exp
        }
      }
    }

    if (item.cached?.documents) {
      for (const doc of item.cached.documents) {
        if (['40.1', '04.1'].includes(doc.code) && doc.expirationDate) {
          const exp = new Date(doc.expirationDate)
          if (!isNaN(exp.getTime()) && exp.getUTCFullYear() < 2050) {
            if (!aditivoDate || exp.getTime() > aditivoDate.getTime()) {
              aditivoDate = exp
            }
          }
        }
      }
    }
  }

  if (aditivoDate) return { date: aditivoDate, hasAditivo: true }

  // 2. Se não houver aditivo, busca data real do contrato (ignorando proxies de 50 anos)
  for (const item of items) {
    const fnDate = parseDateFromFilename(item.cert.filename)
    if (fnDate) return { date: fnDate, hasAditivo: false }

    if (item.cached?.documents) {
      const doc40 = item.cached.documents.find((d: any) => ['40', '04'].includes(d.code) && d.expirationDate)
      if (doc40) {
        const exp = new Date(doc40.expirationDate)
        if (!isNaN(exp.getTime()) && exp.getUTCFullYear() < 2050) return { date: exp, hasAditivo: false }
      }
    }

    const exp = item.cert.expirationDate ? new Date(item.cert.expirationDate) : null
    if (exp && !isNaN(exp.getTime()) && exp.getUTCFullYear() < 2050) return { date: exp, hasAditivo: false }

    const issue = item.cert.issueDate ? new Date(item.cert.issueDate) : null
    if (issue && !isNaN(issue.getTime()) && issue.getUTCFullYear() < 2050) return { date: issue, hasAditivo: false }
  }

  return { date: null, hasAditivo: false }
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
      // Agrupa por arquivo físico único no Drive (pelo fileId ou filename)
      const fileIdMap = new Map<string, any[]>()
      for (const item of items) {
        const key = item.fileId || item.cert.filename
        if (!fileIdMap.has(key)) fileIdMap.set(key, [])
        fileIdMap.get(key)!.push(item)
      }

      const uniqueFilesCount = fileIdMap.size
      const isMergeableCode = ['12', '13', '14', '15', '16', '17', '19', '20', '21', '22', '32', '40'].includes(groupCode)
      const isMergeGroup = uniqueFilesCount > 1 && isMergeableCode

      if (groupCode === '40') {
        // Regra especial Contrato PJ / Aditivo (Darliane: data do fim do aditivo)
        const contractRes = resolveContractAditivoDate(items)
        const effectiveDate = contractRes.date
        const hasAditivo = contractRes.hasAditivo

        if (isMergeGroup) {
          mergeCount++
          const proposedMergedName = DriveNomenclatureStandardizer.buildStandardFilename({
            code: '40',
            collaboratorName: cleanName,
            date: effectiveDate,
            aditivoDate: hasAditivo ? effectiveDate : undefined,
            isMerged: true,
          })

          for (const [fId, fileItems] of fileIdMap.entries()) {
            const primaryItem = fileItems[0]
            simRows.push({
              folderId,
              collaborator: cleanName,
              fileId: primaryItem.fileId,
              currentName: primaryItem.cert.filename,
              code: primaryItem.effectiveCode,
              docTitle: DOC_CATALOG_MAP[primaryItem.effectiveCode] || `Doc ${primaryItem.effectiveCode}`,
              modality: DriveNomenclatureStandardizer.detectModality(primaryItem.cert.filename) || 'Avulso',
              date: DriveNomenclatureStandardizer.formatDate(effectiveDate),
              proposedName: proposedMergedName,
              action: 'MESCLAR',
              mergeGroupId: `${cleanName}_40`,
            })
          }
        } else {
          // Arquivo único (já contém contrato ou contrato+aditivo)
          for (const [fId, fileItems] of fileIdMap.entries()) {
            const primaryItem = fileItems[0]
            const proposedName = DriveNomenclatureStandardizer.buildStandardFilename({
              code: '40',
              originalFilename: primaryItem.cert.filename,
              collaboratorName: cleanName,
              date: effectiveDate,
              aditivoDate: hasAditivo ? effectiveDate : undefined,
              isMerged: false,
            })
            const isIdentical = primaryItem.cert.filename === proposedName
            if (!isIdentical) renameCount++

            simRows.push({
              folderId,
              collaborator: cleanName,
              fileId: primaryItem.fileId,
              currentName: primaryItem.cert.filename,
              code: '40',
              docTitle: hasAditivo ? 'Contrato + Aditivo' : 'Contrato de Prestação de Serviço',
              modality: DriveNomenclatureStandardizer.detectModality(primaryItem.cert.filename) || 'Avulso',
              date: DriveNomenclatureStandardizer.formatDate(effectiveDate),
              proposedName,
              action: isIdentical ? 'MANTER' : 'RENOMEAR',
            })
          }
        }
      } else if (isMergeGroup) {
        mergeCount++
        // Determina a data mais recente válida (< 2050)
        const sortedByExp = [...items].sort((a, b) => {
          const tA = (a.cert.expirationDate && new Date(a.cert.expirationDate).getUTCFullYear() < 2050)
            ? new Date(a.cert.expirationDate).getTime()
            : (a.cert.issueDate ? new Date(a.cert.issueDate).getTime() : 0)
          const tB = (b.cert.expirationDate && new Date(b.cert.expirationDate).getUTCFullYear() < 2050)
            ? new Date(b.cert.expirationDate).getTime()
            : (b.cert.issueDate ? new Date(b.cert.issueDate).getTime() : 0)
          return tB - tA
        })
        const latestExp = sortedByExp[0]?.cert.expirationDate
        const latestDate = (latestExp && new Date(latestExp).getUTCFullYear() < 2050)
          ? latestExp
          : sortedByExp[0]?.cert.issueDate

        const proposedMergedName = DriveNomenclatureStandardizer.buildStandardFilename({
          code: groupCode,
          collaboratorName: cleanName,
          date: latestDate,
          isMerged: true,
        })

        for (const [fId, fileItems] of fileIdMap.entries()) {
          const primaryItem = fileItems[0]
          const exp = primaryItem.cert.expirationDate
          const dateToUse = (exp && new Date(exp).getUTCFullYear() < 2050) ? exp : primaryItem.cert.issueDate
          simRows.push({
            folderId,
            collaborator: cleanName,
            fileId: primaryItem.fileId,
            currentName: primaryItem.cert.filename,
            code: primaryItem.effectiveCode,
            docTitle: DOC_CATALOG_MAP[primaryItem.effectiveCode] || `Doc ${primaryItem.effectiveCode}`,
            modality: DriveNomenclatureStandardizer.detectModality(primaryItem.cert.filename) || 'Avulso',
            date: DriveNomenclatureStandardizer.formatDate(dateToUse),
            proposedName: proposedMergedName,
            action: 'MESCLAR',
            mergeGroupId: `${cleanName}_${groupCode}`,
          })
        }
      } else {
        // Documentos individuais
        for (const [fId, fileItems] of fileIdMap.entries()) {
          const primaryItem = fileItems[0]
          const exp = primaryItem.cert.expirationDate
          const dateToUse = (exp && new Date(exp).getUTCFullYear() < 2050)
            ? exp
            : (primaryItem.cert.issueDate && new Date(primaryItem.cert.issueDate).getUTCFullYear() < 2050
                ? primaryItem.cert.issueDate
                : (primaryItem.cached?.expirationDate && new Date(primaryItem.cached.expirationDate).getUTCFullYear() < 2050
                    ? primaryItem.cached.expirationDate
                    : null))

          const proposedName = DriveNomenclatureStandardizer.buildStandardFilename({
            code: primaryItem.effectiveCode,
            originalFilename: primaryItem.cert.filename,
            collaboratorName: cleanName,
            date: dateToUse,
          })

          const isIdentical = primaryItem.cert.filename === proposedName
          if (!isIdentical) renameCount++

          simRows.push({
            folderId,
            collaborator: cleanName,
            fileId: primaryItem.fileId,
            currentName: primaryItem.cert.filename,
            code: primaryItem.effectiveCode,
            docTitle: DOC_CATALOG_MAP[primaryItem.effectiveCode] || `Doc ${primaryItem.effectiveCode}`,
            modality: DriveNomenclatureStandardizer.detectModality(primaryItem.cert.filename) || 'Avulso',
            date: DriveNomenclatureStandardizer.formatDate(dateToUse),
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
