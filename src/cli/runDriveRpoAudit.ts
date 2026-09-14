import 'dotenv/config'
import path from 'path'
import { DummyEmailService } from '../adapters/email/DummyEmailService.js'
import { SmtpEmailService } from '../adapters/email/SmtpEmailService.js'
import { DriveRpoComparisonItem } from '../domain/services/DriveRpoAuditor.js'
import { HSEDataPipeline } from '../domain/services/HSEDataPipeline.js'
import { IEmailService } from '../ports/IEmailService.js'

const refDateArg = process.argv
  .find(a => a.startsWith('--ref-date='))
  ?.split('=')[1]
const REF_DATE = refDateArg
  ? new Date(refDateArg)
  : process.env.HSE_REF_DATE
    ? new Date(process.env.HSE_REF_DATE)
    : new Date()

const DEFAULT_HSE_EMAIL_RECIPIENTS =
  'massude.afonso@arthwind.com.br,marcelo.freitas@arthwind.com.br,darliane.caetano@arthwind.com.br,joao.oliveira@arthwind.com.br'
const EMAIL_RECIPIENT = process.env.HSE_EMAIL_TO || DEFAULT_HSE_EMAIL_RECIPIENTS
const SKIP_EMAIL =
  process.argv.includes('--no-email') || process.env.SKIP_EMAIL === 'true'
const FORCE_SYNC =
  process.argv.includes('--force-sync') || process.argv.includes('--sync')

function buildDivergenceSummaryHtml(
  divergences: DriveRpoComparisonItem[],
  refDate: Date
): string {
  const dateFmt = (d?: Date | string) => {
    if (!d) return '—'
    const dateObj = d instanceof Date ? d : new Date(d)
    return Number.isNaN(dateObj.getTime())
      ? '—'
      : dateObj.toLocaleDateString('pt-BR')
  }

  const kindLabel: Record<string, string> = {
    SOMENTE_DRIVE: 'Só existe no Drive',
    SOMENTE_STORZ: 'Só existe na Storz',
    SOMENTE_RPO: 'Só existe na RPO',
    DATA_DIVERGENTE: 'Data divergente',
    DRIVE_SEM_DATA: 'Drive sem data válida',
  }

  const rows = divergences
    .slice(0, 200)
    .map(
      d => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${d.inspectorName}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${d.docName}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${kindLabel[d.divergenceKind || ''] || d.divergenceKind}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${dateFmt(d.driveExpiration)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${dateFmt(d.storzExpiration)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;">${dateFmt(d.rpoExpiration)}</td>
      </tr>`
    )
    .join('')

  return `
    <p>Auditoria semanal Drive + Storz (fontes confiáveis) x RPO (digitada à mão) — data de referência ${refDate.toLocaleDateString('pt-BR')}.</p>
    <p><strong>${divergences.length}</strong> divergência(s) encontrada(s). O relatório completo em Excel está disponível como anexo desta mensagem.</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="background:#f1f5f9;text-align:left;">
          <th style="padding:6px 10px;">Colaborador</th>
          <th style="padding:6px 10px;">Documento</th>
          <th style="padding:6px 10px;">Tipo</th>
          <th style="padding:6px 10px;">Drive</th>
          <th style="padding:6px 10px;">Storz (estimado)</th>
          <th style="padding:6px 10px;">RPO</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${divergences.length > 200 ? `<p><em>Mostrando as primeiras 200 de ${divergences.length} — ver o Excel anexo para a lista completa.</em></p>` : ''}
  `
}

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   HSE AUDIT AUTOMATION - AUDITORIA DRIVE x RPO (FONTE ÚNICA DA VERDADE - SSOT)'
  )
  console.log(`   Data de Referência: ${REF_DATE.toLocaleDateString('pt-BR')}`)
  console.log(
    '================================================================================\n'
  )

  const pipeline = new HSEDataPipeline()
  const syncResult = await pipeline.getOrSync({
    refDate: REF_DATE,
    preferSnapshot: !FORCE_SYNC,
  })

  const divergences = syncResult.rpoDivergences.filter(i => i.divergent)
  console.log(
    `[DriveRpoAudit] ${syncResult.rpoDivergences.length} combinação(ões) analisadas, ${divergences.length} divergência(s) encontrada(s).`
  )

  const byKind: Record<string, number> = {}
  for (const d of divergences) {
    if (d.divergenceKind) {
      byKind[d.divergenceKind] = (byKind[d.divergenceKind] || 0) + 1
    }
  }
  console.log('\n   Divergências por tipo:')
  for (const [kind, count] of Object.entries(byKind)) {
    console.log(`   - ${kind}: ${count}`)
  }

  const outputPath = path.join(
    process.cwd(),
    'scratch',
    'auditoria_drive_rpo.xlsx'
  )
  await HSEDataPipeline.exportDivergencesToExcel(
    syncResult.rpoDivergences,
    outputPath
  )
  console.log(`\n[DriveRpoAudit] Relatório Excel gerado em: ${outputPath}`)
  console.log(
    '   (Base consolidada SSOT — garantia de 100% de paridade com o Dashboard)\n'
  )

  if (SKIP_EMAIL) {
    console.log(
      '================================================================================'
    )
    console.log('   PULANDO ENVIO DE E-MAIL (--no-email ou SKIP_EMAIL=true)')
    console.log(
      '================================================================================\n'
    )
    return
  }

  console.log(
    '================================================================================'
  )
  console.log('   ENVIANDO RESUMO DA AUDITORIA DRIVE+STORZ x RPO')
  console.log(
    '================================================================================'
  )
  const emailService: IEmailService =
    SmtpEmailService.fromEnv() || new DummyEmailService()
  const emailRes = await emailService.sendEmail({
    to: EMAIL_RECIPIENT,
    subject: `Auditoria RPO — ${divergences.length} divergência(s) de digitação encontrada(s)`,
    htmlContent: buildDivergenceSummaryHtml(divergences, REF_DATE),
    attachments: [{ filename: 'auditoria_drive_rpo.xlsx', path: outputPath }],
  })
  console.log(
    `   Resumo ${emailRes.success ? 'enviado' : 'falhou'} para ${EMAIL_RECIPIENT}\n`
  )
}

main().catch(err => {
  console.error('[DriveRpoAudit] Erro fatal na auditoria Drive x RPO:', err)
  process.exit(1)
})
