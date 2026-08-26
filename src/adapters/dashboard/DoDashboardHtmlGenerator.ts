import { StorzRequest } from '../../domain/models/StorzRequest.js';
import { DOC_CATALOG_MAP } from '../../domain/services/ComplianceEngine.js';

/**
 * Dashboard separado do EHS, pensado pro time de Desenvolvimento Organizacional (analista de
 * treinamentos) — histórico completo de matrículas na Storz e controle de retestes. Público e
 * propósito diferentes do dashboard de EHS (conformidade documental), por isso é um arquivo
 * autocontido próprio, não uma aba dentro do outro. Não é publicado como site — mesmo cuidado do
 * dashboard EHS (dados pessoais, repo privado sem Pages com acesso restrito).
 */
export function buildDoDashboardHtml(requests: StorzRequest[]): string {
  const dataJson = JSON.stringify(requests);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Painel DO — Histórico de Treinamentos</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@500;600;700&family=Public+Sans:wght@400;500;600;700&display=swap">
<style>
  :root{
    color-scheme: light;
    --navy: #25386b;
    --navy-ink: #1a2952;
    --coral: #ed6f57;
    --coral-ink: #c9503a;

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

  .shell{ max-width: 1280px; margin: 0 auto; padding: 28px 24px 64px; display:flex; flex-direction:column; gap:22px; }

  .topbar{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding-bottom: 4px; }
  .brand{ display:flex; align-items:center; gap:12px; }
  .brand-mark{
    width:38px; height:38px; border-radius:10px;
    background: linear-gradient(135deg, var(--coral), var(--coral-ink));
    display:flex; align-items:center; justify-content:center;
    color:#fff; font-family:"Sora",sans-serif; font-weight:700; font-size:14px; flex-shrink:0;
  }
  .brand-text h1{ font-size:19px; font-weight:700; color:var(--text-primary); }
  .brand-text p{ margin:2px 0 0; font-size:12.5px; color:var(--text-muted); }
  .topbar-meta{ text-align:right; font-size:12px; color:var(--text-muted); }
  .topbar-meta strong{ color:var(--text-secondary); font-weight:600; }

  .stats{ display:grid; grid-template-columns: repeat(5, 1fr); gap:12px; }
  .stat{
    background:var(--surface-1); border:1px solid var(--border); border-radius:12px;
    padding:16px 16px 14px; display:flex; flex-direction:column; gap:6px;
    cursor:pointer; transition: border-color .12s ease;
  }
  .stat:hover{ border-color: var(--border-strong); }
  .stat.active{ border-color: var(--coral); box-shadow: inset 0 0 0 1px var(--coral); }
  .stat-label{ font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); font-weight:600; }
  .stat-value{ font-family:"Sora",sans-serif; font-size:26px; font-weight:700; }
  .stat-sub{ font-size:12px; color:var(--text-secondary); }
  .stat[data-tone="all"] .stat-value{ color:var(--text-primary); }
  .stat[data-tone="good"] .stat-value{ color:var(--good); }
  .stat[data-tone="critical"] .stat-value{ color:var(--critical); }
  .stat[data-tone="warning"] .stat-value{ color:var(--warning); }

  .maingrid{ display:grid; grid-template-columns: minmax(0,1fr) 320px; gap:16px; align-items:start; }
  @media (max-width: 900px){ .maingrid{ grid-template-columns: 1fr; } }

  .panel{ background:var(--surface-1); border:1px solid var(--border); border-radius:14px; padding:18px 20px 20px; }
  .panel-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
  .panel-head h2{ font-size:15px; font-weight:600; }
  .panel-head .count{ font-size:12px; color:var(--text-muted); }

  .filters{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .filters input[type="search"]{
    background:var(--surface-2); border:1px solid var(--border); border-radius:8px;
    padding:7px 10px; font-size:13px; color:var(--text-primary); font-family:inherit; min-width:220px;
  }
  .filters input[type="search"]::placeholder{ color:var(--text-muted); }
  .chip-clear{
    background:none; border:1px solid var(--border-strong); border-radius:8px;
    padding:6px 10px; font-size:12px; color:var(--text-secondary); cursor:pointer; font-family:inherit; display:none;
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

  .badge{
    display:inline-flex; align-items:center; gap:5px; padding:3px 9px 3px 7px;
    border-radius:999px; font-size:11.5px; font-weight:600; white-space:nowrap;
  }
  .badge::before{ content:""; width:6px; height:6px; border-radius:50%; flex-shrink:0; }
  .badge.s-good{ background:var(--good-bg); color:var(--good); }
  .badge.s-good::before{ background:var(--good); }
  .badge.s-critical{ background:var(--critical-bg); color:var(--critical); }
  .badge.s-critical::before{ background:var(--critical); }
  .badge.s-warning{ background:var(--warning-bg); color:var(--warning); }
  .badge.s-warning::before{ background:var(--warning); }
  .badge.s-neutral{ background:var(--neutral-bg); color:var(--text-secondary); }
  .badge.s-neutral::before{ background:var(--text-muted); }

  .empty-row td{ text-align:center; color:var(--text-muted); padding:32px 12px; }

  .side-stack{ display:flex; flex-direction:column; gap:16px; }
  .retest-item{ display:flex; flex-direction:column; gap:4px; padding:10px; border-radius:10px; background:var(--surface-2); }
  .retest-item .name{ font-weight:600; font-size:13px; }
  .retest-item .course{ font-size:12px; color:var(--text-secondary); }
  .retest-list{ display:flex; flex-direction:column; gap:8px; max-height:520px; overflow-y:auto; }

  footer{ text-align:center; font-size:11.5px; color:var(--text-muted); padding-top:8px; }

  @media (max-width: 720px){ .stats{ grid-template-columns: repeat(2,1fr); } }
</style>
</head>
<body>
<div class="shell viz-root">

  <div class="topbar">
    <div class="brand">
      <div class="brand-mark">DO</div>
      <div class="brand-text">
        <h1>Painel de Desenvolvimento Organizacional</h1>
        <p>Histórico de treinamentos e controle de retestes — dados da Storz</p>
      </div>
    </div>
    <div class="topbar-meta">
      <span id="peopleCount">—</span> colaboradores · <span id="courseCount">—</span> cursos distintos
    </div>
  </div>

  <div class="stats" id="statTiles"></div>

  <div class="maingrid">
    <div class="panel">
      <div class="panel-head">
        <h2>Histórico de matrículas</h2>
        <div class="filters">
          <input type="search" id="searchBox" placeholder="Buscar colaborador ou curso…">
          <button class="chip-clear" id="clearFilter">Limpar filtro ✕</button>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Curso</th>
              <th>Modalidade</th>
              <th>Matrícula</th>
              <th>Conclusão</th>
              <th>Situação</th>
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
        <div class="panel-head"><h2>Controle de retestes</h2></div>
        <div class="retest-list" id="retestList"></div>
      </div>
    </div>
  </div>

  <footer>Gerado a partir do histórico completo raspado da Storz — dados pessoais, não publicar publicamente.</footer>
</div>

<script>
const RAW = ${dataJson};

function classifyOutcome(situacao){
  const upper = (situacao || '').toUpperCase();
  if (upper.includes('APROVADO') || upper.includes('CONCLU')) return 'APROVADO';
  if (upper.includes('REPROVADO')) return 'REPROVADO';
  return 'PENDENTE';
}

const DOC_CATALOG = ${JSON.stringify(DOC_CATALOG_MAP)};
function courseLabel(r){
  const catalogName = DOC_CATALOG[r.trainingCode];
  return catalogName ? (r.trainingName + ' (' + catalogName + ')') : r.trainingName;
}

let state = { statFilter: 'all', query: '' };

function fmtDate(iso){
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

function computeStats(){
  const outcomes = RAW.map(r => classifyOutcome(r.rawSituacao || r.state));
  const aprovado = outcomes.filter(o => o === 'APROVADO').length;
  const reprovado = outcomes.filter(o => o === 'REPROVADO').length;
  const pendente = outcomes.filter(o => o === 'PENDENTE').length;
  return { total: RAW.length, aprovado, reprovado, pendente };
}

function groupRetests(){
  const groups = new Map();
  for (const r of RAW) {
    const key = (r.collaboratorName || '').trim().toUpperCase() + '::' + r.trainingCode;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const result = [];
  for (const reqs of groups.values()) {
    const sorted = [...reqs].sort((a,b) => new Date(a.requestDate) - new Date(b.requestDate));
    const outcomes = sorted.map(r => classifyOutcome(r.rawSituacao || r.state));
    const hasFailed = outcomes.includes('REPROVADO');
    const latest = outcomes[outcomes.length - 1];
    if (!hasFailed) continue;
    result.push({
      collaboratorName: sorted[0].collaboratorName,
      courseLabel: courseLabel(sorted[0]),
      attempts: sorted.length,
      pendingRetest: latest !== 'APROVADO',
      latest
    });
  }
  return result.sort((a,b) => (a.pendingRetest === b.pendingRetest ? 0 : a.pendingRetest ? -1 : 1) || a.collaboratorName.localeCompare(b.collaboratorName));
}

function renderStats(){
  const s = computeStats();
  const tiles = [
    { key:'all', tone:'all', label:'Total de matrículas', value: s.total, sub: 'registros raspados' },
    { key:'aprovado', tone:'good', label:'Aprovados', value: s.aprovado, sub: 'concluído com sucesso' },
    { key:'reprovado', tone:'critical', label:'Reprovados', value: s.reprovado, sub: 'candidato a reteste' },
    { key:'pendente', tone:'warning', label:'Não iniciado / em andamento', value: s.pendente, sub: 'em progresso' }
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
  if (state.statFilter === 'all') return true;
  return classifyOutcome(r.rawSituacao || r.state).toLowerCase() === state.statFilter;
}

function filteredRows(){
  const q = state.query.trim().toLowerCase();
  return RAW.filter(r => {
    if (!matchesStatFilter(r)) return false;
    if (q && !((r.collaboratorName||'').toLowerCase().includes(q) || (r.trainingName||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a,b) => (a.collaboratorName||'').localeCompare(b.collaboratorName||'') || new Date(a.requestDate) - new Date(b.requestDate));
}

function renderTable(){
  const rows = filteredRows();
  const body = document.getElementById('tableBody');
  document.getElementById('rowCount').textContent = rows.length + ' registro(s) exibido(s)';
  if (!rows.length){
    body.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhum registro encontrado para este filtro.</td></tr>';
    return;
  }
  body.innerHTML = rows.map(r => {
    const outcome = classifyOutcome(r.rawSituacao || r.state);
    const tone = outcome === 'APROVADO' ? 'good' : outcome === 'REPROVADO' ? 'critical' : 'neutral';
    return \`<tr>
      <td><div class="cell-name">\${r.collaboratorName}</div></td>
      <td>\${courseLabel(r)}</td>
      <td>\${r.modality || '—'}</td>
      <td>\${fmtDate(r.requestDate)}</td>
      <td>\${fmtDate(r.completionDate)}</td>
      <td><span class="badge s-\${tone}">\${r.rawSituacao || r.state}</span></td>
    </tr>\`;
  }).join('');
}

function renderRetests(){
  const groups = groupRetests();
  const list = document.getElementById('retestList');
  if (!groups.length) {
    list.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Nenhuma reprovação registrada.</p>';
    return;
  }
  list.innerHTML = groups.map(g => \`
    <div class="retest-item">
      <span class="name">\${g.collaboratorName}</span>
      <span class="course">\${g.courseLabel} · \${g.attempts} tentativa(s)</span>
      <span class="badge s-\${g.pendingRetest ? 'critical' : 'good'}">\${g.pendingRetest ? 'Reteste pendente' : 'Reteste aprovado'}</span>
    </div>\`).join('');
}

function render(){
  renderStats();
  document.querySelectorAll('#statTiles .stat').forEach(el => el.classList.toggle('active', el.dataset.key === state.statFilter));
  renderTable();
  renderRetests();
  document.getElementById('clearFilter').classList.toggle('show', state.query !== '' || state.statFilter !== 'all');
}

document.getElementById('searchBox').addEventListener('input', e => { state.query = e.target.value; render(); });
document.getElementById('clearFilter').addEventListener('click', () => {
  state = { statFilter: 'all', query: '' };
  document.getElementById('searchBox').value = '';
  render();
});

document.getElementById('peopleCount').textContent = new Set(RAW.map(r => r.collaboratorName)).size;
document.getElementById('courseCount').textContent = new Set(RAW.map(r => r.trainingCode)).size;
render();
</script>
</body>
</html>
`;
}
