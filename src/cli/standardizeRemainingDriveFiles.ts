import 'dotenv/config'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { google } from 'googleapis'
import { getAuthorizedClient } from '../adapters/drive/googleAuth.js'
import { CertificateClassifier } from '../domain/services/CertificateClassifier.js'
import { DriveNomenclatureStandardizer } from '../domain/services/DriveNomenclatureStandardizer.js'
import {
  parseDateDmy,
  resolveCourseStartDate,
} from './updateCoursesToStartDate.js'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface ExtraFilePlan {
  fileId: string
  collabName: string
  folderId: string
  folderPath: string
  oldName: string
  newName: string
  category:
    | 'CODED_HSE'
    | 'UNCODED_EXTRA'
    | 'FIX_DOC_04_1'
    | 'CLEAN_FIXED_SEM_DATA'
}

function formatDateDots(d: Date): string {
  const day = String(d.getUTCDate()).padStart(2, '0')
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${day}.${month}.${year}`
}

function addOneYear(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear() + 1, d.getUTCMonth(), d.getUTCDate())
  )
}

/**
 * Resolve data para documentos extras ou de curso:
 * - Se tem data explícita DD.MM.YYYY no nome, usa ela.
 * - Se tem padrão YYYYMMDD no nome, usa ele.
 * - Senão, usa issueDate ou expirationDate do cache.
 * - Se tem mês/ano MM.YYYY no nome (ex: "07.2025"), usa 01.MM.YYYY.
 */
export function resolveExtraFileDate(
  fileId: string,
  origName: string,
  preCacheMap: Map<string, any>,
  preferExpiration: boolean = false
): Date | null {
  const dOrig = parseDateDmy(origName)
  if (dOrig) return dOrig

  const compactIso = origName.match(/[_-](\d{4})(\d{2})(\d{2})(?:\D|$)/)
  if (compactIso) {
    const y = parseInt(compactIso[1], 10)
    const m = parseInt(compactIso[2], 10) - 1
    const d = parseInt(compactIso[3], 10)
    if (y >= 2000 && y <= 2040 && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, m, d))
    }
  }

  const cached = preCacheMap.get(fileId)
  if (preferExpiration && cached?.expirationDate) {
    const dExp = new Date(cached.expirationDate)
    if (!isNaN(dExp.getTime()) && dExp.getUTCFullYear() <= 2045) {
      return dExp
    }
  }

  if (cached?.issueDate) {
    const dIss = new Date(cached.issueDate)
    if (!isNaN(dIss.getTime()) && dIss.getUTCFullYear() <= 2036) {
      return dIss
    }
  }

  const myMatch = origName.match(
    /(?:^|\D)(0[1-9]|1[0-2])[\.\/-](202\d)(?:\D|$)/
  )
  if (myMatch) {
    const month = parseInt(myMatch[1], 10) - 1
    const year = parseInt(myMatch[2], 10)
    return new Date(Date.UTC(year, month, 1))
  }

  return null
}

/**
 * Classifica um arquivo que ainda não foi padronizado nas pastas ativas.
 * Retorna o novo nome padronizado (com código HSE se pertencer ao catálogo, ou sem código se for extra).
 */
export function buildStandardNameForRemainingFile(
  fileId: string,
  origName: string,
  collabName: string,
  preCacheMap: Map<string, any>
): { newName: string; category: ExtraFilePlan['category'] } | null {
  const collabUpper = collabName.trim().toUpperCase()
  const norm = origName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()

  // Caso 0A: Arquivos que ficaram com "04.1 – Doc 04.1" na Fase 1
  if (/^04\.1\s*[-–]\s*DOC\s+04\.1/i.test(origName)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Contrato de Trabalho CLT${datePart} - ${collabUpper}.pdf`,
      category: 'FIX_DOC_04_1',
    }
  }

  // Caso 0B: Documentos cadastrais/permanentes já padronizados mas com " – SEM_DATA" (02, 03, 04, 05, 23, 24, 30)
  const fixedSemDataMatch = origName.match(
    /^(02|03|04|05|23|24|30)\s*–\s*([^–]+?)\s*–\s*SEM_DATA\s*-\s*(.+\.pdf)$/i
  )
  if (fixedSemDataMatch) {
    return {
      newName: `${fixedSemDataMatch[1]} – ${fixedSemDataMatch[2].trim()} - ${fixedSemDataMatch[3].trim()}`,
      category: 'CLEAN_FIXED_SEM_DATA',
    }
  }

  // Ignora arquivos que já estão 100% no padrão novo e sem sufixo Clicksign ou .pdf.pdf
  const alreadyStandardWithCode =
    /^\d{1,2}(?:\.\d+)?\s*–\s*[^–]+–\s*(?:\d{2}\.\d{2}\.\d{4}|SEM_DATA)\s*-\s*[A-ZÀ-Ú\s]+\.pdf$/.test(
      origName
    ) &&
    !/Clicksign/i.test(origName) &&
    !/\.pdf\.pdf$/i.test(origName) &&
    !/Doc\s+\d/i.test(origName)
  if (alreadyStandardWithCode) {
    return null
  }

  // ---------------------------------------------------------------------------
  // GRUPO A: Documentos Extras Sem Código (não entram no fluxo HSE-Automation)
  // ---------------------------------------------------------------------------

  // A1. Passaporte / Visto
  if (/(?:^|[\s_.-])(?:PAS+APORTE?|PASSAPORT|PASSPORT)(?:$|[\s_.-])/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, true)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Passaporte${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/^VISTO\.PDF$/i.test(norm) || /\bVISTO\s+DE\s+VIAGEM\b/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, true)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Visto${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A2. Plano de Saúde / Declaração de Plano de Saúde (antigo 05.2 / 05.3)
  if (
    /\b(?:PLANO\s+DE\s+SAUDE|PLANO\s+DE\s+SAUDE|UNIMED|HAPVIDA)\b/i.test(norm)
  ) {
    const isDecl = /\bDECLARACAO\b/i.test(norm)
    const label = isDecl ? 'Declaração de Plano de Saúde' : 'Plano de Saúde'
    const d = parseDateDmy(origName)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `${label}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A3. Cartão SUS (antigo 05.1 / 05.2)
  if (/\bCARTAO\s+(?:DO\s+)?SUS\b/i.test(norm)) {
    return {
      newName: `Cartão SUS - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A4. Crachá / Carteirinha
  if (/\b(?:CRACHA|CARTEIRINHA|PASSAPORTE\s+DE\s+SEGURANCA)\b/i.test(norm)) {
    const label = /\bCARTEIRINHA\b/i.test(norm)
      ? 'Carteirinha'
      : 'Crachá de Identificação'
    const d = parseDateDmy(origName)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `${label}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A5. Foto 3x4
  if (/\bFOTO\s*3X4\b|\bFOTO\b/i.test(norm)) {
    return {
      newName: `Foto 3x4 - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A6. Permissão Internacional para Dirigir (PID)
  if (/\b(?:PERMISSAO\s+INTERNACIONAL|PID\b)/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, true)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Permissão Internacional para Dirigir (PID)${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A7. Documentos Civis (RG, CPF, Título de Eleitor, Certidão de Casamento, Residência, CRLV)
  if (/\bRG\b.*\bCPF\b.*\bTITULO\b/i.test(norm)) {
    return {
      newName: `RG, CPF e Título de Eleitor - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bRG\b.*\bCPF\b|\bCPF\b.*\bRG\b/i.test(norm)) {
    return {
      newName: `RG e CPF - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (
    /\b(?:SECRETARIA\s+DA\s+SEGURANCA|\bRG\b|IDENTIDADE)\b/i.test(norm) &&
    !/\bNR\b/i.test(norm)
  ) {
    return {
      newName: `RG - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bCPF\b/i.test(norm)) {
    return {
      newName: `CPF - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/(?:^|[\s_.-])TITULO[\s_]+(?:DE[\s_]+)?ELEITOR(?:AL)?/i.test(norm)) {
    return {
      newName: `Título de Eleitor - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/CERTIDA_?O.*CASAMENTO/i.test(norm)) {
    return {
      newName: `Certidão de Casamento - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bCOMPROVANTE\s+DE\s+RESIDENCIA|\bFATURA\b/i.test(norm)) {
    return {
      newName: `Comprovante de Residência - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bCRLV\b/i.test(norm)) {
    return {
      newName: `CRLV Veículo - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A8. Exames Complementares e Declarações Médicas (IgE, Alergia, ECG, EEG, Audiometria, Acuidade, Fator RH, Cardiológico)
  if (/\bDECLARACAO\b.*\bALERGIA/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Declaração de Alergias${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\b(?:IGE\b|ALERGIAS?\b|MARIMBONDO|VESPA|ABELHA)/i.test(norm)) {
    let sub = ''
    if (/\bI1\b|ABELHA/i.test(norm) && !/VESPA|MARIMBONDO/i.test(norm))
      sub = ' (Abelha I1)'
    else if (/\bI3\b/i.test(norm)) sub = ' (Vespa I3)'
    else if (/\bI4\b/i.test(norm)) sub = ' (Marimbondo I4)'
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Exame IgE${sub}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\b(?:ELETROCARDIOGRAMA|\bECG\b)/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Orientação Técnica Eletrocardiograma (ECG)${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\b(?:ELETROENCEFALOGRAMA|\bEEG\b)/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Exame Eletroencefalograma (EEG)${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\b(?:AUDIOMETR|ALTERACAO\s+AUDITIVA)/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Termo Exame Audiométrico${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bACUIDADE\s+VISUAL\b/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Exame de Acuidade Visual${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\b(?:LAUDO\s+CARDIOLOGICO|RESULTADO\s+PERICIA|FATOR\s+RH|\bLAB\.PDF|ENCAMINHAMENTO)\b/i.test(norm)) {
    let label = 'Exame Complementar'
    if (/CARDIOLOGICO/i.test(norm)) label = 'Laudo Cardiológico'
    else if (/PERICIA/i.test(norm)) label = 'Resultado de Perícia Médica'
    else if (/FATOR\s+RH/i.test(norm)) label = 'Exame Tipo Sanguíneo (Fator RH)'
    else if (/ENCAMINHAMENTO/i.test(norm)) label = 'Encaminhamento Médico'
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `${label}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bADMISSIONAIS\b/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Exames Admissionais${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A9. Certificados e Cadastros de Drone / SARPAS / Inspeção de Pás / Robô / SGRE / PET / E-RUT
  if (/\bSARPAS\b/i.test(norm)) {
    const d = parseDateDmy(origName)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Cadastro SARPAS${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (
    /\bINSPECAO\s+EXTERNA\s+DE\s+PAS|\bPAS\s+EOLICAS\s+COM\s+DRONE\b/i.test(
      norm
    )
  ) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Certificado Inspeção de Pás com Drone${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (
    /\b(?:DRONE|ARTHDRONE|UAS\s+PRO|PLANO\s+DE\s+VOO)\b/i.test(norm) &&
    !/\bADITIVO\b|\bCONTRATO\b/i.test(norm)
  ) {
    const label = /\bPLANO\s+DE\s+VOO\b/i.test(norm)
      ? 'Plano de Voo Drone'
      : 'Certificado Piloto de Drone'
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `${label}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bWORKSHOP\s+ROB/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Certificado Workshop Robô${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bE-RUT\b/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Certificado E-RUT${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bPET\b/i.test(norm) && !/\bPETROBRAS\b/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Permissão de Entrada e Trabalho (PET)${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bPERFIL\s+(?:SGRE|GAMESA)\b/i.test(norm)) {
    const tag = /\bGAMESA\b/i.test(norm) ? 'Gamesa' : 'SGRE'
    return {
      newName: `Perfil ${tag} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/^CERTIFICATE_SE-P-(\d+)/i.test(norm)) {
    const m = norm.match(/^CERTIFICATE_SE-P-(\d+)/i)
    const mod = m ? ` (SE-P-${m[1]})` : ''
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Certificado SGRE${mod}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/TSWA-SE-SG5X/i.test(norm) || /TASK\s+SPECIFIC\s+WORK\s+APPROVAL/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Certificado SGRE (TSWA)${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/GESTAO\s+DE\s+PROJETOS/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Certificado Gestão da Qualidade e Projetos${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A10. Documentos Societários / Contratuais / Declarações Extras (CND, QSA, eSocial, ENEL, EDP, Auren, GEV, Experiência)
  if (
    /\b(?:CND\b|CERTIDAO\s+NEGATIVA(?:DA)?|DIVIDA\s+NEGATIVA|CERTIDAO-\d+)\b/i.test(
      norm
    )
  ) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, true)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Certidão Negativa de Débitos (CND)${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\b(?:QSA\b|QUADRO\s+DE\s+SOCIOS)\b/i.test(norm)) {
    return {
      newName: `Quadro de Sócios e Administradores (QSA) - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bE-?SOCIAL\b/i.test(norm)) {
    return {
      newName: `Cadastro eSocial - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bNAO\s+APLICABILIDADE\b/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Declaração de Não Aplicabilidade${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bAPROVACAO\s+DA\s+ENEL\b/i.test(norm)) {
    return {
      newName: `Aprovação de Contratação PJ (ENEL) - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (
    /\b(?:DECLARACAO\s+EDP|RISCOS?\s+AMBIENT(?:AIS|AL)|DECLARACAO\s*-\s*AUREN|CARTA\s+CONVITE\s+GEV)\b/i.test(
      norm
    )
  ) {
    let label = 'Carta de Risco Ambiental'
    if (/AUREN/i.test(norm)) label = 'Declaração Auren'
    else if (/GEV/i.test(norm)) label = 'Carta Convite GEV'
    else if (/DECLARACAO\s+EDP/i.test(norm)) label = 'Declaração EDP'
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `${label}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (
    /\b(?:CERTIFICACAO\s+DE\s+EXPERI\w+|DEC(?:\.|LARACAO)\s*(?:DE\s*)?EXPERIENCIA|CARTA\s+DE\s+VINCULO|FORMACAO\s+PROFISSIONAL|SEGUNDA\s+VIA\s+DO\s+CONTRATO|FICHA\s+DE\s+AVALIACAO|AVALIACAO\.PDF)\b/i.test(
      norm
    )
  ) {
    const label = /SEGUNDA\s+VIA/i.test(norm)
      ? 'Declaração de Recebimento de Contrato'
      : /AVALIACAO/i.test(norm)
        ? 'Ficha de Avaliação Técnica'
        : 'Declaração de Experiência Profissional'
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `${label}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bDISTRATO\b/i.test(norm)) {
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `Distrato Contratual${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bRECIBO\s+DE\s+PAGAMENTO\s+AUTONOMO\b/i.test(norm)) {
    return {
      newName: `Recibo de Pagamento Autônomo (RPA) - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bCV\b|\bCURRICULO\b/i.test(norm)) {
    return {
      newName: `Currículo - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }
  if (/\bPPRA\b.*\bPCMSO\b|\bQSMA\b/i.test(norm)) {
    return {
      newName: `Termo PPRA e PCMSO - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // A11. Certificados / Laudos de Aprovação de EPI (Cinturão, Trava Quedas, Talabarte)
  if (/\b(?:CINTURAO|TRAVA\s*QUEDAS|TALABARTE|30B002802)\b/i.test(norm)) {
    let item = 'EPI'
    if (/\bCINTURAO\b/i.test(norm)) item = 'Cinturão'
    else if (/\bTRAVA\s*QUEDAS\b/i.test(norm)) item = 'Trava Quedas'
    else if (/\bTALABARTE\b/i.test(norm)) item = 'Talabarte'
    return {
      newName: `Certificado de Inspeção (${item}) - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // ---------------------------------------------------------------------------
  // GRUPO B: Documentos com Código do Escopo HSE-Automation (01 a 40)
  // ---------------------------------------------------------------------------
  // B1. Módulos GWO ART / SART individuais -> Código 32
  if (
    /\b(S?A?RT[\s_-]+[HN])\b|\bGWO\s*\[?ART\]?\b|\bRESGATE\s+AVANCADO\s*\(?ART/i.test(
      norm
    )
  ) {
    const modMatch = norm.match(/\b(S?A?RT)[\s_-]+([HN])\b/i)
    let mod = ''
    if (modMatch) {
      const prefix = modMatch[1].toUpperCase() === 'SAT' ? 'SART' : modMatch[1].toUpperCase()
      mod = ` (${prefix}-${modMatch[2].toUpperCase()})`
    }
    const d = resolveCourseStartDate(
      fileId,
      origName,
      origName,
      '32',
      preCacheMap
    )
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `32 – GWO ART${mod}${datePart} - ${collabUpper}.pdf`,
      category: 'CODED_HSE',
    }
  }

  // B2. Cartas de Anuência (12.1, 15.1, 20.1, 21.1)
  if (/\bCARTA\b.*NR\s*[-–_]?\s*10|^12\.[12]\b/i.test(norm)) {
    const d = resolveCourseStartDate(
      fileId,
      origName,
      origName,
      '12.1',
      preCacheMap
    )
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `12.1 – Carta NR-10${datePart} - ${collabUpper}.pdf`,
      category: 'CODED_HSE',
    }
  }
  if (/\bCARTA\b.*NR\s*[-–_]?\s*12|^15\.1\b|^16\.1\b/i.test(norm)) {
    const d = resolveCourseStartDate(
      fileId,
      origName,
      origName,
      '15.1',
      preCacheMap
    )
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `15.1 – Carta NR-12${datePart} - ${collabUpper}.pdf`,
      category: 'CODED_HSE',
    }
  }
  if (/\bCARTA\b.*NR\s*[-–_]?\s*33|^20\.1\b/i.test(norm)) {
    const d = resolveCourseStartDate(
      fileId,
      origName,
      origName,
      '20.1',
      preCacheMap
    )
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `20.1 – Carta NR-33${datePart} - ${collabUpper}.pdf`,
      category: 'CODED_HSE',
    }
  }
  if (/\bCARTA\b.*NR\s*[-–_]?\s*35|^21\.1\b|\bANUENCIA\b/i.test(norm)) {
    const d = resolveCourseStartDate(
      fileId,
      origName,
      origName,
      '21.1',
      preCacheMap
    )
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `21.1 – Carta NR-35${datePart} - ${collabUpper}.pdf`,
      category: 'CODED_HSE',
    }
  }

  // B3. Ficha de EPI / Checklist EPI de Altura (06) - mantém data de vencimento (+1 ano se data no nome <= 2026)
  if (
    /^06(?:\.1)?\b|\bFICHA\s+DE\s+EPI\b|\bCHECKLIST\s+(?:DE\s+)?EPI\b|\bEPIS?\b/i.test(
      norm
    ) &&
    !/NR\s*[-–_]?\s*11|TALHA/i.test(norm)
  ) {
    const isChecklist = /\bCHECKLIST\b|^06\.1\b/i.test(norm)
    let brand = ''
    if (/HONEYWELL.*DBI|DBI.*HONEYWELL/i.test(norm))
      brand = ' (Honeywell DBI-SALA)'
    else if (/HONEYWELL/i.test(norm)) brand = ' (Honeywell)'
    else if (/DBI[-\s]?SALA/i.test(norm)) brand = ' (DBI-SALA)'
    else if (/AVANTI/i.test(norm)) brand = ' (Avanti)'
    else if (/HERCULES/i.test(norm)) brand = ' (Hércules)'

    const baseLabel = isChecklist
      ? `06 – Checklist EPI de Altura${brand}`
      : `06 – Ficha de EPI${brand}`
    let d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    if (d && d.getUTCFullYear() <= 2026) {
      d = addOneYear(d)
    }
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `${baseLabel}${datePart} - ${collabUpper}.pdf`,
      category: 'CODED_HSE',
    }
  }

  // B4. Elevador (31) - Power Climber, Avanti, Hailo, Artama, JASO, SLIM
  if (
    /\b(?:ELEVADOR(?:ES)?|POWER\s+CLIMBER|PEGASUS|ARTAMA|HAILO|JASO)\b/i.test(
      norm
    )
  ) {
    let model = '(JASO)'
    if (/POWER\s+CLIMBER|\bPC\b/i.test(norm)) model = '(Power Climber)'
    else if (/AVANTI|PEGASUS/i.test(norm)) model = '(Avanti)'
    else if (/ARTAMA/i.test(norm)) model = '(Artama)'
    else if (/HAILO/i.test(norm)) model = '(Hailo)'
    else if (/SLIM/i.test(norm)) model = '(SLIM)'

    const d = resolveCourseStartDate(
      fileId,
      origName,
      origName,
      '31',
      preCacheMap
    )
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `31 – Elevador ${model}${datePart} - ${collabUpper}.pdf`,
      category: 'CODED_HSE',
    }
  }

  // B5. GWO WINDA ID (30)
  if (/\bWINDA\b/i.test(norm)) {
    const d = resolveCourseStartDate(
      fileId,
      origName,
      origName,
      '30',
      preCacheMap
    )
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `30 – GWO WINDA${datePart} - ${collabUpper}.pdf`,
      category: 'CODED_HSE',
    }
  }

  // B6. Contratos (04.1 / 04.2 / Contrato Experiência / Aditivo)
  if (/^04\.[12]\b|\bCONTRATO\s*\(?EXPERIENCIA\)?/i.test(norm)) {
    if (/\bADITIVO\b|\bPREST\w*\s+DE\s+SERVICOS\b/i.test(norm)) {
      const d = resolveExtraFileDate(fileId, origName, preCacheMap, true)
      const datePart = d ? ` – ${formatDateDots(d)}` : ''
      return {
        newName: `40 – Contrato + Aditivo${datePart} - ${collabUpper}.pdf`,
        category: 'CODED_HSE',
      }
    }
    const label = /\bEXPERIENCIA\b/i.test(norm)
      ? 'Contrato de Trabalho (Experiência)'
      : 'Contrato de Trabalho CLT'
    const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
    const datePart = d ? ` – ${formatDateDots(d)}` : ''
    return {
      newName: `${label}${datePart} - ${collabUpper}.pdf`,
      category: 'UNCODED_EXTRA',
    }
  }

  // B7. Classificação geral para códigos do catálogo HSE (01 a 40)
  let code = CertificateClassifier.classify(origName).code
  if (!code) {
    if (/NR\s*[-–_]?\s*35|TRAB\.?\s*ALTURA|-\s*ALT\.PDF$/i.test(norm))
      code = '21'
    else if (/NR\s*[-–_]?\s*33.*SUPERVISOR/i.test(norm)) code = '28'
    else if (/NR\s*[-–_]?\s*33|VIGIA/i.test(norm)) code = '20'
    else if (/NR\s*[-–_]?\s*17|CAR\.?\s*MANUAL/i.test(norm)) code = '17'
    else if (/NR\s*[-–_]?\s*23|INCENDIO|BRIGADISTA/i.test(norm)) code = '19'
    else if (/NR\s*[-–_]?\s*18/i.test(norm)) code = '18'
    else if (/NR\s*[-–_]?\s*12/i.test(norm)) code = '15'
    else if (/NR\s*[-–_]?\s*11|TALHA/i.test(norm)) code = '14'
    else if (/SEP\b|SISTEMA\s+ELETRICO\s+DE\s+POTENCIA/i.test(norm)) code = '13'
    else if (/NR\s*[-–_]?\s*10/i.test(norm)) code = '12'
    else if (/NR\s*[-–_]?\s*0?6/i.test(norm)) code = '11'
    else if (/NR\s*[-–_]?\s*0?1|INTEGRACA?_?O/i.test(norm)) code = '10'
    else if (/DIRECA?_?O\s+(?:DEFENSIVA|PREVENTIVA)/i.test(norm)) code = '09'
    else if (/PRIMEIROS\s+SOCORROS.*GWO|GWO.*PRIMEIROS\s+SOCORROS/i.test(norm))
      code = '16'
    else if (
      /PRIMEIROS\s+SOCORROS|ATENDIMENTO\s+PRE\s+HOSPITALAR|\bAPH\b/i.test(norm)
    )
      code = '27'
    else if (/NR\s*[-–_]?\s*0?5|\bCIPA\b/i.test(norm)) code = '34'
    else if (/\bESO\b/i.test(norm)) code = '26'
    else if (/\bSIT\b/i.test(norm)) code = '25'
    else if (/\bOS\b|ORDEM\s+DE\s+SERVICO/i.test(norm)) code = '02'
    else if (/\bCNPJ\b|FICHA\s+DE\s+REGISTRO/i.test(norm)) code = '03'
    else if (/CTPSCONTRATOSDIGITAIS/i.test(norm)) code = '04'
    else if (/VACINAC(?:AO|ION)|FEBRE\s+AMAR/i.test(norm)) code = '05'
    else if (/\bSEGURO\b|APOLICE_?VIDA/i.test(norm)) code = '07'
    else if (/23_.*DECLARACAO.*CLASSE/i.test(norm)) code = '23'
    else if (/CERTIFICADO\s+DE\s+TECNICO/i.test(norm)) code = '24'
    else if (/\bADITIVO\s+DE\s+CONTRATO|CONTRATO\s+DE\s+SERVICOS/i.test(norm))
      code = '40'
  }

  if (code) {
    const isCourse = DriveNomenclatureStandardizer.isCourseOrCartaCode(code)
    const expCodes = new Set(['01', '06', '07', '08', '40', '40.1'])
    let d: Date | null = null
    if (isCourse) {
      d = resolveCourseStartDate(fileId, origName, origName, code, preCacheMap)
    } else if (expCodes.has(code)) {
      d = resolveExtraFileDate(fileId, origName, preCacheMap, true)
    } else {
      d = parseDateDmy(origName)
    }

    const stdName = DriveNomenclatureStandardizer.buildStandardFilename({
      code,
      collaboratorName: collabUpper,
      date: d,
      originalFilename: origName,
    })
    const cleanStdName = !d ? stdName.replace(' – SEM_DATA', '') : stdName
    return {
      newName: cleanStdName,
      category: 'CODED_HSE',
    }
  }

  // Fallback para os ~5 arquivos com nomes puramente genéricos ("LUCAS.pdf", "EDWARD.pdf", "4fd9dd4b...pdf")
  const d = resolveExtraFileDate(fileId, origName, preCacheMap, false)
  const datePart = d ? ` – ${formatDateDots(d)}` : ''
  const isCert = /CERTIFICADO/i.test(norm)
  const fallbackLabel = isCert
    ? 'Certificado Complementar'
    : 'Documento Complementar'
  return {
    newName: `${fallbackLabel}${datePart} - ${collabUpper}.pdf`,
    category: 'UNCODED_EXTRA',
  }
}

async function main() {
  console.log(
    '================================================================================'
  )
  console.log(
    '   PADRONIZACAO DOS ARQUIVOS RESTANTES E EXTRAS NAS PASTAS DO GOOGLE DRIVE'
  )
  console.log(
    '================================================================================\n'
  )

  const isLive =
    process.argv.includes('--execute') || process.argv.includes('--run')
  const delayArg = process.argv
    .find(a => a.startsWith('--delay='))
    ?.split('=')[1]
  const delayMs = delayArg ? parseInt(delayArg, 10) : 100

  let preCache: any[] = []
  try {
    const rawCache = execSync('git show 9e6085a:data/pdf_content_cache.json', {
      maxBuffer: 50 * 1024 * 1024,
    }).toString('utf8')
    preCache = JSON.parse(rawCache)
  } catch {
    const fallbackPath = path.join(
      process.cwd(),
      'data',
      'pdf_content_cache.json'
    )
    if (fs.existsSync(fallbackPath)) {
      preCache = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'))
    }
  }
  const preCacheMap = new Map<string, any>(preCache.map(p => [p.fileId, p]))

  const allLive: any[] = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'scratch', 'drive_all_live_pdfs.json'),
      'utf8'
    )
  )
  const execLog: any[] = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        'scratch',
        'drive_padronizacao_execution_log.json'
      ),
      'utf8'
    )
  )
  const fase2Log: any[] = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'scratch', 'drive_fase2_execution_log.json'),
      'utf8'
    )
  )
  const fase2Groups: any[] = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), 'scratch', 'fase2_merge_groups.json'),
      'utf8'
    )
  )
  const startDateLog: any = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        'scratch',
        'drive_start_date_update_log.json'
      ),
      'utf8'
    )
  )

  // Conjunto de fileIds que já foram padronizados nos lotes anteriores (exceto 04.1 – Doc 04.1 e SEM_DATA fixos)
  const fixed041Ids = new Set(
    (startDateLog.individualPlans || [])
      .filter((p: any) => p.trueCode === '04.1')
      .map((p: any) => p.fileId)
  )

  const touchedIds = new Set<string>([
    ...execLog.map((e: any) => e.fileId),
    ...execLog.filter((e: any) => e.mergedFileId).map((e: any) => e.mergedFileId),
    ...fase2Log.filter((e: any) => e.mergedFileId).map((e: any) => e.mergedFileId),
    ...fase2Groups.flatMap((g: any) => g.files.map((f: any) => f.fileId)),
  ])

  const plans: ExtraFilePlan[] = []
  // Controle de nomes dentro da mesma pasta (folderId) para evitar duplicatas exatas
  const usedNamesByFolder = new Map<string, Set<string>>()

  for (const f of allLive) {
    const folderPath: string = f.folderPath || ''
    if (/obsolet|obesoleto|0bsoleto|\/00\.|\/outros\b/i.test(folderPath)) {
      continue
    }

    const isDoc041 =
      /^04\.1\s*[-–]\s*Doc\s+04\.1/i.test(f.fileName) &&
      !fixed041Ids.has(f.fileId)
    const isFixedSemData =
      /^(02|03|04|05|23|24|30)\s*–\s*[^–]+?\s*–\s*SEM_DATA\s*-/i.test(
        f.fileName
      )

    if (touchedIds.has(f.fileId) && !isDoc041 && !isFixedSemData) {
      continue
    }

    const res = buildStandardNameForRemainingFile(
      f.fileId,
      f.fileName,
      f.collabName,
      preCacheMap
    )
    if (!res) continue

    let finalName = res.newName
    if (!usedNamesByFolder.has(f.folderId)) {
      usedNamesByFolder.set(f.folderId, new Set())
    }
    const folderSet = usedNamesByFolder.get(f.folderId)!
    if (folderSet.has(finalName)) {
      let counter = 2
      const baseWithoutExt = finalName.replace(/\.pdf$/i, '')
      while (folderSet.has(`${baseWithoutExt} (${counter}).pdf`)) {
        counter++
      }
      finalName = `${baseWithoutExt} (${counter}).pdf`
    }
    folderSet.add(finalName)

    if (finalName !== f.fileName) {
      plans.push({
        fileId: f.fileId,
        collabName: f.collabName,
        folderId: f.folderId,
        folderPath,
        oldName: f.fileName,
        newName: finalName,
        category: res.category,
      })
    }
  }

  const countUncoded = plans.filter(p => p.category === 'UNCODED_EXTRA').length
  const countCoded = plans.filter(p => p.category === 'CODED_HSE').length
  const countDoc041 = plans.filter(p => p.category === 'FIX_DOC_04_1').length
  const countCleanSemData = plans.filter(
    p => p.category === 'CLEAN_FIXED_SEM_DATA'
  ).length

  console.log('--- RESUMO DA PADRONIZACAO COMPLEMENTAR ---')
  console.log(`Total de arquivos a padronizar: ${plans.length}`)
  console.log(
    `  1. Documentos/Certificados Extras Sem Código (Passaporte, Crachá, SUS, Plano de Saúde, RG/CPF, Drone, Exames): ${countUncoded}`
  )
  console.log(
    `  2. Certificados/Cartas/Checklists com Código HSE que estavam avulsos nas pastas (20.1, 15.1, 06, 31, 32 ART-H/SART): ${countCoded}`
  )
  console.log(
    `  3. Correção de '04.1 – Doc 04.1' para 'Contrato de Trabalho CLT': ${countDoc041}`
  )
  console.log(
    `  4. Limpeza de 'SEM_DATA' em documentos cadastrais fixos (02, 03, 04, 05, 23, 24, 30): ${countCleanSemData}`
  )

  console.log('\n--- EXEMPLOS SEM CODIGO (EXTRAS) ---')
  plans
    .filter(p => p.category === 'UNCODED_EXTRA')
    .slice(0, 15)
    .forEach(p => {
      console.log(`  ANTES:  ${p.oldName}`)
      console.log(`  DEPOIS: ${p.newName}`)
    })

  console.log('\n--- EXEMPLOS COM CODIGO HSE (AVULSOS NAS PASTAS) ---')
  plans
    .filter(p => p.category === 'CODED_HSE')
    .slice(0, 15)
    .forEach(p => {
      console.log(`  ANTES:  ${p.oldName}`)
      console.log(`  DEPOIS: ${p.newName}`)
    })

  if (!isLive) {
    console.log(
      '\n[Modo Simulação] Passe --execute para aplicar as alterações no Google Drive.'
    )
    return
  }

  console.log(
    '\n[EXECUÇÃO AO VIVO] Renomeando arquivos no Google Drive...\n'
  )
  const client = await getAuthorizedClient()
  const drive = google.drive({ version: 'v3', auth: client })

  let success = 0
  let errors = 0

  for (let i = 0; i < plans.length; i++) {
    const p = plans[i]
    const progress = `[${i + 1}/${plans.length}]`
    try {
      await drive.files.update({
        fileId: p.fileId,
        requestBody: { name: p.newName },
        fields: 'id, name',
      })
      success++
      if ((i + 1) % 50 === 0 || i === plans.length - 1) {
        console.log(`${progress} OK: ${p.newName}`)
      }
      await sleep(delayMs)
    } catch (err: any) {
      errors++
      console.error(
        `${progress} ERRO em ${p.fileId} (${p.oldName}):`,
        err?.message || err
      )
    }
  }

  const outPath = path.join(
    process.cwd(),
    'scratch',
    'drive_remaining_files_log.json'
  )
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        success,
        errors,
        plans,
      },
      null,
      2
    ),
    'utf8'
  )

  console.log(
    '\n================================================================================'
  )
  console.log('   CONCLUIDO!')
  console.log(`   - Arquivos renomeados com sucesso: ${success} (Erros: ${errors})`)
  console.log(`   - Log salvo em: ${outPath}`)
  console.log(
    '================================================================================'
  )
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('standardizeRemainingDriveFiles.ts') ||
    process.argv[1].endsWith('standardizeRemainingDriveFiles.js'))
) {
  main().catch(err => {
    console.error('[StandardizeRemainingDriveFiles] Erro fatal:', err)
    process.exit(1)
  })
}
