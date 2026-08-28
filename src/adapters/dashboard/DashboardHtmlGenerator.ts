import { HSEDatabaseRecord } from '../../domain/services/HSEDatabaseRepository.js';

export function buildDashboardHtml(records: HSEDatabaseRecord[]): string {
  const dataJson = JSON.stringify(records);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ArthWind | Portal de DO & Treinamentos Normativos (EHS / SST)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Sora:wght@600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --navy-950: #0B1120;
      --navy-900: #111A2E;
      --navy-800: #1B2640;
      --navy-700: #25386B;
      --coral-500: #ED6F57;
      --coral-600: #D8563E;
      --teal-500: #1E6B77;
      --teal-100: #DEEFF1;
      --teal-50:  #EDF7F8;
      
      --slate-900: #0F172A;
      --slate-800: #1E293B;
      --slate-700: #334155;
      --slate-500: #64748B;
      --slate-400: #94A3B8;
      --slate-200: #E2E8F0;
      --slate-100: #F1F5F9;
      --slate-50:  #F8FAFC;
      --white:     #FFFFFF;

      --status-ok: #16A34A;
      --status-ok-bg: #DCFCE7;
      --status-warn: #D97706;
      --status-warn-bg: #FEF3C7;
      --status-crit: #DC2626;
      --status-crit-bg: #FEE2E2;
      --status-storz: #7C3AED;
      --status-storz-bg: #F3E8FF;
      --status-na: #94A3B8;
      --status-na-bg: #F1F5F9;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background-color: var(--slate-50);
      color: var(--slate-900);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
    }

    .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }
    .heading { font-family: 'Sora', sans-serif; }

    /* HEADER */
    header {
      background: linear-gradient(135deg, var(--navy-900) 0%, var(--navy-950) 100%);
      color: var(--white);
      padding: 16px 28px;
      border-bottom: 3px solid var(--coral-500);
      box-shadow: 0 4px 20px rgba(17, 26, 46, 0.15);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .brand-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .brand-badge {
      background: var(--white);
      color: var(--navy-800);
      padding: 6px 12px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 14px;
      letter-spacing: -0.3px;
    }
    .header-titles h1 {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.2px;
    }
    .header-titles p {
      font-size: 12px;
      color: var(--slate-400);
      margin-top: 2px;
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge-updated {
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      color: #E2E8F0;
    }

    /* CONTAINER */
    .container {
      max-width: 1600px;
      width: 100%;
      margin: 0 auto;
      padding: 20px 28px 40px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* KPI METRICS ROW */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 14px;
    }
    @media (max-width: 1100px) { .kpi-row { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 700px) { .kpi-row { grid-template-columns: 1fr; } }

    .kpi-card {
      background: var(--white);
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0,0,0,0.05);
      border-color: var(--slate-400);
    }
    .kpi-card.active {
      border-color: var(--navy-700);
      box-shadow: 0 0 0 2px var(--navy-700);
    }
    .kpi-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--slate-500); }
    .kpi-val { font-size: 28px; font-weight: 800; color: var(--navy-800); margin: 6px 0 2px; }
    .kpi-sub { font-size: 12px; color: var(--slate-500); font-weight: 500; }

    .kpi-card.good { border-top: 4px solid var(--status-ok); }
    .kpi-card.good .kpi-val { color: var(--status-ok); }
    .kpi-card.warn { border-top: 4px solid var(--status-warn); }
    .kpi-card.warn .kpi-val { color: var(--status-warn); }
    .kpi-card.danger { border-top: 4px solid var(--status-crit); }
    .kpi-card.danger .kpi-val { color: var(--status-crit); }
    .kpi-card.storz { border-top: 4px solid var(--status-storz); }
    .kpi-card.storz .kpi-val { color: var(--status-storz); }

    /* VIEW TABS */
    .tabs-nav {
      display: flex;
      gap: 10px;
      border-bottom: 2px solid var(--slate-200);
      padding-bottom: 2px;
    }
    .tab-btn {
      padding: 10px 18px;
      font-size: 13px;
      font-weight: 700;
      color: var(--slate-500);
      background: none;
      border: none;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
      position: relative;
    }
    .tab-btn:hover { color: var(--navy-800); background: var(--slate-100); }
    .tab-btn.active {
      color: var(--navy-800);
      background: var(--white);
      border: 1px solid var(--slate-200);
      border-bottom: 2px solid var(--white);
      margin-bottom: -2px;
    }
    .tab-btn.active::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--coral-500);
      border-radius: 8px 8px 0 0;
    }

    /* CONTROL BAR (SEARCH & FILTERS) */
    .controls-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      background: var(--white);
      border: 1px solid var(--slate-200);
      border-radius: 10px;
      padding: 12px 16px;
    }
    .search-input {
      background: var(--slate-50);
      border: 1px solid var(--slate-200);
      border-radius: 6px;
      padding: 8px 14px;
      font-size: 13px;
      min-width: 280px;
      font-family: inherit;
      color: var(--slate-800);
    }
    .search-input:focus { outline: none; border-color: var(--navy-700); background: var(--white); }
    .filter-select {
      background: var(--slate-50);
      border: 1px solid var(--slate-200);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 13px;
      font-family: inherit;
      color: var(--slate-800);
      cursor: pointer;
    }

    /* TAB VIEWS */
    .tab-view { display: none; }
    .tab-view.active { display: block; animation: fadeIn 0.2s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

    /* MATRIX (SKILL MATRIX GRID) */
    .matrix-card-wrap {
      background: var(--white);
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    }
    .matrix-table-container {
      overflow-x: auto;
      max-height: 650px;
      position: relative;
    }
    .matrix-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 12px;
    }
    .matrix-table th {
      background: var(--navy-900);
      color: var(--white);
      padding: 12px 10px;
      font-weight: 700;
      font-size: 11px;
      text-align: center;
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 2px solid var(--coral-500);
    }
    .matrix-table th.th-sticky-left {
      position: sticky;
      left: 0;
      z-index: 20;
      text-align: left;
      min-width: 220px;
      background: var(--navy-900);
    }
    .matrix-table td {
      padding: 10px 8px;
      border-bottom: 1px solid var(--slate-200);
      border-right: 1px solid var(--slate-100);
      text-align: center;
      vertical-align: middle;
      background: var(--white);
    }
    .matrix-table tr:hover td { background: var(--slate-50); }
    .matrix-table td.td-sticky-left {
      position: sticky;
      left: 0;
      z-index: 5;
      text-align: left;
      font-weight: 700;
      color: var(--navy-800);
      background: var(--white);
      border-right: 2px solid var(--slate-200);
      cursor: pointer;
    }
    .matrix-table tr:hover td.td-sticky-left { background: #EDF2F7; }

    /* STATUS CELL BADGES */
    .cell-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }
    .cell-badge:hover { transform: scale(1.05); }
    .cell-badge.ok { background: var(--status-ok-bg); color: var(--status-ok); }
    .cell-badge.warn { background: var(--status-warn-bg); color: var(--status-warn); }
    .cell-badge.danger { background: var(--status-crit-bg); color: var(--status-crit); }
    .cell-badge.storz { background: var(--status-storz-bg); color: var(--status-storz); }
    .cell-badge.na { background: var(--status-na-bg); color: var(--status-na); }

    /* DATA TABLE VIEW */
    .data-table-wrap {
      background: var(--white);
      border: 1px solid var(--slate-200);
      border-radius: 12px;
      overflow: hidden;
    }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th {
      background: var(--slate-100);
      padding: 10px 14px;
      font-weight: 700;
      color: var(--slate-500);
      text-transform: uppercase;
      font-size: 11px;
      text-align: left;
      border-bottom: 1px solid var(--slate-200);
    }
    .data-table td { padding: 12px 14px; border-bottom: 1px solid var(--slate-100); }
    .data-table tr:hover { background: var(--slate-50); }

    /* MODAL DOSSIÊ DO COLABORADOR */
    .modal-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }
    .modal-backdrop.show { display: flex; animation: fadeIn 0.15s ease-out; }
    .modal-box {
      background: var(--white);
      border-radius: 14px;
      max-width: 750px;
      width: 100%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0,0,0,0.2);
      overflow: hidden;
    }
    .modal-header {
      background: var(--navy-900);
      color: var(--white);
      padding: 18px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 3px solid var(--coral-500);
    }
    .modal-header h3 { font-size: 16px; font-weight: 700; }
    .modal-close-btn {
      background: none; border: none; color: var(--white); font-size: 20px; font-weight: 700; cursor: pointer;
    }
    .modal-body { padding: 20px 24px; overflow-y: auto; flex: 1; }
  </style>
</head>
<body>

  <header>
    <div class="brand-left">
      <div class="brand-badge heading">ARTHWIND</div>
      <div class="header-titles">
        <h1 class="heading">Portal de Desenvolvimento Organizacional (DO) & Treinamentos Normativos</h1>
        <p>Matriz de Qualificação, Conformidade EHS/SST e Acompanhamento de Reciclagens</p>
      </div>
    </div>
    <div class="header-right">
      <div class="badge-updated">
        Auditado em: <strong id="headerAuditDate">28/08/2026</strong>
      </div>
    </div>
  </header>

  <div class="container">
    
    <!-- 5 CARDS KPIS DO & TREINAMENTOS -->
    <div class="kpi-row">
      <div class="kpi-card" onclick="applyStatusFilter('ALL')">
        <span class="kpi-title">Total de Colaboradores</span>
        <div class="kpi-val mono" id="kpiTotalPeople">0</div>
        <div class="kpi-sub">Equipe Operacional & Campo</div>
      </div>

      <div class="kpi-card good" onclick="applyStatusFilter('CONFORME')">
        <span class="kpi-title">Cursos em Dia</span>
        <div class="kpi-val mono" id="kpiOkCount">0</div>
        <div class="kpi-sub" id="kpiComplianceRate">0% de conformidade</div>
      </div>

      <div class="kpi-card warn" onclick="applyStatusFilter('VENCE_30')">
        <span class="kpi-title">Reciclagens Próximas (&lt;30d)</span>
        <div class="kpi-val mono" id="kpiWarnCount">0</div>
        <div class="kpi-sub">Prioridade de agendamento DO</div>
      </div>

      <div class="kpi-card danger" onclick="applyStatusFilter('VENCIDO')">
        <span class="kpi-title">Cursos Vencidos / Bloqueados</span>
        <div class="kpi-val mono" id="kpiCritCount">0</div>
        <div class="kpi-sub">Impedimento de mobilização</div>
      </div>

      <div class="kpi-card storz" onclick="applyStatusFilter('STORZ')">
        <span class="kpi-title">Em Andamento na Storz</span>
        <div class="kpi-val mono" id="kpiStorzCount">0</div>
        <div class="kpi-sub">Matrículas e turmas ativas</div>
      </div>
    </div>

    <!-- ABAS DE VISUALIZAÇÃO -->
    <div class="tabs-nav">
      <button class="tab-btn active" onclick="switchView('matrix')">
        <span>🧩 Matriz de Qualificação & NRs (Skill Matrix)</span>
      </button>
      <button class="tab-btn" onclick="switchView('table')">
        <span>📋 Gestão de Pendências & Reciclagens</span>
      </button>
      <button class="tab-btn" onclick="switchView('storz')">
        <span>🎓 Acompanhamento Storz & Matrículas</span>
      </button>
    </div>

    <!-- CONTROLES (BUSCA & FILTROS) -->
    <div class="controls-bar">
      <input type="search" id="searchInput" class="search-input" placeholder="🔍 Buscar colaborador, documento ou setor..." oninput="renderAll()">
      
      <div style="display:flex; gap:10px; align-items:center;">
        <select id="sectorFilter" class="filter-select" onchange="renderAll()">
          <option value="ALL">Todos os Ramos / Setores</option>
        </select>

        <select id="statusFilter" class="filter-select" onchange="renderAll()">
          <option value="ALL">Todos os Status</option>
          <option value="CONFORME">🟢 Em Dia / Conforme</option>
          <option value="VENCE_30">🟡 A Vencer em 30 Dias</option>
          <option value="VENCIDO">🔴 Vencido / Ausente</option>
          <option value="STORZ">🟣 Em Andamento Storz</option>
        </select>
      </div>
    </div>

    <!-- VIEW 1: MATRIZ DE QUALIFICAÇÃO -->
    <div id="view-matrix" class="tab-view active">
      <div class="matrix-card-wrap">
        <div class="matrix-table-container">
          <table class="matrix-table" id="matrixTable">
            <thead>
              <tr id="matrixHeaderRow"></tr>
            </thead>
            <tbody id="matrixBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- VIEW 2: TABELA DE PENDÊNCIAS ANALÍTICA -->
    <div id="view-table" class="tab-view">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Ramo / Cargo</th>
              <th>Treinamento / Documento</th>
              <th>Modalidade</th>
              <th>Status EHS / DO</th>
              <th>Validade / Detalhe</th>
            </tr>
          </thead>
          <tbody id="dataTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- VIEW 3: ACOMPANHAMENTO STORZ -->
    <div id="view-storz" class="tab-view">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Curso Solicitado</th>
              <th>Storz Request ID</th>
              <th>Status da Matrícula</th>
              <th>Detalhe Operacional</th>
            </tr>
          </thead>
          <tbody id="storzTableBody"></tbody>
        </table>
      </div>
    </div>

  </div>

  <!-- MODAL DOSSIÊ DO COLABORADOR -->
  <div class="modal-backdrop" id="collabModal" onclick="closeModal(event)">
    <div class="modal-box" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3 id="modalCollabName">Dossiê do Colaborador</h3>
        <button class="modal-close-btn" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" id="modalCollabContent"></div>
    </div>
  </div>

  <script>
    const rawData = ${dataJson};

    // Documentos prioritários para a Matriz de Qualificação
    const priorityDocCodes = ['01', '21', '12', '13', '16', '17', '19', '22', '08', '30', '32', '31'];
    const docShortNames = {
      '01': 'ASO',
      '21': 'NR-35 Altura',
      '12': 'NR-10 Básico',
      '13': 'NR-10 SEP',
      '16': 'GWO 1º Socorros',
      '17': 'GWO NR-17 Ergo',
      '19': 'GWO NR-23 Fogo',
      '22': 'LOTO Bloqueio',
      '08': 'CNH',
      '30': 'GWO WINDA',
      '32': 'GWO ART',
      '31': 'Elevador JASO'
    };

    // Extrair universo único de pessoas e setores
    const peopleMap = new Map();
    const sectorsSet = new Set();

    rawData.forEach(r => {
      if (r.sector) sectorsSet.add(r.sector);
      if (!peopleMap.has(r.inspectorName)) {
        peopleMap.set(r.inspectorName, {
          id: r.inspectorId,
          name: r.inspectorName,
          role: r.role || 'Técnico',
          sector: r.sector || 'Operações',
          records: []
        });
      }
      peopleMap.get(r.inspectorName).records.push(r);
    });

    // Popular select de setores
    const sectorFilter = document.getElementById('sectorFilter');
    Array.from(sectorsSet).sort().forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.innerText = s;
      sectorFilter.appendChild(opt);
    });

    // Calcular KPIs
    const totalPeople = peopleMap.size;
    let okCount = 0;
    let warnCount = 0;
    let critCount = 0;
    let storzCount = 0;

    rawData.forEach(r => {
      if (r.statusEHS === 'CONFORME') okCount++;
      else if (r.statusEHS === 'VENCE_30') warnCount++;
      else if (r.statusEHS === 'VENCIDO' || r.statusEHS === 'AUSENTE') critCount++;
      else if (r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO') storzCount++;
    });

    document.getElementById('kpiTotalPeople').innerText = totalPeople;
    document.getElementById('kpiOkCount').innerText = okCount;
    document.getElementById('kpiComplianceRate').innerText = Math.round((okCount / (rawData.length || 1)) * 100) + '% dos cursos em conformidade';
    document.getElementById('kpiWarnCount').innerText = warnCount;
    document.getElementById('kpiCritCount').innerText = critCount;
    document.getElementById('kpiStorzCount').innerText = storzCount;

    function switchView(viewKey) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

      const btn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.innerText.toLowerCase().includes(viewKey === 'matrix' ? 'matriz' : viewKey === 'table' ? 'gestão' : 'storz'));
      if (btn) btn.classList.add('active');

      const view = document.getElementById('view-' + viewKey);
      if (view) view.classList.add('active');
    }

    function applyStatusFilter(status) {
      document.getElementById('statusFilter').value = status;
      renderAll();
    }

    function renderAll() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const sec = document.getElementById('sectorFilter').value;
      const st = document.getElementById('statusFilter').value;

      // 1. Filtrar pessoas
      const filteredPeople = Array.from(peopleMap.values()).filter(p => {
        const matchesQuery = p.name.toLowerCase().includes(q) || p.sector.toLowerCase().includes(q) || p.role.toLowerCase().includes(q);
        const matchesSec = sec === 'ALL' || p.sector === sec;
        
        let matchesStatus = true;
        if (st !== 'ALL') {
          matchesStatus = p.records.some(r => {
            if (st === 'CONFORME') return r.statusEHS === 'CONFORME';
            if (st === 'VENCE_30') return r.statusEHS === 'VENCE_30';
            if (st === 'VENCIDO') return r.statusEHS === 'VENCIDO' || r.statusEHS === 'AUSENTE';
            if (st === 'STORZ') return r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO';
            return true;
          });
        }
        return matchesQuery && matchesSec && matchesStatus;
      });

      // 2. Renderizar Matriz
      renderMatrix(filteredPeople);

      // 3. Renderizar Tabela Geral
      renderTable(filteredPeople, q, st);

      // 4. Renderizar Tabela Storz
      renderStorz(filteredPeople);
    }

    function renderMatrix(peopleList) {
      const headerRow = document.getElementById('matrixHeaderRow');
      headerRow.innerHTML = '<th class="th-sticky-left">Colaborador / Ramo</th>' + 
        priorityDocCodes.map(c => '<th>' + (docShortNames[c] || 'Doc ' + c) + '</th>').join('');

      const tbody = document.getElementById('matrixBody');
      tbody.innerHTML = '';

      if (peopleList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + (priorityDocCodes.length + 1) + '" style="padding:32px;color:var(--slate-500);text-align:center;">Nenhum colaborador encontrado com os filtros atuais.</td></tr>';
        return;
      }

      peopleList.forEach(p => {
        const tr = document.createElement('tr');
        
        let html = '<td class="td-sticky-left" onclick="openCollabModal(\\'' + p.name.replace(/'/g, "\\\\'") + '\\')">' +
          '<div>' + p.name + '</div>' +
          '<div style="font-size:11px;font-weight:500;color:var(--slate-500);">' + p.role + ' · ' + p.sector + '</div>' +
          '</td>';

        priorityDocCodes.forEach(code => {
          const r = p.records.find(rec => rec.docCode === code);
          if (!r) {
            html += '<td><span class="cell-badge na">—</span></td>';
          } else if (r.statusEHS === 'CONFORME') {
            html += '<td><span class="cell-badge ok" title="' + r.detail + '">✔ Em Dia</span></td>';
          } else if (r.statusEHS === 'VENCE_30') {
            html += '<td><span class="cell-badge warn" title="' + r.detail + '">⏳ &lt;30d</span></td>';
          } else if (r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO') {
            html += '<td><span class="cell-badge storz" title="' + r.detail + '">🎓 Storz</span></td>';
          } else {
            html += '<td><span class="cell-badge danger" title="' + r.detail + '">✘ Vencido</span></td>';
          }
        });

        tr.innerHTML = html;
        tbody.appendChild(tr);
      });
    }

    function renderTable(peopleList, q, st) {
      const tbody = document.getElementById('dataTableBody');
      tbody.innerHTML = '';

      const rowsToDisplay = [];
      peopleList.forEach(p => {
        p.records.forEach(r => {
          let matchStatus = true;
          if (st === 'CONFORME') matchStatus = r.statusEHS === 'CONFORME';
          else if (st === 'VENCE_30') matchStatus = r.statusEHS === 'VENCE_30';
          else if (st === 'VENCIDO') matchStatus = r.statusEHS === 'VENCIDO' || r.statusEHS === 'AUSENTE';
          else if (st === 'STORZ') matchStatus = r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO';

          if (matchStatus) rowsToDisplay.push(r);
        });
      });

      if (rowsToDisplay.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:32px;color:var(--slate-500);text-align:center;">Nenhum registro encontrado.</td></tr>';
        return;
      }

      rowsToDisplay.slice(0, 150).forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><strong>' + r.inspectorName + '</strong></td>' +
          '<td style="color:var(--slate-500);">' + (r.role || 'Técnico') + ' · ' + (r.sector || 'Operações') + '</td>' +
          '<td><strong>' + r.docName + '</strong></td>' +
          '<td><span style="font-size:11px;background:var(--slate-100);padding:2px 6px;border-radius:4px;">' + (r.modality || 'PRESENCIAL') + '</span></td>' +
          '<td>' +
            (r.statusEHS === 'CONFORME' ? '<span class="cell-badge ok">✔ Em Dia</span>' :
             r.statusEHS === 'VENCE_30' ? '<span class="cell-badge warn">⏳ A Vencer</span>' :
             r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO' ? '<span class="cell-badge storz">🎓 Storz</span>' :
             '<span class="cell-badge danger">✘ Vencido/Pendente</span>') +
          '</td>' +
          '<td style="font-size:12px;color:var(--slate-600);">' + r.detail + '</td>';
        tbody.appendChild(tr);
      });
    }

    function renderStorz(peopleList) {
      const tbody = document.getElementById('storzTableBody');
      tbody.innerHTML = '';

      const storzRecords = [];
      peopleList.forEach(p => {
        p.records.forEach(r => {
          if (r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO' || r.storzRequestId) {
            storzRecords.push(r);
          }
        });
      });

      if (storzRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding:32px;color:var(--slate-500);text-align:center;">Nenhuma solicitação ativa na Storz no momento.</td></tr>';
        return;
      }

      storzRecords.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td><strong>' + r.inspectorName + '</strong><div style="font-size:11px;color:var(--slate-500);">' + (r.sector || 'Operações') + '</div></td>' +
          '<td><strong>' + r.docName + '</strong></td>' +
          '<td><span class="mono" style="font-weight:700;color:var(--status-storz);">' + (r.storzRequestId || '—') + '</span></td>' +
          '<td><span class="cell-badge storz">' + (r.storzState || 'EM ANDAMENTO') + '</span></td>' +
          '<td style="font-size:12px;color:var(--slate-600);">' + r.detail + '</td>';
        tbody.appendChild(tr);
      });
    }

    function openCollabModal(name) {
      const p = peopleMap.get(name);
      if (!p) return;

      document.getElementById('modalCollabName').innerText = p.name + ' (' + p.role + ' - ' + p.sector + ')';
      
      let html = '<table class="data-table">' +
        '<thead><tr><th>Treinamento / Documento</th><th>Status</th><th>Detalhes</th></tr></thead><tbody>';

      p.records.forEach(r => {
        html += '<tr>' +
          '<td><strong>' + r.docName + '</strong></td>' +
          '<td>' +
            (r.statusEHS === 'CONFORME' ? '<span class="cell-badge ok">✔ Em Dia</span>' :
             r.statusEHS === 'VENCE_30' ? '<span class="cell-badge warn">⏳ A Vencer</span>' :
             r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO' ? '<span class="cell-badge storz">🎓 Storz</span>' :
             '<span class="cell-badge danger">✘ Vencido</span>') +
          '</td>' +
          '<td style="font-size:12px;color:var(--slate-600);">' + r.detail + '</td>' +
          '</tr>';
      });

      html += '</tbody></table>';
      document.getElementById('modalCollabContent').innerHTML = html;
      document.getElementById('collabModal').classList.add('show');
    }

    function closeModal() {
      document.getElementById('collabModal').classList.remove('show');
    }

    // Inicialização
    renderAll();
  </script>
</body>
</html>`;
}
