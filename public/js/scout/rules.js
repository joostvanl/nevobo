/**
 * Nevobo / standaard volleybalregels
 * - Set 1-4: eerste tot 25, minimaal 2 punten verschil
 * - Set 5 (tiebreak): eerste tot 15, minimaal 2 punten verschil
 * - Max 5 sets, winnen met 3 gewonnen sets
 * - Bij 8 punten in set 5: veldwisseling
 */

const RULES = {
  SETS_TO_WIN: 3,
  MAX_SETS: 5,
  POINTS_TO_WIN_SET: 25,
  POINTS_TO_WIN_TIEBREAK: 15,
  MIN_POINT_DIFF: 2,
  TIEBREAK_SIDE_CHANGE_AT: 8,
  /* Scouting-specifiek */
  MAX_SUBS_PER_SET: 6,
  MAX_PLAYERS: 12,
  LIBERO_BENCH_POSITION: 7,

  isSetWon(homeScore, awayScore, isTiebreak) {
    const target = isTiebreak ? this.POINTS_TO_WIN_TIEBREAK : this.POINTS_TO_WIN_SET;
    if (homeScore >= target && homeScore - awayScore >= this.MIN_POINT_DIFF) return 'home';
    if (awayScore >= target && awayScore - homeScore >= this.MIN_POINT_DIFF) return 'away';
    return null;
  },

  isMatchOver(homeSets, awaySets) {
    return homeSets >= this.SETS_TO_WIN || awaySets >= this.SETS_TO_WIN;
  },

  currentSetNumber(homeSets, awaySets) {
    return homeSets + awaySets + 1;
  },

  isTiebreak(setNumber) {
    return setNumber === 5;
  },

  pointsToWin(setNumber) {
    return this.isTiebreak(setNumber) ? this.POINTS_TO_WIN_TIEBREAK : this.POINTS_TO_WIN_SET;
  }
};
if (typeof window !== 'undefined') window.RULES = RULES;
if (typeof window !== 'undefined') window.RULES = RULES;
window.RULES = RULES;
if (typeof window !== 'undefined') window.RULES = RULES;
if (typeof window !== 'undefined') window.RULES = RULES;
window.RULES = RULES;
if (typeof window !== 'undefined') window.RULES = RULES;
if (typeof window !== 'undefined') window.RULES = RULES;
window.RULES = RULES;

window.RULES = RULES;
