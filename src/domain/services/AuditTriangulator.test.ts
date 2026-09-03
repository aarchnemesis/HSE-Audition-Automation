import { describe, expect, it } from 'vitest'
import {
  Certificate,
  Inspector,
  ParkRequirement,
} from '../models/Certificate.js'
import { StorzRequest } from '../models/StorzRequest.js'
import { AuditTriangulator } from './AuditTriangulator.js'

const REF_DATE = new Date(2026, 7, 19)

function makeCert(code: string, expirationDate?: Date): Certificate {
  return {
    code,
    name: `Doc ${code}`,
    expirationDate,
    statusEHS: 'CONFORME',
    modality: 'PRESENCIAL',
  }
}

function makeInspector(certs: Certificate[]): Inspector {
  const certificates = new Map(certs.map(c => [c.code, c]))
  return { id: '1', name: 'FULANO DE TAL', role: 'TÉCNICO', certificates }
}

const PARK: ParkRequirement = {
  id: 'p1',
  parkName: 'Parque Teste',
  clientName: 'Cliente Teste',
  description: '',
  requiredDocCodes: ['21'],
}

const FAR_FUTURE = new Date(2028, 0, 1)
const NEAR_EXPIRY = new Date(2026, 7, 25) // 6 dias após REF_DATE -> VENCE_07

describe('AuditTriangulator — auditoria de vencimentos', () => {
  it('marca APTO quando o único documento exigido está em dia', () => {
    const inspector = makeInspector([makeCert('21', FAR_FUTURE)])
    const result = AuditTriangulator.performTripleAudit(
      inspector,
      PARK,
      [],
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('CONFORME')
    expect(result.overallStatus).toBe('APTO')
    expect(result.validDocsCount).toBe(1)
  })

  it('marca INAPTO quando o documento exigido está ausente', () => {
    const inspector = makeInspector([])
    const result = AuditTriangulator.performTripleAudit(
      inspector,
      PARK,
      [],
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('AUSENTE')
    expect(result.overallStatus).toBe('INAPTO')
    expect(result.missingDocsCount).toBe(1)
  })

  it('MANTÉM o status de urgência real (VENCE_07) mesmo com solicitação SOLICITADO na Storz — o prazo é o do documento, não o prazo interno da Storz', () => {
    const inspector = makeInspector([makeCert('21', NEAR_EXPIRY)])
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '21',
        trainingName: 'NR-35',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 1),
        state: 'SOLICITADO',
      },
    ]

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      PARK,
      storzRequests,
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('VENCE_07')
    expect(result.auditItems[0].detail).toContain('SOLICITADO NA STORZ')
    expect(result.warningDocsCount).toBe(1)
    expect(result.storzPendingCount).toBe(1)
    expect(result.storzInProgressCount).toBe(0)
    expect(result.overallStatus).toBe('APTO_COM_ATENCAO')
  })

  it('MANTÉM o status de urgência real mesmo com curso EM_ANDAMENTO na Storz — não estende o prazo', () => {
    const inspector = makeInspector([makeCert('21', NEAR_EXPIRY)])
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '21',
        trainingName: 'NR-35',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 1),
        state: 'EM_ANDAMENTO',
      },
    ]

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      PARK,
      storzRequests,
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('VENCE_07')
    expect(result.auditItems[0].detail).toContain('EM ANDAMENTO NA STORZ')
    expect(result.warningDocsCount).toBe(1)
    expect(result.storzInProgressCount).toBe(1)
    expect(result.storzPendingCount).toBe(0)
    expect(result.overallStatus).toBe('APTO_COM_ATENCAO')
  })

  it('quando o documento está VENCIDO (não só vencendo) e há solicitação na Storz, mantém VENCIDO — Storz não perdoa o vencimento já ocorrido', () => {
    const inspector = makeInspector([makeCert('21', new Date(2026, 6, 1))]) // já vencido antes da REF_DATE
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '21',
        trainingName: 'NR-35',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 1),
        state: 'EM_ANDAMENTO',
      },
    ]

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      PARK,
      storzRequests,
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('VENCIDO')
    expect(result.expiredDocsCount).toBe(1)
    expect(result.overallStatus).toBe('INAPTO')
  })

  it('documento AUSENTE (sem prazo real conhecido) SIM usa o status da Storz como melhor referência disponível', () => {
    const inspector = makeInspector([]) // sem certificado nenhum no Drive
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '21',
        trainingName: 'NR-35',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 1),
        state: 'SOLICITADO',
      },
    ]

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      PARK,
      storzRequests,
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('SOLICITADO_STORZ')
    expect(result.missingDocsCount).toBe(0)
    expect(result.storzPendingCount).toBe(1)
    expect(result.overallStatus).toBe('APTO_COM_ATENCAO')
  })

  it('ignora solicitações CANCELADO na Storz (trata como se não houvesse solicitação)', () => {
    const inspector = makeInspector([makeCert('21', NEAR_EXPIRY)])
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-1',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '21',
        trainingName: 'NR-35',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 1),
        state: 'CANCELADO',
      },
    ]

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      PARK,
      storzRequests,
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('VENCE_07')
    expect(result.storzPendingCount).toBe(0)
    expect(result.warningDocsCount).toBe(1)
  })

  it('não busca na Storz documentos que ela não administra (ex.: ASO), mesmo que exista um registro coincidente por engano', () => {
    const parkAso: ParkRequirement = { ...PARK, requiredDocCodes: ['01'] }
    const inspector = makeInspector([makeCert('01', NEAR_EXPIRY)])
    // Registro "coincidente" — não deveria nunca influenciar o status de um documento não-Storz
    const storzRequests: StorzRequest[] = [
      {
        id: 'REQ-X',
        collaboratorName: 'FULANO DE TAL',
        trainingCode: '01',
        trainingName: 'Algo',
        modality: 'PRESENCIAL',
        requestDate: new Date(),
        state: 'SOLICITADO',
      },
    ]

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      parkAso,
      storzRequests,
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('VENCE_07')
    expect(result.auditItems[0].storzRequestFound).toBeUndefined()
    expect(result.storzPendingCount).toBe(0)
  })

  it('documento eletivo ausente (ex.: SIT Vestas) aparece como AUSENTE mas NÃO conta como pendência (INAPTO)', () => {
    const parkVestas: ParkRequirement = { ...PARK, requiredDocCodes: ['25'] } // SIT (Vestas)
    const inspector = makeInspector([]) // não tem o treinamento

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      parkVestas,
      [],
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('AUSENTE')
    expect(result.missingDocsCount).toBe(0)
    expect(result.overallStatus).not.toBe('INAPTO')
  })

  it('documento eletivo PRESENTE continua sendo monitorado normalmente pelo vencimento', () => {
    const parkVestas: ParkRequirement = { ...PARK, requiredDocCodes: ['25'] }
    const inspector = makeInspector([makeCert('25', NEAR_EXPIRY)])

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      parkVestas,
      [],
      REF_DATE
    )

    expect(result.auditItems[0].status).toBe('VENCE_07')
    expect(result.warningDocsCount).toBe(1)
  })

  it('mensagem de AUSENTE não menciona a Storz para documentos que ela nunca administra (ex.: ASO)', () => {
    const parkAso: ParkRequirement = { ...PARK, requiredDocCodes: ['01'] }
    const inspector = makeInspector([])

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      parkAso,
      [],
      REF_DATE
    )

    expect(result.auditItems[0].detail).not.toContain('Storz')
    expect(result.missingDocsCount).toBe(1)
  })

  it('sinaliza incompatibilidade de modalidade sem mudar o status EHS', () => {
    const parkPresencial: ParkRequirement = {
      ...PARK,
      requiredModalities: { '21': 'PRESENCIAL' },
    }
    const cert = { ...makeCert('21', FAR_FUTURE), modality: 'ONLINE' as const }
    const inspector = makeInspector([cert])

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      parkPresencial,
      [],
      REF_DATE
    )

    expect(result.auditItems[0].isModalityCompliant).toBe(false)
    expect(result.auditItems[0].status).toBe('CONFORME')
    expect(result.auditItems[0].detail).toContain('ALERTA MODALIDADE')
  })

  it('respeita electiveDocCodes por park — código ausente marcado como eletivo não conta pra missingDocsCount (ex.: perfil COORDENADOR)', () => {
    const parkCoordenador: ParkRequirement = {
      ...PARK,
      requiredDocCodes: ['01', '21'],
      electiveDocCodes: ['21'], // NR-35 monitorado, não obrigatório de fato pro perfil COORDENADOR
    }
    const inspector = makeInspector([]) // sem ASO nem NR-35

    const result = AuditTriangulator.performTripleAudit(
      inspector,
      parkCoordenador,
      [],
      REF_DATE
    )

    expect(result.missingDocsCount).toBe(1) // só o ASO conta
    const nr35Item = result.auditItems.find(i => i.code === '21')!
    expect(nr35Item.status).toBe('AUSENTE')
  })
})
