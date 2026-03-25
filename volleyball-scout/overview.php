<?php
require_once __DIR__ . '/lib/auth.php';

$pageTitle = 'Wedstrijden overzicht – Volleybal Scouting';

if (scout_auth_enabled() && !scout_is_logged_in()) {
    header('Location: auth/login.php?redirect=' . urlencode('overview.php'));
    exit;
}
?>
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1a1a2e">
  <title><?= htmlspecialchars($pageTitle) ?></title>
  <link rel="stylesheet" href="css/style.css">
  <style>
    .overview-page { max-width: 600px; margin: 0 auto; padding: 0; padding-bottom: 2rem; }
    .overview-top { background: var(--surface); border-bottom: 1px solid var(--surface2); }
    .overview-top .top-bar { margin: 0; }
    .overview-header { text-align: center; padding: 1rem 1.5rem; background: var(--surface); border-bottom: 1px solid var(--surface2); margin-bottom: 1rem; }
    .overview-header h1 { font-size: 1.35rem; margin: 0; }
    .overview-header p { margin: 0.25rem 0 0; color: var(--text-muted); font-size: 0.9rem; }
    .overview-main { padding: 0 1rem 1rem; }
    .match-card {
      display: block;
      background: var(--surface);
      border-radius: var(--radius);
      padding: 1rem 1.25rem;
      margin-bottom: 0.75rem;
      text-decoration: none;
      color: inherit;
      border: 2px solid transparent;
      transition: border-color 0.15s, background 0.15s;
    }
    .match-card:hover { background: var(--surface2); border-color: var(--accent); }
    .match-card-teams { font-size: 1rem; font-weight: 600; margin-bottom: 0.25rem; }
    .match-card-meta { font-size: 0.85rem; color: var(--text-muted); display: flex; flex-wrap: wrap; gap: 0.75rem 1.5rem; margin-top: 0.5rem; }
    .match-card-score { font-weight: 700; color: var(--accent); font-size: 1.1rem; }
    .match-list-empty { text-align: center; padding: 2rem 1rem; color: var(--text-muted); }
    .overview-nav { display: flex; gap: 0.75rem; margin-bottom: 1rem; }
    .overview-nav a { color: var(--accent); text-decoration: none; }
    .overview-nav a:hover { text-decoration: underline; }
  </style>
</head>
<body class="overview-page setup-page">
  <div class="overview-top">
    <div class="top-bar">
      <button type="button" id="menuToggle" class="menu-toggle" aria-label="Menu openen">
        <span></span><span></span><span></span>
      </button>
      <?php if (scout_auth_enabled() && scout_is_logged_in()): $u = scout_current_user(); ?>
      <nav class="auth-bar" aria-label="Account">
        <div class="auth-bar-content">
          <span class="auth-user-name"><?= htmlspecialchars($u['name'] ?? 'Ingelogd') ?></span>
          <a href="auth/logout.php" class="btn btn-secondary">Uitloggen</a>
        </div>
      </nav>
      <?php endif; ?>
    </div>
    <header class="overview-header">
      <h1>Wedstrijden</h1>
      <p>Overzicht van beschikbare wedstrijden</p>
    <div id="menuBackdrop" class="menu-backdrop hidden" aria-hidden="true"></div>
    <aside id="menuPanel" class="menu-panel menu-closed" aria-label="Navigatiemenu" aria-hidden="true">
      <nav>
        <span class="menu-title">Navigatie</span>
        <a href="index.php">Nieuwe wedstrijd</a>
        <a href="overview.php">Wedstrijden overzicht</a>
        <?php if (scout_auth_enabled() && scout_is_logged_in()): ?>
        <a href="teams.php">Mijn teams</a>
        <a href="auth/logout.php">Uitloggen</a>
        <?php endif; ?>
      </nav>
    </aside>
    </header>
  </div>

  <main id="matchList" class="overview-main">
    <p id="loadingMsg">Laden…</p>
  </main>

  <script src="js/utils.js?v=<?= filemtime(__DIR__ . '/js/utils.js') ?>"></script>
  <script src="js/menu.js?v=<?= filemtime(__DIR__ . '/js/menu.js') ?>"></script>
  <script>
  (function () {
    var escapeHtml = window.scoutUtils && window.scoutUtils.escapeHtml || function (s) {
      if (!s) return '';
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    };
    function formatMatchMeta(m) {
      if (m.matchDateLocal || m.matchTimeLocal) {
        return [m.matchDateLocal || '', m.matchTimeLocal || ''].filter(Boolean).join(' · ');
      }
      var dateStr = m.matchDate ? (function (s) {
        var x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        return x ? x[3] + '-' + x[2] + '-' + x[1] : s;
      })(m.matchDate) : '';
      var timeStr = m.matchTime || '';
      return [dateStr, timeStr].filter(Boolean).join(' · ');
    }

    function loadMatches() {
      var tzOffset = typeof Date.prototype.getTimezoneOffset === 'function' ? -new Date().getTimezoneOffset() : 0;
      return fetch('api.php?action=list&tzOffset=' + encodeURIComponent(tzOffset))
        .then(function (r) {
          if (!r.ok) throw new Error('API fout');
          return r.json();
        })
        .then(function (data) {
        var matches = data.matches || [];
        var authHint = data.authHint || '';
        var el = document.getElementById('matchList');
        var loading = document.getElementById('loadingMsg');
        if (loading) loading.remove();

        if (matches.length === 0) {
          var msg = '<p>Geen wedstrijden gevonden.</p>';
          if (authHint === 'add_teams') {
            msg = '<p>Voeg teams toe om wedstrijden te zien.</p><p><a href="teams.php" class="options-link">Mijn teams beheren</a></p>';
          } else {
            msg += '<p>Start een wedstrijd via de setup om data te verzamelen.</p>';
          }
          el.innerHTML = '<div class="match-list-empty">' + msg + '</div>';
          return;
        }

        el.innerHTML = matches.map(function (m) {
          var teamA = escapeHtml(m.teamA || 'Thuis');
          var teamB = escapeHtml(m.teamB || 'Uit');
          var meta = [escapeHtml(formatMatchMeta(m)), 'Sets: ' + m.homeSets + '–' + m.awaySets].filter(Boolean);
          var scoreStr = m.homeScore + ' – ' + m.awayScore;
          return (
            '<a href="matchreport.php?matchId=' + encodeURIComponent(m.matchId) + '" class="match-card">' +
              '<div class="match-card-teams">' + teamA + ' – ' + teamB + '</div>' +
              '<div class="match-card-score">' + scoreStr + '</div>' +
              '<div class="match-card-meta">' + meta.join(' · ') + '</div>' +
            '</a>'
          );
        }).join('');
        });
    }

    function showLoadError() {
      var el = document.getElementById('matchList');
      var loading = document.getElementById('loadingMsg');
      if (loading) loading.remove();
      el.innerHTML = '<div class="match-list-empty"><p>Kon wedstrijden niet laden.</p><button type="button" class="btn btn-primary" id="retryOverviewBtn">Opnieuw proberen</button></div>';
      document.getElementById('retryOverviewBtn').addEventListener('click', function () {
        el.innerHTML = '<p id="loadingMsg">Laden…</p>';
        loadMatches().catch(showLoadError);
      });
    }
    loadMatches().catch(showLoadError);
  })();
  </script>
</body>
</html>
