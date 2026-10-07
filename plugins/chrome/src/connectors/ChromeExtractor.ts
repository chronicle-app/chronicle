import { constants as fsConstants, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Record } from '@chronicle.app/etl';
import {
  SqliteExtractor,
  chromeToUnixMsSql,
  getRow,
  isSqliteBusy,
  iterateRows,
  timeRangeConditions,
  unixMsToChromeTimestamp,
} from '@chronicle.app/etl-sqlite';
import { z } from 'zod';
import ChromeTransformer from './ChromeTransformer.js';
import { type ChromeAccount, readChromeAccount } from './profile.js';

// visits.transition: the low byte is the core type, the high bits qualifiers.
// CHAIN_END marks the visit a redirect chain landed on (a visit with no
// redirects is both start and end), so redirect hops drop out.
const CHAIN_END = 0x20_00_00_00;
const CORE_MASK = 0xff;
// Core types that are not a page you visited: pages loaded inside a frame,
// automatically or by a click there (3, 4), and the extra visit Chrome adds to
// a search engine's keyword URL when you search from the address bar (10).
const SKIPPED_TYPES = [3, 4, 10];
// visit_source.source for visits imported from another browser or device
// migration (Firefox, IE, Safari, OS migration). Another browser's history
// belongs to that browser's source.
const IMPORTED_SOURCES = [3, 4, 5, 6];
// Browser pages and extension pages, not the web.
const INTERNAL_URL_PREFIXES = ['chrome://', 'chrome-extension://'];

const visitTime = chromeToUnixMsSql('visits.visit_time');

export class ChromeExtractor extends SqliteExtractor<typeof ChromeExtractor> {
  static override source = 'chrome';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override description = 'Browsing history';
  static override default = true;
  static override recordTypes = ['views'];
  // extract() orders by visits.visit_time desc, which with keyOf opts this
  // extractor into the frontier cursor (incremental catch-up import).
  static override newestFirst = true;
  /** Where Chrome keeps its profiles, per platform. */
  static userDataDirs: { [P in NodeJS.Platform]?: () => string } = {
    darwin: () => join(homedir(), 'Library/Application Support/Google/Chrome'),
    linux: () => join(homedir(), '.config/google-chrome'),
    win32: () =>
      join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'Google/Chrome/User Data'),
  };

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z
      .string()
      .optional()
      .describe("Path to a Chrome History file (defaults to the profile's)"),
    profile: z
      .string()
      .default('Default')
      .describe('Chrome profile directory name, such as Default or "Profile 1"'),
  }) as any;

  static override defaultTransformer = ChromeTransformer;

  private account: ChromeAccount | null = null;
  private cloneDir: string | null = null;

  /** visits.id — Chrome's own visit id, AUTOINCREMENT so never reused. */
  override keyOf(record: Record): string | null {
    const visitId = (record.data as { visit_id?: number }).visit_id;
    return visitId === null || visitId === undefined ? null : String(visitId);
  }

  override async setup(): Promise<void> {
    const cfg = this.config as { input?: string; profile: string };
    cfg.input ??= join(this.userDataDir(), cfg.profile, 'History');
    await super.setup();

    try {
      getRow(this.db!.prepare('SELECT 1 FROM sqlite_schema'));
    } catch (error) {
      if (!isSqliteBusy(error)) throw error;
      // Chrome keeps History exclusively locked while it runs, so read a
      // clone instead (instant on APFS, a plain copy elsewhere). Only the
      // database file is copied: Chrome's journal is empty between commits,
      // and a read-only connection can't roll back a live one.
      this.db!.close();
      this.db = null;
      this.cloneDir = mkdtempSync(join(tmpdir(), 'chronicle-chrome-'));
      const clone = join(this.cloneDir, 'History');
      copyFileSync(cfg.input, clone, fsConstants.COPYFILE_FICLONE);
      this.db = this.openDatabase(clone);
    }

    this.account = readChromeAccount(join(dirname(cfg.input), 'Preferences'));
  }

  override async teardown(): Promise<void> {
    await super.teardown();
    if (this.cloneDir) {
      rmSync(this.cloneDir, { recursive: true, force: true });
      this.cloneDir = null;
    }
  }

  private userDataDir(): string {
    const cls = this.constructor as typeof ChromeExtractor;
    const dir = cls.userDataDirs[process.platform];
    if (!dir)
      throw new Error(`No default ${cls.source} profile on ${process.platform}; pass input`);
    return dir();
  }

  // Visits that landed on a web page, browsed or synced, within since/until.
  private visitFilter(): { where: string; values: Array<number | string> } {
    const range = timeRangeConditions('visits.visit_time', this.config, {
      convert: date => unixMsToChromeTimestamp(date.getTime()),
    });
    const conditions = [
      `(visits.transition & ${CHAIN_END}) != 0`,
      `(visits.transition & ${CORE_MASK}) NOT IN (${SKIPPED_TYPES.join(', ')})`,
      `(visit_source.source IS NULL OR visit_source.source NOT IN (${IMPORTED_SOURCES.join(', ')}))`,
      ...INTERNAL_URL_PREFIXES.map(() => `urls.url NOT LIKE ? || '%'`),
      ...range.conditions,
    ];
    return {
      where: conditions.join(' AND '),
      values: [...INTERNAL_URL_PREFIXES, ...range.values],
    };
  }

  private static readonly FROM = `
    FROM visits
    JOIN urls ON urls.id = visits.url
    LEFT JOIN visit_source ON visit_source.id = visits.id`;

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // 0 is the "no limit" convention (null here); the CLI's --limit default is the safety net
    const limit = this.getEffectiveLimit();
    const { where, values } = this.visitFilter();

    let sql = `
      SELECT visits.id AS visit_id,
             urls.url,
             urls.title,
             ${visitTime} AS unix_ms,
             visits.transition
      ${ChromeExtractor.FROM}
      WHERE ${where}
      ORDER BY visits.visit_time DESC`;
    if (limit !== null) {
      sql += ` LIMIT ?`;
      values.push(limit);
    }

    const { account } = this;
    for (const row of iterateRows<any>(this.db.prepare(sql), ...values)) {
      yield this.createRecord(this.processRow(row), { source: 'chrome', account });
    }
  }

  private processRow(row: any): any {
    return {
      visit_id: row.visit_id,
      url: row.url,
      title: row.title || null,
      unix_ms: row.unix_ms,
      transition: row.transition,
    };
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;

    try {
      // Same filters as the main query, counted
      const { where, values } = this.visitFilter();
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n ${ChromeExtractor.FROM} WHERE ${where}`)
        .get(...values) as { n: number };
      return row.n;
    } catch {
      return null;
    }
  }
}
