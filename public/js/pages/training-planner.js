import { api, state, showToast } from '../app.js';
import { escHtml } from '../escape-html.js';

const DAY_NAMES = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];
const HOUR_START = 8;
const HOUR_END = 23;
const TOTAL_MINUTES = (HOUR_END - HOUR_START) * 60;
const SNAP = 15;
const DEFAULT_DURATION = 90;
const MATCH_DURATION = 120;

const _MO_KEY = 'tp_match_overrides';
let _matchOverrides = {};
try { _matchOverrides = JSON.parse(localStorage.getItem(_MO_KEY) || '{}'); } catch (_) {}
function _saveMatchOverrides() { localStorage.setItem(_MO_KEY, JSON.stringify(_matchOverrides)); }

const TEAM_COLORS = [
  '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
  '#1abc9c','#e67e22','#2c3e50','#e84393','#00b894',
  '#6c5ce7','#fd79a8',
];

let _ctx = null;
let _activeSnapshotName = null;
let _teamOverviewOpen = false;
let _editMode = false;
const _undoStack = [];
const _redoStack = [];
const MAX_UNDO = 50;
const _dayZoom = {};
const _dayScroll = {};
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.2;
/** Matcht .tp-venue-label width (CSS) — gebruikt in zoom/scroll-math */
const TP_VENUE_LABEL_W = 120;

/** Zelfde breakpoint als zoom-knoppen in training-planner.css — planning nooit bewerkbaar op mobiel */
function isPlannerMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}

let _plannerResizeBound = false;
function bindPlannerViewportResizeOnce() {
  if (_plannerResizeBound || typeof window === 'undefined') return;
  _plannerResizeBound = true;
  let t;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (_ctx?.container?.querySelector('.tp-wrapper')) renderPlanner();
    }, 150);
  });
}

/**
 * Zet zoom voor één dag; anchorClientX = viewport-X om onder muis te blijven; null = midden van de scrollstrip.
 */
function applyDayZoom(dayEl, dow, newZoom, anchorClientX) {
  const scrollEl = dayEl.querySelector('.tp-day-scroll');
  const contentEl = dayEl.querySelector('.tp-day-content');
  if (!scrollEl || !contentEl) return;

  newZoom = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom)) * 100) / 100;
  const oldZoom = _dayZoom[dow] || 1;
  if (newZoom === oldZoom) return;

  if (newZoom <= ZOOM_MIN) delete _dayZoom[dow];
  else _dayZoom[dow] = newZoom;

  const effectiveZoom = _dayZoom[dow] || 1;

  const scrollRect = scrollEl.getBoundingClientRect();
  const labelW = TP_VENUE_LABEL_W;
  const mouseX = anchorClientX != null
    ? anchorClientX - scrollRect.left
    : scrollRect.width / 2;

  const oldContentWidth = scrollEl.scrollWidth;
  const denom = Math.max(1, oldContentWidth - labelW);
  const posFrac = (scrollEl.scrollLeft + mouseX - labelW) / denom;

  contentEl.style.minWidth = `${effectiveZoom * 100}%`;

  syncDayZoomHeader(dayEl, dow, effectiveZoom);

  requestAnimationFrame(() => {
    const newContentWidth = scrollEl.scrollWidth;
    const newScrollLeft = posFrac * Math.max(1, newContentWidth - labelW) - (mouseX - labelW);
    scrollEl.scrollLeft = Math.max(0, newScrollLeft);
    _dayScroll[dow] = scrollEl.scrollLeft;
  });
}

function syncDayZoomHeader(dayEl, dow, zoom) {
  const header = dayEl.querySelector('.tp-day-header');
  if (!header) return;

  const zIn = header.querySelector('.tp-zoom-in');
  const zOut = header.querySelector('.tp-zoom-out');
  if (zIn) zIn.disabled = zoom >= ZOOM_MAX - 1e-9;
  if (zOut) zOut.disabled = zoom <= ZOOM_MIN + 1e-9;

  const touch = header.querySelector('.tp-zoom-touch');
  if (touch) {
    let mobReset = touch.querySelector('.tp-zoom-reset-btn');
    if (zoom > 1) {
      if (!mobReset) {
        mobReset = document.createElement('button');
        mobReset.type = 'button';
        mobReset.className = 'tp-zoom-btn tp-zoom-reset-btn';
        mobReset.dataset.dow = String(dow);
        mobReset.setAttribute('aria-label', 'Zoom resetten');
        mobReset.textContent = '↺';
        touch.appendChild(mobReset);
      }
    } else if (mobReset) {
      mobReset.remove();
    }
  }

  let deskReset = header.querySelector('.tp-zoom-reset-desktop');
  if (zoom > 1) {
    if (!deskReset) {
      deskReset = document.createElement('button');
      deskReset.type = 'button';
      deskReset.className = 'tp-zoom-reset-desktop tp-zoom-reset-btn';
      deskReset.dataset.dow = String(dow);
      deskReset.setAttribute('aria-label', 'Zoom resetten');
      deskReset.textContent = '🔍 Reset zoom';
      header.appendChild(deskReset);
    }
  } else if (deskReset) {
    deskReset.remove();
  }
}

function pushUndo(trainings) {
  _undoStack.push(JSON.stringify(trainings));
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack.length = 0;
}

function snapshotBeforeMutation() {
  if (_ctx?.weekData?.trainings && _ctx.mode === 'blueprint') {
    pushUndo(_ctx.weekData.trainings);
  }
}

async function performUndo() {
  if (!_undoStack.length) return;
  _redoStack.push(JSON.stringify(_ctx.weekData.trainings));
  const prev = JSON.parse(_undoStack.pop());
  try {
    await api('/api/training/defaults/restore', { method: 'POST', body: { trainings: prev } });
    showToast('Ongedaan gemaakt', 'success');
  } catch (err) { showToast(err.message, 'error'); }
  loadAndRender();
}

async function performRedo() {
  if (!_redoStack.length) return;
  _undoStack.push(JSON.stringify(_ctx.weekData.trainings));
  const next = JSON.parse(_redoStack.pop());
  try {
    await api('/api/training/defaults/restore', { method: 'POST', body: { trainings: next } });
    showToast('Opnieuw toegepast', 'success');
  } catch (err) { showToast(err.message, 'error'); }
  loadAndRender();
}

function pxToMinutes(px, trackWidth) {
  return Math.round((px / trackWidth) * TOTAL_MINUTES / SNAP) * SNAP;
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

function getIsoWeek(d) {
  const dt = new Date(d);
  const dayNum = dt.getDay() || 7;
  const thu = new Date(dt);
  thu.setDate(dt.getDate() + 4 - dayNum);
  const yearStart = new Date(thu.getFullYear(), 0, 1);
  const weekNo = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
  return `${thu.getFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

function isoWeekToMonday(isoWeek) {
  const [y, w] = isoWeek.split('-W').map(Number);
  const jan4 = new Date(y, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - dayOfWeek + 1 + (w - 1) * 7);
  return mon;
}

function formatWeekLabel(isoWeek) {
  const mon = isoWeekToMonday(isoWeek);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => `${d.getDate()} ${['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'][d.getMonth()]}`;
  const wn = isoWeek.split('-W')[1];
  return `Week ${parseInt(wn)} (${fmt(mon)} – ${fmt(sun)} ${sun.getFullYear()})`;
}

function shiftWeek(isoWeek, delta) {
  const mon = isoWeekToMonday(isoWeek);
  mon.setDate(mon.getDate() + delta * 7);
  return getIsoWeek(mon);
}

function teamColorClass(teamId) {
  if (!_ctx) return 'tp-team-0';
  const idx = _ctx.teamIds.indexOf(teamId);
  return `tp-team-${(idx >= 0 ? idx : teamId) % TEAM_COLORS.length}`;
}

// ─── Render ─────────────────────────────────────────────────────────────────

let _keyHandler = null;

export async function render(container) {
  document.getElementById('app')?.classList.add('tp-fullwidth');
  container.innerHTML = '<div class="spinner"></div>';
  const user = state.user;
  if (!user?.club_id) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Geen club gekoppeld.</p></div>';
    return;
  }

  if (_keyHandler) document.removeEventListener('keydown', _keyHandler);
  _keyHandler = (e) => {
    if (!_editMode || _ctx?.mode !== 'blueprint' || isPlannerMobileViewport()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); performUndo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); performRedo(); }
  };
  document.addEventListener('keydown', _keyHandler);

  try {
    const [locData, venueData, teamData, clubData] = await Promise.all([
      api('/api/training/locations'),
      api('/api/training/venues'),
      api('/api/training/teams'),
      api(`/api/clubs/${user.club_id}`),
    ]);

    _editMode = false;
    _undoStack.length = 0;
    _redoStack.length = 0;
    _ctx = {
      clubId: user.club_id,
      clubName: clubData.club?.name || '',
      nevoboCode: clubData.club?.nevobo_code || '',
      locations: locData.locations || [],
      venues: venueData.venues || [],
      teams: teamData.teams || [],
      teamIds: (teamData.teams || []).map(t => t.id),
      mode: 'blueprint',
      isoWeek: getIsoWeek(new Date()),
      weekData: null,
      homeMatches: [],
      container,
    };

    bindPlannerViewportResizeOnce();
    await loadAndRender();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escHtml(err.message)}</p></div>`;
  }
}

async function loadAndRender() {
  const c = _ctx;

  const [locData, venueData, snapActive] = await Promise.all([
    api('/api/training/locations'),
    api('/api/training/venues'),
    api('/api/training/snapshots/active'),
  ]);
  c.locations = locData.locations || [];
  c.venues = venueData.venues || [];
  _activeSnapshotName = snapActive.active?.name || null;

  let trainings, isException = false, exceptionLabel = null;
  if (c.mode === 'blueprint') {
    const data = await api('/api/training/defaults');
    trainings = data.defaults || [];
  } else {
    const data = await api(`/api/training/week/${c.isoWeek}`);
    trainings = data.trainings || [];
    isException = data.is_exception;
    exceptionLabel = data.exception_label;
  }

  c.weekData = { trainings, isException, exceptionLabel };

  if (c.mode === 'week') {
    try {
      const data = await api(`/api/training/nevobo-match-fields/${c.isoWeek}`);
      c.homeMatches = mapMatchesToVenues(data.matches || [], c);
    } catch (_) { c.homeMatches = []; }
  } else {
    c.homeMatches = [];
  }

  renderPlanner();
}

function mapMatchesToVenues(matches, ctx) {
  // Build slug → venue_id map from our venues that have nevobo_field_slug
  const slugToVenue = new Map();
  const locNameToVenues = new Map();
  for (const v of ctx.venues) {
    if (v.nevobo_field_slug) slugToVenue.set(v.nevobo_field_slug, v.id);
  }
  for (const loc of ctx.locations) {
    if (loc.nevobo_venue_name) {
      const vids = ctx.venues.filter(v => v.location_id === loc.id).map(v => v.id);
      locNameToVenues.set(loc.nevobo_venue_name.toLowerCase(), vids);
    }
  }

  return matches.filter(m => m.datetime).map(m => {
    const dt = new Date(m.datetime);
    const dow = (dt.getDay() + 6) % 7;
    const startMin = dt.getHours() * 60 + dt.getMinutes();

    // Try exact field_slug match first, then fall back to location name match
    let venueId = null;
    if (m.field_slug && slugToVenue.has(m.field_slug)) {
      venueId = slugToVenue.get(m.field_slug);
    } else if (m.venue_name) {
      const vn = m.venue_name.toLowerCase();
      for (const [key, vids] of locNameToVenues) {
        if (vn.includes(key) || key.includes(vn)) {
          venueId = vids[0] || null;
          break;
        }
      }
    }

    const key = `${m.datetime}|${m.home_team}`;
    const saved = _matchOverrides[key];
    return {
      key,
      label: `${escHtml(m.home_team || '')} vs ${escHtml(m.away_team || '')}`,
      day_of_week: dow,
      start_minutes: startMin,
      end_minutes: saved ? startMin + saved : startMin + MATCH_DURATION,
      venue_id: venueId,
    };
  });
}

// ─── Full planner render ────────────────────────────────────────────────────

function renderPlanner() {
  const c = _ctx;
  // Preserve scroll positions before DOM rebuild
  if (c.container) {
    c.container.querySelectorAll('.tp-day').forEach(dayEl => {
      const dow = dayEl.dataset.dow;
      const scrollEl = dayEl.querySelector('.tp-day-scroll');
      if (scrollEl && scrollEl.scrollLeft > 0) _dayScroll[dow] = scrollEl.scrollLeft;
    });
  }
  const { trainings, isException } = c.weekData;
  const mobileReadOnly = isPlannerMobileViewport();
  const editable = !mobileReadOnly && ((c.mode === 'blueprint' && _editMode) || isException);

  const isBlueprint = c.mode === 'blueprint';

  // Mode tabs
  const modeTabs = `
    <div class="tp-mode-tabs">
      <button class="tp-mode-tab${isBlueprint ? ' active' : ''}" id="tp-to-blueprint">Blauwdruk</button>
      <button class="tp-mode-tab${!isBlueprint ? ' active' : ''}" id="tp-to-week">Week</button>
    </div>`;

  // Context bar (second row)
  let contextBar = '';
  if (isBlueprint) {
    if (mobileReadOnly) {
      const snapLabel = _activeSnapshotName
        ? `<span class="tp-snap-name">${escHtml(_activeSnapshotName)}</span>`
        : '<span class="tp-snap-name-empty">Geen blauwdruk actief</span>';
      contextBar = `<div class="tp-context-bar tp-context-bar--mobile-readonly">
        <div class="tp-context-left">
          <span class="tp-mobile-readonly-hint" title="Gebruik een tablet of desktop om de planning te wijzigen">Alleen bekijken op mobiel</span>
          <span class="tp-ctx-sep"></span>
          ${snapLabel}
        </div>
      </div>`;
    } else {
      const snapLabel = _activeSnapshotName
        ? `<span class="tp-snap-name" id="tp-rename-snapshot" title="Klik om naam te wijzigen">${escHtml(_activeSnapshotName)}</span>`
        : '<span class="tp-snap-name-empty">Geen blauwdruk actief</span>';
      const lockBtn = _editMode
        ? '<button class="tp-ctx-btn tp-ctx-edit-active" id="tp-toggle-edit" title="Bewerken uitschakelen">✏️ Bewerken</button>'
        : '<button class="tp-ctx-btn" id="tp-toggle-edit" title="Bewerken inschakelen">🔒 Vergrendeld</button>';
      const undoDisabled = _undoStack.length === 0 ? ' disabled' : '';
      const redoDisabled = _redoStack.length === 0 ? ' disabled' : '';
      const editActions = _editMode ? `
        <button class="tp-ctx-btn" id="tp-undo" title="Ongedaan maken"${undoDisabled}>↩ Undo</button>
        <button class="tp-ctx-btn" id="tp-redo" title="Opnieuw"${redoDisabled}>↪ Redo</button>
        <span class="tp-ctx-sep"></span>
        <button class="tp-ctx-btn" id="tp-save-snapshot" title="Opslaan als">💾 Opslaan</button>
        <button class="tp-ctx-btn" id="tp-load-snapshot" title="Blauwdruk laden">📂 Laden</button>
        <span class="tp-ctx-sep"></span>
        <button class="tp-ctx-btn tp-ctx-accent" id="tp-ai-optimize">🤖 AI assistent</button>
        <span class="tp-ctx-sep"></span>
        <button class="tp-ctx-btn tp-ctx-danger" id="tp-clear-defaults">Leegmaken</button>` : `
        <button class="tp-ctx-btn" id="tp-save-snapshot" title="Opslaan als">💾 Opslaan</button>
        <button class="tp-ctx-btn" id="tp-load-snapshot" title="Blauwdruk laden">📂 Laden</button>`;
      contextBar = `<div class="tp-context-bar">
        <div class="tp-context-left">${lockBtn}<span class="tp-ctx-sep"></span>${snapLabel}</div>
        <div class="tp-context-actions">${editActions}
        </div>
      </div>`;
    }
  } else if (mobileReadOnly) {
    const weekBadge = isException
      ? `<span class="tp-badge tp-badge-exception">Afwijkend${c.weekData.exceptionLabel ? ': ' + escHtml(c.weekData.exceptionLabel) : ''}</span>`
      : '<span class="tp-badge tp-badge-readonly">Standaard schema</span>';
    contextBar = `<div class="tp-context-bar tp-context-bar--mobile-readonly">
      <div class="tp-context-left">
        <div class="tp-week-nav">
          <button id="tp-prev-week">◀</button>
          <span>${formatWeekLabel(c.isoWeek)}</span>
          <button id="tp-next-week">▶</button>
        </div>
      </div>
      <div class="tp-context-actions">${weekBadge}</div>
    </div>`;
  } else {
    let weekStatus = '';
    if (isException) {
      weekStatus = `<span class="tp-badge tp-badge-exception">Afwijkend${c.weekData.exceptionLabel ? ': ' + escHtml(c.weekData.exceptionLabel) : ''}</span>
        <button class="tp-ctx-btn tp-ctx-danger" id="tp-del-override">Afwijking verwijderen</button>`;
    } else {
      weekStatus = `<span class="tp-badge tp-badge-readonly">Standaard schema</span>
        <button class="tp-ctx-btn" id="tp-make-override">Afwijkende week maken</button>`;
    }
    contextBar = `<div class="tp-context-bar">
      <div class="tp-context-left">
        <div class="tp-week-nav">
          <button id="tp-prev-week">◀</button>
          <span>${formatWeekLabel(c.isoWeek)}</span>
          <button id="tp-next-week">▶</button>
        </div>
      </div>
      <div class="tp-context-actions">${weekStatus}</div>
    </div>`;
  }

  // Location + venue management panel
  let mgmtBarHtml = '';
  for (const loc of c.locations) {
    const locVenues = c.venues.filter(v => v.location_id === loc.id);
    const nevoboTag = loc.nevobo_venue_name
      ? ` <span class="tp-loc-nevobo">(${escHtml(loc.nevobo_venue_name)})</span>` : '';
    const venueChips = locVenues.map(v =>
      `<span class="tp-venue-chip">${escHtml(v.name)}${editable ? `<button class="tp-del-venue" data-id="${v.id}" title="Verwijder veld">✕</button>` : ''}</span>`
    ).join('');
    mgmtBarHtml += `
      <div class="tp-loc-row">
        <span class="tp-loc-name">${escHtml(loc.name)}${nevoboTag}</span>
        <div class="tp-venue-chips">${venueChips}</div>
        ${editable ? `<div class="tp-loc-actions">
          <button class="btn btn-sm btn-secondary tp-add-court" data-loc-id="${loc.id}" style="font-size:0.7rem;padding:0.12rem 0.4rem">+ Veld</button>
          <button class="tp-del-loc" data-id="${loc.id}" style="border:none;background:none;cursor:pointer;font-size:0.7rem;color:var(--danger);padding:0 2px" title="Locatie verwijderen">✕</button>
        </div>` : ''}
      </div>`;
  }
  if (editable) {
    mgmtBarHtml += `<div class="tp-bar-footer"><button class="btn btn-sm btn-secondary" id="tp-add-location" style="font-size:0.75rem">+ Locatie</button></div>`;
  }

  // Day sections
  let daysHtml = '';
  for (let dow = 0; dow < 7; dow++) {
    let dayLabel;
    if (c.mode === 'week') {
      const mon = isoWeekToMonday(c.isoWeek);
      const dayDate = new Date(mon); dayDate.setDate(mon.getDate() + dow);
      dayLabel = `${DAY_NAMES[dow]} ${dayDate.getDate()} ${['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'][dayDate.getMonth()]}`;
    } else {
      dayLabel = DAY_NAMES[dow];
    }

    const dayTrainings = trainings.filter(t => t.day_of_week === dow);
    const dayMatches = c.homeMatches.filter(m => m.day_of_week === dow);

    if (c.venues.length === 0) {
      daysHtml += `<div class="tp-day"><div class="tp-day-header">${dayLabel}</div><div style="padding:1rem;color:var(--text-muted);font-size:0.85rem">Voeg eerst een locatie en veld toe.</div></div>`;
      continue;
    }

    let venueRows = '';
    for (const loc of c.locations) {
      const locVenues = c.venues.filter(v => v.location_id === loc.id);
      if (locVenues.length === 0) continue;

      for (const venue of locVenues) {
        const vTrainings = dayTrainings.filter(t => t.venue_id === venue.id);
        const vMatches = dayMatches.filter(m => m.venue_id === venue.id);
        const unmatchedOnFirst = (venue === c.venues[0])
          ? dayMatches.filter(m => m.venue_id === null) : [];

        let blocksHtml = '';
        for (const t of vTrainings) {
          const startMin = timeToMinutes(t.start_time) - HOUR_START * 60;
          const dur = timeToMinutes(t.end_time) - timeToMinutes(t.start_time);
          const leftPct = (startMin / TOTAL_MINUTES) * 100;
          const widthPct = (dur / TOTAL_MINUTES) * 100;
          const colorCls = teamColorClass(t.team_id);
          const tName = t.team_name || `Team ${t.team_id}`;
          blocksHtml += `<div class="tp-block ${colorCls}${editable ? '' : ' readonly'}" title="${escHtml(tName)}" data-training-id="${t.id}" data-team-id="${t.team_id}" data-source="${c.mode === 'blueprint' ? 'default' : 'exception'}" style="left:${leftPct}%;width:${widthPct}%">${editable ? '<span class="tp-resize-left"></span>' : ''}<span class="tp-block-label">${escHtml(tName)}</span>${editable ? '<span class="tp-resize-right"></span>' : ''}</div>`;
        }

        for (const m of [...vMatches, ...unmatchedOnFirst]) {
          const startMin = m.start_minutes - HOUR_START * 60;
          const dur = m.end_minutes - m.start_minutes;
          if (startMin < 0 || startMin + dur > TOTAL_MINUTES) continue;
          const leftPct = (startMin / TOTAL_MINUTES) * 100;
          const widthPct = (dur / TOTAL_MINUTES) * 100;
          blocksHtml += `<div class="tp-block match${editable ? '' : ' readonly'}" title="${m.label}" data-match-key="${escHtml(m.key)}" style="left:${leftPct}%;width:${widthPct}%"><span class="tp-block-label">${m.label}</span>${editable ? '<span class="tp-resize-right"></span>' : ''}</div>`;
        }

        const rowLabel = locVenues.length > 1 || c.locations.length > 1
          ? `${loc.name} · ${venue.name}` : venue.name;

        venueRows += `
          <div class="tp-venue-row" data-venue-id="${venue.id}" data-dow="${dow}">
            <div class="tp-venue-label">${escHtml(rowLabel)}</div>
            <div class="tp-venue-track">${buildHourLines()}${blocksHtml}</div>
          </div>`;
      }
    }

    const dz = _dayZoom[dow] || 1;
    const zoomTouch = `
      <div class="tp-zoom-touch" role="group" aria-label="Zoom tijdas">
        <button type="button" class="tp-zoom-btn tp-zoom-out" data-dow="${dow}" aria-label="Uitzoomen"${dz <= ZOOM_MIN ? ' disabled' : ''}>−</button>
        <button type="button" class="tp-zoom-btn tp-zoom-in" data-dow="${dow}" aria-label="Inzoomen"${dz >= ZOOM_MAX ? ' disabled' : ''}>+</button>
        ${dz > 1 ? `<button type="button" class="tp-zoom-btn tp-zoom-reset-btn" data-dow="${dow}" aria-label="Zoom resetten">↺</button>` : ''}
      </div>`;
    const zoomDesktopReset = dz > 1
      ? `<button type="button" class="tp-zoom-reset-desktop tp-zoom-reset-btn" data-dow="${dow}" aria-label="Zoom resetten">🔍 Reset zoom</button>`
      : '';
    daysHtml += `
      <div class="tp-day" data-dow="${dow}">
        <div class="tp-day-header">
          <span class="tp-day-header-label">${dayLabel}</span>
          ${zoomTouch}
          ${zoomDesktopReset}
        </div>
        <div class="tp-day-scroll">
          <div class="tp-day-content" style="min-width:${dz * 100}%">
            <div class="tp-time-header">${buildTimeHeader()}</div>
            ${venueRows}
          </div>
        </div>
      </div>`;
  }

  // Team overview panel
  const trainingsCount = {};
  for (const t of trainings) {
    trainingsCount[t.team_id] = (trainingsCount[t.team_id] || 0) + 1;
  }
  const totalRequired = c.teams.reduce((s, t) => s + (t.trainings_per_week || 0), 0);
  const totalScheduled = trainings.length;
  let teamRows = '';
  for (const team of c.teams) {
    const need = team.trainings_per_week || 0;
    const have = trainingsCount[team.id] || 0;
    const skip = need === 0;
    const cls = skip ? 'tp-tov-skip' : have === need ? 'tp-tov-ok' : have < need ? 'tp-tov-short' : 'tp-tov-over';
    const colorCls = teamColorClass(team.id);
    const durLabel = skip ? '—' : team.min_training_minutes === team.max_training_minutes
      ? `${team.max_training_minutes}m`
      : `${team.min_training_minutes}–${team.max_training_minutes}m`;
    const countLabel = skip ? '<span class="tp-tov-skip-label">niet inplannen</span>' : `${have} / ${need}`;
    teamRows += `<tr class="${cls}">
      <td><span class="tp-tov-dot ${colorCls}"></span>${escHtml(team.display_name)}</td>
      <td class="tp-tov-num">${countLabel}</td>
      <td class="tp-tov-dur">${durLabel}</td>
      <td class="tp-tov-action">${editable ? `<button class="tp-tov-edit" data-team-id="${team.id}" title="Instellingen">⚙️</button>` : ''}</td>
    </tr>`;
  }
  const summaryClass = totalScheduled >= totalRequired ? 'tp-tov-ok' : 'tp-tov-short';
  const teamOverviewHtml = `
    <details class="tp-team-overview"${_teamOverviewOpen ? ' open' : ''}>
      <summary>Teams <span class="tp-tov-summary ${summaryClass}">${totalScheduled} / ${totalRequired} trainingen</span></summary>
      <table class="tp-tov-table">
        <thead><tr><th>Team</th><th>Gepland</th><th>Duur</th><th></th></tr></thead>
        <tbody>${teamRows}</tbody>
      </table>
    </details>`;

  c.container.innerHTML = `
    <div class="tp-wrapper${isBlueprint ? ' tp-mode-blueprint' : ''}${mobileReadOnly || (isBlueprint && !_editMode) ? ' tp-locked' : ''}${mobileReadOnly ? ' tp-mobile-readonly' : ''}">
      <div class="tp-header">
        <h1>Trainingsplanner</h1>
        ${modeTabs}
      </div>
      ${contextBar}
      <div class="tp-panels">
        <details class="tp-panel">
          <summary>Locaties & velden</summary>
          <div class="tp-venue-bar">${mgmtBarHtml}</div>
        </details>
        ${teamOverviewHtml}
      </div>
      ${daysHtml}
    </div>`;

  wireEvents();

  // Restore scroll positions after DOM rebuild
  c.container.querySelectorAll('.tp-day').forEach(dayEl => {
    const dow = dayEl.dataset.dow;
    const saved = _dayScroll[dow];
    if (saved) {
      const scrollEl = dayEl.querySelector('.tp-day-scroll');
      if (scrollEl) requestAnimationFrame(() => { scrollEl.scrollLeft = saved; });
    }
  });
}

function buildTimeHeader() {
  let html = '';
  for (let h = HOUR_START; h < HOUR_END; h++) {
    const widthPct = (60 / TOTAL_MINUTES) * 100;
    html += `<span class="tp-time-label" style="width:${widthPct}%">${String(h).padStart(2,'0')}:00</span>`;
  }
  return html;
}

function buildHourLines() {
  let html = '';
  for (let h = HOUR_START; h < HOUR_END; h++) {
    const leftPct = ((h - HOUR_START) * 60 / TOTAL_MINUTES) * 100;
    html += `<span class="tp-hour-line" style="left:${leftPct}%"></span>`;
    const halfPct = (((h - HOUR_START) * 60 + 30) / TOTAL_MINUTES) * 100;
    html += `<span class="tp-hour-line half" style="left:${halfPct}%"></span>`;
  }
  return html;
}

// ─── Events wiring ──────────────────────────────────────────────────────────

function wireEvents() {
  const c = _ctx;
  const el = c.container;

  el.querySelector('#tp-to-week')?.addEventListener('click', () => { if (c.mode !== 'week') { c.mode = 'week'; _editMode = false; _undoStack.length = 0; _redoStack.length = 0; loadAndRender(); } });
  el.querySelector('#tp-to-blueprint')?.addEventListener('click', () => { if (c.mode !== 'blueprint') { c.mode = 'blueprint'; loadAndRender(); } });

  el.querySelector('#tp-toggle-edit')?.addEventListener('click', () => { _editMode = !_editMode; renderPlanner(); });
  el.querySelector('#tp-undo')?.addEventListener('click', () => performUndo());
  el.querySelector('#tp-redo')?.addEventListener('click', () => performRedo());
  el.querySelector('#tp-save-snapshot')?.addEventListener('click', () => showSaveSnapshotModal());
  el.querySelector('#tp-load-snapshot')?.addEventListener('click', () => showLoadSnapshotModal());
  el.querySelector('#tp-ai-optimize')?.addEventListener('click', () => triggerAiOptimize());
  el.querySelector('#tp-rename-snapshot')?.addEventListener('click', () => showRenameSnapshotModal());
  el.querySelector('#tp-clear-defaults')?.addEventListener('click', () => clearAllDefaults());
  el.querySelector('#tp-prev-week')?.addEventListener('click', () => { c.isoWeek = shiftWeek(c.isoWeek, -1); loadAndRender(); });
  el.querySelector('#tp-next-week')?.addEventListener('click', () => { c.isoWeek = shiftWeek(c.isoWeek, 1); loadAndRender(); });

  el.querySelector('#tp-make-override')?.addEventListener('click', async () => {
    try {
      await api(`/api/training/week/${c.isoWeek}/override`, { method: 'POST' });
      showToast('Afwijkende week aangemaakt', 'success');
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });

  el.querySelector('#tp-del-override')?.addEventListener('click', async () => {
    if (!confirm('Afwijking verwijderen? Het standaard schema wordt weer actief.')) return;
    try {
      await api(`/api/training/week/${c.isoWeek}/override`, { method: 'DELETE' });
      showToast('Afwijking verwijderd', 'info');
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });

  el.querySelector('.tp-team-overview')?.addEventListener('toggle', (e) => { _teamOverviewOpen = e.target.open; });

  el.querySelectorAll('.tp-tov-edit').forEach(btn => {
    btn.addEventListener('click', () => showTeamSettingsModal(parseInt(btn.dataset.teamId, 10)));
  });

  el.querySelector('#tp-add-location')?.addEventListener('click', () => showLocationModal());

  el.querySelectorAll('.tp-add-court').forEach(btn => {
    btn.addEventListener('click', () => showVenueModal(parseInt(btn.dataset.locId, 10)));
  });

  el.querySelectorAll('.tp-del-loc').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Locatie en alle velden verwijderen?')) return;
      try {
        await api(`/api/training/locations/${btn.dataset.id}`, { method: 'DELETE' });
        c.locations = c.locations.filter(l => String(l.id) !== btn.dataset.id);
        c.venues = c.venues.filter(v => String(v.location_id) !== btn.dataset.id);
        loadAndRender();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  el.querySelectorAll('.tp-del-venue').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Veld verwijderen?')) return;
      try {
        await api(`/api/training/venues/${btn.dataset.id}`, { method: 'DELETE' });
        c.venues = c.venues.filter(v => String(v.id) !== btn.dataset.id);
        loadAndRender();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  const mobileReadOnly = isPlannerMobileViewport();
  const editable = !mobileReadOnly && ((c.mode === 'blueprint' && _editMode) || c.weekData?.isException);

  if (editable) {
    el.querySelectorAll('.tp-venue-track').forEach(track => {
      track.addEventListener('click', (e) => {
        if (e.target.closest('.tp-block')) return;
        const row = track.closest('.tp-venue-row');
        const venueId = parseInt(row.dataset.venueId, 10);
        const dow = parseInt(row.dataset.dow, 10);
        const rect = track.getBoundingClientRect();
        const xPct = (e.clientX - rect.left) / rect.width;
        const rawMin = Math.round(xPct * TOTAL_MINUTES / SNAP) * SNAP;
        const startMin = HOUR_START * 60 + rawMin;
        showQuickAddPicker(e, venueId, dow, startMin);
      });
    });

    el.querySelectorAll('.tp-block:not(.match):not(.readonly)').forEach(block => {
      block.addEventListener('click', (e) => {
        if (e.target.classList.contains('tp-resize-left') || e.target.classList.contains('tp-resize-right')) return;
        showBlockPopover(block, e);
      });
      setupDrag(block);
      setupResize(block);
    });

    el.querySelectorAll('.tp-block.match').forEach(block => {
      setupMatchResize(block);
    });
  }

  // Zoom: Ctrl+wheel (desktop) + +/- knoppen (mobiel, zie CSS)
  el.querySelectorAll('.tp-day').forEach(dayEl => {
    const scrollEl = dayEl.querySelector('.tp-day-scroll');
    const contentEl = dayEl.querySelector('.tp-day-content');
    if (!scrollEl || !contentEl) return;
    const dow = parseInt(dayEl.dataset.dow, 10);

    dayEl.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();

      const oldZoom = _dayZoom[dow] || 1;
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      applyDayZoom(dayEl, dow, oldZoom + delta, e.clientX);
    }, { passive: false });
  });

  el.addEventListener('click', (e) => {
    const zIn = e.target.closest('.tp-zoom-in');
    if (zIn && el.contains(zIn)) {
      e.preventDefault();
      e.stopPropagation();
      const dow = parseInt(zIn.dataset.dow, 10);
      const dayEl = zIn.closest('.tp-day');
      const old = _dayZoom[dow] || 1;
      applyDayZoom(dayEl, dow, old + ZOOM_STEP, null);
      return;
    }
    const zOut = e.target.closest('.tp-zoom-out');
    if (zOut && el.contains(zOut)) {
      e.preventDefault();
      e.stopPropagation();
      const dow = parseInt(zOut.dataset.dow, 10);
      const dayEl = zOut.closest('.tp-day');
      const old = _dayZoom[dow] || 1;
      applyDayZoom(dayEl, dow, old - ZOOM_STEP, null);
      return;
    }
    const zReset = e.target.closest('.tp-zoom-reset-btn');
    if (zReset && el.contains(zReset)) {
      e.preventDefault();
      e.stopPropagation();
      const dow = parseInt(zReset.dataset.dow, 10);
      delete _dayZoom[dow];
      const dayEl = zReset.closest('.tp-day');
      const contentEl = dayEl.querySelector('.tp-day-content');
      const scrollEl = dayEl.querySelector('.tp-day-scroll');
      if (contentEl) contentEl.style.minWidth = '100%';
      if (scrollEl) scrollEl.scrollLeft = 0;
      _dayScroll[dow] = 0;
      syncDayZoomHeader(dayEl, dow, 1);
    }
  });
}

// ─── Drag ───────────────────────────────────────────────────────────────────

function setupDrag(block) {
  block.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('tp-resize-left') || e.target.classList.contains('tp-resize-right')) return;
    e.preventDefault();
    block.classList.add('dragging');
    _ctx.container.querySelectorAll('.tp-day').forEach(d => d.classList.add('tp-dragging-active'));

    const initTrack = block.closest('.tp-venue-track');
    const initTrackRect = initTrack.getBoundingClientRect();
    const grabOffsetX = e.clientX - initTrackRect.left - block.offsetLeft;
    let moved = false;

    const allRows = [..._ctx.container.querySelectorAll('.tp-venue-row')];

    const onMove = (ev) => {
      moved = true;

      // Move to whichever row the mouse is over
      const mouseY = ev.clientY;
      for (const row of allRows) {
        const r = row.getBoundingClientRect();
        if (mouseY >= r.top && mouseY <= r.bottom) {
          const targetTrack = row.querySelector('.tp-venue-track');
          if (targetTrack !== block.parentElement) targetTrack.appendChild(block);
          break;
        }
      }

      // Position relative to the current track
      const currentTrack = block.closest('.tp-venue-track');
      const trackRect = currentTrack.getBoundingClientRect();
      const trackW = currentTrack.offsetWidth;
      const localX = ev.clientX - trackRect.left - grabOffsetX;
      const leftMin = pxToMinutes(Math.max(0, Math.min(localX, trackW)), trackW);
      block.style.left = `${(leftMin / TOTAL_MINUTES) * 100}%`;
    };

    const onUp = async () => {
      block.classList.remove('dragging');
      _ctx.container.querySelectorAll('.tp-day').forEach(d => d.classList.remove('tp-dragging-active'));
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!moved) return;

      const newRow = block.closest('.tp-venue-row');
      const newVenueId = parseInt(newRow.dataset.venueId, 10);
      const newDow = parseInt(newRow.dataset.dow, 10);
      const trackW = newRow.querySelector('.tp-venue-track').offsetWidth;
      const leftMin = pxToMinutes(block.offsetLeft, trackW);
      const startMin = HOUR_START * 60 + leftMin;
      const widthPct = parseFloat(block.style.width);
      const durMin = Math.round(widthPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
      const endMin = startMin + durMin;

      const id = block.dataset.trainingId;
      const source = block.dataset.source;
      const endpoint = source === 'default' ? `/api/training/defaults/${id}` : `/api/training/exceptions/${id}`;
      snapshotBeforeMutation();
      try {
        await api(endpoint, { method: 'PATCH', body: {
          venue_id: newVenueId,
          day_of_week: newDow,
          start_time: minutesToTime(startMin),
          end_time: minutesToTime(Math.min(endMin, HOUR_END * 60)),
        } });
      } catch (err) { showToast(err.message, 'error'); }
      loadAndRender();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

// ─── Resize ─────────────────────────────────────────────────────────────────

function setupResize(block) {
  function handleResize(handle, side) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handle.setPointerCapture(e.pointerId);

      const track = block.closest('.tp-venue-track');
      const trackW = track.offsetWidth;
      const origLeftPct = parseFloat(block.style.left);
      const origWidthPct = parseFloat(block.style.width);
      const startX = e.clientX;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        const dPct = (dx / trackW) * 100;
        if (side === 'left') {
          let newLeft = origLeftPct + dPct;
          let newWidth = origWidthPct - dPct;
          const minW = (SNAP / TOTAL_MINUTES) * 100;
          if (newWidth < minW) { newWidth = minW; newLeft = origLeftPct + origWidthPct - minW; }
          if (newLeft < 0) { newWidth += newLeft; newLeft = 0; }
          block.style.left = `${newLeft}%`;
          block.style.width = `${newWidth}%`;
        } else {
          let newWidth = origWidthPct + dPct;
          const minW = (SNAP / TOTAL_MINUTES) * 100;
          if (newWidth < minW) newWidth = minW;
          if (origLeftPct + newWidth > 100) newWidth = 100 - origLeftPct;
          block.style.width = `${newWidth}%`;
        }
      };

      const onUp = async () => {
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        const leftPct = parseFloat(block.style.left);
        const widthPct = parseFloat(block.style.width);
        const leftMin = Math.round(leftPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
        const durMin = Math.round(widthPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
        const startMin = HOUR_START * 60 + leftMin;
        const endMin = startMin + durMin;
        const id = block.dataset.trainingId;
        const source = block.dataset.source;
        const endpoint = source === 'default' ? `/api/training/defaults/${id}` : `/api/training/exceptions/${id}`;
        snapshotBeforeMutation();
        try {
          await api(endpoint, { method: 'PATCH', body: { start_time: minutesToTime(startMin), end_time: minutesToTime(endMin) } });
        } catch (err) { showToast(err.message, 'error'); }
        loadAndRender();
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
    });
  }

  handleResize(block.querySelector('.tp-resize-left'), 'left');
  handleResize(block.querySelector('.tp-resize-right'), 'right');
}

function setupMatchResize(block) {
  const handle = block.querySelector('.tp-resize-right');
  if (!handle) return;
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);

    const track = block.closest('.tp-venue-track');
    const trackW = track.offsetWidth;
    const origLeftPct = parseFloat(block.style.left);
    const origWidthPct = parseFloat(block.style.width);
    const startX = e.clientX;

    const onMove = (ev) => {
      let newWidth = origWidthPct + ((ev.clientX - startX) / trackW) * 100;
      const minW = (SNAP / TOTAL_MINUTES) * 100;
      if (newWidth < minW) newWidth = minW;
      if (origLeftPct + newWidth > 100) newWidth = 100 - origLeftPct;
      block.style.width = `${newWidth}%`;
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      const widthPct = parseFloat(block.style.width);
      const durMin = Math.round(widthPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
      const key = block.dataset.matchKey;
      if (key) { _matchOverrides[key] = durMin; _saveMatchOverrides(); }
      loadAndRender();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  });
}

// ─── Popover ────────────────────────────────────────────────────────────────

function showBlockPopover(block, e) {
  closePopover();
  const id = block.dataset.trainingId;
  const source = block.dataset.source;
  const c = _ctx;
  const t = c.weekData.trainings.find(x => String(x.id) === id);
  if (!t) return;

  const pop = document.createElement('div');
  pop.className = 'tp-popover';
  const locName = t.location_name ? `${escHtml(t.location_name)} · ` : '';
  pop.innerHTML = `
    <h4>${escHtml(t.team_name || '')}</h4>
    <div class="tp-pop-meta">${t.start_time} – ${t.end_time} · ${locName}${escHtml(t.venue_name || '')}</div>
    <div class="tp-pop-actions">
      <button class="btn btn-sm btn-secondary" id="tp-pop-edit">✏️ Bewerken</button>
      <button class="btn btn-sm btn-secondary" id="tp-pop-team">⚙️ Team</button>
      <button class="btn btn-sm btn-secondary" id="tp-pop-del" style="color:var(--danger)">Verwijderen</button>
    </div>`;

  document.body.appendChild(pop);
  const bRect = block.getBoundingClientRect();
  pop.style.left = `${Math.min(bRect.left, window.innerWidth - 240)}px`;
  pop.style.top = `${bRect.bottom + 6}px`;

  pop.querySelector('#tp-pop-edit').addEventListener('click', () => { closePopover(); showEditTrainingModal(t, source); });
  pop.querySelector('#tp-pop-team').addEventListener('click', () => { closePopover(); showTeamSettingsModal(t.team_id); });
  pop.querySelector('#tp-pop-del').addEventListener('click', async () => {
    closePopover();
    if (!confirm('Training verwijderen?')) return;
    snapshotBeforeMutation();
    const endpoint = source === 'default' ? `/api/training/defaults/${id}` : `/api/training/exceptions/${id}`;
    try { await api(endpoint, { method: 'DELETE' }); loadAndRender(); }
    catch (err) { showToast(err.message, 'error'); }
  });

  setTimeout(() => document.addEventListener('click', closePopoverOutside), 0);
}

function closePopover() {
  document.querySelectorAll('.tp-popover').forEach(p => p.remove());
  document.removeEventListener('click', closePopoverOutside);
}
function closePopoverOutside(e) { if (!e.target.closest('.tp-popover')) closePopover(); }

// ─── Team settings modal ─────────────────────────────────────────────────────

function showTeamSettingsModal(teamId) {
  const team = _ctx.teams.find(t => t.id === teamId);
  if (!team) return;

  let overlay = document.querySelector('.tp-modal-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'tp-modal-overlay'; document.body.appendChild(overlay); }

  const durOpts = [60,75,90,105,120,135,150].map(m => {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return `<option value="${m}">${h}:${String(r).padStart(2,'0')} (${m} min)</option>`;
  }).join('');

  overlay.innerHTML = `<div class="tp-modal" style="max-width:420px">
    <h3 style="margin:0 0 4px">${escHtml(team.display_name)}</h3>
    <p style="margin:0 0 16px;font-size:.82rem;color:var(--text-muted)">Trainingsvoorkeuren voor dit team</p>
    <div class="tp-team-settings-grid">
      <label for="tp-ts-freq">Trainingen per week</label>
      <select id="tp-ts-freq" class="form-control">
        <option value="0"${team.trainings_per_week === 0 ? ' selected' : ''}>Niet inplannen</option>
        <option value="1"${team.trainings_per_week === 1 ? ' selected' : ''}>1× per week</option>
        <option value="2"${team.trainings_per_week === 2 ? ' selected' : ''}>2× per week</option>
        <option value="3"${team.trainings_per_week === 3 ? ' selected' : ''}>3× per week</option>
        <option value="4"${team.trainings_per_week === 4 ? ' selected' : ''}>4× per week</option>
        <option value="5"${team.trainings_per_week === 5 ? ' selected' : ''}>5× per week</option>
      </select>
      <label for="tp-ts-min">Minimale duur</label>
      <select id="tp-ts-min" class="form-control">${durOpts}</select>
      <label for="tp-ts-max">Maximale duur</label>
      <select id="tp-ts-max" class="form-control">${durOpts}</select>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-sm btn-secondary tp-ts-cancel">Annuleren</button>
      <button class="btn btn-sm btn-primary tp-ts-save">Opslaan</button>
    </div>
  </div>`;
  overlay.style.display = 'flex';

  overlay.querySelector('#tp-ts-min').value = team.min_training_minutes || 90;
  overlay.querySelector('#tp-ts-max').value = team.max_training_minutes || 90;

  overlay.querySelector('.tp-ts-cancel').onclick = () => { overlay.style.display = 'none'; };
  overlay.querySelector('.tp-ts-save').onclick = async () => {
    const freq = parseInt(overlay.querySelector('#tp-ts-freq').value, 10);
    const minM = parseInt(overlay.querySelector('#tp-ts-min').value, 10);
    const maxM = parseInt(overlay.querySelector('#tp-ts-max').value, 10);
    if (minM > maxM) { showToast && showToast('Minimum mag niet hoger zijn dan maximum', 'error'); return; }
    try {
      await api(`/api/training/teams/${teamId}`, {
        method: 'PATCH',
        body: { trainings_per_week: freq, min_training_minutes: minM, max_training_minutes: maxM },
      });
      team.trainings_per_week = freq;
      team.min_training_minutes = minM;
      team.max_training_minutes = maxM;
      overlay.style.display = 'none';
      showToast && showToast(`${team.display_name} bijgewerkt`);
    } catch (err) { showToast && showToast(err.message, 'error'); }
  };
}

// ─── Snapshot modals ────────────────────────────────────────────────────────

function showSaveSnapshotModal() {
  let overlay = document.querySelector('.tp-modal-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'tp-modal-overlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = `<div class="tp-modal">
    <h3 style="margin:0 0 12px">Blauwdruk opslaan als</h3>
    <p style="margin:0 0 10px;font-size:.85rem;color:var(--text-muted)">Sla de huidige blauwdruk op onder een naam zodat je deze later weer kunt terugzetten.</p>
    <input id="tp-snap-name" class="form-control" placeholder="Naam, bijv. Seizoen 2025-2026" style="margin-bottom:12px" />
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-sm btn-secondary tp-snap-cancel">Annuleren</button>
      <button class="btn btn-sm btn-primary tp-snap-save">Opslaan</button>
    </div>
  </div>`;
  overlay.style.display = 'flex';
  const nameInput = overlay.querySelector('#tp-snap-name');
  nameInput.focus();
  overlay.querySelector('.tp-snap-cancel').onclick = () => { overlay.style.display = 'none'; };
  overlay.querySelector('.tp-snap-save').onclick = async () => {
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    try {
      await api('/api/training/snapshots', { method: 'POST', body: { name } });
      _activeSnapshotName = name;
      overlay.style.display = 'none';
      showToast && showToast(`Blauwdruk "${name}" opgeslagen ✓`);
      loadAndRender();
    } catch (err) { showToast && showToast('Opslaan mislukt: ' + err.message, 'error'); }
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') overlay.querySelector('.tp-snap-save').click(); });
}

async function showLoadSnapshotModal() {
  let overlay = document.querySelector('.tp-modal-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'tp-modal-overlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = `<div class="tp-modal"><p>Laden...</p></div>`;
  overlay.style.display = 'flex';

  let snapshots;
  try {
    const data = await api('/api/training/snapshots');
    snapshots = data.snapshots || [];
  } catch (err) {
    overlay.innerHTML = `<div class="tp-modal"><p>Fout bij laden: ${err.message}</p>
      <button class="btn btn-sm btn-secondary tp-snap-close">Sluiten</button></div>`;
    overlay.querySelector('.tp-snap-close').onclick = () => { overlay.style.display = 'none'; };
    return;
  }

  if (!snapshots.length) {
    overlay.innerHTML = `<div class="tp-modal">
      <h3 style="margin:0 0 12px">Blauwdruk laden</h3>
      <p style="color:var(--text-muted);font-size:.85rem">Nog geen opgeslagen blauwdrukken. Sla eerst een blauwdruk op.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-sm btn-secondary tp-snap-close">Sluiten</button>
      </div>
    </div>`;
    overlay.querySelector('.tp-snap-close').onclick = () => { overlay.style.display = 'none'; };
    return;
  }

  const rows = snapshots.map(s => {
    const d = new Date(s.created_at + 'Z');
    const ts = d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const isActive = !!s.is_active;
    const activeTag = isActive ? '<span style="font-size:.7rem;background:var(--primary-color);color:#fff;padding:1px 6px;border-radius:4px;margin-left:4px">actief</span>' : '';
    const activateBtn = isActive
      ? ''
      : `<button class="btn btn-sm btn-primary tp-snap-activate" data-id="${s.id}" data-name="${escHtml(s.name)}" style="font-size:.75rem">Activeren</button>`;
    return `<div class="tp-snap-row" style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-color)">
      <span style="flex:1;font-weight:500">${escHtml(s.name)}${activeTag}</span>
      <span style="font-size:.75rem;color:var(--text-muted);white-space:nowrap">${ts}</span>
      ${activateBtn}
      <button class="btn btn-sm btn-danger tp-snap-del" data-id="${s.id}" data-name="${escHtml(s.name)}" style="font-size:.75rem;padding:2px 6px">✕</button>
    </div>`;
  }).join('');

  overlay.innerHTML = `<div class="tp-modal" style="max-width:500px">
    <h3 style="margin:0 0 12px">Blauwdrukken beheren</h3>
    <p style="margin:0 0 10px;font-size:.85rem;color:var(--text-muted)">De actieve blauwdruk bepaalt welke trainingsdata zichtbaar is op de teampagina's.</p>
    <div style="max-height:300px;overflow-y:auto">${rows}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn btn-sm btn-secondary tp-snap-close">Sluiten</button>
    </div>
  </div>`;

  overlay.querySelector('.tp-snap-close').onclick = () => { overlay.style.display = 'none'; };

  overlay.querySelectorAll('.tp-snap-activate').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`"${name}" activeren? De huidige blauwdruk wordt hiermee overschreven.`)) return;
      snapshotBeforeMutation();
      try {
        await api(`/api/training/snapshots/${btn.dataset.id}/activate`, { method: 'POST' });
        _activeSnapshotName = name;
        overlay.style.display = 'none';
        showToast && showToast(`Blauwdruk "${name}" geactiveerd ✓`);
        loadAndRender();
      } catch (err) { showToast && showToast('Activeren mislukt: ' + err.message, 'error'); }
    });
  });

  overlay.querySelectorAll('.tp-snap-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.name;
      if (!confirm(`Weet je zeker dat je "${name}" wilt verwijderen?`)) return;
      try {
        await api(`/api/training/snapshots/${btn.dataset.id}`, { method: 'DELETE' });
        btn.closest('.tp-snap-row').remove();
        showToast && showToast(`"${name}" verwijderd`);
        if (!overlay.querySelectorAll('.tp-snap-row').length) {
          overlay.querySelector('.tp-modal').innerHTML = `<h3 style="margin:0 0 12px">Blauwdrukken beheren</h3>
            <p style="color:var(--text-muted);font-size:.85rem">Geen opgeslagen blauwdrukken meer.</p>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
              <button class="btn btn-sm btn-secondary tp-snap-close">Sluiten</button></div>`;
          overlay.querySelector('.tp-snap-close').onclick = () => { overlay.style.display = 'none'; };
        }
      } catch (err) { showToast && showToast('Verwijderen mislukt: ' + err.message, 'error'); }
    });
  });
}

// ─── Clear all defaults ─────────────────────────────────────────────────────

async function clearAllDefaults() {
  if (!confirm('Weet je zeker dat je de hele blauwdruk wilt leegmaken? Alle trainingen worden verwijderd. Sla eventueel eerst op.')) return;
  snapshotBeforeMutation();
  try {
    await api('/api/training/defaults/all', { method: 'DELETE' });
    showToast && showToast('Blauwdruk leeggemaakt');
    loadAndRender();
  } catch (err) { showToast && showToast('Leegmaken mislukt: ' + err.message, 'error'); }
}

// ─── Rename active snapshot ─────────────────────────────────────────────────

async function showRenameSnapshotModal() {
  let activeSnap;
  try { activeSnap = await api('/api/training/snapshots/active'); } catch (_) { return; }
  if (!activeSnap?.id) { showToast && showToast('Geen actieve blauwdruk om te hernoemen', 'error'); return; }

  let overlay = document.querySelector('.tp-modal-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'tp-modal-overlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = `<div class="tp-modal" style="max-width:400px">
    <h3 style="margin:0 0 12px">Blauwdruk hernoemen</h3>
    <input id="tp-rename-input" class="form-control" value="${escHtml(activeSnap.name || '')}" style="margin-bottom:12px" />
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-sm btn-secondary tp-rename-cancel">Annuleren</button>
      <button class="btn btn-sm btn-primary tp-rename-save">Hernoemen</button>
    </div>
  </div>`;
  overlay.style.display = 'flex';
  const input = overlay.querySelector('#tp-rename-input');
  input.focus();
  input.select();
  overlay.querySelector('.tp-rename-cancel').onclick = () => { overlay.style.display = 'none'; };
  const doRename = async () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    try {
      await api(`/api/training/snapshots/${activeSnap.id}`, { method: 'PATCH', body: { name } });
      _activeSnapshotName = name;
      overlay.style.display = 'none';
      showToast && showToast(`Hernoemed naar "${name}"`);
      loadAndRender();
    } catch (err) { showToast && showToast('Hernoemen mislukt: ' + err.message, 'error'); }
  };
  overlay.querySelector('.tp-rename-save').onclick = doRename;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doRename(); });
}

// ─── AI optimize via webhook ────────────────────────────────────────────────

async function triggerAiOptimize() {
  let overlay = document.querySelector('.tp-modal-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'tp-modal-overlay'; document.body.appendChild(overlay); }

  overlay.innerHTML = `<div class="tp-modal tp-ai-modal">
    <div class="tp-ai-header">
      <div class="tp-ai-icon">🤖</div>
      <div>
        <h3>AI Assistent</h3>
        <p>Laat de AI je trainingsplanning maken, aanvullen of optimaliseren.</p>
      </div>
    </div>
    <div class="tp-ai-body">
      <label>Wat moet de AI doen?</label>
      <div class="tp-ai-modes">
        <label class="tp-ai-mode">
          <input type="radio" name="tp-ai-mode" value="new">
          <div class="tp-ai-mode-content">
            <strong>Nieuwe planning</strong>
            <span>Start vanaf nul. Alle teams worden ingepland.</span>
          </div>
        </label>
        <label class="tp-ai-mode">
          <input type="radio" name="tp-ai-mode" value="complete" checked>
          <div class="tp-ai-mode-content">
            <strong>Aanvullen</strong>
            <span>Bestaande trainingen behouden, ontbrekende teams bijplannen.</span>
          </div>
        </label>
        <label class="tp-ai-mode">
          <input type="radio" name="tp-ai-mode" value="optimize">
          <div class="tp-ai-mode-content">
            <strong>Optimaliseren</strong>
            <span>Bestaande planning verbeteren: overlappen, gaten en duur corrigeren.</span>
          </div>
        </label>
      </div>
      <label for="tp-ai-message">Extra opdracht <span class="tp-ai-optional">optioneel</span></label>
      <textarea id="tp-ai-message" rows="2" placeholder="Bijv. 'Focus op coach-dubbelrollen' of 'Plan N5 op dinsdag en donderdag'"></textarea>
      <div id="tp-ai-status" class="tp-ai-status">Verbinding controleren...</div>
    </div>
    <div class="tp-ai-footer">
      <button class="btn btn-sm btn-secondary tp-ai-cancel">Annuleren</button>
      <button class="btn btn-sm btn-primary tp-ai-start" disabled>Starten</button>
    </div>
  </div>`;
  overlay.style.display = 'flex';

  const statusEl = overlay.querySelector('#tp-ai-status');
  const startBtn = overlay.querySelector('.tp-ai-start');
  const msgInput = overlay.querySelector('#tp-ai-message');
  overlay.querySelector('.tp-ai-cancel').onclick = () => { overlay.style.display = 'none'; };

  try {
    const check = await api('/api/training/ai-webhook-status');
    if (!check.configured) {
      statusEl.innerHTML = '<span class="tp-ai-status-err">⚠️ Webhook niet geconfigureerd — stel <code>N8N_TRAINING_WEBHOOK_URL</code> in via .env</span>';
      return;
    }
    statusEl.innerHTML = '<span class="tp-ai-status-ok">✓ Verbonden</span>';
    startBtn.disabled = false;
  } catch (err) {
    statusEl.innerHTML = `<span class="tp-ai-status-err">Verbinding mislukt: ${escHtml(err.message)}</span>`;
    return;
  }

  startBtn.onclick = async () => {
    startBtn.disabled = true;
    msgInput.disabled = true;
    overlay.querySelectorAll('input[name="tp-ai-mode"]').forEach(r => { r.disabled = true; });
    const selectedMode = overlay.querySelector('input[name="tp-ai-mode"]:checked')?.value || 'complete';
    const modeLabels = { new: 'maakt een nieuwe planning', complete: 'vult de planning aan', optimize: 'optimaliseert de planning' };
    statusEl.innerHTML = `<span class="tp-ai-status-loading"><span class="tp-spinner"></span> AI agent ${modeLabels[selectedMode]}... dit kan 1–2 min duren</span>`;

    snapshotBeforeMutation();
    try {
      const result = await api('/api/training/ai-optimize', { method: 'POST', body: { mode: selectedMode, message: msgInput.value.trim() } });

      if (result.snapshot) {
        statusEl.innerHTML = '<span class="tp-ai-status-loading"><span class="tp-spinner"></span> Planning ontvangen, wordt geactiveerd...</span>';

        try {
          await api(`/api/training/snapshots/${result.snapshot.id}/activate`, { method: 'POST' });
          _activeSnapshotName = result.snapshot.name;
        } catch (_) {}

        let html = `<div class="tp-ai-result-success">
          <div class="tp-ai-result-header">✅ <strong>${escHtml(result.snapshot.name)}</strong> geactiveerd — ${result.snapshot.entries} trainingen</div>`;
        if (result.errors?.length) {
          html += `<div class="tp-ai-result-warn">⚠️ ${result.errors.length} entries overgeslagen (onbekend team/veld)</div>`;
        }
        if (result.advice) {
          html += `<details open class="tp-ai-advice"><summary>AI advies</summary><pre>${escHtml(result.advice)}</pre></details>`;
        }
        html += '</div>';
        statusEl.innerHTML = html;
        overlay.querySelector('.tp-ai-cancel').textContent = 'Sluiten';
        loadAndRender();
      } else if (result.advice) {
        statusEl.innerHTML = `<div class="tp-ai-result-warn" style="margin-bottom:8px">Geen planning gegenereerd</div>
          <details open class="tp-ai-advice"><summary>AI advies</summary><pre>${escHtml(result.advice)}</pre></details>`;
        overlay.querySelector('.tp-ai-cancel').textContent = 'Sluiten';
      } else {
        statusEl.innerHTML = '<span class="tp-ai-status-err">Geen bruikbare response ontvangen</span>';
      }
    } catch (err) {
      statusEl.innerHTML = `<span class="tp-ai-status-err">❌ ${escHtml(err.message)}</span>`;
      startBtn.disabled = false;
      msgInput.disabled = false;
      startBtn.textContent = 'Opnieuw proberen';
    }
  };
}

// ─── (import JSON removed — import happens via API or AI agent) ─────────────

// ─── Modals ─────────────────────────────────────────────────────────────────

async function showLocationModal() {
  let nevoboVenues = [];
  try {
    showToast('Nevobo-locaties ophalen...', 'info');
    const data = await api('/api/training/nevobo-venues');
    nevoboVenues = data.venues || [];
  } catch (_) {}

  const nevoboList = nevoboVenues.map(v => {
    const fieldNames = v.fields.map(f => escHtml(f.name)).join(', ');
    return `<div class="tp-nevobo-loc" data-idx="${nevoboVenues.indexOf(v)}" style="padding:0.6rem;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;margin-bottom:0.4rem;transition:background 0.15s">
      <strong>${escHtml(v.name)}</strong> <span style="color:var(--text-muted);font-size:0.8rem">(${v.match_count} wedstrijden)</span>
      ${v.fields.length ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.2rem">Velden: ${fieldNames}</div>` : ''}
    </div>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'tp-modal-overlay';
  overlay.innerHTML = `
    <div class="tp-modal" style="max-width:500px">
      <h3>Locatie toevoegen</h3>
      ${nevoboList ? `<p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem">Selecteer een Nevobo-locatie — de velden worden automatisch aangemaakt:</p>${nevoboList}<hr style="margin:1rem 0">` : ''}
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem">Of voeg handmatig een trainingslocatie toe:</p>
      <form id="tp-loc-form">
        <div class="form-group"><label class="form-label">Naam</label><input class="form-input" id="tp-l-name" required placeholder="bijv. Sporthal De Brug" /></div>
        <div class="flex gap-2" style="margin-top:0.75rem">
          <button type="button" class="btn btn-secondary" style="flex:1" id="tp-l-cancel">Annuleren</button>
          <button type="submit" class="btn btn-primary" style="flex:1">Handmatig toevoegen</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  // Nevobo location click → auto-create location + all venues
  overlay.querySelectorAll('.tp-nevobo-loc').forEach(el => {
    el.addEventListener('mouseenter', () => { el.style.background = 'rgba(33,150,243,0.06)'; });
    el.addEventListener('mouseleave', () => { el.style.background = ''; });
    el.addEventListener('click', async () => {
      const v = nevoboVenues[parseInt(el.dataset.idx, 10)];
      if (!v) return;
      try {
        const locRes = await api('/api/training/locations', {
          method: 'POST',
          body: { name: v.name, nevobo_venue_name: v.name },
        });
        _ctx.locations.push(locRes.location);
        for (const field of v.fields) {
          const venueRes = await api('/api/training/venues', {
            method: 'POST',
            body: { location_id: locRes.location.id, name: field.name, type: 'hall', nevobo_field_slug: field.slug },
          });
          _ctx.venues.push(venueRes.venue);
        }
        if (v.fields.length === 0) {
          const venueRes = await api('/api/training/venues', {
            method: 'POST',
            body: { location_id: locRes.location.id, name: 'Veld 1', type: 'hall' },
          });
          _ctx.venues.push(venueRes.venue);
        }
        overlay.remove();
        showToast(`${v.name} met ${Math.max(v.fields.length, 1)} veld(en) aangemaakt`, 'success');
        loadAndRender();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  overlay.querySelector('#tp-l-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#tp-loc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/training/locations', {
        method: 'POST',
        body: { name: document.getElementById('tp-l-name').value },
      });
      _ctx.locations.push(res.location);
      overlay.remove();
      showToast('Locatie aangemaakt — voeg nu velden toe', 'success');
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function showVenueModal(locationId) {
  const loc = _ctx.locations.find(l => l.id === locationId);
  const overlay = document.createElement('div');
  overlay.className = 'tp-modal-overlay';
  overlay.innerHTML = `
    <div class="tp-modal">
      <h3>Veld toevoegen aan ${escHtml(loc?.name || '')}</h3>
      <form id="tp-venue-form">
        <div class="form-group"><label class="form-label">Naam</label><input class="form-input" id="tp-v-name" required placeholder="bijv. Veld 1" /></div>
        <div class="form-group"><label class="form-label">Type</label><select class="form-input" id="tp-v-type"><option value="hall">Zaal</option><option value="field">Veld</option></select></div>
        <div class="flex gap-2" style="margin-top:1rem">
          <button type="button" class="btn btn-secondary" style="flex:1" id="tp-v-cancel">Annuleren</button>
          <button type="submit" class="btn btn-primary" style="flex:1">Toevoegen</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#tp-v-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#tp-venue-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/training/venues', {
        method: 'POST',
        body: {
          location_id: locationId,
          name: document.getElementById('tp-v-name').value,
          type: document.getElementById('tp-v-type').value,
        },
      });
      _ctx.venues.push(res.venue);
      overlay.remove();
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function venueOptionsHtml(selectedId) {
  const c = _ctx;
  let html = '';
  for (const loc of c.locations) {
    const locVenues = c.venues.filter(v => v.location_id === loc.id);
    for (const v of locVenues) {
      html += `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${escHtml(loc.name)} · ${escHtml(v.name)}</option>`;
    }
  }
  return html;
}

function showQuickAddPicker(e, venueId, dow, startMin) {
  closePopover();
  const c = _ctx;
  const trainings = c.weekData.trainings || [];

  const countByTeam = {};
  for (const t of trainings) countByTeam[t.team_id] = (countByTeam[t.team_id] || 0) + 1;

  const available = c.teams.filter(t => {
    const need = t.trainings_per_week || 0;
    if (need === 0) return false;
    return (countByTeam[t.id] || 0) < need;
  });
  const allPlannable = c.teams.filter(t => (t.trainings_per_week || 0) > 0);

  const pop = document.createElement('div');
  pop.className = 'tp-popover tp-quick-add';

  function renderList(teams) {
    if (teams.length === 0) return '<div class="tp-qa-empty">Geen teams beschikbaar</div>';
    return teams.map(t => {
      const colorCls = teamColorClass(t.id);
      return `<button class="tp-qa-item" data-team-id="${t.id}"><span class="tp-tov-dot ${colorCls}"></span>${escHtml(t.display_name)}</button>`;
    }).join('');
  }

  const listEl = document.createElement('div');
  listEl.className = 'tp-qa-list';
  listEl.innerHTML = renderList(available);

  const footer = document.createElement('label');
  footer.className = 'tp-qa-toggle';
  footer.innerHTML = `<input type="checkbox"> Toon alle teams`;

  pop.appendChild(listEl);
  pop.appendChild(footer);

  document.body.appendChild(pop);
  pop.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
  pop.style.top = `${e.clientY + 4}px`;

  footer.querySelector('input').addEventListener('change', (ev) => {
    listEl.innerHTML = renderList(ev.target.checked ? allPlannable : available);
    wireItems();
  });

  function wireItems() {
    pop.querySelectorAll('.tp-qa-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const teamId = parseInt(btn.dataset.teamId, 10);
        const team = c.teams.find(t => t.id === teamId);
        const dur = team?.max_training_minutes || DEFAULT_DURATION;
        const endMin = Math.min(startMin + dur, HOUR_END * 60);
        const body = {
          team_id: teamId,
          venue_id: venueId,
          day_of_week: dow,
          start_time: minutesToTime(startMin),
          end_time: minutesToTime(endMin),
        };
        snapshotBeforeMutation();
        try {
          if (c.mode === 'blueprint') {
            await api('/api/training/defaults', { method: 'POST', body });
          } else {
            await api('/api/training/exceptions', { method: 'POST', body: { ...body, iso_week: c.isoWeek } });
          }
          closePopover();
          loadAndRender();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  }
  wireItems();

  setTimeout(() => document.addEventListener('click', closePopoverOutside), 0);
}

function showAddTrainingModal(venueId, dow, startTime, endTime) {
  const c = _ctx;
  const overlay = document.createElement('div');
  overlay.className = 'tp-modal-overlay';
  const teamOptions = c.teams.map(t => `<option value="${t.id}">${escHtml(t.display_name)}</option>`).join('');
  const dayOptions = DAY_NAMES.map((n, i) => `<option value="${i}" ${i === dow ? 'selected' : ''}>${n}</option>`).join('');

  overlay.innerHTML = `
    <div class="tp-modal">
      <h3>Training toevoegen</h3>
      <form id="tp-add-form">
        <div class="form-group"><label class="form-label">Team</label><select class="form-input" id="tp-a-team" required>${teamOptions}</select></div>
        <div class="form-group"><label class="form-label">Veld</label><select class="form-input" id="tp-a-venue">${venueOptionsHtml(venueId)}</select></div>
        <div class="form-group"><label class="form-label">Dag</label><select class="form-input" id="tp-a-dow">${dayOptions}</select></div>
        <div class="flex gap-2">
          <div class="form-group" style="flex:1"><label class="form-label">Van</label><input type="time" class="form-input" id="tp-a-start" value="${startTime}" required /></div>
          <div class="form-group" style="flex:1"><label class="form-label">Tot</label><input type="time" class="form-input" id="tp-a-end" value="${endTime}" required /></div>
        </div>
        <div class="flex gap-2" style="margin-top:1rem">
          <button type="button" class="btn btn-secondary" style="flex:1" id="tp-a-cancel">Annuleren</button>
          <button type="submit" class="btn btn-primary" style="flex:1">Toevoegen</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#tp-a-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#tp-add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      team_id: parseInt(document.getElementById('tp-a-team').value, 10),
      venue_id: parseInt(document.getElementById('tp-a-venue').value, 10),
      day_of_week: parseInt(document.getElementById('tp-a-dow').value, 10),
      start_time: document.getElementById('tp-a-start').value,
      end_time: document.getElementById('tp-a-end').value,
    };
    snapshotBeforeMutation();
    try {
      if (c.mode === 'blueprint') {
        await api('/api/training/defaults', { method: 'POST', body });
      } else {
        await api('/api/training/exceptions', { method: 'POST', body: { ...body, iso_week: c.isoWeek } });
      }
      overlay.remove();
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function showEditTrainingModal(training, source) {
  const c = _ctx;
  const overlay = document.createElement('div');
  overlay.className = 'tp-modal-overlay';
  const teamOptions = c.teams.map(t => `<option value="${t.id}" ${t.id === training.team_id ? 'selected' : ''}>${escHtml(t.display_name)}</option>`).join('');
  const dayOptions = DAY_NAMES.map((n, i) => `<option value="${i}" ${i === training.day_of_week ? 'selected' : ''}>${n}</option>`).join('');

  overlay.innerHTML = `
    <div class="tp-modal">
      <h3>Training bewerken</h3>
      <form id="tp-edit-form">
        <div class="form-group"><label class="form-label">Team</label><select class="form-input" id="tp-e-team">${teamOptions}</select></div>
        <div class="form-group"><label class="form-label">Veld</label><select class="form-input" id="tp-e-venue">${venueOptionsHtml(training.venue_id)}</select></div>
        <div class="form-group"><label class="form-label">Dag</label><select class="form-input" id="tp-e-dow">${dayOptions}</select></div>
        <div class="flex gap-2">
          <div class="form-group" style="flex:1"><label class="form-label">Van</label><input type="time" class="form-input" id="tp-e-start" value="${training.start_time}" required /></div>
          <div class="form-group" style="flex:1"><label class="form-label">Tot</label><input type="time" class="form-input" id="tp-e-end" value="${training.end_time}" required /></div>
        </div>
        <div class="flex gap-2" style="margin-top:1rem">
          <button type="button" class="btn btn-secondary" style="flex:1" id="tp-e-cancel">Annuleren</button>
          <button type="submit" class="btn btn-primary" style="flex:1">Opslaan</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#tp-e-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#tp-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      team_id: parseInt(document.getElementById('tp-e-team').value, 10),
      venue_id: parseInt(document.getElementById('tp-e-venue').value, 10),
      day_of_week: parseInt(document.getElementById('tp-e-dow').value, 10),
      start_time: document.getElementById('tp-e-start').value,
      end_time: document.getElementById('tp-e-end').value,
    };
    const endpoint = source === 'default' ? `/api/training/defaults/${training.id}` : `/api/training/exceptions/${training.id}`;
    snapshotBeforeMutation();
    try {
      await api(endpoint, { method: 'PATCH', body });
      overlay.remove();
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });
}
