import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'

const TEST_FILE_ID = '1TRnxZ7wNrQ7yrIA7rdRkpdAWJvWVZMZm'

function norm(s: any): string {
  if (!s) return ''
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

interface WorkerDoc {
  title: string
  status?: string
  required?: boolean
  expiresOn?: string
}

interface PortalWorker {
  name: string
  role?: string
  contract?: string
  documents?: WorkerDoc[]
}

function checkCompliance(worker: PortalWorker | undefined) {
  if (!worker || !worker.documents || worker.documents.length === 0) {
    return { isFound: Boolean(worker), isFullyApproved: false, approved: 0, pending: 0, rejected: 0, total: 0, pendencies: [] }
  }
  let approved = 0, pending = 0, rejected = 0
  const pendencies: string[] = []

  worker.documents.forEach(d => {
    const st = (d.status || '').toUpperCase()
    if (st === 'APPROVED' || st === 'APROVADO' || st === 'VALID' || st === 'A') {
      approved++
    } else if (st === 'REJECTED' || st === 'REPROVADO' || st === 'R') {
      rejected++
      pendencies.push(`${d.title} (Reprovado)`)
    } else {
      pending++
      pendencies.push(`${d.title} (${d.status || 'Pendente'})`)
    }
  })

  const total = worker.documents.length
  const isFullyApproved = approved === total && total > 0
  return { isFound: true, isFullyApproved, approved, pending, rejected, total, pendencies }
}

function matchWorker(name: string, list: PortalWorker[]): PortalWorker | undefined {
  const n = norm(name)
  if (!n) return undefined
  return list.find(w => {
    const wn = norm(w.name)
    return wn === n || wn.includes(n) || n.includes(wn)
  })
}

async function main() {
  console.log('================================================================================')
  console.log('   CRUZAMENTO DE PORTAIS COM A PLANILHA CÓPIA (TESTE)')
  console.log('   Arquivo Alvo:', TEST_FILE_ID)
  console.log('================================================================================\n')

  // 1. Carregar censos dos portais
  const tdoc: PortalWorker[] = JSON.parse(fs.readFileSync('data/portais/tdoc-sgre.census.json', 'utf-8')).workers || []
  const vestas: PortalWorker[] = JSON.parse(fs.readFileSync('data/portais/egestiona-vestaslatam.census.json', 'utf-8')).workers || []
  const goldwind: PortalWorker[] = JSON.parse(fs.readFileSync('data/portais/veriduss-goldwind.census.json', 'utf-8')).workers || []
  const surisoft: PortalWorker[] = JSON.parse(fs.readFileSync('data/portais/surisoft.census.json', 'utf-8')).workers || []
  const metacontratas: PortalWorker[] = fs.existsSync('data/portais/metacontratas.census.json')
    ? JSON.parse(fs.readFileSync('data/portais/metacontratas.census.json', 'utf-8')).workers || []
    : []

  console.log(`[Censos Carregados] SGRE/T-Doc: ${tdoc.length} | Vestas/eGestiona: ${vestas.length} | Goldwind/Veriduss: ${goldwind.length} | GE/Surisoft: ${surisoft.length} | Metacontratas: ${metacontratas.length}`)

  // 2. Carregar a planilha de teste
  const auth = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth })

  console.log(`[Google Drive] Baixando planilha de teste (${TEST_FILE_ID})...`)
  const localPath = path.resolve(process.cwd(), 'scratch/Controle_Homologacao_Temp.xlsx')
  const downloadRes = await drive.files.get(
    { fileId: TEST_FILE_ID, alt: 'media' },
    { responseType: 'arraybuffer' }
  )
  fs.writeFileSync(localPath, Buffer.from(downloadRes.data as ArrayBuffer))

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(localPath)
  const ws = workbook.getWorksheet('BASE')
  if (!ws) throw new Error('Aba BASE não encontrada')

  let updatedCount = 0
  let liberadosCount = 0
  let pendentesCount = 0
  let naoCadastradosCount = 0
  const today = new Date()

  const summaryByClient: Record<string, { total: number; liberados: number; pendentes: number; naoCadastrados: number; parques: Set<string> }> = {}

  for (let r = 4; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cliente = row.getCell(1).text?.trim()
    const parque = row.getCell(2).text?.trim()
    const colaborador = row.getCell(3).text?.trim()
    if (!colaborador) continue

    if (!summaryByClient[cliente]) {
      summaryByClient[cliente] = { total: 0, liberados: 0, pendentes: 0, naoCadastrados: 0, parques: new Set() }
    }
    summaryByClient[cliente].total++
    if (parque) summaryByClient[cliente].parques.add(parque)

    let portalList: PortalWorker[] | null = null
    const cliUpper = cliente.toUpperCase()

    if (cliUpper.includes('SGRE') || cliUpper.includes('GAMESA')) {
      portalList = tdoc
    } else if (cliUpper.includes('VESTAS')) {
      portalList = vestas
    } else if (cliUpper.includes('GOLDWIND')) {
      portalList = goldwind
    } else if (cliUpper.includes('GE') || cliUpper.includes('SERENA')) {
      portalList = surisoft
    } else if (
      cliUpper.includes('IBITU') ||
      cliUpper.includes('ENERGIMP') ||
      cliUpper.includes('REPSOL') ||
      cliUpper.includes('CPFL')
    ) {
      portalList = metacontratas
    }

    const currentObs = row.getCell(17).text?.trim() || ''

    if (portalList) {
      const matched = matchWorker(colaborador, portalList)
      const comp = checkCompliance(matched)

      if (comp.isFound && comp.isFullyApproved) {
        row.getCell(5).value = 'Liberado'
        row.getCell(8).value = today // Data de Liberação (Coluna H)
        row.getCell(17).value = `${currentObs} | Portal: Liberado 100% (${comp.approved}/${comp.total} docs)`.trim()
        liberadosCount++
        summaryByClient[cliente].liberados++
      } else if (comp.isFound) {
        row.getCell(5).value = 'Em análise'
        const pendStr = comp.pendencies.slice(0, 2).join('; ')
        row.getCell(17).value = `${currentObs} | Portal: ${comp.pending + comp.rejected} pendência(s) (${pendStr})`.trim()
        pendentesCount++
        summaryByClient[cliente].pendentes++
      } else {
        row.getCell(5).value = 'Pendente'
        row.getCell(17).value = `${currentObs} | Portal: Não cadastrado no portal`.trim()
        naoCadastradosCount++
        summaryByClient[cliente].naoCadastrados++
      }
      row.commit()
      updatedCount++
    }
  }

  // 3. Salvar localmente
  await workbook.xlsx.writeFile(localPath)
  console.log(`[Planilha] Salva localmente com ${updatedCount} linhas atualizadas.`)

  // 4. Subir no Google Drive (Planilha de Teste)
  console.log(`[Google Drive] Enviando planilha atualizada para o Google Drive (${TEST_FILE_ID})...`)
  await drive.files.update({
    fileId: TEST_FILE_ID,
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(localPath)
    }
  })
  console.log(`[Google Drive] Planilha de teste atualizada com sucesso no Drive!`)

  // 5. Exibir Diagnóstico
  console.log('\n================================================================================')
  console.log('   RESUMO DO TESTE DE CRUZAMENTO COM PORTAIS')
  console.log('================================================================================')
  console.log(`Total de alocações analisadas com portais: ${updatedCount}`)
  console.log(`  - Liberados (100% conforme no portal): ${liberadosCount}`)
  console.log(`  - Em análise / Com pendência:          ${pendentesCount}`)
  console.log(`  - Não cadastrados no portal:           ${naoCadastradosCount}`)
  console.log('--------------------------------------------------------------------------------')

  Object.entries(summaryByClient).forEach(([cli, stats]) => {
    console.log(`Cliente: ${cli} (${stats.parques.size} parque(s), ${stats.total} alocações)`)
    console.log(`  ✓ Liberados: ${stats.liberados} | ⏳ Pendentes/Análise: ${stats.pendentes} | ❌ Não cadastrados: ${stats.naoCadastrados}`)
  })
  console.log('================================================================================')
  console.log(`Link: https://docs.google.com/spreadsheets/d/${TEST_FILE_ID}/edit\n`)
}

main().catch(err => {
  console.error('[Erro Fatal]:', err)
  process.exit(1)
})
