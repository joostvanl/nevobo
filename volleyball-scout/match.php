<?php
$pageTitle = 'Wedstrijd – Scouting';
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
</head>
<body class="match-page">
  <header class="header compact">
    <a href="index.php" class="back-link" aria-label="Terug">←</a>
    <button type="button" class="btn-fullscreen" id="btnFullscreen" aria-label="Volledig scherm" title="Volledig scherm">
      <svg class="icon-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
      <svg class="icon-exit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
    </button>
    <div class="score-board">
      <div class="score-board-team score-board-left">
        <span id="matchTeamA" class="team-name"></span>
      </div>
      <div class="score-board-center">
        <div class="score-tiles score-points">
          <span class="score-tile score-tile-editable" id="scoreA" role="button" tabindex="0" title="Klik om aan te passen">0</span>
          <span class="score-tile score-tile-sep">–</span>
          <span class="score-tile score-tile-editable" id="scoreB" role="button" tabindex="0" title="Klik om aan te passen">0</span>
        </div>
        <div class="score-tiles score-sets">
          <span class="score-tile score-tile-small score-tile-editable" id="setA" role="button" tabindex="0" title="Klik om aan te passen">0</span>
          <span class="score-tile score-tile-small score-tile-sep">–</span>
          <span class="score-tile score-tile-small score-tile-editable" id="setB" role="button" tabindex="0" title="Klik om aan te passen">0</span>
        </div>
      </div>
      <div class="score-board-team score-board-right">
        <span id="matchTeamB" class="team-name"></span>
      </div>
    </div>
  </header>

  <main class="main match-main">
    <div id="matchLoadError" class="match-load-error hidden" aria-live="polite"></div>
    <section class="rotation-card card">
      <div class="rotation-court" id="rotationCourt">
        <!-- Net boven posities 2, 3, 4 | Voorrij: links=4(LV), midden=3(MV), rechts=2(RV) | Achterrij: links=5(LA), midden=6(MA), rechts=1(RA/service) -->
        <div class="court-net" aria-hidden="true"></div>
        <div class="court-row court-front">
          <div class="player-tile court-cell" data-zone="4" id="cell-4"><span class="tile-badge" id="badge-4"></span><span class="tile-name zone-player" id="player-4"></span></div>
          <div class="player-tile court-cell" data-zone="3" id="cell-3"><span class="tile-badge" id="badge-3"></span><span class="tile-name zone-player" id="player-3"></span></div>
          <div class="player-tile court-cell" data-zone="2" id="cell-2"><span class="tile-badge" id="badge-2"></span><span class="tile-name zone-player" id="player-2"></span></div>
        </div>
        <div class="court-row court-back">
          <div class="player-tile court-cell" data-zone="5" id="cell-5"><span class="tile-badge" id="badge-5"></span><span class="tile-name zone-player" id="player-5"></span></div>
          <div class="player-tile court-cell" data-zone="6" id="cell-6"><span class="tile-badge" id="badge-6"></span><span class="tile-name zone-player" id="player-6"></span></div>
          <div class="player-tile court-cell court-service" data-zone="1" id="cell-1"><span class="tile-badge" id="badge-1"></span><span class="tile-name zone-player" id="player-1"></span></div>
        </div>
      </div>
      <div class="rotation-controls">
        <button type="button" class="btn btn-rotation" id="rotationPrev" aria-label="Vorige rotatie">← Rotatie</button>
        <span class="rotation-num" id="rotationNum">1</span>
        <button type="button" class="btn btn-rotation" id="rotationNext" aria-label="Volgende rotatie">Rotatie →</button>
      </div>
    </section>

    <section class="events-section">
      <!-- Zichtbaar als er nog geen service in deze rally is -->
      <div class="btn-group" id="group-service">
        <div id="group-service-first" class="service-buttons">
          <button type="button" class="btn btn-event" id="btnServiceHome" data-desc="Service" data-short="S" data-panel="0" data-team="home">Thuis serveert</button>
          <button type="button" class="btn btn-event" id="btnServiceAway" data-desc="Service" data-short="S" data-panel="0" data-team="away">Uit serveert</button>
        </div>
        <div id="group-service-known" class="service-known-full hidden">
          <button type="button" class="btn btn-event" id="btnServiceKnown" data-desc="Service" data-short="S" data-panel="0">Service</button>
        </div>
      </div>

      <div class="btn-group btn-group-full hidden" id="group-pass">
        <div class="pass-row">
          <button type="button" class="btn btn-event btn-pass-zone" data-desc="Zone I" data-short="I" data-panel="1">Zone I</button>
          <button type="button" class="btn btn-event btn-pass-zone" data-desc="Zone II" data-short="II" data-panel="1">Zone II</button>
          <button type="button" class="btn btn-event btn-pass-zone" data-desc="Zone III" data-short="III" data-panel="1">Zone III</button>
          <button type="button" class="btn btn-event btn-overpass" data-desc="Overpass" data-short="OP" data-panel="1">Overpass</button>
        </div>
      </div>

      <!-- Zichtbaar na pass, voor setup -->
      <div class="btn-group btn-group-full hidden" id="group-setup">
        <button type="button" class="btn btn-event" data-desc="5" data-short="5" data-panel="1">5</button>
        <button type="button" class="btn btn-event" data-desc="1" data-short="1" data-panel="1">1</button>
        <button type="button" class="btn btn-event" data-desc="C" data-short="C" data-panel="1">C</button>
        <button type="button" class="btn btn-event" data-desc="10" data-short="10" data-panel="1">10</button>
        <button type="button" class="btn btn-event" data-desc="Pipe" data-short="Pipe" data-panel="1">Pipe</button>
        <button type="button" class="btn btn-event" data-desc="30" data-short="30" data-panel="1">30</button>
      </div>

      <!-- Punt toekennen: zichtbaar zodra rally gestart. Na setup: alleen Punt thuis/uit met vervolgopties -->
      <div class="point-buttons hidden" id="group-point">
        <button type="button" class="btn btn-point btn-home" id="pointHome">Punt thuis</button>
        <button type="button" class="btn btn-point btn-away" id="pointAway">Punt uit</button>
      </div>
      <div class="btn-group outcome-sub hidden" id="group-outcome-sub">
        <div class="outcome-sub-buttons" id="outcomeSubButtons">
          <button type="button" class="btn btn-event btn-outcome-sub" data-desc="Out" data-short="" data-panel="4">Out</button>
          <button type="button" class="btn btn-event btn-outcome-sub" data-desc="Drop" data-short="" data-panel="4">Drop</button>
          <button type="button" class="btn btn-event btn-outcome-sub" data-desc="Smash" data-short="Smash" data-panel="2">Smash</button>
          <button type="button" class="btn btn-event btn-outcome-sub" data-desc="Tip" data-short="Tip" data-panel="2">Tip</button>
          <button type="button" class="btn btn-event btn-outcome-sub" data-desc="Block" data-short="Sc" data-panel="3">Block</button>
          <button type="button" class="btn btn-event btn-outcome-sub" data-desc="Ace" data-short="A" data-panel="4">Ace</button>
        </div>
        <button type="button" class="btn btn-small btn-outcome-cancel" id="outcomeSubCancel">Annuleren</button>
      </div>
    </section>

    <section class="current-rally card minimal">
      <div class="rally-history-bar">
        <div id="currentRallyEvents" class="rally-events"></div>
        <button type="button" class="btn btn-undo" id="rallyUndo" aria-label="Ongedaan maken" title="Laatste actie ongedaan maken">↶ Undo</button>
      </div>
      <div class="rally-history-bar rally-history-prev">
        <span class="rally-history-label">Vorige rally:</span>
        <div id="previousRallyEvents" class="rally-events"></div>
      </div>
    </section>
  </main>

  <nav class="match-action-bar" aria-label="Wedstrijdacties">
    <button type="button" class="action-bar-btn" id="btnWissels" title="Wissels">
      <span class="action-bar-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/></svg>
      </span>
      <span class="action-bar-label">Wissels</span>
    </button>
    <button type="button" class="action-bar-btn" id="btnTimeout" title="AI Coach – Timeout advies" data-state="idle">
      <span class="action-bar-icon action-bar-icon-default" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </span>
      <span class="action-bar-icon action-bar-icon-spinner hidden" aria-hidden="true">
        <svg class="icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10" stroke-dasharray="47 16"/></svg>
      </span>
      <span class="action-bar-icon action-bar-icon-ready hidden" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>
      </span>
      <span class="action-bar-label">Timeout</span>
    </button>
    <button type="button" class="action-bar-btn" id="btnOpties" title="Opties">
      <span class="action-bar-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </span>
      <span class="action-bar-label">Opties</span>
    </button>
    <button type="button" class="action-bar-btn" id="btnDelen" title="Deel matchrapport" aria-label="Deel via sociale media">
      <span class="action-bar-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>
      </span>
      <span class="action-bar-label">Delen</span>
    </button>
    <button type="button" class="action-bar-btn" id="btnEind" title="Eind wedstrijd">
      <span class="action-bar-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
      </span>
      <span class="action-bar-label">Eind</span>
    </button>
  </nav>

  <div class="wissel-overlay hidden" id="wisselOverlay" aria-hidden="true">
    <div class="options-backdrop" id="wisselBackdrop"></div>
    <div class="options-panel wissel-panel">
      <div class="options-header">
        <h2>Wissels</h2>
        <button type="button" class="options-close" id="wisselClose" aria-label="Sluiten">×</button>
      </div>
      <div class="options-body">
        <p class="options-hint wissel-hint">Klik veld of bank, dan de andere. Max 6 wissels per set.</p>
        <div class="setup-court">
          <div class="court-net" aria-hidden="true"></div>
          <div class="court-row court-front">
            <div class="setup-cell court-cell" data-pos="4" id="wissel-cell-4"><span class="tile-badge">4</span><span class="tile-name"></span></div>
            <div class="setup-cell court-cell" data-pos="3" id="wissel-cell-3"><span class="tile-badge">3</span><span class="tile-name"></span></div>
            <div class="setup-cell court-cell" data-pos="2" id="wissel-cell-2"><span class="tile-badge">2</span><span class="tile-name"></span></div>
          </div>
          <div class="court-row court-back">
            <div class="setup-cell court-cell" data-pos="5" id="wissel-cell-5"><span class="tile-badge">5</span><span class="tile-name"></span></div>
            <div class="setup-cell court-cell" data-pos="6" id="wissel-cell-6"><span class="tile-badge">6</span><span class="tile-name"></span></div>
            <div class="setup-cell court-cell court-service" data-pos="1" id="wissel-cell-1"><span class="tile-badge">1</span><span class="tile-name"></span></div>
          </div>
        </div>
        <p class="setup-section-label">Wisselspelers <span id="wisselCount" class="wissel-count"></span></p>
        <div class="setup-subs-row">
          <div class="setup-cell setup-sub" data-pos="7" id="wissel-cell-7"><span class="tile-badge">–</span><span class="tile-name"></span></div>
          <div class="setup-cell setup-sub" data-pos="8" id="wissel-cell-8"><span class="tile-badge">–</span><span class="tile-name"></span></div>
          <div class="setup-cell setup-sub" data-pos="9" id="wissel-cell-9"><span class="tile-badge">–</span><span class="tile-name"></span></div>
          <div class="setup-cell setup-sub" data-pos="10" id="wissel-cell-10"><span class="tile-badge">–</span><span class="tile-name"></span></div>
          <div class="setup-cell setup-sub" data-pos="11" id="wissel-cell-11"><span class="tile-badge">–</span><span class="tile-name"></span></div>
          <div class="setup-cell setup-sub" data-pos="12" id="wissel-cell-12"><span class="tile-badge">–</span><span class="tile-name"></span></div>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="wisselBackToMatch">Terug naar wedstrijd</button>
      </div>
    </div>
  </div>

  <div class="timeout-overlay hidden" id="timeoutOverlay" aria-hidden="true">
    <div class="options-backdrop" id="timeoutBackdrop"></div>
    <div class="options-panel timeout-panel">
      <div class="options-header">
        <h2>AI Coach – Timeout advies</h2>
        <button type="button" class="options-close" id="timeoutClose" aria-label="Sluiten">×</button>
      </div>
      <div class="options-body" id="timeoutBody">
        <div id="timeoutLoading" class="timeout-loading">
          <div class="timeout-spinner" aria-hidden="true"></div>
          <p class="timeout-loading-text">AI coach is aan het nadenken…</p>
        </div>
        <div id="timeoutContent" class="timeout-content hidden">
          <p class="timeout-intro">Op basis van de wedstrijddata adviseert de AI coach:</p>
          <div id="timeoutAdviceBody" class="timeout-advice-body"></div>
        </div>
        <div id="timeoutError" class="timeout-error hidden"></div>
      </div>
    </div>
  </div>

  <div class="options-overlay hidden" id="optionsOverlay" aria-hidden="true">
    <div class="options-backdrop" id="optionsBackdrop"></div>
    <div class="options-panel">
      <div class="options-header">
        <h2>Opties</h2>
        <button type="button" class="options-close" id="optionsClose" aria-label="Sluiten">×</button>
      </div>
      <div class="options-body">
        <div class="options-section">
          <h3>Systeem</h3>
          <p class="options-hint">Welk aanvalsysteem speelt het team?</p>
          <div class="options-choices" id="systemChoices">
            <label class="option-choice"><input type="radio" name="matchSystem" value="5-1"> 5-1</label>
            <label class="option-choice"><input type="radio" name="matchSystem" value="4-2"> 4-2</label>
            <label class="option-choice"><input type="radio" name="matchSystem" value="geen"> Geen systeem</label>
          </div>
        </div>
        <div class="options-section">
          <h3>Libero</h3>
          <p class="options-hint">De libero staat op wisselpositie 1 en wisselt automatisch voor Mid of PL wanneer die in de achterrij staat (na service).</p>
          <label class="option-choice option-check">
            <input type="checkbox" id="optLiberoUse" name="liberoUse">
            <span>Gebruik libero</span>
          </label>
          <div class="options-sub" id="liberoSubOptions">
            <p class="options-hint">Wissel voor:</p>
            <div class="options-choices">
              <label class="option-choice"><input type="radio" name="liberoSubFor" value="mid"> Wissel voor Mid</label>
              <label class="option-choice"><input type="radio" name="liberoSubFor" value="pl"> Wissel voor PL</label>
            </div>
          </div>
        </div>
        <div class="options-section">
          <a href="#" id="matchReportLink" class="options-link">Bekijk matchrapport</a>
        </div>
        <div class="options-section options-section-placeholder">
          <p class="options-more">Meer opties volgen…</p>
        </div>
      </div>
    </div>
  </div>

  <?php
  $apiBase = (isset($_SERVER['SCRIPT_NAME']) ? rtrim(dirname($_SERVER['SCRIPT_NAME']), '/') . '/' : '');
  ?>
  <script>window.SCOUT_API_BASE = <?= json_encode($apiBase) ?>;</script>
  <script src="js/auth.js?v=<?= filemtime(__DIR__ . '/js/auth.js') ?>"></script>
  <script src="js/utils.js?v=<?= filemtime(__DIR__ . '/js/utils.js') ?>"></script>
  <script src="js/report-aggregate.js?v=<?= filemtime(__DIR__ . '/js/report-aggregate.js') ?>"></script>
  <script src="js/rules.js?v=<?= filemtime(__DIR__ . '/js/rules.js') ?>"></script>
  <script src="js/rotation.js?v=<?= filemtime(__DIR__ . '/js/rotation.js') ?>"></script>
  <script src="js/dialog.js?v=<?= filemtime(__DIR__ . '/js/dialog.js') ?>"></script>
  <script src="js/match.js?v=<?= filemtime(__DIR__ . '/js/match.js') ?>"></script>
</body>
</html>
