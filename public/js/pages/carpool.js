import { api, state, renderAvatar, formatDate, formatTime, showToast } from '../app.js';

export async function render(container, params = {}) {
  container.innerHTML = '<div class="spinner"></div>';

  const user = state.user;
  if (!user) { container.innerHTML = renderLoginPrompt(); return; }

  // If called with a specific matchId, jump straight to that match's carpool
  if (params.matchId) {
    renderCarpoolForMatch(container, decodeURIComponent(params.matchId));
    return;
  }

  // Otherwise show the main carpool landing: pick a match from schedule
  if (!user.club_id) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🚗</div><h3>Geen club gekoppeld</h3><p>Stel eerst je club in.</p><button class="btn btn-primary mt-3" onclick="navigate('profile')">Profiel instellen</button></div>`;
    return;
  }

  try {
    const clubData = await api(`/api/clubs/${user.club_id}`);
    const { matches: allMatches } = await api(`/api/nevobo/club/${clubData.club.nevobo_code}/schedule`).catch(() => ({ matches: [] }));

    // Only show away games — home games don't need carpool
    const clubNameLower = (clubData.club.name || '').toLowerCase();
    const matches = allMatches.filter(m =>
      !clubNameLower || !(m.home_team || '').toLowerCase().includes(clubNameLower)
    );

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <h1>🚗 Carpool</h1>
          <p>Rij samen naar de uitwedstrijd</p>
        </div>
      </div>
      <div class="container">
        ${matches.length === 0 ? `
          <div class="empty-state"><div class="empty-icon">📅</div><p>Geen aankomende uitwedstrijden gevonden.</p></div>
        ` : `
          <p class="text-muted mb-3" style="font-size:0.875rem">Kies een uitwedstrijd om de carpool te bekijken:</p>
          ${matches.map((m, i) => `
            <div class="match-card" style="cursor:pointer" onclick="carpoolSelectMatch(${i})">
              <div class="match-card-teams">
                <div class="match-team-name home">${m.home_team || '—'}</div>
                <div class="match-score tbd">vs</div>
                <div class="match-team-name away">${m.away_team || '—'}</div>
              </div>
              <div class="match-card-meta">
                ${m.datetime || m.date ? `<span>📅 ${formatDate(m.datetime || m.date)}</span>` : ''}
                ${m.venue_name ? `<span>📍 ${m.venue_name}</span>` : ''}
              </div>
            </div>
          `).join('')}
        `}
      </div>
    `;

    window.carpoolSelectMatch = (idx) => {
      const m = matches[idx];
      const matchId = m.match_number || m.title || String(idx);
      renderCarpoolForMatch(container, matchId, m);
    };

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

async function renderCarpoolForMatch(container, matchId, matchInfo = null) {
  container.innerHTML = '<div class="spinner"></div>';

  try {
    const { offers } = await api(`/api/carpool/${encodeURIComponent(matchId)}`);

    const totalAvailable = offers.reduce((sum, o) => sum + (o.seats_available - o.booked_seats), 0);

    container.innerHTML = `
      <div class="page-hero">
        <div class="container">
          <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;margin-bottom:0.75rem" onclick="navigate('carpool')">← Terug</button>
          <h1 style="font-size:1.15rem">🚗 Carpool</h1>
          ${matchInfo ? `<p>${matchInfo.home_team || '—'} vs ${matchInfo.away_team || '—'}</p>` : ''}
          ${matchInfo?.datetime ? `<p style="font-size:0.8rem;opacity:0.8">${formatDate(matchInfo.datetime)} ${formatTime(matchInfo.datetime)}</p>` : ''}
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
          ${offers.length === 0 ? `
            <div class="empty-state" style="padding:2rem 0">
              <div class="empty-icon">🚗</div>
              <p>Nog geen liften aangeboden. Wees de eerste!</p>
            </div>
          ` : offers.map(o => renderOfferCard(o)).join('')}
        </div>

      </div>
    `;

    // Offer ride button
    document.getElementById('offer-ride-btn')?.addEventListener('click', () => {
      showOfferModal(matchId, container);
    });

    // Book seat buttons
    container.querySelectorAll('.book-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const offerId = btn.dataset.offer;
        btn.disabled = true;
        try {
          await api(`/api/carpool/offer/${offerId}/book`, { method: 'POST' });
          showToast('Plek geboekt! 🚗', 'success');
          renderCarpoolForMatch(container, matchId, matchInfo);
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
        }
      });
    });

    // Cancel offer buttons
    container.querySelectorAll('.cancel-offer-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const offerId = btn.dataset.offer;
        if (!confirm('Wil je je lift aanbod annuleren?')) return;
        try {
          await api(`/api/carpool/offer/${offerId}`, { method: 'DELETE' });
          showToast('Aanbod geannuleerd', 'info');
          renderCarpoolForMatch(container, matchId, matchInfo);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // Cancel booking buttons
    container.querySelectorAll('.cancel-booking-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const bookingId = btn.dataset.booking;
        if (!confirm('Wil je je boeking annuleren?')) return;
        try {
          await api(`/api/carpool/booking/${bookingId}`, { method: 'DELETE' });
          showToast('Boeking geannuleerd', 'info');
          renderCarpoolForMatch(container, matchId, matchInfo);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

function renderOfferCard(offer) {
  const userId = window.appState?.user?.id;
  const isOwn = offer.user_id === userId;
  const free = offer.seats_available - offer.booked_seats;
  const isFull = free <= 0;
  const myBooking = offer.bookings.find(b => b.user_id === userId);

  return `
    <div class="carpool-offer">
      <div class="carpool-offer-header">
        ${renderAvatar(offer.driver_name, offer.driver_avatar, 'sm')}
        <div>
          <div style="font-weight:700;font-size:0.9rem">${offer.driver_name}</div>
          ${offer.departure_point ? `<div class="text-muted text-small">📍 ${offer.departure_point}</div>` : ''}
          ${offer.departure_time ? `<div class="text-muted text-small">🕐 ${offer.departure_time}</div>` : ''}
        </div>
        <span class="carpool-seats ${isFull ? 'full' : ''}">
          ${isFull ? 'Vol' : `${free} plekk${free === 1 ? '' : 'en'} vrij`}
        </span>
      </div>

      ${offer.note ? `<p class="text-muted" style="font-size:0.85rem;margin-bottom:0.75rem">${offer.note}</p>` : ''}

      ${offer.bookings.length > 0 ? `
        <div class="carpool-passengers mb-2">
          ${offer.bookings.map(b => renderAvatar(b.passenger_name, b.passenger_avatar, 'sm')).join('')}
        </div>
      ` : ''}

      <div class="flex gap-2" style="flex-wrap:wrap">
        ${isOwn ? `<button class="btn btn-secondary btn-sm cancel-offer-btn" data-offer="${offer.id}">Annuleren</button>` :
          myBooking ? `<button class="btn btn-secondary btn-sm cancel-booking-btn" data-booking="${myBooking.id}">Boeking annuleren</button>` :
          isFull ? `<span class="chip chip-neutral">Vol</span>` :
          `<button class="btn btn-accent btn-sm book-btn" data-offer="${offer.id}">Plek reserveren 🙋</button>`
        }
      </div>
    </div>`;
}

function showOfferModal(matchId, container) {
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
    btn.disabled = true; btn.textContent = 'Bezig…';
    try {
      await api(`/api/carpool/${encodeURIComponent(matchId)}/offer`, {
        method: 'POST',
        body: {
          seats_available: parseInt(document.getElementById('offer-seats').value),
          departure_point: document.getElementById('offer-point').value || null,
          departure_time: document.getElementById('offer-time').value || null,
          note: document.getElementById('offer-note').value || null,
        },
      });
      overlay.remove();
      showToast('Lift aangeboden! 🚗', 'success');
      renderCarpoolForMatch(container, matchId);
    } catch (err) {
      showToast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Aanbieden';
    }
  });
}

function renderLoginPrompt() {
  return `<div class="empty-state"><div class="empty-icon">🚗</div><p>Log in om carpool te gebruiken.</p></div>`;
}
