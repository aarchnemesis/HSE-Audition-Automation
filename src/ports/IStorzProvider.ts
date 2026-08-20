import { StorzRequest } from '../domain/models/StorzRequest.js';

export interface IStorzProvider {
  getAllRequests(): Promise<StorzRequest[]>;
  getRequestsByCollaborator(collaboratorName: string): Promise<StorzRequest[]>;
  syncWithStorz(collaboratorNames: string[]): Promise<{ success: boolean; totalScraped: number }>;
}
