/**
 * Validador de dias permitidos para disparo de e-mails em rotinas agendadas (cron).
 * Avalia o dia da semana no fuso horário oficial da ArthWind (America/Sao_Paulo, UTC-3).
 *
 * Dias da semana (Date.prototype.getDay()):
 * 0 = Domingo
 * 1 = Segunda-feira
 * 2 = Terça-feira
 * 3 = Quarta-feira
 * 4 = Quinta-feira
 * 5 = Sexta-feira
 * 6 = Sábado
 */
export function isDayAllowedForEmail(
  allowedDaysConfig?: string,
  targetDate: Date = new Date()
): boolean {
  if (!allowedDaysConfig || allowedDaysConfig.trim() === '') {
    return true
  }

  const allowedDays = allowedDaysConfig
    .split(',')
    .map(d => parseInt(d.trim(), 10))
    .filter(n => !Number.isNaN(n))

  if (allowedDays.length === 0) {
    return true
  }

  const dateInBrt = new Date(
    targetDate.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
  )

  return allowedDays.includes(dateInBrt.getDay())
}
