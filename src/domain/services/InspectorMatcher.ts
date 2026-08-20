import { Inspector } from '../models/Certificate.js';

function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '');
}

/**
 * Casa um inspetor com um registro externo (Storz, RPO) preferindo CPF (chave exata)
 * e caindo para substring de nome só quando o CPF não está disponível em ambos os lados.
 */
export function matchesInspector(inspector: Inspector, candidateName: string, candidateCpf?: string): boolean {
  if (inspector.cpf && candidateCpf) {
    return normalizeCpf(inspector.cpf) === normalizeCpf(candidateCpf);
  }
  return candidateName.toUpperCase().includes(inspector.name.toUpperCase());
}

export function findInspectorMatch<T>(
  inspector: Inspector,
  candidates: T[],
  getName: (c: T) => string,
  getCpf: (c: T) => string | undefined
): T[] {
  return candidates.filter((c) => matchesInspector(inspector, getName(c), getCpf(c)));
}
