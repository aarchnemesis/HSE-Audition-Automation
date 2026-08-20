import { Inspector } from '../domain/models/Certificate.js';

export interface IRPOExporter {
  readRPOData(filePath: string): Promise<Inspector[]>;
  updateRPOData(filePath: string, inspectors: Inspector[]): Promise<boolean>;
}
