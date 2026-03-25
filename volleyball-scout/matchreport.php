<?php
$pageTitle = 'Matchrapport – Volleybal Scouting';
?>
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1a1a2e">
  <title><?= htmlspecialchars($pageTitle) ?></title>
  <link rel="stylesheet" href="css/style.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    .report-page { max-width: 1100px; margin: 0 auto; padding: 1.5rem; line-height: 1.5; }
    .report-header { text-align: center; margin-bottom: 2rem; }
    .report-header h1 { font-size: 1.75rem; margin: 0; font-weight: 600; }
    .report-header .teams { font-size: 1.2rem; color: var(--text-muted); margin-top: 0.5rem; }
    .report-header .report-date { font-size: 0.95rem; color: var(--text-muted); margin-top: 0.25rem; }
    .chart-empty { color: var(--text-muted); font-size: 0.95rem; padding: 2rem 1rem; text-align: center; }
    .report-set-scores { display: flex; justify-content: center; gap: 1.5rem; margin: 1rem 0; flex-wrap: wrap; }
    .report-set-score { background: var(--surface); padding: 0.5rem 1rem; border-radius: var(--radius-sm); font-weight: 600; font-size: 1.1rem; }
    .report-section { margin-bottom: 3rem; }
    .report-section h2 { font-size: 1.25rem; margin: 0 0 1rem; color: var(--accent); font-weight: 600; }
    .report-section p.hint { font-size: 0.95rem; color: var(--text-muted); margin: 0 0 1rem; line-height: 1.6; }
    .report-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem; }
    .report-chart {
      background: var(--surface);
      border-radius: var(--radius);
      padding: 1.5rem;
      min-height: 300px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      border: 1px solid rgba(255,255,255,0.06);
    }
    .report-chart canvas { display: block; }
    .report-chart.report-chart-center { position: relative; min-height: 300px; margin: 0 auto; padding: 1.5rem; }
    .report-chart.report-chart-center .chart-team-label { margin: 0 0 0.25rem; font-size: 0.95rem; font-weight: 600; }
    .report-chart.report-chart-line { min-height: 400px; height: 460px; max-height: 520px; }
    .report-chart.report-chart-line .chart-title { margin: 0 0 1rem; font-size: 1rem; font-weight: 600; color: var(--accent); }
    .score-timeline { margin: 2rem 0; }
    .score-timeline-set { margin-bottom: 1.5rem; }
    .score-timeline-set h3 { font-size: 0.95rem; color: var(--text-muted); margin: 0 0 0.5rem; font-weight: 500; }
    .score-timeline-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; max-width: 100%; }
    .score-dot { width: 12px; height: 12px; border-radius: 2px; flex-shrink: 0; transition: transform 0.15s; }
    .score-dot:hover { transform: scale(1.25); }
    .score-dot.home-active { background: #22c55e; }
    .score-dot.home-passive { background: #64748b; }
    .score-dot.away-active { background: #3b82f6; }
    .score-dot.away-passive { background: #475569; }
    .conversion-table { width: 100%; border-collapse: collapse; font-size: 1rem; margin-top: 1rem; }
    .conversion-table th, .conversion-table td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--surface2); }
    .conversion-table th { color: var(--text-muted); font-weight: 500; }
    .conversion-table td { color: var(--text); }
    .report-link { display: inline-block; margin-bottom: 1rem; color: var(--accent); text-decoration: none; font-size: 1rem; }
    .report-link:hover { text-decoration: underline; }
    .report-legend { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 0.75rem 0; font-size: 0.9rem; }
    .report-legend span { display: flex; align-items: center; gap: 0.4rem; }
    .report-legend .dot { width: 12px; height: 12px; border-radius: 2px; }
    @media (min-width: 768px) {
      .report-grid-double { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
    }
    @media (max-width: 767px) {
      .report-page { padding: 1rem; }
      .report-chart { min-height: 300px; padding: 1rem; }
      .report-chart.report-chart-center { min-height: 280px; max-height: 320px; height: 300px; padding: 1rem; }
      .report-chart.report-chart-bar { min-height: 400px; }
      .report-chart.report-chart-line { height: 420px; max-height: 480px; }
      .report-section h2 { font-size: 1.1rem; }
      .conversion-table { font-size: 0.9rem; }
      .conversion-table th, .conversion-table td { padding: 0.5rem 0.75rem; }
    }
  </style>
</head>
<body class="report-page setup-page">
  <nav style="margin-bottom: 1rem;">
    <a href="index.php" class="report-link">← Start</a>
    <a href="overview.php" class="report-link" style="margin-left: 1rem;">Wedstrijden overzicht</a>
  </nav>
  <header class="report-header">
    <h1>Volleyball Match Analytics</h1>
    <p class="teams" id="reportTeams">–</p>
    <p class="report-date" id="reportDate"></p>
  </header>

  <main id="reportContent">
    <p id="reportLoading">Rapport laden…</p>
  </main>

  <script>
    window.SCOUT_API_BASE = <?= json_encode(rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/') . '/') ?>;
  </script>
  <script src="js/utils.js?v=<?= filemtime(__DIR__ . '/js/utils.js') ?>"></script>
  <script src="js/matchreport.js?v=<?= filemtime(__DIR__ . '/js/matchreport.js') ?>"></script>
</body>
</html>
