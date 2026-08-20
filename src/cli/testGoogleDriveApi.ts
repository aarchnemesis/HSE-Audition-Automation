import 'dotenv/config';
import { GoogleDriveOAuthAdapter } from '../adapters/drive/GoogleDriveOAuthAdapter.js';

const FOLDER_ID = process.env.HSE_DRIVE_FOLDER_ID || '1ftfSSauhVuaCKimKCKUI1bstr1ALZShq';

async function main() {
  console.log(`[testGoogleDriveApi] Lendo pasta raiz: ${FOLDER_ID}`);
  const adapter = new GoogleDriveOAuthAdapter(FOLDER_ID);
  const inspectors = await adapter.getInspectors();

  console.log(`\nInspetores encontrados: ${inspectors.length}`);
  for (const inspector of inspectors) {
    console.log(`\n👤 ${inspector.name} (${inspector.role}) — ${inspector.certificates.size} certificado(s)`);
    for (const cert of inspector.certificates.values()) {
      console.log(`   ${cert.code} | ${cert.filename} | ${cert.statusEHS} | ${cert.statusDetail}`);
    }
  }
}

main().catch((err) => {
  console.error('Erro no teste da Google Drive API:', err);
  process.exit(1);
});
