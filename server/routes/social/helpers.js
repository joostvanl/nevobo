'use strict';

/** Build match_id -> { home_team, away_team } from feed_cache for opponent resolution */
function getMatchTeamsMap(database) {
  const map = {};
  const rows = database.prepare('SELECT data_json FROM feed_cache').all();
  for (const row of rows) {
    try {
      const data = JSON.parse(row.data_json);
      for (const m of (data.matches || [])) {
        if (m.match_id && (m.home_team || m.away_team)) {
          const entry = { home_team: m.home_team || '', away_team: m.away_team || '' };
          map[m.match_id] = entry;
          try { map[encodeURIComponent(m.match_id)] = entry; } catch (_) {}
        }
      }
    } catch (_) {}
  }
  return map;
}

function addMatchOpponentToMediaItems(items, matchMap) {
  for (const item of items) {
    const home = (item.match_home_team || '').trim();
    const away = (item.match_away_team || '').trim();
    let home_team = home;
    let away_team = away;
    if (!home_team || !away_team) {
      if (!item.match_id) continue;
      let rawId = item.match_id;
      if (typeof item.match_id === 'string') {
        try { rawId = decodeURIComponent(item.match_id); } catch (_) {}
      }
      const matchData = matchMap[item.match_id] || matchMap[rawId];
      if (!matchData) continue;
      home_team = home_team || matchData.home_team || '';
      away_team = away_team || matchData.away_team || '';
    }
    const team = (item.team_name || '').trim();
    const teamLower = team.toLowerCase();
    const homeLower = (home_team || '').toLowerCase();
    const awayLower = (away_team || '').toLowerCase();
    const isHome = homeLower && (homeLower === teamLower || homeLower.includes(teamLower) || teamLower.includes(homeLower));
    const isAway = awayLower && (awayLower === teamLower || awayLower.includes(teamLower) || teamLower.includes(awayLower));
    if (isHome) {
      item.match_opponent_team = away_team || '';
    } else if (isAway) {
      item.match_opponent_team = home_team || '';
    } else {
      item.match_opponent_team = [home_team, away_team].filter(Boolean).join(' – ') || '';
    }
  }
}

module.exports = { getMatchTeamsMap, addMatchOpponentToMediaItems };
