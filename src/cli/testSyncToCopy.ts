import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import ExcelJS from 'exceljs'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { runSync } from './syncSmartsheetToGoogleBase.js'

const ORIGINAL_FILE_ID = process.env.MASSUDE_SHEET_DRIVE_ID || '1T4-m4FEqd1U3P_2Wgz1mtfpPME2BrJra'
const TEST_FILE_NAME = 'TESTE_Controle_Homologacao_Clientes_v36.xlsx'

async function main() {
  console.log('================================================================================')
  console.log('   TESTE DE SINCRONIZAÇÃO EM PLANILHA COPIA (VAZIA)')
  console.log('================================================================================\n')

  const auth = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth })

  // 1. Verificar se já existe uma cópia de teste ou criar nova
  console.log('[Teste] Verificando se já existe planilha de teste no Google Drive...')
  const listRes = await drive.files.list({
    q: `name = '${TEST_FILE_NAME}' and trashed = false`,
    fields: 'files(id, name, webViewLink)'
  })

  let testFileId: string

  if (listRes.data.files && listRes.data.files.length > 0) {
    testFileId = listRes.data.files[0].id!
    console.log(`[Teste] Usando arquivo de teste existente: ${testFileId}`)
  } else {
    console.log(`[Teste] Criando cópia da planilha original (${ORIGINAL_FILE_ID})...`)
    const copyRes = await drive.files.copy({
      fileId: ORIGINAL_FILE_ID,
      requestBody: {
        name: TEST_FILE_NAME
      }
    })
    testFileId = copyRes.data.id!
    console.log(`[Teste] Cópia criada com sucesso! ID: ${testFileId}`)
  }

  // 2. Baixar a cópia e limpar as linhas preenchidas da aba BASE (linhas 4 a 993)
  // para deixá-la vazia apenas com os cabeçalhos (linhas 1 a 3)
  console.log('[Teste] Baixando a planilha de teste para esvaziar os dados da aba BASE...')
  const downloadRes = await drive.files.get(
    { fileId: testFileId, alt: 'media' },
    { responseType: 'arraybuffer' }
  )
  const buffer = Buffer.from(downloadRes.data as ArrayBuffer)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const baseSheet = workbook.getWorksheet('BASE')
  if (!baseSheet) {
    throw new Error('Aba BASE não encontrada na planilha de teste.')
  }

  console.log(`[Teste] Limpando dados existentes na aba BASE da planilha de teste...`)
  for (let r = 4; r <= baseSheet.rowCount; r++) {
    const row = baseSheet.getRow(r)
    for (let c = 1; c <= 25; c++) {
      row.getCell(c).value = null
    }
    row.commit()
  }

  const tmpCleanPath = path.resolve(process.cwd(), 'scratch', 'teste_base_limpa.xlsx')
  await workbook.xlsx.writeFile(tmpCleanPath)

  console.log('[Teste] Atualizando a planilha de teste no Google Drive com a aba BASE limpa...')
  await drive.files.update({
    fileId: testFileId,
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: fs.createReadStream(tmpCleanPath)
    }
  })

  // 3. Executar o sync apontando para o arquivo de teste
  console.log(`\n[Teste] Executando sincronização real (--apply) no arquivo de teste (${testFileId})...`)
  const result = await runSync({ dryRun: false, targetFileId: testFileId })

  console.log('\n================================================================================')
  console.log('   TESTE CONCLUÍDO COM SUCESSO!')
  console.log(`   - Linhas inseridas: ${result.insertedCount}`)
  console.log(`   - Link da Planilha de Teste: https://docs.google.com/spreadsheets/d/${testFileId}/edit`)
  console.log('================================================================================\n')
}

main().catch(err => {
  console.error('[Teste] Erro durante o teste:', err)
  process.exit(1)
})
