import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LocalClock, fitbitTime, zonedInstant } from '../dist/time.js';

const at = iso => Date.parse(iso);
const iso = ms => new Date(ms).toISOString();

// A clock in Toronto whose days have the readings given, by local date.
const clock = windows =>
  new LocalClock('America/Toronto', async date => {
    const window = windows[date];
    return window ? { first: at(window[0]), last: at(window[1]) } : null;
  });

test('Fitbit’s times read as UTC', () => {
  assert.equal(iso(fitbitTime('11/29/16 03:58:06')), '2016-11-29T03:58:06.000Z');
  assert.throws(() => fitbitTime('2016-11-29 03:58:06'), TypeError);
});

test('a wall clock in a zone is an instant by the zone’s rules', () => {
  assert.equal(
    iso(zonedInstant(at('2019-07-01T23:30:00Z'), 'America/Toronto')),
    '2019-07-02T03:30:00.000Z'
  );
  assert.equal(
    iso(zonedInstant(at('2019-01-01T23:30:00Z'), 'America/Toronto')),
    '2019-01-02T04:30:00.000Z'
  );
  // Either side of the clocks going forward at 2:00.
  assert.equal(
    iso(zonedInstant(at('2019-03-10T01:30:00Z'), 'America/Toronto')),
    '2019-03-10T06:30:00.000Z'
  );
  assert.equal(
    iso(zonedInstant(at('2019-03-10T03:30:00Z'), 'America/Toronto')),
    '2019-03-10T07:30:00.000Z'
  );
});

test('a day without readings follows the profile’s zone', async () => {
  assert.equal(
    iso(await clock({}).instant(at('2019-07-01T23:30:00Z'))),
    '2019-07-02T03:30:00.000Z'
  );
});

test('a day whose readings fit the zone follows its rules, on the day the clocks change too', async () => {
  // 23 hours, from midnight EST to midnight EDT.
  const days = clock({ '2019-03-10': ['2019-03-10T05:00:04Z', '2019-03-11T03:59:58Z'] });
  assert.equal(iso(await days.instant(at('2019-03-10T00:30:00Z'))), '2019-03-10T05:30:00.000Z');
  assert.equal(iso(await days.instant(at('2019-03-10T12:00:00Z'))), '2019-03-10T16:00:00.000Z');
});

test('a day whose readings don’t fit the zone takes the offset that fits nearest it', async () => {
  // Away, seven hours behind UTC.
  const away = clock({ '2019-07-10': ['2019-07-10T07:00:05Z', '2019-07-11T06:59:55Z'] });
  assert.equal(iso(await away.instant(at('2019-07-10T23:00:00Z'))), '2019-07-11T06:00:00.000Z');
  // Readings only late in a day away, seven hours behind: the end bounds it,
  // and of the offsets that fit, the nearest Toronto's is −7:00.
  const evening = clock({ '2019-07-10': ['2019-07-11T01:00:00Z', '2019-07-11T06:59:00Z'] });
  assert.equal(iso(await evening.instant(at('2019-07-10T12:00:00Z'))), '2019-07-10T19:00:00.000Z');
  // East of UTC, nine hours ahead.
  const tokyo = clock({ '2019-07-10': ['2019-07-09T15:00:02Z', '2019-07-10T14:59:59Z'] });
  assert.equal(iso(await tokyo.instant(at('2019-07-10T09:00:00Z'))), '2019-07-10T00:00:00.000Z');
});

test('a day whose readings no offset fits follows the zone', async () => {
  // Readings over more than a day.
  const odd = clock({ '2019-07-10': ['2019-07-09T20:00:00Z', '2019-07-11T18:00:00Z'] });
  assert.equal(iso(await odd.instant(at('2019-07-10T12:00:00Z'))), '2019-07-10T16:00:00.000Z');
});
