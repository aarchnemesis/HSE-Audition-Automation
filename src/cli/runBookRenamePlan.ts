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

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Código atual do Drive -> código e sigla do Book (seção 3). As cartas mudam de número (41-44). */
const BOOK_CODE: Record<string, { cc: string; doc: string; kind: 'TREINO' | 'ASO' | 'UNICO' }> = {
  '01': { cc: '01', doc: 'ASO', kind: 'ASO' },
  '02': { cc: '02', doc: 'OS-SST', kind: 'UNICO' },
  '03': { cc: '03', doc: 'FICHA-REGISTRO', kind: 'UNICO' },
  '04': { cc: '04', doc: 'CONTRATO-CTPS', kind: 'UNICO' },
  '04.1': { cc: '04', doc: 'CONTRATO-ADITIVO', kind: 'UNICO' },
  '40': { cc: '04', doc: 'CONTRATO', kind: 'UNICO' },
  '40.1': { cc: '04', doc: 'CONTRATO-ADITIVO', kind: 'UNICO' },
  '05': { cc: '05', doc: 'VACINA', kind: 'UNICO' },
  '06': { cc: '06', doc: 'FICHA-EPI', kind: 'UNICO' },
  '07': { cc: '07', doc: 'SEGURO-VIDA', kind: 'UNICO' },
  '08': { cc: '08', doc: 'CNH', kind: 'UNICO' },
  '09': { cc: '09', doc: 'DIRECAO-DEFENSIVA', kind: 'TREINO' },
  '10': { cc: '10', doc: 'NR01', kind: 'TREINO' },
  '11': { cc: '11', doc: 'NR06', kind: 'TREINO' },
  '12': { cc: '12', doc: 'NR10', kind: 'TREINO' },
  '13': { cc: '13', doc: 'NR10-SEP', kind: 'TREINO' },
  '14': { cc: '14', doc: 'NR11', kind: 'TREINO' },
  '15': { cc: '15', doc: 'NR12', kind: 'TREINO' },
  '16': { cc: '16', doc: 'GWO-FA', kind: 'TREINO' },
  '17': { cc: '17', doc: 'GWO-MH', kind: 'TREINO' },
  '18': { cc: '18', doc: 'NR18', kind: 'TREINO' },
  '19': { cc: '19', doc: 'GWO-FAW', kind: 'TREINO' },
  '20': { cc: '20', doc: 'NR33', kind: 'TREINO' },
  '28': { cc: '28', doc: 'NR33-SUPERVISOR', kind: 'TREINO' },
  '21': { cc: '21', doc: 'NR35', kind: 'TREINO' },
  '22': { cc: '22', doc: 'LOTO', kind: 'TREINO' },
  '25': { cc: '25', doc: 'SIT', kind: 'TREINO' },
  '26': { cc: '26', doc: 'ESO', kind: 'TREINO' },
  '30': { cc: '30', doc: 'WINDA', kind: 'UNICO' },
  '32': { cc: '32', doc: 'GWO-ART', kind: 'TREINO' },
  '12.1': { cc: '41', doc: 'CARTA-NR10', kind: 'UNICO' },
  '15.1': { cc: '42', doc: 'CARTA-NR12', kind: 'UNICO' },
  '20.1': { cc: '43', doc: 'CARTA-NR33', kind: 'UNICO' },
  '21.1': { cc: '44', doc: 'CARTA-NR35', kind: 'UNICO' },
}
/** Códigos do Drive que o Book não prevê (ou que mudaram de sentido): ficam para decisão humana. */
const OUT_OF_BOOK: Record<string, string> = {
  '23': 'No Drive o 23 é CRT/Declaração de Classe; no Book o 23 é GWO BST Trabalho em Altura (WAH)',
  '24': 'Diploma técnico: o Book cita na tabela de validade, mas não dá código na seção 3',
  '27': 'NR-07 Primeiros Socorros não está na tabela do Book',
  '29': 'ATW Integração não está na tabela do Book',
  '31': 'Elevador (JASO) não está na tabela do Book',
  '34': 'CIPA não está na tabela do Book',
}
const SUBFOLDER: Record<string, string> = { ASO: '02_SAUDE_OCUPACIONAL', TREINO: '03_TREINAMENTOS', UNICO: '01_DOCUMENTOS_PESSOAIS' }
const NO_EXPIRY = new Set(['02', '03', '04', '05', '24', '40', '40.1', '04.1'])
/** Book seção 4 (validade a partir da EMI). Os que dependem de apólice, CNH, CA ou cliente usam a data declarada. */
const BOOK_VALIDITY_MONTHS: Record<string, number> = {
  '01': 12, '10': 12, '11': 12, '12': 24, '13': 24, '14': 12, '15': 12, '18': 12, '20': 12, '28': 12,
  '21': 24, '22': 12, '16': 24, '17': 24, '19': 24, '23': 24, '32': 24, '09': 24, '45': 6,
  '41': 12, '42': 12, '43': 12, '44': 12,
}

const iso = (d?: string) => (d ? d.slice(0, 10) : undefined)
const slugName = (n: string) =>
  n.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]+/g, '-').replace(/^-|-$/g, '')

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
          const doc = c?.documents?.[0] ?? c
          const code: string | null = doc?.code ?? null
          const issues: string[] = []
          const map = code ? BOOK_CODE[code] : undefined
          if (!code) issues.push('Tipo de documento não reconhecido')
          else if (!map) issues.push(OUT_OF_BOOK[code] ?? `Código ${code} fora da tabela do Book`)
          if (c?.statusEHS === 'NAO_LIDO' || doc?.statusEHS === 'NAO_LIDO') issues.push('NC-04: documento sem data legível no conteúdo')
          if (c?.holder?.status === 'OUTRA_PESSOA') issues.push(`NC-05: conteúdo de outra pessoa (${c.holder.other})`)
          if ((c?.documents?.length ?? 0) > 1) issues.push('Book seção 2: mais de um documento no mesmo PDF; separar em arquivos')
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
          const val = permanent ? 'NA' : [byBook, declared].filter(Boolean).sort()[0] ?? 'NA'
          if (map && !emi && !permanent) issues.push('Sem data de emissão lida no conteúdo')
          const proposed = map
            ? `${map.cc}_${map.doc}-${tipoFor(map.kind, f.name)}_EMI-${emi ?? 'NA'}_VAL-${val}_${slugName(p.name)}.pdf`
            : null
          rows.push({
            fileId: f.id,
            person: p.name,
            personFolderId: p.id,
            currentPath: `${folderPath}/${f.name}`,
            currentName: f.name,
            code,
            proposedName: issues.length ? null : proposed,
            draftName: proposed,
            proposedSubfolder: map ? SUBFOLDER[map.kind] : null,
            unchanged: proposed === f.name,
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
  for (const r of rows) if (r.draftName) {
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
      r.issues.push(`NC-20: versão mais antiga (a vigente é ${group[0].currentName})`)
    }
  }
  for (const r of rows) r.action ??= r.proposedName && !r.unchanged ? 'RENOMEAR' : r.issues.length ? 'REVISAR' : 'OK'

  fs.writeFileSync(path.join('scratch', 'book_rename_plan.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 1))
  const ready = rows.filter(r => r.proposedName && !r.unchanged && !r.issues.length).length
  console.log(`[book-plan] ${people.length} pastas, ${rows.length} arquivos | ${ready} prontos para renomear | ${rows.filter(r => r.issues.length).length} com pendência`)
}

main().catch(e => { console.error(e); process.exit(1) })
