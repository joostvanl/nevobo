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

  const { session, attendance, is_coach: isCoach } = data;

  const d = new Date(session.date + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7;
  const dateLabel = `${DAY_NAMES[dow]} ${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
  const timeLabel = session.start_time + (session.end_time ? ` – ${session.end_time}` : '');
  const locLabel = [session.venue_name, session.location_name].filter(Boolean).join(' · ');

  const coaches = attendance.filter(a => a.membership_type === 'coach');
  const players = attendance.filter(a => a.membership_type === 'player');
  const guests  = attendance.filter(a => a.membership_type === 'guest');

  container.innerHTML = `
    <div class="ts-page">
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

      <div class="card mb-3">
        <div class="card-header"><h3>📝 Notities</h3></div>
        <div class="card-body">
          <textarea id="ts-notes" class="form-input ts-notes-input" rows="5" placeholder="Notities voor deze training…">${escHtml(session.notes || '')}</textarea>
          <div class="ts-notes-status text-muted text-small" id="ts-notes-status"></div>
        </div>
      </div>` : ''}
    </div>`;

  container.querySelector('#ts-back')?.addEventListener('click', () => {
    window.history.back();
  });

  if (isCoach) {
    setupAttendanceButtons(container, session.id);
    setupGuestSearch(container, session.id);
    setupNotes(container, session.id);
  }
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
