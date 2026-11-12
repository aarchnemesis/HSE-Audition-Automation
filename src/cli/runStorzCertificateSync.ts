/**
 * Certificados concluídos na Storz que ainda não estão no Drive do colaborador.
 *
 *   Plano (padrão): lista os certificados da Storz (API certificatesOnlyForUser), cruza com o cache do
 *   Drive, baixa o PDF só dos que faltam, lê o conteúdo e propõe o nome do Book EHS. Grava
 *   scratch/storz_plan.json e os PDFs em scratch/storz_certs/. Não mexe no Drive.
 *     npx tsx src/cli/runStorzCertificateSync.ts [--since=AAAA-MM-DD]
 *
 *   Aplicar: envia para a subpasta 03_TREINAMENTOS do colaborador só os certificados aprovados.
 *     npx tsx src/cli/runStorzCertificateSync.ts --apply=<decisions.json>
 *
 * Ver o certificado na Storz não consome crédito nesta conta (sn_creditos = 0 em todos os registros);
 * se a API passar a cobrar (sn_creditos = 1), o certificado é pulado e registrado.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { google } from 'googleapis'
import pdfParse from 'pdf-parse'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { StorzHttpScraper } from '../adapters/storz/StorzHttpScraper.js'
import { CertificateClassifier } from '../domain/services/CertificateClassifier.js'
import { checkHolder, createPdfPageCollector, PDFContentInspector } from '../domain/services/PDFContentInspector.js'
import { namesMatch } from '../domain/services/PersonNameMatcher.js'
import { bookName, BOOK_SUBFOLDER } from '../domain/services/BookNaming.js'

const OUT_DIR = path.join('scratch', 'storz_certs')
const PLAN = path.join('scratch', 'storz_plan.json')
const API = 'https://api.sistemaescudo.com.br/'
const STORZ = 'https://storz.sistemaescudo.com.br/'

const brToIso = (d: string) => d.split('/').reverse().join('-')

async function plan(since?: string) {
  const session = await new StorzHttpScraper().login()
  const auth = { Authorization: `Bearer ${session.bearerToken}`, Accept: 'application/json' }

  const certs: any[] = []
  for (let page = 1; ; page++) {
    const r = await fetch(`${API}v2/certificates/certificatesOnlyForUser/${session.handle}?page=${page}&limit=100`, { headers: auth })
    if (!r.ok) throw new Error(`Storz certificados: HTTP ${r.status}`)
    const j: any = await r.json()
    certs.push(...j.data)
    const oldest = j.data.at(-1)?.dt_conclusao
    if (page >= j.meta.last_page || (since && oldest && brToIso(oldest) < since)) break
  }
  const recent = since ? certs.filter(c => brToIso(c.dt_conclusao) >= since) : certs
  console.log(`[storz-certs] ${certs.length} certificados lidos na Storz, ${recent.length} no período`)

  const drive = JSON.parse(fs.readFileSync('data/drive_inspectors_cache.json', 'utf8'))
  const roster: string[] = drive.map((x: any) => x.name)
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const rows: any[] = []
  for (const c of recent) {
    const person = drive.find((x: any) => namesMatch(x.name, c.ds_nome_aluno))
    const code = CertificateClassifier.classify(c.ds_nome_curso).code
    const concl = brToIso(c.dt_conclusao)
    const base = { certId: c.id_certificado, student: c.ds_nome_aluno, course: c.ds_nome_curso, conclusion: concl, code }
    if (!person) { rows.push({ ...base, action: 'REVISAR', issue: 'Aluno não encontrado entre as pastas do Drive' }); continue }
    if (!code) { rows.push({ ...base, person: person.name, action: 'REVISAR', issue: 'Curso sem código correspondente no Drive' }); continue }
    const inDrive = person.certificates?.[code]
    const driveIssue = inDrive?.issueDate ? String(inDrive.issueDate).slice(0, 10) : undefined
    if (driveIssue && driveIssue >= concl) continue // o Drive já tem este ou um mais novo
    if (c.sn_creditos === 1) { rows.push({ ...base, person: person.name, action: 'REVISAR', issue: 'A Storz cobra crédito por este certificado; não baixado' }); continue }

    const link: any = await (await fetch(`${STORZ}admin/cursos/certificados_lote/index_v2.php`, {
      method: 'POST',
      headers: { Cookie: session.cookies },
      body: (() => { const f = new FormData(); f.append('acao', 'get_link_objeto'); f.append('id_matricula_cert', String(c.id_matricula)); f.append('id_pessoa_cert', String(c.id_pessoa)); f.append('key', `certificados/${c.id_pessoa}/${c.id_matricula}.pdf`); f.append('time', '+5 minutes'); f.append('baixar', 'true'); return f })(),
    })).json().catch(() => ({}))
    if (link?.sucesso != 1) { rows.push({ ...base, person: person.name, action: 'REVISAR', issue: 'A Storz não devolveu o PDF do certificado' }); continue }
    const pdf = Buffer.from(await (await fetch(link.resultado)).arrayBuffer())
    const local = path.join(OUT_DIR, `${c.id_certificado}.pdf`)
    fs.writeFileSync(local, pdf)

    const col = createPdfPageCollector()
    await pdfParse(pdf, { pagerender: col.pagerender })
    const read = PDFContentInspector.inspectPages(c.ds_nome_curso, col.pages).find(i => i.code === code)
    const holder = checkHolder(col.pages.join('\n'), person.name, roster)
    const emi = read?.issueDate ? new Date(read.issueDate).toISOString().slice(0, 10) : concl
    const issues: string[] = []
    if (holder.status !== 'OK') issues.push(`Titular não confirmado no PDF (${holder.status}${holder.other ? `: ${holder.other}` : ''})`)
    if (emi !== concl) issues.push(`Data lida no PDF (${emi}) diferente da conclusão na Storz (${concl})`)
    const tipo = /PERI[OÓ]DIC|RECICL/i.test(c.ds_nome_curso) ? 'RECICLAGEM' : 'FORMACAO'
    if (!bookName(code, tipo, emi, person.name)) issues.push(`Código ${code} fora da tabela do Book; sem nome padrão`)
    rows.push({
      ...base,
      person: person.name,
      personFolderId: person.driveFolderId,
      local,
      driveHas: driveIssue ? `Drive tem emissão ${driveIssue}` : 'Não está no Drive',
      proposedName: bookName(code, tipo, emi, person.name, read?.expirationDate),
      action: issues.length ? 'REVISAR' : 'INCLUIR',
      issue: issues.join(' | '),
    })
  }
  fs.writeFileSync(PLAN, JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1))
  const n = (a: string) => rows.filter(r => r.action === a).length
  console.log(`[storz-certs] ${n('INCLUIR')} prontos para incluir no Drive | ${n('REVISAR')} para revisar | resto já está no Drive`)
}

async function apply(decisionsPath: string) {
  const approved = new Set(JSON.parse(fs.readFileSync(decisionsPath, 'utf8')).flatMap((d: any) => d.approved ?? []).map((id: any) => String(id).replace(/^storz-/, '')))
  const { rows } = JSON.parse(fs.readFileSync(PLAN, 'utf8'))
  const drive = google.drive({ version: 'v3', auth: (await getAuthorizedClient()) as any })
  let done = 0
  for (const r of rows.filter((r: any) => approved.has(String(r.certId)) && r.local && r.proposedName)) {
    const q = `'${r.personFolderId}' in parents and name = '${BOOK_SUBFOLDER.TREINO}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    const folder = (await drive.files.list({ q, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true })).data.files?.[0]?.id
      ?? (await drive.files.create({ requestBody: { name: BOOK_SUBFOLDER.TREINO, mimeType: 'application/vnd.google-apps.folder', parents: [r.personFolderId] }, fields: 'id', supportsAllDrives: true })).data.id!
    const dup = (await drive.files.list({ q: `'${folder}' in parents and name = '${r.proposedName}' and trashed = false`, fields: 'files(id)', supportsAllDrives: true, includeItemsFromAllDrives: true })).data.files?.length
    if (dup) { console.log(`JÁ EXISTE: ${r.proposedName}`); continue }
    const res = await drive.files.create({
      requestBody: { name: r.proposedName, parents: [folder], description: `Certificado Storz ${r.certId}, concluído em ${r.conclusion}` },
      media: { mimeType: 'application/pdf', body: Readable.from(fs.readFileSync(r.local)) },
      fields: 'id', supportsAllDrives: true,
    })
    fs.appendFileSync('scratch/storz_apply_log.jsonl', JSON.stringify({ certId: r.certId, fileId: res.data.id, name: r.proposedName, at: new Date().toISOString() }) + '\n')
    console.log(`INCLUÍDO ${r.person} | ${r.proposedName}`)
    done++
  }
  console.log(`[storz-certs] ${done} certificados incluídos no Drive`)
}

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1]
;(arg('apply') ? apply(arg('apply')!) : plan(arg('since'))).catch(e => { console.error(e); process.exit(1) })
