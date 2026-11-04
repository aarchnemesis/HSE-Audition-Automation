import 'dotenv/config'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../src/adapters/drive/googleAuth.js'

async function main() {
  const drive = google.drive({ version: 'v3', auth: await getAuthorizedClient() })
  const SRC2_ROOT = '13GqNi1s8mqzt24JwlIN-bz5tp_U95VX2'
  const res = await drive.files.list({
    q: `'${SRC2_ROOT}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  })
  console.log('Branches in TREINAMENTOS:')
  res.data.files?.sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach(f => {
    console.log(`${f.name} => ${f.id}`)
  })
}

main().catch(console.error)
