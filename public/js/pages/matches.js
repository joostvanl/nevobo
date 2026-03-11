import { api, state, formatDate, formatTime, showToast, navigate } from '../app.js';
import { FilePicker } from '../file-picker.js';

let currentTab    = 'schedule';
let currentFilter = 'my-team'; // 'my-team' | 'club' | 'followed'

// Club-code lookup: clubCode → { clubCode, clubName, logoUrl }
// Populated lazily on first match render.
let opponentClubs   = null; // null = not loaded yet, Map when loaded
let teamCodeLookup  = new Map(); // teamName (normalized) → clubCode — direct & reliable
let ownClubCode     = null;

// Normalize a team name for lookup: lowercase + unified apostrophes + trim.
// This handles e.g. Go'97 where RSS uses U+0027 but LD+JSON API may use U+2019.
function normalizeTeamName(n) {
  if (!n) return '';
  return n
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadOpponentClubs(nevoboCode) {
  if (opponentClubs && ownClubCode === nevoboCode) return;
  ownClubCode = nevoboCode;
  try {
    const data = await api(`/api/nevobo/opponent-clubs?code=${nevoboCode}`);
    opponentClubs  = new Map((data.clubs || []).map(c => [c.clubCode, c]));
    // Normalize keys so apostrophe variants all map to the same key
    teamCodeLookup = new Map(
      Object.entries(data.teamCodes || {}).map(([k, v]) => [normalizeTeamName(k), v])
    );
  } catch (_) {
    opponentClubs  = new Map();
    teamCodeLookup = new Map();
  }
}

/**
 * Resolve the Nevobo club code for a given team name.
 * Priority: 1) direct normalized lookup, 2) endsWith fuzzy, 3) club name substring.
 * Falls back to ownNevoboCode when nothing matches.
 */
// When strict=true, returns null instead of ownNevoboCode when no confident match is found.
// Use strict=true for logo resolution to avoid showing the own club logo for unknown opponents.
function resolveClubCode(teamName, ownNevoboCode, strict = false) {
  if (!teamName) return strict ? null : ownNevoboCode;
  const norm = normalizeTeamName(teamName);

  // 1. Direct team name lookup (most accurate — covers abbreviations like OKV, Go'97)
  if (teamCodeLookup.size > 0) {
    if (teamCodeLookup.has(norm)) return teamCodeLookup.get(norm);

    // 2. Fuzzy: one name ends with the other (handles sponsor prefixes)
    for (const [tName, code] of teamCodeLookup) {
      if (norm.endsWith(tName) || tName.endsWith(norm)) return code;
    }
  }

  // 3. Club name substring fallback (works when team names match official club name)
  if (opponentClubs) {
    if (ownNevoboCode) {
      const own = opponentClubs.get(ownNevoboCode);
      if (own?.clubName && norm.includes(normalizeTeamName(own.clubName))) return ownNevoboCode;
    }
    for (const [code, club] of opponentClubs) {
      if (!club.clubName) continue;
      if (norm.includes(normalizeTeamName(club.clubName))) return code;
    }
  }

  return strict ? null : ownNevoboCode;
}

/**
 * Try to find a club logo URL for a given team name.
 * Uses resolveClubCode to find the club, then returns the logo URL.
 */
function resolveTeamLogo(teamName, ownNevoboCode) {
  if (!teamName) return null;
  // Use strict mode: if no confident match found, return null rather than showing the wrong logo
  const code = resolveClubCode(teamName, ownNevoboCode, true);
  if (!code) return null;

  if (opponentClubs) {
    const club = opponentClubs.get(code);
    if (club?.logoUrl) return club.logoUrl;
  }
  return `https://assets.nevobo.nl/organisatie/logo/${code.toUpperCase()}.jpg`;
}

export async function render(container, params = {}) {
  container.innerHTML = '<div class="spinner"></div>';

  const user = state.user;

  if (!user?.club_id) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <h3>Geen club gekoppeld</h3>
        <p>Stel eerst je club in om wedstrijden te zien.</p>
        <button class="btn btn-primary mt-3" onclick="navigate('profile')">Profiel instellen</button>
      </div>`;
    return;
  }

  let club, myTeams = [], followedTeams = [];
  try {
    const [clubData, teamsData] = await Promise.all([
      api(`/api/clubs/${user.club_id}`),
      user.club_id ? api(`/api/clubs/${user.club_id}/teams?userId=${user.id}`).catch(() => ({ teams: [] })) : Promise.resolve({ teams: [] }),
    ]);
    club = clubData.club;
    const teams = teamsData.teams || [];

    // All team memberships (already included in /api/auth/me response)
    if (user.memberships && user.memberships.length > 0) {
      myTeams = user.memberships
        .filter(m => m.club_id === user.club_id)
        .map(m => ({ id: m.team_id, display_name: m.team_name, club_id: m.club_id, membership_type: m.membership_type }));
    } else if (user.team_id) {
      const primary = teams.find(t => t.id === user.team_id);
      if (primary) myTeams = [{ id: primary.id, display_name: primary.display_name, club_id: club.id }];
    }

    const myTeamIds = new Set(myTeams.map(t => t.id));
    followedTeams = teams.filter(t => t.is_following && !myTeamIds.has(t.id));
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
    return;
  }

  // If a specific match was clicked (from team page or elsewhere)
  if (params.matchId) {
    if (params.teamName && params.nevoboCode) {
      renderMatchDetailByTeamFeed(container, params.matchId, params.teamName, params.nevoboCode, club);
    } else {
      renderMatchDetailById(container, params.matchId, club, myTeams.length > 0);
    }
    return;
  }

  renderMatchList(container, club, myTeams, followedTeams, currentTab);
}

async function renderMatchList(container, club, myTeams, followedTeams, tab) {
  const filter = currentFilter;

  // Determine subtitle for the hero
  const subtitleMap = {
    'my-team':  myTeams.length === 1 ? myTeams[0].display_name
                : myTeams.length > 1  ? `${myTeams.length} teams`
                : club.name,
    'club':     club.name,
    'followed': 'Gevolgde teams',
  };

  container.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <h1>📅 Wedstrijden</h1>
        <p style="opacity:0.9">${subtitleMap[filter]}</p>
      </div>
    </div>
    <div class="container">

      <!-- Schedule / Results tabs -->
      <div class="tabs">
        <button class="tab-btn ${tab === 'schedule' ? 'active' : ''}" data-tab="schedule">Programma</button>
        <button class="tab-btn ${tab === 'results'  ? 'active' : ''}" data-tab="results">Uitslagen</button>
      </div>

      <!-- View filter pills -->
      <div class="filter-pills mb-3">
        <button class="filter-pill ${filter === 'my-team'  ? 'active' : ''}" data-filter="my-team">
          👕 Mijn team
        </button>
        <button class="filter-pill ${filter === 'club'     ? 'active' : ''}" data-filter="club">
          🏠 Hele club
        </button>
        ${followedTeams.length > 0 ? `
        <button class="filter-pill ${filter === 'followed' ? 'active' : ''}" data-filter="followed">
          👁️ Gevolgd (${followedTeams.length})
        </button>` : ''}
      </div>

      <!-- Content area -->
      <div id="matches-content">
        <div class="spinner"></div>
      </div>

    </div>`;

  // Tab switch
  container.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTab = btn.dataset.tab;
      renderMatchList(container, club, myTeams, followedTeams, currentTab);
    });
  });

  // Filter switch
  container.querySelectorAll('.filter-pill[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentFilter = btn.dataset.filter;
      renderMatchList(container, club, myTeams, followedTeams, currentTab);
    });
  });

  const contentEl = container.querySelector('#matches-content');

  if (filter === 'my-team') {
    if (myTeams.length === 0) {
      contentEl.innerHTML = `
        <p class="text-muted text-small" style="margin-bottom:0.75rem">Geen team ingesteld — alle clubwedstrijden worden getoond. <a href="#" onclick="navigate('profile');return false">Stel je team in →</a></p>
        <div id="own-matches-list-0"><div class="spinner"></div></div>`;
      loadMatchSection(contentEl.querySelector('#own-matches-list-0'), club, null, tab, false);
    } else {
      // One section per team the user belongs to
      contentEl.innerHTML = myTeams.map((t, i) => `
        ${i > 0 ? '<div class="team-section-spacer"></div>' : ''}
        <div class="team-section-header">
          <span style="font-weight:700;font-size:0.9rem">👕 ${t.display_name}</span>
          <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:#fff;border:none;padding:0.3rem 0.7rem;font-size:0.8rem"
            onclick="navigate('team',{teamId:${t.id},clubId:${club.id}})">Team info →</button>
        </div>
        <div id="own-matches-list-${i}"><div class="spinner"></div></div>`).join('');
      myTeams.forEach((t, i) => {
        loadMatchSection(contentEl.querySelector(`#own-matches-list-${i}`), club, t, tab, true);
      });
    }

  } else if (filter === 'club') {
    // Show all club teams, each with their own section
    contentEl.innerHTML = `<div id="club-matches-list"><div class="spinner"></div></div>`;
    loadClubSection(contentEl.querySelector('#club-matches-list'), club, myTeams, tab);

  } else if (filter === 'followed') {
    // Show only followed teams
    if (followedTeams.length === 0) {
      contentEl.innerHTML = `<div class="empty-state" style="padding:2rem 0">
        <div class="empty-icon">👁️</div>
        <p>Je volgt nog geen teams. Ga naar de Teams-pagina om teams te volgen.</p>
      </div>`;
    } else {
      contentEl.innerHTML = `<div id="followed-matches-list"><div class="spinner"></div></div>`;
      loadFollowedTeamsSection(contentEl.querySelector('#followed-matches-list'), club, followedTeams, tab);
    }
  }
}

async function loadMatchSection(listEl, club, team, tab, canInteract) {
  if (!listEl) return;
  // Load opponent clubs in background (doesn't block rendering)
  loadOpponentClubs(club.nevobo_code);
  try {
    const endpoint = tab === 'schedule'
      ? `/api/nevobo/club/${club.nevobo_code}/schedule`
      : `/api/nevobo/club/${club.nevobo_code}/results`;

    const data = await api(endpoint);
    let matches = data.matches || [];

    // Filter to team if one is selected
    if (team) {
      const name = team.display_name.toLowerCase();
      matches = matches.filter(m => {
        const home = (m.home_team || '').toLowerCase();
        const away = (m.away_team || '').toLowerCase();
        // Exact match first (home_team === team name, or away_team === team name)
        return home === name || away === name
          // Substring: RSS sometimes prepends a sponsor name, e.g. "Quadrant Bouw VTC Woerden DS 1"
          || home.endsWith(name) || away.endsWith(name)
          || home.includes(name) || away.includes(name);
      });
    }

    matches = sortByDate(matches, tab);

    if (matches.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:1.25rem 0">
          <div class="empty-icon" style="font-size:1.8rem">${tab === 'schedule' ? '📅' : '🏐'}</div>
          <p style="font-size:0.875rem">${tab === 'schedule' ? 'Geen geplande wedstrijden.' : 'Nog geen resultaten.'}</p>
        </div>`;
      return;
    }

    // Fetch carpool seat availability for scheduled matches
    let carpoolMap = new Map();
    if (tab === 'schedule') {
      const ids = matches.map(m => encodeMatchId(m));
      carpoolMap = await fetchCarpoolSummaries(ids);
    }

    listEl.innerHTML = matches.map((m, i) => renderMatchCard(m, i, tab, canInteract, club.nevobo_code, carpoolMap.get(encodeMatchId(m)) ?? null, club.name || '')).join('');

    // Team name → team page
    listEl.querySelectorAll('.team-name-link').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const teamName = el.dataset.teamname;
        const code = resolveClubCode(teamName, el.dataset.nevobocode) || el.dataset.nevobocode;
        navigate('team', { teamName, nevoboCode: code });
      });
    });

    // Card click → detail
    listEl.querySelectorAll('.match-card[data-match-idx]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.team-name-link') || e.target.closest('.match-carpool-btn')) return;
        const idx = parseInt(card.dataset.matchIdx);
        renderMatchDetail(listEl.closest('.container').parentElement, matches[idx], club, tab, canInteract);
      });
    });

    if (canInteract) {
      listEl.querySelectorAll('.match-carpool-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          navigate('carpool', { matchId: btn.dataset.matchid });
        });
      });
    }
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state" style="padding:1rem 0"><div class="empty-icon">🔌</div><p style="font-size:0.85rem">${err.message}</p></div>`;
  }
}

async function loadClubSection(listEl, club, myTeams, tab) {
  if (!listEl) return;
  try {
    const endpoint = tab === 'schedule'
      ? `/api/nevobo/club/${club.nevobo_code}/schedule`
      : `/api/nevobo/club/${club.nevobo_code}/results`;
    const data = await api(endpoint);
    const allMatches = data.matches || [];

    // Determine which team names belong to this club (frequency ≥ 3)
    const teamFreq = new Map();
    for (const m of allMatches) {
      for (const side of [m.home_team, m.away_team]) {
        if (side) teamFreq.set(side, (teamFreq.get(side) || 0) + 1);
      }
    }
    const ownTeamNames = new Set(
      [...teamFreq.entries()].filter(([, n]) => n >= 3).map(([name]) => name)
    );

    if (ownTeamNames.size === 0) {
      listEl.innerHTML = `<p class="text-muted text-small">Geen wedstrijden gevonden.</p>`;
      return;
    }

    // Keep only matches where at least one side is a club team, de-duplicate
    const seen = new Set();
    const clubMatches = allMatches.filter(m => {
      if (!ownTeamNames.has(m.home_team) && !ownTeamNames.has(m.away_team)) return false;
      const key = m.match_id || m.title || '';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const sorted = sortByDate(clubMatches, tab);

    if (sorted.length === 0) {
      listEl.innerHTML = `<p class="text-muted text-small">Geen wedstrijden gevonden.</p>`;
      return;
    }

    // Fetch carpool availability for scheduled matches
    let carpoolMap = new Map();
    if (tab === 'schedule') {
      carpoolMap = await fetchCarpoolSummaries(sorted.map(m => encodeMatchId(m)));
    }

    // Determine canInteract per match (only for the user's own teams)
    const myNames = (Array.isArray(myTeams) ? myTeams : myTeams ? [myTeams] : [])
      .map(t => t.display_name?.toLowerCase()).filter(Boolean);
    const canInteractFor = (m) => myNames.length > 0 && myNames.some(n =>
      (m.home_team || '').toLowerCase().includes(n) ||
      (m.away_team || '').toLowerCase().includes(n)
    );

    listEl.innerHTML = sorted.map((m, i) =>
      renderMatchCard(m, i, tab, canInteractFor(m), club.nevobo_code, carpoolMap.get(encodeMatchId(m)) ?? null, club.name || '')
    ).join('');

    // Team name links → team page
    listEl.querySelectorAll('.team-name-link').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const teamName = el.dataset.teamname;
        const code = resolveClubCode(teamName, el.dataset.nevobocode) || el.dataset.nevobocode;
        navigate('team', { teamName, nevoboCode: code });
      });
    });

    // Card click → detail
    listEl.querySelectorAll('.match-card[data-match-idx]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.team-name-link') || e.target.closest('.match-carpool-btn')) return;
        const m = sorted[parseInt(card.dataset.matchIdx)];
        if (m) renderMatchDetail(listEl.closest('.container').parentElement, m, club, tab, canInteractFor(m));
      });
    });

    listEl.querySelectorAll('.match-carpool-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        navigate('carpool', { matchId: btn.dataset.matchid });
      });
    });
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state" style="padding:1rem 0"><div class="empty-icon">🔌</div><p style="font-size:0.85rem">${err.message}</p></div>`;
  }
}

async function loadFollowedTeamsSection(listEl, club, followedTeams, tab) {
  if (!listEl) return;
  try {
    const endpoint = tab === 'schedule'
      ? `/api/nevobo/club/${club.nevobo_code}/schedule`
      : `/api/nevobo/club/${club.nevobo_code}/results`;
    const data = await api(endpoint);
    const allMatches = data.matches || [];

    // Collect all matches for any followed team, de-duplicate
    const seen = new Set();
    const followedMatches = [];
    for (const team of followedTeams) {
      const name = team.display_name.toLowerCase();
      for (const m of allMatches) {
        const home = (m.home_team || '').toLowerCase();
        const away = (m.away_team || '').toLowerCase();
        if (!(home === name || away === name || home.endsWith(name) || away.endsWith(name) || home.includes(name) || away.includes(name))) continue;
        const key = m.match_id || m.title || '';
        if (seen.has(key)) continue;
        seen.add(key);
        followedMatches.push(m);
      }
    }

    const sorted = sortByDate(followedMatches, tab);

    if (sorted.length === 0) {
      listEl.innerHTML = '<p class="text-muted text-small">Geen wedstrijden gevonden voor gevolgde teams.</p>';
      return;
    }

    // Fetch carpool availability for scheduled matches
    let carpoolMap = new Map();
    if (tab === 'schedule') {
      carpoolMap = await fetchCarpoolSummaries(sorted.map(m => encodeMatchId(m)));
    }

    listEl.innerHTML = sorted.map((m, i) =>
      renderMatchCard(m, i, tab, false, club.nevobo_code, carpoolMap.get(encodeMatchId(m)) ?? null, '')
    ).join('');

    // Team name → team page
    listEl.querySelectorAll('.team-name-link').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const teamName = el.dataset.teamname;
        const code = resolveClubCode(teamName, el.dataset.nevobocode) || el.dataset.nevobocode;
        navigate('team', { teamName, nevoboCode: code });
      });
    });

    // Card click → read-only detail
    listEl.querySelectorAll('.match-card[data-match-idx]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.team-name-link')) return;
        const m = sorted[parseInt(card.dataset.matchIdx)];
        if (m) renderMatchDetail(listEl.closest('.container').parentElement, m, club, tab, false);
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="text-muted text-small">${err.message}</p>`;
  }
}

// ─── Set score bar graph ──────────────────────────────────────────────────────
// Renders a horizontal bar graph where each set is one row.
// The bar shows the relative score: home on the left, away on the right.
// The winning side gets a bolder colour; a 25-point max is assumed (capped at 30).
function renderSetGraph(match) {
  const sets = match.sets || [];
  const MAX_POINTS = 30; // visual cap for bar width calculation

  const rows = sets.map((s, i) => {
    // s is like "25-13" or "25-22"
    const parts = s.split('-').map(Number);
    const homeScore = parts[0] ?? 0;
    const awayScore = parts[1] ?? 0;
    const total = Math.max(homeScore + awayScore, 1);
    const maxScore = Math.max(homeScore, awayScore, 1);

    // Bar widths as % of combined (gives a nice visual split)
    const homePct = Math.round((homeScore / (homeScore + awayScore)) * 100);
    const awayPct = 100 - homePct;

    const homeWon = homeScore > awayScore;
    const awayWon = awayScore > homeScore;

    return `
      <div class="set-bar-row">
        <div class="set-bar-label">${i + 1}</div>
        <div class="set-bar-track">
          <div class="set-bar-home ${homeWon ? 'won' : 'lost'}"
               style="width:${homePct}%">
            <span class="set-bar-score">${homeScore}</span>
          </div>
          <div class="set-bar-away ${awayWon ? 'won' : 'lost'}"
               style="width:${awayPct}%">
            <span class="set-bar-score">${awayScore}</span>
          </div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="set-graph" style="margin-top:1.25rem">
      <div class="set-graph-header">
        <span class="set-graph-team-label" style="text-align:left">${match.home_team || 'Thuis'}</span>
        <span class="set-graph-center-label">Setstanden</span>
        <span class="set-graph-team-label" style="text-align:right">${match.away_team || 'Uit'}</span>
      </div>
      ${rows}
    </div>`;
}

function renderMatchCard(match, idx, tab, canInteract, nevoboCode, carpoolSeats = null, clubName = '') {
  const isResult = tab === 'results';
  const isHomeGame = canInteract && clubName.length > 0
    && (match.home_team || '').toLowerCase().includes(clubName.toLowerCase());

  const scoreDisplay = isResult && match.score !== null
    ? `<div class="match-score">${match.score_home} – ${match.score_away}</div>`
    : `<div class="match-score tbd">vs</div>`;

  const setsHtml = isResult && match.sets?.length > 0
    ? `<div class="match-sets">${match.sets.map(s => `<span class="set-score">${s}</span>`).join('')}</div>`
    : '';

  const readOnlyBadge = !canInteract
    ? `<span class="chip chip-neutral" style="font-size:0.65rem;padding:0.1rem 0.4rem">👁️ volgend</span>`
    : '';

  const carpoolBadge = !isResult && !isHomeGame && carpoolSeats !== null
    ? carpoolSeats > 0
      ? `<span class="chip chip-success" style="font-size:0.65rem;padding:0.1rem 0.4rem">🚗 ${carpoolSeats} plaats${carpoolSeats === 1 ? '' : 'en'}</span>`
      : `<span class="chip chip-neutral" style="font-size:0.65rem;padding:0.1rem 0.4rem">🚗 Geen plaatsen</span>`
    : '';

  const teamLink = (name) => {
    if (!nevoboCode || !name) return `class="match-team-name"`;
    const code = resolveClubCode(name, nevoboCode);
    return `class="match-team-name team-name-link" data-teamname="${escapeAttr(name)}" data-nevobocode="${escapeAttr(code)}"`;
  };

  // Prefer club code from match data (server-enriched), fall back to client-side lookup
  const logoCode = (name, directCode) => {
    if (directCode) return directCode;
    return resolveClubCode(name, nevoboCode, true); // strict: null if unknown
  };

  const teamLogo = (name, directCode) => {
    const code = logoCode(name, directCode);
    if (!code) return '';
    const url = resolveTeamLogo(name, nevoboCode) || `https://assets.nevobo.nl/organisatie/logo/${code.toUpperCase()}.jpg`;
    return `<img src="${url}" alt="${escapeAttr(name)}"
      onload="this.style.opacity=1"
      onerror="this.style.display='none'"
      style="width:22px;height:22px;border-radius:5px;object-fit:contain;background:#fff;flex-shrink:0;opacity:0;transition:opacity .15s;border:1px solid var(--border)" />`;
  };

  return `
    <div class="match-card" data-match-idx="${idx}" style="cursor:pointer${!canInteract ? ';opacity:0.88' : ''}">
      <div class="match-card-teams">
        <div style="display:flex;align-items:center;gap:0.4rem;min-width:0">
          ${teamLogo(match.home_team, match.home_club_code)}
          <div ${teamLink(match.home_team)} style="min-width:0">${match.home_team || '—'}</div>
        </div>
        ${scoreDisplay}
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:0.4rem;min-width:0">
          <div ${teamLink(match.away_team)} style="text-align:right;min-width:0">${match.away_team || '—'}</div>
          ${teamLogo(match.away_team, match.away_club_code)}
        </div>
      </div>
      ${setsHtml}
      <div class="match-card-meta">
        ${match.datetime ? `<span>📅 ${formatDate(match.datetime)}</span>` : ''}
        ${match.datetime ? `<span>🕐 ${formatTime(match.datetime)}</span>` : ''}
        ${match.venue_name ? `<span>📍 ${match.venue_name}</span>` : ''}
        ${match.poule_code ? `<span class="chip chip-neutral">${match.poule_code}</span>` : ''}
        ${carpoolBadge}
        ${readOnlyBadge}
      </div>
      <div class="match-card-actions">
        <button class="btn btn-ghost btn-sm details-btn">Details →</button>
        ${canInteract && !isResult && !isHomeGame ? `<button class="btn btn-ghost btn-sm match-carpool-btn" data-matchid="${encodeMatchId(match)}" style="color:var(--accent)">🚗 Carpool</button>` : ''}
      </div>
    </div>`;
}

function renderMatchDetail(container, match, club, fromTab, canInteract = true) {
  const isResult = match.status === 'gespeeld';
  const matchId = encodeMatchId(match);

  // A home game is one where the user's own club is playing at their own hall.
  // We detect this by checking if the home_team name contains the club name.
  // Only relevant when the user can interact (own team context).
  const clubNameLower = (club?.name || '').toLowerCase();
  const isHomeGame = canInteract && clubNameLower.length > 0
    && (match.home_team || '').toLowerCase().includes(clubNameLower);

  container.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff;margin-bottom:0.75rem"
          onclick="navigate('matches')">← Terug</button>
        <h1 style="font-size:1.1rem;line-height:1.3">${match.home_team || '—'} vs ${match.away_team || '—'}</h1>
        ${match.poule_code ? `<p style="opacity:0.8;font-size:0.8rem;margin-top:0.25rem">${match.poule_code}</p>` : ''}
        ${!canInteract ? `<span class="chip" style="background:rgba(255,255,255,0.2);color:#fff;font-size:0.75rem;margin-top:0.35rem;display:inline-block">👁️ Alleen lezen</span>` : ''}
      </div>
    </div>
    <div class="container">

      <!-- Score / Status -->
      <div class="card mb-3">
        <div class="card-body text-center" style="padding:1.5rem">
          ${isResult ? `
            <div style="font-size:3.5rem;font-weight:900;color:var(--primary);letter-spacing:-2px">
              ${match.score_home} – ${match.score_away}
            </div>
            <span class="chip chip-success mt-2">Gespeeld</span>
            ${match.sets?.length > 0 ? renderSetGraph(match) : ''}
          ` : `
            <div style="font-size:2.5rem;margin-bottom:0.5rem">🏐</div>
            <span class="chip chip-neutral">Gepland</span>
          `}
        </div>
      </div>

      <!-- Teams -->
      <div class="card mb-3">
        <div class="card-header"><h3>👕 Teams</h3></div>
        <div class="card-body">
          <div class="flex justify-between items-center" style="font-size:0.95rem">
            <div style="flex:1">
              <div class="text-muted text-small">Thuis</div>
              <div class="match-detail-team-link" style="font-weight:800;font-size:1.05rem"
                   data-team-name="${match.home_team || ''}" data-nevobo-code="${resolveClubCode(match.home_team, club?.nevobo_code) || ''}">
                ${match.home_team || '—'} <span style="font-size:0.75rem;opacity:0.6">→</span>
              </div>
            </div>
            <div style="font-size:1.5rem;padding:0 0.75rem">vs</div>
            <div style="flex:1;text-align:right">
              <div class="text-muted text-small">Uit</div>
              <div class="match-detail-team-link" style="font-weight:800;font-size:1.05rem;text-align:right"
                   data-team-name="${match.away_team || ''}" data-nevobo-code="${resolveClubCode(match.away_team, club?.nevobo_code) || ''}">
                <span style="font-size:0.75rem;opacity:0.6">←</span> ${match.away_team || '—'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Match info -->
      <div class="card mb-3">
        <div class="card-header"><h3>📋 Wedstrijdinfo</h3></div>
        <div class="card-body">
          <div style="display:flex;flex-direction:column;gap:0.6rem;font-size:0.9rem">
            ${match.datetime ? `
              <div class="flex justify-between">
                <span class="text-muted">Datum</span>
                <strong>${formatDate(match.datetime)}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-muted">Aanvangstijd</span>
                <strong>${formatTime(match.datetime)}</strong>
              </div>` : ''}
            ${match.venue_name ? `
              <div class="flex justify-between">
                <span class="text-muted">Sporthal</span>
                <strong style="text-align:right;max-width:60%">${match.venue_name}</strong>
              </div>` : ''}
            ${match.venue_address ? `
              <div class="flex justify-between">
                <span class="text-muted">Adres</span>
                <strong style="text-align:right;max-width:60%">${match.venue_address}</strong>
              </div>` : ''}
            ${match.poule_code ? `
              <div class="flex justify-between">
                <span class="text-muted">Poule</span>
                <strong>${match.poule_code}</strong>
              </div>` : ''}
          </div>
        </div>
      </div>

      <!-- Map — only for away games (home games: user already knows the venue) -->
      ${!isHomeGame && (match.venue_address || match.venue_name) ? `
        <div class="card mb-3">
          <div class="card-header"><h3>🗺️ Locatie</h3></div>
          <div id="map" style="height:260px;border-radius:0 0 var(--radius) var(--radius);position:relative">
            <div id="map-loader" style="position:absolute;inset:0;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.5rem;background:#f8f9ff;border-radius:0 0 var(--radius) var(--radius)">
              <div class="spinner"></div>
              <span style="font-size:0.8rem;color:var(--text-muted)">Route berekenen…</span>
            </div>
          </div>
        </div>` : ''}

      <!-- Gallery -->
      <div class="card mb-3" id="gallery-card">
        <div class="card-header">
          <h3>📸 Foto's &amp; Video's</h3>
          ${canInteract ? `<button class="btn btn-ghost btn-sm" id="upload-btn" style="margin-left:auto">+ Uploaden</button>` : ''}
        </div>
        <div id="gallery-body"><div class="spinner" style="padding:1.5rem;text-align:center"></div></div>
      </div>
      <!-- Carpool — only for away games -->
      ${!isResult && !isHomeGame ? `
        <div class="card mb-3" id="carpool-detail-card">
          <div class="card-header">
            <h3>🚗 Carpool</h3>
            ${canInteract ? `<button class="btn btn-accent btn-sm" id="carpool-offer-btn" style="margin-left:auto">+ Ik kan rijden</button>` : ''}
          </div>
          <div id="carpool-detail-body"><div class="spinner" style="padding:1rem;text-align:center"></div></div>
        </div>` : ''}

    </div>`;

  // Load map — only for away games
  if (!isHomeGame && (match.venue_address || match.venue_name)) {
    const venueAddr = match.venue_address || match.venue_name;
    const clubHomeAddr = club?.home_address?.replace(/\s+/g, ' ').trim() || null;
    const showRoute = !isResult && canInteract && clubHomeAddr;
    loadMatchMap(venueAddr, showRoute ? clubHomeAddr : null);
  }

  // Team name links → team page
  container.querySelectorAll('.match-detail-team-link').forEach(el => {
    const teamName = el.dataset.teamName;
    const storedCode = el.dataset.nevoboCode;
    if (teamName) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const code = resolveClubCode(teamName, storedCode) || storedCode;
        navigate('team', { teamName, nevoboCode: code });
      });
    }
  });

  // Load gallery
  loadMatchGallery(matchId, canInteract);

  // Load carpool seat summary — only for away games
  if (!isResult && !isHomeGame) {
    loadCarpoolDetail(matchId, canInteract);
    document.getElementById('carpool-offer-btn')?.addEventListener('click', () => {
      showOfferModal(matchId, () => loadCarpoolDetail(matchId, canInteract));
    });
  }

  if (canInteract) {
    document.getElementById('upload-btn')?.addEventListener('click', () => {
      sessionStorage.setItem('vb_upload_intent', matchId);
      showUploadModal(matchId);
    });

    // Re-open upload modal if the page reloaded mid-upload (e.g. after camera capture)
    const savedIntent = sessionStorage.getItem('vb_upload_intent');
    if (savedIntent && savedIntent === matchId) {
      sessionStorage.removeItem('vb_upload_intent');
      // Small delay so the page finishes rendering first
      setTimeout(() => showUploadModal(matchId), 400);
    }
  }
}

async function renderMatchDetailById(container, matchId, club, canInteract) {
  container.innerHTML = `<div class="spinner"></div>`;
  try {
    const [schedData, resData] = await Promise.all([
      api(`/api/nevobo/club/${club.nevobo_code}/schedule`).catch(() => ({ matches: [] })),
      api(`/api/nevobo/club/${club.nevobo_code}/results`).catch(() => ({ matches: [] })),
    ]);
    const all = [...(schedData.matches || []), ...(resData.matches || [])];
    const match = all.find(m => encodeMatchId(m) === matchId);
    if (match) {
      renderMatchDetail(container, match, club, null, canInteract);
    } else {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Wedstrijd niet gevonden</p><button class="btn btn-primary mt-3" onclick="navigate('matches')">Terug</button></div>`;
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

// Called when navigating from team page — fetches via team-by-name feed
async function renderMatchDetailByTeamFeed(container, matchId, teamName, nevoboCode, club) {
  container.innerHTML = `<div class="spinner"></div>`;
  try {
    const q = `name=${encodeURIComponent(teamName)}&code=${encodeURIComponent(nevoboCode)}`;
    const data = await api(`/api/nevobo/team-by-name?${q}`);
    const all = [...(data.schedule || []), ...(data.results || [])];
    const match = all.find(m => encodeMatchId(m) === matchId);
    // canInteract only if this is the user's own club's team
    const isOwnClub = club?.nevobo_code && (
      nevoboCode === club.nevobo_code ||
      (data.dbTeam?.nevobo_code === club.nevobo_code)
    );
    if (match) {
      renderMatchDetail(container, match, club || { nevobo_code: nevoboCode, name: teamName }, null, isOwnClub);
    } else {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Wedstrijd niet gevonden</p><button class="btn btn-primary mt-3" onclick="navigate('matches')">Terug</button></div>`;
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

async function loadMatchMap(address, fromAddress = null) {
  const mapEl = document.getElementById('map');
  if (!mapEl) return;

  const dismissLoader = () => {
    const loader = document.getElementById('map-loader');
    if (loader) loader.remove();
  };

  // Update loader label when we know whether to show a route
  const loaderLabel = mapEl.querySelector('#map-loader span');
  if (loaderLabel) {
    loaderLabel.textContent = fromAddress ? 'Route berekenen…' : 'Kaart laden…';
  }

  try {
    // Geocode destination
    const destData = await api(`/api/nevobo/geocode?address=${encodeURIComponent(address)}`);
    const dest = destData.location;

    const map = L.map('map').setView([dest.lat, dest.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
    }).addTo(map);

    if (fromAddress) {
      // Geocode origin (home hall)
      let origin = null;
      try {
        const origData = await api(`/api/nevobo/geocode?address=${encodeURIComponent(fromAddress)}`);
        origin = origData.location;
      } catch (_) {}

      if (origin) {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
        try {
          const routeResp = await fetch(osrmUrl, { headers: { 'User-Agent': 'VolleyballTeamApp/1.0' } });
          const routeData = await routeResp.json();
          if (routeData.code === 'Ok' && routeData.routes?.[0]) {
            const route = routeData.routes[0];
            const durationMin = Math.round(route.duration / 60);
            const distKm = (route.distance / 1000).toFixed(1);

            L.geoJSON(route.geometry, {
              style: { color: 'var(--primary, #4f46e5)', weight: 4, opacity: 0.8 },
            }).addTo(map);

            const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
            map.fitBounds(L.latLngBounds(coords), { padding: [24, 24] });

            L.marker([origin.lat, origin.lng], {
              icon: L.divIcon({ className: '', html: '<div style="background:#fff;border:3px solid var(--primary,#4f46e5);border-radius:50%;width:14px;height:14px"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
            }).addTo(map).bindPopup(`<strong>Thuishal</strong><br>${fromAddress}`);

            L.marker([dest.lat, dest.lng]).addTo(map)
              .bindPopup(`<strong>${address}</strong><br>🚗 ${durationMin} min · ${distKm} km`)
              .openPopup();

            dismissLoader();
            return;
          }
        } catch (_) {}
      }
    }

    // Fallback: single marker
    L.marker([dest.lat, dest.lng]).addTo(map)
      .bindPopup(`<strong>${address}</strong>`)
      .openPopup();
    dismissLoader();
  } catch (_) {
    dismissLoader();
    const mapEl2 = document.getElementById('map');
    if (mapEl2) mapEl2.innerHTML = '<div class="empty-state" style="padding:1.5rem"><div class="empty-icon">🗺️</div><p>Locatie niet gevonden</p></div>';
  }
}

// ─── Media gallery (Insta/TikTok style) ──────────────────────────────────────

let _galleryItems = [];   // shared across preview + fullscreen viewer
let _galleryMatchId = '';
let _galleryCanInteract = false;

async function loadMatchGallery(matchId, canInteract = true) {
  _galleryMatchId = matchId;
  _galleryCanInteract = canInteract;
  const el = document.getElementById('gallery-body');
  if (!el) return;
  try {
    const userId = state.user?.id || null;
    const { media } = await api(`/api/social/match/${matchId}/media${userId ? `?userId=${userId}` : ''}`);
    _galleryItems = media || [];

    if (_galleryItems.length === 0) {
      el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.9rem">${
        canInteract ? 'Nog geen foto\'s. Wees de eerste! 📸' : 'Nog geen foto\'s gedeeld voor deze wedstrijd.'
      }</div>`;
      return;
    }

    renderGalleryPreview(el);
  } catch (_) {
    const el2 = document.getElementById('gallery-body');
    if (el2) el2.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.9rem">Foto's konden niet worden geladen.</div>`;
  }
}

function renderGalleryPreview(el) {
  const m = _galleryItems[0];
  const rest = _galleryItems.length - 1;

  const thumbsHtml = _galleryItems.slice(1, 4).map((t, i) => `
    <div class="gallery-thumb ${i === 2 && rest > 3 ? 'gallery-thumb-more' : ''}"
         data-idx="${i + 1}" style="flex:1;aspect-ratio:1;overflow:hidden;position:relative;cursor:pointer;border-radius:6px;background:#000">
      ${t.file_type === 'video'
        ? `<video src="${t.file_path}" style="width:100%;height:100%;object-fit:cover" muted playsinline></video><div class="gallery-play-badge">▶</div>`
        : `<img src="${t.file_path}" alt="" style="width:100%;height:100%;object-fit:cover" loading="lazy" />`}
      ${i === 2 && rest > 3 ? `<div class="gallery-more-overlay">+${rest - 2}</div>` : ''}
    </div>`).join('');

  el.innerHTML = `
    <div class="gallery-preview" data-idx="0">
      <div class="gallery-main" style="position:relative;cursor:pointer;background:#000">
        ${m.file_type === 'video'
          ? `<video src="${m.file_path}" style="width:100%;max-height:340px;object-fit:contain;display:block" muted playsinline></video><div class="gallery-play-badge gallery-play-badge-lg">▶</div>`
          : `<img src="${m.file_path}" alt="" style="width:100%;max-height:340px;object-fit:contain;display:block" loading="lazy" />`}
        <div class="gallery-meta-bar">
          <span class="gallery-stat">👁 ${m.view_count || 0}</span>
          <span class="gallery-stat">❤️ ${m.like_count || 0}</span>
          <span class="gallery-stat">💬 ${m.comment_count || 0}</span>
          ${_galleryItems.length > 1 ? `<span class="gallery-count-badge">${_galleryItems.length}</span>` : ''}
        </div>
      </div>
      ${rest > 0 ? `<div class="gallery-thumbs">${thumbsHtml}</div>` : ''}
    </div>`;

  el.querySelectorAll('[data-idx]').forEach(node => {
    node.addEventListener('click', () => openMediaViewer(parseInt(node.dataset.idx)));
  });
}

function openMediaViewer(startIdx = 0) {
  let currentIdx = startIdx;
  let startX = 0;

  const overlay = document.createElement('div');
  overlay.id = 'media-viewer';
  overlay.innerHTML = `
    <div class="mv-backdrop"></div>
    <button class="mv-close" aria-label="Sluiten">✕</button>
    <div class="mv-track"></div>
    <div class="mv-footer">
      <div class="mv-uploader-row">
        <img class="mv-avatar" src="" alt="" />
        <span class="mv-uploader-name"></span>
        <span class="mv-dot">·</span>
        <span class="mv-caption"></span>
      </div>
      <div class="mv-actions">
        <button class="mv-action-btn mv-like-btn" data-liked="false">
          <span class="mv-like-icon">🤍</span>
          <span class="mv-like-count">0</span>
        </button>
        <button class="mv-action-btn mv-comment-btn">💬 <span class="mv-comment-count">0</span></button>
        <span class="mv-views">👁 <span class="mv-view-count">0</span></span>
        <button class="mv-action-btn mv-delete-btn" style="display:none;margin-left:auto;color:#f87171" title="Verwijderen">🗑</button>
      </div>
      <div class="mv-dots"></div>
    </div>
    <div class="mv-comments-panel" id="mv-comments-panel" style="display:none">
      <div class="mv-comments-header">
        <span>Reacties</span>
        <button class="mv-close-comments">✕</button>
      </div>
      <div class="mv-comments-list" id="mv-comments-list"></div>
      ${state.token ? `
        <form class="mv-comment-form" id="mv-comment-form">
          <input type="text" class="mv-comment-input" id="mv-comment-input" placeholder="Schrijf een reactie…" />
          <button type="submit" class="mv-comment-submit">➤</button>
        </form>` : `<p style="padding:0.75rem;font-size:0.8rem;color:#aaa">Log in om te reageren</p>`}
    </div>`;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  const track = overlay.querySelector('.mv-track');
  const likeBtn = overlay.querySelector('.mv-like-btn');
  const commentBtn = overlay.querySelector('.mv-comment-btn');
  const deleteBtn = overlay.querySelector('.mv-delete-btn');
  const commentsPanel = overlay.querySelector('#mv-comments-panel');

  function buildTrack() {
    track.innerHTML = _galleryItems.map((m, i) => `
      <div class="mv-slide" data-idx="${i}">
        ${m.file_type === 'video'
          ? `<video src="${m.file_path}" class="mv-media" controls autoplay loop muted playsinline></video>`
          : `<img src="${m.file_path}" class="mv-media" alt="" />`}
      </div>`).join('');
  }

  function goTo(idx) {
    currentIdx = Math.max(0, Math.min(idx, _galleryItems.length - 1));
    track.style.transform = `translateX(-${currentIdx * 100}%)`;

    // Pause all videos, autoplay current
    track.querySelectorAll('video').forEach((v, i) => {
      if (i === currentIdx) {
        v.currentTime = 0;
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    });

    updateFooter();
    recordView();
  }

  function updateFooter() {
    const m = _galleryItems[currentIdx];
    const avatar = overlay.querySelector('.mv-avatar');
    avatar.src = m.uploader_avatar || '/img/default-avatar.png';
    overlay.querySelector('.mv-uploader-name').textContent = m.uploader_name || '';
    overlay.querySelector('.mv-caption').textContent = m.caption || '';
    overlay.querySelector('.mv-like-count').textContent = m.like_count || 0;
    overlay.querySelector('.mv-comment-count').textContent = m.comment_count || 0;
    overlay.querySelector('.mv-view-count').textContent = m.view_count || 0;
    likeBtn.dataset.liked = m.liked_by_me ? 'true' : 'false';
    overlay.querySelector('.mv-like-icon').textContent = m.liked_by_me ? '❤️' : '🤍';

    // Delete button — only visible to uploader
    deleteBtn.style.display = (state.user?.id && m.user_id === state.user.id) ? 'flex' : 'none';

    // Dots
    const dots = overlay.querySelector('.mv-dots');
    if (_galleryItems.length > 1) {
      dots.innerHTML = _galleryItems.map((_, i) =>
        `<span class="mv-dot-item${i === currentIdx ? ' active' : ''}"></span>`
      ).join('');
    } else {
      dots.innerHTML = '';
    }
  }

  async function recordView() {
    try {
      const m = _galleryItems[currentIdx];
      const userId = state.user?.id || null;
      const data = await fetch(`/api/social/media/${m.id}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }).then(r => r.json());
      if (data.ok) {
        m.view_count = data.view_count;
        overlay.querySelector('.mv-view-count').textContent = data.view_count;
      }
    } catch (_) {}
  }

  async function toggleLike() {
    if (!state.token) { showToast('Log in om te liken', 'info'); return; }
    const m = _galleryItems[currentIdx];
    try {
      const data = await api(`/api/social/media/${m.id}/like`, { method: 'POST' });
      m.like_count = data.like_count;
      m.liked_by_me = data.liked;
      overlay.querySelector('.mv-like-count').textContent = data.like_count;
      overlay.querySelector('.mv-like-icon').textContent = data.liked ? '❤️' : '🤍';
      likeBtn.dataset.liked = data.liked ? 'true' : 'false';
    } catch (_) {}
  }

  async function openComments() {
    const m = _galleryItems[currentIdx];
    commentsPanel.style.display = 'flex';
    const listEl = document.getElementById('mv-comments-list');
    listEl.innerHTML = '<div style="padding:0.75rem;font-size:0.85rem;color:#aaa">Laden…</div>';
    try {
      const { comments } = await api(`/api/social/media/${m.id}/comments`);
      if (!comments.length) {
        listEl.innerHTML = '<div style="padding:0.75rem;font-size:0.85rem;color:#aaa">Nog geen reacties. Schrijf de eerste!</div>';
      } else {
        listEl.innerHTML = comments.map(c => `
          <div class="mv-comment">
            <img src="${c.author_avatar || '/img/default-avatar.png'}" class="mv-comment-avatar" alt="" />
            <div>
              <span class="mv-comment-author">${escapeHtml(c.author_name)}</span>
              <span class="mv-comment-body">${escapeHtml(c.body)}</span>
            </div>
          </div>`).join('');
      }
    } catch (_) {
      listEl.innerHTML = '<div style="padding:0.75rem;font-size:0.85rem;color:#aaa">Laden mislukt.</div>';
    }
  }

  function closeViewer() {
    document.body.style.overflow = '';
    overlay.remove();
    // Refresh the preview counts
    const el = document.getElementById('gallery-body');
    if (el) renderGalleryPreview(el);
  }

  // Touch / mouse swipe
  overlay.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  overlay.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) goTo(currentIdx + (dx < 0 ? 1 : -1));
  });

  // Close
  overlay.querySelector('.mv-close').addEventListener('click', closeViewer);
  overlay.querySelector('.mv-backdrop').addEventListener('click', e => {
    if (e.target === overlay.querySelector('.mv-backdrop')) closeViewer();
  });

  likeBtn.addEventListener('click', toggleLike);
  commentBtn.addEventListener('click', openComments);
  deleteBtn.addEventListener('click', async () => {
    const m = _galleryItems[currentIdx];
    if (!confirm('Wil je dit item verwijderen?')) return;
    try {
      const data = await api(`/api/social/media/${m.id}`, { method: 'DELETE' });
      if (!data.ok) { showToast('Verwijderen mislukt', 'error'); return; }
      _galleryItems.splice(currentIdx, 1);
      if (_galleryItems.length === 0) {
        closeViewer();
        const el = document.getElementById('gallery-body');
        if (el) el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.9rem">Nog geen foto's. Wees de eerste! 📸</div>`;
      } else {
        buildTrack();
        goTo(Math.min(currentIdx, _galleryItems.length - 1));
      }
      showToast('Verwijderd', 'success');
    } catch (_) { showToast('Verwijderen mislukt', 'error'); }
  });
  overlay.querySelector('.mv-close-comments').addEventListener('click', () => { commentsPanel.style.display = 'none'; });

  const commentForm = overlay.querySelector('#mv-comment-form');
  if (commentForm) {
    commentForm.addEventListener('submit', async e => {
      e.preventDefault();
      const input = document.getElementById('mv-comment-input');
      const body = input.value.trim();
      if (!body) return;
      try {
        const m = _galleryItems[currentIdx];
        const data = await api(`/api/social/media/${m.id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body }),
        });
        m.comment_count = (m.comment_count || 0) + 1;
        overlay.querySelector('.mv-comment-count').textContent = m.comment_count;
        input.value = '';
        openComments();
      } catch (_) { showToast('Reactie plaatsen mislukt', 'error'); }
    });
  }

  buildTrack();
  goTo(startIdx);
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function showUploadModal(matchId) {
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">📸 Foto's & video's uploaden</h3>
      <form id="upload-form">
        <div id="fp-wrap" class="form-group"></div>
        <div class="form-group">
          <label class="form-label">Onderschrift (optioneel)</label>
          <input type="text" id="upload-caption" class="form-input" placeholder="Wat een geweldige wedstrijd!" />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" style="flex:1" id="upload-cancel">Annuleren</button>
          <button type="submit" class="btn btn-primary" style="flex:1" id="upload-submit">Uploaden</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('upload-cancel').addEventListener('click', () => {
    sessionStorage.removeItem('vb_upload_intent');
    overlay.remove();
  });

  const picker = new FilePicker(document.getElementById('fp-wrap'), {
    accept: 'image/*,video/*',
    multiple: true,
    maxFiles: 10,
  });

  document.getElementById('upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    const files = picker.getFiles();
    if (files.length === 0) { showToast('Kies eerst bestanden', 'error'); return; }

    const btn = document.getElementById('upload-submit');
    btn.disabled = true; btn.textContent = 'Bezig…';
    const fd = new FormData();
    files.forEach(f => fd.append('files', f));
    const caption = document.getElementById('upload-caption').value;
    if (caption) fd.append('caption', caption);
    fd.append('match_id', matchId);
    try {
      await fetch('/api/social/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.token}` },
        body: fd,
      });
      sessionStorage.removeItem('vb_upload_intent');
      overlay.remove();
      showToast("Foto's geüpload! 📸", 'success');
      loadMatchGallery(matchId, true);
    } catch (err) {
      showToast('Upload mislukt', 'error');
      btn.disabled = false; btn.textContent = 'Uploaden';
    }
  });
}

function showOfferModal(matchId, onSuccess) {
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
          <input type="time" id="offer-time" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">Opmerking (optioneel)</label>
          <input type="text" id="offer-note" class="form-input" placeholder="Bijv. Bel me even van tevoren" />
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary" style="flex:1" id="offer-cancel">Annuleren</button>
          <button type="submit" class="btn btn-primary" style="flex:1" id="offer-submit">Aanbieden</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('offer-cancel').addEventListener('click', () => overlay.remove());
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
      if (onSuccess) onSuccess();
    } catch (err) {
      showToast(err.message || 'Mislukt', 'error');
      btn.disabled = false; btn.textContent = 'Aanbieden';
    }
  });
}

function encodeMatchId(match) {
  return encodeURIComponent(match.match_id || match.link?.replace(/.*\//, '') || match.title?.slice(0, 40) || 'onbekend');
}

// Sort matches by date. Results: most recent first. Schedule: soonest first.
function sortByDate(matches, tab) {
  return [...matches].sort((a, b) => {
    const da = a.datetime ? new Date(a.datetime) : new Date(0);
    const db = b.datetime ? new Date(b.datetime) : new Date(0);
    return tab === 'results' ? db - da : da - db;
  });
}

// Fetch carpool free-seat counts for an array of matchIds.
// Returns a Map<matchId, freeSeats>.
async function loadCarpoolDetail(matchId, canInteract = false) {
  const body = document.getElementById('carpool-detail-body');
  if (!body) return;
  try {
    const data = await fetch(`/api/carpool/${matchId}/summary`).then(r => r.json());
    if (!data.ok) { body.innerHTML = `<div class="card-body text-muted text-small">Niet beschikbaar</div>`; return; }

    const { drivers, free_seats } = data;
    const userId = state.user?.id;
    const myOffer = drivers.find(d => d.user_id === userId);

    if (drivers.length === 0) {
      body.innerHTML = `<div class="card-body" style="color:var(--text-muted);font-size:0.85rem;padding:1rem">Nog geen aanbod — wees de eerste!</div>`;
    } else {
      body.innerHTML = `
        <div style="padding:0.25rem 0">
          ${drivers.map(d => {
            const isMine = d.user_id === userId;
            const seatLabel = d.free_seats <= 0
              ? `<span style="color:var(--danger,#ef4444);font-size:0.75rem;font-weight:600">Vol</span>`
              : `<span style="color:var(--success,#22c55e);font-size:0.75rem;font-weight:600">${d.free_seats} plek${d.free_seats !== 1 ? 'ken' : ''} vrij</span>`;
            const meta = [d.departure_time ? `🕐 ${d.departure_time}` : '', d.departure_point ? `📍 ${d.departure_point}` : ''].filter(Boolean).join(' · ');
            return `
              <div class="carpool-inline-row" data-offer="${d.offer_id}">
                <div style="display:flex;align-items:center;gap:0.6rem;flex:1;min-width:0">
                  <div class="avatar avatar-sm" style="background:linear-gradient(135deg,var(--primary),var(--accent));flex-shrink:0">${(d.driver_name||'?')[0].toUpperCase()}</div>
                  <div style="min-width:0">
                    <div style="font-weight:600;font-size:0.88rem">${d.driver_name}${isMine ? ' <span style="font-size:0.7rem;opacity:0.6">(jij)</span>' : ''}</div>
                    ${meta ? `<div style="font-size:0.75rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${meta}</div>` : ''}
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:0.5rem;flex-shrink:0">
                  ${seatLabel}
                  ${isMine ? `<button class="btn btn-secondary btn-sm carpool-delete-btn" data-offer="${d.offer_id}" style="font-size:0.75rem;padding:0.2rem 0.6rem">Verwijderen</button>` : ''}
                </div>
              </div>`;
          }).join('')}
        </div>
        ${free_seats > 0 ? `<div style="padding:0.4rem 0.75rem 0.75rem;font-size:0.8rem;color:var(--text-muted)">Totaal ${free_seats} vrije plaats${free_seats !== 1 ? 'en' : ''}</div>` : ''}`;
    }

    // Wire delete buttons
    body.querySelectorAll('.carpool-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Wil je je lift aanbod verwijderen?')) return;
        try {
          await api(`/api/carpool/offer/${btn.dataset.offer}`, { method: 'DELETE' });
          showToast('Aanbod verwijderd', 'info');
          loadCarpoolDetail(matchId, canInteract);
        } catch (err) { showToast(err.message || 'Mislukt', 'error'); }
      });
    });

    // Update offer button: hide if user already has an offer
    const offerBtn = document.getElementById('carpool-offer-btn');
    if (offerBtn) offerBtn.style.display = myOffer ? 'none' : '';

  } catch (_) {
    const b = document.getElementById('carpool-detail-body');
    if (b) b.innerHTML = `<div class="card-body text-muted text-small">Niet beschikbaar</div>`;
  }
}

async function fetchCarpoolSummaries(matchIds) {
  const map = new Map();
  if (!matchIds.length) return map;
  await Promise.all(matchIds.map(async id => {
    try {
      const data = await fetch(`/api/carpool/${id}/summary`).then(r => r.json());
      if (data.ok) map.set(id, data.free_seats);
    } catch (_) {}
  }));
  return map;
}

function escapeAttr(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
