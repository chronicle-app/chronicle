import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open, readdir, stat } from 'node:fs/promises';
import {
  findExports,
  isSqlite,
  matchSchema,
  readColumns,
  segmentPattern,
  toKebabCase,
  type Candidate,
  type CandidateStatus,
  type DatabaseSchema,
  type FileFormat,
  type FoundExport,
  type LayoutMatch,
  type LocateContext,
  type Location,
  type LocationMatch,
  type Refused,
} from '@chronicle.app/etl';
import { createLogger } from '@chronicle.app/logging';
import { listSources, type SourceListing } from './catalog.js';
import { PluginScanner, locatorKey, type ExtractorMetadata } from './PluginScanner.js';
import { FlagManager } from '../utils/FlagManager.js';

const logger = createLogger({ scope: 'scan' });

/** One candidate as `scan` lists it. */
export interface ScanRow {
  source: string;
  strategy: string;
  /** What was found: the locator's name for it, else its path from the home folder. */
  label: string;
  status: CandidateStatus;
  installed: boolean;
  /** The catalog name `chronicle plugins install` takes. */
  plugin: string;
  config: { [option: string]: unknown };
  /** The run, as a command that works when typed. */
  command: string;
  remedy?: string;
  /** For an export in a path: where it starts, which the run takes as its input. */
  root?: string;
  /** The name of the export's layout, when its plugin gives it one. */
  layout?: string;
  /** For a file: the record types it holds, when it doesn't hold them all. */
  recordTypes?: string[];
  /** How many zips a split Takeout came in. */
  parts?: number;
  /** The installed plugin's version, so a count can say which plugin made it. */
  pluginVersion?: string;
  /** For what a path scan found: true for an app's database, found by its schema, not an export. */
  database?: boolean;
  evidence: {
    path?: string;
    modifiedAt?: string;
    bytes?: number;
    credential?: string;
    /** For an export in a path: the files its layout matched, from where it starts. */
    files?: string[];
    /** What a run needs that isn't there, when it can't read what was found. */
    unmet?: string[];
  };
}

export interface ScanResult {
  rows: ScanRow[];
  /** The locations each source declares on this platform, from the home folder. */
  looked: Map<string, string[]>;
  /** The installed extractors, by source, for surveying a row. */
  extractors: Map<string, ExtractorMetadata[]>;
}

/** A path with the home folder as `~`, the way a person types it. */
export function fromHome(file: string, home: string): string {
  if (file === home) return '~';
  return file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}

function resolveHome(pattern: string, home: string): string {
  if (pattern === '~') return home;
  return pattern.startsWith('~/') ? path.join(home, pattern.slice(2)) : pattern;
}

/**
 * What an error opening or listing a path says about it: refused by macOS,
 * refused by its permissions, or not there (null).
 */
function refusal(error: unknown, platform: NodeJS.Platform): CandidateStatus | null {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EPERM' && platform === 'darwin') return 'blocked';
  if (code === 'EPERM' || code === 'EACCES') return 'unreadable';
  return null;
}

type Hit = LocationMatch | (LocationMatch & { refused: CandidateStatus });

/**
 * Every path a location matches, walked a segment at a time. A match that
 * refuses to open is still a match, which its locator names and the check
 * marks. A folder that refuses to be listed is a hit of its own, with what
 * it bound so far: something may be inside, and the person can let the
 * terminal look.
 */
async function matchLocation(location: Location, context: LocateContext): Promise<Hit[]> {
  const absolute = resolveHome(location.path, context.home);
  const [root, ...segments] = absolute.split('/');
  let partial: LocationMatch[] = [{ path: root || '/', options: { ...location.options } }];
  const hits: Hit[] = [];
  for (const segment of segments) {
    if (!/[*{]/.test(segment)) {
      partial = partial.map(p => ({ ...p, path: path.join(p.path, segment) }));
      continue;
    }
    const pattern = segmentPattern(segment);
    const next: LocationMatch[] = [];
    for (const p of partial) {
      let names: string[];
      try {
        names = await readdir(p.path);
      } catch (error) {
        const refused = refusal(error, context.platform);
        if (refused) hits.push({ ...p, refused });
        continue;
      }
      for (const name of names.sort()) {
        const match = pattern.exec(name);
        if (match) {
          next.push({ path: path.join(p.path, name), options: { ...p.options, ...match.groups } });
        }
      }
    }
    partial = next;
  }
  for (const p of partial) {
    try {
      await stat(p.path);
      hits.push(p);
    } catch (error) {
      if (refusal(error, context.platform)) hits.push(p);
    }
  }
  return hits;
}

/** Whether a run could read `file` now, from opening it, without reading any of it. */
export async function check(
  file: string,
  platform: NodeJS.Platform
): Promise<{ status: CandidateStatus; modifiedAt?: Date; bytes?: number } | null> {
  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      const names = await readdir(file);
      return { status: names.length > 0 ? 'ready' : 'empty', modifiedAt: info.mtime };
    }
    await (await open(file, 'r')).close();
    return { status: info.size > 0 ? 'ready' : 'empty', modifiedAt: info.mtime, bytes: info.size };
  } catch (error) {
    const refused = refusal(error, platform);
    return refused ? { status: refused } : null;
  }
}

/**
 * Whether a database is in a schema its reader reads, from its tables and
 * columns, read without writing beside it. One in none of them can't be read.
 */
async function checkSchema(
  file: string,
  schemas: DatabaseSchema[]
): Promise<{ status: CandidateStatus; unmet?: string[] }> {
  if (!(await isSqlite(file))) return { status: 'unreadable' };
  let match;
  try {
    match = matchSchema(readColumns(file), schemas);
  } catch {
    return { status: 'unreadable' };
  }
  if (!match) return { status: 'unreadable' };
  if (match.missing.length > 0) return { status: 'unsupported', unmet: match.missing };
  return { status: match.schema.supported === false ? 'unsupported' : 'ready' };
}

/**
 * A database's schema as a file format: its tables say whose it is, and the
 * columns its reader needs say whether a run can read it. A walk opens a
 * file named as the database is where it lives.
 */
function databaseFormat(schema: DatabaseSchema, locations: Location[]): FileFormat {
  const columns = Object.fromEntries(
    Object.entries(schema.tables).map(([table, wanted]) => [
      table,
      wanted.filter(column => !column.endsWith('?')),
    ])
  );
  return {
    names: locations.map(location => path.basename(location.path)),
    match: [{ sqlite: { tables: Object.keys(schema.tables) } }],
    requires: [{ sqlite: { columns } }],
    ...(schema.name && { name: schema.name }),
    ...(schema.supported === false && { supported: false }),
  };
}

/** A word for the shell: bare when it needs no quoting, else in double quotes. */
export function shellWord(value: string, home: string): string {
  const short = fromHome(value, home);
  if (/^[\w@%+=:,./~-]+$/.test(short)) return short;
  return `"${value.replaceAll(/["\\$`]/g, String.raw`\$&`)}"`;
}

/** A date as a flag takes it: the day alone at midnight UTC, else the instant. */
function dateWord(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/** The `chronicle extract` command for a candidate, its kinds and options as flags. */
export function commandFor(
  listing: SourceListing,
  strategy: string,
  config: { [option: string]: unknown },
  home: string,
  kinds: string[] = []
): string {
  const words = ['chronicle', 'extract', listing.source, ...kinds];
  const isDefault = listing.strategies.find(s => s.name === strategy)?.default;
  if (listing.strategies.length > 1 && !isDefault) words.push('--strategy', strategy);
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue;
    if (typeof value === 'boolean') {
      words.push(`--${value ? '' : 'no-'}${toKebabCase(key)}`);
    } else {
      const word = value instanceof Date ? dateWord(value) : shellWord(String(value), home);
      words.push(`--${toKebabCase(key)}`, word);
    }
  }
  return words.join(' ');
}

/** How sure a row is, best first, for sorting: ready, then what stands in the way. */
const RANK: Record<CandidateStatus, number> = {
  ready: 0,
  blocked: 2,
  'signed-out': 3,
  empty: 4,
  unreadable: 5,
  unsupported: 6,
};
const rankOf = (row: ScanRow) => (row.status === 'ready' && !row.installed ? 1 : RANK[row.status]);

/** A candidate's options, less those its strategy's extractor already takes by default. */
export function withoutDefaults(
  config: { [option: string]: unknown },
  extractors: ExtractorMetadata[]
): { [option: string]: unknown } {
  const shape: { [field: string]: any } | undefined = (
    extractors.find(e => e.default) ?? extractors[0]
  )?.extractor.schema?.shape;
  if (!shape) return config;
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) => !shape[key] || FlagManager.getDefault(shape[key]._def) !== value
    )
  );
}

async function collect<T>(items: AsyncIterable<T>): Promise<T[]> {
  const all: T[] = [];
  for await (const item of items) all.push(item);
  return all;
}

/**
 * The candidates for one strategy: its declared locations matched, then
 * refined by its locator when the plugin is installed and has one.
 */
async function scanStrategy(
  listing: SourceListing,
  strategy: SourceListing['strategies'][number],
  locators: Map<string, any>,
  extractors: ExtractorMetadata[],
  context: LocateContext
): Promise<ScanRow[]> {
  const locations = (strategy.locations ?? []).filter(
    l => !l.platforms || l.platforms.includes(context.platform)
  );
  const LocatorClass = listing.installed
    ? locators.get(locatorKey(listing.source, strategy.name))
    : undefined;
  if (locations.length === 0 && !LocatorClass) return [];

  const hits = (await Promise.all(locations.map(l => matchLocation(l, context)))).flat();
  const matches = hits.filter((h): h is LocationMatch => !('refused' in h));
  let candidates: Candidate[] = matches.map(m => ({ config: m.options, path: m.path }));
  if (LocatorClass) {
    try {
      candidates = await collect(new LocatorClass(context).locate(matches));
    } catch (error) {
      logger.warn(`Couldn't finish looking for ${listing.source}`, { error: String(error) });
    }
  }
  for (const hit of hits) {
    if ('refused' in hit) {
      candidates.push({ config: hit.options, path: hit.path, status: hit.refused });
    }
  }

  const rows: ScanRow[] = [];
  for (const candidate of candidates) {
    const checked = candidate.status
      ? { status: candidate.status }
      : candidate.path
        ? await check(candidate.path, context.platform)
        : null;
    if (!checked) continue;
    const { modifiedAt, bytes } = checked as { modifiedAt?: Date; bytes?: number };
    // A database is ready only when its reader reads its schema, as a run checks.
    const schema =
      checked.status === 'ready' && candidate.path && strategy.databases?.length
        ? await checkSchema(candidate.path, strategy.databases)
        : null;
    const config = withoutDefaults(candidate.config, extractors);
    rows.push({
      source: listing.source,
      strategy: strategy.name,
      label:
        candidate.label ??
        (candidate.path ? fromHome(candidate.path, context.home) : strategy.name),
      status: schema?.status ?? checked.status,
      installed: listing.installed,
      plugin: listing.plugin,
      config,
      command: commandFor(listing, strategy.name, config, context.home),
      ...(candidate.remedy && { remedy: candidate.remedy }),
      ...(listing.version && { pluginVersion: listing.version }),
      evidence: {
        ...(candidate.path && { path: candidate.path }),
        ...(modifiedAt && { modifiedAt: modifiedAt.toISOString() }),
        ...(bytes !== undefined && { bytes }),
        ...(candidate.credential && { credential: candidate.credential }),
        ...(schema?.unmet && { unmet: schema.unmet }),
      },
    });
  }
  return rows;
}

/** A source a scan has looked for: what it found, and how many sources it has looked for of all. */
export interface ScanProgress {
  source: string;
  rows: ScanRow[];
  done: number;
  total: number;
}

/**
 * Look for each source's material on this computer, or one source's, or
 * those in `sources`. Only opens what it finds to check it can be read,
 * and reads none of it. `onSource` hears of each source as it's looked for.
 */
export async function scan(
  options: {
    source?: string;
    sources?: string[];
    onSource?: (progress: ScanProgress) => void;
  } = {}
): Promise<ScanResult> {
  const context: LocateContext = {
    home: os.homedir(),
    platform: process.platform,
    env: process.env,
  };
  const scanned = (await listSources()).filter(
    l =>
      l.supported &&
      (!options.source || l.source === options.source) &&
      (!options.sources || options.sources.includes(l.source))
  );
  const locators = await PluginScanner.scanAllLocators();
  const extractors = await PluginScanner.scanAllPlugins();
  const looked = new Map<string, string[]>();
  for (const listing of scanned) {
    looked.set(
      listing.source,
      listing.strategies
        .flatMap(s => s.locations ?? [])
        .filter(l => !l.platforms || l.platforms.includes(context.platform))
        .map(l => l.path)
    );
  }
  let done = 0;
  const rows = (
    await Promise.all(
      scanned.map(async listing => {
        const found = (
          await Promise.all(
            listing.strategies.map(strategy =>
              scanStrategy(
                listing,
                strategy,
                locators,
                (extractors.get(listing.source) ?? []).filter(e => e.strategy === strategy.name),
                context
              )
            )
          )
        ).flat();
        options.onSource?.({
          source: listing.source,
          rows: found,
          done: ++done,
          total: scanned.length,
        });
        return found;
      })
    )
  ).flat();
  rows.sort(byRank);
  return { rows, looked, extractors };
}

/** Rows best first, then by source and what was found. */
const byRank = (a: ScanRow, b: ScanRow) =>
  rankOf(a) - rankOf(b) || a.source.localeCompare(b.source) || a.label.localeCompare(b.label);

/**
 * Whether a word names a path rather than a source: it has a `/`, starts
 * with `~` or `.`, or is a zip. A source's name is none of those.
 */
export function isPathArgument(word: string): boolean {
  return (
    word.includes('/') ||
    word.includes(path.sep) ||
    word.startsWith('~') ||
    word.startsWith('.') ||
    word.toLowerCase().endsWith('.zip')
  );
}

export interface PathScanResult {
  rows: ScanRow[];
  /** The path looked in, absolute. */
  scanned: string;
  /** Whether it's a folder, rather than a zip or another file. */
  folder: boolean;
  /** The folders and zips directly in the path that hold no export. */
  unrecognized: string[];
  /** What couldn't be looked in, and why. */
  refused: Refused[];
  /** How many folders were looked in. */
  looked: number;
  /** The installed extractors, by source, for surveying a row. */
  extractors: Map<string, ExtractorMetadata[]>;
}

/**
 * Where an export is, from the path looked in: a folder with a `/`, then a
 * split Takeout's parts and the layout's name when it has one. An export
 * the path is in, or is, goes by its own name.
 */
function exportLabel(exported: FoundExport, match: LayoutMatch, scanned: string): string {
  // A folder on disk, rather than a zip, a folder in one, or a database.
  let folder = false;
  try {
    folder = statSync(exported.root).isDirectory();
  } catch {
    // Not on disk. A folder in a zip is ENOTDIR, which older Node 22s throw
    // even with throwIfNoEntry false.
  }
  const base = scanned.toLowerCase().endsWith('.zip') ? path.dirname(scanned) : scanned;
  const relative = path.relative(base, exported.root);
  const where = !relative || relative.startsWith('..') ? path.basename(exported.root) : relative;
  const notes = [
    exported.parts && `${exported.parts.length} parts`,
    match.name,
    match.recordTypes?.join(', '),
  ].filter(Boolean);
  return `${where}${folder ? '/' : ''}${notes.length > 0 ? ` (${notes.join(', ')})` : ''}`;
}

/**
 * The exports in a folder or zip, or the one a path is in, found by each
 * source's layouts: one row for each source that reads each export, with
 * the command that extracts it. Matching the layouts takes no plugin code,
 * so an export is found before its plugin is installed. It reads no file.
 */
export async function scanPath(
  target: string,
  options: { onFolder?: (looked: number) => void } = {}
): Promise<PathScanResult> {
  const home = os.homedir();
  const scanned = path.resolve(resolveHome(target, home));
  const listings = (await listSources()).filter(l => l.supported);
  // The formats that are an app's database, to tell what they find from an export.
  const databases = new Set<FileFormat>();
  const sets = listings.flatMap(listing =>
    listing.strategies
      .filter(
        strategy => strategy.layouts?.length || strategy.files?.length || strategy.databases?.length
      )
      .map(strategy => ({
        source: listing.source,
        strategy: strategy.name,
        layouts: strategy.layouts ?? [],
        files: [
          ...(strategy.files ?? []),
          // A copy of a database keeps the name its app gave it.
          ...(strategy.databases ?? []).map(schema => {
            const format = databaseFormat(schema, strategy.locations ?? []);
            databases.add(format);
            return format;
          }),
        ],
      }))
  );
  const found = await findExports(scanned, sets, { onFolder: options.onFolder });
  const folder = (await stat(scanned)).isDirectory();
  const extractors = await PluginScanner.scanAllPlugins();
  const rows: ScanRow[] = [];
  for (const exported of found.exports) {
    for (const match of exported.matches) {
      const listing = listings.find(l => l.source === match.source)!;
      const pool = (extractors.get(listing.source) ?? []).filter(
        e => e.strategy === match.strategy
      );
      const config = withoutDefaults({ ...match.options, input: exported.root }, pool);
      rows.push({
        source: listing.source,
        strategy: match.strategy,
        label: exportLabel(exported, match, scanned),
        status: match.layout.supported === false || match.unmet ? 'unsupported' : 'ready',
        installed: listing.installed,
        plugin: listing.plugin,
        config,
        command: commandFor(listing, match.strategy, config, home, match.recordTypes),
        root: exported.root,
        ...(match.name && { layout: match.name }),
        ...(match.recordTypes && { recordTypes: match.recordTypes }),
        ...(exported.parts && { parts: exported.parts.length }),
        ...(listing.version && { pluginVersion: listing.version }),
        ...(databases.has(match.layout as FileFormat) && { database: true }),
        evidence: {
          path: exported.root,
          files: match.files,
          ...(match.unmet && { unmet: match.unmet }),
        },
      });
    }
  }
  rows.sort(byRank);
  return {
    rows,
    scanned,
    folder,
    unrecognized: found.unrecognized,
    refused: found.refused,
    looked: found.looked,
    extractors,
  };
}
