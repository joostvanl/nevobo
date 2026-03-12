import { api, state, renderAvatar, renderClubLogo, formatDate, formatTime, showToast, navigate } from '../app.js';

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
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
      return;
    }

    const { team, club, members, followerCount, isOwnTeam } = data;
    let { isFollowing } = data;

    // Use team-by-name so we get full results across all registered clubs
    let teamData;
    try {
      const q = `name=${encodeURIComponent(team.display_name)}&code=${encodeURIComponent(club.nevobo_code)}${userId ? '&userId=' + userId : ''}`;
      teamData = await api(`/api/nevobo/team-by-name?${q}`);
    } catch (_) {
      teamData = { schedule: [], results: [], wins: 0, losses: 0, draws: 0 };
    }

    renderPage(container, {
      displayName: team.display_name,
      clubName: club.name,
      nevoboCode: club.nevobo_code,
      homeAddress: deriveHomeAddress(team.display_name, teamData.schedule || [], teamData.results || []) || club.home_address || null,
      members,
      followerCount,
      isOwnTeam,
      isFollowing,
      schedule: (teamData.schedule || []).slice(0, 5),
      results:  (teamData.results  || []),
      wins: teamData.wins, losses: teamData.losses, draws: teamData.draws,
      pouleCodes: teamData.pouleCodes || [],
      teamId: team.id,
      teamName: null,
    });
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
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
    return;
  }

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
    pouleCodes: data.pouleCodes || [],
    // For follow: prefer DB id, otherwise use name+code
    teamId: data.dbTeam?.id || null,
    teamName: data.dbTeam ? null : teamName,
    clubNameForFollow: data.dbTeam?.club_name || effectiveCode,
  });
}

// ─── Shared render ────────────────────────────────────────────────────────────
function renderPage(container, opts) {
  const {
    displayName, clubName, members, followerCount,
    isOwnTeam, schedule, results, wins, losses, draws,
    nevoboCode, clubNameForFollow, pouleCodes = [],
    homeAddress = null,
  } = opts;
  let { isFollowing, teamId, teamName } = opts;

  const initials = displayName.split(/\s+/)
    .filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();

  const totalPlayed = wins + losses + draws;

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
            ? `<div class="team-own-badge">✅ Jouw team</div>`
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

    <div class="container">

      <!-- Season record -->
      ${totalPlayed > 0 ? `
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
        </div>
      ` : ''}

      <!-- Poule standings — loaded async -->
      <div id="poule-stands"></div>

      <!-- Upcoming matches -->
      <div class="card mb-3">
        <div class="card-header"><h3>📅 Aankomende wedstrijden</h3></div>
        <div class="card-body" style="padding:0" id="schedule-list">
          ${schedule.length === 0
            ? `<p class="text-muted text-small" style="padding:1rem">Geen geplande wedstrijden gevonden.</p>`
            : schedule.map((m, i) => renderCompactMatch(m, false, displayName, nevoboCode, i)).join('')}
        </div>
      </div>

      <!-- Results — show all, collapsible after 5 -->
      <div class="card mb-3">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center">
          <h3>🏐 Uitslagen (${results.length})</h3>
          ${!isOwnTeam ? `<span class="chip chip-secondary" style="font-size:0.65rem" title="Gebaseerd op clubs die ook deze app gebruiken">geregistreerde clubs</span>` : ''}
        </div>
        <div class="card-body" style="padding:0">
          ${results.length === 0
            ? `<p class="text-muted text-small" style="padding:1rem">Nog geen resultaten gevonden${isOwnTeam ? '' : ' — dit team heeft nog niet gespeeld tegen andere clubs in de app'}.</p>`
            : results.slice(0, 5).map(m => renderCompactMatch(m, true, displayName, nevoboCode)).join('')
          }
          ${results.length > 5 ? `
            <div id="results-more" style="display:none">
              ${results.slice(5).map(m => renderCompactMatch(m, true, displayName, nevoboCode)).join('')}
            </div>
            <button id="results-toggle" class="btn btn-ghost btn-sm" style="width:100%;padding:0.6rem;border-top:1px solid var(--border);border-radius:0">
              Toon alle ${results.length} uitslagen ↓
            </button>` : ''}
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

    </div>`;

  // ── Verzameltijden asynchroon laden ──────────────────────────────────────
  if (isOwnTeam && schedule.length > 0) {
    const scheduleList = container.querySelector('#schedule-list');
    if (scheduleList) loadMeetupTimes(scheduleList, schedule, displayName, homeAddress);
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

  // ── Load poule standings async ─────────────────────────────────────────────
  const standsEl = document.getElementById('poule-stands');
  if (standsEl && nevoboCode) {
    standsEl.innerHTML = `
      <div class="card mb-3">
        <div class="card-header"><h3>🏆 Competitiestand</h3></div>
        <div class="card-body"><div class="spinner"></div></div>
      </div>`;

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
            const teamLink = `<a href="#" class="stand-team-link" data-teamname="${escapeAttr(r.team)}" data-nevobocode="${escapeAttr(nevoboCode)}">${r.team}</a>`;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeFilter(nameLower) {
  return m => {
    const home = (m.home_team || '').toLowerCase();
    const away = (m.away_team || '').toLowerCase();
    return home === nameLower || away === nameLower
      || home.endsWith(nameLower) || away.endsWith(nameLower)
      || home.includes(nameLower) || away.includes(nameLower);
  };
}

function computeRecord(matches, nameLower) {
  let wins = 0, losses = 0, draws = 0;
  matches.forEach(m => {
    if (m.score_home === null) return;
    const isHome = (m.home_team || '').toLowerCase().includes(nameLower);
    const myScore  = isHome ? m.score_home : m.score_away;
    const oppScore = isHome ? m.score_away : m.score_home;
    if (myScore > oppScore) wins++;
    else if (myScore < oppScore) losses++;
    else draws++;
  });
  return { wins, losses, draws };
}

function renderCompactMatch(m, isResult, myTeamName, nevoboCode, scheduleIdx = null) {
  const nameLower = myTeamName.toLowerCase();
  const homeIsMe = (m.home_team || '').toLowerCase().includes(nameLower);

  let resultClass = '';
  if (isResult && m.score_home !== null) {
    const myScore  = homeIsMe ? m.score_home : m.score_away;
    const oppScore = homeIsMe ? m.score_away : m.score_home;
    resultClass = myScore > oppScore ? 'win' : myScore < oppScore ? 'loss' : 'draw';
  }

  const score = isResult && m.score !== null
    ? `<span class="compact-score ${resultClass}">${m.score_home}–${m.score_away}</span>`
    : `<span class="compact-score tbd">vs</span>`;

  const matchId = encodeURIComponent(m.match_id || m.link?.replace(/.*\//, '') || m.title?.slice(0, 40) || 'onbekend');

  // Placeholder for meetup time — only for scheduled (non-result) rows with an index
  const meetupPlaceholder = (!isResult && scheduleIdx !== null)
    ? `<div class="compact-meetup" data-schedule-idx="${scheduleIdx}" style="display:none"></div>`
    : '';

  return `
    <div class="compact-match-row clickable-row" data-match-id="${matchId}"
         data-team-name="${escapeAttr(myTeamName)}" data-nevobo-code="${escapeAttr(nevoboCode)}">
      <div class="compact-teams">
        <span class="compact-team ${homeIsMe ? 'me' : ''}">${m.home_team || '—'}</span>
        ${score}
        <span class="compact-team away ${!homeIsMe ? 'me' : ''}">${m.away_team || '—'}</span>
      </div>
      <div class="compact-meta">
        ${m.datetime ? `<span>📅 ${formatDate(m.datetime)}</span>` : ''}
        ${m.datetime ? `<span>🕐 ${formatTime(m.datetime)}</span>` : ''}
        ${m.venue_name ? `<span>📍 ${m.venue_name}</span>` : ''}
      </div>
      ${meetupPlaceholder}
    </div>`;
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

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
