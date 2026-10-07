import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A synthetic Chrome profile, so no test reads the host's browsing history.

// Unix ms for 2025-01-01T00:00:00Z, and Chrome's microseconds since 1601 for it.
export const JAN_1 = 1_735_689_600_000;
const chrome = ms => (ms + 11_644_473_600_000) * 1000;
// Days since 1601, as Preferences stores when a sync client id was added.
const day = ms => Math.floor(ms / 86_400_000) + 134_774;
export const DAY_MS = 86_400_000;

// visits.transition: core type in the low byte, chain qualifiers above.
const LINK = 0x30_00_00_00; // a link, start and end of its own chain
const REDIRECT_HOP = 0x10_00_00_00; // redirected onward, never landed
const AFTER_SERVER_REDIRECT = -0x60_00_00_00; // chain end + server redirect, as a signed int32
const MANUAL_SUBFRAME = 0x30_00_00_04;
const KEYWORD_GENERATED = 0x30_00_00_0a;

const preferences = {
  google: { services: { last_gaia_id: 'gaia-1' } },
  // Other Google accounts signed in on the web are listed too.
  account_info: [
    { gaia: 'gaia-2', email: 'other@example.com' },
    { gaia: 'gaia-1', email: 'you@example.com' },
  ],
  sync: {
    local_device_guids_with_timestamp: [
      { cache_guid: 'mac-new', timestamp: day(JAN_1 + DAY_MS) },
      { cache_guid: 'mac-old', timestamp: day(JAN_1 - 10 * DAY_MS) },
    ],
  },
};

/** A profile's `History` and `Preferences`; `prefs: null` leaves out `Preferences`. */
export function fixture(t, { prefs = preferences, profile = 'Default' } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'chrome-fixture-'));
  t.after(() => rmSync(userData, { recursive: true, force: true }));
  const dir = join(userData, profile);
  mkdirSync(dir);
  const input = join(dir, 'History');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR);
    CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL,
      visit_time INTEGER NOT NULL, transition INTEGER NOT NULL, originator_cache_guid TEXT);
    CREATE INDEX visits_time_index ON visits (visit_time);
    CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
    INSERT INTO urls VALUES (1, 'https://example.com/a', 'Page A'),
      (2, 'https://example.com/b', ''), (3, 'https://example.com/c', 'Page C'),
      (4, 'chrome://settings/', 'Settings'), (5, 'https://search.example/', 'Search');
    INSERT INTO visits VALUES
      (1, 1, ${chrome(JAN_1 + 1000)}, ${LINK}, ''),
      (2, 2, ${chrome(JAN_1 + 2000)}, ${REDIRECT_HOP}, ''),
      (3, 3, ${chrome(JAN_1 + 2000) + 500}, ${AFTER_SERVER_REDIRECT}, ''),
      (4, 1, ${chrome(JAN_1 + 3000)}, ${MANUAL_SUBFRAME}, ''),
      (5, 4, ${chrome(JAN_1 + 4000)}, ${LINK}, ''),
      (6, 2, ${chrome(JAN_1 + 5000)}, ${LINK}, ''),
      (7, 2, ${chrome(JAN_1 + 6000)}, ${LINK}, 'phone-guid'),
      (8, 3, ${chrome(JAN_1 + 2 * DAY_MS)}, ${LINK}, NULL),
      (9, 5, ${chrome(JAN_1 + 2 * DAY_MS) + 20}, ${KEYWORD_GENERATED}, '');
    -- 6 was imported from Safari, 7 synced from another device.
    INSERT INTO visit_source VALUES (6, 5), (7, 0);
  `);
  db.close();
  if (prefs) writeFileSync(join(dir, 'Preferences'), JSON.stringify(prefs));
  return { userData, input };
}
