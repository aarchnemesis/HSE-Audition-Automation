import { describe, expect, it } from 'vitest'
import { DriveNomenclatureStandardizer } from './DriveNomenclatureStandardizer.js'

describe('DriveNomenclatureStandardizer', () => {
  describe('formatDate', () => {
    it('formata Date em DD.MM.AAAA', () => {
      const d = new Date('2027-05-11T03:00:00Z')
      expect(DriveNomenclatureStandardizer.formatDate(d)).toBe('11.05.2027')
    })

    it('formata string ISO em DD.MM.AAAA', () => {
      expect(DriveNomenclatureStandardizer.formatDate('2028-02-02T03:00:00.000Z')).toBe('02.02.2028')
    })

    it('retorna SEM_DATA para nulo ou inválido', () => {
      expect(DriveNomenclatureStandardizer.formatDate(null)).toBe('SEM_DATA')
      expect(DriveNomenclatureStandardizer.formatDate('invalid')).toBe('SEM_DATA')
    })
  })

  describe('cleanCollaboratorName', () => {
    it('remove cargos e sufixos após hífen', () => {
      expect(
        DriveNomenclatureStandardizer.cleanCollaboratorName('Thiago Lima Santos Silva - Drone Inspection Pilot')
      ).toBe('THIAGO LIMA SANTOS SILVA')
    })

    it('remove espaços múltiplos e coloca em maiúsculas', () => {
      expect(
        DriveNomenclatureStandardizer.cleanCollaboratorName('  Pedro   Eduardo  de Oliveira  ')
      ).toBe('PEDRO EDUARDO DE OLIVEIRA')
    })
  })

  describe('detectModality', () => {
    it('detecta F+R', () => {
      expect(DriveNomenclatureStandardizer.detectModality('12 – NR – 10 Básico (F+R) – 08.08.2025')).toBe('F+R')
      expect(DriveNomenclatureStandardizer.detectModality('NR 35 Formação e Reciclagem.pdf')).toBe('F+R')
    })

    it('detecta Reciclagem', () => {
      expect(DriveNomenclatureStandardizer.detectModality('NR-35 Reciclagem 8h.pdf')).toBe('Rec')
      expect(DriveNomenclatureStandardizer.detectModality('GWO BST Refresher.pdf')).toBe('Rec')
    })

    it('detecta Formação', () => {
      expect(DriveNomenclatureStandardizer.detectModality('NR-10 40h Formação Inicial.pdf')).toBe('F')
      expect(DriveNomenclatureStandardizer.detectModality('Treinamento Inicial NR-35.pdf')).toBe('F')
    })
  })

  describe('buildStandardFilename', () => {
    it('gera nome oficial para documento simples (ASO)', () => {
      const res = DriveNomenclatureStandardizer.buildStandardFilename({
        code: '01',
        collaboratorName: 'Thiago Lima Santos Silva - Drone Pilot',
        date: new Date('2027-01-29T03:00:00Z'),
      })
      expect(res).toBe('01 – ASO – 29.01.2027 - THIAGO LIMA SANTOS SILVA.pdf')
    })

    it('gera nome oficial com (F+R) para certificado mesclado', () => {
      const res = DriveNomenclatureStandardizer.buildStandardFilename({
        code: '12',
        collaboratorName: 'Pedro Eduardo de Oliveira',
        date: new Date('2028-02-02T03:00:00Z'),
        isMerged: true,
      })
      expect(res).toBe('12 – NR-10 Básico (F+R) – 02.02.2028 - PEDRO EDUARDO DE OLIVEIRA.pdf')
    })

    it('gera nome oficial para Contrato + Aditivo (Doc 40)', () => {
      const res = DriveNomenclatureStandardizer.buildStandardFilename({
        code: '40',
        collaboratorName: 'Thiago Lima Santos Silva',
        date: new Date('2027-05-11T03:00:00Z'),
        isMerged: true,
      })
      expect(res).toBe('40 – Contrato + Aditivo – 11.05.2027 - THIAGO LIMA SANTOS SILVA.pdf')
    })

    it('prioriza data do fim do aditivo sobre a data do contrato (pedido Darliane)', () => {
      const res = DriveNomenclatureStandardizer.buildStandardFilename({
        code: '40',
        collaboratorName: 'Thiago Lima Santos Silva',
        date: new Date('2026-05-11T03:00:00Z'), // data original do contrato
        aditivoDate: new Date('2027-05-11T03:00:00Z'), // data do fim do aditivo
      })
      expect(res).toBe('40 – Contrato + Aditivo – 11.05.2027 - THIAGO LIMA SANTOS SILVA.pdf')
    })

    it('preserva qualificadores como Supervisor em NR-33', () => {
      const res = DriveNomenclatureStandardizer.buildStandardFilename({
        code: '20',
        originalFilename: '20 – NR – 33 (Supervisor F+R) – 22.09.2026.pdf',
        collaboratorName: 'Pedro Eduardo de Oliveira',
        date: new Date('2027-09-22T03:00:00Z'),
        isMerged: true,
      })
      expect(res).toBe('20 – NR-33 Espaço Confinado Supervisor (F+R) – 22.09.2027 - PEDRO EDUARDO DE OLIVEIRA.pdf')
    })
  })
})
