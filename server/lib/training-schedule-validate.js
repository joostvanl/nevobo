'use strict';

const {
  parseTimeToMinutes,
  getFreeIntervalsForVenueDay,
  intervalCoveredByFreeList,
  PREFERRED_DAY_END_MIN,
} = require('./training-schedule-availability');

const WRAP_RUST_SUN_MON =
  String(process.env.TRAINING_RUST_WRAP_SUN_MON ?? 'false').toLowerCase() === 'true';

/** Max. toegestane tussenruimte (minuten) tussen laatste coachblok en start eigen training op dezelfde locatie/dag. 0 = direct aansluitend. */
const COACH_PLAYER_MAX_GAP_MIN = Number(process.env.TRAINING_COACH_PLAYER_GAP_MAX_MIN ?? 0);

function teamCategory(team) {
  const t = String(team?.nevobo_team_type || '').toUpperCase();
  if (t === 'N5') return 'mini';
  if (['JA', 'JB', 'MC', 'MB', 'MA'].includes(t)) return 'youth';
  return 'senior';
}

function categoryOrder(cat) {
  if (cat === 'mini') return 0;
  if (cat === 'youth') return 1;
  return 2;
}

function dowDiff(a, b) {
  let d = Math.abs(a - b);
  if (WRAP_RUST_SUN_MON && (a === 0 || b === 0) && (a === 6 || b === 6)) {
    return Math.min(d, 1);
  }
  return d;
}

function rustOkForTeam(team, newDow, existingDows) {
  if (teamCategory(team) === 'mini') return true;
  for (const d of existingDows) {
    if (dowDiff(newDow, d) < 2) return false;
  }
  return true;
}

function normalizeSlot(s) {
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
}

/**
 * @param {Array} schedule — ruwe slots
 * @param {object} ctx — teams, venues, locations, venue_unavailability, coachConstraints, plannerMode, isoWeek, frozenSchedule?
 */
function validateSchedule(schedule, ctx) {
  const hardErrors = [];
  const softWarnings = [];
  let softScore = 0;

  const teams = ctx.teams || [];
  const teamByName = new Map(teams.map((t) => [t.display_name, t]));
  const venues = ctx.venues || [];
  const locSet = new Set((ctx.locations || []).map((l) => l.name));
  const venueLoc = new Set(venues.map((v) => `${v.location}\n${v.name}`));
  const plannerCtx = {
    plannerMode: ctx.plannerMode || 'blueprint',
    isoWeek: ctx.isoWeek,
  };

  const slots = (schedule || []).map(normalizeSlot).filter((s) => s.team);
  const frozen = (ctx.frozenSchedule || []).map(normalizeSlot).filter((s) => s.team);
  const allSlots = [...frozen, ...slots];

  const coachMap = ctx.coachConstraints || new Map();

  for (const s of slots) {
    const t = teamByName.get(s.team);
    if (!t) {
      hardErrors.push({ code: 'H_UNKNOWN_TEAM', message: `Onbekend team: ${s.team}` });
      continue;
    }
    if (s._sm == null || s._em == null || s._em <= s._sm) {
      hardErrors.push({ code: 'H_TIME', message: `Ongeldige tijd voor ${s.team}` });
    }
    if (typeof s.day_of_week !== 'number' || s.day_of_week < 0 || s.day_of_week > 6) {
      hardErrors.push({ code: 'H_DOW', message: `Ongeldige dag voor ${s.team}` });
    }
    if (!locSet.has(s.location)) {
      hardErrors.push({ code: 'H_LOC', message: `Onbekende locatie: ${s.location}` });
    }
    if (!venueLoc.has(`${s.location}\n${s.venue}`)) {
      hardErrors.push({ code: 'H_VENUE', message: `Veld ${s.venue} hoort niet bij locatie ${s.location}` });
    }
    const dur = s._em - s._sm;
    const minM = t.min_training_minutes != null ? t.min_training_minutes : 60;
    const maxM = t.max_training_minutes != null ? t.max_training_minutes : 120;
    if (dur < minM || dur > maxM) {
      hardErrors.push({
        code: 'H_DURATION',
        message: `Duur ${dur} min voor ${s.team} buiten ${minM}–${maxM}`,
      });
    }
    const free = getFreeIntervalsForVenueDay(
      s.day_of_week,
      s.venue,
      s.location,
      ctx.venue_unavailability,
      plannerCtx,
    );
    if (!intervalCoveredByFreeList(s._sm, s._em, free)) {
      hardErrors.push({
        code: 'H_AVAIL',
        message: `${s.team}: slot buiten beschikbaar venster of geblokkeerd (${s.location}/${s.venue})`,
      });
    }
  }

  const byVenueDow = new Map();
  for (const s of allSlots) {
    const key = `${s.location}\n${s.venue}\n${s.day_of_week}`;
    if (!byVenueDow.has(key)) byVenueDow.set(key, []);
    byVenueDow.get(key).push(s);
  }
  for (const [, list] of byVenueDow) {
    list.sort((a, b) => a._sm - b._sm);
    for (let i = 1; i < list.length; i++) {
      if (list[i]._sm < list[i - 1]._em) {
        hardErrors.push({
          code: 'H_OVERLAP_FIELD',
          message: `Overlap op ${list[i].location}/${list[i].venue} dag ${list[i].day_of_week}`,
        });
      }
    }
  }

  const byTeam = new Map();
  for (const s of allSlots) {
    if (!byTeam.has(s.team)) byTeam.set(s.team, []);
    byTeam.get(s.team).push(s);
  }
  for (const [teamName, list] of byTeam) {
    const t = teamByName.get(teamName);
    if (!t) continue;
    const cat = teamCategory(t);
    if (cat === 'mini') {
      const byMoment = new Map();
      for (const s of list) {
        const mk = `${s.day_of_week}|${s._sm}|${s._em}`;
        if (!byMoment.has(mk)) byMoment.set(mk, new Set());
        byMoment.get(mk).add(`${s.location}\n${s.venue}`);
      }
      for (const s of list) {
        const mk = `${s.day_of_week}|${s._sm}|${s._em}`;
        const venuesAtMoment = byMoment.get(mk);
        if (venuesAtMoment && venuesAtMoment.size > 1) continue;
        for (const o of list) {
          if (o === s) continue;
          if (o.day_of_week !== s.day_of_week) continue;
          const overlap = s._sm < o._em && o._sm < s._em;
          if (overlap && `${s.location}\n${s.venue}` === `${o.location}\n${o.venue}`) {
            hardErrors.push({
              code: 'H_OVERLAP_TEAM',
              message: `${teamName}: twee sessies tegelijk op hetzelfde veld`,
            });
          }
        }
      }
    } else {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          if (a.day_of_week !== b.day_of_week) continue;
          if (a._sm < b._em && b._sm < a._em) {
            hardErrors.push({
              code: 'H_OVERLAP_TEAM',
              message: `${teamName}: overlappende training op dezelfde dag`,
            });
          }
        }
      }
    }
  }

  for (const [teamName, list] of byTeam) {
    const t = teamByName.get(teamName);
    if (!t || teamCategory(t) === 'mini') continue;
    const dows = [...new Set(list.map((s) => s.day_of_week))];
    for (let i = 0; i < dows.length; i++) {
      for (let j = i + 1; j < dows.length; j++) {
        if (dowDiff(dows[i], dows[j]) < 2) {
          hardErrors.push({
            code: 'H_RUST',
            message: `${teamName}: trainingsdagen te dicht op elkaar (rustdag)`,
          });
        }
      }
    }
  }

  const perWeek = new Map();
  for (const s of allSlots) {
    const t = teamByName.get(s.team);
    if (!t) continue;
    const need = t.trainings_per_week != null ? t.trainings_per_week : 1;
    perWeek.set(s.team, (perWeek.get(s.team) || 0) + 1);
  }
  for (const t of teams) {
    const n = perWeek.get(t.display_name) || 0;
    const need = t.trainings_per_week != null ? t.trainings_per_week : 1;
    if (n > need) {
      hardErrors.push({
        code: 'H_COUNT',
        message: `${t.display_name}: ${n} sessies, max ${need} per week`,
      });
    }
  }

  function coachPlayerTeamIds(c) {
    const out = [];
    if (c.playerTeamIds instanceof Set) {
      for (const id of c.playerTeamIds) out.push(id);
    } else if (c.playerTeamId != null) out.push(c.playerTeamId);
    return out;
  }

  for (const [userId, c] of coachMap) {
    const coached = c.coachedTeamIds instanceof Set ? c.coachedTeamIds : new Set(c.coachedTeamIds || []);
    const playerIds = coachPlayerTeamIds(c);
    if (!playerIds.length || coached.size === 0) continue;
    for (const playerTid of playerIds) {
      const playerTeam = teams.find((x) => x.id === playerTid);
      if (!playerTeam) continue;
      const playerName = playerTeam.display_name;
      for (const loc of locSet) {
        for (let dow = 0; dow <= 6; dow++) {
          const coachSlots = allSlots.filter((s) => {
            const tid = teamByName.get(s.team)?.id;
            return s.location === loc && s.day_of_week === dow && tid != null && coached.has(tid);
          });
          const playerSlots = allSlots.filter(
            (s) => s.location === loc && s.day_of_week === dow && s.team === playerName,
          );
          if (!playerSlots.length || !coachSlots.length) continue;
          const maxCoachEnd = Math.max(...coachSlots.map((s) => s._em));
          const minPlayerStart = Math.min(...playerSlots.map((s) => s._sm));
          if (maxCoachEnd > minPlayerStart) {
            hardErrors.push({
              code: 'H_COACH_ORDER',
              message: `Coach (user ${userId}): eigen team moet na laatste coach-sessie op ${loc} (dag ${dow})`,
            });
          } else if (minPlayerStart - maxCoachEnd > COACH_PLAYER_MAX_GAP_MIN) {
            hardErrors.push({
              code: 'H_COACH_ADJACENT',
              message: `Coach (user ${userId}): eigen training moet direct aansluiten op het coachblok op ${loc} (dag ${dow}); huidige tussenruimte ${minPlayerStart - maxCoachEnd} min (max ${COACH_PLAYER_MAX_GAP_MIN})`,
            });
          }
        }
      }
    }
  }

  const catCount = { mini: 0, youth: 0, senior: 0 };
  const firstStart = { mini: 9999, youth: 9999, senior: 9999 };
  for (const s of allSlots) {
    const t = teamByName.get(s.team);
    if (!t) continue;
    const cat = teamCategory(t);
    catCount[cat]++;
    if (s._sm != null) firstStart[cat] = Math.min(firstStart[cat], s._sm);
  }
  if (catCount.mini && catCount.youth && firstStart.mini > firstStart.youth) {
    softScore += 2;
    softWarnings.push({ code: 'Z_01', message: 'Mini start later dan jeugd (voorkeur: mini eerder)' });
  }
  if (catCount.youth && catCount.senior && firstStart.youth > firstStart.senior) {
    softScore += 2;
    softWarnings.push({ code: 'Z_01', message: 'Jeugd start later dan senioren (voorkeur: jeugd eerder)' });
  }

  let locSpread = 0;
  for (const [teamName, list] of byTeam) {
    const locs = new Set(list.map((s) => s.location));
    if (locs.size > 1) locSpread++;
  }
  if (locSpread > 0) {
    softScore += locSpread;
    softWarnings.push({
      code: 'Z_02',
      message: `${locSpread} team(s) op meerdere locaties`,
    });
  }

  const ratios = [];
  for (const t of teams) {
    const need = t.trainings_per_week != null ? t.trainings_per_week : 1;
    const n = perWeek.get(t.display_name) || 0;
    if (need > 0) ratios.push(n / need);
  }
  if (ratios.length >= 2) {
    const minR = Math.min(...ratios);
    const maxR = Math.max(...ratios);
    if (maxR >= 1 && minR < 0.5 && minR < maxR - 0.5) {
      softScore += 3;
      softWarnings.push({
        code: 'Z_03',
        message: 'Sterk ongelijke invulling tussen teams (fairness)',
      });
    }
  }

  const prefH = Math.floor(PREFERRED_DAY_END_MIN / 60);
  const prefM = PREFERRED_DAY_END_MIN % 60;
  const prefLabel = `${String(prefH).padStart(2, '0')}:${String(prefM).padStart(2, '0')}`;
  let lateEndCount = 0;
  for (const s of allSlots) {
    if (s._em != null && s._em > PREFERRED_DAY_END_MIN) lateEndCount++;
  }
  if (lateEndCount > 0) {
    softScore += Math.min(lateEndCount, 5);
    softWarnings.push({
      code: 'Z_04',
      message: `${lateEndCount} sessie(s) eindigen na voorkeur ${prefLabel} (tot uiterlijke eindtijd mag wel)`,
    });
  }

  const ok = hardErrors.length === 0;
  return {
    ok,
    hardErrors,
    softWarnings,
    softScore,
    normalized: slots.map((s) => ({
      team: s.team,
      venue: s.venue,
      location: s.location,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
    })),
  };
}

module.exports = {
  validateSchedule,
  teamCategory,
  categoryOrder,
  rustOkForTeam,
  WRAP_RUST_SUN_MON,
  COACH_PLAYER_MAX_GAP_MIN,
};
