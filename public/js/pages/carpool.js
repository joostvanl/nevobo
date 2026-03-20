import { api, state, renderAvatar, formatDate, formatTime, showToast } from '../app.js';
import { escHtml } from '../escape-html.js';

/** Zelfde logica als wedstrijdenpagina voor stabiele carpool-/API-keys */
export function encodeMatchId(m) {
  const raw =
    m.match_id ||
    (m.link && String(m.link).replace(/.*\//, '')) ||
    (m.title && m.title.slice(0, 40)) ||
    'onbekend';
  return encodeURIComponent(raw);
}

export function awayMatchesForTeam(allMatches, clubName, teamDisplayName) {
  const cl = (clubName || '').toLowerCase();
  const tl = (teamDisplayName || '').toLowerCase();
  if (!tl) return [];
  return allMatches.filter(m => {
    const home = (m.home_team || '').toLowerCase();
    const away = (m.away_team || '').toLowerCase();
    const clubAway = !cl || !home.includes(cl);
    if (!clubAway) return false;
    return (
      home.includes(tl) ||
      away.includes(tl) ||
      home.endsWith(tl) ||
      away.endsWith(tl)
    );
  });
}

/** Totaal spelers + coaches; server telt dit als alle personen (incl. chauffeurs) voor de verdeling. */
export function countPlayersAndCoachesTravelers(members) {
  return (members || []).filter(
    m => m.membership_type === 'player' || m.membership_type === 'coach'
  ).length;
}

/** Unieke uitwedstrijden voor een set teamnamen (eigen club). */
function mergeAwayMatchesForMyTeams(allMatches, clubName, teamDisplayNames) {
  const seen = new Set();
  const out = [];
  for (const name of teamDisplayNames) {
    for (const m of awayMatchesForTeam(allMatches, clubName, name)) {
      const key =
        m.match_id ||
        (m.link != null ? String(m.link) : '') ||
        `${m.home_team || ''}\0${m.away_team || ''}\0${m.datetime || m.date || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(m);
    }
  }
  out.sort((a, b) => {
    const ta = new Date(a.datetime || a.date || 0).getTime();
    const tb = new Date(b.datetime || b.date || 0).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && (ta || tb)) return ta - tb;
    return String(a.datetime || a.date || '').localeCompare(String(b.datetime || b.date || ''));
  });
  return out;
}

export async function render(container, params = {}) {
  container.innerHTML = '<div class="spinner"></div>';

  const user = state.user;
  if (!user) {
    container.innerHTML = renderLoginPrompt();
    return;
  }

  if (params.matchId) {
    renderCarpoolForMatch(container, decodeURIComponent(params.matchId), null);
    return;
  }

  if (!user.club_id) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🚗</div><h3>Geen club gekoppeld</h3><p>Stel eerst je club in.</p><button class="btn btn-primary mt-3" onclick="navigate('profile')">Profiel instellen</button></div>`;
    return;
  }

  try {
    const clubData = await api(`/api/clubs/${user.club_id}`);
    const [schedData, coachData] = await Promise.all([
      api(`/api/nevobo/club/${clubData.club.nevobo_code}/schedule`).catch(() => ({ matches: [] })),
      api('/api/carpool/coach/teams').catch(() => ({ teams: [], moderation_team_ids: [] })),
    ]);
    const allMatches = schedData.matches || [];
    const coachTeams = coachData.teams || [];
    const clubName = clubData.club.name || '';

    const membershipsHere = (user.memberships || []).filter(m => m.club_id === user.club_id);
    const namesFromMembership = membershipsHere.map(m => m.team_name).filter(Boolean);
    const namesFromCoach = coachTeams
      .filter(t => t.club_id === user.club_id)
      .map(t => t.display_name)
      .filter(Boolean);
    let myTeamNames = [...new Set([...namesFromMembership, ...namesFromCoach])];

    if (myTeamNames.length === 0 && user.team_id) {
      try {
        const td = await api(`/api/clubs/${user.club_id}/teams/${user.team_id}?userId=${user.id}`);
        if (td?.team?.display_name) myTeamNames = [td.team.display_name];
      } catch (_) {
        /* ignore */
      }
    }

    const matches =
      myTeamNames.length === 0
        ? []
        : mergeAwayMatchesForMyTeams(allMatches, clubName, myTeamNames);


    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <h1>🚗 Carpool</h1>
          <p>Rij samen naar de uitwedstrijd</p>
        </div>
      </div>
      <div class="container">
        ${
          myTeamNames.length === 0
            ? `
          <div class="empty-state"><div class="empty-icon">👕</div><p>Geen team gevonden voor carpool. Word lid van een team (profiel) of kies je hoofdteam, dan verschijnen hier je uitwedstrijden.</p></div>`
            : matches.length === 0
            ? `
          <div class="empty-state"><div class="empty-icon">📅</div><p>Geen aankomende uitwedstrijden voor jouw team${myTeamNames.length > 1 ? 's' : ''}.</p></div>`
            : `
          <p class="text-muted mb-3" style="font-size:0.875rem">Kies een uitwedstrijd om de carpool te bekijken:</p>
          ${matches
            .map(
              (m, i) => `
            <div class="match-card" style="cursor:pointer" data-carpool-idx="${i}">
              <div class="match-card-teams">
                <div class="match-team-name home">${escHtml(m.home_team || '—')}</div>
                <div class="match-score tbd">vs</div>
                <div class="match-team-name away">${escHtml(m.away_team || '—')}</div>
              </div>
              <div class="match-card-meta">
                ${m.datetime || m.date ? `<span>📅 ${formatDate(m.datetime || m.date)}</span>` : ''}
                ${m.venue_name ? `<span>📍 ${escHtml(m.venue_name)}</span>` : ''}
              </div>
              <div class="match-carpool-summary text-small text-muted" style="margin-top:0.35rem" data-carpool-stats="${i}" aria-live="polite">…</div>
            </div>`
            )
            .join('')}
        `
        }
      </div>
    `;

    if (matches.length) {
      const uid = user.id;
      Promise.all(
        matches.map((m, i) =>
          api(`/api/carpool/${encodeMatchId(m)}/summary`)
            .then(data => ({ i, data }))
            .catch(() => ({ i, data: null }))
        )
      ).then(results => {
        for (const { i, data } of results) {
          const el = container.querySelector(`[data-carpool-stats="${i}"]`);
          if (!el) continue;
          if (!data?.ok) {
            el.textContent = '\u2014';
            continue;
          }
          const drivers = data.drivers || [];
          const free = Number(data.free_seats) || 0;
          const cars = drivers.map(() => '\uD83D\uDE97').join('');
          const pl = free === 1 ? 'plek vrij' : 'plekken vrij';
          el.innerHTML = `${cars ? `${cars} \u00B7 ` : ''}${free} ${pl}`;

          if (drivers.some(d => d.user_id === uid)) {
            el.closest('.match-card')?.classList.add('carpool-driving');
          }
        }
      });
    }

    container.querySelectorAll('[data-carpool-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const i = parseInt(el.dataset.carpoolIdx, 10);
        const m = matches[i];
        if (m) renderCarpoolForMatch(container, encodeMatchId(m), m);
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escHtml(err.message)}</p></div>`;
  }
}

async function renderCarpoolForMatch(container, matchId, matchInfo = null) {
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const [{ offers }, coachCtx] = await Promise.all([
      api(`/api/carpool/${encodeURIComponent(matchId)}`),
      api('/api/carpool/coach/teams').catch(() => ({ teams: [], moderation_team_ids: [] })),
    ]);
    const manageable = new Set(coachCtx.moderation_team_ids || []);

    const totalAvailable = offers.reduce((sum, o) => sum + o.seats_available, 0);

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;margin-bottom:0.75rem" onclick="navigate('carpool')">← Terug</button>
          <h1 style="font-size:1.15rem">🚗 Carpool</h1>
          ${matchInfo ? `<p>${escHtml(matchInfo.home_team || '—')} vs ${escHtml(matchInfo.away_team || '—')}</p>` : ''}
          ${
            matchInfo?.datetime
              ? `<p style="font-size:0.8rem;opacity:0.8">${formatDate(matchInfo.datetime)} ${formatTime(matchInfo.datetime)}</p>`
              : ''
          }
        </div>
      </div>
      <div class="container">

        <div class="flex gap-2 mb-3" style="flex-wrap:wrap">
          <div class="card" style="flex:1;text-align:center;padding:0.875rem">
            <div style="font-size:1.75rem;font-weight:900;color:var(--success)">${totalAvailable}</div>
            <div class="text-muted text-small">Vrije plekken</div>
          </div>
          <div class="card" style="flex:1;text-align:center;padding:0.875rem">
            <div style="font-size:1.75rem;font-weight:900;color:var(--accent)">${offers.length}</div>
            <div class="text-muted text-small">Chauffeurs</div>
          </div>
        </div>

        <button class="btn btn-primary btn-block mb-4" id="offer-ride-btn">🚗 Ik kan rijden</button>

        <div class="section-header">
          <span class="section-title">Beschikbare liften</span>
        </div>

        <div id="offers-list">
          ${
            offers.length === 0
              ? `
            <div class="empty-state" style="padding:2rem 0">
              <div class="empty-icon">🚗</div>
              <p>Nog geen liften aangeboden. Wees de eerste!</p>
            </div>
          `
              : offers.map(o => renderOfferCard(o, manageable)).join('')
          }
        </div>

      </div>
    `;

    document.getElementById('offer-ride-btn')?.addEventListener('click', () => {
      showOfferModal(matchId, container, matchInfo);
    });

    container.querySelectorAll('.cancel-offer-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const offerId = btn.dataset.offer;
        if (!confirm('Lift aanbod verwijderen?')) return;
        try {
          await api(`/api/carpool/offer/${offerId}`, { method: 'DELETE' });
          showToast('Aanbod verwijderd', 'info');
          renderCarpoolForMatch(container, matchId, matchInfo);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.edit-own-offer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const offer = offers.find(o => String(o.id) === String(btn.dataset.offer));
        if (offer) showEditOwnOfferModal(offer, matchId, container, matchInfo);
      });
    });

    container.querySelectorAll('.coach-edit-offer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const offer = offers.find(o => String(o.id) === String(btn.dataset.offer));
        if (offer) showCoachEditOfferModal(offer, matchId, container, matchInfo);
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escHtml(err.message)}</p></div>`;
  }
}

function renderOfferCard(offer, manageableTeamIds) {
  const userId = window.appState?.user?.id;
  const isOwn = offer.user_id === userId;
  const seats = offer.seats_available;
  const coachManage = offer.team_id && manageableTeamIds.has(offer.team_id);

  let actions = '';
  if (isOwn && !coachManage) {
    actions = `<div class="flex gap-2" style="flex-wrap:wrap;margin-top:0.5rem">
      <button class="btn btn-secondary btn-sm edit-own-offer-btn" data-offer="${offer.id}">✏️ Bewerken</button>
      <button class="btn btn-secondary btn-sm cancel-offer-btn" data-offer="${offer.id}">Annuleren</button>
    </div>`;
  }

  const coachRow = coachManage
    ? `<div class="flex gap-2" style="flex-wrap:wrap;margin-top:0.5rem">
         <button type="button" class="btn btn-secondary btn-sm coach-edit-offer-btn" data-offer="${offer.id}">✏️ Bewerken</button>
         <button type="button" class="btn btn-secondary btn-sm cancel-offer-btn" data-offer="${offer.id}">Verwijder lift</button>
       </div>`
    : '';

  return `
    <div class="carpool-offer">
      <div class="carpool-offer-header">
        ${renderAvatar(offer.driver_name, offer.driver_avatar, 'sm')}
        <div>
          <div style="font-weight:700;font-size:0.9rem">${escHtml(offer.driver_name)}</div>
          ${offer.departure_point ? `<div class="text-muted text-small">📍 ${escHtml(offer.departure_point)}</div>` : ''}
          ${offer.departure_time ? `<div class="text-muted text-small">🕐 ${escHtml(offer.departure_time)}</div>` : ''}
        </div>
        <span class="carpool-seats">${seats} plekk${seats === 1 ? '' : 'en'} vrij</span>
      </div>

      ${offer.note ? `<p class="text-muted" style="font-size:0.85rem;margin-bottom:0.75rem">${escHtml(offer.note)}</p>` : ''}

      ${actions}
      ${coachRow}
    </div>`;
}

function showEditOwnOfferModal(offer, matchId, container, matchInfo) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">✏️ Lift bewerken</h3>
      <form id="eoo-form">
        <div class="form-group">
          <label class="form-label">Aantal vrije plekken</label>
          <input type="number" id="eoo-seats" class="form-input" min="1" max="8" required />
        </div>
        <div class="form-group">
          <label class="form-label">Vertrekpunt</label>
          <input type="text" id="eoo-point" class="form-input" placeholder="Bijv. Parkeerplaats Jumbo" />
        </div>
        <div class="form-group">
          <label class="form-label">Vertrektijd</label>
          <input type="text" id="eoo-time" class="form-input" placeholder="Bijv. 13:30" />
        </div>
        <div class="form-group">
          <label class="form-label">Opmerking</label>
          <input type="text" id="eoo-note" class="form-input" placeholder="Bijv. Bel me even van tevoren" />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" style="flex:1" id="eoo-cancel">Sluiten</button>
          <button type="submit" class="btn btn-primary" style="flex:1" id="eoo-save">Opslaan</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('eoo-seats').value = String(offer.seats_available);
  document.getElementById('eoo-point').value = offer.departure_point || '';
  document.getElementById('eoo-time').value = offer.departure_time || '';
  document.getElementById('eoo-note').value = offer.note || '';
  overlay.querySelector('#eoo-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#eoo-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = overlay.querySelector('#eoo-save');
    btn.disabled = true;
    try {
      await api(`/api/carpool/offer/${offer.id}`, {
        method: 'PATCH',
        body: {
          seats_available: parseInt(document.getElementById('eoo-seats').value, 10),
          departure_point: document.getElementById('eoo-point').value || null,
          departure_time: document.getElementById('eoo-time').value || null,
          note: document.getElementById('eoo-note').value || null,
        },
      });
      overlay.remove();
      showToast('Opgeslagen', 'success');
      renderCarpoolForMatch(container, matchId, matchInfo);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

function showCoachEditOfferModal(offer, matchId, container, matchInfo) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">✏️ Lift bewerken (coach)</h3>
      <form id="cco-form">
        <div class="form-group">
          <label class="form-label">Vrije plekken (passagiers)</label>
          <input type="number" id="cco-seats" class="form-input" min="1" max="12" required />
        </div>
        <div class="form-group">
          <label class="form-label">Vertrekpunt</label>
          <input type="text" id="cco-point" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">Vertrektijd</label>
          <input type="text" id="cco-time" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">Opmerking</label>
          <input type="text" id="cco-note" class="form-input" />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" style="flex:1" id="cco-cancel">Sluiten</button>
          <button type="submit" class="btn btn-primary" style="flex:1" id="cco-save">Opslaan</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('cco-seats').value = String(offer.seats_available);
  document.getElementById('cco-point').value = offer.departure_point || '';
  document.getElementById('cco-time').value = offer.departure_time || '';
  document.getElementById('cco-note').value = offer.note || '';
  overlay.querySelector('#cco-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cco-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = overlay.querySelector('#cco-save');
    btn.disabled = true;
    try {
      await api(`/api/carpool/coach/offer/${offer.id}`, {
        method: 'PATCH',
        body: {
          seats_available: parseInt(document.getElementById('cco-seats').value, 10),
          departure_point: document.getElementById('cco-point').value || null,
          departure_time: document.getElementById('cco-time').value || null,
          note: document.getElementById('cco-note').value || null,
        },
      });
      overlay.remove();
      showToast('Opgeslagen', 'success');
      renderCarpoolForMatch(container, matchId, matchInfo);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
    }
  });
}

function showOfferModal(matchId, container, matchInfo = null) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:340px">
      <h3 style="margin-bottom:1rem">🚗 Lift aanbieden</h3>
      <form id="offer-form">
        <div class="form-group">
          <label class="form-label">Aantal vrije plekken</label>
          <input type="number" id="offer-seats" class="form-input" value="3" min="1" max="8" required />
        </div>
        <div class="form-group">
          <label class="form-label">Vertrekpunt (optioneel)</label>
          <input type="text" id="offer-point" class="form-input" placeholder="Bijv. Parkeerplaats Jumbo" />
        </div>
        <div class="form-group">
          <label class="form-label">Vertrektijd (optioneel)</label>
          <input type="text" id="offer-time" class="form-input" placeholder="Bijv. 13:30" />
        </div>
        <div class="form-group">
          <label class="form-label">Opmerking (optioneel)</label>
          <input type="text" id="offer-note" class="form-input" placeholder="Bijv. Bel me even van tevoren" />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" style="flex:1" onclick="this.closest('.badge-unlock-overlay').remove()">Annuleren</button>
          <button type="submit" class="btn btn-primary" style="flex:1" id="offer-submit">Aanbieden</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('offer-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('offer-submit');
    btn.disabled = true;
    btn.textContent = 'Bezig…';
    try {
      await api(`/api/carpool/${encodeURIComponent(matchId)}/offer`, {
        method: 'POST',
        body: {
          seats_available: parseInt(document.getElementById('offer-seats').value, 10),
          departure_point: document.getElementById('offer-point').value || null,
          departure_time: document.getElementById('offer-time').value || null,
          note: document.getElementById('offer-note').value || null,
        },
      });
      overlay.remove();
      showToast('Lift aangeboden! 🚗', 'success');
      renderCarpoolForMatch(container, matchId, matchInfo);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Aanbieden';
    }
  });
}

function renderLoginPrompt() {
  return `<div class="empty-state"><div class="empty-icon">🚗</div><p>Log in om carpool te gebruiken.</p></div>`;
}
