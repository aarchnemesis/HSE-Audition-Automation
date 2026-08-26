import { Inspector } from '../models/Certificate.js';
import { classifyEmployeeProfile, getRequiredDocCodesForProfile, EmployeeProfile } from './EmployeeProfileClassifier.js';
import { matchesInspector } from './InspectorMatcher.js';

export interface RosterEntry {
  inspector: Inspector;
  profile: EmployeeProfile;
  requiredDocCodes: string[];
  hasDriveFolder: boolean;
}

/**
 * Monta o universo de pessoas a auditar a partir da RPO (fonte de quem existe — cobre campo E
 * administrativo/visibilidade, diferente do Drive que só tem pasta para quem é campo). Quando a
 * pessoa também tem pasta no Drive, os certificados de lá têm prioridade (documento de fato,
 * mais confiável que só uma data digitada na planilha) — a RPO preenche o que falta.
 * Desligados (perfil null) são excluídos do resultado.
 */
export function buildRoster(rpoInspectors: Inspector[], driveInspectors: Inspector[]): RosterEntry[] {
  const entries: RosterEntry[] = [];

  for (const rpoInspector of rpoInspectors) {
    const profile = classifyEmployeeProfile(rpoInspector.role, rpoInspector.rpoBranch);
    if (!profile) continue; // DE — desligado, fora do universo de auditoria

    const driveMatch = driveInspectors.find((d) => matchesInspector(d, rpoInspector.name));

    const mergedCertificates = new Map(rpoInspector.certificates);
    if (driveMatch) {
      for (const [code, cert] of driveMatch.certificates) {
        mergedCertificates.set(code, cert);
      }
    }

    const inspector: Inspector = {
      ...rpoInspector,
      location: driveMatch?.location,
      certificates: mergedCertificates
    };

    entries.push({
      inspector,
      profile,
      requiredDocCodes: getRequiredDocCodesForProfile(profile, rpoInspector.employmentType),
      hasDriveFolder: !!driveMatch
    });
  }

  return entries;
}
