import { api, state, showToast } from '../app.js';
import { mountTrainingAiPromptsEditor } from '../training-ai-prompts-editor.js';
import { escHtml } from '../escape-html.js';

const DAY_NAMES = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];
const HOUR_START = 8;
const HOUR_END = 23;
/** Voorkeurseinde trainingen (visuele markering); harde grens blijft HOUR_END. */
const PREFERRED_END_ABS_MIN = 22 * 60 + 30;
const TOTAL_MINUTES = (HOUR_END - HOUR_START) * 60;
const SNAP = 15;
const DEFAULT_DURATION = 90;
const MATCH_DURATION = 120;

const _MO_KEY = 'tp_match_overrides';
let _matchOverrides = {};
try { _matchOverrides = JSON.parse(localStorage.getItem(_MO_KEY) || '{}'); } catch (_) {}
function _saveMatchOverrides() { localStorage.setItem(_MO_KEY, JSON.stringify(_matchOverrides)); }

function isTpSuperAdmin() {
  return !!state.user?.roles?.some((r) => r.role === 'super_admin');
}

const TEAM_COLORS = [
  '#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6',
  '#1abc9c','#e67e22','#2c3e50','#e84393','#00b894',
  '#6c5ce7','#fd79a8',
];

let _ctx = null;
let _activeSnapshotName = null;
let _teamOverviewOpen = false;
/** Zwevend paneel met niet-geplande teamslots — ingeklapt of uitgeklapt */
let _unplannedDockMinimized = false;
let _editMode = false;
/** Alleen velden + niet-beschikbaar intekenen; teams/wedstrijden verborgen */
let _inhuurMode = false;
/** In weekweergave: 'this_week' = iso_week meesturen, 'recurring' = elke week */
let _inhuurWeekScope = 'this_week';
/** Meerdere trainingsblokken (data-training-id) geselecteerd met Ctrl/Cmd — tegelijk horizontaal slepen */
const _selectedTrainingIds = new Set();
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

/** Blauwdruk: alleen met Bewerken aan. Week: alleen bij afwijkende week. (Los van mobiel / canEditTraining.) */
function tpPlannerScheduleEditable() {
  const c = _ctx;
  if (!c) return false;
  return (c.mode === 'blueprint' && _editMode) || !!c.weekData?.isException;
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

/** Zelfde normalisatie als server (YYYY-Www). */
function normalizeTpIsoWeek(input) {
  const s = String(input ?? '').trim();
  const m = s.match(/^(\d{4})[\-_][Ww]?(\d{1,2})$/);
  if (!m) return s;
  const w = parseInt(m[2], 10);
  if (w < 1 || w > 53) return s;
  return `${m[1]}-W${String(w).padStart(2, '0')}`;
}

/** ISO-jaar en weeknummer (1–53) voor een lokale kalenderdatum. */
function tpIsoWeekPartsFromDate(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow + 3);
  const isoYear = x.getFullYear();
  const jan4 = new Date(isoYear, 0, 4);
  const jan4d = (jan4.getDay() + 6) % 7;
  const w1Mon = new Date(isoYear, 0, 4 - jan4d);
  const week = Math.round((x - w1Mon) / 604800000) + 1;
  return { isoYear, week };
}

/** Hoogste ISO-weeknummer dat in dit ISO-jaar voorkomt (52 of 53). */
function tpMaxIsoWeekForIsoYear(isoYear) {
  let max = 1;
  for (let month = 0; month < 12; month++) {
    for (let day = 1; day <= 31; day++) {
      const dt = new Date(isoYear, month, day);
      if (dt.getMonth() !== month) break;
      const p = tpIsoWeekPartsFromDate(dt);
      if (p.isoYear === isoYear) max = Math.max(max, p.week);
    }
  }
  return Math.min(Math.max(max, 1), 53);
}

function tpIsoWeekString(isoYear, weekNum) {
  return `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
}

function tpDefaultGridYearForBlueprint(b) {
  const weeks = b.weeks || [];
  for (const w of weeks) {
    const m = String(w).match(/^(\d{4})-W/i);
    if (m) return parseInt(m[1], 10);
  }
  return new Date().getFullYear();
}

function tpYearSelectHtml(selectedY) {
  const cy = new Date().getFullYear();
  let opts = '';
  for (let y = cy - 2; y <= cy + 5; y++) {
    opts += `<option value="${y}"${y === selectedY ? ' selected' : ''}>${y}</option>`;
  }
  return opts;
}

/** Kalendergrid: één cel per ISO-week; ongeldige weken (buiten jaar) zijn uitgeschakeld. */
function tpWeekCalendarGridHtml(isoYear, bpWeeksList) {
  const maxW = tpMaxIsoWeekForIsoYear(isoYear);
  const set = new Set(bpWeeksList || []);
  const cells = [];
  for (let w = 1; w <= 53; w++) {
    const valid = w <= maxW;
    const iso = tpIsoWeekString(isoYear, w);
    const on = set.has(iso);
    const cls = `tp-bp-cal-week${on ? ' is-on' : ''}${!valid ? ' is-void' : ''}`;
    cells.push(
      `<button type="button" class="${cls}" data-iso-week="${attrSafe(iso)}"${valid ? '' : ' disabled tabindex="-1"'} aria-pressed="${on ? 'true' : 'false'}" title="${valid ? (on ? 'Gekoppeld — klik om te verwijderen' : 'Klik om te koppelen') : `Geen week ${w} in ${isoYear}`}">${w}</button>`
    );
  }
  return `<div class="tp-bp-cal-grid" role="group" aria-label="ISO-weken ${isoYear}">${cells.join('')}</div>`;
}

function tpOtherYearsWeeksHtml(weeks, gridYear, bpId) {
  const other = [...(weeks || [])]
    .filter((w) => !String(w).match(new RegExp(`^${gridYear}-W`, 'i')))
    .sort();
  if (!other.length) return '';
  const lis = other
    .map(
      (w) =>
        `<li class="tp-bp-week-item"><code>${escHtml(w)}</code> <button type="button" class="tp-btn tp-btn--ghost tp-btn--sm tp-bp-week-rem" data-iso-week="${attrSafe(w)}" title="Koppeling verwijderen">×</button></li>`
    )
    .join('');
  return `<div class="tp-bp-other-years" data-bp-id="${bpId}">
    <span class="tp-bp-other-label">Ook gekoppeld in andere jaren</span>
    <ul class="tp-bp-weeks-list">${lis}</ul>
  </div>`;
}

/** Werkt `weeks` op de blauwdruk in `_ctx` bij (zelfde objectreferenties als elders). */
function tpMutateBlueprintWeeks(bpId, iso, add) {
  const bp = _ctx.blueprints?.find((x) => x.id === bpId);
  if (!bp) return;
  const cur = [...(bp.weeks || [])];
  const isoStr = String(iso);
  if (add) {
    if (!cur.some((w) => String(w) === isoStr)) cur.push(isoStr);
    cur.sort();
    bp.weeks = cur;
  } else {
    bp.weeks = cur.filter((w) => String(w) !== isoStr);
  }
}

function tpApplyCalWeekButtonState(btn, linked) {
  btn.classList.toggle('is-on', linked);
  btn.setAttribute('aria-pressed', linked ? 'true' : 'false');
  const valid = !btn.disabled && !btn.classList.contains('is-void');
  btn.title = valid ? (linked ? 'Gekoppeld — klik om te verwijderen' : 'Klik om te koppelen') : btn.title;
}

function tpRefreshOtherYearsHost(schedEl, bpId) {
  const b = _ctx.blueprints?.find((x) => x.id === bpId);
  if (!b) return;
  const sel = schedEl.querySelector('.tp-bp-year-select');
  const y = parseInt(sel?.value, 10);
  const otherHost = schedEl.querySelector('.tp-bp-other-years-host');
  if (otherHost) otherHost.innerHTML = tpOtherYearsWeeksHtml(b.weeks || [], y, bpId) || '';
}

function timeIntervalsOverlapMin(a0, a1, b0, b1) {
  return a0 < b1 && b0 < a1;
}

/** Of een niet-beschikbaar-slot zichtbaar is in de huidige plannerweergave. */
function unavailabilityAppliesToView(slot, ctx) {
  const wk = slot.iso_week && String(slot.iso_week).trim();
  if (ctx.mode === 'blueprint') {
    return !wk;
  }
  if (!wk) return true;
  return normalizeTpIsoWeek(slot.iso_week) === normalizeTpIsoWeek(ctx.isoWeek);
}

function trainingOverlapsUnavailability(training, unavailSlots, dow, ctx) {
  const t0 = timeToMinutes(training.start_time);
  const t1 = timeToMinutes(training.end_time);
  for (const u of unavailSlots) {
    if (u.venue_id !== training.venue_id || u.day_of_week !== dow) continue;
    if (!unavailabilityAppliesToView(u, ctx)) continue;
    const u0 = timeToMinutes(u.start_time);
    const u1 = timeToMinutes(u.end_time);
    if (timeIntervalsOverlapMin(t0, t1, u0, u1)) return true;
  }
  return false;
}

function attrSafe(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Minuten vanaf HOUR_START binnen de track (0 … TOTAL_MINUTES), gesnapt op SNAP. */
function clientXToTrackRelativeMinutes(track, clientX) {
  const rect = track.getBoundingClientRect();
  const xPct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(xPct * TOTAL_MINUTES / SNAP) * SNAP;
}

function buildVenueUnavailabilityBody(venueId, dow, leftMinRel, durMinRel) {
  const startMinAbs = HOUR_START * 60 + leftMinRel;
  let endMinAbs = startMinAbs + durMinRel;
  const maxEnd = HOUR_END * 60;
  if (endMinAbs > maxEnd) endMinAbs = maxEnd;
  if (endMinAbs <= startMinAbs) return null;
  const body = {
    venue_id: venueId,
    day_of_week: dow,
    start_time: minutesToTime(startMinAbs),
    end_time: minutesToTime(endMinAbs),
    blueprint_id: _ctx.contextBlueprintId,
  };
  if (_ctx.mode === 'week' && _inhuurWeekScope === 'this_week') {
    body.iso_week = normalizeTpIsoWeek(_ctx.isoWeek);
  }
  return body;
}

async function postVenueUnavailability(venueId, dow, leftMinRel, durMinRel) {
  const body = buildVenueUnavailabilityBody(venueId, dow, leftMinRel, durMinRel);
  if (!body) return;
  await api('/api/training/venue-unavailability', { method: 'POST', body });
}

/** Alle veldrijen op dezelfde dag waarvan de verticale band [yLo,yHi] overlapt. */
function getVenueRowsInVerticalBand(dayEl, dow, yLo, yHi) {
  const lo = Math.min(yLo, yHi);
  const hi = Math.max(yLo, yHi);
  return [...dayEl.querySelectorAll('.tp-venue-row')].filter((row) => {
    if (parseInt(row.dataset.dow, 10) !== dow) return false;
    const rect = row.getBoundingClientRect();
    return rect.top < hi && rect.bottom > lo;
  });
}

async function commitInhuurUnavailabilityMulti(venueIds, dow, leftMinRel, durMinRel) {
  const unique = [...new Set(venueIds)].filter((id) => Number.isFinite(id));
  if (!unique.length) return;
  try {
    await Promise.all(unique.map((vid) => postVenueUnavailability(vid, dow, leftMinRel, durMinRel)));
    showToast(
      unique.length === 1
        ? 'Niet-beschikbaar toegevoegd'
        : `Niet-beschikbaar toegevoegd (${unique.length} velden)`,
      'success'
    );
    loadAndRender();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function findUnavailabilitySlotById(id) {
  const slots = _ctx?.venueUnavailability || [];
  return slots.find((s) => String(s.id) === String(id));
}

function handleInhuurPointerDown(e) {
  if (!_inhuurMode || e.button !== 0) return;
  if (!tpPlannerScheduleEditable()) return;
  const track = e.currentTarget;
  if (e.target.closest('.tp-unavail-block')) return;
  if (e.target.closest('.tp-resize-left') || e.target.closest('.tp-resize-right')) return;
  if (e.target.closest('.tp-block')) return;

  e.preventDefault();
  e.stopPropagation();
  try {
    track.setPointerCapture(e.pointerId);
  } catch (_) {}

  const row = track.closest('.tp-venue-row');
  const dayEl = track.closest('.tp-day');
  if (!dayEl) return;
  const dow = parseInt(row.dataset.dow, 10);
  const x0 = e.clientX;
  let yMin = e.clientY;
  let yMax = e.clientY;

  /** Referentietrack voor tijd↔X (alle rijen op de dag delen dezelfde schaal). */
  const refTrack = track;

  const previews = new Map();
  const minWpct = (SNAP / TOTAL_MINUTES) * 100;

  function updatePreview(clientX, clientY) {
    yMin = Math.min(yMin, clientY);
    yMax = Math.max(yMax, clientY);

    let a = clientXToTrackRelativeMinutes(refTrack, Math.min(x0, clientX));
    let b = clientXToTrackRelativeMinutes(refTrack, Math.max(x0, clientX));
    let widthRel = Math.max(SNAP, b - a);
    const leftPct = (a / TOTAL_MINUTES) * 100;
    const widthPct = (widthRel / TOTAL_MINUTES) * 100;

    const targetRows = getVenueRowsInVerticalBand(dayEl, dow, yMin, yMax);

    for (const r of [...previews.keys()]) {
      if (targetRows.includes(r)) continue;
      const el = previews.get(r);
      const t = r.querySelector('.tp-venue-track');
      t?.classList.remove('tp-inhuur-painting');
      el?.remove();
      previews.delete(r);
    }

    const startAbs = HOUR_START * 60 + a;
    const endAbs = startAbs + widthRel;
    const timeLabel = `${minutesToTime(startAbs)} – ${minutesToTime(endAbs)}`;
    const n = targetRows.length;
    const labelText = n > 1 ? `${timeLabel} · ${n} velden` : timeLabel;

    for (const r of targetRows) {
      const ttrack = r.querySelector('.tp-venue-track');
      if (!ttrack) continue;
      let pr = previews.get(r);
      if (!pr) {
        pr = document.createElement('div');
        pr.className = 'tp-unavail-paint-preview';
        pr.innerHTML = '<span class="tp-unavail-paint-preview-time"></span>';
        ttrack.appendChild(pr);
        previews.set(r, pr);
        ttrack.classList.add('tp-inhuur-painting');
      }
      pr.style.left = `${leftPct}%`;
      pr.style.width = `${Math.max(widthPct, minWpct)}%`;
      const tel = pr.querySelector('.tp-unavail-paint-preview-time');
      if (tel) tel.textContent = labelText;
    }
  }
  updatePreview(x0, e.clientY);

  const onMovePaint = (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    updatePreview(ev.clientX, ev.clientY);
  };

  const onUpPaint = async (ev) => {
    if (ev.pointerId !== e.pointerId) return;
    track.removeEventListener('pointermove', onMovePaint);
    track.removeEventListener('pointerup', onUpPaint);
    track.removeEventListener('pointercancel', onUpPaint);
    try {
      track.releasePointerCapture(e.pointerId);
    } catch (_) {}

    for (const r of [...previews.keys()]) {
      const el = previews.get(r);
      r.querySelector('.tp-venue-track')?.classList.remove('tp-inhuur-painting');
      el?.remove();
    }
    previews.clear();

    yMin = Math.min(yMin, ev.clientY);
    yMax = Math.max(yMax, ev.clientY);

    const endX = ev.clientX;
    const dragPx = Math.abs(endX - x0);
    let a = clientXToTrackRelativeMinutes(refTrack, Math.min(x0, endX));
    let b = clientXToTrackRelativeMinutes(refTrack, Math.max(x0, endX));
    let widthRel = b - a;

    if (dragPx < 10 && widthRel < SNAP) {
      let center = clientXToTrackRelativeMinutes(refTrack, x0);
      a = Math.round((center - SNAP / 2) / SNAP) * SNAP;
      widthRel = SNAP;
      if (a < 0) a = 0;
      if (a + widthRel > TOTAL_MINUTES) a = TOTAL_MINUTES - widthRel;
    } else {
      widthRel = Math.max(SNAP, Math.round(widthRel / SNAP) * SNAP);
      if (a + widthRel > TOTAL_MINUTES) widthRel = TOTAL_MINUTES - a;
    }

    const rows = getVenueRowsInVerticalBand(dayEl, dow, yMin, yMax);
    const venueIds = rows
      .map((r) => parseInt(r.dataset.venueId, 10))
      .filter((id) => Number.isFinite(id));

    if (!venueIds.length) return;

    await commitInhuurUnavailabilityMulti(venueIds, dow, a, widthRel);
  };

  track.addEventListener('pointermove', onMovePaint);
  track.addEventListener('pointerup', onUpPaint);
  track.addEventListener('pointercancel', onUpPaint);
}

function setupInhuurPainting(container) {
  container.querySelectorAll('.tp-venue-track').forEach((track) => {
    track.addEventListener('pointerdown', handleInhuurPointerDown);
  });
}

function setupUnavailInteractions(unavailEl) {
  const id = unavailEl.dataset.unavailId;
  if (!id) return;

  unavailEl.addEventListener('dblclick', async (ev) => {
    if (ev.target.classList.contains('tp-resize-left') || ev.target.classList.contains('tp-resize-right')) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!confirm('Dit niet-beschikbaar-slot verwijderen?')) return;
    try {
      const bp = _ctx.contextBlueprintId;
      const q = bp != null ? `?blueprint_id=${bp}` : '';
      await api(`/api/training/venue-unavailability/${id}${q}`, { method: 'DELETE' });
      showToast('Verwijderd', 'success');
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });

  function attachResize(handle, side) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pid = e.pointerId;
      handle.setPointerCapture(pid);
      const track = unavailEl.closest('.tp-venue-track');
      const trackW = track.offsetWidth;
      const origLeftPct = parseFloat(unavailEl.style.left);
      const origWidthPct = parseFloat(unavailEl.style.width);
      const startX = e.clientX;
      let moved = false;

      const onMove = (ev) => {
        if (ev.pointerId !== pid) return;
        moved = true;
        const dx = ev.clientX - startX;
        const dPct = (dx / trackW) * 100;
        if (side === 'left') {
          let newLeft = origLeftPct + dPct;
          let newWidth = origWidthPct - dPct;
          const minW = (SNAP / TOTAL_MINUTES) * 100;
          if (newWidth < minW) { newWidth = minW; newLeft = origLeftPct + origWidthPct - minW; }
          if (newLeft < 0) { newWidth += newLeft; newLeft = 0; }
          unavailEl.style.left = `${newLeft}%`;
          unavailEl.style.width = `${newWidth}%`;
        } else {
          let newWidth = origWidthPct + dPct;
          const minW = (SNAP / TOTAL_MINUTES) * 100;
          if (newWidth < minW) newWidth = minW;
          if (origLeftPct + newWidth > 100) newWidth = 100 - origLeftPct;
          unavailEl.style.width = `${newWidth}%`;
        }
      };

      const onUp = async (ev) => {
        if (ev.pointerId !== pid) return;
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        try { handle.releasePointerCapture(pid); } catch (_) {}
        if (!moved) return;

        const leftPct = parseFloat(unavailEl.style.left);
        const widthPct = parseFloat(unavailEl.style.width);
        const leftMin = Math.round(leftPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
        const durMin = Math.round(widthPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
        const startMinAbs = HOUR_START * 60 + leftMin;
        const endMinAbs = startMinAbs + durMin;
        try {
          await api(`/api/training/venue-unavailability/${id}`, {
            method: 'PATCH',
            body: { start_time: minutesToTime(startMinAbs), end_time: minutesToTime(endMinAbs) },
          });
          showToast('Tijd aangepast', 'success');
          loadAndRender();
        } catch (err) { showToast(err.message, 'error'); }
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  }

  attachResize(unavailEl.querySelector('.tp-resize-left'), 'left');
  attachResize(unavailEl.querySelector('.tp-resize-right'), 'right');

  unavailEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.classList.contains('tp-resize-left') || e.target.classList.contains('tp-resize-right')) return;
    e.preventDefault();
    e.stopPropagation();
    const pid = e.pointerId;
    const track = unavailEl.closest('.tp-venue-track');
    const trackRect = track.getBoundingClientRect();
    const grabOffsetX = e.clientX - trackRect.left - unavailEl.offsetLeft;
    const origWidthPct = parseFloat(unavailEl.style.width);
    let moved = false;
    unavailEl.classList.add('tp-unavail-dragging');
    try { unavailEl.setPointerCapture(pid); } catch (_) {}

    const onMove = (ev) => {
      if (ev.pointerId !== pid) return;
      moved = true;
      const tr = track.getBoundingClientRect();
      const trackW = track.offsetWidth;
      const localX = ev.clientX - tr.left - grabOffsetX;
      let leftMin = pxToMinutes(Math.max(0, Math.min(localX, trackW)), trackW);
      const widthMin = Math.round(origWidthPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
      if (leftMin + widthMin > TOTAL_MINUTES) leftMin = TOTAL_MINUTES - widthMin;
      unavailEl.style.left = `${(leftMin / TOTAL_MINUTES) * 100}%`;
      unavailEl.style.width = `${(widthMin / TOTAL_MINUTES) * 100}%`;
    };

    const onUp = async (ev) => {
      if (ev.pointerId !== pid) return;
      unavailEl.removeEventListener('pointermove', onMove);
      unavailEl.removeEventListener('pointerup', onUp);
      unavailEl.removeEventListener('pointercancel', onUp);
      try { unavailEl.releasePointerCapture(pid); } catch (_) {}
      unavailEl.classList.remove('tp-unavail-dragging');

      if (!moved) return;

      const leftPct = parseFloat(unavailEl.style.left);
      const widthPct = parseFloat(unavailEl.style.width);
      const leftMin = Math.round(leftPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
      const durMin = Math.round(widthPct / 100 * TOTAL_MINUTES / SNAP) * SNAP;
      const startMinAbs = HOUR_START * 60 + leftMin;
      const endMinAbs = startMinAbs + durMin;

      try {
        await api(`/api/training/venue-unavailability/${id}`, {
          method: 'PATCH',
          body: { start_time: minutesToTime(startMinAbs), end_time: minutesToTime(endMinAbs) },
        });
        showToast('Blok verplaatst', 'success');
        loadAndRender();
      } catch (err) { showToast(err.message, 'error'); }
    };

    unavailEl.addEventListener('pointermove', onMove);
    unavailEl.addEventListener('pointerup', onUp);
    unavailEl.addEventListener('pointercancel', onUp);
  });
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

/** Eén entry per ontbrekende training t.o.v. trainings_per_week (zelfde logica als teamoverzicht). */
function buildUnplannedSlots(trainings, teams) {
  const countByTeam = {};
  for (const t of trainings) {
    countByTeam[t.team_id] = (countByTeam[t.team_id] || 0) + 1;
  }
  const slots = [];
  for (const team of teams) {
    const need = team.trainings_per_week || 0;
    if (need === 0) continue;
    const have = countByTeam[team.id] || 0;
    const missing = need - have;
    for (let i = 0; i < missing; i++) {
      slots.push({ team_id: team.id, display_name: team.display_name });
    }
  }
  return slots;
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
    if (e.key === 'Escape' && _selectedTrainingIds.size && _ctx?.container) {
      clearTrainingBlockSelection();
      return;
    }
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
      venueUnavailability: [],
      canEditTraining: false,
      draftDiffersFromPublished: false,
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

  const weekOrDefaultsUrl = c.mode === 'blueprint' ? '/api/training/defaults' : `/api/training/week/${c.isoWeek}`;

  const [snapActive, bpData, weekData] = await Promise.all([
    api('/api/training/snapshots/active'),
    api('/api/training/blueprints').catch(() => ({ blueprints: [], active_blueprint_id: null })),
    api(weekOrDefaultsUrl),
  ]);

  c.blueprints = bpData.blueprints || [];
  c.activeBlueprintId = bpData.active_blueprint_id ?? null;

  let effectiveBpId =
    c.mode === 'week'
      ? weekData.effective_blueprint?.id ?? c.activeBlueprintId
      : c.activeBlueprintId;
  if (effectiveBpId == null) effectiveBpId = c.activeBlueprintId;

  const bpQ = effectiveBpId != null ? `?blueprint_id=${effectiveBpId}` : '';

  const [locData, venueData, unavData, teamData] = await Promise.all([
    api(`/api/training/locations${bpQ}`).catch(() => ({ locations: [] })),
    api(`/api/training/venues${bpQ}`).catch(() => ({ venues: [] })),
    api(`/api/training/venue-unavailability${bpQ}`).catch(() => ({ slots: [], can_edit: false })),
    api(`/api/training/teams${bpQ}`).catch(() => ({ teams: [] })),
  ]);

  c.locations = locData.locations || [];
  c.venues = venueData.venues || [];
  c.venueUnavailability = unavData.slots || [];
  if (teamData.teams && teamData.teams.length) {
    c.teams = teamData.teams;
    c.teamIds = teamData.teams.map(t => t.id);
  }
  c.effectiveBlueprintId = effectiveBpId;
  c.contextBlueprintId = effectiveBpId ?? c.activeBlueprintId;

  _activeSnapshotName = snapActive.active?.name || null;

  let trainings, isException = false, exceptionLabel = null;
  if (c.mode === 'blueprint') {
    trainings = weekData.defaults || [];
    c.draftDiffersFromPublished = !!weekData.draft_differs_from_published;
  } else {
    trainings = weekData.trainings || [];
    isException = weekData.is_exception;
    exceptionLabel = weekData.exception_label;
    c.draftDiffersFromPublished = false;
  }

  c.canEditTraining = !!weekData.can_edit;

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
  const weekBpId = c.mode === 'week' ? c.effectiveBlueprintId : c.activeBlueprintId;
  const weekBpName = (c.blueprints || []).find((b) => String(b.id) === String(weekBpId))?.name || '';
  const mobileReadOnly = isPlannerMobileViewport();
  const editable = !mobileReadOnly && tpPlannerScheduleEditable();
  const canUseInhuur = !mobileReadOnly && c.canEditTraining;
  const inhuurInteractive = canUseInhuur && _inhuurMode && editable;
  /** Segmented: teamrooster vs inhuur (zelfde gedrag als voorheen Inhuur-knop) */
  const workmodeSegmentHtml = canUseInhuur
    ? `<div class="tp-toolbar-group tp-toolbar-group--workmode" role="group" aria-label="Weergave op de tijdlijn">
        <span class="tp-toolbar-group__label">Weergave</span>
        <div class="tp-segmented" role="tablist">
          <button type="button" role="tab" class="tp-seg${_inhuurMode ? '' : ' tp-seg--active'}" id="tp-workmode-teams" aria-selected="${_inhuurMode ? 'false' : 'true'}" title="Trainingen per team op de velden">Teamrooster</button>
          <button type="button" role="tab" class="tp-seg${_inhuurMode ? ' tp-seg--active' : ''}" id="tp-workmode-inhuur" aria-selected="${_inhuurMode ? 'true' : 'false'}" title="Niet-beschikbare tijden intekenen per veld">Inhuur</button>
        </div>
      </div>`
    : '';

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
      const bpName = (c.blueprints || []).find((b) => String(b.id) === String(c.activeBlueprintId))?.name || 'Blauwdruk';
      const snapLabel = _activeSnapshotName
        ? `<span class="tp-snap-name">${escHtml(bpName)} · ${escHtml(_activeSnapshotName)}</span>`
        : `<span class="tp-snap-name">${escHtml(bpName)}</span>`;
      contextBar = `<div class="tp-context-bar tp-context-bar--mobile-readonly">
        <div class="tp-context-left">
          <span class="tp-mobile-readonly-hint" title="Gebruik een tablet of desktop om de planning te wijzigen">Alleen bekijken op mobiel</span>
          <span class="tp-ctx-sep"></span>
          ${snapLabel}
        </div>
      </div>`;
    } else {
      const bpOpts = (c.blueprints || []).map((b) => {
        const sel = String(b.id) === String(c.activeBlueprintId) ? ' selected' : '';
        return `<option value="${b.id}"${sel}>${escHtml(b.name)}</option>`;
      }).join('');
      const bpSelect = c.canEditTraining
        ? `<div class="tp-toolbar-group tp-toolbar-group--blueprint" role="group" aria-label="Actieve blauwdruk">
            <span class="tp-toolbar-group__label">Blauwdruk-set</span>
            <div class="tp-bp-controls">
              <select id="tp-blueprint-select" class="tp-bp-select" title="Locaties, velden en standaardrooster voor deze set">${bpOpts}</select>
              <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-new-blueprint" title="Nieuwe set: leeg of gekopieerd van huidige">Nieuwe set</button>
              <button type="button" class="tp-btn tp-btn--ghost tp-btn--sm" id="tp-manage-blueprints" title="Naam wijzigen of set verwijderen">Beheren…</button>
            </div>
          </div>`
        : `<div class="tp-toolbar-group tp-toolbar-group--readonly"><span class="tp-toolbar-group__label">Blauwdruk</span><span class="tp-bp-readonly">${escHtml((c.blueprints || []).find((b) => String(b.id) === String(c.activeBlueprintId))?.name || '—')}</span></div>`;
      const archiefStatus = _activeSnapshotName
        ? `<button type="button" class="tp-archief-chip tp-archief-chip--named" id="tp-rename-snapshot" title="Actief archief — klik om de naam te wijzigen"><span class="tp-archief-chip__k">Archief</span><span class="tp-archief-chip__v">${escHtml(_activeSnapshotName)}</span></button>`
        : '<span class="tp-archief-chip tp-archief-chip--empty" title="Nog geen rooster uit archief geactiveerd"><span class="tp-archief-chip__k">Archief</span><span class="tp-archief-chip__v">—</span></span>';
      const lockBtn = _editMode
        ? '<button type="button" class="tp-btn tp-btn--secondary tp-btn--sm tp-btn--edit-on" id="tp-toggle-edit" title="Schakel terug naar alleen bekijken">Bewerken aan</button>'
        : '<button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-toggle-edit" title="Blauwdruk en rooster kunnen wijzigen">Alleen bekijken</button>';
      const undoDisabled = _undoStack.length === 0 ? ' disabled' : '';
      const redoDisabled = _redoStack.length === 0 ? ' disabled' : '';
      let actionsRow = _editMode ? `
        <div class="tp-toolbar-group" role="group" aria-label="Stappen terugdraaien">
          <span class="tp-toolbar-group__label">Geschiedenis</span>
          <div class="tp-btn-row">
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-undo"${undoDisabled} title="Laatste wijziging ongedaan">Ongedaan</button>
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-redo"${redoDisabled} title="Ongedaan maken terugdraaien">Opnieuw</button>
          </div>
        </div>
        <div class="tp-toolbar-divider" aria-hidden="true"></div>
        <div class="tp-toolbar-group" role="group" aria-label="Rooster kopiëren">
          <span class="tp-toolbar-group__label">Rooster-archief</span>
          <div class="tp-btn-row">
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-save-snapshot" title="Huidige standaardtrainingen bewaren onder een naam">Bewaren</button>
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-load-snapshot" title="Eerder bewaard rooster terugzetten">Laden</button>
          </div>
        </div>
        <div class="tp-toolbar-divider" aria-hidden="true"></div>
        <div class="tp-toolbar-group tp-toolbar-group--ai" role="group" aria-label="AI-hulp">
          <span class="tp-toolbar-group__label">Assistent</span>
          <div class="tp-btn-row">
            <button type="button" class="tp-btn tp-btn--primary tp-btn--sm" id="tp-ai-optimize" title="Rooster voorstel via AI">AI-assistent</button>
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-auto-schedule" title="Lokaal rooster invullen (geen AI)">Automatisch</button>
            ${isTpSuperAdmin() ? '<button type="button" class="tp-btn tp-btn--ghost tp-btn--sm" id="tp-ai-prompts" title="Systeemprompts (opperbeheerder)">AI-prompts</button>' : ''}
          </div>
        </div>
        <div class="tp-toolbar-spacer" aria-hidden="true"></div>
        <div class="tp-toolbar-group tp-toolbar-group--danger" role="group" aria-label="Blauwdruk leegmaken">
          <button type="button" class="tp-btn tp-btn--danger-ghost tp-btn--sm" id="tp-clear-defaults" title="Alle standaardtrainingen in deze blauwdruk verwijderen">Alles wissen</button>
        </div>` : `
        <div class="tp-toolbar-group" role="group" aria-label="Rooster-archief">
          <span class="tp-toolbar-group__label">Rooster-archief</span>
          <div class="tp-btn-row">
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-save-snapshot" title="Huidige roosterstaat bewaren">Bewaren</button>
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-load-snapshot" title="Archief laden of activeren">Laden</button>
          </div>
        </div>`;
      if (_inhuurMode) {
        actionsRow = '';
      }
      const inhuurNotice = _inhuurMode
        ? editable
          ? '<p class="tp-toolbar__notice" role="status">Je ziet <strong>inhuur</strong>. Schakel naar <strong>Teamrooster</strong> om trainingen te verplaatsen.</p>'
          : '<p class="tp-toolbar__notice" role="status">Je ziet <strong>inhuur</strong> (alleen bekijken). Zet <strong>Bewerken aan</strong> om niet-beschikbare tijden te tekenen of te wijzigen. Schakel naar <strong>Teamrooster</strong> voor het teamrooster.</p>'
        : '';
      const draftBanner =
        c.canEditTraining && c.draftDiffersFromPublished
          ? `<div class="tp-draft-banner" role="region" aria-label="Concept rooster">
            <p class="tp-draft-banner__text"><strong>Concept.</strong> Dit wijkt af van wat teams nu zien. Publiceer om live te zetten, of verwerp om de gepubliceerde versie in je concept te laden.</p>
            <div class="tp-draft-banner__actions">
              <button type="button" class="tp-btn tp-btn--primary tp-btn--sm" id="tp-publish-defaults">Publiceren voor teams</button>
              <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-discard-draft">Concept verwerpen</button>
            </div>
          </div>`
          : '';
      const actionsRowClass = _inhuurMode ? ' tp-toolbar__row--hidden' : '';
      contextBar = `<div class="tp-toolbar tp-toolbar--blueprint" role="region" aria-label="Blauwdrukwerkbalk">
        <div class="tp-toolbar__row tp-toolbar__row--primary">
          ${workmodeSegmentHtml}
          ${workmodeSegmentHtml ? '<div class="tp-toolbar-divider" aria-hidden="true"></div>' : ''}
          <div class="tp-toolbar-group" role="group" aria-label="Bewerkmodus">
            <span class="tp-toolbar-group__label">Wijzigen</span>
            ${lockBtn}
          </div>
          <div class="tp-toolbar-divider" aria-hidden="true"></div>
          ${bpSelect}
          <div class="tp-toolbar-spacer" aria-hidden="true"></div>
          <div class="tp-toolbar-group tp-toolbar-group--archief-status" role="group" aria-label="Actief archief">
            <span class="tp-toolbar-group__label">Actief</span>
            ${archiefStatus}
          </div>
        </div>
        ${draftBanner}
        ${inhuurNotice}
        <div class="tp-toolbar__row tp-toolbar__row--secondary${actionsRowClass}">
          ${actionsRow}
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
        <button type="button" class="tp-btn tp-btn--danger-ghost tp-btn--sm" id="tp-del-override">Afwijking verwijderen</button>`;
    } else {
      weekStatus = `<span class="tp-badge tp-badge-readonly">Standaard schema</span>
        <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm" id="tp-make-override">Afwijkende week maken</button>`;
    }
    contextBar = `<div class="tp-toolbar tp-toolbar--week" role="region" aria-label="Weekwerkbalk">
      <div class="tp-toolbar__row tp-toolbar__row--primary">
        ${workmodeSegmentHtml}
        ${workmodeSegmentHtml ? '<div class="tp-toolbar-divider" aria-hidden="true"></div>' : ''}
        <div class="tp-toolbar-group tp-toolbar-group--weeknav" role="group" aria-label="Week">
          <span class="tp-toolbar-group__label">Week</span>
          <div class="tp-week-nav">
            <button type="button" id="tp-prev-week" aria-label="Vorige week">◀</button>
            <span>${formatWeekLabel(c.isoWeek)}</span>
            <button type="button" id="tp-next-week" aria-label="Volgende week">▶</button>
          </div>
        </div>
        ${weekBpName ? `<span class="tp-week-bp-hint" title="Voor deze week is dit het actieve schema (prioriteit / standaard of afwijkende set)">Blauwdruk: <strong>${escHtml(weekBpName)}</strong></span>` : ''}
        <div class="tp-toolbar-spacer" aria-hidden="true"></div>
        <div class="tp-toolbar-group tp-toolbar-group--week-status" role="group" aria-label="Deze week">${weekStatus}</div>
      </div>
      ${_inhuurMode && canUseInhuur && !editable ? '<p class="tp-toolbar__notice" role="status">Je ziet <strong>inhuur</strong> (alleen bekijken). Maak een <strong>afwijkende week</strong> om niet-beschikbare tijden te tekenen of te wijzigen.</p>' : ''}
    </div>`;
  }

  const inhuurScopeDisabled = c.mode === 'week' && !editable ? ' disabled' : '';
  const inhuurReadonlyHint =
    _inhuurMode && canUseInhuur && !editable
      ? c.mode === 'blueprint'
        ? '<p class="tp-inhuur-banner-sub text-small text-muted" role="status">Zet <strong>Bewerken aan</strong> in de werkbalk om hier te kunnen tekenen of blokken te wijzigen.</p>'
        : '<p class="tp-inhuur-banner-sub text-small text-muted" role="status">Maak een <strong>afwijkende week</strong> om hier te kunnen tekenen of blokken te wijzigen.</p>'
      : '';
  const inhuurBanner = _inhuurMode ? `<div class="tp-inhuur-banner" role="region" aria-label="Inhuurmodus">
    <p class="tp-inhuur-banner-text"><strong>Inhuurmodus.</strong>${editable ? ' Sleep op een leeg stuk tijdlijn om <em>niet-beschikbaar</em> te intekenen (tijden zie je tijdens het slepen). Sleep <strong>ook verticaal over meerdere velden</strong> om die velden in één keer dezelfde periode te blokkeren. Tik kort voor één kwartier op één veld. Bestaande blokken: <strong>verslepen</strong> op het midden, <strong>linker- en rechterrand</strong> voor de duur, <strong>dubbelklik</strong> verwijdert.' : ' Je bekijkt welke tijden als niet-beschikbaar zijn gemarkeerd. Zet bewerken aan (blauwdruk) of werk in een afwijkende week om te wijzigen.'}</p>
    ${inhuurReadonlyHint}
    ${c.mode === 'week' ? `<div class="tp-inhuur-scope">
      <span class="tp-inhuur-scope-label">Nieuwe blokken gelden:</span>
      <label class="tp-inhuur-radio"><input type="radio" name="tp-inhuur-scope" value="this_week"${_inhuurWeekScope === 'this_week' ? ' checked' : ''}${inhuurScopeDisabled} /> Alleen week ${escHtml(normalizeTpIsoWeek(c.isoWeek))}</label>
      <label class="tp-inhuur-radio"><input type="radio" name="tp-inhuur-scope" value="recurring"${_inhuurWeekScope === 'recurring' ? ' checked' : ''}${inhuurScopeDisabled} /> Elke week (zoals blauwdruk)</label>
    </div>` : '<p class="tp-inhuur-banner-sub text-small text-muted">In de blauwdruk gelden intekeningen voor elke week.</p>'}
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
        const unavForRow = (c.venueUnavailability || []).filter(
          (u) => u.venue_id === venue.id && u.day_of_week === dow && unavailabilityAppliesToView(u, c)
        );
        for (const u of unavForRow) {
          const uStart = timeToMinutes(u.start_time) - HOUR_START * 60;
          const uDur = timeToMinutes(u.end_time) - timeToMinutes(u.start_time);
          if (uStart + uDur <= 0 || uStart >= TOTAL_MINUTES) continue;
          const clipStart = Math.max(0, uStart);
          const clipEnd = Math.min(TOTAL_MINUTES, uStart + uDur);
          const leftPct = (clipStart / TOTAL_MINUTES) * 100;
          const widthPct = ((clipEnd - clipStart) / TOTAL_MINUTES) * 100;
          const unavTitle = u.note ? `Niet beschikbaar: ${u.note}` : 'Veld niet beschikbaar (geen huur)';
          const unavInter = inhuurInteractive ? ' tp-unavail-block--interactive' : '';
          const unavHint = inhuurInteractive ? `${unavTitle} — verslepen; linker/rechter rand voor duur; dubbelklik verwijdert` : unavTitle;
          const unavChrome = inhuurInteractive
            ? '<span class="tp-resize-left"></span><span class="tp-resize-right"></span>'
            : '';
          blocksHtml += `<div class="tp-unavail-block${unavInter}" data-unavail-id="${u.id}" title="${attrSafe(unavHint)}" style="left:${leftPct}%;width:${widthPct}%"${ inhuurInteractive ? '' : ' aria-hidden="true"'}>${unavChrome}</div>`;
        }
        for (const t of vTrainings) {
          const startMin = timeToMinutes(t.start_time) - HOUR_START * 60;
          const dur = timeToMinutes(t.end_time) - timeToMinutes(t.start_time);
          const leftPct = (startMin / TOTAL_MINUTES) * 100;
          const widthPct = (dur / TOTAL_MINUTES) * 100;
          const colorCls = teamColorClass(t.team_id);
          const tName = t.team_name || `Team ${t.team_id}`;
          const hasConflict = trainingOverlapsUnavailability(t, c.venueUnavailability || [], dow, c);
          const conflictCls = hasConflict ? ' tp-block-unavailable-conflict' : '';
          const titleBase = hasConflict ? `${tName} — conflict: training valt in niet-beschikbaar tijdslot` : tName;
          blocksHtml += `<div class="tp-block tp-schedule-block ${colorCls}${conflictCls}${editable ? '' : ' readonly'}" title="${attrSafe(titleBase)}" data-training-id="${t.id}" data-team-id="${t.team_id}" data-source="${c.mode === 'blueprint' ? 'default' : 'exception'}" style="left:${leftPct}%;width:${widthPct}%">${hasConflict ? '<span class="tp-conflict-badge" aria-hidden="true">!</span>' : ''}${editable ? '<span class="tp-resize-left"></span>' : ''}<span class="tp-block-label">${escHtml(tName)}</span>${editable ? '<span class="tp-resize-right"></span>' : ''}</div>`;
        }

        for (const m of [...vMatches, ...unmatchedOnFirst]) {
          const startMin = m.start_minutes - HOUR_START * 60;
          const dur = m.end_minutes - m.start_minutes;
          if (startMin < 0 || startMin + dur > TOTAL_MINUTES) continue;
          const leftPct = (startMin / TOTAL_MINUTES) * 100;
          const widthPct = (dur / TOTAL_MINUTES) * 100;
          blocksHtml += `<div class="tp-block tp-schedule-block match${editable ? '' : ' readonly'}" title="${m.label}" data-match-key="${escHtml(m.key)}" style="left:${leftPct}%;width:${widthPct}%"><span class="tp-block-label">${m.label}</span>${editable ? '<span class="tp-resize-right"></span>' : ''}</div>`;
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

  const unplannedSlots = editable ? buildUnplannedSlots(trainings, c.teams) : [];
  const hasUnplannedDock = editable && unplannedSlots.length > 0;
  let unplannedDockHtml = '';
  if (hasUnplannedDock) {
    if (_unplannedDockMinimized) {
      unplannedDockHtml = `
        <aside class="tp-unplanned-dock tp-unplanned-dock--minimized" id="tp-unplanned-dock" aria-label="Niet-geplande trainingen">
          <button type="button" class="tp-unplanned-expand" id="tp-unplanned-expand">
            <span>Niet gepland</span><span class="tp-unplanned-count">${unplannedSlots.length}</span>
            <span class="tp-unplanned-expand-icon" aria-hidden="true">▲</span>
          </button>
        </aside>`;
    } else {
      const chips = unplannedSlots.map((s, idx) => {
        const colorCls = teamColorClass(s.team_id);
        return `<button type="button" class="tp-unplanned-chip ${colorCls}" data-team-id="${s.team_id}" data-slot-idx="${idx}" title="Sleep naar een veld in het rooster">${escHtml(s.display_name)}</button>`;
      }).join('');
      unplannedDockHtml = `
        <aside class="tp-unplanned-dock" id="tp-unplanned-dock" aria-label="Niet-geplande trainingen">
          <div class="tp-unplanned-inner">
            <div class="tp-unplanned-head">
              <span class="tp-unplanned-title">Niet gepland — sleep naar het rooster</span>
              <span class="tp-unplanned-badge">${unplannedSlots.length}</span>
              <button type="button" class="tp-unplanned-minimize" id="tp-unplanned-minimize" aria-label="Paneel inklappen">▼</button>
            </div>
            <p class="tp-unplanned-hint">Ontbrekende trainingen t.o.v. het ingestelde aantal per week per team.</p>
            <div class="tp-unplanned-chips">${chips}</div>
          </div>
        </aside>`;
    }
  }

  c.container.innerHTML = `
    <div class="tp-wrapper${isBlueprint ? ' tp-mode-blueprint' : ''}${mobileReadOnly || (isBlueprint && !_editMode) ? ' tp-locked' : ''}${mobileReadOnly ? ' tp-mobile-readonly' : ''}${hasUnplannedDock ? ' tp-has-unplanned-dock' : ''}${_inhuurMode ? ' tp-inhuur-mode' : ''}${inhuurInteractive ? ' tp-inhuur-interactive' : ''}">
      <div class="tp-header">
        <h1>Trainingsplanner</h1>
        ${modeTabs}
      </div>
      ${inhuurBanner}
      ${contextBar}
      <div class="tp-panels">
        ${_inhuurMode ? `<details class="tp-panel tp-panel--locations">
          <summary>Locaties & velden</summary>
          <div class="tp-venue-bar">${mgmtBarHtml}</div>
        </details>` : ''}
        ${_inhuurMode ? '' : teamOverviewHtml}
      </div>
      ${daysHtml}
      ${unplannedDockHtml}
    </div>`;

  wireEvents();
  syncTrainingBlockSelectionClasses();

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
  if (PREFERRED_END_ABS_MIN > HOUR_START * 60 && PREFERRED_END_ABS_MIN < HOUR_END * 60) {
    const prefLeft = ((PREFERRED_END_ABS_MIN - HOUR_START * 60) / TOTAL_MINUTES) * 100;
    html += `<span class="tp-hour-line tp-preferred-end" style="left:${prefLeft}%" title="Voorkeur: voor 22:30 eindigen (uiterlijk ${HOUR_END}:00)"></span>`;
  }
  return html;
}

// ─── Events wiring ──────────────────────────────────────────────────────────

function wireEvents() {
  const c = _ctx;
  const el = c.container;

  el.querySelector('#tp-to-week')?.addEventListener('click', () => {
    if (c.mode !== 'week') {
      c.mode = 'week';
      _editMode = false;
      _undoStack.length = 0;
      _redoStack.length = 0;
      _inhuurMode = false;
      _selectedTrainingIds.clear();
      loadAndRender();
    }
  });
  el.querySelector('#tp-to-blueprint')?.addEventListener('click', () => {
    if (c.mode !== 'blueprint') {
      c.mode = 'blueprint';
      _inhuurMode = false;
      _selectedTrainingIds.clear();
      loadAndRender();
    }
  });

  el.querySelector('#tp-workmode-teams')?.addEventListener('click', () => {
    if (!_inhuurMode) return;
    _inhuurMode = false;
    renderPlanner();
  });
  el.querySelector('#tp-workmode-inhuur')?.addEventListener('click', () => {
    if (_inhuurMode) return;
    _inhuurMode = true;
    clearTrainingBlockSelection();
    if (c.mode === 'week') _inhuurWeekScope = 'this_week';
    renderPlanner();
  });

  const bpSel = el.querySelector('#tp-blueprint-select');
  if (bpSel) {
    bpSel.addEventListener('change', async (e) => {
      const id = e.target.value;
      if (!id || String(id) === String(c.activeBlueprintId)) return;
      try {
        await api(`/api/training/blueprints/${id}/activate`, { method: 'POST' });
        showToast('Blauwdruk geactiveerd', 'success');
        _undoStack.length = 0;
        _redoStack.length = 0;
        loadAndRender();
      } catch (err) {
        showToast(err.message, 'error');
        bpSel.value = String(c.activeBlueprintId ?? '');
      }
    });
  }
  el.querySelector('#tp-new-blueprint')?.addEventListener('click', () => showNewBlueprintModal());
  el.querySelector('#tp-manage-blueprints')?.addEventListener('click', () => showManageBlueprintsModal());

  el.querySelector('#tp-toggle-edit')?.addEventListener('click', () => { _editMode = !_editMode; renderPlanner(); });
  el.querySelector('#tp-undo')?.addEventListener('click', () => performUndo());
  el.querySelector('#tp-redo')?.addEventListener('click', () => performRedo());
  el.querySelector('#tp-save-snapshot')?.addEventListener('click', () => showSaveSnapshotModal());
  el.querySelector('#tp-load-snapshot')?.addEventListener('click', () => showLoadSnapshotModal());
  el.querySelector('#tp-ai-optimize')?.addEventListener('click', () => triggerAiOptimize());
  el.querySelector('#tp-auto-schedule')?.addEventListener('click', () => triggerAutoSchedule());
  el.querySelector('#tp-ai-prompts')?.addEventListener('click', () => openTrainingAiPromptsModal());
  el.querySelector('#tp-rename-snapshot')?.addEventListener('click', () => showRenameSnapshotModal());
  el.querySelector('#tp-clear-defaults')?.addEventListener('click', () => clearAllDefaults());
  el.querySelector('#tp-publish-defaults')?.addEventListener('click', async () => {
    try {
      await api('/api/training/defaults/publish', { method: 'POST', body: {} });
      showToast('Rooster gepubliceerd voor teams', 'success');
      _undoStack.length = 0;
      _redoStack.length = 0;
      loadAndRender();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
  el.querySelector('#tp-discard-draft')?.addEventListener('click', async () => {
    if (!confirm('Concept verwerpen? Ongepubliceerde wijzigingen gaan verloren; het concept wordt gelijk aan de live versie.')) return;
    try {
      await api('/api/training/defaults/discard-draft', { method: 'POST', body: {} });
      showToast('Concept teruggezet naar gepubliceerde versie', 'info');
      _undoStack.length = 0;
      _redoStack.length = 0;
      loadAndRender();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
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
        const bpQ = c.contextBlueprintId != null ? `?blueprint_id=${c.contextBlueprintId}` : '';
        await api(`/api/training/locations/${btn.dataset.id}${bpQ}`, { method: 'DELETE' });
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
        const bpQ = c.contextBlueprintId != null ? `?blueprint_id=${c.contextBlueprintId}` : '';
        await api(`/api/training/venues/${btn.dataset.id}${bpQ}`, { method: 'DELETE' });
        c.venues = c.venues.filter(v => String(v.id) !== btn.dataset.id);
        loadAndRender();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  const mobileReadOnly = isPlannerMobileViewport();
  const editable = !mobileReadOnly && tpPlannerScheduleEditable();
  const canUseInhuur = !mobileReadOnly && c.canEditTraining;

  if (editable && !_inhuurMode) {
    el.querySelectorAll('.tp-venue-track').forEach(track => {
      track.addEventListener('click', (e) => {
        if (e.target.closest('.tp-block')) return;
        clearTrainingBlockSelection();
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
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          toggleTrainingBlockSelection(block);
          return;
        }
        clearTrainingBlockSelection();
        showBlockPopover(block, e);
      });
      setupDrag(block);
      setupResize(block);
    });

    el.querySelectorAll('.tp-block.match').forEach(block => {
      setupMatchResize(block);
    });

    el.querySelector('#tp-unplanned-minimize')?.addEventListener('click', () => {
      _unplannedDockMinimized = true;
      renderPlanner();
    });
    el.querySelector('#tp-unplanned-expand')?.addEventListener('click', () => {
      _unplannedDockMinimized = false;
      renderPlanner();
    });
    el.querySelectorAll('.tp-unplanned-chip').forEach((chip) => setupUnplannedChipDrag(chip));
  }

  if (_inhuurMode && canUseInhuur) {
    if (editable) {
      setupInhuurPainting(el);
      el.querySelectorAll('input[name="tp-inhuur-scope"]').forEach((r) => {
        r.addEventListener('change', () => { _inhuurWeekScope = r.value; });
      });
    }
    el.querySelectorAll('.tp-unavail-block--interactive').forEach((ub) => setupUnavailInteractions(ub));
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

function clearTrainingBlockSelection() {
  _selectedTrainingIds.clear();
  const c = _ctx?.container;
  if (!c) return;
  c.querySelectorAll('.tp-block--selected').forEach((el) => el.classList.remove('tp-block--selected'));
}

function toggleTrainingBlockSelection(block) {
  const id = block?.dataset?.trainingId;
  if (!id) return;
  if (_selectedTrainingIds.has(id)) {
    _selectedTrainingIds.delete(id);
    block.classList.remove('tp-block--selected');
  } else {
    _selectedTrainingIds.add(id);
    block.classList.add('tp-block--selected');
  }
}

function syncTrainingBlockSelectionClasses() {
  const c = _ctx?.container;
  if (!c) return;
  c.querySelectorAll('.tp-block--selected').forEach((el) => el.classList.remove('tp-block--selected'));
  const stale = [];
  for (const id of _selectedTrainingIds) {
    const b = c.querySelector(`.tp-block[data-training-id="${id}"]`);
    if (b && !b.classList.contains('match') && !b.classList.contains('readonly')) {
      b.classList.add('tp-block--selected');
    } else {
      stale.push(id);
    }
  }
  stale.forEach((rid) => _selectedTrainingIds.delete(rid));
}

function setupDrag(block) {
  block.addEventListener('pointerdown', (e) => {
    if (e.target.classList.contains('tp-resize-left') || e.target.classList.contains('tp-resize-right')) return;
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();

    const selectedEls = [..._ctx.container.querySelectorAll('.tp-block--selected')].filter(
      (b) => b.dataset.trainingId && b.dataset.source && !b.classList.contains('match')
    );
    const isGroup = selectedEls.length >= 2 && selectedEls.includes(block);

    if (!isGroup) {
      clearTrainingBlockSelection();
    }

    if (isGroup) {
      const groupState = selectedEls.map((el) => {
        const row = el.closest('.tp-venue-row');
        const track = el.closest('.tp-venue-track');
        const trackW = track.offsetWidth;
        const initLeftMin = pxToMinutes(el.offsetLeft, trackW);
        const widthPct = parseFloat(el.style.width);
        const durMin = Math.round((widthPct / 100) * TOTAL_MINUTES / SNAP) * SNAP;
        return {
          el, row, track, initLeftMin, durMin, id: el.dataset.trainingId, source: el.dataset.source,
        };
      });
      const primary = groupState.find((s) => s.el === block);
      if (!primary) return;

      groupState.forEach((s) => s.el.classList.add('dragging'));
      _ctx.container.querySelectorAll('.tp-day').forEach((d) => d.classList.add('tp-dragging-active'));

      const grabOffsetX = e.clientX - primary.track.getBoundingClientRect().left - primary.el.offsetLeft;
      let moved = false;

      const onMove = (ev) => {
        moved = true;
        const tr = primary.track.getBoundingClientRect();
        const tw = primary.track.offsetWidth;
        const localX = ev.clientX - tr.left - grabOffsetX;
        const newPrimaryLeftMin = pxToMinutes(Math.max(0, Math.min(localX, tw)), tw);
        let delta = newPrimaryLeftMin - primary.initLeftMin;
        let minDelta = -Infinity;
        let maxDelta = Infinity;
        for (const s of groupState) {
          minDelta = Math.max(minDelta, -s.initLeftMin);
          maxDelta = Math.min(maxDelta, TOTAL_MINUTES - s.durMin - s.initLeftMin);
        }
        delta = Math.max(minDelta, Math.min(maxDelta, delta));

        for (const s of groupState) {
          const lm = s.initLeftMin + delta;
          s.el.style.left = `${(lm / TOTAL_MINUTES) * 100}%`;
        }
      };

      const onUp = async () => {
        groupState.forEach((s) => s.el.classList.remove('dragging'));
        _ctx.container.querySelectorAll('.tp-day').forEach((d) => d.classList.remove('tp-dragging-active'));
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (!moved) return;

        snapshotBeforeMutation();
        const updates = groupState.map((s) => {
          const trackW = s.track.offsetWidth;
          const leftMin = pxToMinutes(s.el.offsetLeft, trackW);
          const startMin = HOUR_START * 60 + leftMin;
          const endMin = startMin + s.durMin;
          const row = s.el.closest('.tp-venue-row');
          return {
            endpoint: s.source === 'default' ? `/api/training/defaults/${s.id}` : `/api/training/exceptions/${s.id}`,
            body: {
              venue_id: parseInt(row.dataset.venueId, 10),
              day_of_week: parseInt(row.dataset.dow, 10),
              start_time: minutesToTime(startMin),
              end_time: minutesToTime(Math.min(endMin, HOUR_END * 60)),
            },
          };
        });
        try {
          await Promise.all(updates.map((u) => api(u.endpoint, { method: 'PATCH', body: u.body })));
        } catch (err) {
          showToast(err.message, 'error');
        }
        loadAndRender();
      };

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      return;
    }

    block.classList.add('dragging');
    _ctx.container.querySelectorAll('.tp-day').forEach((d) => d.classList.add('tp-dragging-active'));

    const initTrack = block.closest('.tp-venue-track');
    const initTrackRect = initTrack.getBoundingClientRect();
    const grabOffsetX = e.clientX - initTrackRect.left - block.offsetLeft;
    let moved = false;

    const allRows = [..._ctx.container.querySelectorAll('.tp-venue-row')];

    const onMove = (ev) => {
      moved = true;

      const mouseY = ev.clientY;
      for (const row of allRows) {
        const r = row.getBoundingClientRect();
        if (mouseY >= r.top && mouseY <= r.bottom) {
          const targetTrack = row.querySelector('.tp-venue-track');
          if (targetTrack !== block.parentElement) targetTrack.appendChild(block);
          break;
        }
      }

      const currentTrack = block.closest('.tp-venue-track');
      const trackRect = currentTrack.getBoundingClientRect();
      const trackW = currentTrack.offsetWidth;
      const localX = ev.clientX - trackRect.left - grabOffsetX;
      const leftMin = pxToMinutes(Math.max(0, Math.min(localX, trackW)), trackW);
      block.style.left = `${(leftMin / TOTAL_MINUTES) * 100}%`;
    };

    const onUp = async () => {
      block.classList.remove('dragging');
      _ctx.container.querySelectorAll('.tp-day').forEach((d) => d.classList.remove('tp-dragging-active'));
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
      const durMin = Math.round((widthPct / 100) * TOTAL_MINUTES / SNAP) * SNAP;
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

/**
 * Sleep een virtuele teamslot vanuit het dock naar een veld; maakt default of exception aan (zelfde API als snel toevoegen).
 */
function setupUnplannedChipDrag(chip) {
  chip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const teamId = parseInt(chip.dataset.teamId, 10);
    const team = _ctx.teams.find((t) => t.id === teamId);
    if (!team) return;

    const durMin = team.max_training_minutes || DEFAULT_DURATION;
    const wPx = Math.min(380, Math.max(96, Math.round(durMin * 2.2)));

    const ghost = document.createElement('div');
    ghost.className = `tp-block ${teamColorClass(teamId)} tp-unplanned-ghost`;
    ghost.style.cssText = `position:fixed;width:${wPx}px;height:30px;z-index:300;pointer-events:none;opacity:0.95;left:0;top:0;`;
    ghost.innerHTML = `<span class="tp-block-label">${escHtml(team.display_name)}</span>`;
    document.body.appendChild(ghost);

    const placeGhost = (clientX, clientY) => {
      ghost.style.left = `${clientX - wPx / 2}px`;
      ghost.style.top = `${clientY - 15}px`;
    };
    placeGhost(e.clientX, e.clientY);

    _ctx.container.querySelectorAll('.tp-day').forEach((d) => d.classList.add('tp-dragging-active'));

    let moved = false;
    const onMove = (ev) => {
      moved = true;
      placeGhost(ev.clientX, ev.clientY);
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const track = el?.closest?.('.tp-venue-track');
      _ctx.container.querySelectorAll('.tp-venue-track').forEach((t) => t.classList.remove('tp-drop-hover'));
      if (track) track.classList.add('tp-drop-hover');
    };

    const cleanupHover = () => {
      _ctx.container.querySelectorAll('.tp-venue-track').forEach((t) => t.classList.remove('tp-drop-hover'));
    };

    const onUp = async (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      ghost.remove();
      _ctx.container.querySelectorAll('.tp-day').forEach((d) => d.classList.remove('tp-dragging-active'));
      cleanupHover();

      if (!moved) return;

      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const track = el?.closest?.('.tp-venue-track');
      if (!track) {
        showToast('Sleep naar een tijdbalk op een veld', 'info');
        return;
      }

      const row = track.closest('.tp-venue-row');
      if (!row) return;
      const venueId = parseInt(row.dataset.venueId, 10);
      const dow = parseInt(row.dataset.dow, 10);
      const rect = track.getBoundingClientRect();
      const xPct = (ev.clientX - rect.left) / rect.width;
      const rawMin = Math.round(xPct * TOTAL_MINUTES / SNAP) * SNAP;
      const startMin = HOUR_START * 60 + rawMin;
      const endMin = Math.min(startMin + durMin, HOUR_END * 60);

      snapshotBeforeMutation();
      try {
        const body = {
          team_id: teamId,
          venue_id: venueId,
          day_of_week: dow,
          start_time: minutesToTime(startMin),
          end_time: minutesToTime(endMin),
        };
        if (_ctx.mode === 'blueprint') {
          await api('/api/training/defaults', { method: 'POST', body: { ...body } });
        } else {
          await api('/api/training/exceptions', { method: 'POST', body: { ...body, iso_week: _ctx.isoWeek } });
        }
        showToast('Training toegevoegd', 'success');
        loadAndRender();
      } catch (err) {
        showToast(err.message, 'error');
      }
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
      clearTrainingBlockSelection();
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

  const bpId = _ctx.contextBlueprintId;
  const bpName = (_ctx.blueprints || []).find(b => String(b.id) === String(bpId))?.name || 'deze blauwdruk';
  const clubDef = team.trainings_per_week_club_default != null ? team.trainings_per_week_club_default : team.trainings_per_week;
  const hasBpOverride = !!team.has_blueprint_trainings_per_week_override;

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
    ${bpId != null ? `<p class="text-small text-muted" style="margin:-8px 0 12px;line-height:1.35">Trainingen per week geldt voor blauwdruk <strong>${escHtml(bpName)}</strong>. Clubstandaard: <strong>${clubDef}×</strong>${hasBpOverride ? ' (nu afgeweken)' : ''}.</p>` : ''}
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
    ${bpId != null && hasBpOverride ? `<p style="margin:12px 0 0"><button type="button" class="btn btn-sm btn-ghost tp-ts-reset-bp-freq">Clubstandaard voor deze blauwdruk (${clubDef}×)</button></p>` : ''}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-sm btn-secondary tp-ts-cancel">Annuleren</button>
      <button class="btn btn-sm btn-primary tp-ts-save">Opslaan</button>
    </div>
  </div>`;
  overlay.style.display = 'flex';

  overlay.querySelector('#tp-ts-min').value = team.min_training_minutes || 90;
  overlay.querySelector('#tp-ts-max').value = team.max_training_minutes || 90;

  overlay.querySelector('.tp-ts-cancel').onclick = () => { overlay.style.display = 'none'; };
  overlay.querySelector('.tp-ts-reset-bp-freq')?.addEventListener('click', async () => {
    if (!bpId) return;
    try {
      await api(`/api/training/teams/${teamId}`, {
        method: 'PATCH',
        body: { blueprint_id: bpId, use_club_default_trainings_per_week: true },
      });
      team.trainings_per_week = clubDef;
      team.has_blueprint_trainings_per_week_override = false;
      team.trainings_per_week_club_default = clubDef;
      overlay.style.display = 'none';
      showToast && showToast('Frequentie terug naar clubstandaard voor deze blauwdruk');
      loadAndRender();
    } catch (err) { showToast && showToast(err.message, 'error'); }
  });
  overlay.querySelector('.tp-ts-save').onclick = async () => {
    const freq = parseInt(overlay.querySelector('#tp-ts-freq').value, 10);
    const minM = parseInt(overlay.querySelector('#tp-ts-min').value, 10);
    const maxM = parseInt(overlay.querySelector('#tp-ts-max').value, 10);
    if (minM > maxM) { showToast && showToast('Minimum mag niet hoger zijn dan maximum', 'error'); return; }
    try {
      const body = { min_training_minutes: minM, max_training_minutes: maxM };
      if (bpId != null) {
        body.blueprint_id = bpId;
        body.trainings_per_week = freq;
      } else {
        body.trainings_per_week = freq;
      }
      await api(`/api/training/teams/${teamId}`, { method: 'PATCH', body });
      team.trainings_per_week = freq;
      team.min_training_minutes = minM;
      team.max_training_minutes = maxM;
      if (bpId != null) {
        team.has_blueprint_trainings_per_week_override = true;
        if (team.trainings_per_week_club_default == null) team.trainings_per_week_club_default = clubDef;
      }
      overlay.style.display = 'none';
      showToast && showToast(`${team.display_name} bijgewerkt`);
      loadAndRender();
    } catch (err) { showToast && showToast(err.message, 'error'); }
  };
}

// ─── Blueprint modals ───────────────────────────────────────────────────────

function showNewBlueprintModal() {
  const c = _ctx;
  if (!c.canEditTraining) return;
  let overlay = document.querySelector('.tp-modal-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'tp-modal-overlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = `<div class="tp-modal" style="max-width:420px">
    <h3 style="margin:0 0 12px">Nieuwe blauwdruk</h3>
    <p style="margin:0 0 10px;font-size:.85rem;color:var(--text-muted)">Per blauwdruk: eigen locaties en velden, eigen inhuur-slots en eigen teamrooster. Teams blijven voor de hele club hetzelfde.</p>
    <input id="tp-bp-new-name" class="form-control" placeholder="Naam, bijv. Zomeraccommodatie" style="margin-bottom:10px" />
    <fieldset style="border:none;margin:0 0 12px;padding:0">
      <legend class="tp-sr-only">Soort blauwdruk</legend>
      <div style="display:flex;flex-direction:column;gap:6px;font-size:.86rem">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;line-height:1.35">
          <input type="radio" name="tp-bp-new-kind" value="standard" checked style="margin-top:3px" />
          <span><strong>Basisrooster</strong> — geldt voor alle weken (tenzij een uitwijk wint op prioriteit).</span>
        </label>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;line-height:1.35">
          <input type="radio" name="tp-bp-new-kind" value="exceptional" style="margin-top:3px" />
          <span><strong>Uitwijkrooster</strong> — daarna kies je in <em>Beheren</em> per jaar de actieve ISO-weken.</span>
        </label>
      </div>
    </fieldset>
    <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:12px;font-size:.88rem;cursor:pointer;line-height:1.35">
      <input type="checkbox" id="tp-bp-copy" checked style="margin-top:3px" />
      <span>Kopieer locaties, velden, inhuur en rooster van de <strong>huidige</strong> blauwdruk</span>
    </label>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button type="button" class="btn btn-sm btn-secondary tp-bp-new-cancel">Annuleren</button>
      <button type="button" class="btn btn-sm btn-primary tp-bp-new-save">Aanmaken</button>
    </div>
  </div>`;
  overlay.style.display = 'flex';
  const nameInput = overlay.querySelector('#tp-bp-new-name');
  nameInput?.focus();
  overlay.querySelector('.tp-bp-new-cancel')?.addEventListener('click', () => { overlay.style.display = 'none'; });
  overlay.querySelector('.tp-bp-new-save')?.addEventListener('click', async () => {
    const name = nameInput?.value?.trim();
    if (!name) { nameInput?.focus(); return; }
    const copy = overlay.querySelector('#tp-bp-copy')?.checked;
    const kind = overlay.querySelector('input[name="tp-bp-new-kind"]:checked')?.value === 'exceptional' ? 'exceptional' : 'standard';
    const body = { name, activate: true, scope: kind };
    if (copy && c.activeBlueprintId) body.copy_from_blueprint_id = c.activeBlueprintId;
    try {
      await api('/api/training/blueprints', { method: 'POST', body });
      overlay.style.display = 'none';
      showToast(`Blauwdruk "${name}" is nu actief`, 'success');
      _undoStack.length = 0;
      _redoStack.length = 0;
      loadAndRender();
    } catch (err) { showToast(err.message, 'error'); }
  });
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') overlay.querySelector('.tp-bp-new-save')?.click();
  });
}

function showManageBlueprintsModal() {
  const c = _ctx;
  if (!c.canEditTraining) return;
  const bps = [...(c.blueprints || [])].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'nl', { sensitivity: 'base' })
  );
  const onlyOne = bps.length <= 1;
  const basisBps = bps.filter((b) => b.scope !== 'exceptional');
  const uitwijkBps = bps.filter((b) => b.scope === 'exceptional');
  const basisCount = basisBps.length;

  function rowDelMeta(b) {
    const active = String(b.id) === String(c.activeBlueprintId);
    const delDisabled = onlyOne || active;
    let delTitle = '';
    if (onlyOne) delTitle = 'Er moet minstens één blauwdruk blijven bestaan';
    else if (active) delTitle = 'Kies eerst een andere set in de kiezer boven het rooster; daarna kun je deze verwijderen';
    return { active, delDisabled, delTitle };
  }

  function renderBasisRow(b) {
    const { active, delDisabled, delTitle } = rowDelMeta(b);
    const prio = Number.isFinite(b.priority) ? b.priority : 0;
    const canToUitwijk = basisCount > 1;
    return `<li class="tp-bp-manage-row tp-bp-manage-row--basis" data-bp-id="${b.id}">
        <div class="tp-bp-manage-view">
          <div class="tp-bp-manage-namecol">
            <span class="tp-bp-badge-basis">Basisrooster</span>
            <span class="tp-bp-manage-name">${escHtml(b.name)}</span>
            ${active ? '<span class="tp-badge tp-badge-readonly tp-bp-manage-actief">In kiezer</span>' : ''}
            <span class="tp-bp-manage-meta">Prioriteit <strong>${prio}</strong> — geldt voor elke week waarin geen uitwijkrooster met hogere prioriteit wint.</span>
          </div>
          <div class="tp-bp-manage-actions">
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm tp-bp-manage-rename">Hernoemen</button>
            <button type="button" class="tp-btn tp-btn--danger-ghost tp-btn--sm tp-bp-manage-del"${delDisabled ? ' disabled' : ''} title="${attrSafe(delTitle)}">Verwijderen</button>
          </div>
        </div>
        <div class="tp-bp-manage-edit" hidden>
          <label class="tp-bp-manage-edit-label"><span class="tp-sr-only">Nieuwe naam</span><input type="text" class="form-control tp-bp-manage-input" value="${attrSafe(b.name)}" autocomplete="off" /></label>
          <div class="tp-bp-manage-edit-actions">
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm tp-bp-manage-cancel">Annuleren</button>
            <button type="button" class="tp-btn tp-btn--primary tp-btn--sm tp-bp-manage-save">Opslaan</button>
          </div>
        </div>
        <div class="tp-bp-manage-schedule" data-bp-id="${b.id}" data-row-kind="basis">
          <div class="tp-bp-manage-schedule-row">
            <label class="tp-bp-sched-label">Prioriteit</label>
            <input type="number" class="form-control tp-bp-priority-input" value="${prio}" title="Hoger dan een uitwijkrooster in dezelfde week = dit basisrooster wint alsnog" />
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm tp-bp-schedule-save">Prioriteit opslaan</button>
            <button type="button" class="tp-btn tp-btn--ghost tp-btn--sm tp-bp-to-uitwijk"${canToUitwijk ? '' : ' disabled'} title="${canToUitwijk ? '' : 'Er moet minstens één andere basis blijven'}">Maak uitwijkrooster…</button>
          </div>
        </div>
      </li>`;
  }

  function renderUitwijkRow(b) {
    const { delDisabled, delTitle } = rowDelMeta(b);
    const prio = Number.isFinite(b.priority) ? b.priority : 0;
    const gridY = tpDefaultGridYearForBlueprint(b);
    const weeks = [...(b.weeks || [])].sort();
    const otherHtml = tpOtherYearsWeeksHtml(weeks, gridY, b.id);
    return `<li class="tp-bp-manage-row tp-bp-manage-row--uitwijk" data-bp-id="${b.id}">
        <div class="tp-bp-manage-view">
          <div class="tp-bp-manage-namecol">
            <span class="tp-bp-badge-uitwijk">Uitwijkrooster</span>
            <span class="tp-bp-manage-name">${escHtml(b.name)}</span>
            <span class="tp-bp-manage-meta">Prioriteit <strong>${prio}</strong> — geldt automatisch in elke gekoppelde week; geen aparte &ldquo;activatie&rdquo; nodig.</span>
          </div>
          <div class="tp-bp-manage-actions">
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm tp-bp-manage-rename">Hernoemen</button>
            <button type="button" class="tp-btn tp-btn--danger-ghost tp-btn--sm tp-bp-manage-del"${delDisabled ? ' disabled' : ''} title="${attrSafe(delTitle)}">Verwijderen</button>
          </div>
        </div>
        <div class="tp-bp-manage-edit" hidden>
          <label class="tp-bp-manage-edit-label"><span class="tp-sr-only">Nieuwe naam</span><input type="text" class="form-control tp-bp-manage-input" value="${attrSafe(b.name)}" autocomplete="off" /></label>
          <div class="tp-bp-manage-edit-actions">
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm tp-bp-manage-cancel">Annuleren</button>
            <button type="button" class="tp-btn tp-btn--primary tp-btn--sm tp-bp-manage-save">Opslaan</button>
          </div>
        </div>
        <div class="tp-bp-manage-schedule" data-bp-id="${b.id}" data-row-kind="uitwijk">
          <div class="tp-bp-manage-schedule-row tp-bp-manage-schedule-row--uitwijk-head">
            <label class="tp-bp-sched-label">Prioriteit</label>
            <input type="number" class="form-control tp-bp-priority-input" value="${prio}" title="Hoger = wint bij meerdere roosters in dezelfde week" />
            <button type="button" class="tp-btn tp-btn--secondary tp-btn--sm tp-bp-schedule-save">Prioriteit opslaan</button>
            <button type="button" class="tp-btn tp-btn--ghost tp-btn--sm tp-bp-to-basis">Maak basisrooster…</button>
          </div>
          <div class="tp-bp-cal-panel">
            <div class="tp-bp-cal-head">
              <label class="tp-bp-cal-year-label">Jaar
                <select class="form-control tp-bp-year-select" aria-label="Jaar voor weekkeuze">${tpYearSelectHtml(gridY)}</select>
              </label>
              <div class="tp-bp-cal-legend" aria-hidden="true">
                <span class="tp-bp-leg"><span class="tp-bp-leg-swatch is-on"></span> gekoppeld</span>
                <span class="tp-bp-leg"><span class="tp-bp-leg-swatch"></span> niet gekoppeld</span>
                <span class="tp-bp-leg"><span class="tp-bp-leg-swatch is-void"></span> —</span>
              </div>
            </div>
            <p class="tp-bp-cal-tip">Klik weken aan of uit. Nummers zijn <strong>ISO-weken</strong> (week 1 bevat 4 januari).</p>
            <div class="tp-bp-cal-grid-host">${tpWeekCalendarGridHtml(gridY, weeks)}</div>
            <div class="tp-bp-other-years-host">${otherHtml}</div>
          </div>
        </div>
      </li>`;
  }

  const basisHtml = basisBps.map(renderBasisRow).join('');
  const uitwijkHtml = uitwijkBps.map(renderUitwijkRow).join('');

  let overlay = document.querySelector('.tp-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'tp-modal-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `<div class="tp-modal tp-modal--bp-manage">
    <h3 class="tp-bp-modal-title">Blauwdrukken beheren</h3>
    <p class="tp-bp-manage-intro">Je club heeft één <strong>basisrooster</strong> (of meerdere basissets met eigen prioriteit) dat voor alle weken geldt, tenzij een <strong>uitwijkrooster</strong> met hogere prioriteit voor die week van toepassing is. <strong>Uitwijkroosters</strong> hoef je niet apart te activeren: ze gelden impliciet in elke ISO-week die je hieronder koppelt.</p>
    <div class="tp-bp-manage-scroll">
      <section class="tp-bp-sec tp-bp-sec--basis" aria-labelledby="tp-bp-sec-basis-title">
        <header class="tp-bp-sec-head">
          <span class="tp-bp-sec-icon" aria-hidden="true">◉</span>
          <div>
            <h4 id="tp-bp-sec-basis-title" class="tp-bp-sec-title">Basisrooster</h4>
            <p class="tp-bp-sec-desc">Standaard schema door het jaar heen. Geen weekkeuze nodig.</p>
          </div>
        </header>
        <ul class="tp-bp-manage-list tp-bp-manage-list--basis">${basisHtml || '<li class="tp-bp-empty-sec">Geen basisrooster — voeg een blauwdruk toe of zet een uitwijk om tot basis.</li>'}</ul>
      </section>
      <section class="tp-bp-sec tp-bp-sec--uitwijk" aria-labelledby="tp-bp-sec-uitwijk-title">
        <header class="tp-bp-sec-head">
          <span class="tp-bp-sec-icon tp-bp-sec-icon--uitwijk" aria-hidden="true">◇</span>
          <div>
            <h4 id="tp-bp-sec-uitwijk-title" class="tp-bp-sec-title">Uitwijkroosters</h4>
            <p class="tp-bp-sec-desc">Nul, één of meer alternatieve schema’s. Kies per jaar welke ISO-weken dit rooster geldt — dat is voldoende; geen aparte activatie.</p>
          </div>
        </header>
        <ul class="tp-bp-manage-list tp-bp-manage-list--uitwijk">${uitwijkHtml || '<li class="tp-bp-empty-sec">Nog geen uitwijkroosters. Maak een nieuwe blauwdruk als uitwijk of zet een basisrooster om.</li>'}</ul>
      </section>
    </div>
    <p class="tp-bp-manage-footnote">Verwijderen wist locaties, velden, inhuur en rooster voor die set. De set die in de <strong>blauwdruk-kiezer</strong> staat, kun je niet verwijderen. Minstens één basisrooster moet blijven bestaan.</p>
    <div class="tp-bp-manage-footer">
      <button type="button" class="btn btn-sm btn-secondary tp-bp-manage-close">Sluiten</button>
    </div>
  </div>`;
  overlay.style.display = 'flex';

  function closeAllEdits() {
    overlay.querySelectorAll('.tp-bp-manage-row').forEach((row) => {
      row.querySelector('.tp-bp-manage-view')?.removeAttribute('hidden');
      row.querySelector('.tp-bp-manage-edit')?.setAttribute('hidden', '');
    });
  }

  function refreshUitwijkGrid(schedEl, bpId, yearOverride) {
    const b = bps.find((x) => x.id === bpId);
    if (!b) return;
    const sel = schedEl.querySelector('.tp-bp-year-select');
    const y = yearOverride != null ? yearOverride : parseInt(sel?.value, 10);
    const gridHost = schedEl.querySelector('.tp-bp-cal-grid-host');
    const otherHost = schedEl.querySelector('.tp-bp-other-years-host');
    if (gridHost) gridHost.innerHTML = tpWeekCalendarGridHtml(y, b.weeks || []);
    if (otherHost) otherHost.innerHTML = tpOtherYearsWeeksHtml(b.weeks || [], y, bpId) || '';
  }

  overlay.querySelector('.tp-bp-manage-close')?.addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

  const scrollEl = overlay.querySelector('.tp-bp-manage-scroll');
  scrollEl?.addEventListener('click', async (e) => {
    if (e.target.closest('.tp-bp-schedule-save')) return;

    const renameBtn = e.target.closest('.tp-bp-manage-rename');
    const delBtn = e.target.closest('.tp-bp-manage-del');
    const cancelBtn = e.target.closest('.tp-bp-manage-cancel');
    const saveBtn = e.target.closest('.tp-bp-manage-save');
    const toUitwijk = e.target.closest('.tp-bp-to-uitwijk');
    const toBasis = e.target.closest('.tp-bp-to-basis');
    const weekBtn = e.target.closest('.tp-bp-cal-week');
    const weekRem = e.target.closest('.tp-bp-week-rem');

    const row = e.target.closest('.tp-bp-manage-row');
    const block = e.target.closest('.tp-bp-manage-schedule');

    if (weekBtn && weekBtn.closest('.tp-bp-manage-row--uitwijk')) {
      if (weekBtn.disabled || weekBtn.classList.contains('is-void')) return;
      const sched = weekBtn.closest('.tp-bp-manage-schedule');
      const id = parseInt(sched?.dataset.bpId, 10);
      const iso = weekBtn.dataset.isoWeek;
      if (!id || !iso) return;
      const isOn = weekBtn.classList.contains('is-on');
      try {
        if (isOn) {
          await api(`/api/training/blueprints/${id}/weeks?iso_week=${encodeURIComponent(iso)}`, { method: 'DELETE' });
        } else {
          await api(`/api/training/blueprints/${id}/weeks`, { method: 'POST', body: { iso_week: iso } });
        }
        tpMutateBlueprintWeeks(id, iso, !isOn);
        tpApplyCalWeekButtonState(weekBtn, !isOn);
        tpRefreshOtherYearsHost(sched, id);
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    if (weekRem && weekRem.closest('.tp-bp-other-years')) {
      const wrap = weekRem.closest('.tp-bp-other-years');
      const sched = wrap?.closest('.tp-bp-manage-schedule');
      const id = parseInt(wrap?.dataset.bpId, 10);
      const iso = weekRem.dataset.isoWeek;
      if (!id || !iso) return;
      try {
        await api(`/api/training/blueprints/${id}/weeks?iso_week=${encodeURIComponent(iso)}`, { method: 'DELETE' });
        tpMutateBlueprintWeeks(id, iso, false);
        if (sched) tpRefreshOtherYearsHost(sched, id);
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    if (toUitwijk && block?.dataset.rowKind === 'basis') {
      const id = parseInt(block.dataset.bpId, 10);
      if (!id || toUitwijk.disabled) return;
      if (
        !confirm(
          'Dit rooster omzetten naar een uitwijkrooster?\n\nHet geldt daarna alleen nog in weken die je in de kalender kiest. Koppel minstens één week om het te laten gelden.'
        )
      ) {
        return;
      }
      try {
        await api(`/api/training/blueprints/${id}`, { method: 'PATCH', body: { scope: 'exceptional' } });
        showToast('Omgezet naar uitwijkrooster — kies nu weken', 'success');
        _undoStack.length = 0;
        _redoStack.length = 0;
        await loadAndRender();
        showManageBlueprintsModal();
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    if (toBasis && block?.dataset.rowKind === 'uitwijk') {
      const id = parseInt(block.dataset.bpId, 10);
      if (!id) return;
      if (
        !confirm(
          'Dit rooster omzetten naar een basisrooster?\n\nHet geldt daarna weer voor alle weken (tenzij een uitwijk met hogere prioriteit wint).'
        )
      ) {
        return;
      }
      try {
        await api(`/api/training/blueprints/${id}`, { method: 'PATCH', body: { scope: 'standard' } });
        showToast('Omgezet naar basisrooster', 'success');
        _undoStack.length = 0;
        _redoStack.length = 0;
        await loadAndRender();
        showManageBlueprintsModal();
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    if (!row) return;
    const id = parseInt(row.dataset.bpId, 10);
    if (!id) return;

    if (renameBtn) {
      closeAllEdits();
      row.querySelector('.tp-bp-manage-view')?.setAttribute('hidden', '');
      row.querySelector('.tp-bp-manage-edit')?.removeAttribute('hidden');
      const inp = row.querySelector('.tp-bp-manage-input');
      inp?.focus();
      inp?.select();
      return;
    }

    if (cancelBtn) {
      const b = bps.find((x) => x.id === id);
      const inp = row.querySelector('.tp-bp-manage-input');
      if (inp && b) inp.value = b.name;
      row.querySelector('.tp-bp-manage-view')?.removeAttribute('hidden');
      row.querySelector('.tp-bp-manage-edit')?.setAttribute('hidden', '');
      return;
    }

    if (saveBtn) {
      const inp = row.querySelector('.tp-bp-manage-input');
      const name = inp?.value?.trim();
      if (!name) {
        inp?.focus();
        return;
      }
      try {
        await api(`/api/training/blueprints/${id}`, { method: 'PATCH', body: { name } });
        overlay.style.display = 'none';
        showToast('Naam bijgewerkt', 'success');
        _undoStack.length = 0;
        _redoStack.length = 0;
        loadAndRender();
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    if (delBtn) {
      if (delBtn.disabled) return;
      const b = bps.find((x) => x.id === id);
      const nm = b?.name || 'deze set';
      if (
        !confirm(
          `Blauwdruk "${nm}" verwijderen?\n\nAlle locaties, velden, inhuur, standaardtrainingen en opgeslagen rooster-archieven voor deze set worden permanent gewist. Dit kan niet ongedaan worden gemaakt.`
        )
      ) {
        return;
      }
      try {
        await api(`/api/training/blueprints/${id}`, { method: 'DELETE' });
        overlay.style.display = 'none';
        showToast('Blauwdruk verwijderd', 'success');
        _undoStack.length = 0;
        _redoStack.length = 0;
        loadAndRender();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  });

  scrollEl?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const inp = e.target.closest('.tp-bp-manage-input');
    if (!inp) return;
    e.preventDefault();
    inp.closest('.tp-bp-manage-row')?.querySelector('.tp-bp-manage-save')?.click();
  });

  const modalEl = overlay.querySelector('.tp-modal--bp-manage');

  modalEl?.addEventListener('click', async (e) => {
    const schedSave = e.target.closest('.tp-bp-schedule-save');
    const block = e.target.closest('.tp-bp-manage-schedule');
    if (!schedSave || !block) return;
    const id = parseInt(block.dataset.bpId, 10);
    const kind = block.dataset.rowKind;
    if (!id) return;
    const pr = parseInt(block.querySelector('.tp-bp-priority-input')?.value, 10);
    const priority = Number.isNaN(pr) ? 0 : pr;
    const scope = kind === 'uitwijk' ? 'exceptional' : 'standard';
    try {
      await api(`/api/training/blueprints/${id}`, { method: 'PATCH', body: { scope, priority } });
      showToast('Prioriteit opgeslagen', 'success');
      _undoStack.length = 0;
      _redoStack.length = 0;
      await loadAndRender();
      showManageBlueprintsModal();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  modalEl?.addEventListener('change', (e) => {
    const sel = e.target.closest('.tp-bp-year-select');
    if (!sel) return;
    const sched = sel.closest('.tp-bp-manage-schedule');
    const id = parseInt(sched?.dataset.bpId, 10);
    if (!sched || !id) return;
    const y = parseInt(sel.value, 10);
    refreshUitwijkGrid(sched, id, y);
  });
}

// ─── Snapshot modals ────────────────────────────────────────────────────────

function showSaveSnapshotModal() {
  let overlay = document.querySelector('.tp-modal-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'tp-modal-overlay'; document.body.appendChild(overlay); }
  overlay.innerHTML = `<div class="tp-modal">
    <h3 style="margin:0 0 12px">Blauwdruk opslaan als</h3>
    <p style="margin:0 0 10px;font-size:.85rem;color:var(--text-muted)">Sla het <strong>standaard teamrooster</strong> van de <strong>actieve blauwdruk</strong> op als archief (los van andere blauwdrukken). Later kun je dit rooster weer activeren binnen deze blauwdruk.</p>
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
    <p style="margin:0 0 10px;font-size:.85rem;color:var(--text-muted)">Alleen archieven van de <strong>huidige blauwdruk</strong>. Activeren vervangt het standaardrooster van deze blauwdruk (locaties en velden wijzigen niet).</p>
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
    await api(`/api/training/defaults/all`, { method: 'DELETE' });
    showToast && showToast('Blauwdruk leeggemaakt');
    loadAndRender();
  } catch (err) { showToast && showToast('Leegmaken mislukt: ' + err.message, 'error'); }
}

// ─── Rename active snapshot ─────────────────────────────────────────────────

async function showRenameSnapshotModal() {
  let snapRes;
  try { snapRes = await api('/api/training/snapshots/active'); } catch (_) { return; }
  const activeSnap = snapRes?.active;
  if (!activeSnap?.id) { showToast && showToast('Geen actief archief om te hernoemen', 'error'); return; }

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

async function openTrainingAiPromptsModal(initialMode) {
  if (!isTpSuperAdmin()) {
    showToast('Alleen opperbeheerders kunnen systeemprompts wijzigen.', 'error');
    return;
  }
  let overlay = document.querySelector('.tp-prompts-modal-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'tp-modal-overlay tp-prompts-modal-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = `
    <div class="tp-modal tp-ai-modal tp-prompts-editor-modal">
      <div class="tp-prompts-modal-head" style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;padding:16px 20px 12px;border-bottom:1px solid var(--border-color,#e5e7eb)">
        <div>
          <h3 style="margin:0;font-size:1.05rem;font-weight:700">AI-prompts bewerken</h3>
          <p class="text-muted text-small" style="margin:0.35rem 0 0;line-height:1.35">Zelfde editor als onder Beheer → opperbeheerder. Opslaan schrijft naar de server (live bestand op productie).</p>
        </div>
        <button type="button" class="btn btn-sm btn-secondary tp-prompts-close" aria-label="Sluiten">✕</button>
      </div>
      <div id="tp-prompts-editor-root" class="tp-prompts-editor-scroll"></div>
      <div class="tp-ai-footer" style="border-top:1px solid var(--border-color,#e5e7eb);padding:12px 20px 16px">
        <button type="button" class="btn btn-sm btn-primary tp-prompts-close">Sluiten</button>
      </div>
    </div>`;
  overlay.style.display = 'flex';
  const close = () => { overlay.style.display = 'none'; };
  overlay.querySelectorAll('.tp-prompts-close').forEach((b) => b.addEventListener('click', close));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const root = overlay.querySelector('#tp-prompts-editor-root');
  const mode = ['new', 'complete', 'optimize'].includes(initialMode) ? initialMode : 'complete';
  await mountTrainingAiPromptsEditor(root, { variant: 'modal', initialMode: mode });
}

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
      <label class="tp-ai-multistep" style="display:flex;align-items:flex-start;gap:0.5rem;margin:0.75rem 0 0;font-size:0.88rem;cursor:pointer">
        <input type="checkbox" id="tp-ai-pipeline-multi" style="margin-top:0.2rem" />
        <span><strong>Mini-LLM (2 stappen)</strong> — eerst een compact dagplan, daarna het volledige rooster. Zelfde N8N-webhook; langzamer (ca. 2–4 min), kan helpen bij complexe clubs.</span>
      </label>
      <label for="tp-ai-message">Extra opdracht <span class="tp-ai-optional">optioneel</span></label>
      <textarea id="tp-ai-message" rows="2" placeholder="Bijv. 'Focus op coach-dubbelrollen' of 'Plan N5 op dinsdag en donderdag'"></textarea>
      <div id="tp-ai-status" class="tp-ai-status">Verbinding controleren...</div>
      ${isTpSuperAdmin() ? `<p class="tp-ai-prompts-hint text-small text-muted" style="margin:0.75rem 0 0">
        <button type="button" class="btn btn-ghost btn-sm tp-ai-open-prompts" style="padding:0.2rem 0.5rem;font-size:0.8rem">📝 Systeemprompts bewerken</button>
        <span style="opacity:0.85"> — opperbeheerder</span>
      </p>` : ''}
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
  overlay.querySelector('.tp-ai-open-prompts')?.addEventListener('click', () => {
    const m = overlay.querySelector('input[name="tp-ai-mode"]:checked')?.value || 'complete';
    overlay.style.display = 'none';
    openTrainingAiPromptsModal(m);
  });

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
    overlay.querySelector('#tp-ai-pipeline-multi') && (overlay.querySelector('#tp-ai-pipeline-multi').disabled = true);
    const selectedMode = overlay.querySelector('input[name="tp-ai-mode"]:checked')?.value || 'complete';
    const useMultiPipeline = !!overlay.querySelector('#tp-ai-pipeline-multi')?.checked;
    const modeLabels = { new: 'maakt een nieuwe planning', complete: 'vult de planning aan', optimize: 'optimaliseert de planning' };
    const durationHint = useMultiPipeline ? '2–4 min' : '1–2 min';
    statusEl.innerHTML = `<span class="tp-ai-status-loading"><span class="tp-spinner"></span> AI agent ${modeLabels[selectedMode]}${useMultiPipeline ? ' (2-stappen pipeline)' : ''}... dit kan ${durationHint} duren</span>`;

    snapshotBeforeMutation();
    try {
      const body = { mode: selectedMode, message: msgInput.value.trim() };
      if (useMultiPipeline) body.pipeline = 'multi';
      const result = await api('/api/training/ai-optimize', { method: 'POST', body });

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
      const multiCb = overlay.querySelector('#tp-ai-pipeline-multi');
      if (multiCb) multiCb.disabled = false;
      startBtn.textContent = 'Opnieuw proberen';
    }
  };
}

async function triggerAutoSchedule() {
  let overlay = document.querySelector('.tp-auto-schedule-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'tp-modal-overlay tp-auto-schedule-overlay';
    document.body.appendChild(overlay);
  }
  const defaultIso = _ctx.mode === 'week' ? normalizeTpIsoWeek(_ctx.isoWeek) : '';
  overlay.innerHTML = `<div class="tp-modal tp-ai-modal tp-auto-schedule-modal">
    <div class="tp-ai-header">
      <div class="tp-ai-icon" aria-hidden="true">⚙</div>
      <div>
        <h3>Automatisch rooster</h3>
        <p>Lokaal invullen op basis van velden, blokkades en teamregels (geen AI).</p>
      </div>
    </div>
    <div class="tp-ai-body">
      <label>Modus</label>
      <div class="tp-ai-modes">
        <label class="tp-ai-mode">
          <input type="radio" name="tp-auto-mode" value="new">
          <div class="tp-ai-mode-content">
            <strong>Nieuw</strong>
            <span>Volledig rooster opnieuw; concept-standaardtrainingen worden genegeerd.</span>
          </div>
        </label>
        <label class="tp-ai-mode">
          <input type="radio" name="tp-auto-mode" value="complete" checked>
          <div class="tp-ai-mode-content">
            <strong>Aanvullen</strong>
            <span>Huidige standaardtrainingen vasthouden en ontbrekende sessies bijplannen.</span>
          </div>
        </label>
      </div>
      <label class="tp-ai-multistep" style="display:flex;align-items:flex-start;gap:0.5rem;margin:0.75rem 0 0;font-size:0.88rem;cursor:pointer">
        <input type="checkbox" id="tp-auto-snapshot" style="margin-top:0.2rem" />
        <span><strong>Snapshot activeren</strong> — resultaat als archief-item aanmaken en direct actief zetten (zoals bij AI).</span>
      </label>
      <label for="tp-auto-iso-week" style="display:block;margin-top:0.75rem;font-size:0.88rem">ISO-week voor week-specifieke blokkades <span class="tp-ai-optional">optioneel</span></label>
      <input type="text" id="tp-auto-iso-week" class="form-input" style="width:100%;max-width:12rem" placeholder="bijv. 2026-W13" value="${attrSafe(defaultIso)}" />
      <p class="text-small text-muted" style="margin:0.35rem 0 0;line-height:1.35">Leeg laten = alleen terugkerende blokkades (blauwdruk). Vul een week in om ook blokkades met die ISO-week mee te nemen.</p>
      <div id="tp-auto-status" class="tp-ai-status" style="margin-top:0.75rem">Kies modus en klik Starten.</div>
    </div>
    <div class="tp-ai-footer">
      <button type="button" class="btn btn-sm btn-secondary tp-auto-cancel">Annuleren</button>
      <button type="button" class="btn btn-sm btn-primary tp-auto-start">Starten</button>
    </div>
  </div>`;
  overlay.style.display = 'flex';

  const statusEl = overlay.querySelector('#tp-auto-status');
  const close = () => { overlay.style.display = 'none'; };
  overlay.querySelector('.tp-auto-cancel').onclick = close;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('.tp-auto-start').onclick = async () => {
    const mode = overlay.querySelector('input[name="tp-auto-mode"]:checked')?.value || 'complete';
    const createSnapshot = !!overlay.querySelector('#tp-auto-snapshot')?.checked;
    const isoRaw = overlay.querySelector('#tp-auto-iso-week')?.value?.trim() || '';
    const startBtn = overlay.querySelector('.tp-auto-start');
    startBtn.disabled = true;
    statusEl.innerHTML = '<span class="tp-ai-status-loading"><span class="tp-spinner"></span> Bezig met plannen…</span>';
    snapshotBeforeMutation();
    try {
      const body = {
        mode,
        blueprint_id: _ctx.contextBlueprintId,
        create_snapshot: createSnapshot,
      };
      if (isoRaw) body.iso_week = isoRaw;
      const result = await api('/api/training/auto-schedule', { method: 'POST', body });

      if (createSnapshot && result.snapshot) {
        statusEl.innerHTML = '<span class="tp-ai-status-loading"><span class="tp-spinner"></span> Snapshot activeren…</span>';
        try {
          await api(`/api/training/snapshots/${result.snapshot.id}/activate`, { method: 'POST' });
          _activeSnapshotName = result.snapshot.name;
        } catch (_) { /* activeren optioneel */ }
      }

      let html = '';
      if (result.ok) {
        html += `<div class="tp-ai-result-success"><strong>Klaar.</strong> ${escHtml(result.advice || '')}</div>`;
      } else {
        html += `<div class="tp-ai-result-warn"><strong>Niet volledig geldig.</strong> ${escHtml(result.advice || '')}</div>`;
      }
      if (result.validation?.hardErrors?.length) {
        html += '<details open class="tp-ai-advice" style="margin-top:0.5rem"><summary>Harde fouten</summary><ul style="margin:0.25rem 0 0 1rem;padding:0">';
        for (const e of result.validation.hardErrors) {
          html += `<li>${escHtml(e.message || e.code || '')}</li>`;
        }
        html += '</ul></details>';
      }
      if (result.validation?.softWarnings?.length) {
        html += '<details class="tp-ai-advice" style="margin-top:0.5rem"><summary>Zachte waarschuwingen</summary><ul style="margin:0.25rem 0 0 1rem;padding:0">';
        for (const w of result.validation.softWarnings) {
          html += `<li>${escHtml(w.message || w.code || '')}</li>`;
        }
        html += '</ul></details>';
      }
      if (result.failures?.length) {
        html += '<details open class="tp-ai-advice" style="margin-top:0.5rem"><summary>Tekort per team</summary><ul style="margin:0.25rem 0 0 1rem;padding:0">';
        for (const f of result.failures) {
          const mins = result.shortfall && result.shortfall[f.team] != null ? ` (${result.shortfall[f.team]} min)` : '';
          html += `<li>${escHtml(f.team)}: ${f.placed}/${f.need} sessies${mins}</li>`;
        }
        html += '</ul></details>';
      }
      if (result.snapshot_apply_errors?.length) {
        html += `<div class="tp-ai-result-warn" style="margin-top:0.5rem">Snapshot-deels mislukt: ${result.snapshot_apply_errors.length} regels</div>`;
      }
      if (result.snapshot) {
        html += `<p class="text-small" style="margin:0.5rem 0 0">Archief: <strong>${escHtml(result.snapshot.name)}</strong> (${result.snapshot.entries} trainingen)</p>`;
      }
      statusEl.innerHTML = html;
      overlay.querySelector('.tp-auto-cancel').textContent = 'Sluiten';
      loadAndRender();
    } catch (err) {
      statusEl.innerHTML = `<span class="tp-ai-status-err">❌ ${escHtml(err.message)}</span>`;
      startBtn.disabled = false;
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
          body: { name: v.name, nevobo_venue_name: v.name, blueprint_id: _ctx.contextBlueprintId },
        });
        _ctx.locations.push(locRes.location);
        for (const field of v.fields) {
          const venueRes = await api('/api/training/venues', {
            method: 'POST',
            body: {
              location_id: locRes.location.id,
              name: field.name,
              type: 'hall',
              nevobo_field_slug: field.slug,
              blueprint_id: _ctx.contextBlueprintId,
            },
          });
          _ctx.venues.push(venueRes.venue);
        }
        if (v.fields.length === 0) {
          const venueRes = await api('/api/training/venues', {
            method: 'POST',
            body: {
              location_id: locRes.location.id,
              name: 'Veld 1',
              type: 'hall',
              blueprint_id: _ctx.contextBlueprintId,
            },
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
        body: { name: document.getElementById('tp-l-name').value, blueprint_id: _ctx.contextBlueprintId },
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
          blueprint_id: _ctx.contextBlueprintId,
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
            await api('/api/training/defaults', { method: 'POST', body: { ...body } });
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
        await api('/api/training/defaults', { method: 'POST', body: { ...body } });
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

