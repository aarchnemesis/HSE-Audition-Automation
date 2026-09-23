import { Inspector } from '../models/Certificate.js'
import {
  EmployeeProfile,
  classifyEmployeeProfile,
  getRequiredDocCodesForProfile,
} from './EmployeeProfileClassifier.js'
import { matchesInspector } from './InspectorMatcher.js'
import { RPOAuditStatusManager } from './RPOAuditStatusManager.js'

export interface RosterEntry {
  inspector: Inspector
  profile: EmployeeProfile
  requiredDocCodes: string[]
  hasDriveFolder: boolean
}

/**
 * Monta o universo de pessoas a auditar a partir da RPO (fonte de quem existe — cobre campo E
 * administrativo/visibilidade, diferente do Drive que só tem pasta para quem é campo). Quando a
 * pessoa também tem pasta no Drive, os certificados de lá têm prioridade (documento de fato,
 * mais confiável que só uma data digitada na planilha) — a RPO preenche o que falta.
 * Quando o colaborador tem status VALIDADO na RPO (auditado manualmente pela equipe) e o RPO
 * possui data de validade mais recente que o arquivo antigo do Drive, a data do RPO tem precedência.
 * Desligados (perfil null) são excluídos do resultado.
 */
export function buildRoster(
  rpoInspectors: Inspector[],
  driveInspectors: Inspector[]
): RosterEntry[] {
  const entries: RosterEntry[] = []

  for (const rpoInspector of rpoInspectors) {
    const profile = classifyEmployeeProfile(
      rpoInspector.role,
      rpoInspector.rpoBranch
    )
    if (!profile) continue // DE — desligado, fora do universo de auditoria

    const driveMatch = driveInspectors.find(d =>
      matchesInspector(d, rpoInspector.name)
    )

    const auditStatus =
      rpoInspector.rpoAuditStatus ||
      (RPOAuditStatusManager.isCollabValidated(rpoInspector.name)
        ? 'VALIDADO'
        : 'PENDENTE_REVISAO')

    const mergedCertificates = new Map(rpoInspector.certificates)
    if (driveMatch) {
      for (const [code, driveCert] of driveMatch.certificates) {
        const rpoCert = rpoInspector.certificates.get(code)
        const isRpoValidated = auditStatus === 'VALIDADO'
        const isRpoNewer = Boolean(
          rpoCert &&
            rpoCert.expirationDate &&
            (!driveCert.expirationDate ||
              rpoCert.expirationDate.getTime() > driveCert.expirationDate.getTime())
        )

        if (isRpoValidated && isRpoNewer) {
          mergedCertificates.set(code, {
            ...rpoCert!,
            statusDetail: `${rpoCert!.statusDetail || ''} (Validado no RPO | Comprovante pendente no Drive)`,
          })
        } else {
          mergedCertificates.set(code, driveCert)
        }
      }
    }

    // Aditivo ao Contrato (40.1) substitui o prazo do Contrato original (40) quando existe —
    // pedido do usuário em 27/08/2026: "quando termina o prazo do contrato caso só tenha o
    // contrato, e quando acaba o aditivo caso tenha o contrato e o aditivo". Mantém o código '40'
    // (é o que requiredDocCodes cobra) mas com a data/detalhe do aditivo, que é sempre a mais
    // recente/válida das duas.
    const aditivo = mergedCertificates.get('40.1')
    if (aditivo) {
      mergedCertificates.set('40', { ...aditivo, code: '40' })
    }

    const inspector: Inspector = {
      ...rpoInspector,
      rpoAuditStatus: auditStatus,
      location: driveMatch?.location,
      certificates: mergedCertificates,
    }

    const baseRequiredCodes = getRequiredDocCodesForProfile(
      profile,
      rpoInspector.employmentType
    )
    // Documentos marcados como N/A no RPO são isentos para aquele colaborador individualmente
    const exemptSet = new Set(rpoInspector.exemptDocCodes || [])
    const requiredDocCodes = baseRequiredCodes.filter(c => !exemptSet.has(c))

    entries.push({
      inspector,
      profile,
      requiredDocCodes,
      hasDriveFolder: !!driveMatch,
    })
  }

  return entries
}
