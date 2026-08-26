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
 * ADMINISTRATIVO exige só o básico (hoje só ASO, mais CIPA pra quem for membro eleito). IMPORTANTE:
 * o AuditTriangulator só audita os códigos exigidos — um treinamento extra que a pessoa faça fora
 * dessa lista NÃO aparece no relatório, mesmo estando presente no Drive/Storz/RPO, porque a
 * auditoria itera sobre `requiredDocCodes`, não sobre "tudo que existe". É por isso que os
 * documentos ELETIVOS (ver ELECTIVE_DOC_CODES em ComplianceEngine.ts: Vestas, Elevador JASO, CIPA)
 * precisam estar nessa lista mesmo não sendo obrigatórios pra todo mundo — sem isso, mesmo quem
 * TEM o documento nunca apareceria em relatório nenhum.
 */
// GWO não é um treinamento único — o catálogo tem 6 variações (16, 17, 19, 21, 30, 32).
// Faltavam 4 delas aqui antes (só 21 e 30 estavam na lista), por isso só "GWO WINDA ID"
// aparecia nos relatórios — corrigido em 21/08/2026.
// '31' (Elevador JASO) e '34' (CIPA) adicionados em 25/08/2026 como eletivos — exigência de
// parque/comissão, não do perfil, mas quem tem precisa ter a validade monitorada.
const CAMPO_REQUIRED_DOC_CODES = ['01', '08', '12', '13', '16', '17', '19', '21', '22', '25', '26', '30', '31', '32', '34'];
const ADMINISTRATIVO_REQUIRED_DOC_CODES = ['01', '34'];

/**
 * ASO não é sobre vínculo empregatício, é sobre EXPOSIÇÃO A RISCO. Confirmado com o time de HSE
 * em 22/08/2026: perfil CAMPO exige ASO independente de ser CLT ou PJ (a atividade no parque
 * eólico é o motivo, não o vínculo). Perfil ADMINISTRATIVO CLT ainda precisa (obrigação legal da
 * CLT, NR-07, vale pra qualquer função). Mas ADMINISTRATIVO + PJ não tem nenhum dos dois motivos
 * (nem risco de campo, nem vínculo CLT) — não deveria ser cobrado.
 */
export function getRequiredDocCodesForProfile(profile: EmployeeProfile, employmentType?: string): string[] {
  if (profile === 'CAMPO') return CAMPO_REQUIRED_DOC_CODES;

  const isPJ = (employmentType || '').trim().toUpperCase() === 'PJ';
  return isPJ ? [] : ADMINISTRATIVO_REQUIRED_DOC_CODES;
}
