import { describe, expect, it } from 'vitest'
import { consensusOf } from '../../adapters/llm/PrometheusReader.js'
import { codeForLlmDocument, mapLlmDocument } from './LlmReadingMapper.js'

const REF = new Date('2026-11-12T12:00:00-03:00')
const doc = (o: any) => ({ tipo_documento: 'certificado_treinamento', modalidade: 'FORMACAO', titular_nome: 'Adenio Francisco de Sousa', data_inicio: 'ausente', data_conclusao: 'ausente', data_assinatura: 'ausente', prazo_contrato: 'ausente', ...o })

describe('leitura Prometheus (gold set)', () => {
  it('separa NR-10 Básico de NR-10 SEP pelo conteúdo', () => {
    expect(codeForLlmDocument(doc({ curso_ou_norma: 'NR10 - Curso Básico - Segurança em Instalações e Serviços com Eletricidade (Iniciação)' }))).toBe('12')
    expect(codeForLlmDocument(doc({ curso_ou_norma: 'NR-10 Curso complementar - Segurança no Sistema Elétrico de Potência (SEP)' }))).toBe('13')
  })
  it('separa NR-33 Vigia de Supervisor', () => {
    expect(codeForLlmDocument(doc({ curso_ou_norma: 'NR-33 Trabalhador e Vigia (Periódico)' }))).toBe('20')
    expect(codeForLlmDocument(doc({ curso_ou_norma: 'NR-33 Segurança e Saúde nos Trabalhos em Espaços Confinados (Supervisor de Entrada)' }))).toBe('28')
  })
  it('contrato CLT indeterminado ou de experiência não vence', () => {
    const r = mapLlmDocument(doc({ tipo_documento: 'contrato', curso_ou_norma: 'ausente', prazo_contrato: 'experiencia 45 dias', data_inicio: '2025-02-24' }), REF, 't')
    expect(r?.statusEHS).toBe('CONFORME')
  })
  it('usa a data do curso, não a da assinatura', () => {
    const r = mapLlmDocument(doc({ curso_ou_norma: 'GWO Fire Awareness', data_inicio: '2026-01-08', data_conclusao: '2026-01-08', data_assinatura: '2026-11-10' }), REF, 't')
    expect(r?.issueDate?.toISOString().slice(0, 10)).toBe('2026-01-08')
  })
  it('só há consenso quando A e B leem o mesmo documento e o mesmo titular', () => {
    const a = [doc({ curso_ou_norma: 'NR-10 Básico', data_conclusao: '2026-10-27' })]
    expect(consensusOf(a, [doc({ curso_ou_norma: 'NR10 Curso Básico', data_conclusao: '2026-10-27' })]).agreed).toBe(true)
    expect(consensusOf(a, [doc({ curso_ou_norma: 'NR-10 Básico', data_conclusao: '2026-10-28' })]).agreed).toBe(false)
    expect(consensusOf(a, [doc({ curso_ou_norma: 'NR-10 Básico', data_conclusao: '2026-10-27', titular_nome: 'Massude Madre de Deus Afonso' })]).agreed).toBe(false)
  })
})
