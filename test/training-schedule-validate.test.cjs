'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateSchedule } = require('../server/lib/training-schedule-validate');

const baseCtx = () => ({
  teams: [
    {
      id: 1,
      display_name: 'Team A',
      nevobo_team_type: 'JA',
      trainings_per_week: 1,
      min_training_minutes: 60,
      max_training_minutes: 120,
    },
  ],
  venues: [{ name: 'V1', location: 'Loc1' }],
  locations: [{ name: 'Loc1' }],
  venue_unavailability: [],
  coachConstraints: new Map(),
  plannerMode: 'blueprint',
});

describe('training-schedule-validate', () => {
  it('geldig enkel slot', () => {
    const ctx = baseCtx();
    const r = validateSchedule(
      [
        {
          team: 'Team A',
          venue: 'V1',
          location: 'Loc1',
          day_of_week: 2,
          start_time: '19:00',
          end_time: '20:00',
        },
      ],
      ctx,
    );
    assert.equal(r.ok, true);
    assert.equal(r.hardErrors.length, 0);
  });

  it('H_OVERLAP_FIELD: twee teams opzelfde veld', () => {
    const ctx = {
      ...baseCtx(),
      teams: [
        ...baseCtx().teams,
        {
          id: 2,
          display_name: 'Team B',
          nevobo_team_type: 'MA',
          trainings_per_week: 1,
          min_training_minutes: 60,
          max_training_minutes: 120,
        },
      ],
    };
    const slot = { venue: 'V1', location: 'Loc1', day_of_week: 2, start_time: '19:00', end_time: '20:00' };
    const r = validateSchedule(
      [
        { ...slot, team: 'Team A' },
        { ...slot, team: 'Team B' },
      ],
      ctx,
    );
    assert.equal(r.ok, false);
    assert.ok(r.hardErrors.some((e) => e.code === 'H_OVERLAP_FIELD'));
  });

  it('H_RUST: opeenvolgende dagen (niet-mini)', () => {
    const ctx = baseCtx();
    const r = validateSchedule(
      [
        {
          team: 'Team A',
          venue: 'V1',
          location: 'Loc1',
          day_of_week: 2,
          start_time: '19:00',
          end_time: '20:30',
        },
        {
          team: 'Team A',
          venue: 'V1',
          location: 'Loc1',
          day_of_week: 3,
          start_time: '19:00',
          end_time: '20:30',
        },
      ],
      ctx,
    );
    assert.equal(r.ok, false);
    assert.ok(r.hardErrors.some((e) => e.code === 'H_RUST'));
  });
});
