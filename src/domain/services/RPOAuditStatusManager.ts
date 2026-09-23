import fs from 'fs'
import path from 'path'

export class RPOAuditStatusManager {
  private static defaultDataPath = path.join(process.cwd(), 'data', 'rpo_audit_status.json')
  private static defaultScratchPath = path.join(process.cwd(), 'scratch', 'rpo_audit_status.json')

  /**
   * Lista padrão de colaboradores com RPO validado manualmente pela equipe
   * (conferidos um a um com fundo branco no Smartsheet/Excel).
   */
  private static defaultValidatedNames = new Set([
    'JOSÉ MARCELO MAGALHÃES SOUSA',
    'ADENILÇO QUEIROZ DA SILVA',
    'ANTONIO ROBERTO DOS SANTOS NASCIMENTO',
    'CAIO FELIPE RIBEIRO RODRIGUES',
    'EDWARD THIAGO HERCULANO RIBEIRO',
    'ELIAS DOS SANTOS RODRIGUES',
    'FELIPE DOS SANTOS CASTRO',
    'JOSE MARCOS LIMA DE MOURA',
    'LEANDRO CAMILO DE JESUS',
    'LUCAS ANDRE DE SOUSA RIBEIRO',
    'MARIA BRUNA SOARES SANTOS',
    'MICHEL PLATINI SOARES BARROS',
    'NYLLYS RODRIGUES MARTINS',
    'PEDRO EDUARDO DE OLIVEIRA CAVALCANTI SILVA',
    'THAYNA NOGUEIRA TAVARES',
    'ALISON DOS SANTOS RIBEIRO',
    'ANTONIO CARLOS PEREIRA',
    'DANIEL FERNANDES PACHECO',
    'LUIS GUSTAVO ROSA DA SILVA',
    'NARDEL DELON NOVAIS ROCHA',
    'LUCAS MAGNO DE SOUSA',
    'ROSA MARIA BATISTA DE LIMA',
    'RAMON RAMIRES COSTA CIRINO',
    'MASSUDE MADRE  DE DEUS AFONSO',
    'ALLAN THIAGO RAMOS VEIGA',
    'DIEGO PATRICK SANCHES CAMPOS',
    'FRANCISCO MARCOS DE SOUZA MAGALHÃES',
    'ITALO DE ABREU DUARTE',
    'LEONARDO SIMON COSTA GAEM'
  ])

  static loadAuditStatusMap(): Map<string, 'VALIDADO' | 'PENDENTE_REVISAO'> {
    const map = new Map<string, 'VALIDADO' | 'PENDENTE_REVISAO'>()

    // Preenche com os defaults validados
    for (const name of this.defaultValidatedNames) {
      map.set(name.trim().toUpperCase(), 'VALIDADO')
    }

    const candidates = [this.defaultDataPath, this.defaultScratchPath]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
          if (typeof raw === 'object' && raw !== null) {
            for (const [k, v] of Object.entries(raw)) {
              if (v === 'VALIDADO' || v === 'PENDENTE_REVISAO') {
                map.set(k.trim().toUpperCase(), v)
              }
            }
          }
        } catch (err) {
          console.warn(`[RPOAuditStatusManager] Erro ao ler status de ${p}:`, err)
        }
      }
    }

    return map
  }

  static saveAuditStatusMap(map: Map<string, 'VALIDADO' | 'PENDENTE_REVISAO'>): void {
    const obj: Record<string, string> = {}
    for (const [k, v] of map.entries()) {
      obj[k] = v
    }
    const json = JSON.stringify(obj, null, 2)

    for (const filePath of [this.defaultDataPath, this.defaultScratchPath]) {
      try {
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(filePath, json, 'utf-8')
      } catch (err) {
        console.warn(`[RPOAuditStatusManager] Erro ao salvar status em ${filePath}:`, err)
      }
    }
  }

  static isCollabValidated(name: string): boolean {
    const norm = (name || '').trim().toUpperCase()
    const map = this.loadAuditStatusMap()
    return map.get(norm) === 'VALIDADO'
  }
}
