import { api, state, renderAvatar, relativeTime, formatDate, formatTime, navigate } from '../app.js';
import { openReelViewer } from '../reel-viewer.js';

/* ─── tiny helpers ────────────────────────────────────────────────────────── */
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function teamLogo(code, name, size = 32) {
  const initials = (name || '?').split(' ').filter(Boolean).map(w => w[0]).slice(0,2).join('').toUpperCase();
  if (!code) return `<span class="hl-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size*0.38)}px">${initials}</span>`;
  const url = `https://assets.nevobo.nl/organisatie/logo/${code.toUpperCase()}.jpg`;
  return `<img class="hl-avatar" src="${url}" width="${size}" height="${size}"
    onerror="this.outerHTML='<span class=\\'hl-avatar\\' style=\\'width:${size}px;height:${size}px;font-size:${Math.round(size*0.38)}px\\'>${initials}</span>'"
    alt="${esc(name)}" />`;
}

function matchBelongsToTeam(match, dn) {
  const d = (dn || '').toLowerCase();
  const h = (match.home_team || '').toLowerCase();
  const a = (match.away_team || '').toLowerCase();
  if (!d) return false;
  const parts  = d.split(' ');
  const suffix = parts.slice(Math.max(0, parts.length - 3)).join(' ');
  return h.includes(d) || a.includes(d) || (suffix.length > 3 && (h.includes(suffix) || a.includes(suffix)));
}

function meetupTime(datetimeStr) {
  const dt = new Date(datetimeStr);
  const m  = new Date(dt.getTime() - 45 * 60 * 1000);
  m.setMinutes(Math.floor(m.getMinutes() / 5) * 5, 0, 0);
  return `${String(m.getHours()).padStart(2,'0')}:${String(m.getMinutes()).padStart(2,'0')}`;
}

// Parse sets array ["25-19","19-25",...] → { mySets, oppSets }
function parseSets(sets, isHome) {
  if (!sets || !sets.length) return null;
  let mine = 0, theirs = 0;
  for (const s of sets) {
    const parts = s.split('-');
    if (parts.length < 2) continue;
    const h = parseInt(parts[0]), a = parseInt(parts[1]);
    if (isNaN(h) || isNaN(a)) continue;
    const myPts  = isHome ? h : a;
    const oppPts = isHome ? a : h;
    if (myPts > oppPts) mine++; else theirs++;
  }
  return { mine, theirs };
}

/* ─── main render ─────────────────────────────────────────────────────────── */
export async function render(container) {
  container.innerHTML = '<div class="spinner"></div>';

  const user = state.user;
  if (!user) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏐</div>
        <h2>Welkom bij VolleyApp!</h2>
        <p>Log in of maak een account aan om te beginnen.</p>
      </div>`;
    return;
  }

  try {
    const [meData, summaryData] = await Promise.all([
      api('/api/auth/me').catch(() => null),
      api('/api/social/home-summary').catch(() => null),
    ]);

    const me           = meData?.user || user;
    const badges       = meData?.badges || [];
    const nextLevel    = meData?.nextLevel;
    const currentLevel = meData?.currentLevel;

    const summary      = summaryData || {};
    const memberTeams  = summary.memberTeams  || [];
    const followedTeams= summary.followedTeams|| [];
    const recentMedia  = summary.recentMedia  || [];
    const newFollowers = summary.newFollowers || [];

    const earnedBadges = badges.filter(b => b.earned_at).slice(0, 4);

    const xpProgress = nextLevel
      ? Math.min(100, Math.round(
          ((me.xp - (currentLevel?.xp_required || 0)) /
           (nextLevel.xp_required - (currentLevel?.xp_required || 0))) * 100))
      : 100;

    container.innerHTML = `
      <!-- ── hero ── -->
      <div class="hm-hero">
        <div class="hm-hero-inner">
          ${renderAvatar(me.name, me.avatar_url, 'md')}
          <div class="hm-hero-text">
            <h1>Hey ${esc(me.name.split(' ')[0])}! 👋</h1>
            <div class="hm-hero-chips">
              <span class="chip chip-primary">${esc(currentLevel?.label || 'Niveau ' + me.level)}</span>
              <span class="hm-xp-chip">${me.xp} XP</span>
            </div>
          </div>
        </div>
        <div class="hm-xp-wrap">
          <div class="hm-xp-track">
            <div class="hm-xp-fill" id="xp-fill" style="width:0%"></div>
          </div>
          <span class="hm-xp-label">
            ${nextLevel ? `Naar ${esc(nextLevel.label)}: ${nextLevel.xp_required - me.xp} XP` : 'Max level 🔥'}
          </span>
        </div>
      </div>

      <div class="hm-body">

        ${!user.club_id && memberTeams.length === 0 ? `
          <div class="hm-onboard">
            <div class="hm-onboard-icon">🏐</div>
            <div>
              <strong>Sluit je aan bij een club</strong>
              <p>Koppel je account voor wedstrijden, carpool en meer.</p>
            </div>
            <button class="btn btn-primary btn-sm" onclick="navigate('profile')">Instellen</button>
          </div>` : ''}

        <!-- TikTok-style media reel — injected first, right after hero -->
        <div id="hm-media"></div>

        <!-- dynamic sections injected async -->
        <div id="hm-next-match"></div>
        <div id="hm-results"></div>

        <!-- badges row -->
        ${earnedBadges.length > 0 ? `
          <div class="hm-section">
            <div class="hm-section-hd">
              <span>🏅 Badges</span>
              <button class="hm-more-btn" onclick="navigate('badges')">Alle →</button>
            </div>
            <div class="hm-badges-row">
              ${earnedBadges.map(b => `
                <div class="hm-badge-item" onclick="navigate('badges')">
                  <span class="hm-badge-icon">${b.icon_emoji}</span>
                  <span class="hm-badge-label">${esc(b.label)}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}

        <!-- new followers -->
        ${newFollowers.length > 0 ? `
          <div class="hm-section">
            <div class="hm-section-hd"><span>👥 Nieuwe volgers</span></div>
            ${newFollowers.map(f => `
              <div class="hm-follower">
                ${renderAvatar(f.name, f.avatar_url, 'sm')}
                <div class="hm-follower-info">
                  <strong>${esc(f.name)}</strong>
                  <span>${f.club_name ? esc(f.club_name) + ' · ' : ''}${relativeTime(f.followed_at)}</span>
                </div>
                <span class="hm-new-badge">Nieuw</span>
              </div>`).join('')}
          </div>` : ''}

        <!-- quick nav -->
        <div class="hm-quicknav">
          <button onclick="navigate('matches')"><span>📅</span>Wedstrijden</button>
          <button onclick="navigate('social')"><span>💬</span>Sociaal</button>
          <button onclick="navigate('badges')"><span>🏅</span>Badges</button>
        </div>

      </div>`;

    /* animate XP */
    setTimeout(() => {
      const f = document.getElementById('xp-fill');
      if (f) f.style.width = xpProgress + '%';
    }, 100);

    /* load async sections */
    loadNextMatch(memberTeams, me);
    loadMedia(recentMedia, memberTeams, followedTeams);
    loadResults(memberTeams, followedTeams, me);

    if (memberTeams.length === 0 && me.club_id) loadClubFallback(me);

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${esc(err.message)}</p></div>`;
  }
}

/* ─── next match ──────────────────────────────────────────────────────────── */
async function loadNextMatch(memberTeams, me) {
  const el = document.getElementById('hm-next-match');
  if (!el || memberTeams.length === 0) return;

  const all = await Promise.allSettled(
    memberTeams.map(t =>
      api(`/api/nevobo/club/${t.nevobo_code}/schedule`)
        .then(d => ({
          team: t,
          matches: (d.matches||[])
            .filter(m => {
              if (m.status === 'gespeeld') return false;
              if (m.datetime && new Date(m.datetime).getTime() < Date.now() - 2 * 3600_000) return false;
              return true;
            })
            .filter(m => matchBelongsToTeam(m, t.display_name))
        }))
        .catch(() => ({ team: t, matches: [] }))
    )
  );

  const entries = all
    .filter(r => r.status === 'fulfilled' && r.value.matches.length > 0)
    .map(r => ({ team: r.value.team, match: r.value.matches[0] }));

  if (!entries.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="hm-section">
      <div class="hm-section-hd">
        <span>⚡ Volgende wedstrijd${entries.length > 1 ? 'en' : ''}</span>
        <button class="hm-more-btn" onclick="navigate('matches')">Alle →</button>
      </div>
      ${entries.map(({ team, match }) => renderNextMatchCard(team, match)).join('')}
    </div>`;
}

function renderNextMatchCard(team, match) {
  const h = (match.home_team || '');
  const a = (match.away_team || '');
  const dn = (team.display_name || '').toLowerCase();
  const dnParts = dn.split(' ');
  const dnSuffix = dnParts.slice(Math.max(0, dnParts.length - 3)).join(' ');
  const isHome  = h.toLowerCase().includes(dn) || (dnSuffix.length > 3 && h.toLowerCase().includes(dnSuffix));
  const myCode  = team.nevobo_code;
  const oppCode = isHome ? (match.away_club_code||null) : (match.home_club_code||null);
  const dt      = match.datetime ? new Date(match.datetime) : null;
  const mid     = esc(match.match_id || match.id || '');
  const tName   = esc(team.display_name);
  const tCode   = esc(myCode);

  // Always: home team LEFT, away team RIGHT
  const homeCode = isHome ? myCode : oppCode;
  const awayCode = isHome ? oppCode : myCode;

  const navigateCall = `navigate('matches',{matchId:'${mid}',teamName:'${tName}',nevoboCode:'${tCode}'})`;

  return `
    <div class="hm-match-card" onclick="${navigateCall}">
      <div class="hm-match-teams">
        <div class="hm-match-side">
          ${teamLogo(homeCode, h, 38)}
          <span class="hm-match-name">${esc(h)}</span>
        </div>
        <div class="hm-match-vs">
          <span>VS</span>
        </div>
        <div class="hm-match-side hm-match-side-right">
          ${teamLogo(awayCode, a, 38)}
          <span class="hm-match-name">${esc(a)}</span>
        </div>
      </div>
      <div class="hm-match-foot">
        <span class="hm-match-chip">${tName}</span>
        ${dt ? `<span class="hm-match-dt">${formatDate(match.datetime)} · ${formatTime(match.datetime)}</span>` : ''}
        ${dt ? `<span class="hm-match-meetup">⏰ ${meetupTime(match.datetime)}${!isHome ? ' + reis' : ''}</span>` : ''}
      </div>
    </div>`;
}

/* ─── media reel (TikTok-style) ──────────────────────────────────────────── */

/** Encode a Nevobo match object to the same ID string used when uploading media */
function encodeMatchId(m) {
  return encodeURIComponent(m.match_id || m.link?.replace(/.*\//, '') || m.title?.slice(0, 40) || 'onbekend');
}

/**
 * For media items that have a match_id, resolve the correct team name by fetching
 * the club schedule (cached on the server) and matching home/away team names against
 * the user's own teams. This corrects labels for multi-team users where the stored
 * posts.team_id might point to the wrong team.
 */
async function resolveMediaTeamNames(recentMedia, memberTeams, followedTeams) {
  // The backend now resolves team_name via COALESCE on match_id, so this is only
  // needed to further refine for items where the DB team_name might not match the
  // viewer's known team names (e.g. abbreviated names).
  const allTeams = [...(memberTeams || []), ...(followedTeams || [])];
  const itemsWithMatch = recentMedia.filter(m => m.match_id);
  if (!itemsWithMatch.length || !allTeams.length) return;

  // Collect unique club nevobo codes to fetch schedules for
  const uniqueCodes = [...new Set(allTeams.map(t => t.nevobo_code).filter(Boolean))];
  const scheduleMatches = [];
  for (const code of uniqueCodes) {
    try {
      const [s, r] = await Promise.all([
        api(`/api/nevobo/club/${code}/schedule`).catch(() => ({ matches: [] })),
        api(`/api/nevobo/club/${code}/results`).catch(() => ({ matches: [] })),
      ]);
      scheduleMatches.push(...(s.matches || []), ...(r.matches || []));
    } catch (_) { /* ignore */ }
  }
  if (!scheduleMatches.length) return;

  for (const m of itemsWithMatch) {
    const match = scheduleMatches.find(nm => encodeMatchId(nm) === m.match_id);
    if (!match) continue;
    // Find the longest-matching team name from teams the viewer knows about
    const matched = allTeams
      .filter(t => {
        const dn = (t.display_name || '').toLowerCase();
        if (dn.length < 3) return false;
        return (match.home_team || '').toLowerCase().includes(dn)
            || (match.away_team || '').toLowerCase().includes(dn);
      })
      .sort((a, b) => b.display_name.length - a.display_name.length)[0];
    // Only override if we found a match — otherwise keep the DB-resolved team_name
    if (matched) m.team_name = matched.display_name;
  }
}

async function loadMedia(recentMedia, memberTeams, followedTeams) {
  const el = document.getElementById('hm-media');
  if (!el) return;
  if (!recentMedia.length) { el.innerHTML = ''; return; }

  // Resolve correct team names from match context before first render
  await resolveMediaTeamNames(recentMedia, memberTeams, followedTeams);

  el.innerHTML = `
    <div class="hm-reel-wrap">
      <div class="hm-reel-header">
        <span class="hm-reel-title">📸 Laatste beelden</span>
        <button class="hm-reel-more" onclick="navigate('social')">Alle media →</button>
      </div>
      <div class="hm-reel" id="hm-reel-track">
        ${recentMedia.map((m, i) => `
          <div class="hm-reel-card" data-index="${i}">
            ${m.file_type === 'video'
              ? `<video class="hm-reel-media" src="${esc(m.file_path)}" muted playsinline loop preload="metadata"></video>
                 <div class="hm-reel-play-icon">▶</div>`
              : `<img class="hm-reel-media" src="${esc(m.file_path)}" alt="Media" loading="lazy" />`}
            <div class="hm-reel-gradient"></div>
            <div class="hm-reel-info">
              ${m.team_name || m.club_name_media ? `<span class="hm-reel-team">${esc(m.team_name || m.club_name_media)}</span>` : ''}
              <div class="hm-reel-stats">
                ${m.like_count > 0 ? `<span>❤️ ${m.like_count}</span>` : ''}
                ${m.view_count > 0 ? `<span>👁 ${m.view_count}</span>` : ''}
              </div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  // tap → open fullscreen viewer
  const reelTrack = document.getElementById('hm-reel-track');
  reelTrack.querySelectorAll('.hm-reel-card').forEach(card => {
    card.addEventListener('click', () => {
      const clickedIdx = parseInt(card.dataset.index);
      // Pass the already-playing video element so the viewer can reuse it
      const existingVideo = card.querySelector('video.hm-reel-media');
      openReelViewer(recentMedia, clickedIdx, {
        sourceVideo: existingVideo,
        fetchMore: async (offset) => {
          const data = await api(`/api/social/media-feed?offset=${offset}&limit=20`);
          return data.media || [];
        },
      });
    });
  });

  // Auto-play videos when they scroll into view
  const videos = reelTrack.querySelectorAll('video.hm-reel-media');
  if (!videos.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      const vid = e.target;
      if (e.isIntersecting) {
        vid.play().catch(() => {});
        vid.closest('.hm-reel-card')?.querySelector('.hm-reel-play-icon')?.style.setProperty('display','none');
      } else {
        vid.pause();
      }
    });
  }, { threshold: 0.6 });
  videos.forEach(v => obs.observe(v));
}

/* ─── results ─────────────────────────────────────────────────────────────── */
async function loadResults(memberTeams, followedTeams, me) {
  const el = document.getElementById('hm-results');
  if (!el) return;

  const all = [
    ...memberTeams.map(t => ({ ...t, isMember: true })),
    ...followedTeams.map(t => ({ ...t, isMember: false })),
  ];
  const seen = new Set();
  const unique = all.filter(t => { if (seen.has(t.team_id)) return false; seen.add(t.team_id); return true; });

  if (!unique.length) { el.innerHTML = ''; return; }

  const data = await Promise.allSettled(
    unique.map(t =>
      api(`/api/nevobo/club/${t.nevobo_code}/results`)
        .then(d => ({
          team: t,
          results: (d.matches||[]).filter(m => matchBelongsToTeam(m, t.display_name)).slice(0, 3),
        }))
        .catch(() => ({ team: t, results: [] }))
    )
  );

  const sections = data
    .filter(r => r.status === 'fulfilled' && r.value.results.length > 0)
    .map(r => r.value);

  if (!sections.length) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div class="hm-section">
      <div class="hm-section-hd">
        <span>🏆 Recente uitslagen</span>
        <button class="hm-more-btn" onclick="navigate('matches')">Alle →</button>
      </div>
      ${sections.map(({ team, results }) => `
        <div class="hm-results-group">
          <div class="hm-results-label">
            ${teamLogo(team.nevobo_code, team.display_name, 18)}
            <strong>${esc(team.display_name)}</strong>
            ${!team.isMember ? '<span class="hm-follow-chip">Gevolgd</span>' : ''}
          </div>
          ${results.map(m => renderResultRow(m, team)).join('')}
        </div>`).join('')}
    </div>`;
}

function renderResultRow(match, team) {
  const h    = (match.home_team || '');
  const a    = (match.away_team || '');
  const dn   = (team.display_name || '').toLowerCase();
  const dnP  = dn.split(' ');
  const dnS  = dnP.slice(Math.max(0, dnP.length - 3)).join(' ');
  const isH  = h.toLowerCase().includes(dn) || (dnS.length > 3 && h.toLowerCase().includes(dnS));
  const opp  = isH ? a : h;
  const oppCode = isH ? (match.away_club_code||null) : (match.home_club_code||null);

  // Score from sets array (e.g. ["25-19","19-25"])
  const setData = parseSets(match.sets, isH);
  let scoreHtml, won = null;
  if (setData) {
    won = setData.mine > setData.theirs;
    scoreHtml = `<span class="hm-score ${won ? 'hm-score-win' : 'hm-score-loss'}">${setData.mine}–${setData.theirs}</span>`;
  } else if (match.home_score != null && match.away_score != null) {
    const ms = isH ? match.home_score : match.away_score;
    const os = isH ? match.away_score : match.home_score;
    won = ms > os;
    scoreHtml = `<span class="hm-score ${won ? 'hm-score-win' : 'hm-score-loss'}">${ms}–${os}</span>`;
  } else {
    scoreHtml = `<span class="hm-score-dash">–</span>`;
  }

  const mid   = esc(match.match_id || match.id || '');
  const tName = esc(team.display_name);
  const tCode = esc(team.nevobo_code);

  return `
    <div class="hm-result-row" onclick="navigate('matches',{matchId:'${mid}',teamName:'${tName}',nevoboCode:'${tCode}'})">
      ${won !== null ? `<span class="hm-res-dot ${won ? 'hm-dot-win' : 'hm-dot-loss'}"></span>` : ''}
      ${teamLogo(oppCode, opp, 22)}
      <span class="hm-result-opp">${esc(opp)}</span>
      ${scoreHtml}
      <span class="hm-result-date">${match.datetime ? formatDate(match.datetime) : ''}</span>
    </div>`;
}

/* ─── club fallback ───────────────────────────────────────────────────────── */
async function loadClubFallback(me) {
  try {
    const club = await api(`/api/clubs/${me.club_id}`).catch(() => null);
    if (!club?.club?.nevobo_code) return;
    const nc   = club.club.nevobo_code;
    const fake = { team_id:0, display_name:club.club.name, club_id:me.club_id, nevobo_code:nc, isMember:true };

    const [sched, res] = await Promise.all([
      api(`/api/nevobo/club/${nc}/schedule`).catch(() => null),
      api(`/api/nevobo/club/${nc}/results`).catch(()=>null),
    ]);

    const nmEl = document.getElementById('hm-next-match');
    if (nmEl && sched?.matches?.length) {
      const next = sched.matches[0];
      nmEl.innerHTML = `
        <div class="hm-section">
          <div class="hm-section-hd"><span>⚡ Volgende wedstrijd</span>
            <button class="hm-more-btn" onclick="navigate('matches')">Alle →</button></div>
          ${renderNextMatchCard(fake, next)}
        </div>`;
    }

    const rEl = document.getElementById('hm-results');
    if (rEl && res?.matches?.length) {
      rEl.innerHTML = `
        <div class="hm-section">
          <div class="hm-section-hd"><span>🏆 Recente uitslagen</span>
            <button class="hm-more-btn" onclick="navigate('matches')">Alle →</button></div>
          <div class="hm-results-group">
            <div class="hm-results-label">${teamLogo(nc, club.club.name, 18)}<strong>${esc(club.club.name)}</strong></div>
            ${res.matches.slice(0,5).map(m => renderResultRow(m, fake)).join('')}
          </div>
        </div>`;
    }
  } catch(_) {}
}
