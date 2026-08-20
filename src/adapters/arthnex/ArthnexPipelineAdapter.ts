import { IDocumentProvider } from '../../ports/IDocumentProvider.js';
import { Inspector } from '../../domain/models/Certificate.js';

export interface ArthnexConfig {
  endpoint: string;
  authToken?: string;
}

export class ArthnexPipelineAdapter implements IDocumentProvider {
  private config: ArthnexConfig;

  constructor(config: ArthnexConfig) {
    this.config = config;
  }

  async getInspectors(): Promise<Inspector[]> {
    console.log(`[ArthnexPipelineAdapter] Ponto de acoplamento preparado para o pipeline Arthnex (${this.config.endpoint}).`);
    return [];
  }

  async getInspectorById(id: string): Promise<Inspector | null> {
    return null;
  }
}
