/**
 * Nevobo opponent club / team-code lookup for matches UI (shared state per session).
 */
import { api } from './app.js';

let opponentClubs  = null;
let teamCodeLookup = new Map();
let ownClubCode    = null;

export function normalizeTeamName(n) {
  if (!n) return '';
  return n
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u0060\u00B4]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function loadOpponentClubs(nevoboCode) {
  if (opponentClubs && ownClubCode === nevoboCode) return;
  ownClubCode = nevoboCode;
  try {
    const data = await api(`/api/nevobo/opponent-clubs?code=${nevoboCode}`);
    opponentClubs = new Map((data.clubs || []).map(c => [c.clubCode, c]));
    teamCodeLookup = new Map(
      Object.entries(data.teamCodes || {}).map(([k, v]) => [normalizeTeamName(k), v])
    );
  } catch (_) {
    opponentClubs  = new Map();
    teamCodeLookup = new Map();
  }
}

export function resolveClubCode(teamName, ownNevoboCode, strict = false) {
  if (!teamName) return strict ? null : ownNevoboCode;
  const norm = normalizeTeamName(teamName);

  if (teamCodeLookup.size > 0) {
    if (teamCodeLookup.has(norm)) return teamCodeLookup.get(norm);
    for (const [tName, code] of teamCodeLookup) {
      if (norm.endsWith(tName) || tName.endsWith(norm)) return code;
    }
  }

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

export function resolveTeamLogo(teamName, ownNevoboCode) {
  if (!teamName) return null;
  const code = resolveClubCode(teamName, ownNevoboCode, true);
  if (!code) return null;
  if (opponentClubs) {
    const club = opponentClubs.get(code);
    if (club?.logoUrl) return club.logoUrl;
  }
  return `https://assets.nevobo.nl/organisatie/logo/${code.toUpperCase()}.jpg`;
}
