import { HSEDatabaseRecord } from '../../domain/services/HSEDatabaseRepository.js';

export function buildDashboardHtml(records: HSEDatabaseRecord[]): string {
  const dataJson = JSON.stringify(records);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ArthWind | EHS & DO Training Matrix Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ==========================================================================
       ARTHWIND CORPORATE DESIGN SYSTEM - HSE & DO TRAINING MATRIX (ARTHNEX STYLE)
       ========================================================================== */
    :root {
      --sidebar-bg: #090D16;
      --sidebar-hover: #131A29;
      --sidebar-text: #94A3B8;
      --sidebar-text-active: #FFFFFF;
      --sidebar-border: #172033;
      
      --canvas-bg: #EAEFF5;
      --card-bg: #FFFFFF;
      --card-border: #E2E8F0;
      
      --brand-cyan: #00D2B4;
      --brand-blue: #2563EB;
      --brand-coral: #F43F5E;
      --brand-purple: #7C3AED;
      --brand-amber: #F59E0B;
      --brand-green: #10B981;
      
      --text-main: #0F172A;
      --text-muted: #64748B;
      --text-sub: #94A3B8;

      --pill-bg: #DDE4EE;
      --pill-text: #334155;

      --status-ok: #10B981;
      --status-ok-bg: #DCFCE7;
      --status-warn: #F59E0B;
      --status-warn-bg: #FEF3C7;
      --status-crit: #EF4444;
      --status-crit-bg: #FEE2E2;
      --status-storz: #8B5CF6;
      --status-storz-bg: #EDE9FE;
      --status-na: #94A3B8;
      --status-na-bg: #F1F5F9;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      width: 100vw;
      height: 100vh;
      max-height: 100vh;
      background-color: var(--canvas-bg);
      color: var(--text-main);
      font-family: 'Inter', -apple-system, sans-serif;
      overflow: hidden;
      display: flex;
      -webkit-font-smoothing: antialiased;
    }

    .mono { font-family: 'JetBrains Mono', monospace; font-variant-numeric: tabular-nums; }

    /* SVG ICONS */
    .ico {
      width: 16px;
      height: 16px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      vertical-align: middle;
    }
    .ico svg {
      width: 100%;
      height: 100%;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* LEFT SIDEBAR */
    .sidebar {
      width: 230px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--sidebar-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      padding: 14px 10px;
      z-index: 10;
    }
    .sidebar-brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 8px 14px 8px;
      border-bottom: 1px solid var(--sidebar-border);
      margin-bottom: 12px;
    }
    .brand-logo-wrap {
      background: #FFFFFF;
      padding: 4px 10px;
      border-radius: 6px;
      display: flex;
      align-items: center;
    }
    .brand-logo-img {
      height: 22px;
      width: auto;
      object-fit: contain;
    }
    .sidebar-collapse-btn { color: var(--sidebar-text); cursor: pointer; font-size: 12px; }

    .nav-section { margin-bottom: 14px; }
    .nav-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #475569;
      padding: 4px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: 6px;
      color: var(--sidebar-text);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      margin-bottom: 2px;
    }
    .nav-item-title { display: flex; align-items: center; gap: 8px; }
    .nav-item:hover { background: var(--sidebar-hover); color: #FFFFFF; }
    .nav-item.active {
      background: rgba(0, 210, 180, 0.12);
      color: var(--brand-cyan);
      font-weight: 700;
    }

    /* MAIN VIEWPORT */
    .main-viewport {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100vh;
      min-width: 0;
      overflow: hidden;
      position: relative;
    }

    .main-viewport::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background-image: 
        radial-gradient(rgba(148, 163, 184, 0.15) 1px, transparent 1px),
        radial-gradient(rgba(148, 163, 184, 0.08) 1px, transparent 1px);
      background-size: 24px 24px;
      background-position: 0 0, 12px 12px;
      pointer-events: none;
      z-index: 0;
    }

    /* TOPBAR */
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px 8px 24px;
      z-index: 1;
      flex-shrink: 0;
    }
    .breadcrumb-wrap { display: flex; align-items: center; gap: 12px; }
    .btn-back {
      width: 28px; height: 28px; border-radius: 999px;
      border: 1px solid var(--pill-bg); background: #FFFFFF;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: var(--text-main);
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .breadcrumb-pill {
      background: var(--pill-bg);
      color: var(--pill-text);
      font-size: 12px;
      font-weight: 700;
      padding: 5px 12px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .topbar-filters { display: flex; align-items: center; gap: 10px; }
    .filter-group {
      display: flex;
      align-items: center;
      background: #FFFFFF;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 2px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
    }
    .filter-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 4px 8px;
    }
    .pill-opt {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-muted);
      transition: all 0.15s;
    }
    .pill-opt.active { background: var(--pill-bg); color: var(--text-main); font-weight: 700; }

    /* PAGE TITLE BAR */
    .page-title-bar {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding: 0 24px 8px 24px;
      z-index: 1;
      flex-shrink: 0;
    }
    .page-title-bar h2 {
      font-size: 17px;
      font-weight: 800;
      color: var(--text-main);
      letter-spacing: -0.3px;
    }
    .page-title-bar p {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 1px;
    }

    /* CONTENT BODY */
    .content-body {
      flex: 1;
      padding: 0 24px 16px 24px;
      display: flex;
      flex-direction: column;
      min-height: 0;
      z-index: 1;
      gap: 10px;
    }

    /* KPIS ROW */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 10px;
      margin-bottom: 4px;
      flex-shrink: 0;
    }
    @media (max-width: 1200px) { .kpi-row { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 700px) { .kpi-row { grid-template-columns: repeat(2, 1fr); } }

    .kpi-box {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.02);
      cursor: pointer;
      transition: all 0.15s;
    }
    .kpi-box:hover { transform: translateY(-1px); border-color: var(--sidebar-text); }
    .kpi-box .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 2px; }
    .kpi-box .val { font-size: 24px; font-weight: 800; color: var(--text-main); line-height: 1.1; margin-bottom: 2px; }
    .kpi-box .sub { font-size: 11px; color: var(--text-muted); }

    /* CARD WRAPPER */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.03);
      padding: 14px 18px;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      flex-shrink: 0;
    }
    .card-header h3 { font-size: 13px; font-weight: 700; color: var(--text-main); }

    /* SEARCH BAR */
    .controls-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      flex-shrink: 0;
    }
    .search-input {
      background: #F8FAFC;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 7px 12px;
      font-size: 12px;
      min-width: 260px;
      color: var(--text-main);
      font-family: inherit;
    }
    .search-input:focus { outline: none; border-color: var(--brand-blue); background: #FFFFFF; }
    .select-filter {
      background: #F8FAFC;
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      color: var(--text-main);
      font-family: inherit;
      cursor: pointer;
    }

    /* MATRIX TABLE */
    .table-container {
      overflow: auto;
      flex: 1;
      min-height: 0;
      border: 1px solid var(--card-border);
      border-radius: 8px;
    }
    .matrix-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      font-size: 11px;
    }
    .matrix-table th {
      background: #F8FAFC;
      color: var(--text-muted);
      padding: 8px 6px;
      font-weight: 700;
      font-size: 10px;
      text-transform: uppercase;
      text-align: center;
      white-space: nowrap;
      position: sticky;
      top: 0;
      z-index: 10;
      border-bottom: 1px solid var(--card-border);
    }
    .matrix-table th.th-sticky {
      position: sticky;
      left: 0;
      z-index: 20;
      text-align: left;
      min-width: 200px;
      background: #F8FAFC;
    }
    .matrix-table td {
      padding: 7px 6px;
      border-bottom: 1px solid #F1F5F9;
      border-right: 1px solid #F8FAFC;
      text-align: center;
      vertical-align: middle;
      background: #FFFFFF;
    }
    .matrix-table tr:hover td { background: #F8FAFC; }
    .matrix-table td.td-sticky {
      position: sticky;
      left: 0;
      z-index: 5;
      text-align: left;
      font-weight: 700;
      color: var(--text-main);
      background: #FFFFFF;
      border-right: 2px solid var(--card-border);
      cursor: pointer;
    }
    .matrix-table tr:hover td.td-sticky { background: #EDF2F7; color: var(--brand-blue); }

    /* STATUS CELL BADGES */
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s;
    }
    .badge:hover { transform: scale(1.06); }
    .badge.ok { background: var(--status-ok-bg); color: var(--status-ok); }
    .badge.warn { background: var(--status-warn-bg); color: var(--status-warn); }
    .badge.danger { background: var(--status-crit-bg); color: var(--status-crit); }
    .badge.storz { background: var(--status-storz-bg); color: var(--status-storz); }
    .badge.ausente { background: #F1F5F9; color: #475569; border: 1px dashed #CBD5E1; font-weight: 600; }
    .badge.na { background: var(--status-na-bg); color: var(--status-na); }

    .tab-view { display: none; height: 100%; flex: 1; min-height: 0; }
    .tab-view.active { display: flex; flex-direction: column; animation: fadeIn 0.2s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: translateY(0); } }

    /* MODAL */
    .modal-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(9, 13, 22, 0.6);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 20px;
    }
    .modal-overlay.show { display: flex; animation: fadeIn 0.15s ease-out; }
    .modal-content {
      background: #FFFFFF;
      border-radius: 12px;
      max-width: 700px;
      width: 100%;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0,0,0,0.15);
      overflow: hidden;
    }
    .modal-head {
      background: var(--sidebar-bg);
      color: #FFFFFF;
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--brand-cyan);
    }
    .modal-head h3 { font-size: 14px; font-weight: 700; }
    .modal-close { background: none; border: none; color: #FFF; font-size: 18px; cursor: pointer; }
    .modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
  </style>
</head>
<body>

  <!-- LEFT SIDEBAR -->
  <aside class="sidebar">
    <div class="sidebar-brand">
      <div class="brand-logo-wrap">
        <img src="https://arthwind.com.br/assets/Img/arthwindLogo.png" alt="ArthWind" class="brand-logo-img">
      </div>
      <div class="sidebar-collapse-btn">«</div>
    </div>

    <div class="nav-section">
      <div class="nav-title">EHS &amp; Treinamentos</div>
      <div class="nav-item active" onclick="switchNav('matrix')">
        <div class="nav-item-title">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M2 12h20"/><path d="M6 8v8"/><path d="M10 8v8"/><path d="M14 8v8"/><path d="M18 8v8"/></svg></span>
          <span>Skill Matrix (DO)</span>
        </div>
      </div>

      <div class="nav-item" onclick="switchNav('table')">
        <div class="nav-item-title">
          <span class="ico"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>
          <span>Gestão de Pendências</span>
        </div>
      </div>

      <div class="nav-item" onclick="switchNav('storz')">
        <div class="nav-item-title">
          <span class="ico"><svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></span>
          <span>Storz Matrículas</span>
        </div>
      </div>
    </div>
  </aside>

  <!-- MAIN VIEWPORT -->
  <main class="main-viewport">
    
    <!-- TOPBAR -->
    <div class="topbar">
      <div class="breadcrumb-wrap">
        <button class="btn-back" onclick="window.history.back()">←</button>
        <div class="breadcrumb-pill">ArthWind &gt; Skill Matrix &amp; EHS Compliance</div>
      </div>

      <div class="topbar-filters">
        <div class="filter-group">
          <span class="filter-label">Visualização:</span>
          <span class="pill-opt active" onclick="switchNav('matrix')">Matriz NRs</span>
          <span class="pill-opt" onclick="switchNav('table')">Tabela Analítica</span>
          <span class="pill-opt" onclick="switchNav('storz')">Storz</span>
        </div>
      </div>
    </div>

    <!-- PAGE TITLE BAR -->
    <div class="page-title-bar">
      <div>
        <h2 id="pageHeading">Matriz de Qualificação &amp; Treinamentos Normativos (DO)</h2>
        <p>Acompanhamento de conformidade de NRs (NR-35, NR-10, NR-33), GWO BST, ASO e reciclagens por colaborador de campo</p>
      </div>
      <div class="mono" style="font-size: 11px; font-weight: 700; color: var(--text-muted);">
        STATUS: <span style="color: var(--brand-green); font-weight: 800;">AUDITADO EM 01/09/2026</span>
      </div>
    </div>

    <!-- CONTENT BODY -->
    <div class="content-body">
      
      <!-- 6 KPIS ROW -->
      <div class="kpi-row">
        <div class="kpi-box" onclick="applyStatusFilter('ALL')">
          <div class="label">Colaboradores</div>
          <div class="val mono" id="kpiTotalPeople">0</div>
          <div class="sub">Universo auditado</div>
        </div>

        <div class="kpi-box" onclick="applyStatusFilter('CONFORME')">
          <div class="label">Em Dia</div>
          <div class="val mono" style="color: var(--brand-green);" id="kpiOkCount">0</div>
          <div class="sub" id="kpiComplianceRate">0% em conformidade</div>
        </div>

        <div class="kpi-box" onclick="applyStatusFilter('VENCE_30')">
          <div class="label">Reciclagens (&lt;30d)</div>
          <div class="val mono" style="color: var(--brand-amber);" id="kpiWarnCount">0</div>
          <div class="sub">Prioridade de agendamento</div>
        </div>

        <div class="kpi-box" onclick="applyStatusFilter('VENCIDO')">
          <div class="label">Vencidos (no Drive)</div>
          <div class="val mono" style="color: var(--brand-coral);" id="kpiCritCount">0</div>
          <div class="sub">Documento expirado</div>
        </div>

        <div class="kpi-box" onclick="applyStatusFilter('AUSENTE')">
          <div class="label">Ausentes (sem Doc)</div>
          <div class="val mono" style="color: #64748B;" id="kpiAusenteCount">0</div>
          <div class="sub">Não encontrado no Drive</div>
        </div>

        <div class="kpi-box" onclick="applyStatusFilter('STORZ')">
          <div class="label">Storz Ativas</div>
          <div class="val mono" style="color: var(--brand-purple);" id="kpiStorzCount">0</div>
          <div class="sub">Matrículas em andamento</div>
        </div>
      </div>

      <!-- CONTROLS -->
      <div class="controls-strip">
        <input type="search" id="searchInput" class="search-input" placeholder="🔍 Buscar colaborador, cargo ou setor..." oninput="renderAll()">
        <div style="display:flex; gap:8px;">
          <select id="sectorFilter" class="select-filter" onchange="renderAll()">
            <option value="ALL">Todos os Ramos / Setores</option>
          </select>
          <select id="statusFilter" class="select-filter" onchange="renderAll()">
            <option value="ALL">Todos os Status</option>
            <option value="CONFORME">🟢 Em Dia / Conforme</option>
            <option value="VENCE_30">🟡 A Vencer (&lt;30 dias)</option>
            <option value="VENCIDO">🔴 Vencido (no Drive)</option>
            <option value="AUSENTE">⚪ Ausente (não está no Drive)</option>
            <option value="STORZ">🟣 Em Andamento Storz</option>
          </select>
        </div>
      </div>

      <!-- VIEW 1: MATRIX -->
      <div id="view-matrix" class="tab-view active">
        <div class="card">
          <div class="table-container">
            <table class="matrix-table" id="matrixTable">
              <thead><tr id="matrixHeaderRow"></tr></thead>
              <tbody id="matrixBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- VIEW 2: TABLE -->
      <div id="view-table" class="tab-view">
        <div class="card">
          <div class="table-container">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th style="text-align:left;">Colaborador</th>
                  <th style="text-align:left;">Ramo / Setor</th>
                  <th style="text-align:left;">Treinamento / Documento</th>
                  <th>Modalidade</th>
                  <th>Status DO/EHS</th>
                  <th style="text-align:left;">Validade / Detalhes</th>
                </tr>
              </thead>
              <tbody id="dataTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- VIEW 3: STORZ -->
      <div id="view-storz" class="tab-view">
        <div class="card">
          <div class="table-container">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th style="text-align:left;">Colaborador</th>
                  <th style="text-align:left;">Curso Solicitado</th>
                  <th>Storz ID</th>
                  <th>Status Matrícula</th>
                  <th style="text-align:left;">Detalhe Operacional</th>
                </tr>
              </thead>
              <tbody id="storzTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

    </div>

  </main>

  <!-- COLLAB MODAL -->
  <div class="modal-overlay" id="collabModal" onclick="closeModal(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-head">
        <h3 id="modalCollabName">Dossiê do Colaborador</h3>
        <button class="modal-close" onclick="closeModal()">×</button>
      </div>
      <div class="modal-body" id="modalCollabContent"></div>
    </div>
  </div>

  <script>
    const rawData = ${dataJson};

    const priorityDocCodes = ['01', '21', '12', '13', '16', '17', '19', '22', '08', '30', '32', '31'];
    const docShortNames = {
      '01': 'ASO',
      '21': 'NR-35 Altura',
      '12': 'NR-10 Básico',
      '13': 'NR-10 SEP',
      '16': 'GWO 1º Soc',
      '17': 'GWO Ergo',
      '19': 'GWO Fogo',
      '22': 'LOTO',
      '08': 'CNH',
      '30': 'GWO WINDA',
      '32': 'GWO ART',
      '31': 'JASO Elevador'
    };

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

    const sectorFilter = document.getElementById('sectorFilter');
    Array.from(sectorsSet).sort().forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.innerText = s;
      sectorFilter.appendChild(opt);
    });

    function isConforme(st) {
      return st === 'CONFORME';
    }

    function isAVencer(st) {
      return st === 'VENCE_60' || st === 'VENCE_30' || st === 'VENCE_15' || st === 'VENCE_07';
    }

    function isVencido(st) {
      return st === 'VENCIDO';
    }

    function isAusente(st) {
      return st === 'AUSENTE';
    }

    function isStorz(st) {
      return st === 'SOLICITADO_STORZ' || st === 'STORZ_EM_ANDAMENTO';
    }

    function renderBadge(r) {
      if (!r) return '<span class="badge na">—</span>';
      if (r.statusEHS === 'CONFORME') {
        return '<span class="badge ok" title="' + r.detail + '">✔ Em Dia</span>';
      } else if (r.statusEHS === 'VENCE_60') {
        return '<span class="badge warn" style="background:rgba(37,99,235,0.1); color:#2563EB;" title="' + r.detail + '">⏳ &lt;60d</span>';
      } else if (r.statusEHS === 'VENCE_30') {
        return '<span class="badge warn" title="' + r.detail + '">⏳ &lt;30d</span>';
      } else if (r.statusEHS === 'VENCE_15') {
        return '<span class="badge warn" style="background:#FEF3C7; color:#D97706; font-weight:800;" title="' + r.detail + '">⏳ &lt;15d</span>';
      } else if (r.statusEHS === 'VENCE_07') {
        return '<span class="badge warn" style="background:#FEE2E2; color:#DC2626; font-weight:800;" title="' + r.detail + '">⚠️ &lt;7d</span>';
      } else if (r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO') {
        return '<span class="badge storz" title="' + r.detail + '">🎓 Storz</span>';
      } else if (r.statusEHS === 'AUSENTE') {
        return '<span class="badge ausente" title="' + (r.detail || 'Não encontrado no Drive') + '">⚪ Ausente</span>';
      } else if (r.statusEHS === 'VENCIDO') {
        return '<span class="badge danger" title="' + r.detail + '">✘ Vencido</span>';
      } else {
        return '<span class="badge na" title="' + r.detail + '">—</span>';
      }
    }

    const totalPeople = peopleMap.size;
    let okCount = 0, warnCount = 0, critCount = 0, ausenteCount = 0, storzCount = 0;

    rawData.forEach(r => {
      if (isConforme(r.statusEHS)) okCount++;
      else if (isAVencer(r.statusEHS)) warnCount++;
      else if (isVencido(r.statusEHS)) critCount++;
      else if (isAusente(r.statusEHS)) ausenteCount++;
      else if (isStorz(r.statusEHS)) storzCount++;
    });

    document.getElementById('kpiTotalPeople').innerText = totalPeople;
    document.getElementById('kpiOkCount').innerText = okCount;
    document.getElementById('kpiComplianceRate').innerText = Math.round((okCount / (rawData.length || 1)) * 100) + '% em conformidade';
    document.getElementById('kpiWarnCount').innerText = warnCount;
    document.getElementById('kpiCritCount').innerText = critCount;
    if (document.getElementById('kpiAusenteCount')) document.getElementById('kpiAusenteCount').innerText = ausenteCount;
    document.getElementById('kpiStorzCount').innerText = storzCount;

    function switchNav(viewKey) {
      document.querySelectorAll('.sidebar .nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.topbar .pill-opt').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

      const views = ['matrix', 'table', 'storz'];
      const idx = views.indexOf(viewKey);

      const navs = document.querySelectorAll('.sidebar .nav-item');
      if (navs[idx]) navs[idx].classList.add('active');

      const pills = document.querySelectorAll('.topbar .pill-opt');
      if (pills[idx]) pills[idx].classList.add('active');

      const view = document.getElementById('view-' + viewKey);
      if (view) view.classList.add('active');
    }

    function applyStatusFilter(st) {
      document.getElementById('statusFilter').value = st;
      renderAll();
    }

    function renderAll() {
      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const sec = document.getElementById('sectorFilter').value;
      const st = document.getElementById('statusFilter').value;

      const filteredPeople = Array.from(peopleMap.values()).filter(p => {
        const matchesQuery = p.name.toLowerCase().includes(q) || p.sector.toLowerCase().includes(q) || p.role.toLowerCase().includes(q);
        const matchesSec = sec === 'ALL' || p.sector === sec;
        
        let matchesStatus = true;
        if (st !== 'ALL') {
          matchesStatus = p.records.some(r => {
            if (st === 'CONFORME') return isConforme(r.statusEHS);
            if (st === 'VENCE_30') return isAVencer(r.statusEHS);
            if (st === 'VENCIDO') return isVencido(r.statusEHS);
            if (st === 'AUSENTE') return isAusente(r.statusEHS);
            if (st === 'STORZ') return isStorz(r.statusEHS);
            return true;
          });
        }
        return matchesQuery && matchesSec && matchesStatus;
      });

      renderMatrix(filteredPeople);
      renderTable(filteredPeople, q, st);
      renderStorz(filteredPeople);
    }

    function renderMatrix(peopleList) {
      const headerRow = document.getElementById('matrixHeaderRow');
      headerRow.innerHTML = '<th class="th-sticky">Colaborador / Ramo</th>' + 
        priorityDocCodes.map(c => '<th>' + (docShortNames[c] || 'Doc ' + c) + '</th>').join('');

      const tbody = document.getElementById('matrixBody');
      tbody.innerHTML = '';

      if (peopleList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + (priorityDocCodes.length + 1) + '" style="padding:32px;color:var(--text-muted);text-align:center;">Nenhum colaborador encontrado.</td></tr>';
        return;
      }

      peopleList.forEach(p => {
        const tr = document.createElement('tr');
        
        let html = '<td class="td-sticky" onclick="openCollabModal(\\'' + p.name.replace(/'/g, "\\\\'") + '\\')">' +
          '<div>' + p.name + '</div>' +
          '<div style="font-size:10px;font-weight:500;color:var(--text-muted);">' + p.role + ' · ' + p.sector + '</div>' +
          '</td>';

        priorityDocCodes.forEach(code => {
          const r = p.records.find(rec => rec.docCode === code);
          html += '<td>' + renderBadge(r) + '</td>';
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
          if (st === 'CONFORME') matchStatus = isConforme(r.statusEHS);
          else if (st === 'VENCE_30') matchStatus = isAVencer(r.statusEHS);
          else if (st === 'VENCIDO') matchStatus = isVencido(r.statusEHS);
          else if (st === 'AUSENTE') matchStatus = isAusente(r.statusEHS);
          else if (st === 'STORZ') matchStatus = isStorz(r.statusEHS);

          if (matchStatus) rowsToDisplay.push(r);
        });
      });

      if (rowsToDisplay.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:32px;color:var(--text-muted);text-align:center;">Nenhum registro encontrado.</td></tr>';
        return;
      }

      rowsToDisplay.slice(0, 150).forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td style="text-align:left;"><strong>' + r.inspectorName + '</strong></td>' +
          '<td style="text-align:left;color:var(--text-muted);">' + (r.role || 'Técnico') + ' · ' + (r.sector || 'Operações') + '</td>' +
          '<td style="text-align:left;"><strong>' + r.docName + '</strong></td>' +
          '<td><span style="font-size:10px;background:var(--pill-bg);padding:2px 6px;border-radius:4px;">' + (r.modality || 'PRESENCIAL') + '</span></td>' +
          '<td>' + renderBadge(r) + '</td>' +
          '<td style="text-align:left;font-size:11px;color:var(--text-muted);">' + r.detail + '</td>';
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
        tbody.innerHTML = '<tr><td colspan="5" style="padding:32px;color:var(--text-muted);text-align:center;">Nenhuma solicitação ativa na Storz.</td></tr>';
        return;
      }

      storzRecords.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = 
          '<td style="text-align:left;"><strong>' + r.inspectorName + '</strong><div style="font-size:10px;color:var(--text-muted);">' + (r.sector || 'Operações') + '</div></td>' +
          '<td style="text-align:left;"><strong>' + r.docName + '</strong></td>' +
          '<td><span class="mono" style="font-weight:700;color:var(--brand-purple);">' + (r.storzRequestId || '—') + '</span></td>' +
          '<td><span class="badge storz">' + (r.storzState || 'EM ANDAMENTO') + '</span></td>' +
          '<td style="text-align:left;font-size:11px;color:var(--text-muted);">' + r.detail + '</td>';
        tbody.appendChild(tr);
      });
    }

    function openCollabModal(name) {
      const p = peopleMap.get(name);
      if (!p) return;

      document.getElementById('modalCollabName').innerText = p.name + ' (' + p.role + ' - ' + p.sector + ')';
      
      let html = '<table class="matrix-table" style="font-size:12px;">' +
        '<thead><tr><th style="text-align:left;">Treinamento / Documento</th><th>Status</th><th style="text-align:left;">Detalhes</th></tr></thead><tbody>';

      p.records.forEach(r => {
        html += '<tr>' +
          '<td style="text-align:left;"><strong>' + r.docName + '</strong></td>' +
          '<td>' + renderBadge(r) + '</td>' +
          '<td style="text-align:left;font-size:11px;color:var(--text-muted);">' + r.detail + '</td>' +
          '</tr>';
      });

      html += '</tbody></table>';
      document.getElementById('modalCollabContent').innerHTML = html;
      document.getElementById('collabModal').classList.add('show');
    }

    function closeModal() {
      document.getElementById('collabModal').classList.remove('show');
    }

    renderAll();
  </script>
</body>
</html>`;
}
