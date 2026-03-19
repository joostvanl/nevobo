import { api, state, formatDate, formatTime, showToast, navigate, showQualityWarningModal, showQualityDebugPanel } from '../app.js';
import { FilePicker } from '../file-picker.js';
import { openReelViewer } from '../reel-viewer.js';
import { buildReelStripCardsHtml, setupReelStripVideoAutoplay } from '../reel-strip.js';
import { escHtml } from '../escape-html.js';

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
      renderMatchDetailByTeamFeed(container, params.matchId, params.teamName, params.nevoboCode, club, myTeams);
    } else {
      renderMatchDetailById(container, params.matchId, club, myTeams.length > 0, myTeams);
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
      contentEl.innerHTML = `<div id="own-matches-combined"><div class="spinner"></div></div>`;
      loadAllMyTeamsSection(contentEl.querySelector('#own-matches-combined'), club, myTeams, tab);
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
        const code = resolveClubCode(teamName, el.dataset.nevobocode, true) || el.dataset.nevobocode;
        navigate('team', { teamName, nevoboCode: code });
      });
    });

    // Card click → detail
    listEl.querySelectorAll('.mc-card[data-match-idx]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.team-name-link') || e.target.closest('.match-carpool-btn')) return;
        const idx = parseInt(card.dataset.matchIdx);
        renderMatchDetail(listEl.closest('.container').parentElement, matches[idx], club, tab, canInteract, team ? [team] : []);
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

async function loadAllMyTeamsSection(listEl, club, myTeams, tab) {
  if (!listEl) return;
  loadOpponentClubs(club.nevobo_code);
  try {
    const endpoint = tab === 'schedule'
      ? `/api/nevobo/club/${club.nevobo_code}/schedule`
      : `/api/nevobo/club/${club.nevobo_code}/results`;

    const data = await api(endpoint);
    const allMatches = data.matches || [];

    // Collect matches for all user's teams combined, deduplicated, sorted by date
    const seen = new Set();
    const matches = [];
    for (const team of myTeams) {
      const name = team.display_name.toLowerCase();
      for (const m of allMatches) {
        const key = encodeMatchId(m);
        if (seen.has(key)) continue;
        const home = (m.home_team || '').toLowerCase();
        const away = (m.away_team || '').toLowerCase();
        if (home === name || away === name || home.endsWith(name) || away.endsWith(name) || home.includes(name) || away.includes(name)) {
          seen.add(key);
          matches.push({ ...m, _matchingTeam: team });
        }
      }
    }

    const sorted = sortByDate(matches, tab);

    if (sorted.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:1.25rem 0">
          <div class="empty-icon" style="font-size:1.8rem">${tab === 'schedule' ? '📅' : '🏐'}</div>
          <p style="font-size:0.875rem">${tab === 'schedule' ? 'Geen geplande wedstrijden.' : 'Nog geen resultaten.'}</p>
        </div>`;
      return;
    }

    let carpoolMap = new Map();
    if (tab === 'schedule') {
      carpoolMap = await fetchCarpoolSummaries(sorted.map(m => encodeMatchId(m)));
    }

    listEl.innerHTML = sorted.map((m, i) => renderMatchCard(m, i, tab, true, club.nevobo_code, carpoolMap.get(encodeMatchId(m)) ?? null, club.name || '')).join('');

    listEl.querySelectorAll('.team-name-link').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const teamName = el.dataset.teamname;
        const code = resolveClubCode(teamName, el.dataset.nevobocode, true) || el.dataset.nevobocode;
        navigate('team', { teamName, nevoboCode: code });
      });
    });

    listEl.querySelectorAll('.mc-card[data-match-idx]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.team-name-link') || e.target.closest('.match-carpool-btn')) return;
        const m = sorted[parseInt(card.dataset.matchIdx)];
        // Use the already-resolved _matchingTeam so uploads get the right team_id
        if (m) renderMatchDetail(listEl.closest('.container').parentElement, m, club, tab, true, m._matchingTeam ? [m._matchingTeam] : myTeams);
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
        const code = resolveClubCode(teamName, el.dataset.nevobocode, true) || el.dataset.nevobocode;
        navigate('team', { teamName, nevoboCode: code });
      });
    });

    // Pre-resolve which of the user's teams each match belongs to
    sorted.forEach(m => {
      if (m._matchingTeam) return;
      const found = (Array.isArray(myTeams) ? myTeams : []).find(t => {
        const n = (t.display_name || '').toLowerCase();
        if (!n) return false;
        const h = (m.home_team || '').toLowerCase();
        const a = (m.away_team || '').toLowerCase();
        return h === n || a === n || h.endsWith(n) || a.endsWith(n) || h.includes(n) || a.includes(n);
      });
      if (found) m._matchingTeam = found;
    });

    // Card click → detail
    listEl.querySelectorAll('.mc-card[data-match-idx]').forEach(card => {
      card.addEventListener('click', e => {
        if (e.target.closest('.team-name-link') || e.target.closest('.match-carpool-btn')) return;
        const m = sorted[parseInt(card.dataset.matchIdx)];
        if (m) renderMatchDetail(listEl.closest('.container').parentElement, m, club, tab, canInteractFor(m), m._matchingTeam ? [m._matchingTeam] : myTeams);
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
        const code = resolveClubCode(teamName, el.dataset.nevobocode, true) || el.dataset.nevobocode;
        navigate('team', { teamName, nevoboCode: code });
      });
    });

    // Card click → read-only detail
    listEl.querySelectorAll('.mc-card[data-match-idx]').forEach(card => {
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

  const teamLink = (name) => {
    if (!nevoboCode || !name) return `class="match-team-name"`;
    const code = resolveClubCode(name, nevoboCode);
    return `class="match-team-name team-name-link" data-teamname="${escHtml(name)}" data-nevobocode="${escHtml(code)}"`;
  };

  const teamLogo = (name, directCode) => {
    const code = directCode || resolveClubCode(name, nevoboCode, true);
    if (!code) return '';
    const url = resolveTeamLogo(name, nevoboCode) || `https://assets.nevobo.nl/organisatie/logo/${code.toUpperCase()}.jpg`;
    return `<img src="${url}" alt="${escHtml(name)}"
      onload="this.style.opacity=1"
      onerror="this.style.display='none'"
      style="width:34px;height:34px;border-radius:8px;object-fit:contain;background:#fff;flex-shrink:0;opacity:0;transition:opacity .15s;border:1px solid var(--border)" />`;
  };

  // Centre column: score pill for results, VS badge for schedule
  const centreHtml = isResult && match.score_home != null
    ? `<div class="mc-score">
        <span class="mc-score-num">${match.score_home}–${match.score_away}</span>
        ${match.sets?.length ? `<span class="mc-sets">${match.sets.join(' ')}</span>` : ''}
       </div>`
    : `<div class="mc-vs"><span>VS</span></div>`;

  const carpoolBadge = canInteract && !isResult && !isHomeGame && carpoolSeats !== null
    ? carpoolSeats > 0
      ? `<span class="mc-badge mc-badge--ok">🚗 ${carpoolSeats} plek${carpoolSeats === 1 ? '' : 'ken'}</span>`
      : `<span class="mc-badge">🚗 Vol</span>`
    : '';

  const readOnlyBadge = !canInteract
    ? `<span class="mc-badge">👁 volgend</span>`
    : '';

  const carpoolBtn = canInteract && !isResult && !isHomeGame
    ? `<button class="mc-action-btn match-carpool-btn" data-matchid="${encodeMatchId(match)}">🚗 Carpool</button>`
    : '';

  return `
    <div class="mc-card" data-match-idx="${idx}">
      <div class="mc-teams">
        <div class="mc-side">
          ${teamLogo(match.home_team, match.home_club_code)}
          <span ${teamLink(match.home_team)} class="mc-name">${match.home_team || '—'}</span>
        </div>
        ${centreHtml}
        <div class="mc-side mc-side-right">
          ${teamLogo(match.away_team, match.away_club_code)}
          <span ${teamLink(match.away_team)} class="mc-name">${match.away_team || '—'}</span>
        </div>
      </div>
      <div class="mc-foot">
        <div class="mc-foot-left">
          ${match.datetime ? `<span class="mc-dt">${formatDate(match.datetime)} · ${formatTime(match.datetime)}</span>` : ''}
          ${match.venue_name ? `<span class="mc-venue">📍 ${match.venue_name}</span>` : ''}
          ${match.poule_code ? `<span class="mc-badge">${match.poule_code}</span>` : ''}
          ${carpoolBadge}${readOnlyBadge}
        </div>
        <div class="mc-foot-right">
          ${carpoolBtn}
          <button class="mc-action-btn details-btn">Details →</button>
        </div>
      </div>
    </div>`;
}

function renderMatchDetail(container, match, club, fromTab, canInteract = true, myTeams = []) {
  const isResult = match.status === 'gespeeld';
  const matchId = encodeMatchId(match);

  // A home game is one where the user's own club is playing at their own hall.
  // We detect this by checking if the home_team name contains the club name.
  // Only relevant when the user can interact (own team context).
  const clubNameLower = (club?.name || '').toLowerCase();
  const isHomeGame = canInteract && clubNameLower.length > 0
    && (match.home_team || '').toLowerCase().includes(clubNameLower);

  // Matching team = user's team that plays in this match (for scout button)
  const norm = s => (s || '').toLowerCase().replace(/\s+/g, '');
  const matchingTeam = (match._matchingTeam && myTeams.find(t => t.id === match._matchingTeam.id))
    || myTeams.find(t => {
        const dn = (t.display_name || t.team_name || '').trim();
        if (!dn || dn.length < 2) return false;
        const dnNorm = norm(dn);
        const homeNorm = norm(match.home_team);
        const awayNorm = norm(match.away_team);
        return homeNorm.includes(dnNorm) || awayNorm.includes(dnNorm)
            || (match.home_team || '').toLowerCase().includes(dn.toLowerCase())
            || (match.away_team || '').toLowerCase().includes(dn.toLowerCase());
      })
    || (myTeams.length === 1 && clubNameLower && (
        (match.home_team || '').toLowerCase().includes(clubNameLower) ||
        (match.away_team || '').toLowerCase().includes(clubNameLower)
      ) ? myTeams[0] : null);
  const isScoutAllowed = state.features?.scout !== false && canInteract && matchingTeam && (
    (state.user?.memberships?.some(m => m.team_id === matchingTeam.id && m.membership_type === 'coach'))
    || (state.user?.roles?.some(r =>
      r.role === 'super_admin'
      || (r.role === 'club_admin' && r.club_id === matchingTeam.club_id)
      || (r.role === 'team_admin' && r.team_id === matchingTeam.id)
    ))
  );

  container.innerHTML = `
    <div class="page-hero">
      <div class="container">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem">
          <button class="btn" style="background:rgba(255,255,255,0.2);color:#fff"
            onclick="navigate('matches')">← Terug</button>
          ${isScoutAllowed ? `
            <button class="btn" id="match-scout-btn" style="background:rgba(255,255,255,0.25);color:#fff;font-size:0.9rem"
              title="Scout wedstrijd">🏐 Scout</button>
            <span id="scout-lock-info" class="hidden" style="color:rgba(255,255,255,0.8);font-size:0.75rem;width:100%;text-align:right"></span>` : ''}
        </div>
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
          ${canInteract ? `
            <div class="match-media-actions" style="margin-left:auto">
              <button class="mma-btn" id="photo-btn" title="Foto maken">
                <span class="mma-icon">📷</span>
                <span class="mma-label">Foto</span>
              </button>
              <button class="mma-btn" id="video-btn" title="Video opnemen">
                <span class="mma-icon">🎥</span>
                <span class="mma-label">Video</span>
              </button>
              <button class="mma-btn mma-btn--dim" id="live-btn" title="Live uitzending (binnenkort)">
                <span class="mma-icon">🔴</span>
                <span class="mma-label">Live</span>
              </button>
              <button class="mma-btn" id="upload-btn" title="Bestand uploaden">
                <span class="mma-icon">⬆️</span>
                <span class="mma-label">Upload</span>
              </button>
            </div>` : ''}
        </div>
        <div id="gallery-body" style="padding:0.5rem 0"><div class="spinner" style="padding:1.5rem;text-align:center"></div></div>
      </div>
      <!-- Carpool — only for away games and team members -->
      ${canInteract && !isResult && !isHomeGame ? `
        <div class="card mb-3" id="carpool-detail-card">
          <div class="card-header">
            <h3>🚗 Carpool</h3>
            <button class="btn btn-accent btn-sm" id="carpool-offer-btn" style="margin-left:auto">+ Ik kan rijden</button>
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
        // Use strict mode: only use resolved code if we're confident it's correct.
        // storedCode may be the own club's code (passed as context), so prefer a strict
        // lookup that returns null for unknowns rather than silently using the wrong code.
        const code = resolveClubCode(teamName, storedCode, true) || storedCode;
        navigate('team', { teamName, nevoboCode: code });
      });
    }
  });

  // Load gallery (pass match so API can return home/away for reel badge)
  loadMatchGallery(matchId, canInteract, match);

  // Load carpool seat summary — only for away games
  if (!isResult && !isHomeGame) {
    loadCarpoolDetail(matchId, canInteract);
    document.getElementById('carpool-offer-btn')?.addEventListener('click', () => {
      showOfferModal(matchId, () => loadCarpoolDetail(matchId, canInteract));
    });
  }

  if (canInteract) {
    // Determine which of the user's teams is playing in this match.
    // Prefer _matchingTeam already resolved by the list view; fall back to name matching.
    // Do NOT fall back to myTeams[0] — that would store the wrong team for multi-team users.
    const matchingTeam = (match._matchingTeam && myTeams.find(t => t.id === match._matchingTeam.id))
      || myTeams.find(t => {
          const dn = (t.display_name || '').toLowerCase();
          if (!dn || dn.length < 3) return false;
          return (match.home_team || '').toLowerCase().includes(dn)
              || (match.away_team || '').toLowerCase().includes(dn);
        })
      || null;
    const uploadTeamId = matchingTeam?.id || null;

    document.getElementById('photo-btn')?.addEventListener('click', () => {
      sessionStorage.setItem('vb_upload_intent', matchId);
      openCapturePicker('image/*', matchId, uploadTeamId, match);
    });

    document.getElementById('video-btn')?.addEventListener('click', () => {
      sessionStorage.setItem('vb_upload_intent', matchId);
      openCapturePicker('video/*', matchId, uploadTeamId, match);
    });

    document.getElementById('live-btn')?.addEventListener('click', () => {
      showToast('Live uitzending komt binnenkort! 🔴', 'info');
    });

    document.getElementById('upload-btn')?.addEventListener('click', () => {
      sessionStorage.setItem('vb_upload_intent', matchId);
      showUploadModal(matchId, uploadTeamId, match);
    });

    // Re-open upload modal if the page reloaded mid-upload (e.g. after camera capture)
    const savedIntent = sessionStorage.getItem('vb_upload_intent');
    if (savedIntent && savedIntent === matchId) {
      sessionStorage.removeItem('vb_upload_intent');
      setTimeout(() => showUploadModal(matchId, uploadTeamId, match), 400);
    }
  }

  // Scout button (visible only for coaches/admins when isScoutAllowed)
  // Ons team is altijd "thuis" in de scout, ongeacht de feitelijke thuis/uit status.
  const scoutBtn = container.querySelector('#match-scout-btn');
  if (scoutBtn) {
    scoutBtn.addEventListener('click', () => {
      if (scoutBtn.disabled) return;
      if (!matchingTeam) return;
      const dn = (matchingTeam.display_name || '').toLowerCase();
      const weAreHome = dn && (match.home_team || '').toLowerCase().includes(dn);
      navigate('scout-setup', {
        teamId: matchingTeam.id,
        nevoboMatchId: matchId,
        homeTeam: weAreHome ? (match.home_team || '') : (match.away_team || ''),
        awayTeam: weAreHome ? (match.away_team || '') : (match.home_team || ''),
      });
    });

    // Check lock status asynchronously
    const scoutMatchId = 'nm_' + matchId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80);
    api(`/api/scout/status/${encodeURIComponent(scoutMatchId)}`).then(st => {
      if (!st) return;
      const lockInfo = container.querySelector('#scout-lock-info');
      if (st.locked && !st.lockedByMe) {
        scoutBtn.disabled = true;
        scoutBtn.style.opacity = '0.5';
        scoutBtn.style.cursor = 'not-allowed';
        scoutBtn.textContent = '🔒 Bezet';
        scoutBtn.title = `Wordt gescouted door ${st.lockedBy || 'iemand anders'}`;
        if (lockInfo) {
          lockInfo.classList.remove('hidden');
          lockInfo.textContent = `🔒 Wordt gescouted door ${st.lockedBy || 'iemand anders'}`;
        }
      } else if (st.locked && st.lockedByMe) {
        scoutBtn.textContent = '🏐 Hervat scout';
      }
    }).catch(() => {});
  }
}

async function renderMatchDetailById(container, matchId, club, canInteract, myTeams = []) {
  container.innerHTML = `<div class="spinner"></div>`;
  try {
    const [schedData, resData] = await Promise.all([
      api(`/api/nevobo/club/${club.nevobo_code}/schedule`).catch(() => ({ matches: [] })),
      api(`/api/nevobo/club/${club.nevobo_code}/results`).catch(() => ({ matches: [] })),
    ]);
    const all = [...(schedData.matches || []), ...(resData.matches || [])];
    const match = all.find(m => encodeMatchId(m) === matchId);
    if (match) {
      renderMatchDetail(container, match, club, null, canInteract, myTeams);
    } else {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>Wedstrijd niet gevonden</p><button class="btn btn-primary mt-3" onclick="navigate('matches')">Terug</button></div>`;
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${err.message}</p></div>`;
  }
}

// Called when navigating from team page or home — fetches via team-by-name feed
async function renderMatchDetailByTeamFeed(container, matchId, teamName, nevoboCode, club, myTeams = []) {
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
      // Resolve matching team from myTeams for Scout button (team in this match from user's club)
      const dbTeam = data.dbTeam ? { id: data.dbTeam.id, display_name: data.dbTeam.display_name || teamName, club_id: data.dbTeam.club_id } : null;
      const resolvedMyTeams = dbTeam && myTeams.some(t => t.id === dbTeam.id) ? myTeams : (dbTeam ? [...myTeams, dbTeam] : myTeams);
      renderMatchDetail(container, match, club || { nevobo_code: nevoboCode, name: teamName }, null, isOwnClub, resolvedMyTeams);
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

// ─── Media gallery (reel style, matches homepage) ────────────────────────────

async function loadMatchGallery(matchId, canInteract = true, match = null) {
  const el = document.getElementById('gallery-body');
  if (!el) return;
  try {
    const userId = state.user?.id || null;
    const params = new URLSearchParams();
    if (userId) params.set('userId', userId);
    if (match?.home_team) params.set('home_team', match.home_team);
    if (match?.away_team) params.set('away_team', match.away_team);
    const qs = params.toString();
    const { media } = await api(`/api/social/match/${matchId}/media${qs ? '?' + qs : ''}`);
    const items = media || [];

    if (items.length === 0) {
      el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.9rem">${
        canInteract ? 'Nog geen foto\'s. Wees de eerste! 📸' : 'Nog geen foto\'s gedeeld voor deze wedstrijd.'
      }</div>`;
      return;
    }

    renderMatchReel(el, items, canInteract);
  } catch (_) {
    const el2 = document.getElementById('gallery-body');
    if (el2) el2.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.9rem">Foto's konden niet worden geladen.</div>`;
  }
}

function renderMatchReel(el, items, canInteract) {
  el.innerHTML = `
    <div class="hm-reel" id="match-reel-track" style="padding:0 0.75rem 0.75rem">
      ${buildReelStripCardsHtml(items, escHtml, {
        getClubLogoUrl: () => null,
        showTeamCaption: false,
        statsMode: 'likes_comments',
        includeSocialEmbeds: false,
      })}
    </div>`;

  const reelTrack = el.querySelector('#match-reel-track');
  if (!reelTrack) return;

  // Tap → open shared fullscreen reel viewer
  reelTrack.querySelectorAll('.hm-reel-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.index);
      const existingVideo = card.querySelector('video.hm-reel-media');
      const myUserId = state.user?.id;
      openReelViewer(items, idx, {
        sourceVideo: existingVideo,
        canDelete:      (item) => canInteract && myUserId && item.user_id === myUserId,
        canRevertBlur:  (item) => canInteract && myUserId && item.user_id === myUserId,
        onDelete: async (item) => {
          await api(`/api/social/media/${item.id}`, { method: 'DELETE' });
          items.splice(items.indexOf(item), 1);
          if (items.length === 0) {
            el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--text-muted);font-size:0.9rem">Nog geen foto's. Wees de eerste! 📸</div>`;
          } else {
            renderMatchReel(el, items, canInteract);
          }
          return true;
        },
        onClose: (updatedList) => {
          // Refresh thumbnails so blur/unblur changes are visible
          updatedList.forEach((item, i) => {
            if (item.file_type !== 'image') return;
            const card = reelTrack.querySelector(`.hm-reel-card[data-index="${i}"]`);
            if (!card) return;
            const img = card.querySelector('img.hm-reel-media');
            if (img) img.src = item.file_path.split('?')[0] + '?t=' + Date.now();
          });
        },
      });
    });
  });

  setupReelStripVideoAutoplay(reelTrack);
}

function openCapturePicker(accept, matchId, teamId, match = null) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.capture = 'environment';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', () => {
    const files = Array.from(input.files || []);
    input.remove();
    if (!files.length) { sessionStorage.removeItem('vb_upload_intent'); return; }
    showCaptionModal(matchId, teamId, files, match);
  });
  try {
    input.click();
  } catch (e) {
    // Permissions check can fail in PWA/iframe contexts; fallback without capture
    if (e && (e.name === 'TypeError' || String(e.message || '').includes('Permissions'))) {
      delete input.capture;
      input.click();
    } else {
      throw e;
    }
  }
}

function showUploadModal(matchId, teamId = null, match = null) {
  // Standard file-picker modal
  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:1rem">📸 Foto's &amp; video's uploaden</h3>
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

  overlay.querySelector('#upload-cancel').addEventListener('click', () => {
    sessionStorage.removeItem('vb_upload_intent');
    overlay.remove();
  });

  const picker = new FilePicker(overlay.querySelector('#fp-wrap'), {
    accept: 'image/*,video/*',
    multiple: true,
    maxFiles: 10,
  });

  overlay.querySelector('#upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    const files = picker.getFiles();
    if (files.length === 0) { showToast('Kies eerst bestanden', 'error'); return; }
    overlay.remove();
    await doUpload(matchId, teamId, files, overlay.querySelector('#upload-caption')?.value || '', match);
  });
}

function showCaptionModal(matchId, teamId, files, match = null) {
  // Show thumbnail preview of captured file(s)
  const preview = files.map(f => {
    const url = URL.createObjectURL(f);
    return f.type.startsWith('video/')
      ? `<video src="${url}" style="width:100%;max-height:180px;border-radius:10px;object-fit:cover" muted playsinline></video>`
      : `<img src="${url}" style="width:100%;max-height:180px;border-radius:10px;object-fit:cover" />`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'badge-unlock-overlay';
  overlay.innerHTML = `
    <div class="badge-unlock-card" style="max-width:360px">
      <h3 style="margin-bottom:0.75rem">📸 Zojuist gemaakt</h3>
      <div style="margin-bottom:0.75rem;border-radius:10px;overflow:hidden">${preview}</div>
      <div class="form-group">
        <label class="form-label">Onderschrift (optioneel)</label>
        <input type="text" id="cap-input" class="form-input" placeholder="Wat een geweldige wedstrijd!" />
      </div>
      <div class="flex gap-2 mt-2">
        <button class="btn btn-secondary" style="flex:1" id="cap-cancel">Annuleren</button>
        <button class="btn btn-primary" style="flex:1" id="cap-submit">Plaatsen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#cap-cancel').addEventListener('click', () => {
    sessionStorage.removeItem('vb_upload_intent');
    overlay.remove();
  });

  overlay.querySelector('#cap-submit').addEventListener('click', async () => {
    const caption = overlay.querySelector('#cap-input').value;
    overlay.remove();
    await doUpload(matchId, teamId, files, caption, match);
  });
}

async function doUpload(matchId, teamId, files, caption = '', match = null) {
  const toast = showToast('Uploaden…', 'info');
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  if (caption) fd.append('caption', caption);
  fd.append('match_id', matchId);
  if (teamId) fd.append('team_id', teamId);
  if (match?.home_team) fd.append('home_team', match.home_team);
  if (match?.away_team) fd.append('away_team', match.away_team);
  try {
    const resp = await fetch('/api/social/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.token}` },
      body: fd,
    });
    const data = await resp.json().catch(() => ({}));
    sessionStorage.removeItem('vb_upload_intent');
    showToast('Geplaatst! 📸', 'success');
    loadMatchGallery(matchId, true);
    if (data.qualityDebug?.length) showQualityDebugPanel(data.qualityDebug);
    if (data.qualityIssues?.length) {
      showQualityWarningModal(data.qualityIssues, () => loadMatchGallery(matchId, true));
    }
  } catch (_) {
    showToast('Upload mislukt', 'error');
  }
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
