import { describe, expect, it } from 'vitest'
import { buildFase2Groups } from './runDriveFase2Merge.js'

describe('runDriveFase2Merge', () => {
  const mockDriveFiles = [
    {
      fileId: 'file-1',
      fileName:
        '21 – NR-35 Trabalho em Altura – 31.10.2027 - LUANA QUEIROZ DE SOUSA.pdf',
      folderId: 'folder-luana-treinamentos',
      folderPath:
        'LUANA QUEIROZ DE SOUSA - INSP. DE QUALIDADE/02. Treinamentos',
      collabName: 'LUANA QUEIROZ DE SOUSA',
    },
    {
      fileId: 'file-2',
      fileName:
        '21 – NR – 35 Trab. Altura + Resgate (GWO) – 29.10.2025 - Luana Queiroz de Sousa - Clicksign.pdf',
      folderId: 'folder-luana-treinamentos',
      folderPath:
        'LUANA QUEIROZ DE SOUSA - INSP. DE QUALIDADE/02. Treinamentos',
      collabName: 'LUANA QUEIROZ DE SOUSA',
    },
    {
      fileId: 'file-3',
      fileName:
        '15 – NR-12 Segurança em Máquinas – 04.11.2027 - LUANA QUEIROZ DE SOUSA.pdf',
      folderId: 'folder-luana-treinamentos',
      folderPath:
        'LUANA QUEIROZ DE SOUSA - INSP. DE QUALIDADE/02. Treinamentos',
      collabName: 'LUANA QUEIROZ DE SOUSA',
    },
    {
      fileId: 'file-4',
      fileName: '01 – ASO – 01.01.2026 - LUANA QUEIROZ DE SOUSA.pdf',
      folderId: 'folder-luana-pessoais',
      folderPath:
        'LUANA QUEIROZ DE SOUSA - INSP. DE QUALIDADE/01.Documentos Pessoais',
      collabName: 'LUANA QUEIROZ DE SOUSA',
    },
  ]

  it('agrupa apenas códigos elegíveis com mais de 1 arquivo', () => {
    const groups = buildFase2Groups(mockDriveFiles)
    expect(groups.length).toBe(1)
    expect(groups[0].code).toBe('21')
    expect(groups[0].collab).toBe('LUANA QUEIROZ DE SOUSA')
    expect(groups[0].files.length).toBe(2)
  })

  it('determina a data mais recente para o arquivo mesclado (F+R)', () => {
    const groups = buildFase2Groups(mockDriveFiles)
    expect(groups[0].latestDate).toBe('31.10.2027')
    expect(groups[0].proposedName).toContain('(F+R)')
    expect(groups[0].proposedName).toContain('31.10.2027')
    expect(groups[0].proposedName).toBe(
      '21 – NR-35 Trabalho em Altura (F+R) – 31.10.2027 - LUANA QUEIROZ DE SOUSA.pdf'
    )
  })

  it('ordena os arquivos internos com a data mais recente primeiro', () => {
    const groups = buildFase2Groups(mockDriveFiles)
    expect(groups[0].files[0].dateStr).toBe('31.10.2027')
    expect(groups[0].files[1].dateStr).toBe('29.10.2025')
  })
})
