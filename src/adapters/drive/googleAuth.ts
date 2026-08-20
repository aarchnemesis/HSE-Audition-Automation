import fs from 'fs';
import path from 'path';
import http from 'http';
import { google } from 'googleapis';
import type { OAuth2Client } from 'googleapis-common';

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

interface OAuthClientCredentials {
  client_id: string;
  client_secret: string;
  redirect_uris: string[];
}

function loadClientCredentials(credentialsPath: string): OAuthClientCredentials {
  if (!fs.existsSync(credentialsPath)) {
    throw new Error(
      `Credenciais OAuth não encontradas em ${credentialsPath}. ` +
      `Baixe o JSON do Client ID (tipo "Desktop app") no Google Cloud Console e salve nesse caminho, ` +
      `ou configure GOOGLE_OAUTH_CREDENTIALS_PATH apontando para o arquivo.`
    );
  }
  const raw = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
  const creds = raw.installed || raw.web;
  if (!creds) {
    throw new Error(`Formato inesperado em ${credentialsPath}: esperado campo "installed" (Desktop app) ou "web".`);
  }
  return creds;
}

/**
 * Retorna um OAuth2Client autorizado.
 *
 * Modo CI (sem terminal interativo): se GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 * e GOOGLE_OAUTH_REFRESH_TOKEN estiverem definidos, monta o client direto a partir deles —
 * não toca em disco, não abre navegador. É o modo usado pelo GitHub Actions.
 *
 * Modo local (interativo): reaproveita o token salvo em scratch/google_oauth_token.json quando
 * existir; na primeira execução, abre o fluxo de consentimento via servidor HTTP local (loopback)
 * e persiste o refresh token para as próximas execuções não pedirem login de novo.
 */
export async function getAuthorizedClient(options?: {
  credentialsPath?: string;
  tokenPath?: string;
}): Promise<OAuth2Client> {
  const envClient = getClientFromEnv();
  if (envClient) return envClient;

  const credentialsPath = options?.credentialsPath
    || process.env.GOOGLE_OAUTH_CREDENTIALS_PATH
    || path.join(process.cwd(), 'scratch', 'google_oauth_client.json');
  const tokenPath = options?.tokenPath
    || process.env.GOOGLE_OAUTH_TOKEN_PATH
    || path.join(process.cwd(), 'scratch', 'google_oauth_token.json');

  const { client_id, client_secret } = loadClientCredentials(credentialsPath);

  const redirectPort = 53682;
  const redirectUri = `http://localhost:${redirectPort}/oauth2callback`;
  const client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  if (fs.existsSync(tokenPath)) {
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
    client.setCredentials(token);
    return client;
  }

  const code = await promptForAuthorizationCode(client, redirectPort);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const dir = path.dirname(tokenPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), 'utf-8');
  console.log(`[googleAuth] Token salvo em: ${tokenPath} (as próximas execuções não vão pedir login).`);

  return client;
}

function getClientFromEnv(): OAuth2Client | null {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GOOGLE_OAUTH_REFRESH_TOKEN) return null;

  const client = new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET);
  client.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });
  console.log('[googleAuth] Usando credenciais OAuth via variáveis de ambiente (modo CI).');
  return client;
}

function promptForAuthorizationCode(client: OAuth2Client, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES
    });

    console.log('\n================================================================================');
    console.log('  AUTORIZAÇÃO GOOGLE DRIVE NECESSÁRIA');
    console.log('  Abra esta URL no navegador e faça login com a conta que tem acesso à pasta:\n');
    console.log(`  ${authUrl}\n`);
    console.log('================================================================================\n');

    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith('/oauth2callback')) {
        res.writeHead(404);
        res.end();
        return;
      }
      const url = new URL(req.url, `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(error
        ? `<h2>Falha na autorização: ${error}. Pode fechar esta aba.</h2>`
        : '<h2>Autorização concluída! Pode fechar esta aba e voltar ao terminal.</h2>');

      server.close();

      if (error || !code) {
        reject(new Error(`Autorização OAuth falhou: ${error || 'código ausente'}`));
      } else {
        resolve(code);
      }
    });

    server.listen(port);
  });
}
