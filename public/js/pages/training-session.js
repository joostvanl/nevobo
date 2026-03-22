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
  const players = attendance.filter(a => a.membership_type !== 'coach');

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
        <div class="card-body" style="padding:0">
          ${coaches.length ? `<div class="ts-role-label">Coaches</div>` : ''}
          ${renderAttendanceRows(coaches, isCoach, session.id)}
          ${players.length ? `<div class="ts-role-label">Spelers</div>` : ''}
          ${renderAttendanceRows(players, isCoach, session.id)}
          ${!attendance.length ? '<div class="ts-empty">Geen teamleden gevonden.</div>' : ''}
        </div>
      </div>

      ${isCoach ? `
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
    setupNotes(container, session.id);
  }
}

function renderAttendanceRows(members, isCoach, sessionId) {
  return members.map(m => {
    const statusClass = m.status === 'present' ? 'ts-present' : m.status === 'absent' ? 'ts-absent' : 'ts-unknown';
    const statusLabel = m.status === 'present' ? 'Aanwezig' : m.status === 'absent' ? 'Afwezig' : '—';
    const buttons = isCoach ? `
      <div class="ts-att-btns" data-user-id="${m.user_id}" data-session-id="${sessionId}">
        <button type="button" class="ts-att-btn ts-att-present${m.status === 'present' ? ' active' : ''}" data-status="present" title="Aanwezig">✓</button>
        <button type="button" class="ts-att-btn ts-att-absent${m.status === 'absent' ? ' active' : ''}" data-status="absent" title="Afwezig">✗</button>
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
    wrap.querySelectorAll('.ts-att-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = parseInt(wrap.dataset.userId, 10);
        const status = btn.dataset.status;
        try {
          await api(`/api/training/session/${sessionId}/attendance`, {
            method: 'PATCH',
            body: JSON.stringify({ user_id: userId, status }),
          });
          wrap.querySelectorAll('.ts-att-btn').forEach(b => b.classList.remove('active'));
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
