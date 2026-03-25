<?php
$pageTitle = 'Volleybal Scouting – Setup';
?>
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#1a1a2e">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <link rel="manifest" href="manifest.json">
  <title><?= htmlspecialchars($pageTitle) ?></title>
  <link rel="stylesheet" href="css/style.css">
  <style>
    .ongoing-section { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--surface2); }
    .ongoing-list { margin-top: 0.5rem; }
    .ongoing-card { display: flex; flex-direction: column; gap: 0.75rem; background: var(--surface); padding: 1rem; border-radius: var(--radius); margin-bottom: 0.75rem; border: 2px solid var(--accent); }
    .ongoing-card-info { min-width: 0; }
    .ongoing-card-teams { font-weight: 600; font-size: 1rem; margin-bottom: 0.25rem; }
    .ongoing-card-score { font-size: 0.9rem; color: var(--accent); }
    .ongoing-card-meta { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem; }
    .ongoing-card .btn { width: 100%; margin: 0; }
  </style>
</head>
<body class="setup-page">
  <div class="top-bar">
    <button type="button" id="menuToggle" class="menu-toggle" aria-label="Menu openen">
      <span></span><span></span><span></span>
    </button>
    <nav id="authBar" class="auth-bar hidden" aria-label="Inloggen">
      <div id="authPromoSection" class="auth-bar-content hidden">
        <a href="auth/login.php" class="btn btn-primary" id="authLogin">Inloggen</a>
        <a href="auth/register.php" class="btn btn-secondary" id="authRegister">Aanmelden</a>
      </div>
      <div id="authLoggedSection" class="auth-bar-content hidden">
        <span id="authUserInfo" class="auth-user-name"></span>
        <a href="auth/logout.php" class="btn btn-secondary" id="authLogoutBtn">Uitloggen</a>
      </div>
    </nav>
  </div>
  <header class="header">
    <h1>Volleybal Scouting</h1>
    <p class="subtitle">Setup wedstrijd</p>
    <p class="header-links">
      <a href="overview.php" id="overviewLink">Wedstrijden overzicht</a>
      <a href="teams.php" id="authTeams" class="hidden">Mijn teams</a>
    </p>
    <div id="menuBackdrop" class="menu-backdrop hidden" aria-hidden="true"></div>
    <aside id="menuPanel" class="menu-panel menu-closed" aria-label="Navigatiemenu" aria-hidden="true">
      <nav>
        <span class="menu-title">Navigatie</span>
        <a href="index.php">Nieuwe wedstrijd</a>
        <a href="overview.php">Wedstrijden overzicht</a>
        <a href="teams.php" id="menuTeams" class="menu-auth-only hidden">Mijn teams</a>
        <a href="auth/logout.php" class="menu-auth-only hidden">Uitloggen</a>
      </nav>
    </aside>
  </header>

  <main class="main">
    <!-- Nieuwe wedstrijd -->
    <section id="step-teams" class="card step">
      <h2>Nieuwe wedstrijd</h2>
      <p class="hint" style="margin-bottom: 1rem;">1. Vul de teamnamen in en ga verder om spelers te kiezen.</p>
      <div class="field" id="teamAField">
        <label for="teamA">Team thuis</label>
        <div id="teamAContainer">
          <input type="text" id="teamA" placeholder="bijv. VTC MA1" autocomplete="off">
        </div>
      </div>
      <div class="field">
        <label for="teamB">Team uit</label>
        <input type="text" id="teamB" placeholder="bijv. UVV MA2" autocomplete="off">
      </div>
      <button type="button" class="btn btn-primary" data-next="step-players">Volgende</button>

      <!-- Doorlopende wedstrijden (alleen zichtbaar op startscherm) -->
      <div id="ongoingSection" class="ongoing-section hidden" aria-label="Doorlopende wedstrijden">
        <h2 style="margin-top: 1.5rem; margin-bottom: 0.25rem;">Doorlopende wedstrijden</h2>
        <p class="hint" style="margin-top: 0;">Klik om verder te gaan met een wedstrijd.</p>
        <div id="ongoingList" class="ongoing-list"></div>
      </div>
    </section>

    <!-- Stap 2: Spelers – veld + wisselspelers -->
    <section id="step-players" class="card step hidden">
      <h2>2. Spelers eigen team</h2>
      <p class="hint" id="playersHint">Voeg spelers toe of wissel ze: vul naam en rugnummer in boven de tegels, klik + om toe te voegen. Klik een tegel om te selecteren, klik een andere om te wisselen.</p>
      <div class="add-player add-player-row" id="addPlayerRow">
        <input type="text" id="newPlayerA" placeholder="Naam" autocomplete="off">
        <input type="text" id="newPlayerANumber" placeholder="Nr" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" title="Rugnummer">
        <button type="button" class="btn btn-small" id="addPlayerA">+ Toevoegen</button>
      </div>
      <h3 id="labelTeamAPlayers">Team thuis</h3>
      <div class="setup-court">
        <div class="court-net" aria-hidden="true"></div>
        <div class="court-row court-front">
          <div class="setup-cell court-cell" data-pos="4" id="setup-cell-4"><span class="tile-badge">4</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
          <div class="setup-cell court-cell" data-pos="3" id="setup-cell-3"><span class="tile-badge">3</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
          <div class="setup-cell court-cell" data-pos="2" id="setup-cell-2"><span class="tile-badge">2</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
        </div>
        <div class="court-row court-back">
          <div class="setup-cell court-cell" data-pos="5" id="setup-cell-5"><span class="tile-badge">5</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
          <div class="setup-cell court-cell" data-pos="6" id="setup-cell-6"><span class="tile-badge">6</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
          <div class="setup-cell court-cell court-service" data-pos="1" id="setup-cell-1"><span class="tile-badge">1</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
        </div>
      </div>
      <p class="setup-section-label">Wisselspelers <span id="wisselCount" class="wissel-count" style="display:none"></span></p>
      <div class="setup-subs-row">
        <div class="setup-cell setup-sub" data-pos="7" id="setup-cell-7"><span class="tile-badge">–</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
        <div class="setup-cell setup-sub" data-pos="8" id="setup-cell-8"><span class="tile-badge">–</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
        <div class="setup-cell setup-sub" data-pos="9" id="setup-cell-9"><span class="tile-badge">–</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
        <div class="setup-cell setup-sub" data-pos="10" id="setup-cell-10"><span class="tile-badge">–</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
        <div class="setup-cell setup-sub" data-pos="11" id="setup-cell-11"><span class="tile-badge">–</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
        <div class="setup-cell setup-sub" data-pos="12" id="setup-cell-12"><span class="tile-badge">–</span><span class="tile-name"></span><button type="button" class="remove-player" aria-label="Verwijder">×</button></div>
      </div>
      <div class="setup-actions">
        <button type="button" class="btn btn-primary" id="btnPlayersNext" data-next="step-system">Volgende</button>
        <button type="button" class="btn btn-secondary hidden" id="btnBackToMatch">Terug naar wedstrijd</button>
        <button type="button" class="btn btn-primary hidden" id="btnStartSet">Start set <span id="nextSetNum">2</span></button>
      </div>
    </section>

    <!-- Stap 3: Spelsysteem + Start -->
    <section id="step-system" class="card step hidden">
      <h2>3. Spelsysteem eigen team</h2>
      <p class="hint">Kies het systeem (5-1, 4-2 of geen vaste set-up).</p>
      <div class="field">
        <label for="systemA">Systeem</label>
        <select id="systemA">
          <option value="5-1">5-1</option>
          <option value="4-2">4-2</option>
          <option value="geen">Geen systeem</option>
        </select>
      </div>
      <div id="setterFields" class="setter-fields hidden">
        <h3>Spelverdeler(s)</h3>
        <div id="setterSelect"></div>
      </div>
      <button type="button" class="btn btn-primary" id="btnStartMatch">Start wedstrijd</button>
    </section>
  </main>

  <script src="js/utils.js?v=<?= filemtime(__DIR__ . '/js/utils.js') ?>"></script>
  <script src="js/rules.js?v=<?= filemtime(__DIR__ . '/js/rules.js') ?>"></script>
  <script src="js/rotation.js?v=<?= filemtime(__DIR__ . '/js/rotation.js') ?>"></script>
  <script src="js/dialog.js?v=<?= filemtime(__DIR__ . '/js/dialog.js') ?>"></script>
  <script src="js/auth.js?v=<?= filemtime(__DIR__ . '/js/auth.js') ?>"></script>
  <script src="js/menu.js?v=<?= filemtime(__DIR__ . '/js/menu.js') ?>"></script>
  <script>
  (function () {
    var escapeHtml = window.scoutUtils && window.scoutUtils.escapeHtml || function (s) {
      if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML;
    };
    var escapeAttr = window.scoutUtils && window.scoutUtils.escapeAttr || function (s) {
      if (!s) return ''; return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    };
    function loadOngoing() {
      if (window.scoutAuth && window.scoutAuth.getState && window.scoutAuth.getState().enabled && !window.scoutAuth.getState().loggedIn) return;
      var tzOffset = typeof Date.prototype.getTimezoneOffset === 'function' ? -new Date().getTimezoneOffset() : 0;
      fetch('api.php?action=list&ongoing=1&tzOffset=' + encodeURIComponent(tzOffset))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
          var matches = data.matches || [];
          var authHint = data.authHint || '';
          var section = document.getElementById('ongoingSection');
          var list = document.getElementById('ongoingList');
          if (!section || !list) return;
          if (matches.length === 0) {
            if (authHint === 'add_teams') {
              section.classList.remove('hidden');
              list.innerHTML = '<p class="hint">Voeg <a href="teams.php">teams toe</a> om doorlopende wedstrijden te zien.</p>';
            } else {
              section.classList.add('hidden');
            }
            return;
          }
          section.classList.remove('hidden');
          function formatDate(s) {
            if (!s) return '';
            var x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
            return x ? x[3] + '-' + x[2] + '-' + x[1] : s;
          }
          list.innerHTML = matches.map(function (m) {
            var teamA = escapeHtml(m.teamA || 'Thuis');
            var teamB = escapeHtml(m.teamB || 'Uit');
            var score = (m.homeScore || 0) + ' – ' + (m.awayScore || 0);
            var sets = 'Sets: ' + (m.homeSets || 0) + '–' + (m.awaySets || 0);
            var meta = [];
            if (m.matchDateLocal) meta.push(m.matchDateLocal);
            if (m.matchTimeLocal) meta.push(m.matchTimeLocal);
            if (meta.length === 0) {
              if (m.matchDate) meta.push(formatDate(m.matchDate));
              if (m.matchTime) meta.push(m.matchTime);
            }
            var metaHtml = meta.length ? '<div class="ongoing-card-meta">' + escapeHtml(meta.join(' ')) + '</div>' : '';
            return '<div class="ongoing-card"><div class="ongoing-card-info"><div class="ongoing-card-teams">' + teamA + ' – ' + teamB + '</div><div class="ongoing-card-score">' + score + ' (' + sets + ')</div>' + metaHtml + '</div><button type="button" class="btn btn-primary" data-match-id="' + escapeAttr(m.matchId) + '">Doorgaan</button></div>';
          }).join('');
          list.querySelectorAll('button[data-match-id]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var mid = btn.getAttribute('data-match-id');
              if (!mid) return;
              try { sessionStorage.removeItem('scoutMatchState'); sessionStorage.removeItem('scoutSetup'); localStorage.setItem('scoutCurrentMatchId', mid); } catch (_) {}
              window.location.href = 'match.php';
            });
          });
        })
        .catch(function () {});
    }
    function renderTeamAField() {
      var container = document.getElementById('teamAContainer');
      if (!container) return;
      var auth = window.scoutAuth && window.scoutAuth.getState ? window.scoutAuth.getState() : null;
      var teams = (auth && auth.loggedIn && auth.teams) ? auth.teams : [];
      if (auth && auth.enabled && auth.loggedIn) {
        if (teams.length > 0) {
          var existing = document.getElementById('teamA');
          var currentVal = existing ? (existing.value || '').trim() : '';
          if (!currentVal && teams.length === 1) currentVal = teams[0];
          var select = document.createElement('select');
          select.id = 'teamA';
          select.innerHTML = '<option value="">Kies een team</option>' + teams.map(function (t) {
            var sel = (t === currentVal) ? ' selected' : '';
            return '<option value="' + escapeAttr(t) + '"' + sel + '>' + escapeHtml(t) + '</option>';
          }).join('');
          container.innerHTML = '';
          container.appendChild(select);
          var el = document.getElementById('teamA');
          if (el && window.scoutSetupUpdateLabels) {
            el.addEventListener('change', window.scoutSetupUpdateLabels);
            el.addEventListener('input', window.scoutSetupUpdateLabels);
          }
        } else {
          var wrap = document.createElement('div');
          wrap.className = 'team-a-no-teams';
          wrap.innerHTML = '<select id="teamA" disabled><option value="">Voeg eerst teams toe</option></select> <a href="teams.php" class="team-add-link">Teams beheren</a>';
          container.innerHTML = '';
          container.appendChild(wrap);
        }
      } else {
        container.innerHTML = '<input type="text" id="teamA" placeholder="bijv. VTC MA1" autocomplete="off">';
        var el = document.getElementById('teamA');
        if (el && window.scoutSetupUpdateLabels) {
          el.addEventListener('input', window.scoutSetupUpdateLabels);
        }
      }
      if (window.scoutSetupUpdateLabels) window.scoutSetupUpdateLabels();
    }

    function init() {
      if (window.scoutAuth && window.scoutAuth.load) {
        window.scoutAuth.load().then(function () {
          window.scoutAuth.render();
          renderTeamAField();
          loadOngoing();
        });
      } else {
        loadOngoing();
      }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
  </script>
  <script src="js/setup.js?v=<?= filemtime(__DIR__ . '/js/setup.js') ?>"></script>
</body>
</html>
