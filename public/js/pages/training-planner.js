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
const _dayZoom = {};
const _dayScroll = {};
const ZOOM_MIN = 1;
const ZOOM_MAX = 5;
const ZOOM_STEP = 0.2;

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

export async function render(container) {
  document.getElementById('app')?.classList.add('tp-fullwidth');
  container.innerHTML = '<div class="spinner"></div>';
  const user = state.user;
  if (!user?.club_id) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>Geen club gekoppeld.</p></div>';
    return;
  }

  try {
    const [locData, venueData, teamData, clubData] = await Promise.all([
      api('/api/training/locations'),
      api('/api/training/venues'),
      api('/api/training/teams'),
      api(`/api/clubs/${user.club_id}`),
    ]);

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
  const editable = c.mode === 'blueprint' || isException;

  const isBlueprint = c.mode === 'blueprint';
  let modeButtons = '';
  if (isBlueprint) {
    const snapLabel = _activeSnapshotName
      ? `<span class="tp-badge" style="background:var(--primary-color);color:#fff;font-weight:500">${escHtml(_activeSnapshotName)}</span>`
      : '';
    modeButtons = `<span class="tp-badge tp-badge-blueprint">Blauwdruk</span>${snapLabel}
      <button class="btn btn-sm btn-primary" id="tp-save-snapshot" style="font-size:0.78rem">💾 Opslaan als</button>
      <button class="btn btn-sm btn-secondary" id="tp-load-snapshot" style="font-size:0.78rem">📂 Laden</button>
      <button class="btn btn-sm btn-secondary" id="tp-to-week">Weekweergave</button>`;
  } else {
    modeButtons = `<button class="btn btn-sm btn-secondary" id="tp-to-blueprint">Blauwdruk</button>`;
    if (isException) {
      modeButtons += `<span class="tp-badge tp-badge-exception">Afwijkende week${c.weekData.exceptionLabel ? ': ' + escHtml(c.weekData.exceptionLabel) : ''}</span>
        <button class="btn btn-sm btn-secondary" id="tp-del-override">Verwijder afwijking</button>`;
    } else {
      modeButtons += `<span class="tp-badge tp-badge-readonly">Standaard schema</span>
        <button class="btn btn-sm btn-primary" id="tp-make-override">Maak afwijkende week</button>`;
    }
  }

  const weekNav = c.mode === 'week' ? `
    <div class="tp-week-nav">
      <button id="tp-prev-week">◀</button>
      <span>${formatWeekLabel(c.isoWeek)}</span>
      <button id="tp-next-week">▶</button>
    </div>` : '';

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
          blocksHtml += `<div class="tp-block ${colorCls}${editable ? '' : ' readonly'}" title="${escHtml(tName)}" data-training-id="${t.id}" data-source="${c.mode === 'blueprint' ? 'default' : 'exception'}" style="left:${leftPct}%;width:${widthPct}%">${editable ? '<span class="tp-resize-left"></span>' : ''}<span class="tp-block-label">${escHtml(tName)}</span>${editable ? '<span class="tp-resize-right"></span>' : ''}</div>`;
        }

        for (const m of [...vMatches, ...unmatchedOnFirst]) {
          const startMin = m.start_minutes - HOUR_START * 60;
          const dur = m.end_minutes - m.start_minutes;
          if (startMin < 0 || startMin + dur > TOTAL_MINUTES) continue;
          const leftPct = (startMin / TOTAL_MINUTES) * 100;
          const widthPct = (dur / TOTAL_MINUTES) * 100;
          blocksHtml += `<div class="tp-block match" title="${m.label}" data-match-key="${escHtml(m.key)}" style="left:${leftPct}%;width:${widthPct}%"><span class="tp-block-label">${m.label}</span><span class="tp-resize-right"></span></div>`;
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
    daysHtml += `
      <div class="tp-day" data-dow="${dow}">
        <div class="tp-day-header">${dayLabel}${dz > 1 ? `<button class="tp-zoom-reset" data-dow="${dow}" style="margin-left:auto;border:none;background:none;cursor:pointer;font-size:0.7rem;color:var(--text-muted)">🔍 Reset zoom</button>` : ''}</div>
        <div class="tp-day-scroll">
          <div class="tp-day-content" style="min-width:${dz * 100}%">
            <div class="tp-time-header">${buildTimeHeader()}</div>
            ${venueRows}
          </div>
        </div>
      </div>`;
  }

  c.container.innerHTML = `
    <div class="tp-wrapper${isBlueprint ? ' tp-mode-blueprint' : ''}">
      <div class="tp-header">
        <h1>Trainingsplanner</h1>
        ${weekNav}
        <div class="tp-actions">${modeButtons}</div>
      </div>
      <div class="tp-venue-bar">${mgmtBarHtml}</div>
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

  el.querySelector('#tp-to-week')?.addEventListener('click', () => { c.mode = 'week'; loadAndRender(); });
  el.querySelector('#tp-to-blueprint')?.addEventListener('click', () => { c.mode = 'blueprint'; loadAndRender(); });

  el.querySelector('#tp-save-snapshot')?.addEventListener('click', () => showSaveSnapshotModal());
  el.querySelector('#tp-load-snapshot')?.addEventListener('click', () => showLoadSnapshotModal());
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

  const editable = c.mode === 'blueprint' || c.weekData?.isException;

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
        const endMin = startMin + DEFAULT_DURATION;
        showAddTrainingModal(venueId, dow, minutesToTime(startMin), minutesToTime(Math.min(endMin, HOUR_END * 60)));
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

  // Zoom on Ctrl+wheel, per day
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
      const newZoom = Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom + delta)) * 100) / 100;
      if (newZoom === oldZoom) return;
      _dayZoom[dow] = newZoom;

      const scrollRect = scrollEl.getBoundingClientRect();
      const labelWidth = 120;
      const mouseX = e.clientX - scrollRect.left;
      const oldContentWidth = scrollEl.scrollWidth;
      const posFrac = (scrollEl.scrollLeft + mouseX - labelWidth) / (oldContentWidth - labelWidth);

      contentEl.style.minWidth = `${newZoom * 100}%`;

      const resetBtn = dayEl.querySelector('.tp-zoom-reset');
      if (newZoom > 1 && !resetBtn) {
        const btn = document.createElement('button');
        btn.className = 'tp-zoom-reset';
        btn.dataset.dow = dow;
        btn.style.cssText = 'margin-left:auto;border:none;background:none;cursor:pointer;font-size:0.7rem;color:var(--text-muted)';
        btn.textContent = '🔍 Reset zoom';
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          delete _dayZoom[dow];
          contentEl.style.minWidth = '100%';
          scrollEl.scrollLeft = 0;
          btn.remove();
        });
        dayEl.querySelector('.tp-day-header').appendChild(btn);
      } else if (newZoom <= 1 && resetBtn) {
        resetBtn.remove();
        delete _dayZoom[dow];
      }

      requestAnimationFrame(() => {
        const newContentWidth = scrollEl.scrollWidth;
        const newScrollLeft = posFrac * (newContentWidth - labelWidth) - (mouseX - labelWidth);
        scrollEl.scrollLeft = Math.max(0, newScrollLeft);
      });
    }, { passive: false });
  });

  el.querySelectorAll('.tp-zoom-reset').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dow = parseInt(btn.dataset.dow, 10);
      delete _dayZoom[dow];
      const dayEl = btn.closest('.tp-day');
      const contentEl = dayEl.querySelector('.tp-day-content');
      const scrollEl = dayEl.querySelector('.tp-day-scroll');
      contentEl.style.minWidth = '100%';
      scrollEl.scrollLeft = 0;
      btn.remove();
    });
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
      <button class="btn btn-sm btn-secondary" id="tp-pop-del" style="color:var(--danger)">Verwijderen</button>
    </div>`;

  document.body.appendChild(pop);
  const bRect = block.getBoundingClientRect();
  pop.style.left = `${Math.min(bRect.left, window.innerWidth - 240)}px`;
  pop.style.top = `${bRect.bottom + 6}px`;

  pop.querySelector('#tp-pop-edit').addEventListener('click', () => { closePopover(); showEditTrainingModal(t, source); });
  pop.querySelector('#tp-pop-del').addEventListener('click', async () => {
    closePopover();
    if (!confirm('Training verwijderen?')) return;
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
    try {
      await api(endpoint, { method: 'PATCH', body });
      overlay.remove();
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });
}
