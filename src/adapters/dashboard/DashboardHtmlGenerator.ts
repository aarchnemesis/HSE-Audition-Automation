import { StorzRequest } from '../../domain/models/StorzRequest.js'
import { DriveRpoComparisonItem } from '../../domain/services/DriveRpoAuditor.js'
import { HSEDatabaseRecord } from '../../domain/services/HSEDatabaseRepository.js'

export interface SourceHealthInfo {
  status: 'ONLINE' | 'CACHE' | 'WARNING' | 'OFFLINE'
  message: string
  detail?: string
  lastSync?: string
}

export interface DashboardSourceHealth {
  drive?: SourceHealthInfo
  smartsheet?: SourceHealthInfo
  storz?: SourceHealthInfo
}

export interface DashboardExtraData {
  rpoDivergences?: DriveRpoComparisonItem[]
  storzHistory?: StorzRequest[]
  sourceHealth?: DashboardSourceHealth
}

export function buildDashboardHtml(
  records: HSEDatabaseRecord[],
  extraData: DashboardExtraData = {}
): string {
  const dataJson = JSON.stringify(records)
  const rpoDivergencesJson = JSON.stringify(extraData.rpoDivergences || [])
  const storzHistoryJson = JSON.stringify(extraData.storzHistory || [])
  const sourceHealthJson = JSON.stringify(extraData.sourceHealth || {})
  const auditDateStr = new Date().toLocaleDateString('pt-BR')

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

    /* SVG ICONS GLOBAL RESET & BASE STYLES */
    .ico, span.ico {
      width: 16px !important;
      height: 16px !important;
      min-width: 16px !important;
      min-height: 16px !important;
      max-width: 16px !important;
      max-height: 16px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      line-height: 1 !important;
      vertical-align: middle !important;
    }
    .ico svg, span.ico svg, svg.ico, svg.chip-svg, .badge svg, .storz-mini-tag svg, .group-header svg, .pill-opt svg {
      stroke: currentColor !important;
      fill: none !important;
      stroke-width: 2.2 !important;
      stroke-linecap: round !important;
      stroke-linejoin: round !important;
      display: inline-block;
      vertical-align: -2px;
      flex-shrink: 0;
    }
    .ico svg, span.ico svg {
      width: 16px !important;
      height: 16px !important;
      max-width: 16px !important;
      max-height: 16px !important;
    }
    svg.ico { width: 16px; height: 16px; }
    .ico-sm, svg.ico-sm { width: 14px !important; height: 14px !important; }
    .ico-xs, svg.ico-xs, .badge svg, .storz-mini-tag svg { width: 11px !important; height: 11px !important; margin-right: 3px; }
    .ico-inline, svg.ico-inline { display: inline-flex; vertical-align: -2px; margin-right: 4px; }

    /* CHIP ICONS */
    svg.chip-svg {
      width: 13px !important;
      height: 13px !important;
      margin-right: 2px;
      vertical-align: -2px;
    }

    /* SPECIFIC ACCENT COLORS FOR ICONS */
    .icon-crit { color: #EF4444 !important; stroke: #EF4444 !important; }
    .icon-warn { color: #F59E0B !important; stroke: #F59E0B !important; }
    .icon-ok { color: #10B981 !important; stroke: #10B981 !important; }
    .icon-storz { color: #8B5CF6 !important; stroke: #8B5CF6 !important; }
    .icon-req { color: #2563EB !important; stroke: #2563EB !important; }
    .icon-gray { color: #64748B !important; stroke: #64748B !important; }

    /* LEFT SIDEBAR */
    .sidebar {
      width: 230px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--sidebar-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      padding: 12px 10px;
      z-index: 20;
      transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), padding 0.22s ease;
      overflow-x: hidden;
      overflow-y: auto;
    }

    /* SIDEBAR COLLAPSED STATE */
    .sidebar.collapsed {
      width: 56px;
      padding: 12px 6px;
    }
    .sidebar.collapsed .brand-logo-wrap {
      display: none;
    }
    .sidebar.collapsed .sidebar-brand {
      justify-content: center;
      padding: 0 0 12px 0;
    }
    .sidebar.collapsed .nav-title {
      display: none;
    }
    .sidebar.collapsed .nav-item {
      padding: 0;
      justify-content: center;
      width: 42px;
      height: 38px;
      margin: 0 auto 4px auto;
    }
    .sidebar.collapsed .nav-item-title {
      justify-content: center;
      gap: 0;
      width: 100%;
    }
    .sidebar.collapsed .nav-item-title > span:not(.ico) {
      display: none;
    }
    .sidebar.collapsed .sidebar-collapse-btn svg {
      transform: rotate(180deg);
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 4px 12px 4px;
      border-bottom: 1px solid var(--sidebar-border);
      margin-bottom: 12px;
    }
    .brand-logo-wrap {
      background: #FFFFFF;
      padding: 4px 8px;
      border-radius: 6px;
      display: flex;
      align-items: center;
    }
    .brand-logo-img {
      height: 20px;
      width: auto;
      object-fit: contain;
    }
    .sidebar-collapse-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 6px;
      color: var(--sidebar-text);
      cursor: pointer;
      width: 26px;
      height: 26px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      flex-shrink: 0;
      padding: 0;
    }
    .sidebar-collapse-btn:hover {
      background: var(--sidebar-hover);
      color: #FFFFFF;
      border-color: rgba(255, 255, 255, 0.25);
    }
    .sidebar-collapse-btn svg {
      width: 14px;
      height: 14px;
      stroke-width: 2.5;
      transition: transform 0.22s ease;
    }

    .nav-section { margin-bottom: 14px; }
    .nav-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #475569;
      padding: 4px 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 10px;
      border-radius: 6px;
      color: var(--sidebar-text);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      margin-bottom: 2px;
      height: 36px;
      box-sizing: border-box;
      white-space: nowrap;
    }
    .nav-item-title {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
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
    .btn-sidebar-toggle {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid var(--card-border);
      background: #FFFFFF;
      color: var(--text-muted);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s;
      padding: 0;
      flex-shrink: 0;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .btn-sidebar-toggle:hover {
      background: #F1F5F9;
      color: var(--text-main);
      border-color: #CBD5E1;
    }
    .btn-sidebar-toggle svg {
      width: 14px !important;
      height: 14px !important;
      stroke-width: 2 !important;
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
      border-top: 3px solid transparent;
    }
    .kpi-box:hover { transform: translateY(-2px); box-shadow: 0 4px 10px rgba(15,23,42,0.06); }
    .kpi-box.active { border-color: var(--brand-blue); background: #F8FAFC; }
    .kpi-box.kpi-collab { border-top-color: #3B82F6; }
    .kpi-box.kpi-ok { border-top-color: #10B981; }
    .kpi-box.kpi-warn { border-top-color: #F59E0B; }
    .kpi-box.kpi-crit { border-top-color: #EF4444; }
    .kpi-box.kpi-ausente { border-top-color: #64748B; }
    .kpi-box.kpi-storz { border-top-color: #8B5CF6; }
    .kpi-box .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 2px; }
    .kpi-box .val { font-size: 24px; font-weight: 800; color: var(--text-main); line-height: 1.1; margin-bottom: 2px; }
    .kpi-box .sub { font-size: 11px; color: var(--text-muted); }

    /* QUICK CHIPS ROW */
    .quick-chips-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    .quick-chips-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-right: 4px;
    }
    .chip {
      background: #FFFFFF;
      border: 1px solid var(--card-border);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 600;
      padding: 0 10px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.15s;
      white-space: nowrap;
      box-sizing: border-box;
    }
    .chip:hover { border-color: #94A3B8; color: var(--text-main); }
    .chip.chip-action {
      background: #FEF2F2;
      border: 1px solid #FCA5A5;
      color: #DC2626;
      font-weight: 700;
    }
    .chip.chip-action:hover {
      background: #FEE2E2;
      border-color: #EF4444;
      color: #991B1B;
    }
    .chip.chip-action.active {
      background: #DC2626;
      color: #FFFFFF;
      border-color: #DC2626;
    }

    /* FRESHNESS BAR (SOURCE HEALTH) */
    .freshness-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 24px;
      background: #FFFFFF;
      border-bottom: 1px solid var(--card-border);
      flex-shrink: 0;
      font-size: 11px;
    }
    .freshness-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .freshness-title {
      font-size: 10px;
      font-weight: 800;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.6px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .source-pills-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .source-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 999px;
      background: #F8FAFC;
      border: 1px solid var(--card-border);
      font-size: 11px;
      font-weight: 600;
      color: var(--text-main);
      cursor: help;
      transition: all 0.15s;
    }
    .source-pill:hover {
      border-color: #94A3B8;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }
    .source-pill.ok {
      background: #F0FDF4;
      border-color: #BBF7D0;
      color: #166534;
    }
    .source-pill.cache {
      background: #FFFBEB;
      border-color: #FDE68A;
      color: #92400E;
    }
    .source-pill.warn {
      background: #FFFBEB;
      border-color: #FDE68A;
      color: #B45309;
    }
    .source-pill.crit {
      background: #FEF2F2;
      border-color: #FECACA;
      color: #991B1B;
    }
    .source-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .source-dot.ok { background: #10B981; box-shadow: 0 0 6px rgba(16, 185, 129, 0.6); }
    .source-dot.cache { background: #F59E0B; box-shadow: 0 0 6px rgba(245, 158, 11, 0.6); }
    .source-dot.warn { background: #F59E0B; box-shadow: 0 0 6px rgba(245, 158, 11, 0.6); }
    .source-dot.crit { background: #EF4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.6); }
    .source-name {
      color: var(--text-muted);
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
    }
    .source-status {
      font-weight: 700;
    }

    /* RPO AUDIT SUMMARY & BADGES */
    .rpo-summary-row {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 10px;
      margin-bottom: 10px;
      flex-shrink: 0;
    }
    .rpo-summary-card {
      background: #FFFFFF;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-left: 4px solid var(--text-muted);
    }
    .rpo-summary-card.total { border-left-color: var(--brand-blue); background: #F8FAFC; }
    .rpo-summary-card.crit { border-left-color: #EF4444; background: #FEF2F2; }
    .rpo-summary-card.warn { border-left-color: #F59E0B; background: #FFFBEB; }
    .rpo-summary-card.drive { border-left-color: #2563EB; background: #EFF6FF; }
    .rpo-summary-card.rpo { border-left-color: #8B5CF6; background: #FAF5FF; }
    .rpo-summary-val { font-size: 22px; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height: 1; }
    .rpo-summary-label { font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

    .diff-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
    }
    .diff-badge.somente-drive { background: #EFF6FF; color: #1D4ED8; border: 1px solid #BFDBFE; }
    .diff-badge.somente-storz { background: #FAF5FF; color: #7C3AED; border: 1px solid #E9D5FF; }
    .diff-badge.somente-rpo { background: #FFFBEB; color: #B45309; border: 1px solid #FDE68A; }
    .diff-badge.data-divergente { background: #FEE2E2; color: #DC2626; border: 1px solid #FECACA; }
    .diff-badge.consistente { background: #DCFCE7; color: #15803D; border: 1px solid #BBF7D0; }

    .action-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      background: #F1F5F9;
      color: #334155;
      border: 1px solid #E2E8F0;
    }
    .action-pill.action-rpo {
      background: #FEF2F2;
      color: #991B1B;
      border-color: #FCA5A5;
      font-weight: 700;
    }
    .action-pill.action-ok {
      background: #F0FDF4;
      color: #166534;
      border-color: #BBF7D0;
    }

    /* STORZ SUB-FILTERS GROUP */
    .storz-filter-strip {
      display: flex;
      align-items: center;
      gap: 14px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .storz-filter-group {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .storz-filter-label {
      font-size: 10px;
      font-weight: 800;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }

    /* STORZ SUMMARY ROW IN VIEW 3 */
    .storz-summary-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 10px;
      flex-shrink: 0;
    }
    .storz-summary-card {
      background: #FFFFFF;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 14px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      border-left: 4px solid var(--text-muted);
    }
    .storz-summary-card.in-progress { border-left-color: #8B5CF6; background: #FAF5FF; }
    .storz-summary-card.requested { border-left-color: #3B82F6; background: #F0F9FF; }
    .storz-summary-card.completed { border-left-color: #10B981; background: #F0FDF4; }
    .storz-summary-val { font-size: 22px; font-weight: 800; font-family: 'JetBrains Mono', monospace; line-height: 1; }
    .storz-summary-label { font-size: 10px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; }

    /* SUPER-HEADER GROUPS IN MATRIX */
    .group-header {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 6px 8px;
      border-right: 1px solid var(--card-border);
      border-bottom: 2px solid var(--card-border);
    }
    .group-saude { background: #ECFDF5; color: #047857; }
    .group-eletrica { background: #EFF6FF; color: #1D4ED8; }
    .group-altura { background: #FFFBEB; color: #B45309; }
    .group-gwo { background: #F5F3FF; color: #6D28D9; }
    .group-collab { background: #F8FAFC; color: var(--text-muted); }

    /* COLLABORATOR STICKY ROW DESIGN */
    .collab-avatar {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #E2E8F0;
      color: #334155;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .collab-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .collab-storz-pill {
      background: #EDE9FE;
      color: #6D28D9;
      border: 1px solid #DDD6FE;
      border-radius: 999px;
      font-size: 9px;
      font-weight: 700;
      padding: 0 5px;
      white-space: nowrap;
    }

    /* BADGE STACK & MINI TAGS */
    .badge-stack {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    }
    .storz-mini-tag {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 700;
      white-space: nowrap;
      line-height: 1.1;
    }
    .storz-mini-tag.in-prog { background: #EDE9FE; color: #6D28D9; border: 1px solid #DDD6FE; }
    .storz-mini-tag.req { background: #EFF6FF; color: #1D4ED8; border: 1px solid #DBEAFE; }
    .storz-mini-tag.done { background: #DCFCE7; color: #15803D; border: 1px solid #BBF7D0; }
    .storz-badge-pill {
      background: #8B5CF6;
      color: #FFFFFF;
      font-size: 10px;
      font-weight: 800;
      padding: 1px 6px;
      border-radius: 999px;
      margin-left: 4px;
    }

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
      <button class="sidebar-collapse-btn" id="sidebarCollapseBtn" onclick="toggleSidebar()" title="Recolher / Expandir Menu Lateral (Alt+S)">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
    </div>

    <div class="nav-section">
      <div class="nav-title">EHS &amp; Treinamentos</div>
      <div class="nav-item active" onclick="switchNav('matrix')" title="Skill Matrix (DO)">
        <div class="nav-item-title">
          <span class="ico"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M2 12h20"/><path d="M6 8v8"/><path d="M10 8v8"/><path d="M14 8v8"/><path d="M18 8v8"/></svg></span>
          <span>Skill Matrix (DO)</span>
        </div>
      </div>

      <div class="nav-item" onclick="switchNav('table')" title="Gestão de Pendências">
        <div class="nav-item-title">
          <span class="ico"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>
          <span>Gestão de Pendências</span>
        </div>
      </div>

      <div class="nav-item" onclick="switchNav('rpo')" title="Auditoria RPO (Smartsheet x Confiáveis)">
        <div class="nav-item-title">
          <span class="ico"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg></span>
          <span>Auditoria RPO</span>
        </div>
        <span class="storz-badge-pill" id="rpoBadgeSidebar" style="background:#EF4444;display:none;">0</span>
      </div>

      <div class="nav-item" onclick="switchNav('storz')" title="Storz Matrículas">
        <div class="nav-item-title">
          <span class="ico"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg></span>
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
        <button class="btn-sidebar-toggle" onclick="toggleSidebar()" title="Recolher / Expandir Menu Lateral (Alt+S)">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
        </button>
        <div class="breadcrumb-pill">ArthWind &gt; Skill Matrix &amp; EHS Compliance</div>
      </div>

      <div class="topbar-filters">
        <div class="filter-group">
          <span class="filter-label">Visualização:</span>
          <span class="pill-opt active" onclick="switchNav('matrix')"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>Matriz NRs</span>
          <span class="pill-opt" onclick="switchNav('table')"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Tabela Analítica</span>
          <span class="pill-opt" onclick="switchNav('rpo')"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>Auditoria RPO <span class="storz-badge-pill" id="rpoBadgeTab" style="background:#EF4444;display:none;">0</span></span>
          <span class="pill-opt" onclick="switchNav('storz')"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>Storz Matrículas <span class="storz-badge-pill" id="storzBadgeTab">0</span></span>
        </div>
      </div>
    </div>

    <!-- FRESHNESS / SOURCE HEALTH BAR -->
    <div class="freshness-bar" id="freshnessBar">
      <div class="freshness-left">
        <span class="freshness-title">
          <svg class="ico ico-xs ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
          Saúde das Fontes:
        </span>
        <div class="source-pills-wrap" id="sourcePillsWrap">
          <!-- Drive Pill -->
          <div class="source-pill ok" id="sourcePillDrive" title="Google Drive: Arquivos e pastas de certificados">
            <span class="source-dot ok" id="sourceDotDrive"></span>
            <svg class="ico ico-xs" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span class="source-name">Drive</span>
            <span class="source-status" id="sourceStatusDrive">Conectado</span>
          </div>
          <!-- Smartsheet Pill -->
          <div class="source-pill ok" id="sourcePillSmartsheet" title="Smartsheet RPO: Planilha operacional">
            <span class="source-dot ok" id="sourceDotSmartsheet"></span>
            <svg class="ico ico-xs" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span class="source-name">Smartsheet RPO</span>
            <span class="source-status" id="sourceStatusSmartsheet">Conectado</span>
          </div>
          <!-- Storz Pill -->
          <div class="source-pill ok" id="sourcePillStorz" title="Storz LMS: Plataforma de treinamentos online e presencial">
            <span class="source-dot ok" id="sourceDotStorz"></span>
            <svg class="ico ico-xs" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
            <span class="source-name">Storz LMS</span>
            <span class="source-status" id="sourceStatusStorz">Ao Vivo (REST API)</span>
          </div>
        </div>
      </div>
      <div class="mono" style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;">
        <svg class="ico ico-xs" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Ref: <span id="freshnessTimestamp">${auditDateStr}</span></span>
      </div>
    </div>

    <!-- PAGE TITLE BAR -->
    <div class="page-title-bar">
      <div>
        <h2 id="pageHeading">Matriz de Qualificação &amp; Treinamentos Normativos (DO)</h2>
        <p>Acompanhamento executivo de conformidade legal de NRs, GWO BST, ASO e reciclagens por colaborador de campo</p>
      </div>
      <div class="mono" style="font-size: 11px; font-weight: 700; color: var(--text-muted); display: flex; align-items: center; gap: 8px;">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: #10B981; box-shadow: 0 0 8px #10B981; display: inline-block;"></span>
        STATUS: <span style="color: var(--brand-green); font-weight: 800;" id="liveAuditDate">AUDITADO EM ${auditDateStr}</span>
      </div>
    </div>

    <!-- CONTENT BODY -->
    <div class="content-body">
      
      <!-- 6 KPIS ROW -->
      <div class="kpi-row">
        <div class="kpi-box kpi-collab" id="kpiBox-ALL" onclick="applyStatusFilter('ALL')">
          <div class="label">Colaboradores</div>
          <div class="val mono" id="kpiTotalPeople">0</div>
          <div class="sub">Universo auditado (Campo)</div>
        </div>

        <div class="kpi-box kpi-ok" id="kpiBox-CONFORME" onclick="applyStatusFilter('CONFORME')">
          <div class="label">Em Dia</div>
          <div class="val mono" style="color: var(--brand-green);" id="kpiOkCount">0</div>
          <div class="sub" id="kpiComplianceRate">0% em conformidade</div>
        </div>

        <div class="kpi-box kpi-warn" id="kpiBox-VENCE_30" onclick="applyStatusFilter('VENCE_30')">
          <div class="label">Reciclagens (&lt;30d)</div>
          <div class="val mono" style="color: var(--brand-amber);" id="kpiWarnCount">0</div>
          <div class="sub">Prioridade de agendamento</div>
        </div>

        <div class="kpi-box kpi-crit" id="kpiBox-VENCIDO" onclick="applyStatusFilter('VENCIDO')">
          <div class="label">Vencidos (no Drive)</div>
          <div class="val mono" style="color: var(--brand-coral);" id="kpiCritCount">0</div>
          <div class="sub">Documento expirado</div>
        </div>

        <div class="kpi-box kpi-ausente" id="kpiBox-AUSENTE" onclick="applyStatusFilter('AUSENTE')">
          <div class="label">Ausentes (sem Doc)</div>
          <div class="val mono" style="color: #64748B;" id="kpiAusenteCount">0</div>
          <div class="sub">Não encontrado no Drive</div>
        </div>

        <div class="kpi-box kpi-storz" id="kpiBox-STORZ" onclick="applyStatusFilter('STORZ')">
          <div class="label">Storz Ativas</div>
          <div class="val mono" style="color: var(--brand-purple);" id="kpiStorzCount">0</div>
          <div class="sub" id="kpiStorzSub">Matrículas ativas</div>
        </div>
      </div>

      <!-- QUICK CHIPS & SEARCH BAR -->
      <div class="quick-chips-row">
        <span class="quick-chips-label">Filtros Rápidos:</span>
        <button class="chip active" id="chip-ALL" onclick="applyStatusFilter('ALL')"><svg class="chip-svg icon-gray" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Todos (<span id="chipAllCount">0</span>)</button>
        <button class="chip chip-action" id="chip-ACTION" onclick="applyStatusFilter('ACTION')" title="Filtrar pendências que demandam intervenção humana imediata"><svg class="chip-svg icon-crit" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Ação Necessária (<span id="chipActionCount">0</span>)</button>
        <button class="chip chip-crit" id="chip-VENCIDO" onclick="applyStatusFilter('VENCIDO')"><svg class="chip-svg icon-crit" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Com Vencidos</button>
        <button class="chip chip-warn" id="chip-VENCE_30" onclick="applyStatusFilter('VENCE_30')"><svg class="chip-svg icon-warn" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>A Vencer (&lt;30d)</button>
        <button class="chip chip-storz" id="chip-STORZ" onclick="applyStatusFilter('STORZ')"><svg class="chip-svg icon-storz" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>Com Storz Ativa (<span id="chipStorzCount">0</span>)</button>
        <button class="chip chip-ok" id="chip-CONFORME" onclick="applyStatusFilter('CONFORME')"><svg class="chip-svg icon-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>100% Em Dia</button>
      </div>

      <!-- CONTROLS -->
      <div class="controls-strip">
        <input type="search" id="searchInput" class="search-input" placeholder="Buscar colaborador, cargo ou setor..." oninput="renderAll()">
        <div style="display:flex; gap:8px;">
          <select id="sectorFilter" class="select-filter" onchange="renderAll()">
            <option value="ALL">Todos os Ramos / Setores</option>
          </select>
          <select id="statusFilter" class="select-filter" onchange="onSelectStatusFilter(this.value)">
            <option value="ALL">Todos os Status</option>
            <option value="ACTION">Ação Necessária (Intervenção Humana)</option>
            <option value="CONFORME">Em Dia / Conforme</option>
            <option value="VENCE_30">A Vencer (&lt;30 dias)</option>
            <option value="VENCIDO">Vencido (no Drive)</option>
            <option value="AUSENTE">Ausente (não está no Drive)</option>
            <option value="STORZ">Com Matrícula Ativa Storz</option>
          </select>
        </div>
      </div>

      <!-- VIEW 1: MATRIX -->
      <div id="view-matrix" class="tab-view active">
        <div class="card">
          <div class="table-container">
            <table class="matrix-table" id="matrixTable">
              <thead id="matrixHead">
                <tr id="matrixGroupRow">
                  <th class="th-sticky group-collab">COLABORADOR / RAMO</th>
                  <th colspan="4" class="group-header group-saude"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>Saúde &amp; Integração</th>
                  <th colspan="4" class="group-header group-eletrica"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>Elétrica &amp; Máquinas</th>
                  <th colspan="6" class="group-header group-altura"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Altura, Espaço &amp; CIPA</th>
                  <th colspan="6" class="group-header group-gwo"><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/></svg>Módulos GWO &amp; Específicos</th>
                </tr>
                <tr id="matrixHeaderRow"></tr>
              </thead>
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

      <!-- VIEW 3: AUDITORIA RPO -->
      <div id="view-rpo" class="tab-view">
        <div class="rpo-summary-row">
          <div class="rpo-summary-card total" onclick="filterRpoSubTab('ALL')" style="cursor:pointer;" title="Ver todos os registros comparados">
            <div class="rpo-summary-val mono" id="rpoKpiTotal" style="color:var(--brand-blue);">0</div>
            <div class="rpo-summary-label">Total Comparados</div>
          </div>
          <div class="rpo-summary-card crit" onclick="filterRpoSubTab('ALL_DIV')" style="cursor:pointer;" title="Filtrar todas as divergências ativas">
            <div class="rpo-summary-val mono" id="rpoKpiDivergences" style="color:#EF4444;">0</div>
            <div class="rpo-summary-label"><svg class="chip-svg icon-crit" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Divergências Ativas</div>
          </div>
          <div class="rpo-summary-card warn" onclick="filterRpoSubTab('DATA_DIVERGENTE')" style="cursor:pointer;" title="Filtrar apenas datas divergentes (erros de digitação)">
            <div class="rpo-summary-val mono" id="rpoKpiDataDivergente" style="color:#F59E0B;">0</div>
            <div class="rpo-summary-label"><svg class="chip-svg icon-warn" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Datas Divergentes</div>
          </div>
          <div class="rpo-summary-card drive" onclick="filterRpoSubTab('SOMENTE_DRIVE')" style="cursor:pointer;" title="Filtrar registros presentes apenas no Drive">
            <div class="rpo-summary-val mono" id="rpoKpiSomenteDrive" style="color:#2563EB;">0</div>
            <div class="rpo-summary-label"><svg class="chip-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Só no Drive / Storz</div>
          </div>
          <div class="rpo-summary-card rpo" onclick="filterRpoSubTab('SOMENTE_RPO')" style="cursor:pointer;" title="Filtrar registros que constam na RPO mas não têm documento">
            <div class="rpo-summary-val mono" id="rpoKpiSomenteRpo" style="color:#8B5CF6;">0</div>
            <div class="rpo-summary-label"><svg class="chip-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>Só na RPO (Sem Doc)</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
            <h3><svg class="ico ico-sm ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>Auditoria de Digitação: Fontes Confiáveis (Drive + Storz) vs Planilha RPO</h3>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="chip active" id="rpoChip-ALL_DIV" onclick="filterRpoSubTab('ALL_DIV')">Só Divergências (<span id="rpoChipDivCount">0</span>)</button>
              <button class="chip chip-crit" id="rpoChip-DATA_DIVERGENTE" onclick="filterRpoSubTab('DATA_DIVERGENTE')"><svg class="chip-svg icon-crit" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Datas Divergentes</button>
              <button class="chip" id="rpoChip-SOMENTE_DRIVE" onclick="filterRpoSubTab('SOMENTE_DRIVE')"><svg class="chip-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Só Drive</button>
              <button class="chip" id="rpoChip-SOMENTE_STORZ" onclick="filterRpoSubTab('SOMENTE_STORZ')"><svg class="chip-svg icon-storz" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/></svg>Só Storz</button>
              <button class="chip" id="rpoChip-SOMENTE_RPO" onclick="filterRpoSubTab('SOMENTE_RPO')"><svg class="chip-svg" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>Só RPO</button>
              <button class="chip chip-warn" id="rpoChip-DIFF_30" onclick="filterRpoSubTab('DIFF_30')"><svg class="chip-svg icon-warn" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>Diferença &gt; 30d</button>
              <button class="chip" id="rpoChip-ALL" onclick="filterRpoSubTab('ALL')">Todos os Registros</button>
            </div>
          </div>
          <div class="table-container">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th style="text-align:left;">Colaborador</th>
                  <th style="text-align:left;">Documento / Treinamento</th>
                  <th>Tipo de Divergência</th>
                  <th>Validade Confiável</th>
                  <th>Validade RPO</th>
                  <th>Diferença</th>
                  <th style="text-align:left;">Ação Recomendada</th>
                </tr>
              </thead>
              <tbody id="rpoTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- VIEW 4: STORZ -->
      <div id="view-storz" class="tab-view">
        <div class="storz-summary-row">
          <div class="storz-summary-card">
            <div class="storz-summary-val mono" id="storzSummaryTotal" style="color:var(--brand-purple);">0</div>
            <div class="storz-summary-label">Total Matrículas Ativas</div>
          </div>
          <div class="storz-summary-card in-progress">
            <div class="storz-summary-val mono" id="storzSummaryInProgress" style="color:#7C3AED;">0</div>
            <div class="storz-summary-label"><svg class="chip-svg icon-storz" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Em Andamento (Iniciados)</div>
          </div>
          <div class="storz-summary-card requested">
            <div class="storz-summary-val mono" id="storzSummaryRequested" style="color:#2563EB;">0</div>
            <div class="storz-summary-label"><svg class="chip-svg icon-req" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>Solicitados (Aguardando)</div>
          </div>
          <div class="storz-summary-card completed">
            <div class="storz-summary-val mono" id="storzSummaryCompleted" style="color:#10B981;">0</div>
            <div class="storz-summary-label"><svg class="chip-svg icon-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Concluídos Recentes</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; flex-wrap:wrap; gap:8px;">
            <h3><svg class="ico ico-sm ico-inline icon-storz" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>Painel de Gestão e Monitoramento de Treinamentos Storz</h3>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button class="chip active" id="storzSubTab-ALL" onclick="filterStorzSubTab('ALL')">Todas as Ativas</button>
              <button class="chip chip-storz" id="storzSubTab-EM_ANDAMENTO" onclick="filterStorzSubTab('EM_ANDAMENTO')"><svg class="chip-svg icon-storz" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>Em Andamento</button>
              <button class="chip" id="storzSubTab-SOLICITADO" onclick="filterStorzSubTab('SOLICITADO')"><svg class="chip-svg icon-req" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>Solicitadas</button>
              <button class="chip chip-crit" id="storzSubTab-REPROVADO" onclick="filterStorzSubTab('REPROVADO')"><svg class="chip-svg icon-crit" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>Reprovados (Reteste)</button>
              <button class="chip chip-ok" id="storzSubTab-CONCLUIDO" onclick="filterStorzSubTab('CONCLUIDO')"><svg class="chip-svg icon-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Concluídas / Aprovados</button>
            </div>
          </div>
          <!-- PROGRESS BRACKET FILTER STRIP -->
          <div class="storz-filter-strip">
            <div class="storz-filter-group">
              <span class="storz-filter-label">Faixa de Progresso:</span>
              <button class="chip active" id="storzProg-ALL" onclick="filterStorzProg('ALL')">Todos</button>
              <button class="chip" id="storzProg-0" onclick="filterStorzProg('0')">0% (Não iniciado)</button>
              <button class="chip" id="storzProg-1_49" onclick="filterStorzProg('1_49')">1% a 49%</button>
              <button class="chip" id="storzProg-50_99" onclick="filterStorzProg('50_99')">50% a 99%</button>
              <button class="chip chip-ok" id="storzProg-100" onclick="filterStorzProg('100')">100% (Concluído)</button>
            </div>
          </div>
          <div class="table-container">
            <table class="matrix-table">
              <thead>
                <tr>
                  <th style="text-align:left;">Colaborador</th>
                  <th style="text-align:left;">Curso Solicitado</th>
                  <th>Storz ID</th>
                  <th>Status / Situação</th>
                  <th style="min-width:130px;">Progresso (%)</th>
                  <th>Prazo Limite Storz</th>
                  <th style="text-align:left;">Detalhe Operacional &amp; Ritmo</th>
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
    const rawRpoDivergences = ${rpoDivergencesJson};
    const rawStorzHistory = ${storzHistoryJson};
    const sourceHealth = ${sourceHealthJson};

    const SVG_ICONS = {
      check: '<svg class="ico ico-xs ico-inline" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
      clock: '<svg class="ico ico-xs ico-inline" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><polyline points="12 7 12 12 15.5 14"/></svg>',
      alert: '<svg class="ico ico-xs ico-inline" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      x: '<svg class="ico ico-xs ico-inline" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      cap: '<svg class="ico ico-xs ico-inline" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
      minus: '<svg class="ico ico-xs ico-inline" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'
    };

    const priorityDocCodes = [
      // Saude & Integracao (4)
      '01', '08', '10', '11',
      // Eletrica & Maquinas (4)
      '12', '13', '14', '15',
      // Altura, Espaco & CIPA (6)
      '18', '20', '28', '21', '22', '34',
      // Modulos GWO & Especificos (6)
      '16', '17', '19', '30', '31', '32'
    ];
    const docShortNames = {
      '01': 'ASO',
      '08': 'CNH',
      '10': 'NR-01 Integ',
      '11': 'NR-06 EPI',
      '12': 'NR-10 Básico',
      '13': 'NR-10 SEP',
      '14': 'NR-11 Talha',
      '15': 'NR-12 Máquinas',
      '16': 'GWO 1º Soc',
      '17': 'GWO Ergo',
      '18': 'NR-18 Const',
      '19': 'GWO Fogo',
      '20': 'NR-33 Vigia',
      '21': 'NR-35 Altura',
      '22': 'LOTO',
      '25': 'SIT Vestas',
      '26': 'ESO Vestas',
      '28': 'NR-33 Sup',
      '30': 'GWO WINDA',
      '31': 'JASO Elevador',
      '32': 'GWO ART',
      '34': 'CIPA (NR-05)'
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

    function isStorzActive(r) {
      if (!r) return false;
      return Boolean(
        (r.storzRequestId && (r.storzState === 'EM_ANDAMENTO' || r.storzState === 'SOLICITADO')) ||
        r.statusEHS === 'SOLICITADO_STORZ' ||
        r.statusEHS === 'STORZ_EM_ANDAMENTO'
      );
    }

    function renderBadge(r) {
      if (!r) return '<span class="badge na">—</span>';

      const activeStorz = isStorzActive(r);
      let storzTag = '';
      if (activeStorz) {
        if (r.storzState === 'EM_ANDAMENTO') {
          const prog = r.storzProgressPercent !== undefined ? r.storzProgressPercent : 0;
          storzTag = '<span class="storz-mini-tag in-prog" title="Storz: Em andamento (' + prog + '%) | ' + (r.storzDeadline ? 'Prazo: ' + r.storzDeadline : '') + '">' + SVG_ICONS.cap + prog + '%</span>';
        } else {
          storzTag = '<span class="storz-mini-tag req" title="Storz: Solicitado (Aguardando início)">' + SVG_ICONS.cap + 'Solicitado</span>';
        }
      } else if (r.storzState === 'CONCLUIDO' && r.statusEHS === 'CONFORME' && (r.detail || '').includes('Storz')) {
        storzTag = '<span class="storz-mini-tag done" title="Concluído e Aprovado na Storz">' + SVG_ICONS.cap + 'Storz OK</span>';
      }

      let mainBadge = '';
      if (r.statusEHS === 'CONFORME') {
        mainBadge = '<span class="badge ok" title="' + r.detail + '">' + SVG_ICONS.check + 'Em Dia</span>';
      } else if (r.statusEHS === 'VENCE_60') {
        mainBadge = '<span class="badge warn" style="background:rgba(37,99,235,0.1); color:#2563EB;" title="' + r.detail + '">' + SVG_ICONS.clock + '&lt;60d</span>';
      } else if (r.statusEHS === 'VENCE_30') {
        mainBadge = '<span class="badge warn" title="' + r.detail + '">' + SVG_ICONS.clock + '&lt;30d</span>';
      } else if (r.statusEHS === 'VENCE_15') {
        mainBadge = '<span class="badge warn" style="background:#FEF3C7; color:#D97706; font-weight:800;" title="' + r.detail + '">' + SVG_ICONS.clock + '&lt;15d</span>';
      } else if (r.statusEHS === 'VENCE_07') {
        mainBadge = '<span class="badge warn" style="background:#FEE2E2; color:#DC2626; font-weight:800;" title="' + r.detail + '">' + SVG_ICONS.alert + '&lt;7d</span>';
      } else if (r.statusEHS === 'SOLICITADO_STORZ' || r.statusEHS === 'STORZ_EM_ANDAMENTO') {
        mainBadge = '<span class="badge storz" title="' + r.detail + '">' + SVG_ICONS.cap + 'Storz</span>';
      } else if (r.statusEHS === 'AUSENTE') {
        mainBadge = '<span class="badge ausente" title="' + (r.detail || 'Não encontrado no Drive') + '">' + SVG_ICONS.minus + 'Ausente</span>';
      } else if (r.statusEHS === 'VENCIDO') {
        mainBadge = '<span class="badge danger" title="' + r.detail + '">' + SVG_ICONS.x + 'Vencido</span>';
      } else {
        mainBadge = '<span class="badge na" title="' + r.detail + '">—</span>';
      }

      if (storzTag) {
        return '<div class="badge-stack">' + mainBadge + storzTag + '</div>';
      }
      return mainBadge;
    }

    function needsAction(r) {
      if (!r) return false;
      if (isVencido(r.statusEHS)) return true;
      if (isAVencer(r.statusEHS)) return true;
      if (isAusente(r.statusEHS) && !isStorzActive(r)) return true;
      return false;
    }

    const totalPeople = peopleMap.size;
    let okCount = 0, warnCount = 0, critCount = 0, ausenteCount = 0;
    let storzTotalActive = 0, storzInProgress = 0, storzRequested = 0, storzCompleted = 0;

    rawData.forEach(r => {
      if (isConforme(r.statusEHS)) okCount++;
      else if (isAVencer(r.statusEHS)) warnCount++;
      else if (isVencido(r.statusEHS)) critCount++;
      else if (isAusente(r.statusEHS)) ausenteCount++;

      if (isStorzActive(r)) {
        storzTotalActive++;
        if (r.storzState === 'EM_ANDAMENTO') storzInProgress++;
        else storzRequested++;
      } else if (r.storzState === 'CONCLUIDO') {
        storzCompleted++;
      }
    });

    const peopleWithStorzCount = Array.from(peopleMap.values()).filter(p => p.records.some(isStorzActive)).length;
    const peopleNeedingActionCount = Array.from(peopleMap.values()).filter(p => p.records.some(needsAction)).length;

    document.getElementById('kpiTotalPeople').innerText = totalPeople;
    document.getElementById('kpiOkCount').innerText = okCount;
    document.getElementById('kpiComplianceRate').innerText = Math.round((okCount / (rawData.length || 1)) * 100) + '% em conformidade';
    document.getElementById('kpiWarnCount').innerText = warnCount;
    document.getElementById('kpiCritCount').innerText = critCount;
    if (document.getElementById('kpiAusenteCount')) document.getElementById('kpiAusenteCount').innerText = ausenteCount;
    document.getElementById('kpiStorzCount').innerText = storzTotalActive;
    if (document.getElementById('kpiStorzSub')) {
      document.getElementById('kpiStorzSub').innerText = storzInProgress + ' em andamento · ' + storzRequested + ' solicitadas';
    }
    if (document.getElementById('storzBadgeTab')) document.getElementById('storzBadgeTab').innerText = storzTotalActive;
    if (document.getElementById('chipAllCount')) document.getElementById('chipAllCount').innerText = totalPeople;
    if (document.getElementById('chipActionCount')) document.getElementById('chipActionCount').innerText = peopleNeedingActionCount;
    if (document.getElementById('chipStorzCount')) document.getElementById('chipStorzCount').innerText = peopleWithStorzCount;
    if (document.getElementById('storzSummaryTotal')) document.getElementById('storzSummaryTotal').innerText = storzTotalActive;
    if (document.getElementById('storzSummaryInProgress')) document.getElementById('storzSummaryInProgress').innerText = storzInProgress;
    if (document.getElementById('storzSummaryRequested')) document.getElementById('storzSummaryRequested').innerText = storzRequested;
    if (document.getElementById('storzSummaryCompleted')) document.getElementById('storzSummaryCompleted').innerText = storzCompleted;

    // RPO AUDIT KPIS & BADGES
    const rpoDivergentCount = rawRpoDivergences.filter(d => d.divergent).length;
    let rpoDataDivergenteCount = 0, rpoSomenteDriveCount = 0, rpoSomenteStorzCount = 0, rpoSomenteRpoCount = 0;
    rawRpoDivergences.forEach(d => {
      if (!d.divergent) return;
      if (d.divergenceKind === 'DATA_DIVERGENTE') rpoDataDivergenteCount++;
      else if (d.divergenceKind === 'SOMENTE_DRIVE') rpoSomenteDriveCount++;
      else if (d.divergenceKind === 'SOMENTE_STORZ') rpoSomenteStorzCount++;
      else if (d.divergenceKind === 'SOMENTE_RPO') rpoSomenteRpoCount++;
    });

    if (document.getElementById('rpoBadgeSidebar')) {
      const badge = document.getElementById('rpoBadgeSidebar');
      badge.innerText = rpoDivergentCount;
      badge.style.display = rpoDivergentCount > 0 ? 'inline-block' : 'none';
    }
    if (document.getElementById('rpoBadgeTab')) {
      const badge = document.getElementById('rpoBadgeTab');
      badge.innerText = rpoDivergentCount;
      badge.style.display = rpoDivergentCount > 0 ? 'inline-block' : 'none';
    }
    if (document.getElementById('rpoKpiTotal')) document.getElementById('rpoKpiTotal').innerText = rawRpoDivergences.length;
    if (document.getElementById('rpoKpiDivergences')) document.getElementById('rpoKpiDivergences').innerText = rpoDivergentCount;
    if (document.getElementById('rpoKpiDataDivergente')) document.getElementById('rpoKpiDataDivergente').innerText = rpoDataDivergenteCount;
    if (document.getElementById('rpoKpiSomenteDrive')) document.getElementById('rpoKpiSomenteDrive').innerText = rpoSomenteDriveCount + rpoSomenteStorzCount;
    if (document.getElementById('rpoKpiSomenteRpo')) document.getElementById('rpoKpiSomenteRpo').innerText = rpoSomenteRpoCount;
    if (document.getElementById('rpoChipDivCount')) document.getElementById('rpoChipDivCount').innerText = rpoDivergentCount;

    // RENDER FRESHNESS BAR
    function renderFreshnessBar() {
      if (!sourceHealth || Object.keys(sourceHealth).length === 0) return;

      const driveInfo = sourceHealth.drive;
      if (driveInfo) {
        const dot = document.getElementById('sourceDotDrive');
        const pill = document.getElementById('sourcePillDrive');
        const status = document.getElementById('sourceStatusDrive');
        if (dot && pill && status) {
          const isOk = driveInfo.status === 'ONLINE';
          dot.className = 'source-dot ' + (isOk ? 'ok' : 'warn');
          pill.className = 'source-pill ' + (isOk ? 'ok' : 'warn');
          status.innerText = driveInfo.message || (isOk ? 'Conectado' : 'Aviso');
          if (driveInfo.detail) pill.title = driveInfo.detail;
        }
      }

      const smartInfo = sourceHealth.smartsheet;
      if (smartInfo) {
        const dot = document.getElementById('sourceDotSmartsheet');
        const pill = document.getElementById('sourcePillSmartsheet');
        const status = document.getElementById('sourceStatusSmartsheet');
        if (dot && pill && status) {
          const isOk = smartInfo.status === 'ONLINE';
          dot.className = 'source-dot ' + (isOk ? 'ok' : 'warn');
          pill.className = 'source-pill ' + (isOk ? 'ok' : 'warn');
          status.innerText = smartInfo.message || (isOk ? 'Conectado' : 'Offline');
          if (smartInfo.detail) pill.title = smartInfo.detail;
        }
      }

      const storzInfo = sourceHealth.storz;
      if (storzInfo) {
        const dot = document.getElementById('sourceDotStorz');
        const pill = document.getElementById('sourcePillStorz');
        const status = document.getElementById('sourceStatusStorz');
        if (dot && pill && status) {
          const isLive = storzInfo.status === 'ONLINE';
          dot.className = 'source-dot ' + (isLive ? 'ok' : 'cache');
          pill.className = 'source-pill ' + (isLive ? 'ok' : 'cache');
          status.innerText = storzInfo.message || (isLive ? 'Ao Vivo (REST API)' : 'Cache Persistente');
          if (storzInfo.detail) pill.title = storzInfo.detail;
        }
      }
    }
    renderFreshnessBar();

    function toggleSidebar() {
      const sidebar = document.querySelector('.sidebar');
      if (!sidebar) return;
      const isCollapsed = sidebar.classList.toggle('collapsed');
      localStorage.setItem('hse_sidebar_collapsed', isCollapsed ? 'true' : 'false');
    }

    if (localStorage.getItem('hse_sidebar_collapsed') === 'true') {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) sidebar.classList.add('collapsed');
    }

    window.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        toggleSidebar();
      }
    });

    function switchNav(viewKey) {
      document.querySelectorAll('.sidebar .nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.topbar .pill-opt').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));

      const views = ['matrix', 'table', 'rpo', 'storz'];
      const idx = views.indexOf(viewKey);

      const navs = document.querySelectorAll('.sidebar .nav-item');
      if (navs[idx]) navs[idx].classList.add('active');

      const pills = document.querySelectorAll('.topbar .pill-opt');
      if (pills[idx]) pills[idx].classList.add('active');

      const view = document.getElementById('view-' + viewKey);
      if (view) view.classList.add('active');

      const heading = document.getElementById('pageHeading');
      if (heading) {
        if (viewKey === 'matrix') heading.innerText = 'Matriz de Qualificação & Treinamentos Normativos (DO)';
        else if (viewKey === 'table') heading.innerText = 'Gestão Analítica de Pendências & Conformidade EHS';
        else if (viewKey === 'rpo') heading.innerText = 'Auditoria RPO: Fontes Confiáveis (Drive + Storz) vs Smartsheet';
        else if (viewKey === 'storz') heading.innerText = 'Painel de Gestão e Monitoramento de Treinamentos Storz';
      }

      if (viewKey === 'rpo') renderRpoTable();
    }

    function onSelectStatusFilter(st) {
      applyStatusFilter(st);
    }

    function applyStatusFilter(st) {
      document.querySelectorAll('.kpi-box').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));

      const kpiBox = document.getElementById('kpiBox-' + st);
      if (kpiBox) kpiBox.classList.add('active');

      const chip = document.getElementById('chip-' + st);
      if (chip) chip.classList.add('active');

      const statusSelect = document.getElementById('statusFilter');
      if (statusSelect) statusSelect.value = st;
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
            if (st === 'ACTION') return needsAction(r);
            if (st === 'CONFORME') return isConforme(r.statusEHS);
            if (st === 'VENCE_30') return isAVencer(r.statusEHS);
            if (st === 'VENCIDO') return isVencido(r.statusEHS);
            if (st === 'AUSENTE') return isAusente(r.statusEHS);
            if (st === 'STORZ') return isStorzActive(r);
            return true;
          });
        }
        return matchesQuery && matchesSec && matchesStatus;
      });

      renderMatrix(filteredPeople);
      renderTable(filteredPeople, q, st);
      renderRpoTable();
      renderStorz(filteredPeople);
    }

    function renderMatrix(peopleList) {
      const headerRow = document.getElementById('matrixHeaderRow');
      headerRow.innerHTML = '<th class="th-sticky group-collab" style="font-size:10px;">NOME &amp; CARGO</th>' + 
        priorityDocCodes.map(c => '<th>' + (docShortNames[c] || 'Doc ' + c) + '</th>').join('');

      const tbody = document.getElementById('matrixBody');
      tbody.innerHTML = '';

      if (peopleList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + (priorityDocCodes.length + 1) + '" style="padding:32px;color:var(--text-muted);text-align:center;">Nenhum colaborador encontrado neste filtro.</td></tr>';
        return;
      }

      peopleList.forEach(p => {
        const tr = document.createElement('tr');
        
        const activeStorzCount = p.records.filter(isStorzActive).length;
        const storzPill = activeStorzCount > 0 
          ? '<span class="collab-storz-pill" title="' + activeStorzCount + ' matrícula(s) ativa(s) na Storz">' + SVG_ICONS.cap + activeStorzCount + ' Storz</span>'
          : '';

        const initials = p.name.split(' ').filter(Boolean).slice(0, 2).map(n => n[0]).join('');
        let html = '<td class="td-sticky" onclick="openCollabModal(\\'' + p.name.replace(/'/g, "\\\\'") + '\\')">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
          '<div class="collab-avatar">' + initials + '</div>' +
          '<div style="min-width:0;flex:1;">' +
          '<div class="collab-title-row"><strong>' + p.name + '</strong>' + storzPill + '</div>' +
          '<div style="font-size:10px;font-weight:500;color:var(--text-muted);">' + p.role + ' · ' + p.sector + '</div>' +
          '</div></div></td>';

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
          if (st === 'ACTION') matchStatus = needsAction(r);
          else if (st === 'CONFORME') matchStatus = isConforme(r.statusEHS);
          else if (st === 'VENCE_30') matchStatus = isAVencer(r.statusEHS);
          else if (st === 'VENCIDO') matchStatus = isVencido(r.statusEHS);
          else if (st === 'AUSENTE') matchStatus = isAusente(r.statusEHS);
          else if (st === 'STORZ') matchStatus = isStorzActive(r);

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

    let rpoSubTab = 'ALL_DIV';
    function filterRpoSubTab(sub) {
      rpoSubTab = sub;
      document.querySelectorAll('[id^="rpoChip-"]').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById('rpoChip-' + sub);
      if (activeBtn) activeBtn.classList.add('active');
      renderRpoTable();
    }

    function renderRpoTable() {
      const tbody = document.getElementById('rpoTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';

      const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();

      const items = rawRpoDivergences || [];
      const filtered = items.filter(item => {
        const matchQ = !q ||
          item.inspectorName.toLowerCase().includes(q) ||
          item.docName.toLowerCase().includes(q) ||
          item.docCode.toLowerCase().includes(q) ||
          (item.recommendedAction && item.recommendedAction.toLowerCase().includes(q));
        if (!matchQ) return false;

        if (rpoSubTab === 'ALL_DIV') return item.divergent;
        if (rpoSubTab === 'DATA_DIVERGENTE') return item.divergent && item.divergenceKind === 'DATA_DIVERGENTE';
        if (rpoSubTab === 'SOMENTE_DRIVE') return item.divergent && item.divergenceKind === 'SOMENTE_DRIVE';
        if (rpoSubTab === 'SOMENTE_STORZ') return item.divergent && item.divergenceKind === 'SOMENTE_STORZ';
        if (rpoSubTab === 'SOMENTE_RPO') return item.divergent && item.divergenceKind === 'SOMENTE_RPO';
        if (rpoSubTab === 'DIFF_30') return item.divergent && (item.diffDays !== undefined && item.diffDays > 30);
        if (rpoSubTab === 'ALL') return true;
        return true;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding:32px;color:var(--text-muted);text-align:center;">Nenhum registro de auditoria encontrado com os filtros atuais.</td></tr>';
        return;
      }

      const formatDate = (isoOrStr) => {
        if (!isoOrStr) return '—';
        const d = new Date(isoOrStr);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('pt-BR');
      };

      filtered.slice(0, 200).forEach(item => {
        const tr = document.createElement('tr');
        
        let badgeHtml = '';
        if (!item.divergent) {
          badgeHtml = '<span class="diff-badge consistente">' + SVG_ICONS.check + 'Consistente</span>';
        } else if (item.divergenceKind === 'SOMENTE_DRIVE') {
          badgeHtml = '<span class="diff-badge somente-drive">' + SVG_ICONS.alert + 'Só Drive</span>';
        } else if (item.divergenceKind === 'SOMENTE_STORZ') {
          badgeHtml = '<span class="diff-badge somente-storz">' + SVG_ICONS.cap + 'Só Storz</span>';
        } else if (item.divergenceKind === 'SOMENTE_RPO') {
          badgeHtml = '<span class="diff-badge somente-rpo">' + SVG_ICONS.alert + 'Só na RPO</span>';
        } else if (item.divergenceKind === 'DATA_DIVERGENTE') {
          badgeHtml = '<span class="diff-badge data-divergente">' + SVG_ICONS.x + 'Data Divergente</span>';
        } else {
          badgeHtml = '<span class="diff-badge data-divergente">' + (item.divergenceKind || 'Divergente') + '</span>';
        }

        const driveExp = formatDate(item.driveExpiration);
        const storzExp = formatDate(item.storzExpiration);
        const trustedExp = item.trustedSource === 'STORZ' ? storzExp : driveExp;
        const trustedSourceBadge = item.trustedSource 
          ? '<div style="font-size:10px;color:var(--text-muted);font-weight:600;">(' + item.trustedSource + ')</div>' 
          : '';

        const rpoExp = formatDate(item.rpoExpiration);
        const diffText = item.diffDays !== undefined 
          ? '<span class="mono" style="font-weight:700;' + (item.diffDays > 30 ? 'color:#EF4444;' : 'color:#F59E0B;') + '">' + item.diffDays + ' d</span>'
          : '<span style="color:var(--text-muted);">—</span>';

        const actionHtml = item.divergent 
          ? '<span class="action-pill action-rpo"><svg class="ico ico-xs ico-inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' + (item.recommendedAction || 'Verificar divergência') + '</span>'
          : '<span class="action-pill action-ok">' + SVG_ICONS.check + 'Consistente</span>';

        tr.innerHTML = 
          '<td style="text-align:left;"><strong>' + item.inspectorName + '</strong></td>' +
          '<td style="text-align:left;"><strong>' + item.docName + '</strong> <span style="font-size:10px;color:var(--text-muted);">(Cód ' + item.docCode + ')</span></td>' +
          '<td>' + badgeHtml + '</td>' +
          '<td><span class="mono">' + trustedExp + '</span>' + trustedSourceBadge + '</td>' +
          '<td><span class="mono">' + rpoExp + '</span></td>' +
          '<td>' + diffText + '</td>' +
          '<td style="text-align:left;">' + actionHtml + '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">' + item.detail + '</div></td>';

        tbody.appendChild(tr);
      });
    }

    let storzSubTab = 'ALL';
    function filterStorzSubTab(sub) {
      storzSubTab = sub;
      document.querySelectorAll('[id^="storzSubTab-"]').forEach(b => b.classList.remove('active'));
      const activeBtn = document.getElementById('storzSubTab-' + sub);
      if (activeBtn) activeBtn.classList.add('active');
      renderAll();
    }

    let storzProgFilter = 'ALL';
    function filterStorzProg(prog) {
      storzProgFilter = prog;
      document.querySelectorAll('[id^="storzProg-"]').forEach(b => b.classList.remove('active'));
      const btn = document.getElementById('storzProg-' + prog);
      if (btn) btn.classList.add('active');
      renderAll();
    }

    function renderStorz(peopleList) {
      const tbody = document.getElementById('storzTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';

      const q = document.getElementById('searchInput').value.toLowerCase().trim();
      const sec = document.getElementById('sectorFilter').value;

      let sourceItems = [];
      if (rawStorzHistory && rawStorzHistory.length > 0) {
        sourceItems = rawStorzHistory.map(req => {
          const person = peopleMap.get(req.collaboratorName);
          const rawSit = req.rawSituacao || req.state || '';
          return {
            inspectorName: req.collaboratorName,
            sector: person ? person.sector : 'Operações',
            role: person ? person.role : 'Técnico',
            docName: req.trainingName,
            storzRequestId: req.id,
            storzState: req.state,
            rawSituacao: rawSit,
            storzProgressPercent: req.progressPercent !== undefined ? req.progressPercent : (req.state === 'CONCLUIDO' ? 100 : 0),
            storzDeadline: req.deadline ? new Date(req.deadline).toLocaleDateString('pt-BR') : (req.courseDurationDays ? req.courseDurationDays + ' dias' : ''),
            detail: req.notes || (rawSit ? 'Situação do Aluno: ' + rawSit : '')
          };
        });
      } else {
        peopleList.forEach(p => {
          p.records.forEach(r => {
            if (r.storzRequestId) sourceItems.push(r);
          });
        });
      }

      const storzRecords = [];
      sourceItems.forEach(r => {
        const matchQuery = !q || (r.inspectorName.toLowerCase().includes(q) || r.docName.toLowerCase().includes(q));
        const matchSec = sec === 'ALL' || r.sector === sec;
        if (!matchQuery || !matchSec) return;

        const situacaoUpper = ((r.rawSituacao || r.storzState || '')).toUpperCase();
        const prog = r.storzProgressPercent !== undefined ? r.storzProgressPercent : (r.storzState === 'CONCLUIDO' ? 100 : 0);

        if (storzSubTab === 'ALL') {
          // Show all items
        } else if (storzSubTab === 'EM_ANDAMENTO') {
          if (r.storzState !== 'EM_ANDAMENTO' && !situacaoUpper.includes('ANDAMENTO')) return;
        } else if (storzSubTab === 'SOLICITADO') {
          if (r.storzState !== 'SOLICITADO' && !situacaoUpper.includes('NÃO INICIADO') && !situacaoUpper.includes('NAO INICIADO') && r.statusEHS !== 'SOLICITADO_STORZ') return;
        } else if (storzSubTab === 'REPROVADO') {
          if (!situacaoUpper.includes('REPROV')) return;
        } else if (storzSubTab === 'CONCLUIDO') {
          if (r.storzState !== 'CONCLUIDO' && !situacaoUpper.includes('APROV') && !situacaoUpper.includes('CONCLU')) return;
        }

        if (storzProgFilter === '0' && prog !== 0) return;
        if (storzProgFilter === '1_49' && (prog < 1 || prog > 49)) return;
        if (storzProgFilter === '50_99' && (prog < 50 || prog > 99)) return;
        if (storzProgFilter === '100' && prog !== 100) return;

        storzRecords.push(r);
      });

      if (storzRecords.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="padding:32px;color:var(--text-muted);text-align:center;">Nenhuma matrícula encontrada com os filtros atuais.</td></tr>';
        return;
      }

      storzRecords.slice(0, 200).forEach(r => {
        const tr = document.createElement('tr');
        const prog = r.storzProgressPercent !== undefined ? r.storzProgressPercent : (r.storzState === 'CONCLUIDO' ? 100 : 0);
        const progColor = prog === 100 ? '#10b981' : prog > 0 ? '#6366f1' : '#94a3b8';
        const progHtml = '<div style="display:flex;align-items:center;gap:6px;min-width:110px;">' +
          '<div style="flex:1;height:6px;background:var(--border-color);border-radius:3px;overflow:hidden;">' +
          '<div style="width:' + prog + '%;height:100%;background:' + progColor + ';"></div>' +
          '</div>' +
          '<span style="font-weight:700;font-size:11px;">' + prog + '%</span>' +
          '</div>';

        const dlHtml = r.storzDeadline 
          ? '<span style="font-size:11px;font-weight:600;font-family:\\'JetBrains Mono\\', monospace;">' + r.storzDeadline + '</span>'
          : '<span style="color:var(--text-muted);font-size:11px;">—</span>';

        const situacaoUpper = ((r.rawSituacao || r.storzState || '')).toUpperCase();
        let stateBadge = '';
        if (situacaoUpper.includes('REPROV')) {
          stateBadge = '<span class="badge danger" title="Reprovado - Necessita Reteste">' + SVG_ICONS.x + 'Reprovado (Reteste)</span>';
        } else if (r.storzState === 'CONCLUIDO' || situacaoUpper.includes('APROV')) {
          stateBadge = '<span class="badge ok">' + SVG_ICONS.check + 'Aprovado</span>';
        } else if (r.storzState === 'EM_ANDAMENTO' || situacaoUpper.includes('ANDAMENTO')) {
          stateBadge = '<span class="badge storz">' + SVG_ICONS.clock + 'Em Andamento</span>';
        } else {
          stateBadge = '<span class="badge" style="background:#EFF6FF;color:#1D4ED8;border:1px solid #DBEAFE;">' + SVG_ICONS.clock + 'Aguardando Início</span>';
        }

        tr.innerHTML = 
          '<td style="text-align:left;"><strong>' + r.inspectorName + '</strong><div style="font-size:10px;color:var(--text-muted);">' + (r.sector || 'Operações') + '</div></td>' +
          '<td style="text-align:left;"><strong>' + r.docName + '</strong></td>' +
          '<td><span class="mono" style="font-weight:700;color:var(--brand-purple);">' + (r.storzRequestId || '—') + '</span></td>' +
          '<td>' + stateBadge + '</td>' +
          '<td>' + progHtml + '</td>' +
          '<td>' + dlHtml + '</td>' +
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
</html>`
}
