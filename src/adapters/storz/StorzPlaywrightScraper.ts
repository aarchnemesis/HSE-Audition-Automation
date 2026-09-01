import { chromium, Browser, Page, Frame } from 'playwright';
import fs from 'fs';
import path from 'path';
import { StorzRequest } from '../../domain/models/StorzRequest.js';
import { ParsedDossie, parseDossieText, mapSituacaoToState, parseBrDate, classifyTrainingCode } from './dossieParser.js';

export interface StorzSelectors {
  url: string;
  loginUserSelector: string;
  loginPassSelector: string;
  loginSubmitSelector: string;
  administracaoMenuSelector: string;
  usuariosMenuItemSelector: string;
  conteudoIframeSelector: string;
  userRowSelector: string;
  userNameCellSelector: string;
  pageLinkSelector: string;
}

// Plataforma real: Sistema Escudo / Storz (storz.sistemaescudo.com.br).
//
// Fluxo confirmado navegando manualmente (com sessão logada real) em 20/08/2026:
//   1. Login: #ds_login / #ds_senha / button.button-ndt.
//   2. Nav superior tem DOIS blocos <nav> idênticos no DOM (um é um drawer mobile fora da tela);
//      só o segundo é clicável no viewport desktop — por isso usamos o seletor `:visible` do
//      Playwright em vez de depender de índice de DOM.
//   3. O conteúdo (lista de Usuários, etc.) roda dentro de um <iframe id="iframe_conteudo"
//      name="conteudo"> — não é a página principal. Precisa de page.frameLocator(...).
//   4. Dentro do iframe: linhas da tabela são <tr id="tr-<idPessoa>" data-id="<idPessoa>">,
//      paginadas (10 por página) via links <a class="page-link">. O campo de busca
//      "#search-pessoa" é um widget "nice-select-search" que NÃO responde a eventos
//      input/keyup sintéticos (testado — não dispara nenhuma chamada de rede mesmo simulando
//      digitação caractere a caractere), então paginamos e comparamos o nome em vez de buscar.
//   5. O ícone de impressora ("Dossiê do aluno") NÃO abre uma página normal — o onclick
//      (`imprimeDossie`) faz um POST via XHR para `/relatorios/dossie_do_aluno/index.php?elc=<TOKEN>`
//      com form-data `saida=VIEW&pessoa=<idPessoa>`, e abre o HTML retornado num Blob URL em nova
//      aba. Replicamos o POST diretamente (via fetch dentro da própria página, reaproveitando os
//      cookies de sessão) em vez de tentar capturar a aba/blob — mais robusto e sem popup.
//   6. O HTML retornado, convertido para texto (innerText), tem os blocos "CPF:", "Turma: ... /
//      Tipo: ...", "Situação do aluno:", "Cod. Matrícula:", "Iniciado:", "Concluído:" — exatamente
//      o formato que dossieParser.ts espera (confirmado com resposta real da API).
export const DEFAULT_STORZ_ELC = '065fd9f15ab9f040d4617ff7b49667c8';

export const DEFAULT_STORZ_SELECTORS: StorzSelectors = {
  url: process.env.STORZ_URL || `https://storz.sistemaescudo.com.br/admin/main.php?elc=${DEFAULT_STORZ_ELC}`,
  loginUserSelector: '#ds_login',           // confirmado
  loginPassSelector: '#ds_senha',           // confirmado
  loginSubmitSelector: 'button.button-ndt', // confirmado — form usa action="javascript:void(0)", precisa clicar o botão
  administracaoMenuSelector: 'nav a:has-text("Administração"):visible', // confirmado
  usuariosMenuItemSelector: 'nav a:has-text("Usuários"):visible',       // confirmado
  conteudoIframeSelector: '#iframe_conteudo',                          // confirmado
  userRowSelector: 'tr[id^="tr-"]',                                    // confirmado
  userNameCellSelector: 'td:nth-child(3)',                             // confirmado (coluna "Nome")
  pageLinkSelector: 'a.page-link'                                      // confirmado
};

const MAX_PAGES_SAFETY_CAP = 50;

export class StorzPlaywrightScraper {
  private selectors: StorzSelectors;
  private cacheFilePath: string;

  constructor(
    selectors: StorzSelectors = DEFAULT_STORZ_SELECTORS,
    cacheFilePath: string = path.join(process.cwd(), 'scratch', 'storz_cache.json')
  ) {
    this.selectors = selectors;
    this.cacheFilePath = cacheFilePath;
  }

  /**
   * Mapeamento completo da Navegação e Raspagem Web via Playwright.
   * Para cada nome em `targetCollaborators`, faz login uma vez, busca a pessoa na tela de
   * Usuários, baixa o Dossiê do Aluno (via POST direto, reaproveitando a sessão) e extrai
   * CPF + cursos/matrículas.
   */
  async runAuditScrape(options?: {
    username?: string;
    password?: string;
    targetCollaborators?: string[];
    headless?: boolean;
    maxRetries?: number;
  }): Promise<{ success: boolean; requests: StorzRequest[]; log: string[] }> {
    const logs: string[] = [];
    const log = (msg: string) => {
      console.log(`[StorzPlaywrightScraper] ${msg}`);
      logs.push(msg);
    };

    const user = options?.username || process.env.STORZ_USER;
    const pass = options?.password || process.env.STORZ_PASS;

    if (!user || !pass) {
      log('⚠️ Credenciais (STORZ_USER/STORZ_PASS) não configuradas. Retornando dados salvos no cache/mock.');
      const cachedData = this.loadCache();
      return { success: true, requests: cachedData, log: logs };
    }

    const maxRetries = options?.maxRetries ?? 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) {
        const backoffMs = 2000 * 2 ** (attempt - 2);
        log(`⏳ Tentativa ${attempt}/${maxRetries} após aguardar ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      const result = await this.attemptScrape(user, pass, options, log);
      if (result.success) return { ...result, log: logs };
      lastError = result.error;
    }

    log(`❌ Todas as ${maxRetries} tentativas falharam. Último erro: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    log('↩️ Retornando dados salvos no cache local (podem estar desatualizados).');
    const cached = this.loadCache();
    return { success: false, requests: cached, log: logs };
  }

  private async attemptScrape(
    user: string,
    pass: string,
    options: { targetCollaborators?: string[]; headless?: boolean } | undefined,
    log: (msg: string) => void
  ): Promise<{ success: boolean; requests: StorzRequest[]; error?: unknown }> {
    log(`🌐 Passo 1: Iniciando navegador Chromium (Headless: ${options?.headless ?? true})...`);
    let browser: Browser | null = null;
    const scrapedRequests: StorzRequest[] = [];

    try {
      browser = await chromium.launch({ headless: options?.headless ?? true });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      const page = await context.newPage();
      await this.login(page, user, pass, log);

      const elcToken = new URL(page.url()).searchParams.get('elc');
      if (!elcToken) {
        throw new Error('Não foi possível extrair o token "elc" da URL pós-login — necessário para chamar o Dossiê do Aluno.');
      }

      const frame = await this.goToUsuarios(page, log);

      const targets = options?.targetCollaborators ?? [];
      if (targets.length === 0) {
        log('⚠️ Nenhum targetCollaborators informado — nada a raspar (o fluxo é por pessoa, via lista de Usuários).');
      }

      const pessoaIdByName = await this.buildPessoaIdMap(frame, targets, log);

      for (const collaboratorName of targets) {
        const pessoaId = pessoaIdByName.get(collaboratorName.toUpperCase());
        if (!pessoaId) {
          log(`⚠️ Colaborador "${collaboratorName}" não encontrado na lista de Usuários (percorridas todas as páginas).`);
          continue;
        }

        const dossie = await this.fetchDossie(page, elcToken, pessoaId, log);
        if (!dossie) continue;

        for (const course of dossie.courses) {
          let trainingCode = classifyTrainingCode(course.turma);
          if (!trainingCode) {
            log(`⚠️ Não foi possível classificar o código do treinamento para: "${course.turma}". Usando '99' (não classificado).`);
            trainingCode = '99';
          }

          scrapedRequests.push({
            id: course.codMatricula || `DOSSIE-${collaboratorName}-${course.turma}`.slice(0, 60),
            collaboratorName,
            collaboratorCpf: dossie.cpf,
            trainingCode,
            trainingName: course.turma,
            modality: course.turma.toUpperCase().includes('ONLINE') ? 'ONLINE' : 'PRESENCIAL',
            requestDate: parseBrDate(course.iniciado) || new Date(),
            completionDate: parseBrDate(course.concluido),
            state: mapSituacaoToState(course.situacao),
            rawSituacao: course.situacao || undefined,
            progressPercent: course.progresso !== undefined ? parseInt(course.progresso, 10) : undefined,
            courseDurationDays: course.tempoCursoDias !== undefined ? parseInt(course.tempoCursoDias, 10) : undefined,
            notes: `Raspado via Dossiê do Aluno em ${new Date().toLocaleString('pt-BR')} — Situação original: "${course.situacao}"`
          });
        }
      }

      await browser.close();
      log(`✅ Raspagem finalizada com sucesso! Total coletado: ${scrapedRequests.length} matrícula(s)/curso(s).`);

      this.saveCache(scrapedRequests);
      return { success: true, requests: scrapedRequests };
    } catch (err: any) {
      if (browser) await browser.close();
      log(`❌ Erro no Playwright Storz Scraper: ${err.message}`);
      return { success: false, requests: [], error: err };
    }
  }

  private async login(page: Page, user: string, pass: string, log: (msg: string) => void): Promise<void> {
    let targetUrl = this.selectors.url;
    if (targetUrl.endsWith('/admin/main.php')) {
      targetUrl = targetUrl.replace('/admin/main.php', '/admin/auth/index.php');
    }
    log(`🔑 Passo 2: Acessando URL de login: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

    log('🔑 Preenchendo formulário de autenticação...');
    const userField = page.locator(`${this.selectors.loginUserSelector}, input[name="ds_login"]`).first();
    await userField.waitFor({ state: 'visible', timeout: 30000 });
    await userField.fill(user);

    const passField = page.locator(`${this.selectors.loginPassSelector}, input[name="senha"]`).first();
    await passField.fill(pass);

    // O form de login da Storz usa action="javascript:void(0)" (submit via AJAX/JS, sem
    // reload de página) — por isso aguardamos a tela de login sumir, em vez de esperar por
    // navegação tradicional.
    const submitBtn = page.locator(`${this.selectors.loginSubmitSelector}, button[type="submit"], button:has-text("Entrar")`).first();
    await submitBtn.click();

    await page.waitForSelector(this.selectors.loginUserSelector, { state: 'hidden', timeout: 15000 }).catch(() => {
      log('⚠️ Aviso: não detectei a tela de login sumir — pode ter falhado (credenciais inválidas?) ou a tela pós-login ainda não foi mapeada.');
    });

    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
      log('Aviso: Aguardou carregamento da página pós-login.');
    });

    const stillOnLoginPage = await page.$(this.selectors.loginUserSelector);
    if (stillOnLoginPage) {
      throw new Error('Login não confirmado: o campo de usuário ainda está visível após o submit. Verifique STORZ_USER/STORZ_PASS.');
    }
  }

  private async goToUsuarios(page: Page, log: (msg: string) => void): Promise<Frame> {
    log('📋 Passo 3: Navegando até Administração → Usuários...');
    await page.hover(this.selectors.administracaoMenuSelector);
    await page.click(this.selectors.usuariosMenuItemSelector, { timeout: 10000 });

    const frameElement = await page.waitForSelector(this.selectors.conteudoIframeSelector, { timeout: 15000 });
    const frame = await frameElement.contentFrame();
    if (!frame) {
      throw new Error(`Não consegui acessar o conteúdo do iframe "${this.selectors.conteudoIframeSelector}".`);
    }

    await frame.waitForSelector(this.selectors.userRowSelector, { timeout: 15000 });
    return frame;
  }

  /**
   * Percorre todas as páginas da lista de Usuários (10 por página) e monta um mapa
   * NOME_EM_MAIÚSCULO → idPessoa para os colaboradores buscados. Paginamos em vez de usar o
   * campo de busca porque o widget de busca da Storz não responde a eventos sintéticos.
   */
  private async buildPessoaIdMap(
    frame: Frame,
    targetNames: string[],
    log: (msg: string) => void
  ): Promise<Map<string, string>> {
    const targetsUpper = new Set(targetNames.map((n) => n.toUpperCase()));
    const found = new Map<string, string>();
    if (targetsUpper.size === 0) return found;

    const collectFromCurrentPage = async () => {
      const rows = await frame.$$(this.selectors.userRowSelector);
      for (const row of rows) {
        const nameCell = await row.$(this.selectors.userNameCellSelector);
        const name = nameCell ? (await nameCell.innerText()).trim().toUpperCase() : '';
        const id = await row.getAttribute('data-id');
        if (!id) continue;

        for (const target of targetsUpper) {
          if (name.includes(target) && !found.has(target)) {
            found.set(target, id);
            log(`✅ Colaborador "${target}" localizado (pessoa ${id}) na lista de Usuários.`);
          }
        }
      }
    };

    await collectFromCurrentPage();

    for (let pageNum = 2; found.size < targetsUpper.size && pageNum <= MAX_PAGES_SAFETY_CAP; pageNum++) {
      const pageLink = await frame.$(`${this.selectors.pageLinkSelector}:text-is("${pageNum}")`);
      if (!pageLink) break; // não há mais páginas

      await pageLink.click();
      await frame.waitForTimeout(900); // a paginação é via AJAX, sem evento de navegação para aguardar
      await collectFromCurrentPage();
    }

    return found;
  }

  /**
   * Replica a chamada que o botão "Dossiê do aluno" dispara (POST + parse do HTML retornado),
   * executando o fetch dentro do contexto da página para reaproveitar os cookies de sessão.
   */
  private async fetchDossie(page: Page, elcToken: string, pessoaId: string, log: (msg: string) => void): Promise<ParsedDossie | null> {
    try {
      const text = await page.evaluate(
        async ({ elcToken, pessoaId }) => {
          const fd = new FormData();
          fd.append('saida', 'VIEW');
          fd.append('pessoa', pessoaId);
          const resp = await fetch(`https://storz.sistemaescudo.com.br/relatorios/dossie_do_aluno/index.php?elc=${elcToken}`, {
            method: 'POST',
            body: fd
          });
          const html = await resp.text();
          const parsed = new DOMParser().parseFromString(html, 'text/html');
          return parsed.body.innerText;
        },
        { elcToken, pessoaId }
      );

      if (process.env.DEBUG_STORZ_RAW) {
        fs.writeFileSync(`scratch/debug_dossie_${pessoaId}.txt`, text);
      }

      return parseDossieText(text);
    } catch (err: any) {
      log(`⚠️ Falha ao buscar Dossiê do Aluno para pessoa ${pessoaId}: ${err.message}`);
      return null;
    }
  }

  private loadCache(): StorzRequest[] {
    if (fs.existsSync(this.cacheFilePath)) {
      try {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const data = JSON.parse(raw);
        return data.map((item: any) => ({
          ...item,
          requestDate: new Date(item.requestDate),
          scheduledDate: item.scheduledDate ? new Date(item.scheduledDate) : undefined,
          completionDate: item.completionDate ? new Date(item.completionDate) : undefined
        }));
      } catch (e) {
        console.warn('[StorzPlaywrightScraper] Erro ao ler cache JSON.');
      }
    }
    return [];
  }

  private saveCache(requests: StorzRequest[]): void {
    const dir = path.dirname(this.cacheFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.cacheFilePath, JSON.stringify(requests, null, 2), 'utf-8');
  }
}
