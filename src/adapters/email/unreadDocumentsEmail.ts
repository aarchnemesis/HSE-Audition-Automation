export const UNREAD_EMAIL_DEFAULT_TO =
  'mayanna.gomes@arthwind.com.br,massude.afonso@arthwind.com.br'

export interface DocumentIssue {
  collaborator: string
  folderUrl?: string
  code: string
  document: string
  file?: string
  fileUrl?: string
  reason: string
}

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

export function shortReason(detail: string): string {
  const m = detail.match(/NÃO LIDO: (.*?)\. Não existe/)
  return m ? m[1] : detail
}

function groupByCollaborator(items: DocumentIssue[]) {
  const groups = new Map<string, DocumentIssue[]>()
  for (const item of items) {
    const list = groups.get(item.collaborator) ?? []
    list.push(item)
    groups.set(item.collaborator, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function section(title: string, intro: string, items: DocumentIssue[]) {
  if (!items.length) return ''
  const rows = groupByCollaborator(items)
    .map(([collaborator, list]) => {
      const folder = list[0].folderUrl
        ? `<a href="${escape(list[0].folderUrl)}">abrir pasta</a>`
        : ''
      const docs = list
        .map(i => {
          const file = i.fileUrl
            ? `<a href="${escape(i.fileUrl)}">${escape(i.file ?? 'arquivo')}</a>`
            : escape(i.file ?? '')
          return `<tr><td style="padding:4px 8px;">${escape(i.code)} - ${escape(i.document)}</td><td style="padding:4px 8px;">${file}</td><td style="padding:4px 8px;">${escape(shortReason(i.reason))}</td></tr>`
        })
        .join('')
      return `<h3 style="margin:16px 0 4px;">${escape(collaborator)} <span style="font-weight:normal;font-size:12px;">${folder}</span></h3><table style="border-collapse:collapse;font-size:13px;" border="1"><tr><th style="padding:4px 8px;">Documento</th><th style="padding:4px 8px;">Arquivo</th><th style="padding:4px 8px;">Motivo</th></tr>${docs}</table>`
    })
    .join('')
  return `<h2 style="margin-top:24px;">${escape(title)} (${items.length})</h2><p>${escape(intro)}</p>${rows}`
}

export function buildUnreadDocumentsEmail(input: {
  refDate: Date
  unread: DocumentIssue[]
  holderWarnings: DocumentIssue[]
}): { subject: string; html: string } {
  const date = input.refDate.toLocaleDateString('pt-BR')
  const people = new Set(input.unread.map(i => i.collaborator)).size
  const subject = `Documentos sem leitura válida no Drive - ${input.unread.length} documento(s) de ${people} colaborador(es) - ${date}`
  const html = [
    `<p>Relatório automático de ${escape(date)}. Os documentos abaixo estão <strong>BLOQUEADOS</strong> no dashboard porque o arquivo no Drive não pôde ser lido ou não pertence ao colaborador. O nome do arquivo não é aceito como prova.</p>`,
    '<p>Ação: salvar na pasta do colaborador o PDF legível e correto de cada documento. O bloqueio sai automaticamente na próxima leitura.</p>',
    section(
      'Documentos NÃO LIDOS (bloqueiam)',
      'Arquivo ilegível, sem data impressa, corrompido, que não é PDF, ou de outra pessoa.',
      input.unread
    ),
    section(
      'Conferir titular (alerta)',
      'O nome do colaborador não foi encontrado no documento. Confirme se o arquivo é dele.',
      input.holderWarnings
    ),
  ].join('')
  return { subject, html }
}
