import { Inspector } from '../models/Certificate.js'

function normalizeCpf(cpf: string): string {
  return cpf.replace(/\D/g, '')
}

/**
 * Remove acentos e caixa antes de comparar nomes. Sem isso, "JÚNIOR" (Drive, com acento) nunca
 * bate com "JUNIOR" (RPO, sem acento) — bug real encontrado em 22/08/2026 (Hamilcar Campos dos
 * Santos Júnior): a pasta dele existia no Drive com 35 certificados, mas TODOS os documentos
 * apareciam como AUSENTE porque o merge Drive×RPO falhava silenciosamente por causa do acento.
 */
function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim()
}

/**
 * Casa um inspetor com um registro externo (Storz, RPO) preferindo CPF (chave exata)
 * e caindo para substring de nome só quando o CPF não está disponível em ambos os lados.
 */
export function matchesInspector(
  inspector: Inspector,
  candidateName: string,
  candidateCpf?: string
): boolean {
  if (inspector.cpf && candidateCpf) {
    return normalizeCpf(inspector.cpf) === normalizeCpf(candidateCpf)
  }
  return normalizeName(candidateName).includes(normalizeName(inspector.name))
}

export function findInspectorMatch<T>(
  inspector: Inspector,
  candidates: T[],
  getName: (c: T) => string,
  getCpf: (c: T) => string | undefined
): T[] {
  return candidates.filter(c =>
    matchesInspector(inspector, getName(c), getCpf(c))
  )
}
