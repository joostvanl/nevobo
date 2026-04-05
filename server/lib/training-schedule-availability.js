'use strict';

const { normalizeIsoWeek } = require('./training-week-resolve');

/** Basisvenster (minuten vanaf middernacht) waarbinnen gezocht mag worden; daarna min unavailability. */
const BASE_DAY_START_MIN =
  Number(process.env.TRAINING_AVAIL_BASE_START_HOUR ?? 8) * 60;
/** Hard max: training eindigt uiterlijk op dit tijdstip (default 23:00). */
const BASE_DAY_END_MIN =
  Number(process.env.TRAINING_AVAIL_BASE_END_HOUR ?? 23) * 60;
/** Zachte voorkeur: solver probeert eerst alles te laten eindigen vóór dit moment (default 22:30). */
let PREFERRED_DAY_END_MIN = Number(
  process.env.TRAINING_AVAIL_PREFERRED_END_MIN ?? 22 * 60 + 30,
);
if (PREFERRED_DAY_END_MIN > BASE_DAY_END_MIN) {
  PREFERRED_DAY_END_MIN = BASE_DAY_END_MIN;
}

function parseTimeToMinutes(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Zelfde semantiek als planner: blueprint = alleen recurring; week = recurring + match iso_week */
function unavailabilitySlotApplies(slot, context) {
  const wk = slot.iso_week && String(slot.iso_week).trim();
  if (context.plannerMode === 'blueprint') {
    return !wk;
  }
  if (!wk) return true;
  const ctxWeek = String(context.isoWeek || '').trim();
  if (!ctxWeek) return false;
  return normalizeIsoWeek(slot.iso_week) === normalizeIsoWeek(context.isoWeek);
}

function venueLocationKey(venue, location) {
  return `${String(location)}\n${String(venue)}`;
}

/**
 * Trekt gesorteerde niet-overlappende blokkades af van [baseLo, baseHi).
 * @returns {Array<{lo:number, hi:number}>}
 */
function subtractBlocksFromRange(baseLo, baseHi, blocks) {
  if (baseHi <= baseLo) return [];
  const sorted = blocks
    .filter((b) => b.lo < b.hi && b.hi > baseLo && b.lo < baseHi)
    .map((b) => ({ lo: Math.max(baseLo, b.lo), hi: Math.min(baseHi, b.hi) }))
    .sort((a, b) => a.lo - b.lo);
  const out = [];
  let cur = baseLo;
  for (const b of sorted) {
    if (b.lo > cur) out.push({ lo: cur, hi: b.lo });
    cur = Math.max(cur, b.hi);
    if (cur >= baseHi) break;
  }
  if (cur < baseHi) out.push({ lo: cur, hi: baseHi });
  return out;
}

/**
 * Vrije intervallen (minuten) voor één veld op één dag van de week.
 * @param {number} dow 0–6
 * @param {string} venueName
 * @param {string} locationName
 * @param {Array<{venue:string,location:string,day_of_week:number,start_time:string,end_time:string,iso_week?:string|null}>} venue_unavailability
 * @param {{plannerMode:'blueprint'|'week', isoWeek?:string}} context
 */
function getFreeIntervalsForVenueDay(dow, venueName, locationName, venue_unavailability, context) {
  const baseLo = BASE_DAY_START_MIN;
  const baseHi = Math.min(BASE_DAY_END_MIN, 24 * 60);
  const blocks = [];
  for (const u of venue_unavailability || []) {
    if (!unavailabilitySlotApplies(u, context)) continue;
    if (u.day_of_week !== dow) continue;
    if (u.venue !== venueName || u.location !== locationName) continue;
    const u0 = parseTimeToMinutes(u.start_time);
    const u1 = parseTimeToMinutes(u.end_time);
    if (u0 == null || u1 == null || u1 <= u0) continue;
    blocks.push({ lo: u0, hi: u1 });
  }
  return subtractBlocksFromRange(baseLo, baseHi, blocks);
}

/**
 * True als [sm,em) volledig in minstens één vrij interval ligt.
 */
function intervalCoveredByFreeList(sm, em, freeList) {
  if (em <= sm) return false;
  for (const f of freeList) {
    if (sm >= f.lo && em <= f.hi) return true;
  }
  return false;
}

module.exports = {
  BASE_DAY_START_MIN,
  BASE_DAY_END_MIN,
  PREFERRED_DAY_END_MIN,
  parseTimeToMinutes,
  unavailabilitySlotApplies,
  venueLocationKey,
  subtractBlocksFromRange,
  getFreeIntervalsForVenueDay,
  intervalCoveredByFreeList,
  normalizeIsoWeek,
};
