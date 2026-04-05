'use strict';

const {
  getFreeIntervalsForVenueDay,
  intervalCoveredByFreeList,
  parseTimeToMinutes,
  BASE_DAY_START_MIN,
  BASE_DAY_END_MIN,
  PREFERRED_DAY_END_MIN,
} = require('./training-schedule-availability');
const {
  validateSchedule,
  teamCategory,
  categoryOrder,
  rustOkForTeam,
  COACH_PLAYER_MAX_GAP_MIN,
} = require('./training-schedule-validate');

const STEP_MIN = 15;

function sortTeamsForPlacement(teams, coachMap) {
  const playerTeamIds = new Set();
  for (const [, c] of coachMap) {
    if (c.playerTeamIds instanceof Set) {
      for (const id of c.playerTeamIds) playerTeamIds.add(id);
    } else if (c.playerTeamId != null) playerTeamIds.add(c.playerTeamId);
  }
  return [...teams].sort((a, b) => {
    const pa = playerTeamIds.has(a.id) ? 0 : 1;
    const pb = playerTeamIds.has(b.id) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ca = categoryOrder(teamCategory(a));
    const cb = categoryOrder(teamCategory(b));
    if (ca !== cb) return ca - cb;
    return String(a.display_name).localeCompare(String(b.display_name), 'nl');
  });
}

function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function playerTeamIds(c) {
  if (c.playerTeamIds instanceof Set && c.playerTeamIds.size) return [...c.playerTeamIds];
  if (c.playerTeamId != null) return [c.playerTeamId];
  return [];
}

/** Eindtijd (minuut) van het coachblok dat direct voor de speler-sessie of het vorige coachblok komt. */
function coachChainAnchorEnd(placed, coachedIds, teamByName, playerName, loc, dow) {
  const ps = placed.filter((s) => s.team === playerName && s.location === loc && s.day_of_week === dow);
  if (!ps.length) return null;
  const playerSm = Math.min(...ps.map((s) => s._sm));
  const cs = placed.filter((s) => {
    const tid = teamByName.get(s.team)?.id;
    return tid != null && coachedIds.has(tid) && s.location === loc && s.day_of_week === dow;
  });
  if (!cs.length) return playerSm;
  return Math.min(...cs.map((s) => s._sm));
}

function maxCoachEndOnLocDow(placed, coachedIds, teamByName, loc, dow) {
  const cs = placed.filter((s) => {
    const tid = teamByName.get(s.team)?.id;
    return tid != null && coachedIds.has(tid) && s.location === loc && s.day_of_week === dow;
  });
  if (!cs.length) return null;
  return Math.max(...cs.map((s) => s._em));
}

function violatesCoachH08(placed, newSlot, teamRow, coachMap, teamByName, teamById) {
  const teamId = teamRow.id;
  const loc = newSlot.location;
  const dow = newSlot.day_of_week;

  for (const [, c] of coachMap) {
    const coached = c.coachedTeamIds instanceof Set ? c.coachedTeamIds : new Set(c.coachedTeamIds || []);
    if (!coached.has(teamId)) continue;
    for (const ptid of playerTeamIds(c)) {
      const pRow = teamById.get(ptid);
      if (!pRow) continue;
      const anchor = coachChainAnchorEnd(placed, coached, teamByName, pRow.display_name, loc, dow);
      if (anchor != null && newSlot._em !== anchor) return true;
    }
  }

  for (const [, c] of coachMap) {
    const coached = c.coachedTeamIds instanceof Set ? c.coachedTeamIds : new Set(c.coachedTeamIds || []);
    if (!playerTeamIds(c).includes(teamId)) continue;
    const maxCe = maxCoachEndOnLocDow(placed, coached, teamByName, loc, dow);
    if (maxCe == null) continue;
    if (newSlot._sm < maxCe) return true;
    if (newSlot._sm > maxCe + COACH_PLAYER_MAX_GAP_MIN) return true;
  }
  return false;
}

function tryBuildSlotAtVenue(
  placed,
  teamRow,
  venueName,
  loc,
  dow,
  sm,
  em,
  ctx,
  coachMap,
  teamByName,
  teamById,
  plannerCtx,
  maxEndEm = Infinity,
) {
  if (sm < 0 || em <= sm || em > maxEndEm) return null;
  const free = getFreeIntervalsForVenueDay(
    dow,
    venueName,
    loc,
    ctx.venue_unavailability,
    plannerCtx,
  );
  if (!intervalCoveredByFreeList(sm, em, free)) return null;
  const slot = {
    team: teamRow.display_name,
    venue: venueName,
    location: loc,
    day_of_week: dow,
    start_time: minutesToTime(sm),
    end_time: minutesToTime(em),
    _sm: sm,
    _em: em,
  };
  if (!canPlace(placed, slot, teamRow, coachMap, teamByName, teamById)) return null;
  return slot;
}

/** Zoekt eerst posities waar coach-keten direct aansluit op eigen training (of op elkaar). */
function tryFindAnchoredSlot(placed, teamRow, duration, ctx, coachMap, teamByName, teamById, maxEndEm) {
  const plannerCtx = { plannerMode: ctx.plannerMode || 'blueprint', isoWeek: ctx.isoWeek };
  const venues = ctx.venues || [];

  for (const [, c] of coachMap) {
    const coached = c.coachedTeamIds instanceof Set ? c.coachedTeamIds : new Set(c.coachedTeamIds || []);
    if (!coached.has(teamRow.id)) continue;
    for (const ptid of playerTeamIds(c)) {
      const pRow = teamById.get(ptid);
      if (!pRow) continue;
      const seen = new Set();
      for (const ps of placed.filter((s) => s.team === pRow.display_name)) {
        const key = `${ps.location}\n${ps.day_of_week}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const loc = ps.location;
        const dow = ps.day_of_week;
        const anchor = coachChainAnchorEnd(placed, coached, teamByName, pRow.display_name, loc, dow);
        if (anchor == null) continue;
        const em = anchor;
        if (em > maxEndEm) continue;
        const sm = em - duration;
        for (const v of venues) {
          if (v.location !== loc) continue;
          const slot = tryBuildSlotAtVenue(
            placed,
            teamRow,
            v.name,
            loc,
            dow,
            sm,
            em,
            ctx,
            coachMap,
            teamByName,
            teamById,
            plannerCtx,
            maxEndEm,
          );
          if (slot) return slot;
        }
      }
    }
  }

  for (const [, c] of coachMap) {
    const coached = c.coachedTeamIds instanceof Set ? c.coachedTeamIds : new Set(c.coachedTeamIds || []);
    if (!playerTeamIds(c).includes(teamRow.id)) continue;
    for (let dow = 0; dow <= 6; dow++) {
      for (const loc of new Set(venues.map((v) => v.location))) {
        const maxCe = maxCoachEndOnLocDow(placed, coached, teamByName, loc, dow);
        if (maxCe == null) continue;
        for (let sm = maxCe; sm <= maxCe + COACH_PLAYER_MAX_GAP_MIN; sm += STEP_MIN) {
          const em = sm + duration;
          if (em > maxEndEm) continue;
          for (const v of venues) {
            if (v.location !== loc) continue;
            const slot = tryBuildSlotAtVenue(
              placed,
              teamRow,
              v.name,
              loc,
              dow,
              sm,
              em,
              ctx,
              coachMap,
              teamByName,
              teamById,
              plannerCtx,
              maxEndEm,
            );
            if (slot) return slot;
          }
        }
      }
    }
  }

  return null;
}

function overlapsField(placed, slot) {
  return placed.some(
    (p) =>
      p.location === slot.location &&
      p.venue === slot.venue &&
      p.day_of_week === slot.day_of_week &&
      p._sm < slot._em &&
      slot._sm < p._em,
  );
}

function overlapsTeam(placed, slot, teamRow) {
  const name = teamRow.display_name;
  const cat = teamCategory(teamRow);
  const sameTeam = placed.filter((p) => p.team === name);
  if (cat === 'mini') {
    const key = `${slot.day_of_week}|${slot._sm}|${slot._em}`;
    const atMoment = sameTeam.filter(
      (p) => `${p.day_of_week}|${p._sm}|${p._em}` === key,
    );
    const venues = new Set(atMoment.map((p) => `${p.location}\n${p.venue}`));
    venues.add(`${slot.location}\n${slot.venue}`);
    if (venues.size > 1) return false;
    return sameTeam.some(
      (p) =>
        p.day_of_week === slot.day_of_week &&
        p._sm < slot._em &&
        slot._sm < p._em &&
        `${p.location}\n${p.venue}` === `${slot.location}\n${slot.venue}`,
    );
  }
  return sameTeam.some(
    (p) => p.day_of_week === slot.day_of_week && p._sm < slot._em && slot._sm < p._em,
  );
}

function rustViolates(placed, slot, teamRow) {
  const name = teamRow.display_name;
  if (teamCategory(teamRow) === 'mini') return false;
  const dows = [
    ...new Set(placed.filter((p) => p.team === name).map((p) => p.day_of_week)),
  ];
  return !rustOkForTeam(teamRow, slot.day_of_week, dows);
}

function canPlace(placed, slot, teamRow, coachMap, teamByName, teamById) {
  if (overlapsField(placed, slot)) return false;
  if (overlapsTeam(placed, slot, teamRow)) return false;
  if (rustViolates(placed, slot, teamRow)) return false;
  if (violatesCoachH08(placed, slot, teamRow, coachMap, teamByName, teamById)) return false;
  return true;
}

function tryFindSlotGreedyScan(placed, teamRow, duration, ctx, coachMap, teamByName, teamById, maxEndEm) {
  const plannerCtx = { plannerMode: ctx.plannerMode || 'blueprint', isoWeek: ctx.isoWeek };
  const dows = [1, 2, 3, 4, 5, 6, 0];
  for (const dow of dows) {
    for (const v of ctx.venues || []) {
      const free = getFreeIntervalsForVenueDay(
        dow,
        v.name,
        v.location,
        ctx.venue_unavailability,
        plannerCtx,
      );
      for (const intv of free) {
        const hiCap = Math.min(intv.hi, maxEndEm);
        for (let sm = intv.lo; sm + duration <= hiCap; sm += STEP_MIN) {
          const em = sm + duration;
          if (em > intv.hi) break;
          const slot = {
            team: teamRow.display_name,
            venue: v.name,
            location: v.location,
            day_of_week: dow,
            start_time: minutesToTime(sm),
            end_time: minutesToTime(em),
            _sm: sm,
            _em: em,
          };
          if (!intervalCoveredByFreeList(sm, em, free)) continue;
          if (canPlace(placed, slot, teamRow, coachMap, teamByName, teamById)) return slot;
        }
      }
    }
  }
  return null;
}

function tryFindSlot(placed, teamRow, duration, ctx, coachMap, teamByName, teamById) {
  const passes = [];
  if (PREFERRED_DAY_END_MIN < BASE_DAY_END_MIN) {
    passes.push(PREFERRED_DAY_END_MIN);
  }
  passes.push(BASE_DAY_END_MIN);
  for (const maxEndEm of passes) {
    const anchored = tryFindAnchoredSlot(
      placed,
      teamRow,
      duration,
      ctx,
      coachMap,
      teamByName,
      teamById,
      maxEndEm,
    );
    if (anchored) return anchored;
    const scanned = tryFindSlotGreedyScan(
      placed,
      teamRow,
      duration,
      ctx,
      coachMap,
      teamByName,
      teamById,
      maxEndEm,
    );
    if (scanned) return scanned;
  }
  return null;
}

function countPlacedForTeam(placed, displayName) {
  return placed.filter((p) => p.team === displayName).length;
}

/**
 * @param {'new'|'complete'} mode
 * @param {object} ctx — teams, venues, locations, venue_unavailability, coachConstraints Map, plannerMode, isoWeek
 * @param {Array} frozenSchedule — bestaande slots (complete mode)
 */
function solveSchedule(mode, ctx, frozenSchedule = []) {
  const coachMap = ctx.coachConstraints instanceof Map ? ctx.coachConstraints : new Map(Object.entries(ctx.coachConstraints || {}));
  const teams = ctx.teams || [];
  const teamByName = new Map(teams.map((t) => [t.display_name, t]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const placed = (frozenSchedule || []).map((s) => {
    const sm = parseTimeToMinutes(s.start_time);
    const em = parseTimeToMinutes(s.end_time);
    return {
      team: s.team,
      venue: s.venue,
      location: s.location,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      _sm: sm,
      _em: em,
    };
  });

  const orderedTeams = sortTeamsForPlacement(teams, coachMap);
  const need = new Map();
  for (const t of teams) {
    const n = t.trainings_per_week != null ? t.trainings_per_week : 1;
    const already = countPlacedForTeam(placed, t.display_name);
    const rem = mode === 'complete' ? Math.max(0, n - already) : n;
    need.set(t.display_name, rem);
  }

  if (mode === 'new') {
    placed.length = 0;
    for (const t of teams) {
      need.set(t.display_name, t.trainings_per_week != null ? t.trainings_per_week : 1);
    }
  }

  let guard = 0;
  const maxIter = teams.reduce((s, t) => s + (t.trainings_per_week || 1), 0) * 20 + 100;
  while ([...need.values()].some((n) => n > 0) && guard++ < maxIter) {
    let pick = null;
    let bestRatio = Infinity;
    const candidates = orderedTeams.filter((t) => need.get(t.display_name) > 0);
    if (!candidates.length) break;
    for (const t of candidates) {
      const n = t.trainings_per_week != null ? t.trainings_per_week : 1;
      const p = countPlacedForTeam(placed, t.display_name);
      const ratio = n > 0 ? p / n : 0;
      if (ratio < bestRatio - 1e-6 || (Math.abs(ratio - bestRatio) < 1e-6 && (!pick || t.display_name < pick.display_name))) {
        bestRatio = ratio;
        pick = t;
      }
    }
    if (!pick) break;
    const minM = pick.min_training_minutes != null ? pick.min_training_minutes : 60;
    const maxM = pick.max_training_minutes != null ? pick.max_training_minutes : 120;
    let found = tryFindSlot(placed, pick, maxM, ctx, coachMap, teamByName, teamById);
    if (!found) found = tryFindSlot(placed, pick, minM, ctx, coachMap, teamByName, teamById);
    if (!found) {
      need.set(pick.display_name, 0);
      continue;
    }
    placed.push(found);
    need.set(pick.display_name, need.get(pick.display_name) - 1);
  }

  const actuallyNew =
    mode === 'new'
      ? placed
      : placed.filter((s) => {
          return !frozenSchedule.some(
            (f) =>
              f.team === s.team &&
              f.day_of_week === s.day_of_week &&
              f.start_time === s.start_time &&
              f.venue === s.venue,
          );
        });

  const normalizedNew = actuallyNew.map((s) => ({
    team: s.team,
    venue: s.venue,
    location: s.location,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
  }));

  const validation = validateSchedule(normalizedNew, {
    ...ctx,
    frozenSchedule: mode === 'complete' ? frozenSchedule : [],
  });

  const failures = [];
  const shortfall = {};
  for (const t of teams) {
    const n = t.trainings_per_week != null ? t.trainings_per_week : 1;
    const c = countPlacedForTeam(placed, t.display_name);
    if (c < n) {
      failures.push({ team: t.display_name, need: n, placed: c });
      const minM = t.min_training_minutes != null ? t.min_training_minutes : 60;
      shortfall[t.display_name] = (n - c) * minM;
    }
  }

  let advice = '';
  if (failures.length) {
    advice = `Niet alle teams volledig ingepland. Controleer blokkades, venster ${BASE_DAY_START_MIN / 60}–${BASE_DAY_END_MIN / 60} uur, velden en rustdagen.`;
  } else if (!validation.ok) {
    advice = 'Schema heeft harde conflicten; pas invoer aan.';
  } else if (validation.softWarnings.length) {
    advice = 'Schema is geldig; er zijn zachte waarschuwingen (volgorde/locatie/fairness).';
  } else {
    advice = 'Schema voldoet aan de gecontroleerde regels.';
  }

  return {
    ok: validation.ok && failures.length === 0,
    schedule: placed.map((s) => ({
      team: s.team,
      venue: s.venue,
      location: s.location,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
    })),
    validation,
    failures,
    shortfall,
    advice,
  };
}

module.exports = {
  solveSchedule,
  sortTeamsForPlacement,
  STEP_MIN,
};
