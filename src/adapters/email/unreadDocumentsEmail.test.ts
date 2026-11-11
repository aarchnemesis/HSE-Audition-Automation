import { describe, expect, it } from 'vitest'
import {
  buildUnreadDocumentsEmail,
  shortReason,
} from './unreadDocumentsEmail.js'

const item = (collaborator: string, code: string) => ({
  collaborator,
  folderUrl: 'https://drive.google.com/drive/folders/f',
  code,
  document: 'ASO',
  file: '01 - ASO - <x>.pdf',
  fileUrl: 'https://drive.google.com/file/d/a/view',
  reason:
    'BLOQUEADO — NÃO LIDO: o PDF não tem texto legível (nem após OCR). Não existe nenhuma referência válida.',
})

describe('buildUnreadDocumentsEmail', () => {
  it('groups by collaborator and counts documents and people', () => {
    const { subject, html } = buildUnreadDocumentsEmail({
      refDate: new Date(2026, 10, 11),
      unread: [item('BETA', '01'), item('ALFA', '01'), item('ALFA', '21')],
      holderWarnings: [],
    })
    expect(subject).toContain('3 documento(s) de 2 colaborador(es)')
    expect(html.indexOf('ALFA')).toBeLessThan(html.indexOf('BETA'))
    expect(html).not.toContain('Conferir titular')
  })

  it('escapes file names and shows the short reason', () => {
    const { html } = buildUnreadDocumentsEmail({
      refDate: new Date(2026, 10, 11),
      unread: [item('ALFA', '01')],
      holderWarnings: [item('ALFA', '21')],
    })
    expect(html).toContain('&lt;x&gt;')
    expect(html).toContain('o PDF não tem texto legível (nem após OCR)')
    expect(html).toContain('Conferir titular (alerta) (1)')
  })
})

describe('shortReason', () => {
  it('returns the original text when it has no NAO_LIDO prefix', () => {
    expect(shortReason('nome não encontrado')).toBe('nome não encontrado')
  })
})
