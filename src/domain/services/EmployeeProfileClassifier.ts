export type EmployeeProfile = 'CAMPO' | 'ADMINISTRATIVO';

// Baseado nos valores reais da coluna FUNÇÃO na RPO (confirmado com o time de HSE em 21/08/2026):
//   IQ = Inspetor de Qualidade, TO = Técnico de Operações, LO = Líder Operacional,
//   IE = Inspetor de Equipamentos, CO = Coordenador de Operações (vai a campo com frequência,
//   mesmos requisitos de IQ/TO) — todos perfil CAMPO (pacote completo de documentação).
const CAMPO_FUNCAO_CODES = new Set(['IQ', 'TO', 'LO', 'IE', 'CO']);

// ADM = Administrativo, EHS = time de EHS, ENG = Engenharia, DO = Desenvolvimento
// Organizacional, DS = Diretor de Serviços (cargo descontinuado) — perfil ADMINISTRATIVO
// (documentação básica, ex.: ASO).
const ADMINISTRATIVO_FUNCAO_CODES = new Set(['ADM', 'EHS', 'ENG', 'DO', 'DS']);

// DE = Desligado — excluído da auditoria por completo, não é uma pessoa ativa.
const DESLIGADO_FUNCAO_CODES = new Set(['DE']);

/**
 * Classifica o perfil de exigência documental de um colaborador a partir do código de FUNÇÃO
 * da RPO. Retorna null para DESLIGADO (deve ser excluído do universo de auditoria).
 * Códigos desconhecidos ou em branco ("-", "*", etc.) caem em ADMINISTRATIVO por padrão — mais
 * seguro presumir o pacote básico do que presumir o pacote completo de campo sem confirmação.
 */
export function classifyEmployeeProfile(funcaoCode: string | undefined): EmployeeProfile | null {
  const code = (funcaoCode || '').trim().toUpperCase();

  if (DESLIGADO_FUNCAO_CODES.has(code)) return null;
  if (CAMPO_FUNCAO_CODES.has(code)) return 'CAMPO';
  if (ADMINISTRATIVO_FUNCAO_CODES.has(code)) return 'ADMINISTRATIVO';

  return 'ADMINISTRATIVO';
}

/**
 * Pacote de documentos exigido por perfil. CAMPO usa o mesmo catálogo dos parques (NR/GWO/Vestas);
 * ADMINISTRATIVO exige só o básico (hoje só ASO). IMPORTANTE: o AuditTriangulator só audita os
 * códigos exigidos — um treinamento extra que a pessoa faça fora do perfil (ex.: alguém do
 * administrativo que entra pra CIPA) NÃO aparece no relatório hoje, mesmo estando presente no
 * Drive/Storz/RPO, porque a auditoria itera sobre `requiredDocCodes`, não sobre "tudo que existe".
 * Se isso precisar aparecer, dá pra estender o AuditTriangulator pra incluir documentos extras
 * encontrados fora da lista de exigidos, marcados como informativos (não contam pra apto/inapto).
 */
const CAMPO_REQUIRED_DOC_CODES = ['01', '08', '12', '13', '21', '22', '25', '26', '30'];
const ADMINISTRATIVO_REQUIRED_DOC_CODES = ['01'];

export function getRequiredDocCodesForProfile(profile: EmployeeProfile): string[] {
  return profile === 'CAMPO' ? CAMPO_REQUIRED_DOC_CODES : ADMINISTRATIVO_REQUIRED_DOC_CODES;
}
