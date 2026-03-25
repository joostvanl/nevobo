<?php
require_once __DIR__ . '/lib/auth.php';

if (!scout_auth_enabled() || !scout_is_logged_in()) {
    header('Location: auth/login.php');
    exit;
}

$teamName = isset($_GET['team']) ? trim((string)$_GET['team']) : '';
$userTeams = scout_user_teams();
if (!$teamName || !in_array($teamName, $userTeams, true)) {
    header('Location: teams.php');
    exit;
}

$pageTitle = htmlspecialchars($teamName) . ' – Spelers – Volleybal Scouting';
?>
<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#1a1a2e">
  <title><?= $pageTitle ?></title>
  <link rel="stylesheet" href="css/style.css">
  <style>
    .team-edit-page { max-width: 480px; margin: 0 auto; padding: 1rem; }
    .team-edit-page h1 { font-size: 1.35rem; margin-bottom: 0.5rem; }
    .team-edit-page .hint { color: var(--text-muted); margin-bottom: 1rem; }
    .add-player-card { background: var(--surface); border-radius: var(--radius); padding: 1.25rem; margin-bottom: 1.5rem; border: 1px solid var(--surface2); }
    .add-player-card h3 { margin: 0 0 1rem; font-size: 1rem; color: var(--text); }
    .add-player-form { display: grid; grid-template-columns: 1fr auto auto; gap: 0.75rem; align-items: end; }
    .add-player-form .field { margin-bottom: 0; }
    .add-player-form .field label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.35rem; }
    .add-player-form input { width: 100%; padding: 0.65rem 0.9rem; font-size: 0.95rem; border: 1px solid var(--surface2); border-radius: var(--radius); background: var(--bg); color: var(--text); }
    .add-player-form input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(61, 123, 245, 0.2); }
    .add-player-form input::placeholder { color: var(--text-muted); opacity: 0.7; }
    .add-player-form .field-number input { width: 4rem; text-align: center; }
    .add-player-form .btn { margin-bottom: 0; align-self: stretch; }
    @media (max-width: 420px) { .add-player-form { grid-template-columns: 1fr 1fr; } .add-player-form .btn { grid-column: span 2; } }
    .players-list { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1.5rem; }
    .player-row { display: flex; align-items: center; gap: 0.75rem; background: var(--surface); padding: 0.75rem 1rem; border-radius: var(--radius); border: 1px solid var(--surface2); }
    .player-row .player-info { flex: 1; display: flex; gap: 0.5rem; align-items: center; }
    .player-row .player-name { font-weight: 500; }
    .player-row .player-number { color: var(--accent); font-size: 0.9rem; font-weight: 600; }
    .player-row .btn-remove { padding: 0.25rem 0.5rem; font-size: 0.85rem; }
    .team-edit-back { margin-top: 1rem; }
    .team-edit-back a { color: var(--accent); text-decoration: none; }
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
    <h1><?= htmlspecialchars($teamName) ?></h1>
    <p class="subtitle">Spelers en rugnummers</p>
    <p class="header-links">
      <a href="teams.php">← Terug naar teambeheer</a>
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

  <main class="team-edit-page">
    <p class="hint">Voeg spelers toe met naam en shirtnummer. Deze spelers kunnen worden voorgeselecteerd bij het starten van een wedstrijd met dit team.</p>
    <div class="add-player-card">
      <h3>Nieuwe speler toevoegen</h3>
      <div class="add-player-form">
        <div class="field">
          <label for="newPlayerName">Naam</label>
          <input type="text" id="newPlayerName" placeholder="bijv. Jan de Vries" autocomplete="off">
        </div>
        <div class="field field-number">
          <label for="newPlayerNumber">Rugnummer</label>
          <input type="number" id="newPlayerNumber" placeholder="1" min="0" max="99" inputmode="numeric" title="Rugnummer">
        </div>
        <button type="button" class="btn btn-primary" id="btnAddPlayer">Toevoegen</button>
      </div>
    </div>
    <div id="playersList" class="players-list"><p id="playersLoading">Laden…</p></div>
    <p class="team-edit-back"><a href="teams.php">← Terug naar teambeheer</a></p>
  </main>

  <script src="js/utils.js?v=<?= filemtime(__DIR__ . '/js/utils.js') ?>"></script>
  <script src="js/menu.js?v=<?= filemtime(__DIR__ . '/js/menu.js') ?>"></script>
  <script>
  (function () {
    var teamName = <?= json_encode($teamName) ?>;
    var listEl = document.getElementById('playersList');
    var loadEl = document.getElementById('playersLoading');
    var nameInput = document.getElementById('newPlayerName');
    var numberInput = document.getElementById('newPlayerNumber');
    var btnAdd = document.getElementById('btnAddPlayer');

    function escapeHtml(s) {
      if (!s && s !== 0) return '';
      var d = document.createElement('div');
      d.textContent = String(s);
      return d.innerHTML;
    }
    function escapeAttr(s) {
      return (window.scoutUtils && window.scoutUtils.escapeAttr) ? window.scoutUtils.escapeAttr(s) : String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function loadPlayers() {
      fetch('api.php?action=team_players&team=' + encodeURIComponent(teamName))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
        .then(function (data) {
          var players = data.players || [];
          if (loadEl) loadEl.remove();
          if (players.length === 0) {
            listEl.innerHTML = '<p class="hint">Nog geen spelers. Voeg spelers toe met naam en rugnummer.</p>';
          } else {
            listEl.innerHTML = players.map(function (p) {
              var name = escapeHtml(p.name || '');
              var nameAttr = escapeAttr(p.name || '');
              var num = p.number != null ? Number(p.number) : 0;
              return '<div class="player-row" data-name="' + nameAttr + '" data-number="' + num + '">' +
                '<div class="player-info"><span class="player-name">' + name + '</span><span class="player-number">#' + num + '</span></div>' +
                '<button type="button" class="btn btn-small btn-remove" data-name="' + nameAttr + '" data-number="' + num + '">Verwijderen</button></div>';
            }).join('');
            listEl.querySelectorAll('.btn-remove').forEach(function (btn) {
              btn.addEventListener('click', function () {
                var name = btn.getAttribute('data-name');
                var num = btn.getAttribute('data-number');
                if (!name) return;
                fetch('api.php?action=team_players&team=' + encodeURIComponent(teamName), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ team: teamName, action: 'remove', name: name, number: num !== '' ? parseInt(num, 10) : null })
                }).then(function (r) { return r.ok ? loadPlayers() : Promise.reject(); });
              });
            });
          }
        })
        .catch(function () {
          if (loadEl) loadEl.remove();
          listEl.innerHTML = '<p class="hint">Kon spelers niet laden.</p>';
        });
    }

    function doAddPlayer() {
      var name = (nameInput.value || '').trim();
      var num = numberInput && numberInput.value !== '' ? parseInt(numberInput.value, 10) : 0;
      if (!name) return;
      if (isNaN(num)) num = 0;
      btnAdd.disabled = true;
      fetch('api.php?action=team_players&team=' + encodeURIComponent(teamName), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team: teamName, action: 'add', name: name, number: num })
      })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Fout'); });
          return r.json();
        })
        .then(function () {
          nameInput.value = '';
          if (numberInput) numberInput.value = '';
          loadPlayers();
          nameInput.focus();
        })
        .catch(function (err) {
          alert('Kon speler niet toevoegen: ' + (err.message || 'Onbekende fout'));
        })
        .finally(function () { btnAdd.disabled = false; });
    }

    if (btnAdd && nameInput) {
      btnAdd.addEventListener('click', doAddPlayer);
      if (numberInput) {
        numberInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAddPlayer(); } });
      }
      nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAddPlayer(); } });
    }

    loadPlayers();
  })();
  </script>
</body>
</html>
