'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  subtractBlocksFromRange,
  getFreeIntervalsForVenueDay,
  intervalCoveredByFreeList,
  unavailabilitySlotApplies,
} = require('../server/lib/training-schedule-availability');

describe('training-schedule-availability', () => {
  it('subtractBlocksFromRange: lege blokkades = volledige range', () => {
    const f = subtractBlocksFromRange(480, 1440, []);
    assert.equal(f.length, 1);
    assert.deepEqual(f[0], { lo: 480, hi: 1440 });
  });

  it('subtractBlocksFromRange: één blokkade in het midden', () => {
    const f = subtractBlocksFromRange(480, 1440, [{ lo: 600, hi: 720 }]);
    assert.equal(f.length, 2);
    assert.deepEqual(f[0], { lo: 480, hi: 600 });
    assert.deepEqual(f[1], { lo: 720, hi: 1440 });
  });

  it('getFreeIntervalsForVenueDay: avond vrij na blokkade overdag', () => {
    const u = [
      {
        venue: 'A',
        location: 'X',
        day_of_week: 2,
        start_time: '08:00',
        end_time: '17:00',
        iso_week: null,
      },
    ];
    const free = getFreeIntervalsForVenueDay(2, 'A', 'X', u, { plannerMode: 'blueprint' });
    assert.ok(free.some((intv) => intv.lo >= 17 * 60));
  });

  it('intervalCoveredByFreeList', () => {
    const free = [{ lo: 600, hi: 900 }];
    assert.equal(intervalCoveredByFreeList(630, 690, free), true);
    assert.equal(intervalCoveredByFreeList(500, 700, free), false);
  });

  it('unavailabilitySlotApplies: blueprint vs week', () => {
    const slot = { iso_week: '2026-W10' };
    assert.equal(unavailabilitySlotApplies(slot, { plannerMode: 'blueprint' }), false);
    assert.equal(unavailabilitySlotApplies(slot, { plannerMode: 'week', isoWeek: '2026-W10' }), true);
    assert.equal(unavailabilitySlotApplies({ iso_week: null }, { plannerMode: 'blueprint' }), true);
  });
});
