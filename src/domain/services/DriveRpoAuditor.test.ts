import { describe, expect, it } from 'vitest'
import { Certificate, Inspector } from '../models/Certificate.js'
import { StorzRequest } from '../models/StorzRequest.js'
import { DriveRpoAuditor } from './DriveRpoAuditor.js'

function makeCert(code: string, expirationDate: Date): Certificate {
  return { code, name: `Doc ${code}`, expirationDate, statusEHS: 'CONFORME' }
}

function makeInspector(name: string, certs: Certificate[]): Inspector {
  return {
    id: name,
    name,
    role: 'TÉCNICO',
    certificates: new Map(certs.map(c => [c.code, c])),
  }
}

function makeStorzRequest(overrides: Partial<StorzRequest>): StorzRequest {
  return {
    id: 'REQ-1',
    collaboratorName: 'FULANO',
    trainingCode: '21',
    trainingName: 'NR-35',
    modality: 'PRESENCIAL',
    requestDate: new Date(2026, 0, 1),
    state: 'CONCLUIDO',
    ...overrides,
  }
}

describe('DriveRpoAuditor.compare', () => {
  it('não reporta nada quando as datas batem (dentro da tolerância)', () => {
    const drive = [
      makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 10))]),
    ]
    const rpo = [
      makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 11))]),
    ] // 1 dia de diferença

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'])
    expect(result).toHaveLength(1)
    expect(result[0].divergent).toBe(false)
    expect(result[0].diffDays).toBe(1)
    expect(result[0].recommendedAction).toBe(
      'Nenhuma ação necessária (Consistente)'
    )
  })

  it('marca SOMENTE_DRIVE quando o certificado só existe no Drive', () => {
    const drive = [
      makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 10))]),
    ]
    const rpo = [makeInspector('FULANO', [])]

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'])
    expect(result).toHaveLength(1)
    expect(result[0].divergenceKind).toBe('SOMENTE_DRIVE')
    expect(result[0].recommendedAction).toBe('Incluir na RPO com base no Drive')
  })

  it('marca SOMENTE_RPO quando o certificado só existe na planilha', () => {
    const drive = [makeInspector('FULANO', [])]
    const rpo = [
      makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 10))]),
    ]

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'])
    expect(result).toHaveLength(1)
    expect(result[0].divergenceKind).toBe('SOMENTE_RPO')
    expect(result[0].direction).toBe('RPO_NEWER')
    expect(result[0].recommendedAction).toBe(
      'Checar documento físico e fazer upload do backup no Drive'
    )
  })

  it('marca DATA_DIVERGENTE com RPO_NEWER quando RPO tem data mais recente que o Drive (provável renovação sem backup no Drive)', () => {
    const drive = [
      makeInspector('GABRIEL FEITOSA', [makeCert('01', new Date(2026, 0, 10))]),
    ]
    const rpo = [
      makeInspector('GABRIEL FEITOSA', [makeCert('01', new Date(2027, 0, 10))]),
    ] // RPO renovado para 2027, Drive ainda em 2026

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'])
    expect(result).toHaveLength(1)
    expect(result[0].divergenceKind).toBe('DATA_DIVERGENTE')
    expect(result[0].direction).toBe('RPO_NEWER')
    expect(result[0].diffDays).toBeGreaterThan(300)
    expect(result[0].recommendedAction).toBe(
      'Checar documento físico e atualizar backup no Drive'
    )
    expect(result[0].detail).toContain('RPO mais recente que o Drive')
    expect(result[0].detail).toContain(
      'upload do novo documento de backup no Drive'
    )
  })

  it('marca DATA_DIVERGENTE com DRIVE_NEWER quando Drive tem data mais recente que a RPO (Drive atualizado, RPO desatualizada)', () => {
    const drive = [
      makeInspector('FULANO', [makeCert('01', new Date(2027, 5, 10))]),
    ]
    const rpo = [
      makeInspector('FULANO', [makeCert('01', new Date(2027, 0, 10))]),
    ] // Drive mais novo que RPO

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'])
    expect(result).toHaveLength(1)
    expect(result[0].divergenceKind).toBe('DATA_DIVERGENTE')
    expect(result[0].direction).toBe('DRIVE_NEWER')
    expect(result[0].diffDays).toBeGreaterThan(140)
    expect(result[0].recommendedAction).toContain(
      'Atualizar data na RPO para 10/06/2027'
    )
    expect(result[0].detail).toContain('Drive mais recente que a RPO')
  })

  it('detecta inversão de dia/mês (DD/MM vs MM/DD) quando o formato regional do Smartsheet inverte os campos (ex.: 04/09 vs 09/04)', () => {
    const drive = [
      makeInspector('RAFAEL ANDRADE BARBOSA', [
        makeCert('09', new Date(Date.UTC(2028, 8, 4, 12, 0, 0))), // 04/09/2028
      ]),
    ]
    const rpo = [
      makeInspector('RAFAEL ANDRADE BARBOSA', [
        makeCert('09', new Date(Date.UTC(2028, 3, 9, 12, 0, 0))), // 09/04/2028
      ]),
    ]

    const result = DriveRpoAuditor.compare(drive, rpo, ['09'])
    expect(result).toHaveLength(1)
    expect(result[0].divergent).toBe(true)
    expect(result[0].divergenceKind).toBe('DATA_DIVERGENTE')
    expect(result[0].isSwappedDayMonth).toBe(true)
    expect(result[0].detail).toContain(
      'Provável inversão de dia/mês (DD/MM vs MM/DD)'
    )
    expect(result[0].detail).toContain(
      '04/09/2028 no Drive vs 09/04/2028 na RPO'
    )
    expect(result[0].recommendedAction).toBe(
      'Corrigir inversão de dia/mês na RPO para 04/09/2028'
    )
  })

  it('tolera até 5 dias de diferença entre Drive e RPO (ex.: turmas modulares e assinaturas Clicksign de 3 dias)', () => {
    const drive = [
      makeInspector('LUCAS FRANKLIN', [makeCert('17', new Date(2027, 9, 30))]),
    ]
    const rpo = [
      makeInspector('LUCAS FRANKLIN', [makeCert('17', new Date(2027, 9, 27))]),
    ] // 3 dias de diferença

    const result = DriveRpoAuditor.compare(drive, rpo, ['17'])
    expect(result).toHaveLength(1)
    expect(result[0].divergent).toBe(false)
    expect(result[0].diffDays).toBe(3)
    expect(result[0].recommendedAction).toBe(
      'Nenhuma ação necessária (Consistente)'
    )
  })

  it('marca DATA_DIVERGENTE quando a diferença for maior que 5 dias (ex.: 6 dias)', () => {
    const drive = [
      makeInspector('LUCAS FRANKLIN', [makeCert('17', new Date(2027, 9, 30))]),
    ]
    const rpo = [
      makeInspector('LUCAS FRANKLIN', [makeCert('17', new Date(2027, 9, 24))]),
    ] // 6 dias de diferença

    const result = DriveRpoAuditor.compare(drive, rpo, ['17'])
    expect(result).toHaveLength(1)
    expect(result[0].divergent).toBe(true)
    expect(result[0].divergenceKind).toBe('DATA_DIVERGENTE')
    expect(result[0].diffDays).toBe(6)
  })

  it('marca DRIVE_SEM_DATA quando certificado existe no Drive sem data identificada, sem alegar falsamente ausência de certificado', () => {
    const certSemData: Certificate = {
      code: '17',
      name: 'Doc 17',
      filename: '17 - GWO NR-17 Carga Manual.pdf',
      statusEHS: 'INDETERMINADO',
    }
    const drive = [makeInspector('LUCAS FRANKLIN', [certSemData])]
    const rpo = [
      makeInspector('LUCAS FRANKLIN', [makeCert('17', new Date(2027, 9, 27))]),
    ]

    const result = DriveRpoAuditor.compare(drive, rpo, ['17'])
    expect(result).toHaveLength(1)
    expect(result[0].divergent).toBe(true)
    expect(result[0].divergenceKind).toBe('DRIVE_SEM_DATA')
    expect(result[0].detail).toContain('Certificado presente no Drive')
    expect(result[0].recommendedAction).toBe(
      'Conferir data no documento físico anexado'
    )
  })

  it('não gera item quando o documento está ausente nas duas fontes', () => {
    const drive = [makeInspector('FULANO', [])]
    const rpo = [makeInspector('FULANO', [])]

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'])
    expect(result).toHaveLength(0)
  })

  it('casa inspetor do Drive com o da RPO por substring de nome', () => {
    const drive = [
      makeInspector('FULANO DE TAL', [makeCert('01', new Date(2027, 0, 10))]),
    ]
    const rpo = [
      makeInspector('Fulano de Tal - Solicitação', [
        makeCert('01', new Date(2027, 0, 10)),
      ]),
    ]

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'])
    expect(result).toHaveLength(1)
    expect(result[0].divergent).toBe(false)
  })

  it('usa a validade estimada da Storz (curso concluído) como fonte confiável quando não há Drive', () => {
    const drive = [makeInspector('FULANO', [])]
    const rpo = [
      makeInspector('FULANO', [makeCert('21', new Date(2028, 0, 15))]),
    ] // NR-35, 2 anos de validade
    const storz = [makeStorzRequest({ completionDate: new Date(2026, 0, 15) })] // conclusão -> expira 2028-01-15

    const result = DriveRpoAuditor.compare(drive, rpo, ['21'], storz)
    expect(result).toHaveLength(1)
    expect(result[0].trustedSource).toBe('STORZ')
    expect(result[0].divergent).toBe(false)
  })

  it('marca SOMENTE_STORZ quando o curso foi concluído na Storz mas não há registro na RPO', () => {
    const drive = [makeInspector('FULANO', [])]
    const rpo = [makeInspector('FULANO', [])]
    const storz = [makeStorzRequest({ completionDate: new Date(2026, 0, 15) })]

    const result = DriveRpoAuditor.compare(drive, rpo, ['21'], storz)
    expect(result).toHaveLength(1)
    expect(result[0].divergenceKind).toBe('SOMENTE_STORZ')
  })

  it('marca DATA_DIVERGENTE entre Storz (estimado) e RPO quando diferem além da tolerância — provável erro de digitação', () => {
    const drive = [makeInspector('FULANO', [])]
    const rpo = [
      makeInspector('FULANO', [makeCert('21', new Date(2027, 5, 15))]),
    ] // RPO digitou errado, ~1.5 ano de diferença
    const storz = [makeStorzRequest({ completionDate: new Date(2026, 0, 15) })] // -> expira 2028-01-15

    const result = DriveRpoAuditor.compare(drive, rpo, ['21'], storz)
    expect(result).toHaveLength(1)
    expect(result[0].divergenceKind).toBe('DATA_DIVERGENTE')
    expect(result[0].trustedSource).toBe('STORZ')
  })

  it('prioriza o Drive sobre a Storz quando as duas fontes confiáveis existem', () => {
    const drive = [
      makeInspector('FULANO', [makeCert('21', new Date(2027, 0, 10))]),
    ]
    const rpo = [
      makeInspector('FULANO', [makeCert('21', new Date(2027, 0, 10))]),
    ]
    const storz = [makeStorzRequest({ completionDate: new Date(2020, 0, 1) })] // bem diferente, não deve ser usado

    const result = DriveRpoAuditor.compare(drive, rpo, ['21'], storz)
    expect(result).toHaveLength(1)
    expect(result[0].trustedSource).toBe('DRIVE')
    expect(result[0].divergent).toBe(false)
  })

  it('ignora conclusão na Storz pra código que a Storz não administra (ex.: ASO)', () => {
    const drive = [makeInspector('FULANO', [])]
    const rpo = [makeInspector('FULANO', [])]
    const storz = [
      makeStorzRequest({
        trainingCode: '01',
        completionDate: new Date(2026, 0, 15),
      }),
    ]

    const result = DriveRpoAuditor.compare(drive, rpo, ['01'], storz)
    expect(result).toHaveLength(0)
  })

  it('não compara data pra NR-01 (código 10) mesmo com datas muito diferentes — event-triggered, só a presença importa', () => {
    const drive = [
      makeInspector('FULANO', [makeCert('10', new Date(2075, 0, 10))]),
    ] // proxy de "não vence"
    const rpo = [
      makeInspector('FULANO', [makeCert('10', new Date(2027, 0, 10))]),
    ] // RPO digitado com regra padrão de 2 anos

    const result = DriveRpoAuditor.compare(drive, rpo, ['10'])
    expect(result).toHaveLength(1)
    expect(result[0].divergent).toBe(false)
    expect(result[0].divergenceKind).toBeUndefined()
  })

  it('não compara data pra NR-06 (código 11) pelo mesmo motivo', () => {
    const drive = [
      makeInspector('FULANO', [makeCert('11', new Date(2074, 5, 25))]),
    ]
    const rpo = [
      makeInspector('FULANO', [makeCert('11', new Date(2028, 3, 8))]),
    ]

    const result = DriveRpoAuditor.compare(drive, rpo, ['11'])
    expect(result).toHaveLength(1)
    expect(result[0].divergent).toBe(false)
  })

  it('continua marcando SOMENTE_RPO ou SOMENTE_DRIVE normalmente pra NR-01/NR-06 quando só uma fonte tem o documento', () => {
    const drive = [makeInspector('FULANO', [])]
    const rpo = [
      makeInspector('FULANO', [makeCert('10', new Date(2027, 0, 10))]),
    ]

    const result = DriveRpoAuditor.compare(drive, rpo, ['10'])
    expect(result).toHaveLength(1)
    expect(result[0].divergenceKind).toBe('SOMENTE_RPO')
  })
})
