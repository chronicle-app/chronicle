import type { KindSurvey } from '@chronicle.app/etl';
import { SqliteExtractor, allRows, countsByMonth, monthSql } from '@chronicle.app/etl-sqlite';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { z } from 'zod';

export const DEFAULT_DB = `${process.env.HOME}/Library/Application Support/info.eurocomp.Timing2/SQLite.db`;
export const DEFAULT_WINDOW_DAYS = 90;

export interface TimingDevice {
  globalId: string;
  name: string;
  /** Real hardware MAC (Macs only); null for Screen-Time relayed devices. */
  mac: string | null;
  model: string | null;
}

export interface TimingProject {
  id: string;
  title: string;
}

/**
 * Shared base for the extractors that read Timing.app's local SQLite: opens the
 * DB read-only, pre-loads the small `Device`/`Project` lookups, and resolves the
 * time window. `AppActivity` (6M+ rows) is streamed with a cursor by subclasses.
 */
export abstract class TimingDbExtractor<
  SelfClass extends typeof SqliteExtractor = typeof SqliteExtractor,
> extends SqliteExtractor<SelfClass> {
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override temporality = 'event' as const;

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z.string().describe("Path to Timing.app's SQLite.db").default(DEFAULT_DB),
    all: z
      .boolean()
      .default(false)
      .describe(`Import the full history instead of the last ${DEFAULT_WINDOW_DAYS} days`),
  }) as any;

  /**
   * Lower bound (epoch seconds): explicit `since`, else a default window, else
   * none. An unbounded `--limit 0` also drops the window — asking for "no cap"
   * is a request for a full backfill, not the newest 90 days without a count cap.
   */
  protected sinceSeconds(limit = this.getEffectiveLimit()): number | null {
    if (this.config.since) return this.config.since.getTime() / 1000;
    if ((this.config as any).all || limit === null) return null;
    return (Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000) / 1000;
  }

  protected untilSeconds(): number | null {
    return this.config.until ? this.config.until.getTime() / 1000 : null;
  }

  /** Rows of `alias` not deleted that start after `since` and before `until`. */
  protected windowFilter(
    alias: string,
    since = this.sinceSeconds()
  ): { conditions: string[]; params: number[] } {
    const until = this.untilSeconds();
    const conditions = [`${alias}.isDeleted = 0`];
    const params: number[] = [];
    if (since !== null) {
      conditions.push(`${alias}.startDate > ?`);
      params.push(since);
    }
    if (until !== null) {
      conditions.push(`${alias}.startDate < ?`);
      params.push(until);
    }
    return { conditions, params };
  }

  protected loadDevices(): Map<string, TimingDevice> {
    const rows = this.db!.prepare(
      `SELECT CAST(localID AS TEXT) AS localId, CAST(globalID AS TEXT) AS globalId,
              macAddress, displayName, property_bag AS propertyBag
       FROM Device`
    ).all() as any[];

    const devices = new Map<string, TimingDevice>();
    for (const row of rows) {
      const bag = parseBag(row.propertyBag);
      const relayed = bag._imported_via_screen_time === true;
      const mac =
        !relayed && row.macAddress instanceof Uint8Array && row.macAddress.length === 6
          ? formatMac(row.macAddress)
          : null;
      devices.set(row.localId, {
        globalId: row.globalId,
        name: bag._display_name_override || row.displayName || row.globalId,
        mac,
        model: bag._device_model ?? null,
      });
    }
    return devices;
  }

  protected loadProjects(): Map<string, any> {
    const rows = this.db!.prepare(
      `SELECT CAST(id AS TEXT) AS id, title, CAST(parentID AS TEXT) AS parentId,
              color, productivityScore, isArchived, property_bag AS propertyBag
       FROM Project WHERE isSample = 0`
    ).all() as any[];

    const projects = new Map<string, any>();
    for (const row of rows) {
      const bag = parseBag(row.propertyBag);
      projects.set(row.id, {
        id: row.id,
        title: row.title,
        parentId: row.parentId ?? null,
        color: row.color ?? null,
        isArchived: Boolean(row.isArchived),
        billing: bag._default_billing_status ?? null,
      });
    }
    return projects;
  }

  /** A resolver that nests a project's full ancestry (leaf-first) for a row. */
  protected projectChainResolver(): (id: string | null) => TimingProject[] {
    const projects = this.loadProjects();
    return (id: string | null) => resolveChain(projects, id);
  }

  protected countWindow(table: string, col: string, extra = ''): number {
    const since = this.sinceSeconds();
    const until = this.untilSeconds();
    const conditions = ['isDeleted = 0'];
    const params: any[] = [];
    if (since !== null) {
      conditions.push(`${col} > ?`);
      params.push(since);
    }
    if (until !== null) {
      conditions.push(`${col} < ?`);
      params.push(until);
    }
    const where = conditions.join(' AND ') + extra;
    return (
      this.db!.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params) as {
        n: number;
      }
    ).n;
  }
}

/**
 * One aggregate over a kind's rows: how many, their first and last start in
 * epoch seconds, and the seconds they span.
 */
export interface SpanRow {
  n: number;
  first: number | null;
  last: number | null;
  seconds: number;
}

/** A kind's survey from its aggregate, with its months when asked. */
export function timeSurvey(
  row: SpanRow,
  label: string,
  byMonth?: KindSurvey['byMonth']
): KindSurvey {
  return {
    count: row.n,
    ...(row.first !== null && { earliest: new Date(row.first * 1000) }),
    ...(row.last !== null && { latest: new Date(row.last * 1000) }),
    ...(byMonth && { byMonth }),
    measures: [{ key: 'duration', label, value: row.seconds, unit: 'seconds' }],
  };
}

/**
 * How many of a kind's rows start in each month, over the FROM and WHERE of
 * its aggregate.
 * @param start A trusted SQL expression for the start, in epoch seconds
 */
export function startsByMonth(
  db: DatabaseSync,
  start: string,
  rows: string,
  params: SQLInputValue[]
): { [month: string]: number } {
  return countsByMonth(
    allRows<{ month: string | null; n: number }>(
      db.prepare(`SELECT ${monthSql(start)} AS month, COUNT(*) AS n ${rows} GROUP BY month`),
      ...params
    )
  );
}

/** A project's ancestry, leaf-first: [self, parent, grandparent, ...]. */
export function resolveChain(projects: Map<string, any>, id: string | null): TimingProject[] {
  const chain: TimingProject[] = [];
  const seen = new Set<string>();
  let cur = id;
  while (cur && projects.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const p = projects.get(cur);
    chain.push({ id: p.id, title: p.title });
    cur = p.parentId;
  }
  return chain;
}

function formatMac(buf: Uint8Array): string {
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join(':');
}

function parseBag(value: unknown): { [key: string]: any } {
  if (typeof value !== 'string' || !value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
