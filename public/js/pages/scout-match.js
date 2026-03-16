/**
 * scout-match.js — Scout match scherm
 * Injecteert de volledige HTML van het wedstrijdscherm en laadt de scout JS-bestanden.
 * De scout JS-bestanden communiceren via window globals (SCOUT_API_BASE, _scoutToken).
 */
import { state, api } from '../app.js';

// Track loaded scripts so we don't double-load on revisit
const loadedScripts = new Set();

// ── Scout lock management ───────────────────────────────────────────────────
let _heartbeatTimer = null;
let _lockedMatchId  = null;

// Unique tab/session identifier — persists across page navigations within the
// same tab but differs between tabs/devices, preventing the same user from
// scouting on two devices simultaneously.
function generateTabId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for non-secure contexts (HTTP)
  return 'tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
const _scoutTabId = sessionStorage.getItem('_scoutTabId')
  || (() => { const id = generateTabId(); sessionStorage.setItem('_scoutTabId', id); return id; })();

const lockHeaders = () => ({
  'Authorization': `Bearer ${state.token || ''}`,
  'Content-Type': 'application/json',
});

async function acquireLock(matchId) {
  const res = await fetch(`/api/scout/match/${encodeURIComponent(matchId)}/lock`, {
    method: 'POST',
    headers: lockHeaders(),
    body: JSON.stringify({ tabId: _scoutTabId }),
  });
  return res.ok;
}

async function releaseLock(matchId) {
  if (!matchId) return;
  try {
    await fetch(`/api/scout/match/${encodeURIComponent(matchId)}/unlock`, {
      method: 'POST',
      headers: lockHeaders(),
      body: JSON.stringify({ tabId: _scoutTabId }),
    });
  } catch (_) {}
}

function startHeartbeat(matchId) {
  stopHeartbeat();
  _lockedMatchId = matchId;
  _heartbeatTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/scout/match/${encodeURIComponent(matchId)}/heartbeat`, {
        method: 'POST',
        headers: lockHeaders(),
        body: JSON.stringify({ tabId: _scoutTabId }),
      });
      if (!res.ok) stopHeartbeat();
    } catch (_) {}
  }, 15_000);
}

function stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}

// Flag to prevent lock release during internal scout navigation (e.g. set lineup)
let _scoutInternalNav = false;

function cleanupScoutLock() {
  if (_scoutInternalNav) return;
  stopHeartbeat();
  if (_lockedMatchId) {
    const id = _lockedMatchId;
    _lockedMatchId = null;
    navigator.sendBeacon?.(
      `/api/scout/match/${encodeURIComponent(id)}/unlock`,
      new Blob([JSON.stringify({ token: state.token || '', tabId: _scoutTabId })], { type: 'application/json' })
    );
    releaseLock(id);
  }
}

function pauseHeartbeatForInternalNav() {
  _scoutInternalNav = true;
}

function resumeHeartbeatAfterInternalNav(matchId) {
  _scoutInternalNav = false;
  _lockedMatchId = matchId;
  startHeartbeat(matchId);
}

// Release lock when page fully unloads (close tab / refresh)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    _scoutInternalNav = false;
    cleanupScoutLock();
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (loadedScripts.has(src)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload  = () => { loadedScripts.add(src); resolve(); };
    s.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(s);
  });
}

export async function render(container, params = {}) {
  const { scoutMatchId = null } = params;

  if (!state.user) {
    container.innerHTML = `<div class="container mt-4"><div class="card"><div class="card-body text-center">
      <p>Je moet ingelogd zijn om te scouten.</p>
      <button class="btn btn-primary" onclick="navigate('login')">Inloggen</button>
    </div></div></div>`;
    return;
  }

  if (!scoutMatchId) {
    navigate('scout-setup');
    return;
  }

  // Expose globals the scout JS scripts need
  window._scoutToken    = state.token || '';
  window.SCOUT_API_BASE = '/api/scout/';

  // Reset internal-nav flag (we're entering/re-entering the match screen)
  _scoutInternalNav = false;

  // ── Acquire exclusive scout lock ──────────────────────────────────────────
  const lockOk = await acquireLock(scoutMatchId);
  if (!lockOk) {
    let lockedBy = 'iemand anders';
    try {
      const st = await api(`/api/scout/status/${encodeURIComponent(scoutMatchId)}`);
      if (st?.lockedBy) lockedBy = st.lockedBy;
    } catch (_) {}
    container.innerHTML = `<div class="container mt-4"><div class="card"><div class="card-body text-center">
      <div style="font-size:2.5rem;margin-bottom:0.75rem">🔒</div>
      <h3 style="margin:0 0 0.5rem">Scouting bezet</h3>
      <p class="text-muted" style="margin:0 0 1.5rem">Deze wedstrijd wordt momenteel gescouted door <strong>${lockedBy}</strong>. Er kan slechts 1 persoon tegelijk scouten.</p>
      <button class="btn btn-primary" id="back-to-matches">← Terug naar wedstrijden</button>
    </div></div></div>`;
    container.querySelector('#back-to-matches').addEventListener('click', () => navigate('matches'));
    return;
  }
  startHeartbeat(scoutMatchId);

  // Expose lock functions so match.js can manage the lock
  window._scoutCleanupLock = cleanupScoutLock;
  window._scoutPauseLock   = pauseHeartbeatForInternalNav;
  window._scoutResumeLock  = () => resumeHeartbeatAfterInternalNav(scoutMatchId);

  // Override navigate for scout internal routing
  const originalNavigateBack = () => {
    cleanupScoutLock();
    navigate('matches');
  };
  window._scoutNavigateBack = originalNavigateBack;

  // Inject the full match HTML (mirrors match.php structure, styled with app CSS vars + scout.css)
  container.innerHTML = `
    <div class="scout-match-hero">
      <button class="back-btn" id="scout-back-btn">← Terug</button>
      <span class="title" id="scout-match-title">🏐 Bezig…</span>
    </div>

    <div class="main match-main" style="padding:0 0.75rem 6rem">
      <div id="matchLoadError" class="match-load-error hidden" aria-live="polite"
        style="background:var(--danger-bg,#fee2e2);color:var(--danger,#ef4444);border-radius:var(--radius);padding:1rem;margin-bottom:0.75rem"></div>

      <!-- Scorebord -->
      <div class="header compact" style="background:var(--primary);border-radius:var(--radius);padding:0.75rem;margin-bottom:0.75rem">
        <div class="score-board" style="display:flex;align-items:center;justify-content:space-between;color:#fff">
          <div class="score-board-team score-board-left" style="flex:1;text-align:left">
            <span id="matchTeamA" class="team-name" style="font-size:0.8rem;font-weight:700;opacity:0.9"></span>
          </div>
          <div class="score-board-center" style="text-align:center">
            <div class="score-tiles score-points" style="display:flex;align-items:center;gap:0.25rem;justify-content:center">
              <span class="score-tile score-tile-editable" id="scoreA" role="button" tabindex="0"
                style="font-size:2.8rem;font-weight:900;min-width:2.2rem;cursor:pointer">0</span>
              <span class="score-tile score-tile-sep" style="font-size:1.8rem;opacity:0.6">–</span>
              <span class="score-tile score-tile-editable" id="scoreB" role="button" tabindex="0"
                style="font-size:2.8rem;font-weight:900;min-width:2.2rem;cursor:pointer">0</span>
            </div>
            <div class="score-tiles score-sets" style="display:flex;align-items:center;gap:0.25rem;justify-content:center;margin-top:0.1rem">
              <span class="score-tile score-tile-small score-tile-editable" id="setA" role="button" tabindex="0"
                style="font-size:1.1rem;font-weight:700;cursor:pointer">0</span>
              <span class="score-tile score-tile-small score-tile-sep" style="opacity:0.6">–</span>
              <span class="score-tile score-tile-small score-tile-editable" id="setB" role="button" tabindex="0"
                style="font-size:1.1rem;font-weight:700;cursor:pointer">0</span>
            </div>
          </div>
          <div class="score-board-team score-board-right" style="flex:1;text-align:right">
            <span id="matchTeamB" class="team-name" style="font-size:0.8rem;font-weight:700;opacity:0.9"></span>
          </div>
        </div>
      </div>

      <!-- Rotatie veld -->
      <section class="rotation-card card mb-2">
        <div class="rotation-court card-body" id="rotationCourt" style="padding:0.5rem">
          <div class="court-net" aria-hidden="true"
            style="height:4px;background:var(--primary);border-radius:2px;margin:0.25rem 0 0.35rem;opacity:0.5"></div>
          <div class="court-row court-front"
            style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.35rem;margin-bottom:0.35rem">
            <div class="player-tile court-cell" data-zone="4" id="cell-4"
              style="background:var(--surface,#f0f0f5);border:1px solid var(--border);border-radius:6px;padding:0.4rem;text-align:center;cursor:pointer;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center">
              <span class="tile-badge" id="badge-4" style="font-size:0.65rem;color:var(--text-muted)"></span>
              <span class="tile-name zone-player" id="player-4" style="font-size:0.8rem;font-weight:700"></span>
            </div>
            <div class="player-tile court-cell" data-zone="3" id="cell-3"
              style="background:var(--surface,#f0f0f5);border:1px solid var(--border);border-radius:6px;padding:0.4rem;text-align:center;cursor:pointer;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center">
              <span class="tile-badge" id="badge-3" style="font-size:0.65rem;color:var(--text-muted)"></span>
              <span class="tile-name zone-player" id="player-3" style="font-size:0.8rem;font-weight:700"></span>
            </div>
            <div class="player-tile court-cell" data-zone="2" id="cell-2"
              style="background:var(--surface,#f0f0f5);border:1px solid var(--border);border-radius:6px;padding:0.4rem;text-align:center;cursor:pointer;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center">
              <span class="tile-badge" id="badge-2" style="font-size:0.65rem;color:var(--text-muted)"></span>
              <span class="tile-name zone-player" id="player-2" style="font-size:0.8rem;font-weight:700"></span>
            </div>
          </div>
          <div class="court-row court-back"
            style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.35rem">
            <div class="player-tile court-cell" data-zone="5" id="cell-5"
              style="background:var(--surface,#f0f0f5);border:1px solid var(--border);border-radius:6px;padding:0.4rem;text-align:center;cursor:pointer;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center">
              <span class="tile-badge" id="badge-5" style="font-size:0.65rem;color:var(--text-muted)"></span>
              <span class="tile-name zone-player" id="player-5" style="font-size:0.8rem;font-weight:700"></span>
            </div>
            <div class="player-tile court-cell" data-zone="6" id="cell-6"
              style="background:var(--surface,#f0f0f5);border:1px solid var(--border);border-radius:6px;padding:0.4rem;text-align:center;cursor:pointer;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center">
              <span class="tile-badge" id="badge-6" style="font-size:0.65rem;color:var(--text-muted)"></span>
              <span class="tile-name zone-player" id="player-6" style="font-size:0.8rem;font-weight:700"></span>
            </div>
            <div class="player-tile court-cell court-service" data-zone="1" id="cell-1"
              style="background:var(--primary-light,rgba(37,99,235,0.08));border:2px solid var(--primary);border-radius:6px;padding:0.4rem;text-align:center;cursor:pointer;min-height:44px;display:flex;flex-direction:column;align-items:center;justify-content:center">
              <span class="tile-badge" id="badge-1" style="font-size:0.65rem;color:var(--primary)">⚡</span>
              <span class="tile-name zone-player" id="player-1" style="font-size:0.8rem;font-weight:700"></span>
            </div>
          </div>
          <div class="rotation-controls"
            style="display:flex;align-items:center;justify-content:space-between;margin-top:0.5rem">
            <button type="button" class="btn btn-ghost" id="rotationPrev" style="font-size:0.85rem;padding:0.4rem 0.75rem">← Rotatie</button>
            <span class="rotation-num" id="rotationNum" style="font-weight:700;color:var(--text-muted)">1</span>
            <button type="button" class="btn btn-ghost" id="rotationNext" style="font-size:0.85rem;padding:0.4rem 0.75rem">Rotatie →</button>
          </div>
        </div>
      </section>

      <!-- Actieknoppen — buttonbox -->
      <section class="scout-buttonbox mb-2">

        <!-- Service -->
        <div class="sbox-row" id="group-service">
          <div id="group-service-first" class="sbox-grid sbox-grid-2">
            <button type="button" class="sbox-btn sbox-btn--primary btn-event" id="btnServiceHome"
              data-desc="Service" data-short="S" data-panel="0" data-team="home">Thuis serveert</button>
            <button type="button" class="sbox-btn btn-event" id="btnServiceAway"
              data-desc="Service" data-short="S" data-panel="0" data-team="away">Uit serveert</button>
          </div>
          <div id="group-service-known" class="hidden">
            <button type="button" class="sbox-btn sbox-btn--primary sbox-btn--wide btn-event" id="btnServiceKnown"
              data-desc="Service" data-short="S" data-panel="0">Service</button>
          </div>
        </div>

        <!-- Pass -->
        <div class="sbox-row hidden" id="group-pass">
          <div class="sbox-label">Pass</div>
          <div class="sbox-grid sbox-grid-4">
            <button type="button" class="sbox-btn sbox-btn--accent btn-event btn-pass-zone" data-desc="Zone I" data-short="I" data-panel="1">I</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event btn-pass-zone" data-desc="Zone II" data-short="II" data-panel="1">II</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event btn-pass-zone" data-desc="Zone III" data-short="III" data-panel="1">III</button>
            <button type="button" class="sbox-btn sbox-btn--warn btn-event btn-overpass" data-desc="Overpass" data-short="OP" data-panel="1">Over</button>
          </div>
        </div>

        <!-- Setup / aanval -->
        <div class="sbox-row hidden" id="group-setup">
          <div class="sbox-label">Setup</div>
          <div class="sbox-grid sbox-grid-3">
            <button type="button" class="sbox-btn sbox-btn--accent btn-event" data-desc="5" data-short="5" data-panel="1">5</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event" data-desc="1" data-short="1" data-panel="1">1</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event" data-desc="C" data-short="C" data-panel="1">C</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event" data-desc="10" data-short="10" data-panel="1">10</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event" data-desc="Pipe" data-short="Pipe" data-panel="1">Pipe</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event" data-desc="30" data-short="30" data-panel="1">30</button>
          </div>
        </div>

        <!-- Punt knoppen — sluitstuk rally -->
        <div class="sbox-row hidden" id="group-point">
          <div class="sbox-grid sbox-grid-2">
            <button type="button" class="sbox-btn sbox-btn--point sbox-btn--point-home" id="pointHome">Punt thuis</button>
            <button type="button" class="sbox-btn sbox-btn--point sbox-btn--point-away" id="pointAway">Punt uit</button>
          </div>
        </div>

        <!-- Outcome sub (hoe eindigde de rally?) -->
        <div class="sbox-row hidden" id="group-outcome-sub">
          <div class="sbox-label" id="outcomeSubLabel">Hoe eindigde de rally?</div>
          <div class="sbox-grid sbox-grid-3" id="outcomeSubButtons">
            <button type="button" class="sbox-btn btn-event btn-outcome-sub" data-desc="Out" data-short="" data-panel="4">Out</button>
            <button type="button" class="sbox-btn btn-event btn-outcome-sub" data-desc="Drop" data-short="" data-panel="4">Drop</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event btn-outcome-sub" data-desc="Smash" data-short="Smash" data-panel="2">Smash</button>
            <button type="button" class="sbox-btn sbox-btn--accent btn-event btn-outcome-sub" data-desc="Tip" data-short="Tip" data-panel="2">Tip</button>
            <button type="button" class="sbox-btn btn-event btn-outcome-sub" data-desc="Block" data-short="Sc" data-panel="3">Block</button>
            <button type="button" class="sbox-btn sbox-btn--warn btn-event btn-outcome-sub" data-desc="Ace" data-short="A" data-panel="4">Ace</button>
          </div>
          <button type="button" class="sbox-btn sbox-btn--cancel" id="outcomeSubCancel">Annuleren</button>
        </div>

      </section>

      <!-- Rally log -->
      <section class="current-rally card mb-2">
        <div class="card-body" style="padding:0.75rem">
          <div class="rally-history-bar" style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.35rem">
            <div id="currentRallyEvents" class="rally-events"
              style="flex:1;display:flex;flex-wrap:wrap;gap:0.25rem;min-height:24px"></div>
            <button type="button" class="btn btn-ghost" id="rallyUndo"
              style="font-size:0.82rem;padding:0.3rem 0.6rem;flex-shrink:0">↶ Undo</button>
          </div>
          <div class="rally-history-bar rally-history-prev"
            style="display:flex;gap:0.4rem;font-size:0.78rem;color:var(--text-muted)">
            <span class="rally-history-label">Vorige rally:</span>
            <div id="previousRallyEvents" class="rally-events" style="display:flex;flex-wrap:wrap;gap:0.2rem"></div>
          </div>
        </div>
      </section>
    </div>

    <!-- Bottom action bar -->
    <nav class="match-action-bar"
      style="position:fixed;bottom:calc(var(--nav-height, 64px) + env(safe-area-inset-bottom,0px));left:0;right:0;
             background:var(--card-bg,#fff);border-top:1px solid var(--border);
             display:flex;z-index:250;box-shadow:0 -2px 12px rgba(0,0,0,0.08);pointer-events:auto">
      <button type="button" class="action-bar-btn" id="btnWissels"
        style="flex:1;display:flex;flex-direction:column;align-items:center;padding:0.6rem 0;border:none;background:none;cursor:pointer;font-size:0.72rem;color:var(--text-muted)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:2px"><path d="M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"/></svg>
        Wissels
      </button>
      <button type="button" class="action-bar-btn" id="btnTimeout" data-state="idle"
        style="flex:1;display:flex;flex-direction:column;align-items:center;padding:0.6rem 0;border:none;background:none;cursor:pointer;font-size:0.72rem;color:var(--text-muted)">
        <svg class="action-bar-icon-default" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:2px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <svg class="action-bar-icon-spinner hidden icon-spin" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="margin-bottom:2px;display:none"><circle cx="12" cy="12" r="10" stroke-dasharray="47 16"/></svg>
        <svg class="action-bar-icon-ready hidden" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:2px;display:none"><path d="M20 6L9 17l-5-5"/></svg>
        Timeout
      </button>
      <button type="button" class="action-bar-btn" id="btnOpties"
        style="flex:1;display:flex;flex-direction:column;align-items:center;padding:0.6rem 0;border:none;background:none;cursor:pointer;font-size:0.72rem;color:var(--text-muted)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:2px"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Opties
      </button>
      <button type="button" class="action-bar-btn" id="btnEind"
        style="flex:1;display:flex;flex-direction:column;align-items:center;padding:0.6rem 0;border:none;background:none;cursor:pointer;font-size:0.72rem;color:var(--danger,#ef4444)">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:2px"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
        Eind
      </button>
    </nav>

    <!-- Wissel overlay (1:1 match.php structuur) -->
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

    <!-- Timeout overlay -->
    <div class="timeout-overlay hidden" id="timeoutOverlay" aria-hidden="true">
      <div class="options-backdrop" id="timeoutBackdrop"></div>
      <div class="options-panel timeout-panel">
        <div class="options-header">
          <h2>AI Coach – Timeout advies</h2>
          <button type="button" class="options-close" id="timeoutClose">×</button>
        </div>
        <div id="timeoutBody">
          <div id="timeoutLoading" class="text-center" style="padding:2rem">
            <div class="spinner"></div>
            <p class="text-muted mt-2">AI coach is aan het nadenken…</p>
          </div>
          <div id="timeoutContent" class="hidden">
            <p class="text-muted text-small mb-2">Op basis van de wedstrijddata adviseert de AI coach:</p>
            <div id="timeoutAdviceBody"></div>
          </div>
          <div id="timeoutError" class="hidden" style="color:var(--danger)"></div>
        </div>
      </div>
    </div>

    <!-- Opties overlay -->
    <div class="options-overlay hidden" id="optionsOverlay" aria-hidden="true">
      <div class="options-backdrop" id="optionsBackdrop"></div>
      <div class="options-panel">
        <div class="options-header">
          <h2>Opties</h2>
          <button type="button" class="options-close" id="optionsClose">×</button>
        </div>
        <div class="options-body">
          <div class="options-section mb-3">
            <h3 class="text-small text-muted mb-1">Systeem</h3>
            <div id="systemChoices" style="display:flex;flex-direction:column;gap:0.4rem">
              <label class="flex items-center gap-2"><input type="radio" name="matchSystem" value="5-1"> 5-1</label>
              <label class="flex items-center gap-2"><input type="radio" name="matchSystem" value="4-2"> 4-2</label>
              <label class="flex items-center gap-2"><input type="radio" name="matchSystem" value="geen"> Geen systeem</label>
            </div>
          </div>
          <div class="options-section mb-3">
            <h3 class="text-small text-muted mb-1">Libero</h3>
            <label class="flex items-center gap-2 mb-1">
              <input type="checkbox" id="optLiberoUse" name="liberoUse">
              <span>Gebruik libero</span>
            </label>
            <div id="liberoSubOptions" style="padding-left:1.5rem">
              <div style="display:flex;flex-direction:column;gap:0.4rem">
                <label class="flex items-center gap-2"><input type="radio" name="liberoSubFor" value="mid"> Wissel voor Mid</label>
                <label class="flex items-center gap-2"><input type="radio" name="liberoSubFor" value="pl"> Wissel voor PL</label>
              </div>
            </div>
          </div>
          <div class="options-section">
            <a href="#" id="matchReportLink" class="text-small" style="color:var(--primary)">Bekijk matchrapport</a>
          </div>
        </div>
      </div>
    </div>`;

  // Back button — release lock before navigating away
  container.querySelector('#scout-back-btn').addEventListener('click', () => {
    cleanupScoutLock();
    navigate('matches');
  });

  // Store matchId for the scout JS scripts
  try {
    localStorage.setItem('scoutCurrentMatchId', scoutMatchId);
  } catch (_) {}

  // Load scout scripts sequentially (they rely on each other via globals)
  try {
    await loadScript('/js/scout/utils.js');
    await loadScript('/js/scout/rules.js');
    await loadScript('/js/scout/rotation.js');
    await loadScript('/js/scout/dialog.js');
    await loadScript('/js/scout/match.js');
  } catch (err) {
    console.error('Scout scripts failed to load:', err);
    container.querySelector('#matchLoadError').textContent = 'Kon scout module niet laden.';
    container.querySelector('#matchLoadError').classList.remove('hidden');
  }

  // Koppel event listeners aan knoppen (na elke render). Event delegation in match.js
  // handelt .btn-event af; initBindings koppelt overige elementen (undo, score, rotatie, actiebalk).
  requestAnimationFrame(() => {
    if (typeof window.scoutMatchInitBindings === 'function') {
      window.scoutMatchInitBindings();
    }
  });
}
