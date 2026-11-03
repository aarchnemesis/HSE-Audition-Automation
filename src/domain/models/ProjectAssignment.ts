/** One row of the "Briefing - Projetos" sheet: who goes to which client's wind farm, and when. */
export interface ProjectAssignment {
  wo?: string
  /** Client as written in the sheet */
  client: string
  windfarm: string
  scope?: string
  /** YYYY-MM-DD */
  startDate?: string
  /** Sheet color flag: Azul, Verde, Amarelo, Vermelho */
  status?: string
  /** Free-text team cell, names separated by commas or semicolons */
  team: string
}
