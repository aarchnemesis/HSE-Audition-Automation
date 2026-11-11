import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import {
  GoogleDriveOAuthAdapter,
  HOLDER_NOT_FOUND,
} from '../adapters/drive/GoogleDriveOAuthAdapter.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import {
  DocumentIssue,
  UNREAD_EMAIL_DEFAULT_TO,
  buildUnreadDocumentsEmail,
} from '../adapters/email/unreadDocumentsEmail.js'
import { TesseractOcrAdapter } from '../adapters/ocr/TesseractOcrAdapter.js'
import { Certificate, Inspector } from '../domain/models/Certificate.js'
import { DOC_CATALOG_MAP } from '../domain/services/ComplianceEngine.js'
import { HSEDataPipeline } from '../domain/services/HSEDataPipeline.js'

function issueOf(
  insp: Inspector,
  cert: Certificate,
  reason: string
): DocumentIssue {
  return {
    collaborator: insp.name,
    folderUrl: insp.driveFolderUrl,
    code: cert.code,
    document: DOC_CATALOG_MAP[cert.code] ?? cert.code,
    file: cert.filename,
    fileUrl: cert.sourcePath,
    reason,
  }
}

function summarize(inspectors: Inspector[]) {
  const bySource: Record<string, number> = {}
  const unread: DocumentIssue[] = []
  const holderWarnings: DocumentIssue[] = []
  let divergent = 0
  for (const insp of inspectors) {
    for (const cert of insp.certificates.values()) {
      const src = cert.readSource ?? 'DESCONHECIDO'
      bySource[src] = (bySource[src] ?? 0) + 1
      if (cert.divergences?.length) divergent++
      if (cert.statusEHS === 'NAO_LIDO')
        unread.push(issueOf(insp, cert, cert.statusDetail ?? ''))
      if (cert.divergences?.includes(HOLDER_NOT_FOUND))
        holderWarnings.push(issueOf(insp, cert, HOLDER_NOT_FOUND))
    }
  }
  return { bySource, unread, holderWarnings, divergent }
}

async function main() {
  const force = process.argv.includes('--force')
  const sendEmail = process.argv.includes('--email')
  const only = process.argv
    .find(a => a.startsWith('--only='))
    ?.slice('--only='.length)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
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
  ).getInspectors(only)

  if (only?.length) {
    for (const insp of inspectors)
      for (const cert of insp.certificates.values())
        console.log(
          `${insp.name} | ${cert.code} | ${cert.statusEHS} | ${cert.readSource} | ${cert.filename} | ${cert.statusDetail}${cert.divergences?.length ? ` | DIVERGÊNCIA: ${cert.divergences.join('; ')}` : ''}`
        )
    return
  }

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
  const { bySource, unread, holderWarnings, divergent } = summarize(inspectors)

  const outDir = path.join(process.cwd(), 'scratch')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'drive_unread_documents.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        refDate,
        unread,
        holderWarnings,
      },
      null,
      2
    )
  )

  const minutes = ((Date.now() - started) / 60000).toFixed(1)
  console.log(
    `[drive-cache] ${inspectors.length} colaboradores em ${minutes} min | origem: ${JSON.stringify(bySource)} | ${unread.length} NÃO LIDOS | ${holderWarnings.length} sem o nome do titular | ${divergent} com nome divergente do conteúdo`
  )

  if (sendEmail && (unread.length || holderWarnings.length)) {
    const smtp = SmtpEmailService.fromEnv()
    if (!smtp) {
      console.error('[drive-cache] SMTP não configurado: e-mail não enviado.')
      process.exitCode = 1
      return
    }
    const { subject, html } = buildUnreadDocumentsEmail({
      refDate,
      unread,
      holderWarnings,
    })
    const to = process.env.HSE_UNREAD_EMAIL_TO || UNREAD_EMAIL_DEFAULT_TO
    const result = await smtp.sendEmail({ to, subject, htmlContent: html })
    if (!result.success) process.exitCode = 1
  }
}

main().catch(err => {
  console.error(err)
  process.exitCode = 1
})
