import { IRPOExporter } from '../../ports/IRPOExporter.js';
import { Inspector, Certificate } from '../../domain/models/Certificate.js';
import { EHSEvaluator } from '../../domain/services/EHSEvaluator.js';

/**
 * O Smartsheet devolve datas como string "YYYY-MM-DD". `new Date(string)` interpreta isso como
 * UTC meia-noite, o que em fusos negativos (Brasil, UTC-3) pode exibir/comparar como o dia
 * ANTERIOR. Construímos a data explicitamente em horário local para evitar esse off-by-one.
 */
function parseIsoDateLocal(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10));
  return isNaN(date.getTime()) ? null : date;
}

const SMARTSHEET_API_BASE = 'https://api.smartsheet.com/2.0';

// Nomes de coluna confirmados via GET /sheets/{id} na planilha real "ATW_ADM_002 - RPO - EHS"
// (Sheet ID 6682536244995972) em 20/08/2026. Mapeia coluna de DATA -> código do nosso catálogo.
// Colunas de equipamento muito específicas (Avanti Pegasus/Shark, Hailo, Power C CR4, UT, Artama)
// e procedimentos internos (Arthbot, onboarding etc.) ficam de fora por enquanto — não fazem
// parte do catálogo HSE atual.
const RPO_DATE_COLUMN_TO_CODE: Record<string, string> = {
  'ASO': '01',
  'CNH': '08',
  'GWO BST': '16',
  'GWO ART': '32',
  'DIREÇÃO DEFENSIVA': '09',
  'NR 01': '10',
  'NR 06': '11',
  'NR 07 - PS': '27',
  'NR 10': '12',
  'NR 10 SEP': '13',
  'NR 11': '14',
  'NR 12': '15',
  'NR 17': '17',
  'NR 18': '18',
  'NR 23': '19',
  'NR33 [DATA]': '20',
  'NR 33 SUP': '28',
  'NR 35': '21',
  'LOTO': '22',
  'SIT VESTAS': '25',
  'ESO VESTAS': '26',
  'ELEV. JASO': '31'
};

/** Códigos do catálogo que a planilha RPO efetivamente rastreia (ver RPO_DATE_COLUMN_TO_CODE) */
export const RPO_TRACKED_DOC_CODES = new Set(Object.values(RPO_DATE_COLUMN_TO_CODE));

// A planilha tem múltiplos ramos de nível raiz — só o ramo "RECURSOS HUMANOS" contém pessoas de
// verdade. O ramo "ARTHWIND" > "DOCUMENTOS ESCOPOS" tem linhas-folha (INSPEÇÃO INTERNA,
// AUDITORIAS etc.) que não são funcionários, mas passavam pelo filtro de cabeçalho-de-grupo por
// serem folhas — confirmado em 21/08/2026 que apareciam no relatório como "colaborador" ausente
// de ASO. Allowlist por nome de ramo raiz é mais seguro que denylist: se um ramo novo e
// desconhecido for adicionado no futuro, ele fica de fora por padrão em vez de vazar como gente.
const EMPLOYEE_ROOT_BRANCH_NAME = 'RECURSOS HUMANOS';

// A coluna FUNÇÃO não é o único (nem o mais confiável) sinal de desligamento: a planilha também
// tem um grupo hierárquico "DESLIGADOS" (dentro de RECURSOS HUMANOS) contendo gente cuja FUNÇÃO
// ainda diz um cargo ativo (ex.: "TO", "IQ") — bug de dado real encontrado em 22/08/2026 (Hamilcar
// Campos dos Santos Júnior: FUNÇÃO="TO", mas está fisicamente dentro do grupo "DESLIGADOS"). Nesse
// caso o grupo hierárquico é mais autoritativo que o texto da célula FUNÇÃO — 228 pessoas estão
// sob esse grupo, contra só 139 com FUNÇÃO="DE" literal (89 escapavam do filtro antigo).
const DESLIGADOS_BRANCH_NAME_HINT = 'DESLIGADO';

const NAME_COLUMN = 'FUNCIONARIO';
const ROLE_COLUMN = 'FUNÇÃO';
const SECTOR_COLUMN = 'SETOR';
const WINDA_COLUMN = 'WINDA';
const TIPO_COLUMN = 'TIPO';

interface SmartsheetColumn {
  id: number;
  title: string;
}

interface SmartsheetCell {
  columnId: number;
  value?: string | number | boolean;
}

interface SmartsheetRow {
  id: number;
  rowNumber: number;
  parentId?: number;
  cells: SmartsheetCell[];
}

interface SmartsheetSheetResponse {
  columns: SmartsheetColumn[];
  rows: SmartsheetRow[];
}

/**
 * Leitura SOMENTE LEITURA da planilha RPO-EHS via API do Smartsheet — nunca escreve nada de
 * volta (updateRPOData é um no-op intencional). O parâmetro `filePath` de IRPOExporter é
 * ignorado aqui; o sheetId vem do construtor/env, não é um arquivo local.
 */
export class SmartsheetRPOAdapter implements IRPOExporter {
  private apiToken: string;
  private sheetId: string;
  private refDate: Date;

  constructor(apiToken: string, sheetId: string, refDate: Date = new Date()) {
    this.apiToken = apiToken;
    this.sheetId = sheetId;
    this.refDate = refDate;
  }

  static fromEnv(refDate: Date = new Date()): SmartsheetRPOAdapter | null {
    const token = process.env.SMARTSHEET_API_TOKEN;
    const sheetId = process.env.SMARTSHEET_RPO_SHEET_ID;
    if (!token || !sheetId) return null;
    return new SmartsheetRPOAdapter(token, sheetId, refDate);
  }

  async readRPOData(_filePath?: string): Promise<Inspector[]> {
    const url = `${SMARTSHEET_API_BASE}/sheets/${this.sheetId}?includeAll=true`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${this.apiToken}` }
    });

    if (!resp.ok) {
      throw new Error(`Smartsheet API retornou ${resp.status}: ${await resp.text()}`);
    }

    const sheet: SmartsheetSheetResponse = await resp.json();
    const columnTitleById = new Map(sheet.columns.map((c) => [c.id, c.title]));

    // Linhas-pai (cabeçalho de grupo, ex.: "ARTHWIND", "RECURSOS HUMANOS", "INSP. QUALIDADE &
    // TÉC. OPERAÇÕES") não são pessoas — são só dobras de organização visual. Uma linha-pai tem
    // seu `id` referenciado como `parentId` de outras linhas.
    const groupHeaderIds = new Set(sheet.rows.map((r) => r.parentId).filter((id): id is number => id !== undefined));

    const rowById = new Map(sheet.rows.map((r) => [r.id, r]));
    const employeeRootRow = sheet.rows.find((r) => {
      const cell = r.cells.find((c) => columnTitleById.get(c.columnId) === NAME_COLUMN);
      return cell?.value === EMPLOYEE_ROOT_BRANCH_NAME;
    });

    if (!employeeRootRow) {
      console.warn(`[SmartsheetRPOAdapter] Ramo "${EMPLOYEE_ROOT_BRANCH_NAME}" não encontrado na planilha — lendo todas as linhas sem filtrar por ramo (pode incluir linhas que não são pessoas).`);
    }

    const isDescendantOf = (row: SmartsheetRow, ancestorId: number): boolean => {
      let current: SmartsheetRow | undefined = row;
      const visited = new Set<number>();
      while (current?.parentId !== undefined && !visited.has(current.id)) {
        visited.add(current.id);
        if (current.parentId === ancestorId) return true;
        current = rowById.get(current.parentId);
      }
      return false;
    };

    const isDescendantOfEmployeeRoot = (row: SmartsheetRow): boolean =>
      !employeeRootRow || isDescendantOf(row, employeeRootRow.id);

    const desligadosRow = sheet.rows.find((r) => {
      const cell = r.cells.find((c) => columnTitleById.get(c.columnId) === NAME_COLUMN);
      return typeof cell?.value === 'string' && cell.value.toUpperCase().includes(DESLIGADOS_BRANCH_NAME_HINT);
    });
    if (!desligadosRow) {
      console.warn('[SmartsheetRPOAdapter] Grupo "DESLIGADOS" não encontrado na planilha — só o filtro por FUNÇÃO="DE" será aplicado (pode deixar passar gente desligada cuja FUNÇÃO não foi atualizada).');
    }
    const isDesligadoByHierarchy = (row: SmartsheetRow): boolean =>
      !!desligadosRow && isDescendantOf(row, desligadosRow.id);

    const inspectors: Inspector[] = [];

    for (const row of sheet.rows) {
      if (groupHeaderIds.has(row.id)) continue;
      if (!isDescendantOfEmployeeRoot(row)) continue;

      const cellByTitle = new Map<string, SmartsheetCell['value']>();
      for (const cell of row.cells) {
        const title = columnTitleById.get(cell.columnId);
        if (title) cellByTitle.set(title, cell.value);
      }

      const name = cellByTitle.get(NAME_COLUMN);
      if (typeof name !== 'string' || !name.trim()) continue;

      const certificates = new Map<string, Certificate>();
      for (const [columnTitle, code] of Object.entries(RPO_DATE_COLUMN_TO_CODE)) {
        const rawValue = cellByTitle.get(columnTitle);
        if (typeof rawValue !== 'string' || rawValue === 'N/A') continue;

        const expirationDate = parseIsoDateLocal(rawValue);
        if (!expirationDate) continue;

        const evalResult = EHSEvaluator.evaluateDate(expirationDate, this.refDate);
        certificates.set(code, {
          code,
          name: columnTitle,
          expirationDate,
          statusEHS: evalResult.status,
          statusDetail: evalResult.detail
        });
      }

      // Grupo hierárquico "DESLIGADOS" vence o texto da célula FUNÇÃO — ver comentário acima.
      const role = isDesligadoByHierarchy(row) ? 'DE' : (cellByTitle.get(ROLE_COLUMN) as string) || 'INSPETOR';

      inspectors.push({
        id: `rpo_${row.rowNumber}`,
        name: name.trim(),
        role,
        employmentType: cellByTitle.get(TIPO_COLUMN) as string | undefined,
        sector: cellByTitle.get(SECTOR_COLUMN) as string | undefined,
        windaId: cellByTitle.get(WINDA_COLUMN) as string | undefined,
        certificates
      });
    }

    return inspectors;
  }

  /**
   * Intencionalmente um no-op: a auditoria RPO é SOMENTE LEITURA, nunca escreve de volta
   * na planilha (Smartsheet ou local) — só gera relatório de divergências.
   */
  async updateRPOData(_filePath: string, _inspectors: Inspector[]): Promise<boolean> {
    console.log('[SmartsheetRPOAdapter] updateRPOData chamado, mas este adapter é somente leitura — nenhuma escrita foi feita.');
    return false;
  }
}
