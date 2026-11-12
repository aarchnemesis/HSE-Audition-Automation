import { PortalsDashboardData } from '../../domain/services/PortalsDashboardData.js'

/**
 * "Portais de Clientes" tab for the HSE dashboard. Kept out of DashboardHtmlGenerator (a 6k-line
 * template) and spliced in at four points: CSS, nav pill, view markup and script.
 *
 * Everything below is String.raw so backslashes reach the browser untouched. Rules for the client
 * script: no backticks and no dollar-brace sequences (it lives inside the generator's own template
 * literal), and every string that came from a portal goes through ptEsc() before innerHTML.
 */

export const PORTALS_TAB_PILL = String.raw`<span class="pill-opt" onclick="switchNav('portais')"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>Portais <span class="storz-badge-pill" id="ptBadgeTab" style="background:#DC2626;display:none;">0</span></span>`

export const PORTALS_TAB_CSS = String.raw`
    /* ===== Portais de Clientes ===== */
    .pt-wrap { padding: 16px 20px 32px; overflow: auto; flex: 1; min-height: 0; }
    .pt-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    .pt-kpi { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 12px 14px; }
    .pt-kpi-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-sub); }
    .pt-kpi-value { font-size: 26px; font-weight: 700; line-height: 1.15; margin-top: 4px; font-variant-numeric: tabular-nums; color: var(--text-main); }
    .pt-kpi-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
    .pt-kpi.is-crit .pt-kpi-value { color: var(--status-crit); }
    .pt-notice { background: var(--status-warn-bg); border: 1px solid #FDE68A; color: #92400E; border-radius: 8px; padding: 9px 12px; font-size: 13px; margin-bottom: 12px; }
    .pt-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 14px; }
    .pt-controls input[type="search"], .pt-controls select { height: 34px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg); padding: 0 10px; font: inherit; font-size: 13px; color: var(--text-main); }
    .pt-controls input[type="search"] { min-width: 220px; flex: 1 1 220px; max-width: 340px; }
    .pt-chip, .pt-btn { height: 34px; border: 1px solid var(--card-border); border-radius: 8px; background: var(--card-bg); padding: 0 12px; font: inherit; font-size: 13px; font-weight: 500; color: var(--text-main); cursor: pointer; }
    .pt-chip[aria-pressed="true"] { background: var(--status-crit-bg); border-color: #FECACA; color: #B91C1C; }
    .pt-btn:hover, .pt-chip:hover { background: #F4F4F5; }
    .pt-spacer { flex: 1 1 auto; }
    .pt-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 16px; align-items: start; }
    .pt-col { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 12px; min-width: 0; }
    .pt-col h2, .pt-section h2 { font-size: 13px; font-weight: 700; letter-spacing: 0.02em; margin: 0 0 10px; color: var(--text-main); }
    .pt-list { display: flex; flex-direction: column; gap: 8px; max-height: 560px; overflow: auto; }
    .pt-item { display: block; width: 100%; text-align: left; font: inherit; background: #FFFFFF; border: 1px solid var(--card-border); border-radius: 8px; padding: 10px 12px; cursor: pointer; color: var(--text-main); }
    .pt-item:hover { border-color: #A1A1AA; }
    .pt-item.is-sel { border-color: var(--brand-blue); box-shadow: 0 0 0 1px var(--brand-blue); }
    .pt-item.is-static { cursor: default; background: #FAFAFA; }
    .pt-item-top { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
    .pt-item-top strong { font-size: 14px; font-weight: 650; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .pt-item-sub { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
    .pt-item-foot { font-size: 12px; color: var(--text-muted); margin-top: 6px; }
    .pt-meter { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--status-na-bg); margin-top: 8px; }
    .pt-meter i { display: block; height: 100%; }
    .pt-meter .m-ok { background: var(--status-ok); }
    .pt-meter .m-wait { background: var(--brand-blue); }
    .pt-meter .m-crit { background: var(--status-crit); }
    .pt-meter .m-other { background: var(--status-warn); }
    .pt-badges { display: inline-flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
    .pt-badge { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px; white-space: nowrap; }
    .pt-ok { background: var(--status-ok-bg); color: #047857; }
    .pt-info { background: #DBEAFE; color: #1D4ED8; }
    .pt-warn { background: var(--status-warn-bg); color: #B45309; }
    .pt-crit { background: var(--status-crit-bg); color: #B91C1C; }
    .pt-manual { background: var(--status-storz-bg); color: #6D28D9; }
    .pt-na { background: var(--status-na-bg); color: #475569; }
    .pt-docs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .pt-doc-chip { font-size: 11.5px; background: #F4F4F5; border-radius: 6px; padding: 2px 7px; color: var(--text-main); }
    .pt-section { margin-top: 18px; }
    .pt-platforms { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
    .pt-plat { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 10px 12px; }
    .pt-plat-name { font-size: 13px; font-weight: 650; display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .pt-plat-meta { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
    .pt-table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px; overflow: hidden; }
    .pt-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-sub); padding: 8px 10px; border-bottom: 1px solid var(--card-border); }
    .pt-table td { padding: 8px 10px; border-bottom: 1px solid #F4F4F5; }
    .pt-empty { padding: 28px 12px; text-align: center; color: var(--text-muted); font-size: 13px; }
    .pt-scrim { position: fixed; inset: 0; background: rgba(9, 13, 22, 0.35); z-index: 900; display: none; }
    .pt-scrim.is-open { display: block; }
    .pt-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); background: #FFFFFF; border-left: 1px solid var(--card-border); box-shadow: -8px 0 24px rgba(0,0,0,0.12); z-index: 901; transform: translateX(100%); transition: transform 0.18s ease-out; display: flex; flex-direction: column; }
    .pt-drawer.is-open { transform: translateX(0); }
    .pt-drawer-head { padding: 14px 16px; border-bottom: 1px solid var(--card-border); display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
    .pt-drawer-head h3 { margin: 0; font-size: 15px; font-weight: 700; }
    .pt-drawer-body { padding: 14px 16px; overflow: auto; flex: 1; }
    .pt-drawer-doc { border: 1px solid var(--card-border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
    .pt-drawer-doc h4 { margin: 0 0 6px; font-size: 13px; font-weight: 650; display: flex; justify-content: space-between; gap: 8px; align-items: center; }
    .pt-reason, .pt-action { font-size: 12.5px; border-radius: 6px; padding: 7px 9px; margin-top: 6px; }
    .pt-reason { background: var(--status-crit-bg); color: #7F1D1D; }
    .pt-action { background: #F4F4F5; color: var(--text-main); }
    .pt-link { display: inline-block; margin-top: 6px; font-size: 12.5px; color: var(--brand-blue); }
    @media (max-width: 1100px) { .pt-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
    @media (max-width: 900px) { .pt-grid { grid-template-columns: minmax(0, 1fr); } .pt-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .pt-list { max-height: none; } }
`

export const PORTALS_TAB_HTML = String.raw`
      <!-- VIEW 5: PORTAIS DE CLIENTES -->
      <div id="view-portais" class="tab-view">
        <div class="pt-wrap">
          <div class="pt-kpis" id="ptKpis"></div>
          <div id="ptNotice"></div>
          <div class="pt-controls">
            <input type="search" id="ptSearch" placeholder="Buscar colaborador, parque ou cliente" aria-label="Buscar colaborador, parque ou cliente" oninput="portaisSet('q', this.value)">
            <select id="ptClient" aria-label="Filtrar por cliente" onchange="portaisSet('client', this.value)"><option value="ALL">Todos os clientes</option></select>
            <select id="ptStatus" aria-label="Filtrar por situação" onchange="portaisSet('status', this.value)">
              <option value="ALL">Todas as situações</option>
              <option value="BLOCKED">Bloqueado</option>
              <option value="ATTENTION">Pendência</option>
              <option value="WAITING">Em análise</option>
              <option value="OK">Liberado</option>
              <option value="MANUAL">Canal manual</option>
            </select>
            <select id="ptWin" aria-label="Filtrar por janela de mobilização" onchange="portaisSet('win', this.value)">
              <option value="ALL">Qualquer data de início</option>
              <option value="TODAY">Já iniciados ou hoje</option>
              <option value="H48">Em até 48 h</option>
              <option value="D7">Em até 7 dias</option>
            </select>
            <button type="button" class="pt-chip" id="ptOnlyBlocked" aria-pressed="false" onclick="portaisToggleBlocked()">Só bloqueados</button>
            <span class="pt-spacer"></span>
            <button type="button" class="pt-btn" onclick="portaisExportCsv()">Exportar CSV</button>
            <button type="button" class="pt-btn" id="ptCopyBtn" onclick="portaisCopySummary()">Copiar resumo</button>
          </div>
          <div class="pt-grid">
            <section class="pt-col" aria-label="Status por projeto">
              <h2>Status por projeto / parque</h2>
              <div class="pt-list" id="ptProjects"></div>
            </section>
            <section class="pt-col" aria-label="Detalhamento por técnico">
              <h2 id="ptCollabTitle">Detalhamento por técnico</h2>
              <div class="pt-list" id="ptCollabs"></div>
            </section>
          </div>
          <section class="pt-section">
            <h2>Plataformas de clientes</h2>
            <div class="pt-platforms" id="ptPlatforms"></div>
          </section>
          <section class="pt-section">
            <h2>Canais manuais e clientes sem leitura automática</h2>
            <div id="ptGaps"></div>
          </section>
        </div>
        <div class="pt-scrim" id="ptScrim" onclick="portaisCloseDrawer()"></div>
        <aside class="pt-drawer" id="ptDrawer" role="dialog" aria-modal="true" aria-labelledby="ptDrawerTitle" aria-hidden="true">
          <div class="pt-drawer-head">
            <div><h3 id="ptDrawerTitle"></h3><div class="pt-item-sub" id="ptDrawerSub"></div></div>
            <button type="button" class="pt-btn" id="ptDrawerClose" onclick="portaisCloseDrawer()" aria-label="Fechar detalhes">Fechar</button>
          </div>
          <div class="pt-drawer-body" id="ptDrawerBody"></div>
        </aside>
      </div>
`

const PORTALS_TAB_SCRIPT = String.raw`
    /* ===== Portais de Clientes: client logic ===== */
    var PT = { q: '', client: 'ALL', status: 'ALL', win: 'ALL', onlyBlocked: false, sel: -1, lastFocus: null, shown: [] };
    var PT_PROJ = { OK: ['LIBERADO', 'ok'], WAITING: ['EM ANÁLISE', 'info'], ATTENTION: ['PENDÊNCIA', 'warn'], BLOCKED: ['BLOQUEADO', 'crit'] };
    var PT_COLLAB = { CLEARED: ['LIBERADO', 'ok'], WAITING_CLIENT: ['EM ANÁLISE', 'info'], BLOCKED: ['BLOQUEADO', 'crit'], INCOMPLETE: ['LEITURA INCOMPLETA', 'warn'], NOT_REGISTERED: ['SEM CADASTRO', 'warn'], NOT_MONITORED: ['NÃO MONITORADO', 'na'] };
    var PT_DOC = { APPROVED: ['APROVADO', 'ok'], IN_REVIEW: ['EM ANÁLISE', 'info'], EXPIRING: ['A VENCER', 'warn'], MISSING: ['AUSENTE', 'crit'], EXPIRED: ['VENCIDO', 'crit'], REJECTED: ['RECUSADO', 'crit'] };
    var PT_AUTOMATION = { AUTOMATED: 'Automático', ASSISTED_LOGIN: 'Login assistido', NOT_AUTOMATED: 'Sem automação', MANUAL: 'Manual' };

    function ptEsc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }
    function ptNorm(s) {
      return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }
    function ptBadge(pair) {
      return '<span class="pt-badge pt-' + pair[1] + '">' + ptEsc(pair[0]) + '</span>';
    }
    function ptDay(iso) {
      if (!iso) return '';
      var p = String(iso).slice(0, 10).split('-');
      return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
    }
    function ptDateTime(iso) {
      if (!iso) return '';
      try {
        var dt = new Date(iso);
        if (isNaN(dt.getTime())) return ptDay(iso);
        var day = String(dt.getDate()).padStart(2, '0');
        var mo = String(dt.getMonth() + 1).padStart(2, '0');
        var yr = dt.getFullYear();
        var hr = String(dt.getHours()).padStart(2, '0');
        var min = String(dt.getMinutes()).padStart(2, '0');
        return day + '/' + mo + '/' + yr + ' às ' + hr + ':' + min;
      } catch (e) {
        return ptDay(iso);
      }
    }
    function ptRelativeAge(iso) {
      if (!iso) return '';
      try {
        var dt = new Date(iso);
        var diffMs = Date.now() - dt.getTime();
        if (diffMs < 0) return 'agora';
        var min = Math.floor(diffMs / 60000);
        if (min < 60) return min <= 1 ? 'há 1 min' : 'há ' + min + ' min';
        var hr = Math.floor(min / 60);
        if (hr < 24) return hr === 1 ? 'há 1 hora' : 'há ' + hr + ' horas';
        var d = Math.floor(hr / 24);
        return d === 1 ? 'há 1 dia' : 'há ' + d + ' dias';
      } catch (e) {
        return '';
      }
    }
    function ptStart(p) {
      if (p.daysToStart == null) return p.startDate ? 'início ' + ptDay(p.startDate) : 'sem data de início';
      if (p.daysToStart === 0) return 'inicia hoje';
      if (p.daysToStart > 0) return 'inicia em ' + p.daysToStart + ' d (' + ptDay(p.startDate) + ')';
      return 'iniciou há ' + Math.abs(p.daysToStart) + ' d';
    }
    function ptGapStart(iso) {
      if (!iso) return '';
      var ref = String(PORTAIS_DATA.refDate || '').slice(0, 10);
      return String(iso).slice(0, 10) < ref ? 'em andamento desde ' + ptDay(iso) : ptDay(iso);
    }
    function ptSafeUrl(u) {
      return typeof u === 'string' && u.indexOf('https://drive.google.com/') === 0 ? u : '';
    }

    function ptMatchesProject(p) {
      if (PT.client !== 'ALL' && p.client !== PT.client) return false;
      if (PT.onlyBlocked && p.status !== 'BLOCKED') return false;
      if (PT.status === 'MANUAL') { if (p.channelType !== 'MANUAL') return false; }
      else if (PT.status !== 'ALL' && p.status !== PT.status) return false;
      if (PT.win !== 'ALL') {
        var lim = PT.win === 'TODAY' ? 0 : (PT.win === 'H48' ? 2 : 7);
        if (p.daysToStart == null || p.daysToStart > lim) return false;
      }
      var q = ptNorm(PT.q).trim();
      if (q) {
        var hay = ptNorm(p.projectName + ' ' + p.client + ' ' + p.platforms.join(' '));
        var hit = hay.indexOf(q) >= 0;
        if (!hit) hit = p.collaborators.some(function (c) { return ptNorm(c.name).indexOf(q) >= 0; });
        if (!hit) return false;
      }
      return true;
    }

    function portaisFiltered() {
      var out = [];
      PORTAIS_DATA.projects.forEach(function (p, i) { if (ptMatchesProject(p)) out.push(i); });
      return out;
    }

    function portaisSet(key, value) { PT[key] = value; portaisRender(); }
    function portaisToggleBlocked() {
      PT.onlyBlocked = !PT.onlyBlocked;
      var b = document.getElementById('ptOnlyBlocked');
      if (b) b.setAttribute('aria-pressed', PT.onlyBlocked ? 'true' : 'false');
      portaisRender();
    }
    function portaisSelectProject(i) { PT.sel = i; portaisRender(); }

    function ptRenderKpis(s) {
      var cards = [
        ['Projetos na janela', s.totalProjects, 'mobilização em andamento ou próxima', ''],
        ['Cobertura automatizada', s.automatedPct + '%', s.automatedProjects + ' de ' + s.totalProjects + ' projetos lidos por portal', ''],
        ['Colaboradores alocados', s.allocatedPeople, s.blockedPeople + ' bloqueado(s) · ' + s.scheduledActions + ' ação(ões) a resolver', s.blockedPeople > 0 ? 'is-crit' : ''],
        ['Recusas ativas', s.criticalRejections, 'a reenviar por quem está escalado (+' + s.backlogActions + ' ações fora da escala)', s.criticalRejections > 0 ? 'is-crit' : ''],
        ['Projetos em canal manual', s.manualProjects, 'SharePoint, e-mail ou sem leitura', '']
      ];
      document.getElementById('ptKpis').innerHTML = cards.map(function (c) {
        return '<div class="pt-kpi ' + c[3] + '"><div class="pt-kpi-label">' + ptEsc(c[0]) + '</div><div class="pt-kpi-value">' + ptEsc(c[1]) + '</div><div class="pt-kpi-sub">' + ptEsc(c[2]) + '</div></div>';
      }).join('');
    }

    function ptRenderNotice(d) {
      var stale = d.platforms.filter(function (p) { return p.status === 'STALE'; });
      var el = document.getElementById('ptNotice');
      if (!stale.length) { el.innerHTML = ''; return; }
      el.innerHTML = '<div class="pt-notice" role="status"><strong>' + stale.length + ' plataforma(s) com leitura desatualizada</strong>: ' +
        stale.map(function (p) { return ptEsc(p.name) + ' (' + p.ageDays + ' d)'; }).join(', ') +
        '. O status dos colaboradores nelas reflete a última leitura, não o portal agora.</div>';
    }

    function ptRenderProjects(idxs) {
      var el = document.getElementById('ptProjects');
      if (!idxs.length) { el.innerHTML = '<div class="pt-empty">Nenhum projeto com esses filtros.</div>'; return; }
      el.innerHTML = idxs.map(function (i) {
        var p = PORTAIS_DATA.projects[i];
        var total = p.collaborators.length || 1;
        var c = p.counts;
        var w = function (n) { return (n / total * 100).toFixed(1) + '%'; };
        var badges = ptBadge(PT_PROJ[p.status]);
        if (p.channelType === 'MANUAL') badges += '<span class="pt-badge pt-manual">CANAL MANUAL</span>';
        else if (p.channelType === 'PARTIAL') badges += '<span class="pt-badge pt-na">LEITURA PARCIAL</span>';
        var plat = p.platforms.length ? p.platforms.join(', ') : 'sem leitura automática';
        return '<button type="button" class="pt-item' + (i === PT.sel ? ' is-sel' : '') + '" aria-pressed="' + (i === PT.sel) + '" onclick="portaisSelectProject(' + i + ')">' +
          '<div class="pt-item-top"><strong>' + ptEsc(p.projectName) + '</strong><span class="pt-badges">' + badges + '</span></div>' +
          '<div class="pt-item-sub">' + ptEsc(p.client) + ' · ' + ptEsc(plat) + ' · ' + ptEsc(ptStart(p)) + '</div>' +
          '<div class="pt-meter" aria-hidden="true"><i class="m-ok" style="width:' + w(c.cleared) + '"></i><i class="m-wait" style="width:' + w(c.waiting) + '"></i><i class="m-crit" style="width:' + w(c.blocked) + '"></i><i class="m-other" style="width:' + w(c.other) + '"></i></div>' +
          '<div class="pt-item-foot">' + c.cleared + ' de ' + p.collaborators.length + ' liberados' + (c.blocked ? ' · ' + c.blocked + ' bloqueado(s)' : '') + (c.waiting ? ' · ' + c.waiting + ' em análise' : '') + (c.other ? ' · ' + c.other + ' sem leitura ou incompletos' : '') + '</div>' +
          '</button>';
      }).join('');
    }

    var PT_COLLAB_RANK = { BLOCKED: 0, NOT_REGISTERED: 1, INCOMPLETE: 2, WAITING_CLIENT: 3, NOT_MONITORED: 4, CLEARED: 5 };

    function ptRenderCollabs(idxs) {
      var title = document.getElementById('ptCollabTitle');
      var el = document.getElementById('ptCollabs');
      if (PT.sel < 0 || idxs.indexOf(PT.sel) < 0) {
        title.textContent = 'Detalhamento por técnico';
        el.innerHTML = '<div class="pt-empty">Selecione um projeto à esquerda.</div>';
        return;
      }
      var p = PORTAIS_DATA.projects[PT.sel];
      title.textContent = 'Técnicos em ' + p.projectName;
      var q = ptNorm(PT.q).trim();
      var projectHit = !q || ptNorm(p.projectName + ' ' + p.client).indexOf(q) >= 0;
      var list = p.collaborators.map(function (c, ci) { return { c: c, ci: ci }; }).filter(function (x) {
        return projectHit || ptNorm(x.c.name).indexOf(q) >= 0;
      });
      list.sort(function (a, b) { return PT_COLLAB_RANK[a.c.overallStatus] - PT_COLLAB_RANK[b.c.overallStatus] || a.c.name.localeCompare(b.c.name); });
      if (!list.length) { el.innerHTML = '<div class="pt-empty">Nenhum técnico com esse filtro.</div>'; return; }
      el.innerHTML = list.map(function (x) {
        var c = x.c;
        var chips = c.documents.slice(0, 3).map(function (d) {
          return '<span class="pt-doc-chip">' + ptEsc(d.docName) + ' · ' + ptEsc(PT_DOC[d.status][0]) + '</span>';
        }).join('');
        if (c.documents.length > 3) chips += '<span class="pt-doc-chip">+' + (c.documents.length - 3) + '</span>';
        var head = '<div class="pt-item-top"><strong>' + ptEsc(c.name) + '</strong><span class="pt-badges">' + ptBadge(PT_COLLAB[c.overallStatus]) + '</span></div>' +
          '<div class="pt-item-sub">' + ptEsc(c.portal || 'sem portal') + (c.incompleteReason ? ' · ' + ptEsc(c.incompleteReason) : '') + '</div>' + (chips ? '<div class="pt-docs">' + chips + '</div>' : '');
        if (!c.documents.length) return '<div class="pt-item is-static">' + head + '</div>';
        return '<button type="button" class="pt-item" onclick="portaisOpenDrawer(' + PT.sel + ',' + x.ci + ')">' + head + '</button>';
      }).join('');
    }

    function ptRenderPlatforms(d) {
      document.getElementById('ptPlatforms').innerHTML = d.platforms.map(function (p) {
        var st = p.status === 'ONLINE' ? ['LEITURA ATUAL', 'ok'] : ['DESATUALIZADA', 'warn'];
        return '<div class="pt-plat"><div class="pt-plat-name"><span>' + ptEsc(p.name) + '</span>' + ptBadge(st) + '</div>' +
          '<div class="pt-plat-meta">' + ptEsc(PT_AUTOMATION[p.automation] || p.automation) + ' · extração em <strong>' + ptDateTime(p.capturedAt) + '</strong> (' + ptRelativeAge(p.capturedAt) + ')</div>' +
          '<div class="pt-plat-meta">' + p.collaboratorsCount + ' colaboradores · ' + p.cleared + ' liberados · ' + p.waiting + ' em análise · ' + p.blocked + ' bloqueados' + (p.incomplete ? ' · <strong>' + p.incomplete + ' com leitura incompleta</strong>' : '') + '</div>' +
          '<div class="pt-plat-meta">O robô traz em média ' + p.typicalDocs + ' documento(s) por pessoa' + (p.typicalDocs <= 1 ? ': leitura do portal não confiável' : '') + '</div></div>';
      }).join('') || '<div class="pt-empty">Nenhuma plataforma lida.</div>';
    }

    function ptRenderGaps(d) {
      var el = document.getElementById('ptGaps');
      if (!d.manualGaps.length) { el.innerHTML = '<div class="pt-empty">Todos os clientes da janela têm leitura automática.</div>'; return; }
      el.innerHTML = '<table class="pt-table"><thead><tr><th>Cliente</th><th>Canal</th><th>Projetos</th><th>Pessoas</th><th>Início</th></tr></thead><tbody>' +
        d.manualGaps.map(function (g) {
          return '<tr><td>' + ptEsc(g.client) + '</td><td>' + ptEsc(g.channel) + '</td><td>' + g.projects + '</td><td>' + g.allocatedCount + '</td><td>' + ptEsc(ptGapStart(g.nextStart)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }

    function portaisRender() {
      var wrap = document.querySelector('#view-portais .pt-wrap');
      if (!PORTAIS_DATA) {
        wrap.innerHTML = '<div class="pt-empty">Dados de portais indisponíveis nesta geração do dashboard (censos ou Briefing não carregados).</div>';
        return;
      }
      var d = PORTAIS_DATA;
      var idxs = portaisFiltered();
      PT.shown = idxs;
      if (PT.sel < 0 || idxs.indexOf(PT.sel) < 0) PT.sel = idxs.length ? idxs[0] : -1;
      ptRenderKpis(d.summary);
      ptRenderNotice(d);
      ptRenderProjects(idxs);
      ptRenderCollabs(idxs);
      ptRenderPlatforms(d);
      ptRenderGaps(d);
    }

    function portaisInit() {
      /* The tab view is its own stacking context, which would trap a fixed drawer under the top bar. */
      ['ptScrim', 'ptDrawer'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el && el.parentNode !== document.body) document.body.appendChild(el);
      });
      var badge = document.getElementById('ptBadgeTab');
      if (!PORTAIS_DATA) return;
      var sel = document.getElementById('ptClient');
      var clients = [];
      PORTAIS_DATA.projects.forEach(function (p) { if (clients.indexOf(p.client) < 0) clients.push(p.client); });
      clients.sort();
      sel.innerHTML = '<option value="ALL">Todos os clientes</option>' + clients.map(function (c) { return '<option value="' + ptEsc(c) + '">' + ptEsc(c) + '</option>'; }).join('');
      var blocked = PORTAIS_DATA.projects.filter(function (p) { return p.status === 'BLOCKED'; }).length;
      if (badge && blocked > 0) { badge.textContent = blocked; badge.style.display = ''; }
    }

    function portaisOpenDrawer(pi, ci) {
      var p = PORTAIS_DATA.projects[pi];
      var c = p.collaborators[ci];
      PT.lastFocus = document.activeElement;
      document.getElementById('ptDrawerTitle').textContent = c.name;
      document.getElementById('ptDrawerSub').innerHTML = ptEsc(p.projectName) + ' · ' + ptEsc(p.client) + ' · ' + ptEsc(c.portal || 'sem portal') + ' ' + ptBadge(PT_COLLAB[c.overallStatus]);
      document.getElementById('ptDrawerBody').innerHTML = c.documents.map(function (d) {
        var url = ptSafeUrl(d.driveUrl);
        return '<div class="pt-drawer-doc"><h4><span>' + ptEsc(d.docName) + '</span>' + ptBadge(PT_DOC[d.status]) + '</h4>' +
          (d.expiryDate ? '<div class="pt-item-sub">Vencimento: ' + ptEsc(ptDay(d.expiryDate)) + '</div>' : '') +
          (d.rejectionReason ? '<div class="pt-reason"><strong>Motivo informado pelo cliente:</strong> ' + ptEsc(d.rejectionReason) + '</div>' : '') +
          (d.suggestedAction ? '<div class="pt-action"><strong>Próximo passo:</strong> ' + ptEsc(d.suggestedAction) + '</div>' : '') +
          (url ? '<a class="pt-link" href="' + ptEsc(url) + '" target="_blank" rel="noopener">Abrir no Drive</a>' : '') +
          '</div>';
      }).join('') || '<div class="pt-empty">Sem pendências para este colaborador.</div>';
      document.getElementById('ptScrim').classList.add('is-open');
      var dr = document.getElementById('ptDrawer');
      dr.classList.add('is-open');
      dr.setAttribute('aria-hidden', 'false');
      document.getElementById('ptDrawerClose').focus();
    }
    function portaisCloseDrawer() {
      var dr = document.getElementById('ptDrawer');
      if (!dr || !dr.classList.contains('is-open')) return;
      dr.classList.remove('is-open');
      dr.setAttribute('aria-hidden', 'true');
      document.getElementById('ptScrim').classList.remove('is-open');
      if (PT.lastFocus && PT.lastFocus.focus) PT.lastFocus.focus();
    }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') portaisCloseDrawer(); });

    function ptCsvCell(v) {
      var s = String(v == null ? '' : v);
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    function portaisExportCsv() {
      if (!PORTAIS_DATA) return;
      var rows = [['Projeto', 'Cliente', 'Plataforma', 'Início', 'Colaborador', 'Situação', 'Documento', 'Status do documento', 'Vencimento', 'Motivo do cliente', 'Próximo passo']];
      portaisFiltered().forEach(function (i) {
        var p = PORTAIS_DATA.projects[i];
        p.collaborators.forEach(function (c) {
          var base = [p.projectName, p.client, c.portal || '', ptDay(p.startDate), c.name, PT_COLLAB[c.overallStatus][0]];
          if (!c.documents.length) rows.push(base.concat(['', '', '', '', '']));
          c.documents.forEach(function (d) {
            rows.push(base.concat([d.docName, PT_DOC[d.status][0], ptDay(d.expiryDate), d.rejectionReason || '', d.suggestedAction || '']));
          });
        });
      });
      var csv = '﻿' + rows.map(function (r) { return r.map(ptCsvCell).join(';'); }).join('\r\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = 'portais-clientes-' + String(PORTAIS_DATA.refDate).slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function portaisCopySummary() {
      if (!PORTAIS_DATA) return;
      var s = PORTAIS_DATA.summary;
      var lines = ['*Portais de clientes · ' + ptDay(PORTAIS_DATA.refDate) + '*',
        s.totalProjects + ' projetos na janela · ' + s.automatedPct + '% com leitura automática',
        s.blockedPeople + ' colaborador(es) bloqueado(s) · ' + s.criticalRejections + ' recusa(s) a reenviar', ''];
      var blocked = portaisFiltered().map(function (i) { return PORTAIS_DATA.projects[i]; }).filter(function (p) { return p.status === 'BLOCKED'; });
      if (blocked.length) lines.push('*Bloqueados:*');
      blocked.slice(0, 8).forEach(function (p) {
        var names = p.collaborators.filter(function (c) { return c.overallStatus === 'BLOCKED'; }).map(function (c) { return c.name; });
        lines.push('• ' + p.projectName + ' (' + p.client + ', ' + ptStart(p) + '): ' + names.slice(0, 6).join(', ') + (names.length > 6 ? ' +' + (names.length - 6) : ''));
      });
      var text = lines.join('\n');
      var btn = document.getElementById('ptCopyBtn');
      var done = function () { if (btn) { var t = btn.textContent; btn.textContent = 'Copiado'; setTimeout(function () { btn.textContent = t; }, 1500); } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done);
      else { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done(); }
    }

    portaisInit();
`

/** Embeds the data and the client script. "<" is escaped so no portal text can close the script tag. */
export function buildPortalsTabScript(
  data: PortalsDashboardData | undefined
): string {
  const json = JSON.stringify(data ?? null).replace(/</g, '\\u003c')
  return `    var PORTAIS_DATA = ${json};\n${PORTALS_TAB_SCRIPT}`
}
