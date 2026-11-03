import 'dotenv/config'
import { PortalMcpServer } from '../mcp/PortalMcpServer.js'

async function main() {
  const server = new PortalMcpServer()
  await server.startStdio()
}

main().catch(err => {
  console.error('[PortalMcp] Erro fatal no servidor MCP:', err)
  process.exit(1)
})
