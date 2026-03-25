import { api, state, renderAvatar, navigate, showToast } from '../app.js';
import { escHtml } from '../escape-html.js';

const DAY_NAMES = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];

let _noteTimer = null;

export async function render(container, params = {}) {
  container.innerHTML = '<div class="spinner"></div>';

  if (!state.user) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        <p>Log in om deze training te bekijken.</p>
      </div>`;
    return;
  }

  const { teamId, date, startTime, endTime, venue, location } = params;
  if (!teamId || !date || !startTime) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>Ongeldige trainingslink.</p></div>`;
    return;
  }

  let data;
  try {
    const qs = new URLSearchParams();
    if (endTime) qs.set('end_time', endTime);
    if (venue) qs.set('venue', venue);
    if (location) qs.set('location', location);
    data = await api(`/api/training/session/${teamId}/${date}/${startTime}?${qs}`);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${err.message?.includes('Geen lid') ? '🚫' : '⚠️'}</div>
        <p>${escHtml(err.message)}</p>
      </div>`;
    return;
  }

  const { session, attendance, is_coach: isCoach, exercises: sessionExercises = [] } = data;

  const d = new Date(session.date + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7;
  const dateLabel = `${DAY_NAMES[dow]} ${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
  const timeLabel = session.start_time + (session.end_time ? ` – ${session.end_time}` : '');
  const locLabel = [session.venue_name, session.location_name].filter(Boolean).join(' · ');

  const coaches = attendance.filter(a => a.membership_type === 'coach');
  const players = attendance.filter(a => a.membership_type === 'player');
  const guests  = attendance.filter(a => a.membership_type === 'guest');

  container.innerHTML = `
    <div class="ts-page" id="ts-page-root" data-session-id="${session.id}" data-team-id="${teamId}" data-date="${escHtml(session.date)}" data-start="${escHtml(session.start_time)}" data-end="${escHtml(session.end_time || '')}" data-venue="${escHtml(session.venue_name || '')}" data-location="${escHtml(session.location_name || '')}">
      <div class="ts-header">
        <button type="button" class="btn btn-ghost btn-sm ts-back" id="ts-back">← Terug</button>
        <div class="ts-info">
          <h2 class="ts-title">${escHtml(session.team_name)}</h2>
          <div class="ts-meta">${escHtml(dateLabel)} · ${escHtml(timeLabel)}</div>
          ${locLabel ? `<div class="ts-meta ts-loc">${escHtml(locLabel)}</div>` : ''}
        </div>
      </div>

      <div class="card mb-3">
        <div class="card-header"><h3>📋 Aanwezigheid</h3></div>
        <div class="card-body" style="padding:0" id="ts-att-body">
          ${coaches.length ? `<div class="ts-role-label">Coaches</div>` : ''}
          ${renderAttendanceRows(coaches, isCoach, session.id)}
          ${players.length ? `<div class="ts-role-label">Spelers</div>` : ''}
          ${renderAttendanceRows(players, isCoach, session.id)}
          ${guests.length ? `<div class="ts-role-label">Meetrainers</div>` : ''}
          ${renderAttendanceRows(guests, isCoach, session.id)}
          ${!attendance.length ? '<div class="ts-empty">Geen teamleden gevonden.</div>' : ''}
        </div>
      </div>

      ${isCoach ? `
      <div class="card mb-3">
        <div class="card-header"><h3>🏃 Meetrainer toevoegen</h3></div>
        <div class="card-body">
          <input type="search" id="ts-guest-search" class="form-input" placeholder="Zoek op naam…" autocomplete="off" />
          <div id="ts-guest-results" class="ts-guest-results"></div>
        </div>
      </div>
      ` : ''}

      ${isCoach ? `
      <div class="card mb-3">
        <div class="card-header"><h3>📝 Notities</h3></div>
        <div class="card-body">
          <textarea id="ts-notes" class="form-input ts-notes-input" rows="5" placeholder="Notities voor deze training…">${escHtml(session.notes || '')}</textarea>
          <div class="ts-notes-status text-muted text-small" id="ts-notes-status"></div>
        </div>
      </div>` : ''}

      <div class="card mb-3">
        <div class="card-header"><h3>📋 Trainingsprogramma</h3></div>
        <div class="card-body" id="ts-ex-wrap">
          ${isCoach ? `
          <div class="ts-ex-toolbar mb-2">
            <input type="search" id="ts-ex-search" class="form-input" placeholder="Oefening zoeken in bibliotheek…" autocomplete="off" />
            <button type="button" class="btn btn-sm btn-secondary" id="ts-ex-new-private">+ Nieuwe privé-oefening</button>
          </div>
          <div id="ts-ex-pick-results" class="ts-ex-pick-results mb-2"></div>` : ''}
          <div id="ts-ex-list">${renderExerciseRows(sessionExercises, isCoach)}</div>
        </div>
      </div>
    </div>`;

  container.querySelector('#ts-back')?.addEventListener('click', () => {
    window.history.back();
  });

  if (isCoach) {
    setupAttendanceButtons(container, session.id);
    setupGuestSearch(container, session.id);
    setupNotes(container, session.id);
    setupSessionExercises(container, session, { teamId, date, startTime, endTime, venue, location });
  }
}

const DIFF_LABEL = { easy: 'Makkelijk', medium: 'Gemiddeld', hard: 'Moeilijk' };

function diffBadgeHtml(difficulty) {
  const d = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';
  const label = DIFF_LABEL[d] || difficulty;
  return `<span class="ts-diff-badge ts-diff-badge--${d}">${escHtml(label)}</span>`;
}

/** Club = gedeelde clubbibliotheek; privé = alleen voor jou zichtbaar in zoeken. */
function scopeBadgeHtml(scope) {
  if (scope === 'club') {
    return '<span class="ts-ex-scope-badge ts-ex-scope-badge--club" title="Club-oefening (bibliotheek)">Club</span>';
  }
  return '<span class="ts-ex-scope-badge ts-ex-scope-badge--private" title="Privé-oefening">Privé</span>';
}

/** Read-only sterren voor spelers (1–5). */
function teamPerformanceStarsReadonlyHtml(rating) {
  const r = Math.min(5, Math.max(1, parseInt(rating, 10) || 0));
  if (!r) return '';
  const stars = [1, 2, 3, 4, 5]
    .map((n) => `<span class="ts-ex-star-read${n <= r ? ' ts-ex-star-read--on' : ''}" aria-hidden="true">★</span>`)
    .join('');
  return `<div class="ts-ex-stars-readonly" role="img" aria-label="Teamprestatie: ${r} van 5 sterren">${stars}</div>`;
}

function applyTeamStarButtons(row, pr) {
  row.querySelectorAll('.ts-ex-star').forEach((star) => {
    const n = parseInt(star.dataset.rating, 10);
    const on = pr != null && Number.isFinite(pr) && n <= pr;
    star.classList.toggle('ts-ex-star--on', on);
    star.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/** Modal: toelichting voor clubbeheer bij delen van privé-oefening. */
function showSharePitchModal(exerciseId, onSuccess) {
  const overlay = document.createElement('div');
  overlay.className = 'ts-modal-overlay';
  overlay.innerHTML = `
    <div class="card ts-modal-card ts-share-pitch-modal">
      <h3 class="mb-2">Clubbibliotheek</h3>
      <p class="text-small text-muted mb-2">Clubbeheer ziet de volledige oefening (naam, beschrijving, duur, moeilijkheid, tags). Leg hieronder uit waarom deze oefening voor de hele club bruikbaar is (minimaal 20 tekens).</p>
      <label class="mb-2" style="display:block">Motivatie *
        <textarea id="tssp-pitch" class="form-input" rows="4" maxlength="2000" placeholder="Bijvoorbeeld: past bij jeugd omdat…"></textarea>
      </label>
      <div class="flex gap-2 justify-end mt-2">
        <button type="button" class="btn btn-ghost" id="tssp-cancel">Annuleren</button>
        <button type="button" class="btn btn-primary" id="tssp-send">Indienen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('#tssp-pitch');
  setTimeout(() => ta?.focus(), 100);
  const close = () => overlay.remove();
  overlay.querySelector('#tssp-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('#tssp-send').addEventListener('click', async () => {
    const pitch = ta.value.trim();
    if (pitch.length < 20) {
      showToast('Schrijf minimaal 20 tekens', 'error');
      return;
    }
    try {
      await api(`/api/training/exercises/${exerciseId}/request-share`, {
        method: 'POST',
        body: { share_pitch: pitch },
      });
      showToast('Aanvraag verstuurd naar clubbeheer', 'success');
      close();
      if (onSuccess) await onSuccess();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function renderExerciseRows(exercises, isCoach) {
  if (!exercises?.length) {
    return '<div class="ts-ex-empty text-muted text-small">Nog geen oefeningen in dit programma.</div>';
  }
  const sorted = [...exercises].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return sorted.map((ex) => {
    const diffLabel = DIFF_LABEL[ex.difficulty] || ex.difficulty;
    const tags = (ex.tags || []).map(t => `<span class="ts-ex-tag">${escHtml(t.name)}</span>`).join('');
    const desc = ex.description ? `<p class="ts-ex-desc text-small text-muted">${escHtml(ex.description)}</p>` : '';

    if (!isCoach) {
      const prStars =
        ex.performance_rating != null
          ? teamPerformanceStarsReadonlyHtml(ex.performance_rating)
          : '';
      return `
        <div class="ts-ex-block ts-ex-row" data-link-id="${ex.id}">
          <div class="ts-ex-main">
            <strong class="ts-ex-name">${escHtml(ex.name)}</strong>
            <div class="ts-ex-line">
              <span class="ts-ex-meta">${escHtml(diffLabel)} · ${ex.duration_minutes} min</span>
              ${tags ? `<div class="ts-ex-tags">${tags}</div>` : ''}
            </div>
            ${prStars}
            ${desc}
          </div>
        </div>`;
    }

    const rating = ex.performance_rating;
    const note = ex.performance_note || '';
    const canEditPrivate = ex.exercise_scope === 'private'
      && state.user
      && Number(ex.created_by_user_id) === Number(state.user.id);
    const editPayload = canEditPrivate
      ? escHtml(JSON.stringify({
        id: ex.exercise_id,
        name: ex.name,
        description: ex.description || '',
        default_duration_minutes: ex.default_duration_minutes,
        difficulty: ex.difficulty,
        tag_ids: (ex.tags || []).map((t) => t.id),
      }))
      : '';
    return `
      <div class="ts-ex-block ts-ex-row ts-ex-row-coach" data-link-id="${ex.id}" data-exercise-id="${ex.exercise_id}" data-sort-order="${ex.sort_order ?? 0}">
        <div class="ts-ex-main">
          <div class="ts-ex-head">
            <div class="ts-ex-title-row">
              <strong class="ts-ex-name">${escHtml(ex.name)}</strong>
              <div class="ts-ex-order">
                ${canEditPrivate ? `<button type="button" class="btn btn-xs btn-ghost ts-ex-edit-private" title="Naam, beschrijving, standaardduur, moeilijkheid en tags aanpassen" data-ex-edit="${editPayload}">Bewerken</button>` : ''}
                <button type="button" class="btn btn-xs btn-ghost ts-ex-move" data-dir="up" title="Omhoog">↑</button>
                <button type="button" class="btn btn-xs btn-ghost ts-ex-move" data-dir="down" title="Omlaag">↓</button>
                <button type="button" class="btn btn-xs btn-ghost ts-ex-remove" title="Verwijderen">✕</button>
              </div>
            </div>
            <div class="ts-ex-line">
              <span class="ts-ex-meta">${escHtml(diffLabel)} · ${ex.default_duration_minutes} min std.</span>
              ${tags ? `<div class="ts-ex-tags">${tags}</div>` : ''}
            </div>
          </div>
          ${desc}
          <div class="ts-ex-fields ts-ex-fields--compact">
            <label class="ts-ex-field ts-ex-field--dur">
              <span>Duur</span>
              <input type="number" class="form-input form-input--compact ts-ex-dur" min="1" max="480" value="${ex.duration_minutes}" inputmode="numeric" />
            </label>
            <div class="ts-ex-field ts-ex-field--rating">
              <span title="Teamprestatie">Sterren</span>
              <div class="ts-ex-stars" role="radiogroup" aria-label="Teamprestatie in sterren">
                ${[1, 2, 3, 4, 5]
                  .map(
                    (n) => `
                <button type="button" class="ts-ex-star${rating != null && rating >= n ? ' ts-ex-star--on' : ''}" data-rating="${n}" aria-label="${n} van 5 sterren" aria-pressed="${rating != null && rating >= n ? 'true' : 'false'}">★</button>`
                  )
                  .join('')}
                <button type="button" class="ts-ex-star-clear" data-rating="" title="Geen score" aria-label="Score wissen">✕</button>
              </div>
            </div>
            <label class="ts-ex-field ts-ex-field--note">
              <span>Evaluatie</span>
              <textarea class="form-input form-input--compact ts-ex-note" rows="2" placeholder="Optioneel">${escHtml(note)}</textarea>
            </label>
            ${ex.can_request_share || ex.share_status === 'pending'
              ? `<div class="ts-ex-foot">
              ${ex.can_request_share ? `<button type="button" class="ts-ex-share-link" title="Privé-oefening ter goedkeuring aan clubbeheer voorleggen">Club voorleggen</button>` : ''}
              ${
                ex.share_status === 'pending'
                  ? `<div class="ts-ex-pending-block">
                  <span class="ts-ex-share-pending">In behandeling bij clubbeheer</span>
                  ${ex.share_pitch ? `<p class="ts-ex-my-pitch text-small">${escHtml(ex.share_pitch)}</p>` : ''}
                </div>`
                  : ''
              }
            </div>`
              : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

const _exSaveTimers = new Map();

function setupSessionExercises(container, session, routeParams) {
  const sessionId = session.id;
  const listEl = container.querySelector('#ts-ex-list');
  const searchEl = container.querySelector('#ts-ex-search');
  const pickResults = container.querySelector('#ts-ex-pick-results');

  async function reloadList() {
    const { teamId, date, startTime, endTime, venue, location } = routeParams;
    const qs = new URLSearchParams();
    if (endTime) qs.set('end_time', endTime);
    if (venue) qs.set('venue', venue);
    if (location) qs.set('location', location);
    try {
      const data = await api(`/api/training/session/${teamId}/${date}/${startTime}?${qs}`);
      if (listEl) listEl.innerHTML = renderExerciseRows(data.exercises || [], true);
      bindExerciseRows();
    } catch (_) {
      showToast('Programma verversen mislukt', 'error');
    }
  }

  function bindExerciseRow(row) {
    const linkId = parseInt(row.dataset.linkId, 10);

    row.querySelector('.ts-ex-dur')?.addEventListener('change', async (e) => {
      const v = parseInt(e.target.value, 10);
      if (!Number.isFinite(v) || v < 1) return;
      try {
        await api(`/api/training/session/${sessionId}/exercises/${linkId}`, {
          method: 'PATCH',
          body: { duration_minutes: v },
        });
        showToast('Duur opgeslagen', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    row.querySelectorAll('.ts-ex-star').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pr = parseInt(btn.dataset.rating, 10);
        applyTeamStarButtons(row, pr);
        try {
          await api(`/api/training/session/${sessionId}/exercises/${linkId}`, {
            method: 'PATCH',
            body: { performance_rating: pr },
          });
        } catch (err) {
          showToast(err.message, 'error');
          await reloadList();
        }
      });
    });

    row.querySelector('.ts-ex-star-clear')?.addEventListener('click', async () => {
      applyTeamStarButtons(row, null);
      try {
        await api(`/api/training/session/${sessionId}/exercises/${linkId}`, {
          method: 'PATCH',
          body: { performance_rating: null },
        });
      } catch (err) {
        showToast(err.message, 'error');
        await reloadList();
      }
    });

    const noteEl = row.querySelector('.ts-ex-note');
    if (noteEl) {
      noteEl.addEventListener('input', () => {
        const k = `${sessionId}-${linkId}`;
        if (_exSaveTimers.get(k)) clearTimeout(_exSaveTimers.get(k));
        _exSaveTimers.set(k, setTimeout(async () => {
          try {
            await api(`/api/training/session/${sessionId}/exercises/${linkId}`, {
              method: 'PATCH',
              body: { performance_note: noteEl.value },
            });
          } catch (err) {
            showToast(err.message, 'error');
          }
        }, 600));
      });
    }

    row.querySelector('.ts-ex-share-link')?.addEventListener('click', () => {
      const eid = parseInt(row.dataset.exerciseId, 10);
      showSharePitchModal(eid, reloadList);
    });

    row.querySelector('.ts-ex-edit-private')?.addEventListener('click', () => {
      const btn = row.querySelector('.ts-ex-edit-private');
      const raw = btn?.dataset.exEdit;
      if (!raw) return;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        showToast('Oefeninggegevens laden mislukt', 'error');
        return;
      }
      showPrivateExerciseModal({
        onDone: reloadList,
        edit: parsed,
      });
    });

    row.querySelector('.ts-ex-remove')?.addEventListener('click', async () => {
      if (!confirm('Oefening uit programma halen?')) return;
      try {
        await api(`/api/training/session/${sessionId}/exercises/${linkId}`, { method: 'DELETE' });
        await reloadList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    row.querySelectorAll('.ts-ex-move').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const dir = btn.dataset.dir;
        const wrap = container.querySelector('#ts-ex-list');
        const rows = [...wrap.querySelectorAll('.ts-ex-row-coach')];
        const idx = rows.indexOf(row);
        const j = dir === 'up' ? idx - 1 : idx + 1;
        if (j < 0 || j >= rows.length) return;
        const a = rows[idx];
        const b = rows[j];
        const idA = parseInt(a.dataset.linkId, 10);
        const idB = parseInt(b.dataset.linkId, 10);
        const sortA = parseInt(a.dataset.sortOrder, 10);
        const sortB = parseInt(b.dataset.sortOrder, 10);
        try {
          await api(`/api/training/session/${sessionId}/exercises/${idA}`, { method: 'PATCH', body: { sort_order: sortB } });
          await api(`/api/training/session/${sessionId}/exercises/${idB}`, { method: 'PATCH', body: { sort_order: sortA } });
          await reloadList();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  function bindExerciseRows() {
    container.querySelectorAll('.ts-ex-row-coach').forEach(bindExerciseRow);
  }
  bindExerciseRows();

  let searchTimer = null;
  searchEl?.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    const q = searchEl.value.trim();
    if (q.length < 2) {
      if (pickResults) pickResults.innerHTML = '';
      return;
    }
    searchTimer = setTimeout(async () => {
      try {
        const data = await api(`/api/training/exercises?q=${encodeURIComponent(q)}`);
        const exs = data.exercises || [];
        if (!exs.length) {
          pickResults.innerHTML = '<div class="text-muted text-small">Geen oefeningen gevonden</div>';
          return;
        }
        pickResults.innerHTML = exs.map((ex) => `
          <div class="ts-ex-pick-row" data-ex-id="${ex.id}">
            <div class="ts-ex-pick-main">
              <div class="ts-ex-pick-title">
                <strong>${escHtml(ex.name)}</strong>
                ${scopeBadgeHtml(ex.scope)}
              </div>
              <div class="ts-ex-pick-meta">
                ${diffBadgeHtml(ex.difficulty)}
                <span class="text-small text-muted ts-ex-pick-dur">${ex.default_duration_minutes} min</span>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-primary ts-ex-add">Toevoegen</button>
          </div>
        `).join('');
        pickResults.querySelectorAll('.ts-ex-add').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const rid = btn.closest('.ts-ex-pick-row').dataset.exId;
            btn.disabled = true;
            try {
              await api(`/api/training/session/${sessionId}/exercises`, {
                method: 'POST',
                body: { exercise_id: parseInt(rid, 10) },
              });
              searchEl.value = '';
              pickResults.innerHTML = '';
              await reloadList();
              showToast('Oefening toegevoegd', 'success');
            } catch (err) {
              showToast(err.message, 'error');
              btn.disabled = false;
            }
          });
        });
      } catch (_) {
        pickResults.innerHTML = '<div class="text-muted">Zoeken mislukt</div>';
      }
    }, 300);
  });

  container.querySelector('#ts-ex-new-private')?.addEventListener('click', () => {
    showPrivateExerciseModal({
      sessionId,
      onDone: reloadList,
    });
  });
}

/**
 * Nieuwe privé-oefening of bestaande bewerken (alleen jouw privé-oefeningen).
 * @param {{ sessionId?: number, onDone?: () => void, edit?: { id: number, name: string, description?: string, default_duration_minutes: number, difficulty: string, tag_ids?: number[] } }} opts
 */
function showPrivateExerciseModal(opts) {
  const { sessionId, onDone, edit } = opts || {};
  const isEdit = edit && Number.isFinite(Number(edit.id));
  const overlay = document.createElement('div');
  overlay.className = 'ts-modal-overlay';
  const initialName = isEdit ? (edit.name || '') : '';
  const initialDesc = isEdit ? (edit.description || '') : '';
  const initialDur = isEdit ? edit.default_duration_minutes : 20;
  const initialDiff = isEdit && ['easy', 'medium', 'hard'].includes(edit.difficulty) ? edit.difficulty : 'medium';
  const initialTagIds = isEdit ? new Set((edit.tag_ids || []).map((id) => Number(id))) : new Set();

  overlay.innerHTML = `
    <div class="card ts-modal-card">
      <h3 class="mb-2">${isEdit ? 'Privé-oefening bewerken' : 'Nieuwe privé-oefening'}</h3>
      <label class="mb-2" style="display:block">Naam *
        <input type="text" id="tsp-name" class="form-input" required value="${escHtml(initialName)}" />
      </label>
      <label class="mb-2" style="display:block">Beschrijving
        <textarea id="tsp-desc" class="form-input" rows="3">${escHtml(initialDesc)}</textarea>
      </label>
      <label class="mb-2" style="display:block">${isEdit ? 'Standaardduur (min) *' : 'Duur (min) *'}
        <input type="number" id="tsp-dur" class="form-input" value="${escHtml(String(initialDur))}" min="1" max="480" />
      </label>
      <label class="mb-2" style="display:block">Moeilijkheid
        <select id="tsp-diff" class="form-input">
          <option value="easy"${initialDiff === 'easy' ? ' selected' : ''}>Makkelijk</option>
          <option value="medium"${initialDiff === 'medium' ? ' selected' : ''}>Gemiddeld</option>
          <option value="hard"${initialDiff === 'hard' ? ' selected' : ''}>Moeilijk</option>
        </select>
      </label>
      <div class="mb-2" id="tsp-tags-wrap"><span class="text-small text-muted">Tags laden…</span></div>
      <div class="flex gap-2 justify-end mt-2">
        <button type="button" class="btn btn-ghost" id="tsp-cancel">Annuleren</button>
        <button type="button" class="btn btn-primary" id="tsp-save">${isEdit ? 'Bijwerken' : 'Opslaan'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  (async () => {
    try {
      const data = await api('/api/training/skill-tags');
      const tags = data.tags || [];
      const wrap = overlay.querySelector('#tsp-tags-wrap');
      if (!tags.length) {
        wrap.innerHTML = '<span class="text-small text-muted">Geen tags — vraag een beheerder om vaardigheidstags aan te maken.</span>';
      } else {
        wrap.innerHTML = '<div class="text-small mb-1">Vaardigheden</div>' + tags.map((t) => {
          const checked = initialTagIds.has(Number(t.id)) ? ' checked' : '';
          return `
          <label class="ts-tag-chk"><input type="checkbox" value="${t.id}"${checked} /> ${escHtml(t.name)}</label>`;
        }).join('');
      }
    } catch (_) {
      overlay.querySelector('#tsp-tags-wrap').innerHTML = '<span class="text-small text-danger">Tags laden mislukt</span>';
    }
  })();

  const close = () => overlay.remove();
  overlay.querySelector('#tsp-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#tsp-save').addEventListener('click', async () => {
    const name = overlay.querySelector('#tsp-name').value.trim();
    const description = overlay.querySelector('#tsp-desc').value.trim();
    const dur = parseInt(overlay.querySelector('#tsp-dur').value, 10);
    const difficulty = overlay.querySelector('#tsp-diff').value;
    if (!name) {
      showToast('Naam is verplicht', 'error');
      return;
    }
    const tagIds = [...overlay.querySelectorAll('#tsp-tags-wrap input[type=checkbox]:checked')].map((c) => parseInt(c.value, 10));
    try {
      if (isEdit) {
        await api(`/api/training/exercises/${edit.id}`, {
          method: 'PATCH',
          body: {
            name,
            description,
            default_duration_minutes: dur,
            difficulty,
            tag_ids: tagIds,
          },
        });
        showToast('Privé-oefening bijgewerkt', 'success');
      } else {
        const created = await api('/api/training/exercises', {
          method: 'POST',
          body: {
            name,
            description,
            default_duration_minutes: dur,
            difficulty,
            scope: 'private',
            tag_ids: tagIds,
          },
        });
        const newId = created.exercise?.id;
        if (sessionId && newId) {
          await api(`/api/training/session/${sessionId}/exercises`, {
            method: 'POST',
            body: { exercise_id: newId },
          });
          showToast('Privé-oefening toegevoegd aan dit programma', 'success');
        } else {
          showToast('Privé-oefening opgeslagen', 'success');
        }
      }
      close();
      if (onDone) await onDone();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function renderAttendanceRows(members, isCoach, sessionId) {
  return members.map(m => {
    const statusClass = m.status === 'present' ? 'ts-present' : m.status === 'absent' ? 'ts-absent' : 'ts-unknown';
    const statusLabel = m.status === 'present' ? 'Aanwezig' : m.status === 'absent' ? 'Afwezig' : '—';
    const isGuest = m.membership_type === 'guest';
    const buttons = isCoach ? `
      <div class="ts-att-btns" data-user-id="${m.user_id}" data-session-id="${sessionId}" data-guest="${isGuest ? '1' : ''}">
        <button type="button" class="ts-att-btn ts-att-present${m.status === 'present' ? ' active' : ''}" data-status="present" title="Aanwezig">✓</button>
        <button type="button" class="ts-att-btn ts-att-absent${!isGuest && m.status === 'absent' ? ' active' : ''}" data-status="absent" title="${isGuest ? 'Verwijderen' : 'Afwezig'}">✗</button>
      </div>` : `<span class="ts-att-label ${statusClass}">${statusLabel}</span>`;

    return `
      <div class="ts-att-row ${statusClass}">
        <div class="ts-att-person">
          ${renderAvatar(m.name, m.avatar_url, 'sm')}
          <span class="ts-att-name">${escHtml(m.name)}</span>
        </div>
        ${buttons}
      </div>`;
  }).join('');
}

function setupAttendanceButtons(container, sessionId) {
  container.querySelectorAll('.ts-att-btns').forEach(wrap => {
    const isGuest = wrap.dataset.guest === '1';
    wrap.querySelectorAll('.ts-att-btn[data-status]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = parseInt(wrap.dataset.userId, 10);
        const status = btn.dataset.status;

        if (isGuest && status === 'absent') {
          try {
            await api(`/api/training/session/${sessionId}/guest/${userId}`, { method: 'DELETE' });
            refreshAttendanceList(container, sessionId);
          } catch (err) {
            showToast(err.message || 'Fout bij verwijderen', 'error');
          }
          return;
        }

        try {
          await api(`/api/training/session/${sessionId}/attendance`, {
            method: 'PATCH',
            body: JSON.stringify({ user_id: userId, status }),
          });
          wrap.querySelectorAll('.ts-att-btn[data-status]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');

          const row = wrap.closest('.ts-att-row');
          row.classList.remove('ts-present', 'ts-absent', 'ts-unknown');
          row.classList.add(status === 'present' ? 'ts-present' : status === 'absent' ? 'ts-absent' : 'ts-unknown');
        } catch (err) {
          showToast(err.message || 'Fout bij opslaan', 'error');
        }
      });
    });
  });
}

function setupGuestSearch(container, sessionId) {
  const input = container.querySelector('#ts-guest-search');
  const resultsEl = container.querySelector('#ts-guest-results');
  if (!input || !resultsEl) return;

  let timer = null;
  input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const data = await api(`/api/training/session/${sessionId}/search-club-members?q=${encodeURIComponent(q)}`);
        if (!data.results.length) {
          resultsEl.innerHTML = '<div class="ts-guest-empty">Geen resultaten</div>';
          return;
        }
        resultsEl.innerHTML = data.results.map(r => `
          <div class="ts-guest-row" data-user-id="${r.id}">
            <div class="ts-att-person">
              ${renderAvatar(r.name, r.avatar_url, 'sm')}
              <div>
                <span class="ts-att-name">${escHtml(r.name)}</span>
                ${r.team_name ? `<span class="ts-guest-team">${escHtml(r.team_name)}</span>` : ''}
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-primary ts-guest-add">+ Toevoegen</button>
          </div>
        `).join('');

        resultsEl.querySelectorAll('.ts-guest-add').forEach(btn => {
          btn.addEventListener('click', async () => {
            const row = btn.closest('.ts-guest-row');
            const userId = parseInt(row.dataset.userId, 10);
            btn.disabled = true;
            try {
              await api(`/api/training/session/${sessionId}/add-guest`, {
                method: 'POST',
                body: JSON.stringify({ user_id: userId }),
              });
              row.remove();
              input.value = '';
              resultsEl.innerHTML = '';
              refreshAttendanceList(container, sessionId);
            } catch (err) {
              showToast(err.message || 'Fout bij toevoegen', 'error');
              btn.disabled = false;
            }
          });
        });
      } catch (_) {
        resultsEl.innerHTML = '<div class="ts-guest-empty">Zoeken mislukt</div>';
      }
    }, 300);
  });
}

async function refreshAttendanceList(container, sessionId) {
  const body = container.querySelector('#ts-att-body');
  if (!body) return;
  try {
    const session = body.closest('.ts-page')?.querySelector('[data-session-team-id]');
    const res = await api(`/api/training/session/${sessionId}/attendance-list`);
    if (!res.ok) return;
    const { attendance } = res;
    const coaches = attendance.filter(a => a.membership_type === 'coach');
    const players = attendance.filter(a => a.membership_type === 'player');
    const guests  = attendance.filter(a => a.membership_type === 'guest');
    body.innerHTML =
      (coaches.length ? `<div class="ts-role-label">Coaches</div>` : '') +
      renderAttendanceRows(coaches, true, sessionId) +
      (players.length ? `<div class="ts-role-label">Spelers</div>` : '') +
      renderAttendanceRows(players, true, sessionId) +
      (guests.length ? `<div class="ts-role-label">Meetrainers</div>` : '') +
      renderAttendanceRows(guests, true, sessionId);
    setupAttendanceButtons(container, sessionId);
  } catch (_) {}
}

function setupNotes(container, sessionId) {
  const textarea = container.querySelector('#ts-notes');
  const statusEl = container.querySelector('#ts-notes-status');
  if (!textarea) return;

  textarea.addEventListener('input', () => {
    if (_noteTimer) clearTimeout(_noteTimer);
    statusEl.textContent = 'Opslaan…';
    _noteTimer = setTimeout(async () => {
      try {
        await api(`/api/training/session/${sessionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ notes: textarea.value }),
        });
        statusEl.textContent = 'Opgeslagen';
        setTimeout(() => { if (statusEl.textContent === 'Opgeslagen') statusEl.textContent = ''; }, 2000);
      } catch (err) {
        statusEl.textContent = 'Fout bij opslaan';
      }
    }, 800);
  });
}
