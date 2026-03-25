<?php
require_once __DIR__ . '/lib/auth.php';

if (!scout_auth_enabled() || !scout_is_logged_in()) {
    header('Location: auth/login.php');
    exit;
}

$pageTitle = 'Teambeheer – Volleybal Scouting';
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
    .teams-page { max-width: 480px; margin: 0 auto; padding: 1rem; }
    .teams-page h1 { font-size: 1.35rem; margin-bottom: 0.5rem; }
    .teams-page .hint { color: var(--text-muted); margin-bottom: 1rem; }
    .add-team-card { background: var(--surface); border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1.5rem; border: 1px solid var(--surface2); }
    .add-team-card h3 { margin: 0 0 1rem; font-size: 1rem; color: var(--text); }
    .add-team-form { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
    .add-team-form .add-team-label { flex: 0 0 auto; font-size: 0.85rem; color: var(--text-muted); }
    .add-team-form .add-team-input { flex: 1 1 180px; min-width: 140px; padding: 0.75rem 1rem; font-size: 1rem; border: 1px solid var(--surface2); border-radius: var(--radius-sm); background: var(--bg); color: var(--text); }
    .add-team-form .add-team-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(61, 123, 245, 0.2); }
    .add-team-form .add-team-input::placeholder { color: var(--text-muted); opacity: 0.7; }
    .teams-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .team-row { display: flex; align-items: center; gap: 0.75rem; background: var(--surface); padding: 0.75rem 1rem; border-radius: var(--radius); border: 1px solid var(--surface2); }
    .team-row span { flex: 1; }
    .team-row .btn-remove { padding: 0.25rem 0.5rem; font-size: 0.85rem; }
    .team-row .btn-edit { padding: 0.25rem 0.5rem; font-size: 0.85rem; }
    .teams-back { margin-top: 1rem; }
    .teams-back a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body class="setup-page">
  <?php $u = scout_current_user(); ?>
  <div class="top-bar">
    <button type="button" id="menuToggle" class="menu-toggle" aria-label="Menu openen">
      <span></span><span></span><span></span>
    </button>
    <nav class="auth-bar" aria-label="Account">
      <div class="auth-bar-content">
        <span class="auth-user-name"><?= htmlspecialchars($u['name'] ?? 'Ingelogd') ?></span>
        <a href="auth/logout.php" class="btn btn-secondary">Uitloggen</a>
      </div>
    </nav>
  </div>
  <header class="header">
    <h1>Teambeheer</h1>
    <p class="subtitle">Beheer je teams – wedstrijden van deze teams verschijnen in je overzichten</p>
    <p class="header-links">
      <a href="index.php">Nieuwe wedstrijd</a>
      <a href="overview.php">Wedstrijden overzicht</a>
    </p>
    <div id="menuBackdrop" class="menu-backdrop hidden" aria-hidden="true"></div>
    <aside id="menuPanel" class="menu-panel menu-closed" aria-label="Navigatiemenu" aria-hidden="true">
      <nav>
        <span class="menu-title">Navigatie</span>
        <a href="index.php">Nieuwe wedstrijd</a>
        <a href="overview.php">Wedstrijden overzicht</a>
        <a href="teams.php">Mijn teams</a>
        <a href="auth/logout.php">Uitloggen</a>
      </nav>
    </aside>
  </header>

  <main class="teams-page">
    <p class="hint">Voeg teamnamen toe. Alleen wedstrijden waar jouw team (thuis of uit) speelt, worden getoond in doorlopende wedstrijden en het overzicht.</p>
    <div class="add-team-card">
      <h3>Nieuw team toevoegen</h3>
      <div class="add-team-form">
        <label for="newTeamName" class="add-team-label">Teamnaam</label>
        <input type="text" id="newTeamName" class="add-team-input" placeholder="bijv. VTC MA1" autocomplete="off">
        <button type="button" class="btn btn-primary" id="btnAddTeam">Toevoegen</button>
      </div>
    </div>
    <div id="teamsList" class="teams-list"><p id="teamsLoading">Laden…</p></div>
    <p class="teams-back"><a href="index.php">← Terug naar start</a></p>
  </main>

  <script src="js/utils.js?v=<?= filemtime(__DIR__ . '/js/utils.js') ?>"></script>
  <script src="js/menu.js?v=<?= filemtime(__DIR__ . '/js/menu.js') ?>"></script>
  <script>
  (function () {
    var listEl = document.getElementById('teamsList');
    var loadEl = document.getElementById('teamsLoading');
    var inputEl = document.getElementById('newTeamName');
    var btnAdd = document.getElementById('btnAddTeam');

    function escapeHtml(s) {
      if (!s) return '';
      var d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function loadTeams() {
      fetch('api.php?action=teams')
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
          var teams = data.teams || [];
          if (loadEl) loadEl.remove();
          if (teams.length === 0) {
            listEl.innerHTML = '<p class="hint">Nog geen teams. Voeg een team toe om wedstrijden te zien.</p>';
          } else {
            listEl.innerHTML = teams.map(function (t) {
              var teamAttr = (window.scoutUtils && window.scoutUtils.escapeAttr) ? window.scoutUtils.escapeAttr(t) : t.replace(/"/g, '&quot;');
              return '<div class="team-row" data-team="' + teamAttr + '"><span>' + escapeHtml(t) + '</span><a href="team-edit.php?team=' + encodeURIComponent(t) + '" class="btn btn-small btn-edit">Spelers</a><button type="button" class="btn btn-small btn-remove" data-team="' + teamAttr + '">Verwijderen</button></div>';
            }).join('');
            listEl.querySelectorAll('.btn-remove').forEach(function (btn) {
              btn.addEventListener('click', function () {
                var t = btn.getAttribute('data-team');
                if (!t) return;
                fetch('api.php?action=teams', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'remove', team: t })
                }).then(function (r) { return r.ok ? loadTeams() : Promise.reject(); });
              });
            });
          }
        })
        .catch(function () {
          if (loadEl) loadEl.remove();
          listEl.innerHTML = '<p class="hint">Kon teams niet laden.</p>';
        });
    }

    if (btnAdd && inputEl) {
      btnAdd.addEventListener('click', function () {
        var name = (inputEl.value || '').trim();
        if (!name) return;
        fetch('api.php?action=teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', team: name })
        })
          .then(function (r) {
            return r.json().then(function (data) {
              if (!r.ok) throw new Error(data.error || 'Fout bij toevoegen');
              return data;
            });
          })
          .then(function () {
            inputEl.value = '';
            loadTeams();
          })
          .catch(function (err) {
            alert(err.message || 'Kon team niet toevoegen.');
          });
      });
    }

    loadTeams();
  })();
  </script>
</body>
</html>
