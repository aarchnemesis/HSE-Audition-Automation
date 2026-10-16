import 'dotenv/config'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { google } from 'googleapis'

async function main() {
  console.log('\n================================================================================')
  console.log('  SINCRONIZAÇÃO DE AUTORIZAÇÃO GOOGLE DRIVE (LEITURA E ESCRITA)')
  console.log('================================================================================\n')

  const forceReauth = process.argv.includes('--force')
  const client = await getAuthorizedClient({ forceReauth })
  const drive = google.drive({ version: 'v3', auth: client })

  const about = await drive.about.get({ fields: 'user, storageQuota' })
  const user = about.data.user

  console.log('\n[GoogleDriveAuth] Autorização concluída e validada com sucesso!')
  console.log(`[GoogleDriveAuth] Usuário conectado: ${user?.displayName} (${user?.emailAddress})`)
  console.log('[GoogleDriveAuth] Permissões: Leitura, Escrita, Renomeação e Criação de Arquivos.')
}

main().catch(err => {
  console.error('\n[GoogleDriveAuth] Erro na autenticação:', err?.message || err)
  process.exit(1)
})
