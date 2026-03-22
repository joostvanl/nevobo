import { api, state, renderAvatar, renderClubLogo, formatDate, formatTime, showToast, navigate, showQualityWarningModal } from '../app.js';
import { openReelViewer } from '../reel-viewer.js';
import { buildReelStripCardsHtml, setupReelStripVideoAutoplay } from '../reel-strip.js';
import { escHtml } from '../escape-html.js';
import { FilePicker } from '../file-picker.js';
import { isDetached } from '../dom-guards.js';
import { renderCompactMatch as renderCompactMatchRow } from '../team-schedule-helpers.js';
import { encodeMatchId, awayMatchesForTeam, countPlayersAndCoachesTravelers } from './carpool.js';

let _ccCtx = null;

/**
 * Params:
 *   { teamId, clubId }           – own-club team (from DB)
 *   { teamName, nevoboCode }     – any team by name from Nevobo RSS (opponents etc.)
 */
export async function render(container, params = {}) {
  container.innerHTML = '<div class="spinner"></div>';

  const userId = state.user?.id;
  const userQuery = userId ? `?userId=${userId}` : '';

  // ── Route A: DB team (own club) ──────────────────────────────────────────
  if (params.teamId && params.clubId) {
    let data;
    try {
      data = await api(`/api/clubs/${params.clubId}/teams/${params.teamId}${userQuery}`);
    } catch (err) {
      if (!isDetached(container)) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escHtml(err.message)}</p></div>`;
      }
      return;
    }
    if (isDetached(container)) return;

    const { team, club, members, followerCount, isOwnTeam } = data;
    const { isFollowing } = data;

    // Render immediately with DB data — Nevobo loads lazily
    renderPage(container, {
      displayName: team.display_name,
      clubName: club.name,
      nevoboCode: club.nevobo_code,
      homeAddress: club.home_address || null,
      members,
      followerCount,
      isOwnTeam,
      isFollowing,
      schedule: null,   // null = still loading
      results:  null,
      wins: null, losses: null, draws: null,
      teamId: team.id,
      teamName: null,
    });

    // Fetch Nevobo data in background and fill in placeholders
    const q = `name=${encodeURIComponent(team.display_name)}&code=${encodeURIComponent(club.nevobo_code)}${userId ? '&userId=' + userId : ''}`;
    api(`/api/nevobo/team-by-name?${q}`)
      .then(teamData => fillNevoboData(container, teamData, team.display_name, club.nevobo_code))
      .catch(() => fillNevoboData(container, null, team.display_name, club.nevobo_code));
    return;
  }

  // ── Route B: external team by name (opponents) ───────────────────────────
  const { teamName, nevoboCode } = params;
  if (!teamName || !nevoboCode) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">👕</div><p>Onvoldoende gegevens om team te laden.</p></div>`;
    return;
  }

  let data;
  try {
    const q = `name=${encodeURIComponent(teamName)}&code=${encodeURIComponent(nevoboCode)}${userId ? '&userId=' + userId : ''}`;
    data = await api(`/api/nevobo/team-by-name?${q}`);
  } catch (err) {
    if (!isDetached(container)) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escHtml(err.message)}</p></div>`;
    }
    return;
  }
  if (isDetached(container)) return;

  const effectiveCode = data.resolvedNevoboCode || nevoboCode;
  renderPage(container, {
    displayName: data.teamName,
    clubName: data.dbTeam?.club_name || effectiveCode.toUpperCase(),
    nevoboCode: effectiveCode,
    members: data.members || [],
    followerCount: data.followerCount,
    isOwnTeam: data.isOwnTeam,
    isFollowing: data.isFollowing,
    schedule: (data.schedule || []).slice(0, 5),
    results:  (data.results  || []),
    wins: data.wins, losses: data.losses, draws: data.draws,
    teamId: data.dbTeam?.id || null,
    teamName: data.dbTeam ? null : teamName,
    clubNameForFollow: data.dbTeam?.club_name || effectiveCode,
  });
}

// ─── Shared render ────────────────────────────────────────────────────────────
function renderPage(container, opts) {
  const {
    displayName, clubName, members, followerCount,
    isOwnTeam,
    nevoboCode, clubNameForFollow, pouleCodes = [],
    homeAddress = null,
  } = opts;
  let { isFollowing, teamId, teamName } = opts;

  const loading = opts.schedule === null;
  const schedule = opts.schedule || [];
  const results  = opts.results  || [];
  const wins     = opts.wins     || 0;
  const losses   = opts.losses   || 0;
  const draws    = opts.draws    || 0;

  const totalPlayed = wins + losses + draws;

  // Alleen spelers en coaches mogen media toevoegen; begeleiders en ouders niet
  const currentUserMembership = (opts.members || []).find(m => m.id === state.user?.id)?.membership_type;
  const canAddTeamMedia = !!(state.user && (currentUserMembership === 'player' || currentUserMembership === 'coach'));

  const nevoboSkeleton = `<div class="spinner"></div>`;

  container.innerHTML = `
    <div class="team-hero">
      <div class="container">
        <button class="btn team-back-btn" onclick="history.back()">← Terug</button>

        <div class="team-hero-body">
          ${renderClubLogo(nevoboCode, clubName, 'lg')}
          <div class="team-hero-info">
            <h1 class="team-hero-name">${displayName}</h1>
            <div class="team-hero-club">${clubName}</div>
            <div class="team-hero-stats">
              <span>👥 ${members.filter(u => !u.membership_type || u.membership_type === 'player' || u.membership_type === 'coach' || u.membership_type === 'staff').length} leden</span>
              <span>📣 ${followerCount} volger${followerCount !== 1 ? 's' : ''}</span>
              ${totalPlayed > 0 ? `<span>🏐 ${totalPlayed} gespeeld</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Prominent follow block -->
        <div class="team-follow-block">
          ${isOwnTeam
            ? `<div class="team-own-badge-row">
                <div class="team-own-badge">✅ Jouw team</div>
                ${canAddTeamMedia ? `
                  <div class="team-social-hero-btns">
                    <button class="team-social-btn" id="hero-add-tiktok-btn" title="TikTok video toevoegen">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.3 6.3 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.18 8.18 0 004.78 1.52V6.77a4.85 4.85 0 01-1.01-.08z"/></svg>
                    </button>
                    <button class="team-social-btn team-social-btn--ig" id="hero-add-instagram-btn" title="Instagram post/reel toevoegen">
                      <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                    </button>
                    <button class="team-social-btn team-social-btn--media" id="hero-add-photo-btn" title="Foto toevoegen">
                      <span aria-hidden="true">📷</span>
                    </button>
                    <button class="team-social-btn team-social-btn--media" id="hero-add-video-btn" title="Video toevoegen">
                      <span aria-hidden="true">🎥</span>
                    </button>
                    <button class="team-social-btn team-social-btn--media" id="hero-add-upload-btn" title="Bestand uploaden">
                      <span aria-hidden="true">⬆️</span>
                    </button>
                  </div>` : ''}
              </div>`
            : state.user
              ? `<button class="team-follow-btn-big ${isFollowing ? 'following' : ''}" id="follow-btn">
                  <span class="follow-btn-icon">${isFollowing ? '✓' : '+'}</span>
                  <span class="follow-btn-label">${isFollowing ? 'Gevolgd' : 'Volgen'}</span>
                  ${isFollowing ? '<span class="follow-btn-sub">Tik om te ontvolgen</span>' : '<span class="follow-btn-sub">Ontvang updates van dit team</span>'}
                </button>`
              : `<p style="color:rgba(255,255,255,0.75);font-size:0.85rem">Log in om dit team te volgen</p>`
          }
        </div>
      </div>
    </div>

    <!-- Team media reel — loads async, shown before other content -->
    <div id="team-media"></div>

    <!-- Trainingen deze week -->
    <div id="team-training-schedule" class="container"></div>

    <div class="container">

      <!-- Season record — skeleton while loading -->
      <div id="team-record">
        ${loading ? `
          <div class="card mb-3">
            <div class="card-header"><h3>📊 Seizoensrecord</h3></div>
            <div class="card-body">${nevoboSkeleton}</div>
          </div>` : totalPlayed > 0 ? `
          <div class="card mb-3">
            <div class="card-header"><h3>📊 Seizoensrecord</h3></div>
            <div class="card-body">
              <div class="team-record">
                <div class="record-item win">
                  <div class="record-num">${wins}</div>
                  <div class="record-lbl">Gewonnen</div>
                </div>
                <div class="record-divider"></div>
                <div class="record-item loss">
                  <div class="record-num">${losses}</div>
                  <div class="record-lbl">Verloren</div>
                </div>
                ${draws > 0 ? `
                  <div class="record-divider"></div>
                  <div class="record-item draw">
                    <div class="record-num">${draws}</div>
                    <div class="record-lbl">Gelijk</div>
                  </div>` : ''}
              </div>
            </div>
          </div>` : ''}
      </div>

      <!-- Upcoming matches — skeleton while loading -->
      <div class="card mb-3">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.35rem">
          <h3>📅 Aankomende wedstrijden</h3>
          ${isOwnTeam ? `<button type="button" class="btn btn-ghost btn-sm team-schedule-carpool-link" style="font-size:0.75rem;padding:0.25rem 0.55rem;white-space:nowrap">🚗 Bekijk liften →</button>` : ''}
        </div>
        <div class="card-body" style="padding:0" id="schedule-list">
          ${loading ? nevoboSkeleton
            : schedule.length === 0
              ? `<p class="text-muted text-small" style="padding:1rem">Geen geplande wedstrijden gevonden.</p>`
              : schedule.map((m, i) => renderCompactMatchRow(m, false, displayName, nevoboCode, formatDate, formatTime, i)).join('')}
        </div>
      </div>

      <!-- Results — skeleton while loading -->
      <div class="card mb-3">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <h3 id="results-header">🏐 Uitslagen${loading ? '' : ` (${results.length})`}</h3>
          ${!loading && !isOwnTeam ? `<span class="chip chip-secondary" style="font-size:0.65rem" title="Gebaseerd op clubs die ook deze app gebruiken">geregistreerde clubs</span>` : ''}
        </div>
        <div class="card-body" style="padding:0" id="results-list">
          ${loading ? nevoboSkeleton
            : results.length === 0
              ? `<p class="text-muted text-small" style="padding:1rem">Nog geen resultaten gevonden${isOwnTeam ? '' : ' — dit team heeft nog niet gespeeld tegen andere clubs in de app'}.</p>`
              : results.slice(0, 5).map(m => renderCompactMatchRow(m, true, displayName, nevoboCode, formatDate, formatTime)).join('')}
          ${!loading && results.length > 5 ? `
            <div id="results-more" style="display:none">
              ${results.slice(5).map(m => renderCompactMatchRow(m, true, displayName, nevoboCode, formatDate, formatTime)).join('')}
            </div>
            <button id="results-toggle" class="btn btn-ghost btn-sm" style="width:100%;padding:0.6rem;border-top:1px solid var(--border);border-radius:0">
              Toon alle ${results.length} uitslagen ↓
            </button>` : ''}
        </div>
      </div>

      <!-- Poule standings — loaded async, shown between results and members -->
      <div id="poule-stands">
        <div class="card mb-3">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
            <h3>🏆 Competitiestand</h3>
            <div class="spinner" style="width:16px;height:16px;border-width:2px"></div>
          </div>
        </div>
      </div>

      <!-- Members: players first, then coaching staff -->
      ${(() => {
        const players = members.filter(u => !u.membership_type || u.membership_type === 'player');
        const staff   = members.filter(u => u.membership_type === 'coach' || u.membership_type === 'staff');
        // parents are intentionally excluded from public view
        const ROLE_LABEL = { coach: 'Trainer/Coach', staff: 'Begeleiding' };
        const memberCard = (u) => `
          <div class="team-member-row">
            ${renderAvatar(u.name, u.avatar_url, 'sm')}
            <div class="team-member-info">
              <div class="team-member-name">${u.name}</div>
              <div class="text-muted text-small">Level ${u.level} · ${u.xp} XP</div>
            </div>
            <div class="team-member-level">Lvl ${u.level}</div>
          </div>`;
        const sections = [];
        if (players.length > 0) sections.push(`
          <div class="card mb-3">
            <div class="card-header"><h3>🏐 Spelers (${players.length})</h3></div>
            <div class="card-body" style="padding:0.5rem">
              ${players.map(memberCard).join('')}
            </div>
          </div>`);
        if (staff.length > 0) sections.push(`
          <div class="card mb-3">
            <div class="card-header"><h3>📋 Trainer / Coach &amp; Begeleiding</h3></div>
            <div class="card-body" style="padding:0.5rem">
              ${staff.map(u => `
                <div class="team-member-row">
                  ${renderAvatar(u.name, u.avatar_url, 'sm')}
                  <div class="team-member-info">
                    <div class="team-member-name">${u.name}
                      <span class="chip chip-primary" style="font-size:0.62rem;margin-left:0.35rem">${ROLE_LABEL[u.membership_type] || u.membership_type}</span>
                    </div>
                    <div class="text-muted text-small">Level ${u.level} · ${u.xp} XP</div>
                  </div>
                  <div class="team-member-level">Lvl ${u.level}</div>
                </div>`).join('')}
            </div>
          </div>`);
        return sections.join('');
      })()}

      ${isOwnTeam && currentUserMembership === 'coach' ? (() => {
        const tCount = countPlayersAndCoachesTravelers(members);
        const poolHtml = members.map(m => `
          <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;margin-bottom:0.35rem;cursor:pointer">
            <input type="checkbox" class="cc-pool-cb" value="${m.id}" checked />
            <span>${escHtml(m.name)} <span class="text-muted">(${escHtml(m.membership_type || 'speler')})</span></span>
          </label>`).join('');
        return `
      <div class="card mb-3" id="coach-carpool-card">
        <div class="card-header" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center" id="cc-collapse-header">
          <h3>🚗 Teamcarpool plannen</h3>
          <span class="stand-chevron" style="font-size:0.75rem;opacity:0.6">▼</span>
        </div>
        <div id="cc-collapse-body" style="display:none">
          <div class="card-body" style="padding:1rem">
            <p class="text-muted text-small" style="margin-bottom:0.75rem;line-height:1.45">
              Kies de chauffeurspool en uitwedstrijden. Chauffeurs roteren eerlijk (minst gereden eerst).
              Bestaande teamcarpool-aanboden worden vervangen.
            </p>
            <div class="form-group">
              <label class="form-label">Totaal spelers en coaches</label>
              <input type="number" id="cc-travelers" class="form-input" min="1" max="200" value="${Math.max(1, tCount)}" />
              <p class="text-muted text-small mb-0 mt-1">Automatisch geteld. Pas aan als niet iedereen meereist.</p>
            </div>
            <div class="form-group">
              <label class="form-label">Personen per auto (max.)</label>
              <input type="number" id="cc-seats-car" class="form-input" min="2" max="8" value="4" />
            </div>
            <div class="form-group">
              <label class="form-label">Chauffeurspool</label>
              <div id="cc-pool" class="cc-check-grid" style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem">${poolHtml}</div>
            </div>
            <div class="form-group">
              <label class="form-label">Uitwedstrijden</label>
              <div class="flex gap-2 mb-1" style="flex-wrap:wrap">
                <button type="button" class="btn btn-ghost btn-sm" id="cc-all-matches">Alles aan</button>
                <button type="button" class="btn btn-ghost btn-sm" id="cc-no-matches">Alles uit</button>
              </div>
              <div id="cc-matches" class="cc-check-grid" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem">
                ${loading ? '<div class="spinner" style="margin:0.5rem auto"></div>' : '<p class="text-muted text-small">Geen uitwedstrijden gevonden.</p>'}
              </div>
            </div>
            <button type="button" class="btn btn-primary btn-block" id="cc-submit">Genereer carpool</button>
            <p class="text-muted text-small mt-2 mb-0" id="cc-hint"></p>
          </div>
        </div>
      </div>`;
      })() : ''}

    </div>`;

  // ── Verzameltijden asynchroon laden ──────────────────────────────────────
  if (isOwnTeam && schedule.length > 0) {
    const scheduleList = container.querySelector('#schedule-list');
    if (scheduleList) loadMeetupTimes(scheduleList, schedule, displayName, homeAddress);
  }

  container.querySelector('.team-schedule-carpool-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('carpool');
  });

  // ── Coach carpool planner ───────────────────────────────────────────────
  _ccCtx = null;
  container.querySelector('#cc-collapse-header')?.addEventListener('click', () => {
    const body = document.getElementById('cc-collapse-body');
    const chevron = container.querySelector('#cc-collapse-header .stand-chevron');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chevron) chevron.textContent = open ? '▼' : '▲';
  });

  if (isOwnTeam && opts.teamId && container.querySelector('#coach-carpool-card')) {
    _ccCtx = { teamId: opts.teamId, clubName: opts.clubName || '', displayName, awayMatches: [] };

    const updateHint = () => {
      const poolEl = document.getElementById('cc-pool');
      const hintEl = document.getElementById('cc-hint');
      if (!poolEl || !hintEl) return;
      const tr = parseInt(document.getElementById('cc-travelers')?.value, 10) || 1;
      const sc = Math.max(2, parseInt(document.getElementById('cc-seats-car')?.value, 10) || 4);
      const cars = Math.ceil(tr / sc);
      const poolN = poolEl.querySelectorAll('.cc-pool-cb:checked').length;
      const hasMatches = _ccCtx.awayMatches.length > 0;
      hintEl.textContent =
        hasMatches && poolN >= cars
          ? `\u2248 ${cars} auto(s) per wedstrijd; pool heeft ${poolN} chauffeur(s).`
          : poolN < cars
            ? `Let op: je pool heeft minstens ${cars} personen nodig.`
            : '';
    };

    document.getElementById('cc-travelers')?.addEventListener('input', updateHint);
    document.getElementById('cc-seats-car')?.addEventListener('input', updateHint);
    document.getElementById('cc-pool')?.addEventListener('change', updateHint);
    document.getElementById('cc-all-matches')?.addEventListener('click', () => {
      document.querySelectorAll('.cc-match-cb').forEach(cb => { cb.checked = true; });
    });
    document.getElementById('cc-no-matches')?.addEventListener('click', () => {
      document.querySelectorAll('.cc-match-cb').forEach(cb => { cb.checked = false; });
    });

    document.getElementById('cc-submit')?.addEventListener('click', async () => {
      const totalTravelers = parseInt(document.getElementById('cc-travelers').value, 10);
      const seatsPerCar = parseInt(document.getElementById('cc-seats-car').value, 10);
      const pool = [...document.querySelectorAll('.cc-pool-cb:checked')].map(cb => parseInt(cb.value, 10));
      const matchIds = [...document.querySelectorAll('.cc-match-cb:checked')].map(cb => {
        const idx = parseInt(cb.dataset.ccMidx, 10);
        return encodeMatchId(_ccCtx.awayMatches[idx]);
      });
      if (!matchIds.length) { showToast('Kies minimaal \u00e9\u00e9n wedstrijd', 'error'); return; }
      if (!pool.length) { showToast('Kies minimaal \u00e9\u00e9n persoon in de pool', 'error'); return; }

      const btn = document.getElementById('cc-submit');
      btn.disabled = true;
      btn.textContent = 'Bezig\u2026';
      try {
        const res = await api('/api/carpool/coach/plan-season', {
          method: 'POST',
          body: { team_id: _ccCtx.teamId, match_ids: matchIds, total_travelers: totalTravelers, seats_per_car: seatsPerCar, pool_user_ids: pool },
        });
        const n = res.total_cars_added || 0;
        const w = res.planned_matches || 0;
        showToast(n === 0
          ? `${w} wedstrijd(en) bekeken \u2014 bestaande liften dekken de vraag al`
          : `${n} auto('s) toegevoegd voor ${w} wedstrijd(en) \ud83d\ude97`, 'success');
      } catch (err) {
        showToast(err.message || 'Mislukt', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Genereer carpool';
      }
    });

    updateHint();
  }

  // ── Match row click handlers ─────────────────────────────────────────────
  // Whole row → navigate to match detail in matches page
  container.querySelectorAll('.compact-match-row.clickable-row').forEach(row => {
    row.addEventListener('click', e => {
      const matchId  = row.dataset.matchId;
      const teamName = row.dataset.teamName;
      const nCode    = row.dataset.nevoboCode;
      navigate('matches', { matchId, teamName, nevoboCode: nCode });
    });
  });

  // ── Load team media async ──────────────────────────────────────────────────
  if (opts.teamId) {
    loadTeamMedia(opts.teamId, displayName, nevoboCode);
  } else {
    // No DB team id — hide the media placeholder
    const mediaEl = document.getElementById('team-media');
    if (mediaEl) mediaEl.remove();
  }

  // ── Load training schedule async ───────────────────────────────────────────
  const trainingEl = document.getElementById('team-training-schedule');
  if (trainingEl && teamId) {
    (async () => {
      try {
        const data = await api(`/api/training/team/${teamId}/schedule`);
        const ts = data.trainings || [];
        const dayNames = ['Maandag','Dinsdag','Woensdag','Donderdag','Vrijdag','Zaterdag','Zondag'];
        if (ts.length === 0) {
          trainingEl.innerHTML = '';
          return;
        }

        function isoWeekToDate(isoWeek, dow) {
          const [y, w] = isoWeek.split('-W').map(Number);
          const jan4 = new Date(y, 0, 4);
          const monday = new Date(jan4);
          monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
          const d = new Date(monday);
          d.setDate(monday.getDate() + dow);
          return d.toISOString().slice(0, 10);
        }

        const rows = ts.map(t => {
          const loc = t.location_name ? `${escHtml(t.location_name)} · ` : '';
          const dateStr = isoWeekToDate(data.iso_week, t.day_of_week);
          return `<div class="team-training-row" data-team-id="${teamId}" data-date="${dateStr}" data-start="${t.start_time}" data-end="${t.end_time}" data-venue="${escHtml(t.venue_name || '')}" data-location="${escHtml(t.location_name || '')}" style="padding:0.5rem 1rem;border-bottom:1px solid var(--border);font-size:0.88rem;cursor:pointer;transition:background 0.12s"><strong>${dayNames[t.day_of_week]}</strong> ${t.start_time} – ${t.end_time} · ${loc}${escHtml(t.venue_name)}</div>`;
        }).join('');
        const exLabel = data.is_exception ? ` <span class="chip chip-sm" style="font-size:0.65rem;background:rgba(255,193,7,0.15);color:#d4a017">afwijkend schema</span>` : '';
        trainingEl.innerHTML = `
          <div class="card mb-3">
            <div class="card-header"><h3>🏋️ Trainingen deze week${exLabel}</h3></div>
            <div class="card-body" style="padding:0">${rows}</div>
          </div>`;
        trainingEl.querySelectorAll('.team-training-row').forEach(row => {
          row.addEventListener('mouseenter', () => { row.style.background = 'var(--bg-secondary)'; });
          row.addEventListener('mouseleave', () => { row.style.background = ''; });
          row.addEventListener('click', () => {
            navigate('training-session', {
              teamId: parseInt(row.dataset.teamId, 10),
              date: row.dataset.date,
              startTime: row.dataset.start,
              endTime: row.dataset.end,
              venue: row.dataset.venue,
              location: row.dataset.location,
            });
          });
        });
      } catch (_) { trainingEl.innerHTML = ''; }
    })();
  }

  // ── Load poule standings async ─────────────────────────────────────────────
  const standsEl = document.getElementById('poule-stands');
  if (standsEl && nevoboCode) {
    (async () => {
      try {
        const q = `teamName=${encodeURIComponent(displayName)}&nevoboCode=${encodeURIComponent(nevoboCode)}`;
        const data = await api(`/api/nevobo/poule-stand?${q}`);
        const competitions = data.competitions || [];
        const myName = displayName.toLowerCase().replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'");

        if (competitions.length === 0) {
          standsEl.innerHTML = `
            <div class="card mb-3">
              <div class="card-header"><h3>🏆 Competitiestand</h3></div>
              <div class="card-body"><p class="text-muted text-small">Stand niet beschikbaar.</p></div>
            </div>`;
          return;
        }

        function buildStandTable(rows, compName, positieTekst, isActive, compIdx) {
          const tableRows = rows.map(r => {
            const rNorm = (r.team || '').toLowerCase().replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'");
            const isMe  = rNorm.includes(myName) || myName.includes(rNorm);
            const teamLink = `<a href="#" class="stand-team-link" data-teamname="${escHtml(r.team)}" data-nevobocode="${escHtml(nevoboCode)}">${r.team}</a>`;
            return `<tr class="${isMe ? 'stand-my-team' : ''}">
              <td class="stand-pos">${r.positie}</td>
              <td class="stand-team">${teamLink}</td>
              <td class="stand-num">${r.wedstrijden}</td>
              <td class="stand-num stand-pts">${r.punten}</td>
            </tr>`;
          }).join('');

          const bodyId = `stand-body-${compIdx}`;
          const chevron = isActive ? '▲' : '▼';
          return `
            <div class="card mb-3">
              <div class="card-header stand-comp-header" style="cursor:pointer" data-target="${bodyId}">
                <div>
                  <h3>🏆 ${compName}</h3>
                  ${positieTekst ? `<div class="text-muted text-small" style="margin-top:0.15rem">${positieTekst}</div>` : ''}
                </div>
                <span class="stand-chevron" style="font-size:0.75rem;opacity:0.6">${chevron}</span>
              </div>
              <div id="${bodyId}" style="${isActive ? '' : 'display:none'}">
                <div style="overflow-x:auto">
                  <table class="stand-table">
                    <thead><tr>
                      <th class="stand-pos">#</th>
                      <th class="stand-team">Team</th>
                      <th class="stand-num" title="Wedstrijden gespeeld">W</th>
                      <th class="stand-num stand-pts" title="Punten">Pnt</th>
                    </tr></thead>
                    <tbody>${tableRows}</tbody>
                  </table>
                </div>
              </div>
            </div>`;
        }

        standsEl.innerHTML = competitions
          .map((comp, i) => buildStandTable(comp.standRows || [], comp.compName, comp.positieTekst, comp.isActive, i))
          .join('');

        // Collapse/expand toggle
        standsEl.querySelectorAll('.stand-comp-header').forEach(header => {
          header.addEventListener('click', () => {
            const bodyId = header.dataset.target;
            const body   = document.getElementById(bodyId);
            const chevron = header.querySelector('.stand-chevron');
            if (!body) return;
            const open = body.style.display !== 'none';
            body.style.display = open ? 'none' : '';
            if (chevron) chevron.textContent = open ? '▼' : '▲';
          });
        });

        // Team name links → navigate to team page
        standsEl.querySelectorAll('.stand-team-link').forEach(link => {
          link.addEventListener('click', e => {
            e.preventDefault();
            const teamName = link.dataset.teamname;
            const code     = link.dataset.nevobocode;
            if (teamName) navigate('team', { teamName, nevoboCode: code });
          });
        });
      } catch (_) {
        standsEl.innerHTML = '';
      }
    })();
  }

  // ── Show-more results toggle ─────────────────────────────────────────────
  document.getElementById('results-toggle')?.addEventListener('click', () => {
    const more = document.getElementById('results-more');
    const btn  = document.getElementById('results-toggle');
    const expanded = more.style.display !== 'none';
    more.style.display = expanded ? 'none' : '';
    btn.textContent = expanded ? `Toon alle ${results.length} uitslagen ↓` : 'Minder tonen ↑';
  });

  // ── Hero social media buttons (alleen spelers en coaches mogen media toevoegen) ────────────────────
  if (isOwnTeam && canAddTeamMedia && teamId) {
    const showSocialOverlay = (platform) => {
      // Reuse the overlay in the team-media section if it exists, otherwise create one
      let overlay = document.getElementById('social-url-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'social-url-overlay';
        overlay.className = 'badge-unlock-overlay';
        overlay.innerHTML = `
          <div class="badge-unlock-card" style="max-width:340px;text-align:left;padding:1.5rem">
            <p class="text-muted text-small mb-2" id="social-overlay-hint"></p>
            <input type="url" id="social-overlay-input" class="form-input mb-3" placeholder="Plak hier de URL…" />
            <div class="flex gap-2">
              <button class="btn btn-ghost" id="social-overlay-cancel" style="flex:1">Annuleren</button>
              <button class="btn btn-primary" id="social-overlay-confirm" style="flex:1">Toevoegen</button>
            </div>
          </div>`;
        document.body.appendChild(overlay);

        overlay.querySelector('#social-overlay-cancel').addEventListener('click', () => { overlay.style.display = 'none'; });
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
        overlay.querySelector('#social-overlay-input').addEventListener('keydown', e => {
          if (e.key === 'Enter') overlay.querySelector('#social-overlay-confirm').click();
        });
        overlay.querySelector('#social-overlay-confirm').addEventListener('click', async () => {
          const url = overlay.querySelector('#social-overlay-input').value.trim();
          if (!url) return;
          try {
            await api(`/api/social/teams/${teamId}/social-links`, { method: 'POST', body: { url } });
            showToast('Toegevoegd!', 'success');
            overlay.style.display = 'none';
            await loadTeamMedia(teamId, displayName, nevoboCode);
          } catch (err) { showToast(err.message, 'error'); }
        });
      }
      overlay.querySelector('#social-overlay-hint').textContent = platform === 'tiktok'
        ? 'Plak een TikTok video-URL: https://www.tiktok.com/@user/video/… of https://vm.tiktok.com/…'
        : 'Plak een Instagram post of reel-URL: https://www.instagram.com/reel/…';
      overlay.querySelector('#social-overlay-input').value = '';
      overlay.style.display = 'flex';
      setTimeout(() => overlay.querySelector('#social-overlay-input').focus(), 50);
    };

    document.getElementById('hero-add-tiktok-btn')?.addEventListener('click', () => showSocialOverlay('tiktok'));
    document.getElementById('hero-add-instagram-btn')?.addEventListener('click', () => showSocialOverlay('instagram'));

    // Foto / Video / Upload — Foto en Video direct naar camera in de juiste modus (zoals wedstrijdpagina)
    const openTeamMediaPicker = (accept, useCapture = false) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      if (useCapture) input.capture = 'environment';
      input.multiple = !useCapture && (accept === 'image/*,video/*' || accept === 'image/*');
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const files = Array.from(input.files || []);
        input.remove();
        if (files.length) showTeamCaptionModal(teamId, displayName, nevoboCode, files);
      });
      input.click();
    };

    document.getElementById('hero-add-photo-btn')?.addEventListener('click', () => openTeamMediaPicker('image/*', true));
    document.getElementById('hero-add-video-btn')?.addEventListener('click', () => openTeamMediaPicker('video/*', true));
    document.getElementById('hero-add-upload-btn')?.addEventListener('click', () => showTeamUploadModal(teamId, displayName, nevoboCode));
  }

  // ── Follow button handler ─────────────────────────────────────────────────
  if (!isOwnTeam && state.user) {
    document.getElementById('follow-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('follow-btn');
      btn.disabled = true;
      try {
        if (isFollowing) {
          // Need a DB id to unfollow — resolve it first if we only have a name
          if (!teamId) {
            const q = `name=${encodeURIComponent(displayName)}&code=${encodeURIComponent(nevoboCode)}&userId=${state.user.id}`;
            const d = await api(`/api/nevobo/team-by-name?${q}`);
            teamId = d.dbTeam?.id;
          }
          if (teamId) {
            await api('/api/social/follow', { method: 'DELETE', body: { followee_type: 'team', followee_id: teamId } });
          }
          isFollowing = false;
          btn.className = btn.className.replace(' following', '');
          btn.innerHTML = `<span class="follow-btn-icon">+</span><span class="follow-btn-label">Volgen</span><span class="follow-btn-sub">Ontvang updates van dit team</span>`;
          showToast('Ontvolgt', 'info');
        } else {
          const body = teamId
            ? { followee_type: 'team', followee_id: teamId }
            : { followee_type: 'team', teamName: displayName, nevoboCode, clubName: clubNameForFollow };
          const result = await api('/api/social/follow', { method: 'POST', body });
          if (result.followee_id) teamId = result.followee_id;
          isFollowing = true;
          btn.classList.add('following');
          btn.innerHTML = `<span class="follow-btn-icon">✓</span><span class="follow-btn-label">Gevolgd</span><span class="follow-btn-sub">Tik om te ontvolgen</span>`;
          showToast(`${displayName} gevolgd! 📣`, 'success');
        }
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }
}

// ─── Fill Nevobo placeholders after lazy load ─────────────────────────────────
function fillNevoboData(container, teamData, displayName, nevoboCode) {
  const fullSchedule = teamData?.schedule || [];
  const schedule = fullSchedule.slice(0, 5);
  const results  = teamData?.results  || [];
  const wins     = teamData?.wins     || 0;
  const losses   = teamData?.losses   || 0;
  const draws    = teamData?.draws    || 0;
  const totalPlayed = wins + losses + draws;
  const isOwnTeam = container.querySelector('.team-own-badge') !== null;

  // Season record
  const recordEl = container.querySelector('#team-record');
  if (recordEl) {
    if (totalPlayed > 0) {
      recordEl.innerHTML = `
        <div class="card mb-3">
          <div class="card-header"><h3>📊 Seizoensrecord</h3></div>
          <div class="card-body">
            <div class="team-record">
              <div class="record-item win">
                <div class="record-num">${wins}</div>
                <div class="record-lbl">Gewonnen</div>
              </div>
              <div class="record-divider"></div>
              <div class="record-item loss">
                <div class="record-num">${losses}</div>
                <div class="record-lbl">Verloren</div>
              </div>
              ${draws > 0 ? `
                <div class="record-divider"></div>
                <div class="record-item draw">
                  <div class="record-num">${draws}</div>
                  <div class="record-lbl">Gelijk</div>
                </div>` : ''}
            </div>
          </div>
        </div>`;
    } else {
      recordEl.innerHTML = '';
    }
  }

  // Schedule
  const scheduleHeader = container.querySelector('#schedule-list')?.previousElementSibling;
  if (scheduleHeader) {
    const spinner = scheduleHeader.querySelector('.spinner');
    if (spinner) spinner.remove();
  }
  const scheduleList = container.querySelector('#schedule-list');
  if (scheduleList) {
    scheduleList.innerHTML = schedule.length === 0
      ? `<p class="text-muted text-small" style="padding:1rem">Geen geplande wedstrijden gevonden.</p>`
      : schedule.map((m, i) => renderCompactMatchRow(m, false, displayName, nevoboCode, formatDate, formatTime, i)).join('');

    // Re-attach match row click handlers for new schedule rows
    scheduleList.querySelectorAll('.compact-match-row.clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        navigate('matches', { matchId: row.dataset.matchId, teamName: row.dataset.teamName, nevoboCode: row.dataset.nevoboCode });
      });
    });

    // Load meetup times if own team
    if (isOwnTeam && schedule.length > 0) {
      const homeAddress = deriveHomeAddress(displayName, schedule, results);
      loadMeetupTimes(scheduleList, schedule, displayName, homeAddress);
    }
  }

  // ── Coach carpool planner: fill away matches ──────────────────────────────
  if (_ccCtx) {
    const matchEl = document.getElementById('cc-matches');
    if (matchEl) {
      const away = awayMatchesForTeam(fullSchedule, _ccCtx.clubName, _ccCtx.displayName);
      _ccCtx.awayMatches = away;
      matchEl.innerHTML = away.length === 0
        ? '<p class="text-muted text-small">Geen uitwedstrijden voor dit team in het programma.</p>'
        : away.map((m, idx) => `
          <label style="display:flex;align-items:flex-start;gap:0.5rem;font-size:0.82rem;margin-bottom:0.45rem;cursor:pointer">
            <input type="checkbox" class="cc-match-cb" data-cc-midx="${idx}" checked style="margin-top:0.2rem" />
            <span>${escHtml(m.home_team || '\u2014')} \u2014 ${escHtml(m.away_team || '\u2014')}<br/>
            <span class="text-muted">${m.datetime ? escHtml(formatDate(m.datetime)) : ''}</span></span>
          </label>`).join('');
    }
  }

  // Results
  const resultsHeader = container.querySelector('#results-header');
  if (resultsHeader) resultsHeader.textContent = `🏐 Uitslagen (${results.length})`;

  const resultsHeaderRow = resultsHeader?.closest('.card-header');
  if (resultsHeaderRow) {
    const spinner = resultsHeaderRow.querySelector('.spinner');
    if (spinner) spinner.remove();
    if (!isOwnTeam && results.length > 0) {
      resultsHeaderRow.insertAdjacentHTML('beforeend',
        `<span class="chip chip-secondary" style="font-size:0.65rem" title="Gebaseerd op clubs die ook deze app gebruiken">geregistreerde clubs</span>`);
    }
  }

  const resultsList = container.querySelector('#results-list');
  if (resultsList) {
    resultsList.innerHTML = results.length === 0
      ? `<p class="text-muted text-small" style="padding:1rem">Nog geen resultaten gevonden${isOwnTeam ? '' : ' — dit team heeft nog niet gespeeld tegen andere clubs in de app'}.</p>`
      : results.slice(0, 5).map(m => renderCompactMatchRow(m, true, displayName, nevoboCode, formatDate, formatTime)).join('');

    if (results.length > 5) {
      resultsList.insertAdjacentHTML('beforeend', `
        <div id="results-more" style="display:none">
          ${results.slice(5).map(m => renderCompactMatchRow(m, true, displayName, nevoboCode, formatDate, formatTime)).join('')}
        </div>
        <button id="results-toggle" class="btn btn-ghost btn-sm" style="width:100%;padding:0.6rem;border-top:1px solid var(--border);border-radius:0">
          Toon alle ${results.length} uitslagen ↓
        </button>`);

      document.getElementById('results-toggle')?.addEventListener('click', () => {
        const more = document.getElementById('results-more');
        const btn  = document.getElementById('results-toggle');
        const expanded = more.style.display !== 'none';
        more.style.display = expanded ? 'none' : '';
        btn.textContent = expanded ? `Toon alle ${results.length} uitslagen ↓` : 'Minder tonen ↑';
      });
    }

    resultsList.querySelectorAll('.compact-match-row.clickable-row').forEach(row => {
      row.addEventListener('click', () => {
        navigate('matches', { matchId: row.dataset.matchId, teamName: row.dataset.teamName, nevoboCode: row.dataset.nevoboCode });
      });
    });
  }
}

// ─── Team media reel ──────────────────────────────────────────────────────────
async function loadTeamMedia(teamId, displayName, nevoboCode) {
  const el = document.getElementById('team-media');
  if (!el) return;

  // Check if current user is a member of this team (for social add button)
  const isTeamAdmin = state.user?.roles?.some(r =>
    r.role === 'super_admin' ||
    r.role === 'club_admin' ||
    (r.role === 'team_admin' && r.team_id === teamId)
  );
  const currentUserId = state.user?.id || null;

  try {
    const data = await api(`/api/social/team-media/${teamId}?limit=20`);
    if (!el.isConnected) return;
    let media = data.media || [];

    if (!media.length) {
      el.innerHTML = `<div class="hm-reel-wrap"><p class="text-muted text-small" style="padding:1rem;margin:0">Nog geen media.</p></div>`;
      el.hidden = false;
      return;
    }

    const clubLogoUrl = (m) => {
      if (m.club_logo_url) return m.club_logo_url;
      if (m.club_nevobo_code) return `https://assets.nevobo.nl/organisatie/logo/${String(m.club_nevobo_code).toUpperCase()}.jpg`;
      // Fallback: team page context — use the team's club (nevoboCode) so logo always shows on team reels
      if (nevoboCode) return `https://assets.nevobo.nl/organisatie/logo/${String(nevoboCode).toUpperCase()}.jpg`;
      return null;
    };

    el.innerHTML = `
      <div class="hm-reel-wrap">
        <div class="hm-reel" id="team-reel-track">
          <div class="hm-reel-spacer"></div>
          ${buildReelStripCardsHtml(media, escHtml, {
            getClubLogoUrl: clubLogoUrl,
            showTeamCaption: false,
            statsMode: 'likes_views',
            includeSocialEmbeds: true,
          })}
          <div class="hm-reel-spacer"></div>
        </div>
      </div>`;

    const reelTrack = el.querySelector('#team-reel-track');
    if (!reelTrack) return;

    // tap → open fullscreen viewer
    reelTrack.querySelectorAll('.hm-reel-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.index);
        const existingVideo = card.querySelector('video.hm-reel-media');
        openReelViewer(media, idx, {
          sourceVideo: existingVideo,
          fallbackNevoboCode: nevoboCode,
          fetchMore: async (offset) => {
            const d = await api(`/api/social/team-media/${teamId}?limit=20&offset=${offset}`);
            return d.media || [];
          },
          canDelete: (m) => {
            if (!state.user) return false;
            if (m.file_type === 'tiktok' || m.file_type === 'instagram') {
              // Social embeds: owner or team/club/super admin
              return m.added_by === currentUserId || isTeamAdmin || state.user.role === 'super_admin';
            }
            // Regular media: uploader or admin
            return m.user_id === currentUserId || isTeamAdmin || state.user.role === 'super_admin';
          },
          onDelete: async (m) => {
            if (m.file_type === 'tiktok' || m.file_type === 'instagram') {
              await api(`/api/social/teams/${teamId}/social-links/${m.social_link_id}`, { method: 'DELETE' });
            } else {
              await api(`/api/social/media/${m.id}`, { method: 'DELETE' });
            }
          },
        });
      });
    });

    setupReelStripVideoAutoplay(reelTrack);
  } catch (_) {
    el.remove();
  }
}

// ─── Team media upload (Foto / Video / Upload from hero) ─────────────────────
function showTeamCaptionModal(teamId, displayName, nevoboCode, files) {
  const preview = files.map(f => {
    const url = URL.createObjectURL(f);
    return f.type.startsWith('video/')
      ? `<video src="${url}" style="width:100%;max-height:180px;border-radius:10px;object-fit:cover" muted playsinline></video>`
      : `<img src="${url}" style="width:100%;max-height:180px;border-radius:10px;object-fit:cover" alt="" />`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:0.75rem">📸 Media toevoegen aan team</h3>
      <div style="margin-bottom:0.75rem;border-radius:10px;overflow:hidden">${preview}</div>
      <div class="form-group">
        <label class="form-label">Onderschrift (optioneel)</label>
        <input type="text" id="team-cap-input" class="form-input" placeholder="Bijv. training of uitwedstrijd" />
      </div>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-secondary" style="flex:1" id="team-cap-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="team-cap-submit">Plaatsen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#team-cap-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#team-cap-submit').addEventListener('click', async () => {
    const caption = overlay.querySelector('#team-cap-input').value.trim();
    overlay.remove();
    await doTeamUpload(teamId, displayName, nevoboCode, files, caption);
  });
}

function showTeamUploadModal(teamId, displayName, nevoboCode) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">📸 Foto's &amp; video's uploaden</h3>
      <form id="team-upload-form">
        <div id="team-fp-wrap" class="form-group"></div>
        <div class="form-group">
          <label class="form-label">Onderschrift (optioneel)</label>
          <input type="text" id="team-upload-caption" class="form-input" placeholder="Bijv. training of uitwedstrijd" />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" style="flex:1" id="team-upload-cancel">Annuleren</button>
          <button type="submit" class="btn btn-primary" style="flex:1" id="team-upload-submit">Uploaden</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const picker = new FilePicker(overlay.querySelector('#team-fp-wrap'), {
    accept: 'image/*,video/*',
    multiple: true,
    maxFiles: 10,
  });

  overlay.querySelector('#team-upload-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#team-upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    const files = picker.getFiles();
    if (files.length === 0) {
      showToast('Kies eerst bestanden', 'error');
      return;
    }
    const caption = overlay.querySelector('#team-upload-caption').value.trim();
    overlay.remove();
    await doTeamUpload(teamId, displayName, nevoboCode, files, caption);
  });
}

async function doTeamUpload(teamId, displayName, nevoboCode, files, caption = '') {
  showToast('Uploaden…', 'info');
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  if (caption) fd.append('caption', caption);
  fd.append('team_id', String(teamId));
  try {
    const resp = await fetch('/api/social/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: fd,
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Upload mislukt');
    showToast('Toegevoegd! 📸', 'success');
    await loadTeamMedia(teamId, displayName, nevoboCode);
    if (data.qualityIssues?.length) {
      showQualityWarningModal(data.qualityIssues, () => loadTeamMedia(teamId, displayName, nevoboCode));
    }
  } catch (err) {
    showToast(err.message || 'Upload mislukt', 'error');
  }
}

// ─── Meetup time loader ────────────────────────────────────────────────────────
// For each upcoming scheduled match, calculate when the team should gather:
//   - Home match: 45 min before kickoff
//   - Away match: 45 min + travel time before kickoff
async function loadMeetupTimes(container, schedule, myTeamName, homeAddress) {
  const nameLower = myTeamName.toLowerCase();

  // If homeAddress wasn't pre-computed, derive it from the schedule itself
  if (!homeAddress) {
    for (const m of schedule) {
      const homeTeam = (m.home_team || '').toLowerCase();
      if ((homeTeam === nameLower || homeTeam.endsWith(nameLower) || homeTeam.includes(nameLower)) && m.venue_address) {
        homeAddress = m.venue_address.trim();
        break;
      }
    }
  }

  for (let i = 0; i < schedule.length; i++) {
    const m = schedule[i];
    if (!m.datetime) continue;

    const placeholder = container.querySelector(`.compact-meetup[data-schedule-idx="${i}"]`);
    if (!placeholder) continue;

    const kickoff = new Date(m.datetime);
    const homeIsMe = (m.home_team || '').toLowerCase().includes(nameLower);
    let travelMinutes = 0;
    if (!homeIsMe && m.venue_address && homeAddress) {
      // Show loading state
      placeholder.textContent = 'Reistijd berekenen…';
      placeholder.dataset.loading = 'true';
      placeholder.style.display = 'flex';

      try {
        const resp = await fetch(
          `/api/nevobo/travel-time?from=${encodeURIComponent(homeAddress)}&to=${encodeURIComponent(m.venue_address)}`
        );
        const data = await resp.json();
        if (data.ok && data.minutes != null) travelMinutes = data.minutes;
      } catch (_) {}
    }
    const bufferMinutes = 45 + travelMinutes;
    const meetupRaw = new Date(kickoff.getTime() - bufferMinutes * 60 * 1000);
    // Round DOWN to nearest 5 minutes
    meetupRaw.setMinutes(Math.floor(meetupRaw.getMinutes() / 5) * 5, 0, 0);
    const hh = meetupRaw.getHours().toString().padStart(2, '0');
    const mm = meetupRaw.getMinutes().toString().padStart(2, '0');

    const label = homeIsMe
      ? `🟢 Verzamelen ${hh}:${mm}`
      : travelMinutes > 0
        ? `🚌 Verzamelen ${hh}:${mm} (${travelMinutes} min rijden)`
        : `🚌 Verzamelen ${hh}:${mm}`;

    placeholder.textContent = label;
    placeholder.className = `compact-meetup compact-meetup--${homeIsMe ? 'home' : travelMinutes > 0 ? 'away' : 'away-notimed'}`;
    placeholder.style.display = 'flex';
    delete placeholder.dataset.loading;
  }
}

// Find the home hall address for a specific team by looking at all matches
// where that team plays at home and has a venue_address.
// Uses frequency — the most common address is the team's own hall.
function deriveHomeAddress(teamName, schedule, results) {
  const nameLower = teamName.toLowerCase();
  const freq = new Map();
  for (const m of [...schedule, ...results]) {
    const homeTeam = (m.home_team || '').toLowerCase();
    const isHome = homeTeam === nameLower || homeTeam.endsWith(nameLower) || homeTeam.includes(nameLower);
    if (isHome && m.venue_address) {
      const addr = m.venue_address.trim();
      freq.set(addr, (freq.get(addr) || 0) + 1);
    }
  }
  if (freq.size === 0) return null;
  return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
}
