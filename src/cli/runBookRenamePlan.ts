/**
 * Plano de renomeação no padrão do Book de Padronização EHS (Armando, 10/11/2026, seção 2):
 *   CC_DOCUMENTO-TIPO_EMI-AAAA-MM-DD_VAL-AAAA-MM-DD_NOME-COMPLETO.pdf
 * Somente leitura: lista o Drive e usa as datas já lidas do conteúdo (pdf_content_cache). Não baixa,
 * não renomeia e não move nada. Grava scratch/book_rename_plan.json para revisão humana; quem aplica é
 * runBookRenameApply.ts, e só as linhas aprovadas.
 *
 * Uso: npx tsx src/cli/runBookRenamePlan.ts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { drive_v3, google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { BOOK_CODE, BOOK_NO_EXPIRY, BOOK_VALIDITY_MONTHS } from '../domain/services/BookNaming.js'
import { CertificateClassifier } from '../domain/services/CertificateClassifier.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// Tabela única do Book (domain/services/BookNaming), a mesma usada pela Storz e pela leitura do Drive.
/** Códigos do Drive que o Book não prevê (ou que mudaram de sentido): ficam para decisão humana. */
const OUT_OF_BOOK: Record<string, string> = {}
const SUBFOLDER: Record<string, string> = { ASO: '02_SAUDE_OCUPACIONAL', TREINO: '03_TREINAMENTOS', UNICO: '01_DOCUMENTOS_PESSOAIS' }
const NO_EXPIRY = BOOK_NO_EXPIRY

const iso = (d?: string) => (d ? d.slice(0, 10) : undefined)
const slugName = (n: string) =>
  n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]+/g, '-').replace(/^-|-$/g, '')

/** Documento sem código no Book: pasta e nome a partir do nome do arquivo e da leitura do Prometheus. */
function extraFor(filename: string, d?: any): { sub: string; slug: string; emi?: string; val: string } | null {
  const ok = (x?: string) => (x && x !== 'ausente' ? x : undefined)
  const curso = ok(d?.curso_ou_norma)
  if (!d || !curso) return null
  const t = `${filename} ${curso}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  const dateOf = (x?: string) => (x && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined)
  const emi = dateOf(ok(d.data_conclusao)) ?? dateOf(ok(d.data_assinatura))
  const val = dateOf(ok(d.validade_declarada)) ?? 'NA'
  const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '')
  if (/EXAME|AUDIOMETR|ACUIDADE|ESPIROMETR|ELETROCARDIO|\bECG\b|\bEEG\b|ELETROENCEF|HEMOGRAMA|GLICEMIA|\bIGE\b|TOXICOL|LAUDO/.test(t))
    return { sub: '02_SAUDE_OCUPACIONAL/EXAMES', slug: `EXAME-${slug(curso)}`, emi, val }
  if (/CERTIDAO|ENSINO MEDIO|HISTORICO ESCOLAR|CARTA DE (IDENTIFICACAO DOS )?RISCOS|GUIA DE RISCOS|RISCOS AMBIENTAIS/.test(t))
    return { sub: '01_DOCUMENTOS_PESSOAIS/OUTROS', slug: slug(curso), emi, val }
  if (d.tipo_documento !== 'certificado_treinamento') return null
  if (/GAMESA|SIEMENS|SGRE|\bSGTT\b|\bSG ?\d|\bTSWA?\b|TASK SPECIFIC|BLADE INSPECTION/.test(t))
    return { sub: '03_TREINAMENTOS/CLIENTE', slug: `TSW-GAMESA-${slug(curso)}`, emi, val }
  if (/INTEGRACAO|SAFETY INDUCTION|INDUCAO/.test(t))
    return { sub: '03_TREINAMENTOS/CLIENTE', slug: `INTEGRACAO-${slug(curso)}`, emi, val }
  return { sub: '03_TREINAMENTOS/COMPLEMENTARES', slug: slug(curso), emi, val }
}

/**
 * Documento pessoal sem código no Book (RG, CPF, passaporte, foto, assinatura, admissão): vai para
 * 01_DOCUMENTOS_PESSOAIS (decisão do João, 18/11/2026). Pelo nome do arquivo ou pelo tipo lido; o que estiver
 * solto na raiz da pasta do colaborador sem tipo reconhecido também vai, como DOC-PESSOAL.
 */
function personalFor(filename: string, atRoot: boolean, d?: any): string | null {
  const t = `${filename} ${d?.curso_ou_norma ?? ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  const rules: [RegExp, string][] = [
    [/PASSAPORT|PASSPORT/, 'PASSAPORTE'],
    [/\bRG\b|IDENTIDADE|\bCIN\b/, 'RG'],
    [/CPF/, 'CPF'],
    [/TITULO|ELEITOR/, 'TITULO-ELEITOR'],
    [/RESERVISTA|DISPENSA DE INCORPORA/, 'RESERVISTA'],
    [/FOTO|3X4/, 'FOTO-3X4'],
    [/ASSINATURA/, 'ASSINATURA'],
    [/ADMISS/, 'DOCUMENTOS-ADMISSIONAIS'],
    [/COMPROVANTE DE (RESIDENCIA|ENDERECO)/, 'COMPROVANTE-RESIDENCIA'],
  ]
  for (const [re, slug] of rules) if (re.test(t)) return slug
  return atRoot && (!d || d.tipo_documento === 'outro') ? 'DOC-PESSOAL' : null
}

function tipoFor(kind: string, filename: string): string {
  const f = filename.toUpperCase()
  if (kind === 'ASO') {
    if (/\bADM|ADMISS/.test(f)) return 'ADM'
    if (/DEMISS|\bDEM\b/.test(f)) return 'DEM'
    if (/RETORNO|\bRT\b/.test(f)) return 'RT'
    if (/MUDAN|\bMRO\b/.test(f)) return 'MRO'
    return 'PER'
  }
  if (kind === 'TREINO') return /RECICL|PERI[OÓ]DIC|\bREC\b|F\+R|\bP\)/.test(f) ? 'RECICLAGEM' : 'FORMACAO'
  return 'UNICO'
}

async function main() {
  const roots = (process.env.HSE_DRIVE_FOLDER_ID ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const drive = google.drive({ version: 'v3', auth: (await getAuthorizedClient()) as any })
  const list = async (id: string) => {
    const out: drive_v3.Schema$File[] = []
    let pageToken: string | undefined
    do {
      const r = await drive.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,modifiedTime)',
        pageSize: 1000, pageToken, supportsAllDrives: true, includeItemsFromAllDrives: true,
      })
      out.push(...(r.data.files ?? []))
      pageToken = r.data.nextPageToken ?? undefined
    } while (pageToken)
    return out
  }

  const raw = JSON.parse(fs.readFileSync('data/pdf_content_cache.json', 'utf8'))
  const cache = new Map<string, any>((Array.isArray(raw) ? raw : Object.values(raw)).map((e: any) => [e.fileId, e]))
  // Leitura do LLM por md5 (opcional): diz quantos documentos há no PDF e em que páginas.
  const llm = new Map<string, any>()
  try { for (const [k, v] of Object.entries<any>(JSON.parse(fs.readFileSync('data/llm_reading_cache.json', 'utf8')))) llm.set(k.split('|')[0], v) } catch {}
  const GWO_TRAINING = new Set(['16', '17', '19', '21', '32'])
  const CONTRACT = new Set(['04', '04.1', '40', '40.1'])

  const people: { id: string; name: string }[] = []
  for (const r of roots)
    for (const f of await list(r))
      if (f.mimeType === FOLDER_MIME && f.id && f.name && !/obsolet|^00\./i.test(f.name))
        people.push({ id: f.id, name: f.name.split(/[-–—_]/)[0].trim() })

  const rows: any[] = []
  let i = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < people.length) {
      const p = people[i++]
      const walk = async (folderId: string, folderPath: string): Promise<void> => {
        for (const f of await list(folderId)) {
          if (!f.id || !f.name) continue
          if (f.mimeType === FOLDER_MIME) {
            if (/obsolet|^00[._ ]/i.test(f.name)) continue
            await walk(f.id, `${folderPath}/${f.name}`)
            continue
          }
          const c = cache.get(f.id)
          // Documentos de fato no PDF. O número WINDA (30) impresso num certificado GWO não é outro documento,
          // e contrato + aditivo que o leitor LLM vê como um documento só também não são para separar.
          let docs: any[] = c?.documents ?? []
          if (docs.some(d => GWO_TRAINING.has(d.code))) docs = docs.filter(d => d.code !== '30')
          const llmKey = c?.md5 || f.id
          const llmDocs = llm.get(llmKey)?.consensus ?? llm.get(llmKey)?.a
          if (docs.length > 1 && llmDocs?.length === 1 && docs.every(d => CONTRACT.has(d.code))) docs = docs.slice(0, 1)
          let doc = docs[0] ?? c
          // Book v1.2: NR-23 Incêndio saiu do 46 (exames) para o 49; o cache ainda pode trazer o 46 antigo.
          let code: string | null = doc?.code === '46' && /NR23-INCENDIO|INCENDIO/i.test(f.name) ? '49' : (doc?.code ?? null)
          // Sem código pelas regras, mas com leitura dos leitores em acordo e curso conhecido: o código sai do
          // curso lido (ex.: "Atendimento pré-hospitalar" -> 27) e as datas, da leitura. Só com acordo A x B.
          const llmEntry0 = llm.get(llmKey)
          const ld = llmEntry0?.agreed ? llmEntry0.consensus?.[0] : undefined
          if (!code && ld?.curso_ou_norma && ld.curso_ou_norma !== 'ausente') {
            const byCourse = CertificateClassifier.classify(ld.curso_ou_norma).code
            const iso10 = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00.000Z` : undefined)
            if (byCourse && BOOK_CODE[byCourse]) {
              code = byCourse
              doc = { code, issueDate: iso10(ld.data_conclusao) ?? iso10(ld.data_assinatura), expirationDate: iso10(ld.validade_declarada) }
            }
          }
          const issues: string[] = []
          const map = code ? BOOK_CODE[code] : undefined
          if (!code) issues.push('Tipo de documento não reconhecido')
          else if (!map) issues.push(OUT_OF_BOOK[code] ?? `Código ${code} fora da tabela do Book`)
          if (c?.statusEHS === 'NAO_LIDO' || doc?.statusEHS === 'NAO_LIDO') issues.push('NC-04: documento sem data legível no conteúdo')
          if (c?.holder?.status === 'OUTRA_PESSOA') issues.push(`NC-05: conteúdo de outra pessoa (${c.holder.other})`)
          const samePage = docs.length > 1 && llmDocs?.length > 1 && new Set(llmDocs.map((d: any) => (d.paginas ?? []).join(','))).size === 1
          if (samePage && docs.every(d => GWO_TRAINING.has(d.code))) issues.push('Certificado GWO combinado: vários módulos na mesma página (não separável)')
          else if (docs.length > 1) issues.push('Book seção 2: mais de um documento no mesmo PDF; separar em arquivos')
          const exp = iso(doc?.expirationDate)
          // CNH e afins só trazem a validade: sem emissão impressa, EMI fica NA em vez de repetir o VAL.
          const emi = iso(doc?.issueDate) && iso(doc?.issueDate) !== exp ? iso(doc?.issueDate) : undefined
          const permanent = code && NO_EXPIRY.has(code)
          const declared = !exp || exp.startsWith('2099') || Number(exp.slice(0, 4)) > 2070 ? undefined : exp
          const months = map ? BOOK_VALIDITY_MONTHS[map.cc] : undefined
          let byBook: string | undefined
          if (emi && months) {
            const d = new Date(`${emi}T12:00:00`)
            d.setMonth(d.getMonth() + months)
            byBook = d.toISOString().slice(0, 10)
          }
          // Book seção 4: VAL pela matriz a partir da EMI; se o documento declarar validade menor, vale a menor.
          let val = permanent ? 'NA' : [byBook, declared].filter(Boolean).sort()[0] ?? 'NA'
          // Arquivo já no padrão do Book: o nome atual é a referência. Data que a leitura não achou fica a do
          // nome (nunca vira NA), documento único sem validade na matriz não ganha VAL, e se a leitura
          // contradiz o nome a decisão é humana, não um renome automático.
          const cur = f.name.match(/^\d\d_[A-Z0-9-]+_EMI-(\d{4}-\d{2}-\d{2}|NA)_VAL-(\d{4}-\d{2}-\d{2}|NA)_/)
          let emiName = emi
          if (cur && map) {
            const curDoc = f.name.match(/^\d\d_([A-Z0-9]+(?:-[A-Z0-9]+)*?)-(?:FORMACAO|RECICLAGEM|ADM|PER|MRO|RT|DEM|UNICO)_/)?.[1]
            if (curDoc && curDoc !== map.doc) issues.push(`Tipo no nome (${curDoc}) difere da leitura (${map.doc})`)
            const [, curEmi, curVal] = cur
            if (!emiName && curEmi !== 'NA') emiName = curEmi
            if (map.kind === 'UNICO' && !months && curVal === 'NA') val = 'NA'
            if (val === 'NA' && curVal !== 'NA' && !permanent) val = curVal
            if ((curEmi !== 'NA' && emiName !== curEmi) || (curVal !== 'NA' && val !== curVal))
              issues.push(`Datas lidas no conteúdo (EMI ${emiName ?? 'NA'}, VAL ${val}) diferem do nome atual no padrão do Book`)
          }
          if (emiName && val !== 'NA' && val < emiName) issues.push(`Validade (${val}) anterior à emissão (${emiName})`)
          // CNH definitiva emitida desde 2021 vale 10 anos (5 a partir dos 50 anos). Vencimento além de hoje + 5 anos
          // só pode ser de uma CNH de 10 anos, então a emissão é o vencimento - 10 anos. PPD (permissão) fica de fora.
          if (code === '08' && !emiName && val !== 'NA' && !/PPD|PERMISS/i.test(f.name)) {
            const lim = new Date(); lim.setFullYear(lim.getFullYear() + 5)
            if (new Date(`${val}T12:00:00`) > lim) { const d = new Date(`${val}T12:00:00`); d.setFullYear(d.getFullYear() - 10); emiName = d.toISOString().slice(0, 10) }
          }
          // CNH: vale o vencimento impresso; sem emissão lida, EMI fica NA.
          const valOnly = code === '08' && val !== 'NA'
          if (map && !emiName && !permanent && !valOnly) issues.push('Sem data de emissão lida no conteúdo')
          let proposed = map
            ? `${map.cc}_${map.doc}-${tipoFor(map.kind, f.name)}_EMI-${emiName ?? 'NA'}_VAL-${val}_${slugName(p.name)}.pdf`
            : null
          let sub = map ? SUBFOLDER[map.kind] : null
          // Documentos sem código no Book (exames, certificações do cliente, treinamentos complementares,
          // documentos pessoais extras): pasta própria, nome com as datas lidas pelo Prometheus.
          if (!code) {
            const llmEntry = llm.get(llmKey)
            const ex = llmEntry?.agreed === false && !llmEntry?.consensus ? null : extraFor(f.name, llmDocs?.[0])
            if (ex) {
              for (const k of ['Tipo de documento não reconhecido', 'NC-04: documento sem data legível no conteúdo'])
                if (issues.includes(k)) issues.splice(issues.indexOf(k), 1)
              proposed = `${ex.slug}_EMI-${ex.emi ?? 'NA'}_VAL-${ex.val}_${slugName(p.name)}.pdf`
              sub = ex.sub
            } else {
              const pessoal = personalFor(f.name, folderPath === p.name, llmDocs?.[0])
              if (pessoal) {
                for (const k of ['Tipo de documento não reconhecido', 'NC-04: documento sem data legível no conteúdo'])
                  if (issues.includes(k)) issues.splice(issues.indexOf(k), 1)
                // Mantém a extensão (foto, imagem); genérico ganha o início do id para não colidir.
                const ext = (path.extname(f.name) || '.pdf').toLowerCase()
                const tag = pessoal === 'DOC-PESSOAL' ? `-${f.id.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, 'X')}` : ''
                proposed = `${pessoal}${tag}_EMI-NA_VAL-NA_${slugName(p.name)}${ext}`
                sub = '01_DOCUMENTOS_PESSOAIS'
              }
            }
          }
          rows.push({
            fileId: f.id,
            person: p.name,
            personFolderId: p.id,
            currentPath: `${folderPath}/${f.name}`,
            currentName: f.name,
            code,
            proposedName: issues.length ? null : proposed,
            draftName: proposed,
            proposedSubfolder: sub,
            unchanged: proposed === f.name,
            multiDoc: docs.length > 1,
            issues,
          })
        }
      }
      await walk(p.id, p.name)
    }
  }))

  rows.sort((a, b) => a.person.localeCompare(b.person) || (a.code ?? '').localeCompare(b.code ?? ''))
  // Book R04: um só documento vigente por código; versões extras viram candidatas a 00_OBSOLETOS.
  const seen = new Map<string, any[]>()
  // Certificado com vários documentos (GWO BST combinado) cobre outros códigos: nunca vira obsoleto por um deles.
  // Sem código no Book (CLIENTE, COMPLEMENTARES, OUTROS) também não vira obsoleto: o agrupamento é só pelo título lido.
  for (const r of rows) if (r.draftName && !r.multiDoc && r.code) {
    const k = `${r.personFolderId}|${r.draftName.split('_')[0]}_${r.draftName.split('_')[1]}`
    seen.set(k, [...(seen.get(k) ?? []), r])
  }
  // A versão com a emissão mais recente fica vigente; as outras são propostas para 00_OBSOLETOS
  // (seção 2: "nunca coexistem duas versões vigentes"), mantendo o nome que têm.
  const emiOf = (r: any) => (r.draftName.match(/_EMI-([0-9-]+|NA)_/)?.[1] ?? '')
  for (const group of seen.values()) if (group.length > 1) {
    group.sort((a, b) => emiOf(b).localeCompare(emiOf(a)))
    for (const r of group.slice(1)) {
      r.action = 'OBSOLETO'
      r.proposedName = null
      r.proposedSubfolder = '00_OBSOLETOS'
      r.supersededBy = group[0].fileId
      r.issues.push(`NC-20: versão mais antiga (a vigente é ${group[0].currentName})`)
    }
  }
  for (const r of rows) r.action ??= r.proposedName && !r.unchanged ? 'RENOMEAR' : r.issues.length ? 'REVISAR' : 'OK'

  fs.writeFileSync(path.join('scratch', 'book_rename_plan.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1))
  const ready = rows.filter(r => r.proposedName && !r.unchanged && !r.issues.length).length
  console.log(`[book-plan] ${people.length} pastas, ${rows.length} arquivos | ${ready} prontos para renomear | ${rows.filter(r => r.issues.length).length} com pendência`)
}

main().catch(e => { console.error(e); process.exit(1) })
