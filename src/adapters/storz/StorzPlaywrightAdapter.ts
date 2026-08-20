import fs from 'fs';
import path from 'path';
import { IStorzProvider } from '../../ports/IStorzProvider.js';
import { StorzRequest } from '../../domain/models/StorzRequest.js';
import { StorzPlaywrightScraper } from './StorzPlaywrightScraper.js';

interface CachedStorzRequest extends Omit<StorzRequest, 'requestDate' | 'scheduledDate' | 'completionDate'> {
  requestDate: string;
  scheduledDate?: string;
  completionDate?: string;
}

/**
 * Adaptador de leitura (cache local) + sincronização com a Storz.
 * A raspagem em si é delegada ao StorzPlaywrightScraper para não duplicar a lógica de
 * login/navegação/seletores em dois lugares — ver StorzPlaywrightScraper.ts para os seletores.
 */
export class StorzPlaywrightAdapter implements IStorzProvider {
  private cacheFilePath: string;
  private scraper: StorzPlaywrightScraper;

  constructor(
    cacheFilePath: string = path.join(process.cwd(), 'scratch', 'storz_cache.json'),
    scraper: StorzPlaywrightScraper = new StorzPlaywrightScraper()
  ) {
    this.cacheFilePath = cacheFilePath;
    this.scraper = scraper;
  }

  private loadCache(): StorzRequest[] {
    if (fs.existsSync(this.cacheFilePath)) {
      try {
        const raw = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const data: CachedStorzRequest[] = JSON.parse(raw);
        return data.map((item) => ({
          ...item,
          requestDate: new Date(item.requestDate),
          scheduledDate: item.scheduledDate ? new Date(item.scheduledDate) : undefined,
          completionDate: item.completionDate ? new Date(item.completionDate) : undefined
        }));
      } catch (e) {
        console.warn('[StorzPlaywrightAdapter] Falha ao ler cache da Storz, criando novo cache.');
      }
    }
    return this.getMockStorzRequests();
  }

  private saveCache(requests: StorzRequest[]): void {
    const dir = path.dirname(this.cacheFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.cacheFilePath, JSON.stringify(requests, null, 2), 'utf-8');
  }

  private getMockStorzRequests(): StorzRequest[] {
    return [
      {
        id: 'REQ-1001',
        collaboratorName: 'ADRIANO CIRILO GARCIA LIMA',
        trainingCode: '22', // LOTO
        trainingName: 'NR-10 / LOTO Bloqueio e Etiquetagem - Reciclagem',
        modality: 'PRESENCIAL',
        requestDate: new Date(2026, 7, 10),
        scheduledDate: new Date(2026, 7, 25),
        state: 'EM_ANDAMENTO',
        notes: 'Solicitação criada no portal Storz, aguardando confirmação de turma presencial.'
      },
      {
        id: 'REQ-1002',
        collaboratorName: 'ADENILÇO QUEIROZ DA SILVA',
        trainingCode: '09', // Direção Defensiva
        trainingName: 'Direção Defensiva 08h',
        modality: 'ONLINE',
        requestDate: new Date(2026, 7, 5),
        completionDate: new Date(2026, 7, 12),
        state: 'CONCLUIDO',
        notes: 'Certificado em processamento para upload.'
      }
    ];
  }

  async getAllRequests(): Promise<StorzRequest[]> {
    return this.loadCache();
  }

  async getRequestsByCollaborator(collaboratorName: string): Promise<StorzRequest[]> {
    const all = await this.getAllRequests();
    const target = collaboratorName.trim().toUpperCase();
    return all.filter((r) => r.collaboratorName.toUpperCase().includes(target));
  }

  async syncWithStorz(collaboratorNames: string[]): Promise<{ success: boolean; totalScraped: number }> {
    const result = await this.scraper.runAuditScrape({ headless: true, targetCollaborators: collaboratorNames });
    if (result.success) {
      this.saveCache(result.requests);
    }
    return { success: result.success, totalScraped: result.requests.length };
  }
}
