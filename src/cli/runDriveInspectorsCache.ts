import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { GoogleDriveOAuthAdapter } from '../adapters/drive/GoogleDriveOAuthAdapter.js'
import { TesseractOcrAdapter } from '../adapters/ocr/TesseractOcrAdapter.js'
import { Inspector } from '../domain/models/Certificate.js'
import { DOC_CATALOG_MAP } from '../domain/services/ComplianceEngine.js'
import { HSEDataPipeline } from '../domain/services/HSEDataPipeline.js'

interface UnreadItem {
  collaborator: string
  folderUrl?: string
  code: string
  document: string
  file?: string
  fileUrl?: string
  reason: string
}

function summarize(inspectors: Inspector[]) {
  const bySource: Record<string, number> = {}
  const unread: UnreadItem[] = []
  let divergent = 0
  for (const insp of inspectors) {
    for (const cert of insp.certificates.values()) {
      const src = cert.readSource ?? 'DESCONHECIDO'
      bySource[src] = (bySource[src] ?? 0) + 1
      if (cert.divergences?.length) divergent++
      if (cert.statusEHS === 'NAO_LIDO')
        unread.push({
          collaborator: insp.name,
          folderUrl: insp.driveFolderUrl,
          code: cert.code,
          document: DOC_CATALOG_MAP[cert.code] ?? cert.code,
          file: cert.filename,
          fileUrl: cert.sourcePath,
          reason: cert.statusDetail ?? '',
        })
    }
  }
  return { bySource, unread, divergent }
}

async function main() {
  const force = process.argv.includes('--force')
  const roots = (process.env.HSE_DRIVE_FOLDER_ID ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  if (!roots.length) throw new Error('HSE_DRIVE_FOLDER_ID is not set')

  await TesseractOcrAdapter.assertAvailable()

  const refDate = process.env.HSE_REF_DATE
    ? new Date(process.env.HSE_REF_DATE)
    : new Date()
  const started = Date.now()
  const inspectors = await new GoogleDriveOAuthAdapter(
    roots,
    refDate
  ).getInspectors()

  const pipeline = new HSEDataPipeline()
  const previous = pipeline.loadDriveInspectorsCache(refDate)
  if (
    !force &&
    previous.length > 0 &&
    inspectors.length < previous.length * 0.8
  ) {
    console.error(
      `[drive-cache] ${inspectors.length} pastas lidas contra ${previous.length} no cache atual: leitura parcial, nada foi gravado. Use --force para sobrescrever.`
    )
    process.exitCode = 2
    return
  }

  pipeline.saveDriveInspectorsCache(inspectors)
  const { bySource, unread, divergent } = summarize(inspectors)

  const outDir = path.join(process.cwd(), 'scratch')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'drive_unread_documents.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), refDate, unread },
      null,
      2
    )
  )

  const minutes = ((Date.now() - started) / 60000).toFixed(1)
  console.log(
    `[drive-cache] ${inspectors.length} colaboradores em ${minutes} min | origem: ${JSON.stringify(bySource)} | ${unread.length} documentos NÃO LIDOS | ${divergent} com nome divergente do conteúdo`
  )
  console.log(
    '[drive-cache] Lista de NÃO LIDOS por colaborador: scratch/drive_unread_documents.json'
  )
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
