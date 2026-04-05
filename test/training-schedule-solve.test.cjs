'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { solveSchedule } = require('../server/lib/training-schedule-solve');

function miniCtx() {
  return {
    teams: [
      {
        id: 1,
        display_name: 'Mini',
        nevobo_team_type: 'N5',
        trainings_per_week: 1,
        min_training_minutes: 60,
        max_training_minutes: 60,
      },
    ],
    venues: [
      { name: 'V1', location: 'L1' },
      { name: 'V2', location: 'L1' },
    ],
    locations: [{ name: 'L1' }],
    venue_unavailability: [],
    coachConstraints: new Map(),
    plannerMode: 'blueprint',
  };
}

describe('training-schedule-solve', () => {
  it('mode new: plaatst minstens één sessie', () => {
    const r = solveSchedule('new', miniCtx(), []);
    assert.ok(r.schedule.length >= 1);
    assert.equal(r.schedule[0].team, 'Mini');
  });

  it('mode complete: bevroren slot telt mee', () => {
    const frozen = [
      {
        team: 'Mini',
        venue: 'V1',
        location: 'L1',
        day_of_week: 4,
        start_time: '18:00',
        end_time: '19:00',
      },
    ];
    const r = solveSchedule('complete', miniCtx(), frozen);
    const miniSlots = r.schedule.filter((s) => s.team === 'Mini');
    assert.ok(miniSlots.length >= 1);
    assert.ok(miniSlots.some((s) => s.day_of_week === 4 && s.start_time === '18:00'));
  });
});
