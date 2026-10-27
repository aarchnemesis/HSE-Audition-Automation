/**
 * AUTOMATED: an extractor produces a census without human help.
 * ASSISTED_LOGIN: extraction works once a person solves the login challenge (reCAPTCHA, e-mail
 *   OTP) and the session is saved; the census goes stale when that session expires.
 * NOT_AUTOMATED: no extractor yet.
 * MANUAL: documents go to a SharePoint, Drive or form, so there is nothing to read back.
 */
export type PortalAutomation =
  | 'AUTOMATED'
  | 'ASSISTED_LOGIN'
  | 'NOT_AUTOMATED'
  | 'MANUAL'

export interface PortalInfo {
  id: string
  name: string
  system: string
  url: string
  automation: PortalAutomation
  /** Client keys, see clientKey() */
  clients: string[]
  note?: string
}

// Source: "ATW_ADM_013 - Base de Dados - EHS" (Smartsheet 8847419602429828), read 2026-10-27.
// Credentials stay in that sheet; this catalog only knows which portal serves which client.
export const PORTALS: PortalInfo[] = [
  {
    id: 'tdoc-sgre',
    name: 'Siemens Gamesa (TDoc)',
    system: 'TDoc',
    url: 'https://wplatam.tdoc.es',
    automation: 'AUTOMATED',
    clients: ['SGRE'],
  },
  {
    id: 'veriduss-goldwind',
    name: 'Goldwind (Veriduss)',
    system: 'Veriduss',
    url: 'https://goldwind.veriduss.com.br',
    automation: 'AUTOMATED',
    clients: ['GOLDWIND'],
  },
  {
    id: 'surisoft',
    name: 'Suricatta (Surisoft)',
    system: 'Surisoft',
    url: 'https://www.surisoft.com.br',
    automation: 'AUTOMATED',
    clients: ['SERENA', 'GE VERNOVA'],
  },
  {
    id: 'egestiona-vestaslatam',
    name: 'Vestas Latam (eGestiona)',
    system: 'eGestiona',
    url: 'https://vestaslatam.egestiona.com',
    automation: 'AUTOMATED',
    clients: ['VESTAS CHILE', 'VESTAS ARGENTINA'],
  },
  {
    id: 'metacontratas',
    name: 'Metacontratas (CPFL, Energimp, NAWP Chile)',
    system: 'Metacontratas',
    url: 'https://v4.metacontratas.com',
    automation: 'ASSISTED_LOGIN',
    clients: ['CPFL', 'ENERGIMP', 'IBITU', 'NAWP CHILE'],
    note: 'Login exige reCAPTCHA',
  },
  {
    id: 'seyses-vestas-mx',
    name: 'Vestas México (Seyses)',
    system: 'Seyses',
    url: 'https://egp.seyses.com',
    automation: 'ASSISTED_LOGIN',
    clients: ['VESTAS MEXICO'],
    note: 'Login pede código enviado por e-mail',
  },
  {
    id: 'seyses-statkraft',
    name: 'Statkraft (Seyses)',
    system: 'Seyses',
    url: 'https://statkraft.seyses.com',
    automation: 'ASSISTED_LOGIN',
    clients: ['STATKRAFT'],
    note: 'Login pede código enviado por e-mail',
  },
  {
    id: 'tdoc-pegasus',
    name: 'Nordex / Acciona (TDoc Pegasus)',
    system: 'TDoc',
    url: 'https://pegasus.tdoc.es',
    automation: 'NOT_AUTOMATED',
    clients: ['NORDEX ACCIONA', 'NAWP', 'EDF', 'CGN'],
  },
  {
    id: 'tdoc-acciona-chile',
    name: 'Acciona Chile (TDoc)',
    system: 'TDoc',
    url: 'https://acciona-chile.tdoc.es',
    automation: 'NOT_AUTOMATED',
    clients: ['ACCIONA CHILE'],
  },
  {
    id: 'sercae-vestas',
    name: 'Vestas Brasil (Sercae One)',
    system: 'Sercae One',
    url: 'https://brasil.sercaeone.com',
    automation: 'NOT_AUTOMATED',
    clients: ['VESTAS'],
    note: 'Plano contratado no portal não inclui gestão individual de colaboradores',
  },
  {
    id: 'tesseg-sgt',
    name: 'Tesseg SGT (GE Vernova, Pontal)',
    system: 'Tesseg',
    url: 'https://sgt.tesseg.com.br',
    automation: 'NOT_AUTOMATED',
    clients: ['GE VERNOVA', 'PONTAL'],
  },
  {
    id: 'datalife',
    name: 'Datalife (Neoenergia, Enel, GE Vernova)',
    system: 'Datalife',
    url: 'https://appv3.datalife.global',
    automation: 'NOT_AUTOMATED',
    clients: ['NEOENERGIA', 'ENEL', 'GE VERNOVA'],
  },
  {
    id: 'avgeo-renova',
    name: 'Renova (AVGeo)',
    system: 'AVGeo',
    url: 'https://sistema.avgeo.com.br',
    automation: 'NOT_AUTOMATED',
    clients: ['RENOVA'],
  },
  {
    id: 'dgtss-invenergy',
    name: 'Invenergy (DGTSS)',
    system: 'DGTSS',
    url: 'https://invenergy.dgtss.com.br',
    automation: 'NOT_AUTOMATED',
    clients: ['INVENERGY'],
  },
  {
    id: 'contractweb',
    name: 'ContractWeb (Auren, Elera, Copel)',
    system: 'ContractWeb',
    url: 'https://newcontract.contractweb.com.br',
    automation: 'NOT_AUTOMATED',
    clients: ['AUREN', 'ELERA', 'COPEL'],
  },
  {
    id: 'greenlegis',
    name: 'Casa dos Ventos (Greenlegis)',
    system: 'Greenlegis',
    url: 'https://sistema.greenlegis.com.br',
    automation: 'NOT_AUTOMATED',
    clients: ['CASA DOS VENTOS'],
  },
  {
    id: 'egestiona-voltalia',
    name: 'Voltalia (eGestiona)',
    system: 'eGestiona',
    url: 'https://voltalia.egestiona.com',
    automation: 'NOT_AUTOMATED',
    clients: ['VOLTALIA'],
  },
  {
    id: 'egestiona-edp',
    name: 'EDP (eGestiona)',
    system: 'eGestiona',
    url: 'https://edprbr.egestiona.com',
    automation: 'NOT_AUTOMATED',
    clients: ['EDP'],
  },
  {
    id: 'obrasoft',
    name: 'Obrasoft (Rio Energy, Pontal)',
    system: 'Obrasoft',
    url: 'https://www.obrasoft.com.br',
    automation: 'NOT_AUTOMATED',
    clients: ['RIO ENERGY', 'PONTAL'],
  },
  {
    id: 'sharepoint-echoenergia',
    name: 'Echoenergia (SharePoint)',
    system: 'SharePoint',
    url: 'https://grupoequatorialenergia.sharepoint.com',
    automation: 'MANUAL',
    clients: ['ECHOENERGIA'],
  },
  {
    id: 'sharepoint-nawp-peru',
    name: 'NAWP Peru (SharePoint)',
    system: 'SharePoint',
    url: 'https://nordex.sharepoint.com',
    automation: 'MANUAL',
    clients: ['NAWP PERU'],
  },
  {
    id: 'sharepoint-alianca',
    name: 'Aliança (SharePoint)',
    system: 'SharePoint',
    url: 'https://aliancageracaodeenergia-my.sharepoint.com',
    automation: 'MANUAL',
    clients: ['ALIANCA'],
  },
  {
    id: 'sharepoint-cubico',
    name: 'Cubico (SharePoint)',
    system: 'SharePoint',
    url: 'https://cubicoinvest.sharepoint.com',
    automation: 'MANUAL',
    clients: ['CUBICO'],
  },
]

const CLIENT_ALIASES: Record<string, string> = {
  'SIEMENS GAMESA': 'SGRE',
  GAMESA: 'SGRE',
  'SERENA ENERGIA': 'SERENA',
  'GE WATER & PROCESS': 'GE VERNOVA',
  GE: 'GE VERNOVA',
  'NEO ENERGIA': 'NEOENERGIA',
  'VESTAS MEXICO SALITRILLOS': 'VESTAS MEXICO',
  'VESTAS LATAM': 'VESTAS CHILE',
  'VESTAS BRASIL': 'VESTAS',
  'NAWP NORDEX': 'NAWP',
  NORDEX: 'NORDEX ACCIONA',
}

/** Uppercase, accent-free, single-spaced form of a client name, with known aliases folded in. */
export function clientKey(raw: string): string {
  const norm = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return CLIENT_ALIASES[norm] ?? norm
}

export function portalsForClient(key: string): PortalInfo[] {
  return PORTALS.filter(p => p.clients.includes(key))
}

export function getPortal(id: string): PortalInfo | undefined {
  return PORTALS.find(p => p.id === id)
}
