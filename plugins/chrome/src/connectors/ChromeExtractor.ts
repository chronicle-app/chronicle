import { constants as fsConstants, copyFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { StatementSync } from 'node:sqlite';
import { EXIT_CODES, ExtractorError, Record, delay } from '@chronicle.app/etl';
import {
  SqliteExtractor,
  allRows,
  chromeToUnixMsSql,
  getRow,
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
// Web pages only: not browser or extension pages, files, or blobs.
const WEB_SCHEMES = ['http://', 'https://'];
// A redirect chain's first visit: its transition says how the navigation
// began, and its from_visit is the page it began on.
const CHAIN_START = 0x10_00_00_00;
const MAX_REDIRECTS = 20;
// Core types for following something on a page: a link (0) or a form (7).
const LINK = 0;
const FORM_SUBMIT = 7;
// Qualifiers for going back or forward (0x01000000) and for a URL entered in
// the address bar (0x02000000): not a step from the page before.
const NOT_FOLLOWED = 0x03_00_00_00;

/** The columns of a visit that say where it came from. */
interface VisitRow {
  url: string;
  transition: number;
  /** The transition's parts, split in SQL. */
  core_type: number;
  chain_start: number;
  not_followed: number;
  from_visit: number;
  opener_visit: number;
}

/** A link followed or a form submitted, from one page to the visit's. */
export interface ChromeNavigation {
  from_url: string;
  /** The URL followed: the redirect chain's first, before any redirects. */
  followed_url: string;
  form_submit: boolean;
}

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
    // Chrome's own override for ~/.config, then the XDG one.
    linux: () =>
      join(
        process.env.CHROME_CONFIG_HOME || process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
        'google-chrome'
      ),
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
  /** Chrome saves its history every few seconds: tries at copying it, and the wait between. */
  static copyAttempts = 5;
  static copyRetryMs = 200;

  private account: ChromeAccount | null = null;
  private referrerColumns = '';
  private visitById: StatementSync | null = null;
  private copyDir: string | null = null;

  /** visits.id — Chrome's own visit id, AUTOINCREMENT so never reused. */
  override keyOf(record: Record): string | null {
    const visitId = (record.data as { visit_id?: number }).visit_id;
    return visitId === null || visitId === undefined ? null : String(visitId);
  }

  override async setup(): Promise<void> {
    const cfg = this.config as { input?: string; profile: string };
    cfg.input ??= join(this.userDataDir(), cfg.profile, 'History');
    // Says whether History is there and readable; the run reads a copy.
    await super.setup();
    this.db!.close();
    this.db = null;
    this.copyDir = mkdtempSync(join(tmpdir(), 'chronicle-chrome-'));
    try {
      this.db = this.openDatabase(await this.copyHistory(cfg.input, this.copyDir));
      this.account = readChromeAccount(join(dirname(cfg.input), 'Preferences'));

      // History files from before 2022 have no opener.
      const columns = new Set(
        allRows<{ name: string }>(this.db.prepare('PRAGMA table_info(visits)')).map(c => c.name)
      );
      this.referrerColumns = [
        'visits.transition',
        `visits.transition & ${CORE_MASK} AS core_type`,
        `(visits.transition & ${CHAIN_START}) != 0 AS chain_start`,
        `(visits.transition & ${NOT_FOLLOWED}) != 0 AS not_followed`,
        'visits.from_visit',
        columns.has('opener_visit') ? 'visits.opener_visit' : '0 AS opener_visit',
      ].join(', ');
      this.visitById = this.db.prepare(`
        SELECT urls.url, ${this.referrerColumns}
        FROM visits JOIN urls ON urls.id = visits.url
        WHERE visits.id = ?`);
    } catch (error) {
      await this.teardown();
      throw error;
    }
  }

  /**
   * Copy History into `dir`, to read it without Chrome's lock, and without
   * holding the file Chrome writes, which could keep a Chrome that starts
   * mid-run from opening it. A copy is whole when Chrome wasn't saving and
   * the file didn't change while it was copied. A copy that caught a save is
   * taken again.
   */
  private async copyHistory(history: string, dir: string): Promise<string> {
    const cls = this.constructor as typeof ChromeExtractor;
    const copy = join(dir, 'History');
    for (let attempt = 1; ; attempt++) {
      const before = savedState(history);
      copyFileSync(history, copy, fsConstants.COPYFILE_FICLONE);
      if (before !== null && before === savedState(history)) return copy;
      if (attempt >= cls.copyAttempts) {
        throw new ExtractorError('Chrome kept saving its history', {
          code: 'input-busy',
          exitCode: EXIT_CODES.transient,
          hint: `Run \`chronicle extract ${cls.source}\` again in a moment.`,
          fields: { path: history },
        });
      }
      await delay(cls.copyRetryMs);
    }
  }

  override async teardown(): Promise<void> {
    await super.teardown();
    if (this.copyDir) {
      rmSync(this.copyDir, { recursive: true, force: true });
      this.copyDir = null;
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
      `(${WEB_SCHEMES.map(() => `urls.url LIKE ? || '%'`).join(' OR ')})`,
      ...range.conditions,
    ];
    return {
      where: conditions.join(' AND '),
      values: [...WEB_SCHEMES, ...range.values],
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
             ${this.referrerColumns}
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
      navigation: this.navigation(row),
    };
  }

  /**
   * How the visit was reached by following a link or submitting a form: from
   * the page before it in its tab, else the page in the tab that opened it.
   * Read from the first visit of its redirect chain, as Chrome's own history
   * features do. Null for a typed URL, a bookmark, a reload, going back or
   * forward, or a page reached from itself or from a page that isn't on the
   * web. Chrome also keeps a referrer that isn't a visit as a URL, but for a
   * link to another site browsers cut it to that site's home page, which isn't
   * the page you came from.
   */
  private navigation(row: VisitRow): ChromeNavigation | null {
    let start = row;
    for (let hops = 0; !start.chain_start; hops++) {
      const previous = hops < MAX_REDIRECTS ? this.visit(start.from_visit) : undefined;
      if (!previous) return null;
      start = previous;
    }
    if (start.core_type !== LINK && start.core_type !== FORM_SUBMIT) return null;
    if (start.not_followed) return null;

    const from = this.visit(start.from_visit)?.url ?? this.visit(start.opener_visit)?.url;
    if (!from || from === row.url || !WEB_SCHEMES.some(scheme => from.startsWith(scheme))) {
      return null;
    }
    return {
      from_url: from,
      followed_url: start.url,
      form_submit: start.core_type === FORM_SUBMIT,
    };
  }

  private visit(id: number): VisitRow | undefined {
    return id ? getRow<VisitRow>(this.visitById!, id) : undefined;
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

/**
 * History's size and modification time while it holds only saved changes,
 * or null while Chrome saves. Chrome keeps a transaction open between saves,
 * and SQLite writes each change to the journal before the file, so the file
 * is whole while its journal is empty or was written after it.
 */
function savedState(history: string): string | null {
  const file = statSync(history);
  const journal = statSync(`${history}-journal`, { throwIfNoEntry: false });
  if (journal && journal.size > 0 && journal.mtimeMs <= file.mtimeMs) return null;
  return `${file.size}:${file.mtimeMs}`;
}
