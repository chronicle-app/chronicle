import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readEncoder } from '../dist/encoder.js';

const read = (tag, recorded) => readEncoder(`com.apple.VoiceMemos (${tag})`, new Date(recorded));
const IPHONE = { wikidataId: 'Q2766', name: 'iPhone' };
const WATCH = { wikidataId: 'Q18010946', name: 'Apple Watch' };
const MAC = { wikidataId: 'Q75687', name: 'Mac' };

test('a tag names the release as written and the kind of device it names', () => {
  assert.deepEqual(read('iPhone Version 18.3 (Build 22D63)', '2025-01-01'), {
    release: 'iPhone Version 18.3 (Build 22D63)',
    line: IPHONE,
  });
  assert.deepEqual(read('Watch Version 11.5 (Build 22T572)', '2025-06-01'), {
    release: 'Watch Version 11.5 (Build 22T572)',
    line: WATCH,
  });
  assert.deepEqual(read('Mac OS X 10.15.3', '2020-02-01'), {
    release: 'Mac OS X 10.15.3',
    line: MAC,
  });
  // Anything after the version is kept, and doesn't stop the reading.
  assert.deepEqual(read('Mac OS X 10.14.6 (Build 18G103)', '2019-08-01'), {
    release: 'Mac OS X 10.14.6 (Build 18G103)',
    line: MAC,
  });
});

test("a tag that doesn't name the kind of device gives only the release", () => {
  // `iOS` could be an iPhone or an iPad, and Voice Memos on a Mac is the iPad app.
  assert.deepEqual(read('iOS 13.3.1', '2020-02-01'), { release: 'iOS 13.3.1', line: null });
  assert.deepEqual(read('iPad Version 26.0.1 (Build 25A362)', '2025-10-01'), {
    release: 'iPad Version 26.0.1 (Build 25A362)',
    line: null,
  });
});

test("a tag that doesn't name an OS release, or isn't Voice Memos', says nothing", () => {
  assert.equal(read('aphone5 (null)', '2021-03-01'), null);
  assert.equal(readEncoder('Lavf58.29.100', new Date('2020-01-01')), null);
});

test('an older-form tag naming a release newer than the recording is from iOS 13’s rewrite', () => {
  assert.equal(read('iOS 13.1.2', '2012-04-30'), null);
  assert.equal(read('iOS 13.1.2 (Build 17A860)', '2012-04-30'), null);
  assert.equal(read('Mac OS X 10.15.3', '2018-01-01'), null);
});

test('a tag in the current form is taken as written, with no release dates to keep up', () => {
  // Recorded on a beta, before its release came out, and on a release with no date here.
  assert.deepEqual(read('iPhone Version 18.0 (Build 22A5307f)', '2024-07-01'), {
    release: 'iPhone Version 18.0 (Build 22A5307f)',
    line: IPHONE,
  });
  assert.deepEqual(read('Watch Version 27.0 (Build 24R100)', '2026-10-01'), {
    release: 'Watch Version 27.0 (Build 24R100)',
    line: WATCH,
  });
});
