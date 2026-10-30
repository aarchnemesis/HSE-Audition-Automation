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

/**
 * DOCUMENTS: where the client approves our workers' documentation (the report's scope).
 * TRAINING: client or third-party training records. OTHER: procurement, waste manifests, etc.
 */
export type PortalCategory = 'DOCUMENTS' | 'TRAINING' | 'OTHER'

export interface PortalInfo {
  id: string
  name: string
  system: string
  url: string
  /** Hosts that identify this portal in the EHS credentials sheet */
  hosts: string[]
  category: PortalCategory
  automation: PortalAutomation
  /** Client keys, see clientKey() */
  clients: string[]
  obsolete?: boolean
  note?: string
}

function portal(
  id: string,
  name: string,
  system: string,
  hosts: string[],
  automation: PortalAutomation,
  clients: string[],
  extra: Partial<PortalInfo> = {}
): PortalInfo {
  return {
    id,
    name,
    system,
    url: hosts.length ? `https://${hosts[0]}` : '',
    hosts,
    category: 'DOCUMENTS',
    automation,
    clients,
    ...extra,
  }
}

const TRAINING = { category: 'TRAINING' } as const
const OTHER = { category: 'OTHER' } as const

// Source: "ATW_ADM_013 - Base de Dados - EHS" (Smartsheet 8847419602429828), all 108 rows
// read 2026-10-27. Credentials stay in that sheet; this catalog only knows which portal
// serves which client.
export const PORTALS: PortalInfo[] = [
  portal(
    'tdoc-sgre',
    'Siemens Gamesa (TDoc)',
    'TDoc',
    ['wplatam.tdoc.es'],
    'AUTOMATED',
    ['SGRE']
  ),
  portal(
    'veriduss-goldwind',
    'Goldwind (Veriduss)',
    'Veriduss',
    ['goldwind.veriduss.com.br'],
    'AUTOMATED',
    ['GOLDWIND']
  ),
  portal(
    'surisoft',
    'Suricatta (Surisoft)',
    'Surisoft',
    ['www.surisoft.com.br'],
    'AUTOMATED',
    ['SERENA', 'GE VERNOVA']
  ),
  portal(
    'egestiona-vestaslatam',
    'Vestas Latam (eGestiona)',
    'eGestiona',
    ['vestaslatam.egestiona.com'],
    'AUTOMATED',
    ['VESTAS CHILE', 'VESTAS ARGENTINA']
  ),
  portal(
    'metacontratas',
    'Metacontratas (CPFL, Energimp, Ibitu, NAWP Chile)',
    'Metacontratas',
    ['v4.metacontratas.com', 'hub.metadata.net', 'cloud.metacontratas.com'],
    'AUTOMATED',
    ['CPFL', 'ENERGIMP', 'IBITU', 'NAWP CHILE', 'REPSOL CHILE'],
    { note: 'Automação Playwright com evasão anti-bot e extração multi-contrato' }
  ),
  portal(
    'seyses-vestas-mx',
    'Vestas México (Seyses)',
    'Seyses',
    ['egp.seyses.com'],
    'ASSISTED_LOGIN',
    ['VESTAS MEXICO'],
    { note: 'Login pede código enviado por e-mail' }
  ),
  portal(
    'seyses-statkraft',
    'Statkraft (Seyses)',
    'Seyses',
    ['statkraft.seyses.com'],
    'ASSISTED_LOGIN',
    ['STATKRAFT'],
    { note: 'Login pede código enviado por e-mail' }
  ),
  portal(
    'tdoc-pegasus',
    'Nordex / Acciona (TDoc Pegasus)',
    'TDoc',
    ['pegasus.tdoc.es'],
    'NOT_AUTOMATED',
    ['NORDEX ACCIONA', 'NAWP', 'EDF', 'CGN'],
    { note: 'Mesmo sistema do portal Siemens Gamesa' }
  ),
  portal(
    'tdoc-acciona-chile',
    'Acciona Chile (TDoc)',
    'TDoc',
    ['acciona-chile.tdoc.es', 'auth.tdoc.es'],
    'NOT_AUTOMATED',
    ['ACCIONA CHILE'],
    { note: 'Mesmo sistema do portal Siemens Gamesa' }
  ),
  portal(
    'egestiona-goldwind',
    'Goldwind (eGestiona)',
    'eGestiona',
    ['goldwind.egestiona.com'],
    'NOT_AUTOMATED',
    ['GOLDWIND'],
    { note: 'Mesmo sistema do portal Vestas Latam' }
  ),
  portal(
    'egestiona-voltalia',
    'Voltalia (eGestiona)',
    'eGestiona',
    ['voltalia.egestiona.com'],
    'NOT_AUTOMATED',
    ['VOLTALIA'],
    { note: 'Mesmo sistema do portal Vestas Latam' }
  ),
  portal(
    'egestiona-edp',
    'EDP (eGestiona)',
    'eGestiona',
    ['edprbr.egestiona.com'],
    'NOT_AUTOMATED',
    ['EDP'],
    { note: 'Mesmo sistema do portal Vestas Latam' }
  ),
  portal(
    'sercae-vestas',
    'Vestas Brasil (Sercae One)',
    'Sercae One',
    ['brasil.sercaeone.com'],
    'NOT_AUTOMATED',
    ['VESTAS'],
    {
      note: 'Plano contratado no portal não inclui gestão individual de colaboradores',
    }
  ),
  portal(
    'tesseg-sgt',
    'Tesseg SGT (GE Vernova, Pontal)',
    'Tesseg',
    ['sgt.tesseg.com.br'],
    'NOT_AUTOMATED',
    ['GE VERNOVA', 'PONTAL']
  ),
  portal(
    'datalife',
    'Datalife (Neoenergia, Enel, GE Vernova)',
    'Datalife',
    ['appv3.datalife.global'],
    'NOT_AUTOMATED',
    ['NEOENERGIA', 'ENEL', 'GE VERNOVA']
  ),
  portal(
    'complyworks-ge',
    'GE (ComplyWorks)',
    'ComplyWorks',
    ['new.complyworks.com'],
    'NOT_AUTOMATED',
    ['GE VERNOVA']
  ),
  portal(
    'avgeo-renova',
    'Renova (AVGeo)',
    'AVGeo',
    ['sistema.avgeo.com.br'],
    'NOT_AUTOMATED',
    ['RENOVA']
  ),
  portal(
    'dgtss-invenergy',
    'Invenergy (DGTSS)',
    'DGTSS',
    ['invenergy.dgtss.com.br'],
    'NOT_AUTOMATED',
    ['INVENERGY']
  ),
  portal(
    'contractweb',
    'ContractWeb (Elera, Copel)',
    'ContractWeb',
    ['newcontract.contractweb.com.br'],
    'NOT_AUTOMATED',
    ['ELERA', 'COPEL']
  ),
  portal(
    'contractweb-auren',
    'Auren (ContractWeb Votorantim)',
    'ContractWeb',
    ['newcontract.votorantim.contractweb.com.br'],
    'NOT_AUTOMATED',
    ['AUREN'],
    {
      note: 'Um acesso por contrato (Araripe, Mandacaru, Caetés/Tucano/Alto Sertão II)',
    }
  ),
  portal(
    'wehandle-auren',
    'Auren (WeHandle)',
    'WeHandle',
    ['sistema.wehandle.com.br', 'url1449.core.wehandle.com.br'],
    'NOT_AUTOMATED',
    ['AUREN']
  ),
  portal(
    'greenlegis',
    'Casa dos Ventos (Greenlegis)',
    'Greenlegis',
    ['sistema.greenlegis.com.br'],
    'NOT_AUTOMATED',
    ['CASA DOS VENTOS']
  ),
  portal(
    'obrasoft',
    'Obrasoft (Rio Energy, Pontal)',
    'Obrasoft',
    ['www.obrasoft.com.br'],
    'NOT_AUTOMATED',
    ['RIO ENERGY', 'PONTAL']
  ),
  portal(
    'techsocial-cpfl',
    'CPFL (TechSocial)',
    'TechSocial',
    ['cpfl-sym-supply.techsocial.com.br'],
    'NOT_AUTOMATED',
    ['CPFL'],
    { note: 'Documentos trabalhistas' }
  ),
  portal(
    'montreal-alianca',
    'Aliança trabalhista (Montreal)',
    'Montreal',
    ['wwwx.montreal.com.br'],
    'NOT_AUTOMATED',
    ['ALIANCA'],
    { note: 'Documentos trabalhistas' }
  ),
  portal(
    'atlas-eletrosul',
    'Eletrosul (Atlas Facilities)',
    'Atlas',
    ['accounts.atlasfacilities.com.br', 'gestao.atlasfacilities.com.br'],
    'NOT_AUTOMATED',
    ['ELETROSUL']
  ),
  portal(
    'aestiete-aes',
    'AES (HHT)',
    'HHT',
    ['hht.aestiete.com.br'],
    'NOT_AUTOMATED',
    ['AES']
  ),
  portal(
    'senior-aeris',
    'Aeris (FAP / Senior)',
    'Senior',
    ['faponline.com.br', 'platform.senior.com.br'],
    'NOT_AUTOMATED',
    ['AERIS']
  ),
  portal(
    'tapfin-spic',
    'SPIC (TAPFIN)',
    'TAPFIN',
    ['portal.tapfin.com.br'],
    'NOT_AUTOMATED',
    ['SPIC']
  ),
  portal(
    'dokify-elawan',
    'Elawan (Dokify)',
    'Dokify',
    ['www.dokify.net'],
    'NOT_AUTOMATED',
    ['ELAWAN']
  ),
  portal(
    'adaptspro-weg',
    'WEG (Adapts Pro)',
    'Adapts Pro',
    ['ged.adaptspro.com'],
    'NOT_AUTOMATED',
    ['WEG']
  ),
  portal(
    'sertras',
    'Sertras',
    'Sertras',
    ['app.sertras.com'],
    'NOT_AUTOMATED',
    [],
    { note: 'Cliente não informado na base EHS' }
  ),
  portal(
    'smartsheet-enel',
    'Enel (Smartsheet de acompanhamento)',
    'Smartsheet',
    ['app.smartsheet.com'],
    'NOT_AUTOMATED',
    ['ENEL'],
    {
      note: 'Planilha do cliente com o status da documentação: legível pela API do Smartsheet se compartilhada com a conta da integração',
    }
  ),
  portal(
    'sg3-copel',
    'Copel (SG3)',
    'SG3',
    ['sg3.executiva.adm.br'],
    'NOT_AUTOMATED',
    ['COPEL'],
    { obsolete: true, note: 'Marcado como obsoleto na base EHS' }
  ),
  portal(
    'sharepoint-cubico',
    'Cubico (SharePoint)',
    'SharePoint',
    ['cubicoinvest.sharepoint.com'],
    'MANUAL',
    ['CUBICO']
  ),
  portal(
    'sharepoint-cubico-uy',
    'Cubico Uruguai (SharePoint)',
    'SharePoint',
    ['filemanagement.sharepoint.com'],
    'MANUAL',
    ['CUBICO URUGUAI']
  ),
  portal(
    'sharepoint-echoenergia',
    'Echoenergia (SharePoint)',
    'SharePoint',
    ['grupoequatorialenergia.sharepoint.com'],
    'MANUAL',
    ['ECHOENERGIA']
  ),
  portal(
    'sharepoint-vestas',
    'Vestas Brasil (SharePoint)',
    'SharePoint',
    ['vestas.sharepoint.com'],
    'MANUAL',
    ['VESTAS']
  ),
  portal(
    'sharepoint-nawp-peru',
    'NAWP Peru (SharePoint)',
    'SharePoint',
    ['nordex.sharepoint.com'],
    'MANUAL',
    ['NAWP PERU']
  ),
  portal(
    'sharepoint-alianca',
    'Aliança (SharePoint)',
    'SharePoint',
    ['aliancageracaodeenergia-my.sharepoint.com'],
    'MANUAL',
    ['ALIANCA']
  ),
  portal(
    'drive-links',
    'Link de Drive do cliente',
    'Google Drive',
    [],
    'MANUAL',
    ['ESSENTIA ENERGIA', 'ELERA', 'SERRA DAS VACAS', 'EUROPEAN ENERGY']
  ),
  portal(
    'storz',
    'Storz (Sistema Escudo)',
    'Storz',
    ['storz.sistemaescudo.com.br'],
    'AUTOMATED',
    [],
    { ...TRAINING, note: 'Já lido pelo pipeline HSE (matrículas e conclusões)' }
  ),
  portal(
    'winda',
    'WINDA (GWO)',
    'WINDA',
    ['winda.globalwindsafety.org'],
    'NOT_AUTOMATED',
    [],
    TRAINING
  ),
  portal(
    'sgre-training',
    'Treinamentos Siemens Gamesa',
    'SGRE Training',
    ['training.siemensgamesa.com'],
    'NOT_AUTOMATED',
    ['SGRE'],
    TRAINING
  ),
  portal(
    'ge-training',
    'GE Vernova Wind Training',
    'GE Training',
    ['gevernovawindtraining.com'],
    'NOT_AUTOMATED',
    ['GE VERNOVA'],
    TRAINING
  ),
  portal(
    'kahuna-ge',
    'GE DCP (Kahuna)',
    'Kahuna',
    ['gerenewableenergy.kahunaonline.com'],
    'NOT_AUTOMATED',
    ['GE VERNOVA'],
    { ...TRAINING, note: 'Matriz de competências da GE' }
  ),
  portal(
    'eletrobras-training',
    'Treinamentos Eletrobras',
    'Moodle',
    ['integramaistreinamentos.eletrobras.com'],
    'NOT_AUTOMATED',
    ['ELETROSUL'],
    TRAINING
  ),
  portal(
    'forms-nordex-training',
    'Nordex: treinamento obrigatório (Forms)',
    'Microsoft Forms',
    ['forms.cloud.microsoft'],
    'MANUAL',
    ['NORDEX ACCIONA'],
    TRAINING
  ),
  portal(
    'forms-sgre-training',
    'Siemens Gamesa: solicitação de treinamento (Forms)',
    'Microsoft Forms',
    ['forms.cloud.microsoft'],
    'MANUAL',
    ['SGRE'],
    TRAINING
  ),
  portal(
    'surisoft-sit',
    'Serena SGA (crachás e integração)',
    'Surisoft',
    ['sit.surisoft.com.br'],
    'NOT_AUTOMATED',
    ['SERENA'],
    OTHER
  ),
  portal(
    'ariba-vestas',
    'Vestas Ariba (compras)',
    'SAP Ariba',
    ['mu.ariba.com', 'service.ariba.com'],
    'NOT_AUTOMATED',
    ['VESTAS'],
    OTHER
  ),
  portal(
    'mtr-sinir',
    'MTR SINIR (resíduos)',
    'SINIR',
    ['mtr.sinir.gov.br'],
    'NOT_AUTOMATED',
    [],
    OTHER
  ),
  portal(
    'checklist-facil',
    'Checklist Fácil',
    'Checklist Fácil',
    ['spa.checklistfacil.com.br'],
    'NOT_AUTOMATED',
    [],
    OTHER
  ),
  portal(
    'portal-one',
    'Portal One (RC)',
    'Portal One',
    ['134.65.235.39:8050'],
    'NOT_AUTOMATED',
    [],
    { ...OTHER, note: 'Uso não identificado na base EHS' }
  ),
]

const CLIENT_ALIASES: Record<string, string> = {
  'SIEMENS GAMESA': 'SGRE',
  GAMESA: 'SGRE',
  'SGRE SIEMENS GAMESA': 'SGRE',
  'SERENA ENERGIA': 'SERENA',
  'SERENA OMEGA': 'SERENA',
  'SERENA - SGA': 'SERENA',
  'SURICATA-GE': 'GE VERNOVA',
  'GE WATER & PROCESS': 'GE VERNOVA',
  GE: 'GE VERNOVA',
  'GE-VERNOVA': 'GE VERNOVA',
  'GE - COMPLYWORKS': 'GE VERNOVA',
  'GE - DCP': 'GE VERNOVA',
  'GE TRAINING': 'GE VERNOVA',
  'NEO ENERGIA': 'NEOENERGIA',
  SALITRILLOS: 'VESTAS MEXICO',
  'VESTAS MEXICO SALITRILLOS': 'VESTAS MEXICO',
  'VESTAS LATAM': 'VESTAS CHILE',
  'VESTAS LATAM - ARGENTINA E CHILE': 'VESTAS CHILE',
  'VESTAS LATAM CHILE ADENTU': 'VESTAS CHILE',
  'VESTAS CHILE 2': 'VESTAS CHILE',
  'VESTAS BRASIL': 'VESTAS',
  'ARIBA VESTAS': 'VESTAS',
  'NAWP NORDEX': 'NAWP',
  'NAWP-PERU': 'NAWP PERU',
  NORDEX: 'NORDEX ACCIONA',
  'NORDEX-TREINAMENTO OBRIGATORIO': 'NORDEX ACCIONA',
  'PONTAL ENERGY': 'PONTAL',
  'SEMPRA ENERGY': 'SEMPRA',
  'SEMPRA INFRAESTRUCTURA': 'SEMPRA',
  'CPFL TECH SOCIAL': 'CPFL',
  'CPFL - TECHSOCIAL': 'CPFL',
  'ALIANCA -TRABALHISTA': 'ALIANCA',
  'CASA DOS VENTOS [O&M]': 'CASA DOS VENTOS',
  'CASA DOS VENTOS [CONSTRUCAO]': 'CASA DOS VENTOS',
  'ESSENTIA ENERGIA - ASA BRANCA': 'ESSENTIA ENERGIA',
  'CUBICO - URUGUAI': 'CUBICO URUGUAI',
  EUROPEAN: 'EUROPEAN ENERGY',
  'TREINAMENTOS ELETROBRAS': 'ELETROSUL',
  'PLATAFORMA DE TREINAMENTOS SGRE': 'SGRE',
  'SOLICITACAO DE TREINAMENTO- GAMESA': 'SGRE',
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

/** Live documentation channels of a client: portals and file drops, not training or obsolete. */
export function portalsForClient(key: string): PortalInfo[] {
  return PORTALS.filter(
    p => p.category === 'DOCUMENTS' && !p.obsolete && p.clients.includes(key)
  )
}

export function getPortal(id: string): PortalInfo | undefined {
  return PORTALS.find(p => p.id === id)
}
