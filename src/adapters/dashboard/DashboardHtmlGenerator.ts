import { HSEDatabaseRecord } from '../../domain/services/HSEDatabaseRepository.js';

/**
 * Gera um dashboard HTML autocontido (sem dependências externas além do Google Fonts) a partir
 * do snapshot mais recente do banco HSE. Pensado para sair como artifact do GitHub Actions a
 * cada rodada do cron (não é publicado como site público — o repo é privado e os dados são
 * pessoais/sensíveis, ver decisão registrada em 24/08/2026).
 */
export function buildDashboardHtml(records: HSEDatabaseRecord[]): string {
  const dataJson = JSON.stringify(records);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Painel HSE — ArthWind</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Public+Sans:wght@400;500;600;700&display=swap">
<style>
  :root{
    color-scheme: light;
    --navy: #25386b;
    --navy-ink: #1a2952;
    --coral: #ed6f57;
    --coral-ink: #c9503a;
    --teal-tint: #deeff1;

    --surface-0: #f4f6fa;
    --surface-1: #ffffff;
    --surface-2: #eef1f7;
    --text-primary: #16213f;
    --text-secondary: #4d597a;
    --text-muted: #8590ab;
    --border: rgba(22,33,63,0.10);
    --border-strong: rgba(22,33,63,0.18);

    --good: #0ca30c;
    --warning: #b5790a;
    --serious: #c65a2e;
    --critical: #d03b3b;
    --good-bg: rgba(12,163,12,0.10);
    --warning-bg: rgba(181,121,10,0.12);
    --serious-bg: rgba(198,90,46,0.12);
    --critical-bg: rgba(208,59,59,0.10);
    --neutral-bg: rgba(77,89,122,0.10);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --navy: #5b7bc4;
      --navy-ink: #7d99d6;
      --coral: #f0876e;
      --coral-ink: #f4a58f;
      --teal-tint: #17323a;

      --surface-0: #10141f;
      --surface-1: #171c2b;
      --surface-2: #1e2436;
      --text-primary: #eef1fb;
      --text-secondary: #aab3d0;
      --text-muted: #7580a3;
      --border: rgba(238,241,251,0.10);
      --border-strong: rgba(238,241,251,0.18);

      --good: #35c65a;
      --warning: #e0a930;
      --serious: #ec835a;
      --critical: #e66767;
      --good-bg: rgba(53,198,90,0.14);
      --warning-bg: rgba(224,169,48,0.14);
      --serious-bg: rgba(236,131,90,0.14);
      --critical-bg: rgba(230,103,103,0.14);
      --neutral-bg: rgba(170,179,208,0.12);
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --navy: #5b7bc4;
    --navy-ink: #7d99d6;
    --coral: #f0876e;
    --coral-ink: #f4a58f;
    --teal-tint: #17323a;

    --surface-0: #10141f;
    --surface-1: #171c2b;
    --surface-2: #1e2436;
    --text-primary: #eef1fb;
    --text-secondary: #aab3d0;
    --text-muted: #7580a3;
    --border: rgba(238,241,251,0.10);
    --border-strong: rgba(238,241,251,0.18);

    --good: #35c65a;
    --warning: #e0a930;
    --serious: #ec835a;
    --critical: #e66767;
    --good-bg: rgba(53,198,90,0.14);
    --warning-bg: rgba(224,169,48,0.14);
    --serious-bg: rgba(236,131,90,0.14);
    --critical-bg: rgba(230,103,103,0.14);
    --neutral-bg: rgba(170,179,208,0.12);
  }

  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;}
  body{
    background: var(--surface-0);
    color: var(--text-primary);
    font-family: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  h1,h2,h3{ font-family:"Sora", system-ui, sans-serif; text-wrap: balance; margin:0; }
  table{ font-variant-numeric: tabular-nums; }

  .shell{ max-width: 1240px; margin: 0 auto; padding: 28px 24px 64px; display:flex; flex-direction:column; gap:22px; }

  .topbar{
    display:flex; align-items:center; justify-content:space-between; gap:16px;
    padding-bottom: 4px;
  }
  .brand{ display:flex; align-items:center; gap:12px; }
  .brand-mark{
    width:38px; height:38px; border-radius:10px;
    background: linear-gradient(135deg, var(--navy), var(--navy-ink));
    display:flex; align-items:center; justify-content:center;
    color:#fff; font-family:"Sora",sans-serif; font-weight:700; font-size:15px;
    flex-shrink:0;
  }
  .brand-text h1{ font-size:19px; font-weight:700; color:var(--text-primary); }
  .brand-text p{ margin:2px 0 0; font-size:12.5px; color:var(--text-muted); }
  .topbar-meta{ text-align:right; font-size:12px; color:var(--text-muted); }
  .topbar-meta strong{ color:var(--text-secondary); font-weight:600; }

  .stats{ display:grid; grid-template-columns: repeat(5, 1fr); gap:12px; }
  .stat{
    background:var(--surface-1); border:1px solid var(--border); border-radius:12px;
    padding:16px 16px 14px; display:flex; flex-direction:column; gap:6px;
    cursor:pointer; transition: border-color .12s ease, transform .12s ease;
  }
  .stat:hover{ border-color: var(--border-strong); }
  .stat.active{ border-color: var(--navy); box-shadow: inset 0 0 0 1px var(--navy); }
  .stat-label{ font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); font-weight:600; }
  .stat-value{ font-family:"Sora",sans-serif; font-size:26px; font-weight:700; font-variant-numeric: tabular-nums; }
  .stat-sub{ font-size:12px; color:var(--text-secondary); }
  .stat[data-tone="all"] .stat-value{ color:var(--text-primary); }
  .stat[data-tone="critical"] .stat-value{ color:var(--critical); }
  .stat[data-tone="serious"] .stat-value{ color:var(--serious); }
  .stat[data-tone="warning"] .stat-value{ color:var(--warning); }
  .stat[data-tone="neutral"] .stat-value{ color:var(--text-secondary); }

  .maingrid{ display:grid; grid-template-columns: minmax(0,1fr) 300px; gap:16px; align-items:start; }
  @media (max-width: 880px){ .maingrid{ grid-template-columns: 1fr; } }

  .panel{
    background:var(--surface-1); border:1px solid var(--border); border-radius:14px;
    padding:18px 20px 20px;
  }
  .panel-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
  .panel-head h2{ font-size:15px; font-weight:600; }
  .panel-head .count{ font-size:12px; color:var(--text-muted); }

  .filters{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .filters input[type="search"]{
    background:var(--surface-2); border:1px solid var(--border); border-radius:8px;
    padding:7px 10px; font-size:13px; color:var(--text-primary); font-family:inherit;
    min-width:200px;
  }
  .filters input[type="search"]::placeholder{ color:var(--text-muted); }
  .filters select{
    background:var(--surface-2); border:1px solid var(--border); border-radius:8px;
    padding:7px 10px; font-size:13px; color:var(--text-primary); font-family:inherit;
  }
  .chip-clear{
    background:none; border:1px solid var(--border-strong); border-radius:8px;
    padding:6px 10px; font-size:12px; color:var(--text-secondary); cursor:pointer; font-family:inherit;
    display:none;
  }
  .chip-clear.show{ display:inline-flex; align-items:center; gap:6px; }

  .table-wrap{ overflow-x:auto; border:1px solid var(--border); border-radius:10px; }
  table{ width:100%; border-collapse:collapse; font-size:13px; }
  thead th{
    text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em;
    color:var(--text-muted); font-weight:600; padding:10px 12px; background:var(--surface-2);
    border-bottom:1px solid var(--border); white-space:nowrap; position:sticky; top:0;
  }
  tbody td{ padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:top; }
  tbody tr:last-child td{ border-bottom:none; }
  tbody tr:hover{ background: var(--surface-2); }
  .cell-name{ font-weight:600; color:var(--text-primary); }
  .cell-sub{ font-size:11.5px; color:var(--text-muted); margin-top:1px; }
  .cell-doc{ color:var(--text-secondary); }
  .cell-detail{ color:var(--text-secondary); font-size:12.5px; }

  .badge{
    display:inline-flex; align-items:center; gap:5px; padding:3px 9px 3px 7px;
    border-radius:999px; font-size:11.5px; font-weight:600; white-space:nowrap;
  }
  .badge::before{ content:""; width:6px; height:6px; border-radius:50%; flex-shrink:0; }
  .badge.s-critical{ background:var(--critical-bg); color:var(--critical); }
  .badge.s-critical::before{ background:var(--critical); }
  .badge.s-serious{ background:var(--serious-bg); color:var(--serious); }
  .badge.s-serious::before{ background:var(--serious); }
  .badge.s-warning{ background:var(--warning-bg); color:var(--warning); }
  .badge.s-warning::before{ background:var(--warning); }
  .badge.s-good{ background:var(--good-bg); color:var(--good); }
  .badge.s-good::before{ background:var(--good); }
  .badge.s-neutral{ background:var(--neutral-bg); color:var(--text-secondary); }
  .badge.s-neutral::before{ background:var(--text-muted); }

  .empty-row td{ text-align:center; color:var(--text-muted); padding:32px 12px; }

  .side-stack{ display:flex; flex-direction:column; gap:16px; }
  .barlist{ display:flex; flex-direction:column; gap:10px; }
  .barlist-row{ display:flex; flex-direction:column; gap:4px; cursor:pointer; }
  .barlist-row .label-row{ display:flex; justify-content:space-between; font-size:12.5px; }
  .barlist-row .label-row .name{ color:var(--text-secondary); font-weight:500; }
  .barlist-row .label-row .val{ color:var(--text-primary); font-weight:600; font-variant-numeric: tabular-nums; }
  .barlist-track{ height:6px; border-radius:4px; background:var(--surface-2); overflow:hidden; }
  .barlist-fill{ height:100%; border-radius:4px; background:var(--navy); transition: width .3s ease; }
  .barlist-row.active .barlist-fill{ background: var(--coral); }
  .barlist-row.active .label-row .name{ color:var(--text-primary); }

  .legend-note{ font-size:11.5px; color:var(--text-muted); line-height:1.5; margin-top:2px; }

  footer{ text-align:center; font-size:11.5px; color:var(--text-muted); padding-top:8px; }

  @media (max-width: 720px){ .stats{ grid-template-columns: repeat(2,1fr); } }
</style>
</head>
<body>
<div class="shell viz-root">

  <div class="topbar">
    <div class="brand">
      <div class="brand-mark">AW</div>
      <div class="brand-text">
        <h1>Painel HSE — ArthWind</h1>
        <p>Documentação normativa de campo e administrativo, por colaborador</p>
      </div>
    </div>
    <div class="topbar-meta">
      Atualizado em <strong id="lastUpdated">—</strong><br>
      <span id="peopleCount">—</span> colaboradores auditados
    </div>
  </div>

  <div class="stats" id="statTiles"></div>

  <div class="maingrid">
    <div class="panel">
      <div class="panel-head">
        <h2>Pendências por documento</h2>
        <div class="filters">
          <input type="search" id="searchBox" placeholder="Buscar colaborador ou documento…">
          <select id="sectorFilter"><option value="">Todos os setores</option></select>
          <button class="chip-clear" id="clearFilter">Limpar filtro ✕</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Documento</th>
              <th>Status</th>
              <th>Detalhe</th>
            </tr>
          </thead>
          <tbody id="tableBody"></tbody>
        </table>
      </div>
      <div class="panel-head" style="margin-top:6px; margin-bottom:0;">
        <span class="count" id="rowCount"></span>
      </div>
    </div>

    <div class="side-stack">
      <div class="panel">
        <div class="panel-head"><h2>Por setor</h2></div>
        <div class="barlist" id="sectorBars"></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Por perfil</h2></div>
        <div class="barlist" id="roleBars"></div>
        <p class="legend-note">CAMPO: IQ, TO, LO, IE, CO — pacote completo de documentos.<br>ADMINISTRATIVO: ADM, EHS, ENG, DO, DS — pacote básico (ASO quando CLT).</p>
      </div>
    </div>
  </div>

  <footer>Gerado automaticamente pelo pipeline HSE a cada rodada do cron — dados pessoais, não publicar publicamente.</footer>
</div>

<script>
const RAW = ${dataJson};

const STATUS_META = {
  VENCIDO:     { tone:'critical', label:'Vencido' },
  VENCE_07:    { tone:'critical', label:'Vence em 7 dias' },
  VENCE_15:    { tone:'serious',  label:'Vence em 15 dias' },
  VENCE_30:    { tone:'serious',  label:'Vence em 30 dias' },
  VENCE_60:    { tone:'warning',  label:'Vence em 60 dias' },
  AUSENTE:     { tone:'neutral',  label:'Ausente' },
  SOLICITADO_STORZ:    { tone:'neutral', label:'Solicitado na Storz' },
  STORZ_EM_ANDAMENTO:  { tone:'neutral', label:'Em andamento na Storz' },
  INDETERMINADO:       { tone:'neutral', label:'Indeterminado' },
  CONFORME:    { tone:'good',     label:'Conforme' },
};
const PENDENCY_STATUSES = new Set(['VENCIDO','VENCE_07','VENCE_15','VENCE_30','VENCE_60','AUSENTE','SOLICITADO_STORZ','STORZ_EM_ANDAMENTO','INDETERMINADO']);

let state = { statFilter: 'all', sector: '', query: '' };

function fmtDate(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function computeStats(){
  const byStatus = {};
  for (const r of RAW) byStatus[r.statusEHS] = (byStatus[r.statusEHS]||0) + 1;
  const critical = (byStatus.VENCIDO||0) + (byStatus.VENCE_07||0);
  const serious = (byStatus.VENCE_15||0) + (byStatus.VENCE_30||0);
  const warning = byStatus.VENCE_60||0;
  const absent = byStatus.AUSENTE||0;
  return { byStatus, critical, serious, warning, absent, total: RAW.length };
}

function renderStats(){
  const s = computeStats();
  const tiles = [
    { key:'all', tone:'all', label:'Total de registros', value: s.total, sub: 'documentos auditados' },
    { key:'critical', tone:'critical', label:'Vencidos / venc. 7d', value: s.critical, sub: 'ação imediata' },
    { key:'serious', tone:'serious', label:'Vence em 15–30d', value: s.serious, sub: 'priorizar renovação' },
    { key:'warning', tone:'warning', label:'Vence em até 60d', value: s.warning, sub: 'acompanhar' },
    { key:'absent', tone:'neutral', label:'Ausentes no Drive', value: s.absent, sub: 'sem documento localizado' },
  ];
  const wrap = document.getElementById('statTiles');
  wrap.innerHTML = tiles.map(t => \`
    <div class="stat" data-tone="\${t.tone}" data-key="\${t.key}">
      <span class="stat-label">\${t.label}</span>
      <span class="stat-value">\${t.value}</span>
      <span class="stat-sub">\${t.sub}</span>
    </div>\`).join('');
  wrap.querySelectorAll('.stat').forEach(el => {
    el.addEventListener('click', () => {
      state.statFilter = state.statFilter === el.dataset.key ? 'all' : el.dataset.key;
      render();
    });
  });
}

function matchesStatFilter(r){
  const st = r.statusEHS;
  switch(state.statFilter){
    case 'critical': return st === 'VENCIDO' || st === 'VENCE_07';
    case 'serious': return st === 'VENCE_15' || st === 'VENCE_30';
    case 'warning': return st === 'VENCE_60';
    case 'absent': return st === 'AUSENTE';
    default: return true;
  }
}

function filteredRows(){
  const q = state.query.trim().toLowerCase();
  return RAW.filter(r => {
    if (!PENDENCY_STATUSES.has(r.statusEHS)) return false;
    if (!matchesStatFilter(r)) return false;
    if (state.sector && r.sector !== state.sector) return false;
    if (q && !(r.inspectorName.toLowerCase().includes(q) || (r.docName||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b) => {
    const order = ['VENCIDO','VENCE_07','VENCE_15','VENCE_30','VENCE_60','AUSENTE','STORZ_EM_ANDAMENTO','SOLICITADO_STORZ','INDETERMINADO'];
    return order.indexOf(a.statusEHS) - order.indexOf(b.statusEHS) || a.inspectorName.localeCompare(b.inspectorName);
  });
}

function renderTable(){
  const rows = filteredRows();
  const body = document.getElementById('tableBody');
  document.getElementById('rowCount').textContent = rows.length + ' pendência(s) exibida(s)';
  if (!rows.length){
    body.innerHTML = '<tr class="empty-row"><td colspan="4">Nenhuma pendência encontrada para este filtro.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const meta = STATUS_META[r.statusEHS] || { tone:'neutral', label:r.statusEHS };
    return \`<tr>
      <td>
        <div class="cell-name">\${r.inspectorName}</div>
        <div class="cell-sub">\${r.role || ''}\${r.sector ? ' · ' + r.sector : ''}</div>
      </td>
      <td class="cell-doc">\${r.docName || r.docCode}</td>
      <td><span class="badge s-\${meta.tone}">\${meta.label}</span></td>
      <td class="cell-detail">\${(r.detail||'').replace(/[🟢🟡🟠🔴🔵🟣]/g,'').trim()}</td>
    </tr>\`;
  }).join('');
}

function renderSideBars(){
  const rows = RAW.filter(r => PENDENCY_STATUSES.has(r.statusEHS) && matchesStatFilter(r));

  const bySector = {};
  for (const r of rows) bySector[r.sector || '—'] = (bySector[r.sector || '—']||0) + 1;
  const sectorEntries = Object.entries(bySector).sort((a,b) => b[1]-a[1]).slice(0, 8);
  const maxSector = Math.max(1, ...sectorEntries.map(e => e[1]));
  document.getElementById('sectorBars').innerHTML = sectorEntries.map(([name, val]) => \`
    <div class="barlist-row \${state.sector === name ? 'active' : ''}" data-sector="\${name}">
      <div class="label-row"><span class="name">\${name}</span><span class="val">\${val}</span></div>
      <div class="barlist-track"><div class="barlist-fill" style="width:\${(val/maxSector*100).toFixed(0)}%"></div></div>
    </div>\`).join('');
  document.querySelectorAll('#sectorBars .barlist-row').forEach(el => {
    el.addEventListener('click', () => {
      state.sector = state.sector === el.dataset.sector ? '' : el.dataset.sector;
      document.getElementById('sectorFilter').value = state.sector;
      render();
    });
  });

  const ROLE_PROFILE = { IQ:'CAMPO', TO:'CAMPO', LO:'CAMPO', IE:'CAMPO', CO:'CAMPO', ADM:'ADMINISTRATIVO', EHS:'ADMINISTRATIVO', ENG:'ADMINISTRATIVO', DO:'ADMINISTRATIVO', DS:'ADMINISTRATIVO' };
  const byProfile = { CAMPO: 0, ADMINISTRATIVO: 0 };
  for (const r of rows) byProfile[ROLE_PROFILE[r.role] || 'ADMINISTRATIVO']++;
  const maxProfile = Math.max(1, byProfile.CAMPO, byProfile.ADMINISTRATIVO);
  document.getElementById('roleBars').innerHTML = ['CAMPO','ADMINISTRATIVO'].map(name => \`
    <div class="barlist-row">
      <div class="label-row"><span class="name">\${name}</span><span class="val">\${byProfile[name]}</span></div>
      <div class="barlist-track"><div class="barlist-fill" style="width:\${(byProfile[name]/maxProfile*100).toFixed(0)}%"></div></div>
    </div>\`).join('');
}

function populateSectorFilter(){
  const sectors = [...new Set(RAW.map(r => r.sector).filter(Boolean))].sort();
  const sel = document.getElementById('sectorFilter');
  sel.innerHTML = '<option value="">Todos os setores</option>' + sectors.map(s => \`<option value="\${s}">\${s}</option>\`).join('');
}

function render(){
  renderStats();
  document.querySelectorAll('#statTiles .stat').forEach(el => el.classList.toggle('active', el.dataset.key === state.statFilter));
  renderTable();
  renderSideBars();
  document.getElementById('clearFilter').classList.toggle('show', state.sector !== '' || state.query !== '' || state.statFilter !== 'all');
}

document.getElementById('searchBox').addEventListener('input', e => { state.query = e.target.value; render(); });
document.getElementById('sectorFilter').addEventListener('change', e => { state.sector = e.target.value; render(); });
document.getElementById('clearFilter').addEventListener('click', () => {
  state = { statFilter:'all', sector:'', query:'' };
  document.getElementById('searchBox').value = '';
  document.getElementById('sectorFilter').value = '';
  render();
});

populateSectorFilter();
document.getElementById('peopleCount').textContent = new Set(RAW.map(r => r.inspectorName)).size;
document.getElementById('lastUpdated').textContent = RAW.length ? fmtDate(RAW[0].lastUpdated) : '—';
render();
</script>
</body>
</html>
`;
}
