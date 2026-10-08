import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A synthetic Chrome profile, so no test reads the host's browsing history.

// Unix ms for 2025-01-01T00:00:00Z, and Chrome's microseconds since 1601 for it.
export const JAN_1 = 1_735_689_600_000;
const chrome = ms => (ms + 11_644_473_600_000) * 1000;
export const DAY_MS = 86_400_000;

// visits.transition: core type in the low byte, chain qualifiers above.
const LINK = 0x30_00_00_00; // a link, start and end of its own chain
const REDIRECT_HOP = 0x10_00_00_00; // redirected onward, never landed
const AFTER_SERVER_REDIRECT = -0x60_00_00_00; // chain end + server redirect, as a signed int32
const MANUAL_SUBFRAME = 0x30_00_00_04;
const FORM_SUBMIT = 0x30_00_00_07;
const KEYWORD_GENERATED = 0x30_00_00_0a;
const BACK = 0x31_00_00_00; // a link revisited with the back button

// Signed in with sync. Other Google accounts signed in on the web are listed
// too, and an address can be in any case.
export const ACCOUNTS = [
  { gaia: 'gaia-2', email: 'other@example.com' },
  { gaia: 'gaia-1', email: 'You@Example.com', full_name: 'Test You' },
];
const preferences = {
  sync: { gaia_id: 'gaia-1' },
  google: { services: { last_gaia_id: 'gaia-1' } },
  account_info: ACCOUNTS,
};

/**
 * A profile's `History` and `Preferences`; `prefs: null` leaves out
 * `Preferences`, and `legacy` drops the referrer columns Chrome added in 2022.
 */
export function fixture(t, { prefs = preferences, profile = 'Default', legacy = false } = {}) {
  const userData = mkdtempSync(join(tmpdir(), 'chrome-fixture-'));
  t.after(() => rmSync(userData, { recursive: true, force: true }));
  const dir = join(userData, profile);
  mkdirSync(dir);
  const input = join(dir, 'History');
  const db = new DatabaseSync(input);
  db.exec(`
    CREATE TABLE urls (id INTEGER PRIMARY KEY, url LONGVARCHAR, title LONGVARCHAR);
    CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, url INTEGER NOT NULL,
      visit_time INTEGER NOT NULL, transition INTEGER NOT NULL, originator_cache_guid TEXT,
      from_visit INTEGER, opener_visit INTEGER, external_referrer_url TEXT);
    CREATE INDEX visits_time_index ON visits (visit_time);
    CREATE TABLE visit_source (id INTEGER PRIMARY KEY, source INTEGER NOT NULL);
    INSERT INTO urls VALUES (1, 'https://example.com/a', 'Page A'),
      (2, 'https://example.com/b', ''), (3, 'https://example.com/c', 'Page C'),
      (4, 'chrome://settings/', 'Settings'), (5, 'https://search.example/', 'Search'),
      (6, 'file:///notes.html', 'Notes');
    INSERT INTO visits VALUES
      (1, 1, ${chrome(JAN_1 + 1000)}, ${LINK}, '', 0, 0, 'https://elsewhere.example/'),
      (2, 2, ${chrome(JAN_1 + 2000)}, ${REDIRECT_HOP}, '', 1, 0, NULL),
      (3, 3, ${chrome(JAN_1 + 2000) + 500}, ${AFTER_SERVER_REDIRECT}, '', 2, 0, NULL),
      (4, 1, ${chrome(JAN_1 + 3000)}, ${MANUAL_SUBFRAME}, '', 3, 0, NULL),
      (5, 4, ${chrome(JAN_1 + 4000)}, ${LINK}, '', 0, 0, NULL),
      (6, 2, ${chrome(JAN_1 + 5000)}, ${LINK}, '', 0, 0, NULL),
      (7, 2, ${chrome(JAN_1 + 6000)}, ${LINK}, 'phone-guid', 0, 3, NULL),
      (8, 3, ${chrome(JAN_1 + 2 * DAY_MS)}, ${LINK}, NULL, 5, 0, NULL),
      (9, 5, ${chrome(JAN_1 + 2 * DAY_MS) + 20}, ${KEYWORD_GENERATED}, '', 0, 0, NULL),
      (10, 2, ${chrome(JAN_1 + 2 * DAY_MS + 1000)}, ${FORM_SUBMIT}, '', 8, 1, NULL),
      (11, 3, ${chrome(JAN_1 + 2 * DAY_MS + 2000)}, ${BACK}, '', 10, 0, NULL),
      (12, 3, ${chrome(JAN_1 + 2 * DAY_MS + 3000)}, ${LINK}, '', 11, 0, NULL),
      (13, 6, ${chrome(JAN_1 + 2 * DAY_MS + 4000)}, ${LINK}, '', 12, 0, NULL);
    -- 6 was imported from Safari, 7 synced from another device.
    INSERT INTO visit_source VALUES (6, 5), (7, 0);
  `);
  if (legacy) {
    db.exec(`ALTER TABLE visits DROP COLUMN opener_visit;
      ALTER TABLE visits DROP COLUMN external_referrer_url;`);
  }
  db.close();
  if (prefs) writeFileSync(join(dir, 'Preferences'), JSON.stringify(prefs));
  return { userData, input };
}
