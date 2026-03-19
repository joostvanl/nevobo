/**
 * scout-setup.js — Scout setup wizard page
 * Stap 1: Teams, Stap 2: Spelers & opstelling, Stap 3: Systeem → Start wedstrijd
 * Pre-populeert teamA en spelers vanuit de wedstrijd context (nevoboMatchId, teamId).
 */
import { state, api, navigate } from '../app.js';

export async function render(container, params = {}) {
  const {
    nevoboMatchId = null, // Nevobo match identifier (encoded matchId)
    homeTeam      = '',
    awayTeam      = '',
    teamId        = null, // DB team id of the coaching team
    resumeMatchId = null, // If set: resume existing scout session
    mode          = null, // 'setLineup' = kies opstelling voor volgende set
    set           = null, // set number (1-based) bij setLineup mode
  } = params;

  // Redirect if not logged in
  if (!state.user) {
    container.innerHTML = `<div class="container mt-4"><div class="card"><div class="card-body text-center">
      <p>Je moet ingelogd zijn om te scouten.</p>
      <button class="btn btn-primary" onclick="navigate('login')">Inloggen</button>
    </div></div></div>`;
    return;
  }

  if (state.features?.scout === false) {
    container.innerHTML = `<div class="container mt-4"><div class="card"><div class="card-body text-center">
      <p>Scouting is uitgeschakeld voor dit platform.</p>
      <button class="btn btn-primary mt-2" onclick="navigate('matches')">Naar wedstrijden</button>
    </div></div></div>`;
    return;
  }

  // Expose JWT token so scout/match.js can use it for API calls
  window._scoutToken = state.token || '';

  // ── setLineup mode: simplified lineup picker between sets ──────────────
  if (mode === 'setLineup') {
    renderSetLineup(container, { set: parseInt(set) || 2 });
    return;
  }

  // If resuming: go straight to match screen
  if (resumeMatchId) {
    navigate('scout-match', { scoutMatchId: resumeMatchId });
    return;
  }

  // Fetch team members from DB if we have a teamId
  let prefillPlayers = [];
  if (teamId) {
    try {
      const data = await api(`/api/admin/teams/${teamId}/members`);
      prefillPlayers = (data.members || [])
        .filter(m => m.membership_type === 'player')
        .map(m => ({ name: m.name, number: m.shirt_number || 0 }))
        .filter(p => p.name);
    } catch (_) {}
  }

  // Generate a scout match ID tied to the nevobo match (or random)
  const scoutMatchId = nevoboMatchId
    ? 'nm_' + nevoboMatchId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80)
    : ('s_' + crypto.randomUUID().replace(/-/g, ''));

  // Check if session already exists
  let existingSession = null;
  try {
    existingSession = await api(`/api/scout/status/${scoutMatchId}`);
  } catch (_) {}

  if (existingSession?.exists && !existingSession?.completed) {
    // Active session: ask to resume or restart
    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;margin-bottom:0.75rem"
            onclick="history.back()">← Terug</button>
          <h1 style="font-size:1.1rem">🏐 Scout sessie</h1>
        </div>
      </div>
      <div class="container">
        <div class="card mb-3">
          <div class="card-body text-center" style="padding:2rem">
            <div style="font-size:2.5rem;margin-bottom:0.75rem">📋</div>
            <h3 style="margin:0 0 0.5rem">Actieve sessie gevonden</h3>
            <p class="text-muted" style="margin:0 0 1.5rem">Er is al een lopende scout sessie voor deze wedstrijd.</p>
            <div class="flex gap-2 flex-col">
              <button class="btn btn-primary" id="btn-resume">▶ Sessie hervatten</button>
              <button class="btn btn-ghost" id="btn-new-session">Nieuwe sessie starten</button>
            </div>
          </div>
        </div>
      </div>`;
    container.querySelector('#btn-resume').addEventListener('click', () => {
      navigate('scout-match', { scoutMatchId });
    });
    container.querySelector('#btn-new-session').addEventListener('click', () => {
      renderSetupWizard(container, { homeTeam, awayTeam, prefillPlayers, scoutMatchId, nevoboMatchId });
    });
    return;
  }

  renderSetupWizard(container, { homeTeam, awayTeam, prefillPlayers, scoutMatchId, nevoboMatchId });
}

function renderSetupWizard(container, { homeTeam, awayTeam, prefillPlayers, scoutMatchId, nevoboMatchId }) {
  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // Build player list HTML
  function renderPlayerList(players) {
    if (!players.length) return `<p class="text-muted text-small text-center">Nog geen spelers toegevoegd.</p>`;
    return players.map((p, i) => `
      <div class="scout-player-row" data-idx="${i}">
        <span class="scout-player-number">${p.number || '—'}</span>
        <span class="scout-player-name">${esc(p.name)}</span>
        <button class="scout-player-remove" data-remove="${i}" aria-label="Verwijder">✕</button>
      </div>`).join('');
  }

  const ROLE_BY_POS = { 1: 'SV', 2: 'PL', 3: 'MID', 4: 'DIA', 5: 'PL', 6: 'MID' };

  function renderFieldCell(pos, p, selectedPos) {
    const role = ROLE_BY_POS[pos] || '';
    const badge = p
      ? `${role}${p.number ? ' #' + p.number : ''}`
      : `${pos} ${role}`;
    const sel = selectedPos === pos ? ' selected' : '';
    return `
      <div class="setup-cell court-cell${sel}" data-pos="${pos}">
        <span class="tile-badge">${badge}</span>
        <span class="tile-name${p ? '' : ' empty'}">${p ? esc(p.name) : '—'}</span>
      </div>`;
  }

  function renderField(positions, players, selectedPos) {
    return `
      <div class="setup-court">
        <div class="court-net" aria-hidden="true"></div>
        <div class="court-row court-front">
          ${renderFieldCell(4, positions[4], selectedPos)}
          ${renderFieldCell(3, positions[3], selectedPos)}
          ${renderFieldCell(2, positions[2], selectedPos)}
        </div>
        <div class="court-row court-back">
          ${renderFieldCell(5, positions[5], selectedPos)}
          ${renderFieldCell(6, positions[6], selectedPos)}
          ${renderFieldCell(1, positions[1], selectedPos)}
        </div>
      </div>
      <p class="setup-section-label">Wisselspelers</p>
      <div class="setup-subs-row">
        ${[7,8,9,10,11,12].map(pos => {
          const p = positions[pos];
          const sel = selectedPos === pos ? ' selected' : '';
          return `
            <div class="setup-cell setup-sub${sel}" data-pos="${pos}">
              <span class="tile-badge">${p?.number ? '#' + p.number : '–'}</span>
              <span class="tile-name${p ? '' : ' empty'}">${p ? esc(p.name) : ''}</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  container.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;margin-bottom:0.75rem"
          onclick="history.back()">← Terug</button>
        <h1 style="font-size:1.1rem">🏐 Scout setup</h1>
      </div>
    </div>

    <div class="container scout-page">
      <!-- Step indicators -->
      <div class="scout-step-indicator">
        <div class="scout-step-dot active" id="dot-0"></div>
        <div class="scout-step-dot" id="dot-1"></div>
        <div class="scout-step-dot" id="dot-2"></div>
      </div>

      <!-- Step 1: Teams -->
      <div class="scout-step active" id="step-0">
        <div class="card mb-3">
          <div class="card-header"><h3>👕 Teams</h3></div>
          <div class="card-body">
            <label class="form-label">Thuisteam <span style="color:var(--danger)">*</span></label>
            <input type="text" class="form-input mb-3" id="input-teamA" value="${esc(homeTeam)}" placeholder="Jouw team" />
            <label class="form-label">Uitteam <span style="color:var(--danger)">*</span></label>
            <input type="text" class="form-input" id="input-teamB" value="${esc(awayTeam)}" placeholder="Tegenstander" />
          </div>
        </div>
        <button class="btn btn-primary w-full" id="btn-step0-next">Volgende →</button>
      </div>

      <!-- Step 2: Spelers & opstelling -->
      <div class="scout-step" id="step-1">
        <div class="card mb-3">
          <div class="card-header">
            <h3>👤 Spelers thuisteam</h3>
          </div>
          <div class="card-body">
            <div id="player-list">${renderPlayerList(prefillPlayers)}</div>
            <div class="flex gap-2 mt-3">
              <input type="number" class="form-input" id="new-player-number" placeholder="Nr" style="width:72px;flex-shrink:0" min="1" max="99" />
              <input type="text" class="form-input" id="new-player-name" placeholder="Naam speler" style="flex:1" />
              <button class="btn btn-primary" id="btn-add-player" style="flex-shrink:0">+</button>
            </div>
          </div>
        </div>

        <div class="card mb-3">
          <div class="card-header"><h3>🏐 Opstelling set 1</h3></div>
          <div class="card-body">
            <p class="text-muted text-small mb-2">Tik op een positie, kies dan een speler.</p>
            <div id="field-grid"></div>
            <p class="text-muted text-small mt-2" id="field-hint">Selecteer een positie om een speler toe te wijzen.</p>

            <!-- Speler-kiezer (hidden tot positie geselecteerd) -->
            <div id="player-picker" class="hidden mt-3">
              <label class="form-label" id="picker-label">Kies speler voor positie:</label>
              <div id="picker-options" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.4rem"></div>
              <button class="btn btn-ghost mt-2 text-small" id="btn-clear-pos">Positie leegmaken</button>
            </div>
          </div>
        </div>

        <div class="flex gap-2">
          <button class="btn btn-ghost" id="btn-step1-back" style="flex:1">← Terug</button>
          <button class="btn btn-primary" id="btn-step1-next" style="flex:2">Systeem →</button>
        </div>
      </div>

      <!-- Step 3: Systeem & start -->
      <div class="scout-step" id="step-2">
        <div class="card mb-3">
          <div class="card-header"><h3>⚙️ Spelsysteem</h3></div>
          <div class="card-body">
            <label class="form-label">Systeem thuisteam</label>
            <select class="form-input mb-3" id="input-system">
              <option value="geen">Geen systeem</option>
              <option value="5-1">5-1 (één spelverdeler)</option>
              <option value="4-2">4-2 (twee spelverdelers)</option>
            </select>
            <div id="setter-fields" class="hidden">
              <label class="form-label" id="setter-label">Spelverdeler (startpositie 1-6)</label>
              <select class="form-input" id="input-setter">
                <option value="1">Positie 1</option>
                <option value="2">Positie 2</option>
                <option value="3">Positie 3</option>
                <option value="4">Positie 4</option>
                <option value="5">Positie 5</option>
                <option value="6">Positie 6</option>
              </select>
            </div>
          </div>
        </div>

        <div class="card mb-3" style="background:var(--primary-light,rgba(37,99,235,0.08));border:1px solid var(--primary)">
          <div class="card-body">
            <div id="summary-teams" class="text-small mb-2"></div>
            <div id="summary-players" class="text-small text-muted"></div>
          </div>
        </div>

        <div class="flex gap-2">
          <button class="btn btn-ghost" id="btn-step2-back" style="flex:1">← Terug</button>
          <button class="btn btn-primary btn-scout" id="btn-start" style="flex:2">
            <span>🏐</span> Wedstrijd starten
          </button>
        </div>
      </div>
    </div>`;

  // ── State ────────────────────────────────────────────────────────────────
  let players    = [...prefillPlayers];
  let positions  = {}; // pos 1-12 → { name, number } | null
  for (let i = 1; i <= 12; i++) positions[i] = null;
  // Pre-fill first 6 positions from prefill players
  prefillPlayers.slice(0, 6).forEach((p, i) => { positions[i + 1] = p; });

  let currentStep     = 0;
  let selectedPos     = null;

  const steps  = [0, 1, 2].map(i => container.querySelector(`#step-${i}`));
  const dots   = [0, 1, 2].map(i => container.querySelector(`#dot-${i}`));

  function showStep(n) {
    steps.forEach((s, i) => s.classList.toggle('active', i === n));
    dots.forEach((d, i) => {
      d.classList.toggle('active', i === n);
      d.classList.toggle('done', i < n);
    });
    currentStep = n;
    if (n === 2) updateSummary();
  }

  function updatePlayerList() {
    container.querySelector('#player-list').innerHTML = renderPlayerList(players);
    container.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.remove);
        const removed = players[idx];
        players.splice(idx, 1);
        // Clear from positions if assigned
        for (let p = 1; p <= 12; p++) {
          if (positions[p]?.name === removed.name) positions[p] = null;
        }
        updatePlayerList();
        updateField();
      });
    });
  }

  function updateField() {
    container.querySelector('#field-grid').innerHTML = renderField(positions, players, selectedPos);
    container.querySelectorAll('#field-grid .setup-cell').forEach(cell => {
      const pos = parseInt(cell.dataset.pos);
      cell.addEventListener('click', () => selectPosition(pos));
    });
  }

  function selectPosition(pos) {
    selectedPos = pos;
    updateField();
    const picker = container.querySelector('#player-picker');
    const label  = container.querySelector('#picker-label');
    const opts   = container.querySelector('#picker-options');
    label.textContent = `Kies speler voor positie ${pos}:`;
    picker.classList.remove('hidden');

    // Show all players as chips
    opts.innerHTML = players.map(p => `
      <button class="chip ${positions[pos]?.name === p.name ? 'chip-primary' : ''}"
        style="cursor:pointer;padding:0.35rem 0.75rem;font-size:0.85rem"
        data-pname="${esc(p.name)}">
        ${p.number ? `<strong>#${p.number}</strong> ` : ''}${esc(p.name)}
      </button>`).join('');

    opts.querySelectorAll('[data-pname]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.pname;
        const player = players.find(p => p.name === name);
        if (!player) return;
        // Remove player from any other position
        for (let p = 1; p <= 12; p++) {
          if (p !== pos && positions[p]?.name === name) positions[p] = null;
        }
        positions[pos] = player;
        selectedPos = null;
        picker.classList.add('hidden');
        updateField();
      });
    });
  }

  container.querySelector('#btn-clear-pos').addEventListener('click', () => {
    if (selectedPos) { positions[selectedPos] = null; selectedPos = null; }
    container.querySelector('#player-picker').classList.add('hidden');
    updateField();
  });

  function updateSummary() {
    const teamA = container.querySelector('#input-teamA').value.trim();
    const teamB = container.querySelector('#input-teamB').value.trim();
    const fieldPlayers = [1,2,3,4,5,6].map(p => positions[p]?.name).filter(Boolean);
    container.querySelector('#summary-teams').innerHTML =
      `<strong>${esc(teamA)}</strong> vs <strong>${esc(teamB)}</strong>`;
    container.querySelector('#summary-players').innerHTML =
      `${players.length} spelers geladen · ${fieldPlayers.length}/6 posities ingevuld`;
  }

  // System toggle
  const systemSelect = container.querySelector('#input-system');
  const setterFields = container.querySelector('#setter-fields');
  const setterLabel  = container.querySelector('#setter-label');
  systemSelect.addEventListener('change', () => {
    const v = systemSelect.value;
    setterFields.classList.toggle('hidden', v === 'geen');
    if (v === '4-2') setterLabel.textContent = 'Eerste spelverdeler (startpositie)';
    else             setterLabel.textContent  = 'Spelverdeler (startpositie 1-6)';
  });

  // ── Navigation ──────────────────────────────────────────────────────────
  container.querySelector('#btn-step0-next').addEventListener('click', () => {
    const teamA = container.querySelector('#input-teamA').value.trim();
    const teamB = container.querySelector('#input-teamB').value.trim();
    if (!teamA || !teamB) { alert('Vul beide teamnamen in.'); return; }
    if (teamA === teamB) { alert('Thuis- en uitteam kunnen niet hetzelfde zijn.'); return; }
    updatePlayerList();
    updateField();
    showStep(1);
  });

  container.querySelector('#btn-step1-back').addEventListener('click', () => showStep(0));
  container.querySelector('#btn-step1-next').addEventListener('click', () => {
    const filled = [1,2,3,4,5,6].filter(p => positions[p]).length;
    if (filled < 6) { alert('Zet minimaal 6 spelers in het veld (posities 1-6).'); return; }
    showStep(2);
  });

  container.querySelector('#btn-step2-back').addEventListener('click', () => showStep(1));

  // Add player
  container.querySelector('#btn-add-player').addEventListener('click', () => {
    const nameInput   = container.querySelector('#new-player-name');
    const numberInput = container.querySelector('#new-player-number');
    const name   = nameInput.value.trim();
    const number = parseInt(numberInput.value) || 0;
    if (!name) { nameInput.focus(); return; }
    if (players.some(p => p.name === name)) { alert('Speler bestaat al.'); return; }
    players.push({ name, number });
    nameInput.value   = '';
    numberInput.value = '';
    nameInput.focus();
    updatePlayerList();
  });
  container.querySelector('#new-player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') container.querySelector('#btn-add-player').click();
  });

  // ── Start match ──────────────────────────────────────────────────────────
  container.querySelector('#btn-start').addEventListener('click', async () => {
    const teamA  = container.querySelector('#input-teamA').value.trim();
    const teamB  = container.querySelector('#input-teamB').value.trim();
    const system = systemSelect.value;
    const setter = parseInt(container.querySelector('#input-setter').value) || 1;

    // match.js expects positionsSet1 as { Position1: 'name', Position2: 'name', ... }
    const positionsSet1 = {};
    for (let i = 1; i <= 6; i++) positionsSet1['Position' + i] = (positions[i] && positions[i].name) || '';

    const setup = {
      matchId:        scoutMatchId,
      nevoboMatchId:  nevoboMatchId || null,
      teamA,
      teamB,
      teamAPlayers:   players,
      positionsSet1,
      setterConfig:   system === 'geen'
        ? { type: 'geen' }
        : system === '4-2'
          ? { type: '4-2', setterPositions: [setter, ((setter + 2) % 6) + 1] }
          : { type: '5-1', setterPosition: setter },
      liberoConfig:   { use: false, substituteFor: 'mid' },
    };

    try {
      sessionStorage.setItem('scoutSetup', JSON.stringify(setup));
      localStorage.setItem('scoutCurrentMatchId', scoutMatchId);
    } catch (_) {}

    navigate('scout-match', { scoutMatchId });
  });

  // Initial render
  updatePlayerList();
  updateField();
}

// ── Set-lineup mode: choose lineup for next set without full setup wizard ──
function renderSetLineup(container, { set }) {
  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  let matchState;
  try { matchState = JSON.parse(sessionStorage.getItem('scoutMatchState')); } catch (_) {}
  if (!matchState || !matchState.teamA) {
    container.innerHTML = `<div class="container mt-4"><div class="card"><div class="card-body text-center">
      <p class="text-muted">Geen actieve wedstrijd gevonden.</p>
      <button class="btn btn-primary" onclick="navigate('matches')">Terug naar wedstrijden</button>
    </div></div></div>`;
    return;
  }

  const teamAPlayers = matchState.teamAPlayers || [];
  const setIdx = set - 1;
  const prevSetIdx = setIdx - 1;
  const prevSet = matchState.sets && matchState.sets[prevSetIdx] ? matchState.sets[prevSetIdx] : null;

  let positions = {};
  for (let i = 1; i <= 12; i++) positions[i] = null;

  // Pre-fill from previous set's positions
  for (let i = 1; i <= 6; i++) {
    const name = prevSet ? (prevSet['Position' + i] || '') : (matchState.positions ? (matchState.positions['Position' + i] || '') : '');
    if (name) {
      const player = teamAPlayers.find(p => p.name === name);
      positions[i] = player || { name, number: 0 };
    }
  }
  // Fill subs (7-12) with remaining players
  const inField = new Set();
  for (let i = 1; i <= 6; i++) if (positions[i]) inField.add(positions[i].name);
  let subSlot = 7;
  for (const p of teamAPlayers) {
    if (!inField.has(p.name) && subSlot <= 12) {
      positions[subSlot] = p;
      subSlot++;
    }
  }

  let selectedPos = null;
  const ROLE_BY_POS = { 1: 'SV', 2: 'PL', 3: 'MID', 4: 'DIA', 5: 'PL', 6: 'MID' };

  function renderFieldCell(pos, p) {
    const role = ROLE_BY_POS[pos] || '';
    const badge = p ? `${role}${p.number ? ' #' + p.number : ''}` : `${pos} ${role}`;
    const sel = selectedPos === pos ? ' selected' : '';
    return `<div class="setup-cell court-cell${sel}" data-pos="${pos}">
      <span class="tile-badge">${badge}</span>
      <span class="tile-name${p ? '' : ' empty'}">${p ? esc(p.name) : '—'}</span>
    </div>`;
  }

  function renderField() {
    return `
      <div class="setup-court">
        <div class="court-net" aria-hidden="true"></div>
        <div class="court-row court-front">
          ${renderFieldCell(4, positions[4])}
          ${renderFieldCell(3, positions[3])}
          ${renderFieldCell(2, positions[2])}
        </div>
        <div class="court-row court-back">
          ${renderFieldCell(5, positions[5])}
          ${renderFieldCell(6, positions[6])}
          ${renderFieldCell(1, positions[1])}
        </div>
      </div>
      <p class="setup-section-label">Wisselspelers</p>
      <div class="setup-subs-row">
        ${[7,8,9,10,11,12].map(pos => {
          const p = positions[pos];
          const sel = selectedPos === pos ? ' selected' : '';
          return `<div class="setup-cell setup-sub${sel}" data-pos="${pos}">
            <span class="tile-badge">${p?.number ? '#' + p.number : '–'}</span>
            <span class="tile-name${p ? '' : ' empty'}">${p ? esc(p.name) : ''}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  container.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <h1 style="font-size:1.1rem">🏐 Opstelling set ${set}</h1>
        <p style="font-size:0.85rem;opacity:0.85;margin:0.25rem 0 0">
          ${esc(matchState.teamA)} vs ${esc(matchState.teamB)}
          &nbsp;·&nbsp; Sets: ${matchState.homeSets || 0} – ${matchState.awaySets || 0}
        </p>
      </div>
    </div>
    <div class="container scout-page">
      <div class="card mb-3">
        <div class="card-header"><h3>🏐 Opstelling set ${set}</h3></div>
        <div class="card-body">
          <p class="text-muted text-small mb-2">Tik op een positie om een andere speler in te zetten. De vorige opstelling is overgenomen.</p>
          <div id="field-grid">${renderField()}</div>
          <p class="text-muted text-small mt-2" id="field-hint">Selecteer een positie om te wijzigen.</p>
          <div id="player-picker" class="hidden mt-3">
            <label class="form-label" id="picker-label">Kies speler voor positie:</label>
            <div id="picker-options" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.4rem"></div>
            <button class="btn btn-ghost mt-2 text-small" id="btn-clear-pos">Positie leegmaken</button>
          </div>
        </div>
      </div>
      <button class="btn btn-primary btn-scout w-full" id="btn-start-set" style="font-size:1.05rem;padding:0.85rem">
        <span>🏐</span> Start set ${set}
      </button>
    </div>`;

  function updateField() {
    container.querySelector('#field-grid').innerHTML = renderField();
    container.querySelectorAll('#field-grid .setup-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const pos = parseInt(cell.dataset.pos);
        selectedPos = pos;
        updateField();
        showPicker(pos);
      });
    });
  }

  function showPicker(pos) {
    const picker = container.querySelector('#player-picker');
    const label  = container.querySelector('#picker-label');
    const opts   = container.querySelector('#picker-options');
    label.textContent = `Kies speler voor positie ${pos}:`;
    picker.classList.remove('hidden');

    opts.innerHTML = teamAPlayers.map(p => `
      <button class="chip ${positions[pos]?.name === p.name ? 'chip-primary' : ''}"
        style="cursor:pointer;padding:0.35rem 0.75rem;font-size:0.85rem"
        data-pname="${esc(p.name)}">
        ${p.number ? `<strong>#${p.number}</strong> ` : ''}${esc(p.name)}
      </button>`).join('');

    opts.querySelectorAll('[data-pname]').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.pname;
        const player = teamAPlayers.find(p => p.name === name);
        if (!player) return;
        for (let p = 1; p <= 12; p++) {
          if (p !== pos && positions[p]?.name === name) positions[p] = null;
        }
        positions[pos] = player;
        selectedPos = null;
        picker.classList.add('hidden');
        updateField();
      });
    });
  }

  container.querySelector('#btn-clear-pos')?.addEventListener('click', () => {
    if (selectedPos) { positions[selectedPos] = null; selectedPos = null; }
    container.querySelector('#player-picker').classList.add('hidden');
    updateField();
  });

  container.querySelector('#btn-start-set').addEventListener('click', () => {
    const filled = [1,2,3,4,5,6].filter(p => positions[p]).length;
    if (filled < 6) { alert('Zet minimaal 6 spelers in het veld (posities 1-6).'); return; }

    // Write positions into matchState for the new set
    const posObj = {};
    for (let i = 1; i <= 6; i++) posObj['Position' + i] = positions[i]?.name || '';

    if (!matchState.sets[setIdx]) {
      matchState.sets[setIdx] = { rallies: [] };
    }
    for (let i = 1; i <= 6; i++) matchState.sets[setIdx]['Position' + i] = posObj['Position' + i];
    matchState.positions = posObj;
    matchState.pendingSubstitutions = [];
    matchState._fromSetLineup = true;

    try {
      sessionStorage.setItem('scoutMatchState', JSON.stringify(matchState));
    } catch (_) {}

    const scoutMatchId = matchState.matchId || '';
    navigate('scout-match', { scoutMatchId });
  });

  updateField();
}
