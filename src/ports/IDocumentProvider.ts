import { Inspector } from '../domain/models/Certificate.js'

export interface IDocumentProvider {
  getInspectors(filterNames?: string[]): Promise<Inspector[]>
  getInspectorById(id: string): Promise<Inspector | null>
}
