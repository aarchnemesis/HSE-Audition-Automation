import { ELECTIVE_DOC_CODES } from './ComplianceEngine.js';

export type EmployeeProfile = 'CAMPO' | 'ADMINISTRATIVO' | 'COORDENADOR';

// Baseado nos valores reais da coluna FUNÇÃO na RPO (confirmado com o time de HSE em 21/08/2026):
//   IQ = Inspetor de Qualidade, TO = Técnico de Operações, LO = Líder Operacional,
//   IE = Inspetor de Equipamentos — todos perfil CAMPO (pacote completo de documentação).
// CO (Coordenador) NÃO está mais aqui — ganhou perfil próprio em 25/08/2026, ver COORDENADOR_FUNCAO_CODES.
const CAMPO_FUNCAO_CODES = new Set(['IQ', 'TO', 'LO', 'IE']);

// CO = Coordenador. Confirmado pelo usuário em 25/08/2026 (caso real: João Victor Costa Campos):
// coordenador coordena, não faz a atividade de risco em si — não deveria ser cobrado o pacote
// completo de campo igual IQ/TO/LO/IE. Só ASO é obrigatório (e só se CLT); o resto do catálogo de
// treinamentos fica como MONITORAMENTO (aparece se a pessoa tiver, mas ausência não é pendência).
const COORDENADOR_FUNCAO_CODES = new Set(['CO']);

// ADM = Administrativo, EHS = time de EHS, ENG = Engenharia, DO = Desenvolvimento
// Organizacional, DS = Diretor de Serviços (cargo descontinuado) — perfil ADMINISTRATIVO
// (documentação básica, ex.: ASO).
const ADMINISTRATIVO_FUNCAO_CODES = new Set(['ADM', 'EHS', 'ENG', 'DO', 'DS']);

// DE = Desligado — excluído da auditoria por completo, não é uma pessoa ativa.
const DESLIGADO_FUNCAO_CODES = new Set(['DE']);

/**
 * Ramos da hierarquia da RPO (dentro de "RECURSOS HUMANOS") que são homogêneos o suficiente pra
 * decidir o perfil sozinhos, sem depender do texto da coluna FUNÇÃO — confirmado em 25/08/2026
 * conferindo a composição real de cada ramo (100% do mesmo código FUNÇÃO em cada um destes).
 * "LÍDERES / EHS" fica de fora de propósito: é um ramo MISTO (LO, CO, DO, ADM, EHS convivem ali),
 * então usar hierarquia ali destruiria a distinção que a FUNÇÃO já faz corretamente — pra esse
 * ramo (e pra quem não tem `rpoBranch`, ex.: inspetor só do Drive) cai no fallback por FUNÇÃO.
 */
const BRANCH_TO_PROFILE: Record<string, 'CAMPO' | 'ADMINISTRATIVO'> = {
  'INSP. QUALIDADE & TÉC. OPERAÇÕES': 'CAMPO',
  'DRONE INSP. EQUIPAMENTO': 'CAMPO',
  'LPS - SPDA': 'CAMPO',
  ENGENHARIA: 'ADMINISTRATIVO',
  ADMINISTRATIVO: 'ADMINISTRATIVO',
  VISIBILIDADE: 'ADMINISTRATIVO'
};

/**
 * Escopo do relatório de EHS a partir de 27/08/2026 (pedido do usuário: "a questão de
 * treinamentos vai ficar exclusivamente pras pessoas de campo, então no Drive" — líderes/EHS,
 * inspetores/técnicos, piloto de drone e SPA-LPS). ADMINISTRATIVO, VISIBILIDADE e ENGENHARIA
 * saem do relatório de EHS por completo (não é redução de exigência, é redução de quem aparece).
 * "LÍDERES / EHS" entra inteiro, mesmo sendo um ramo misto de FUNÇÃO (confirmado pelo usuário:
 * todo mundo desse ramo conta como campo pra esse escopo, independente do código FUNÇÃO).
 */
export const EHS_TRAINING_SCOPE_BRANCHES = [
  'INSP. QUALIDADE & TÉC. OPERAÇÕES',
  'LÍDERES / EHS',
  'DRONE INSP. EQUIPAMENTO',
  'LPS - SPDA'
];

/**
 * Classifica o perfil de exigência documental de um colaborador. Prioridade:
 *   1. FUNÇÃO=DE (desligado) — sempre exclui, independente de ramo.
 *   2. FUNÇÃO=CO (coordenador) — perfil próprio, independente de ramo (coordenador pode estar em
 *      qualquer lugar da árvore, ex.: hoje está dentro de "LÍDERES / EHS").
 *   3. Ramo da RPO, quando é um dos homogêneos em BRANCH_TO_PROFILE — mais confiável que FUNÇÃO
 *      porque não fica desatualizado (mesmo problema que já vimos com DESLIGADOS).
 *   4. Fallback por código de FUNÇÃO — usado pra ramos mistos (LÍDERES / EHS) e pra quem não tem
 *      `rpoBranch` (inspetor que só existe no Drive). Desconhecido/em branco cai em ADMINISTRATIVO
 *      por padrão — mais seguro presumir o pacote básico do que o completo sem confirmação.
 */
export function classifyEmployeeProfile(funcaoCode: string | undefined, rpoBranch?: string): EmployeeProfile | null {
  const code = (funcaoCode || '').trim().toUpperCase();

  if (DESLIGADO_FUNCAO_CODES.has(code)) return null;
  if (COORDENADOR_FUNCAO_CODES.has(code)) return 'COORDENADOR';

  const branchProfile = rpoBranch ? BRANCH_TO_PROFILE[rpoBranch] : undefined;
  if (branchProfile) return branchProfile;

  if (CAMPO_FUNCAO_CODES.has(code)) return 'CAMPO';
  if (ADMINISTRATIVO_FUNCAO_CODES.has(code)) return 'ADMINISTRATIVO';

  return 'ADMINISTRATIVO';
}

/**
 * Pacote de documentos exigido por perfil. CAMPO usa o mesmo catálogo dos parques (NR/GWO/Vestas);
 * ADMINISTRATIVO exige só o básico (hoje só ASO, mais CIPA pra quem for membro eleito);
 * COORDENADOR exige só ASO, com o resto do catálogo de campo como monitoramento (ver
 * getElectiveDocCodesForProfile). IMPORTANTE: o AuditTriangulator só audita os códigos exigidos —
 * um treinamento extra que a pessoa faça fora dessa lista NÃO aparece no relatório, mesmo estando
 * presente no Drive/Storz/RPO, porque a auditoria itera sobre `requiredDocCodes`, não sobre "tudo
 * que existe". É por isso que os documentos ELETIVOS (Vestas, Elevador JASO, CIPA, e pra
 * COORDENADOR o catálogo de treinamentos inteiro) precisam estar nessa lista mesmo não sendo
 * obrigatórios pra todo mundo — sem isso, mesmo quem TEM o documento nunca apareceria em relatório
 * nenhum.
 */
// GWO não é um treinamento único — o catálogo tem 6 variações (16, 17, 19, 21, 30, 32).
// Faltavam 4 delas aqui antes (só 21 e 30 estavam na lista), por isso só "GWO WINDA ID"
// aparecia nos relatórios — corrigido em 21/08/2026.
// '31' (Elevador JASO) e '34' (CIPA) adicionados em 25/08/2026 como eletivos — exigência de
// parque/comissão, não do perfil, mas quem tem precisa ter a validade monitorada.
const CAMPO_REQUIRED_DOC_CODES = ['01', '08', '12', '13', '16', '17', '19', '21', '22', '25', '26', '30', '31', '32', '34'];
const ADMINISTRATIVO_REQUIRED_DOC_CODES = ['01', '34'];

// Coordenador: só ASO é de fato exigido. O resto do pacote de campo (mesmos códigos do perfil
// CAMPO, exceto ASO) entra como monitoramento — ver getElectiveDocCodesForProfile, que marca
// todos esses códigos como eletivos pra esse perfil específico.
const COORDENADOR_REQUIRED_DOC_CODES = CAMPO_REQUIRED_DOC_CODES;
const COORDENADOR_MONITORED_ONLY_CODES = CAMPO_REQUIRED_DOC_CODES.filter((c) => c !== '01');

/**
 * ASO não é sobre vínculo empregatício, é sobre EXPOSIÇÃO A RISCO. Confirmado com o time de HSE
 * em 22/08/2026: perfil CAMPO exige ASO independente de ser CLT ou PJ (a atividade no parque
 * eólico é o motivo, não o vínculo). Perfil ADMINISTRATIVO CLT ainda precisa (obrigação legal da
 * CLT, NR-07, vale pra qualquer função). Mas ADMINISTRATIVO + PJ não tem nenhum dos dois motivos
 * (nem risco de campo, nem vínculo CLT) — não deveria ser cobrado.
 *
 * COORDENADOR: confirmado pelo usuário em 25/08/2026 que, diferente de CAMPO, o coordenador NÃO
 * tem a mesma exposição a risco (coordena, não executa a atividade) — então PJ+COORDENADOR não
 * tem nenhum motivo pra ser cobrado nada, nem ASO.
 */
export function getRequiredDocCodesForProfile(profile: EmployeeProfile, employmentType?: string): string[] {
  const isPJ = (employmentType || '').trim().toUpperCase() === 'PJ';

  // Contrato PJ (40) só se aplica a quem é PJ de verdade — CLT não tem esse documento. Confirmado
  // pelo usuário em 27/08/2026: quer saber quando termina o prazo do contrato/aditivo dos pilotos PJ.
  if (profile === 'CAMPO') return isPJ ? [...CAMPO_REQUIRED_DOC_CODES, '40'] : CAMPO_REQUIRED_DOC_CODES;
  if (profile === 'COORDENADOR') return isPJ ? [] : COORDENADOR_REQUIRED_DOC_CODES;

  return isPJ ? [] : ADMINISTRATIVO_REQUIRED_DOC_CODES;
}

/**
 * Códigos de `requiredDocCodes` que devem ser tratados como MONITORAMENTO (aparecem quando a
 * pessoa tem, mas ausência não vira pendência) — ver ParkRequirement.electiveDocCodes e o uso em
 * AuditTriangulator.ts. Perfis CAMPO/ADMINISTRATIVO usam o conjunto global ELECTIVE_DOC_CODES
 * (Vestas, Elevador, CIPA). COORDENADOR usa um conjunto próprio: todo o catálogo de treinamentos
 * de campo é monitoramento pra esse perfil, só ASO é de fato exigido.
 */
export function getElectiveDocCodesForProfile(profile: EmployeeProfile): string[] {
  if (profile === 'COORDENADOR') return COORDENADOR_MONITORED_ONLY_CODES;
  return Array.from(ELECTIVE_DOC_CODES);
}
