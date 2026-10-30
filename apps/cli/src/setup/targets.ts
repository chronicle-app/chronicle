import { createHash } from 'node:crypto';
import path from 'node:path';
import { toCamelCase, toKebabCase } from '@chronicle.app/etl';
import { CredentialManager, OAuthProviderRegistry } from '@chronicle.app/auth';
import type { Target } from '../config/index.js';
import type { SourceListing } from '../plugins/catalog.js';
import type { ExtractorMetadata } from '../plugins/PluginScanner.js';
import { check, shellWord, type ScanRow } from '../plugins/scan.js';
import { checkInZip, surveyWith } from '../plugins/survey.js';
import { ExtractorSelector } from '../utils/ExtractorSelector.js';
import { FlagManager } from '../utils/FlagManager.js';
import { allKinds, defaultKinds } from '../utils/recordKinds.js';

export type { Target } from '../config/index.js';

/**
 * What stands in a target's way this run, worked out again each time:
 * nothing (`ready`), or the first thing to fix.
 */
export type TargetState =
  | 'ready'
  | 'plugin'
  | 'full-disk-access'
  | 'sign-in'
  | 'missing'
  | 'empty'
  | 'unreadable'
  | 'unsupported'
  | 'flags';

export interface Checked {
  state: TargetState;
  /** What's wrong with its flags, for `flags`. */
  problem?: string;
}

/** The flags only a run sets. A target never keeps them. */
const RUN_FLAGS = new Set(['since', 'until', 'limit', 'loader', 'output']);

/** Flags sorted by name, and lists sorted, so two targets that read the same compare equal. */
function canonical(flags: Target['flags']): [string, unknown][] {
  return Object.keys(flags)
    .sort()
    .map(key => {
      const value = flags[key];
      return [key, Array.isArray(value) ? [...value].sort() : value];
    });
}

/** Two targets are one when their source and flags match. Two Takeouts are two targets. */
export const targetKey = (target: Target) =>
  JSON.stringify([target.source, canonical(target.flags)]);

/**
 * A target that reads what a scan found: its strategy, always, its options
 * that differ from the defaults, and its record types.
 */
export function targetFor(row: ScanRow, kinds: string[]): Target {
  const options = Object.fromEntries(
    Object.entries(row.config).filter(([key, value]) => value !== undefined && !RUN_FLAGS.has(key))
  );
  return { source: row.source, flags: { strategy: row.strategy, ...options, type: kinds } };
}

/** Whether a target reads what a row found, though the target's kinds may differ. */
export function reads(target: Target, row: ScanRow): boolean {
  const { type: _type, ...flags } = target.flags;
  const { type: _rowType, ...found } = targetFor(row, []).flags;
  return (
    targetKey({ source: target.source, flags }) === targetKey({ source: row.source, flags: found })
  );
}

/**
 * The kinds a target for a row reads: those the export holds, those its
 * options ask for, or the plugin's defaults. None when a person has to pick.
 */
export function kindsFor(row: ScanRow, extractors: ExtractorMetadata[]): string[] {
  if (row.recordTypes?.length) return row.recordTypes;
  const pool = extractors.filter(e => e.strategy === row.strategy);
  const asked = new Set(
    [...new Set(pool.map(e => e.extractor as any))].flatMap(e => e.kindsFor?.(row.config) ?? [])
  );
  const options = allKinds(pool).filter(kind => asked.has(kind));
  return options.length > 0 ? options : defaultKinds(pool);
}

/**
 * The file a target's records go in, without its extension: its source, and
 * when another target has the same source, a short hash of its flags.
 */
export function targetName(target: Target, all: Target[]): string {
  const shared = all.some(other => other.source === target.source && other !== target);
  if (!shared) return target.source;
  const hash = createHash('sha256').update(targetKey(target)).digest('hex').slice(0, 6);
  return `${target.source}-${hash}`;
}

/**
 * How a person tells a target from others of its source: the source, and
 * then what it reads, like its input or a profile. The one that reads where
 * its source keeps it is just the source.
 */
export function targetLabel(target: Target, all: Target[]): string {
  if (!all.some(other => other.source === target.source && other !== target)) return target.source;
  const { strategy: _strategy, type: _type, input, ...rest } = target.flags;
  // A file by its folder too, since a copy often keeps the name its app gave it.
  const what =
    typeof input === 'string'
      ? path.join(path.basename(path.dirname(input)), path.basename(input))
      : Object.values(rest).map(String).join(' ');
  return what ? `${target.source} ${what}` : target.source;
}

/** The words after `chronicle extract` that run a target: its source, then its flags. */
export function targetArgs(target: Target): string[] {
  const words = [target.source];
  for (const [key, value] of Object.entries(target.flags)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      words.push(`--${toKebabCase(key)}`, value.join(','));
    } else if (typeof value === 'boolean') {
      words.push(`--${value ? '' : 'no-'}${toKebabCase(key)}`);
    } else {
      words.push(`--${toKebabCase(key)}`, String(value));
    }
  }
  return words;
}

/** A command that runs `args`, as a person types it. */
export function commandLine(args: string[], home: string): string {
  return ['chronicle', ...args.map(word => shellWord(word, home))].join(' ');
}

/**
 * What's wrong with a target's flags against its source today, or nothing.
 * A plugin that renamed a flag makes a target to fix, not a failed run.
 */
export function flagProblem(
  target: Target,
  listing: SourceListing | undefined,
  extractors: ExtractorMetadata[]
): string | undefined {
  const { source, flags } = target;
  if (!listing) return `No source named "${source}"`;
  const { strategy, type, ...options } = flags;
  if (!listing.strategies.some(s => s.name === strategy)) {
    return `${source} has no "${String(strategy)}" strategy`;
  }
  if (!Array.isArray(type) || type.length === 0) return 'No record types given';
  // Its options can only be checked against an installed plugin.
  const pool = extractors.filter(e => e.strategy === strategy);
  if (pool.length === 0) return undefined;
  // Its extractors' options, and those every run takes, like `--input`.
  const known = new Set([
    ...pool.flatMap(e => Object.keys((e.extractor as any).schema?.shape ?? {})),
    ...Object.keys(FlagManager.getBaseFlags({})).map(flag => toCamelCase(flag)),
  ]);
  const unknown = Object.keys(options).find(key => !known.has(key));
  if (unknown) return `Unknown flag --${toKebabCase(unknown)}`;
  const kinds = allKinds(pool);
  const missing = type.find((kind: string) => !kinds.includes(kind));
  if (missing) return `${source} has no record type "${missing}"`;
  return undefined;
}

/**
 * API sources that sign in with another's sign-in, and the access each needs
 * from it, as `chronicle auth login --add` names it: Google's share one.
 */
const SHARED: Record<string, { provider: string; access: string }> = {
  gmail: { provider: 'google', access: 'gmail' },
  'google-calendar': { provider: 'google', access: 'calendar' },
  youtube: { provider: 'google', access: 'youtube' },
};

/** The provider an API source signs in with, by `chronicle auth login`. */
export const providerFor = (source: string) => SHARED[source]?.provider ?? source;

/** The access an API source needs from its provider's sign-in, like `youtube` from Google's. */
export const accessFor = (source: string) => SHARED[source]?.access;

/**
 * Whether an API source's sign-in is stored, with the access it needs: a
 * Google sign-in for Gmail alone can't read YouTube. One whose access can't
 * be told, like a token stored with `chronicle auth set`, counts.
 */
export async function signedInTo(source: string): Promise<boolean> {
  const stored = await CredentialManager.getAllCredentials(providerFor(source));
  const access = accessFor(source);
  const Provider = access ? await providerClass(providerFor(source)) : undefined;
  if (!access || !Provider) return stored.length > 0;
  return stored.some(
    entry => entry.scope === undefined || Provider.scopeSetsIn(entry.scope).includes(access)
  );
}

/** Loading the plugins, which register their providers: once a run. */
let loading: Promise<unknown> | undefined;

/** A sign-in provider, by its ID, once the plugins have registered theirs. */
async function providerClass(provider: string) {
  if (!OAuthProviderRegistry.has(provider)) {
    const { OAuthCommand } = await import('../auth/OAuthCommand.js');
    await (loading ??= OAuthCommand.listProviders());
  }
  return OAuthProviderRegistry.get(provider);
}

/** Whether a strategy reads over the network. */
export const isOnline = (listing: SourceListing | undefined, strategy: unknown) =>
  listing?.strategies.find(s => s.name === strategy)?.delivery === 'api';

/**
 * What stands in a target's way now: its flags, its plugin, then what it
 * reads. A scan row that reads the same says; otherwise its input is
 * checked, or for an API source, a stored sign-in.
 */
export async function checkTarget(
  target: Target,
  listing: SourceListing | undefined,
  extractors: ExtractorMetadata[],
  rows: ScanRow[]
): Promise<Checked> {
  const problem = flagProblem(target, listing, extractors);
  if (problem) return { state: 'flags', problem };
  if (!listing!.installed) return { state: 'plugin' };
  const row = rows.find(r => reads(target, r));
  if (row) return { state: stateOf(row.status) };
  const { input } = target.flags;
  if (typeof input === 'string') {
    try {
      const checked = (await check(input, process.platform)) ?? (await checkInZip(input));
      return { state: checked ? stateOf(checked.status) : 'missing' };
    } catch {
      return { state: 'unreadable' };
    }
  }
  if (isOnline(listing, target.flags.strategy)) {
    return { state: (await signedInTo(target.source)) ? 'ready' : 'sign-in' };
  }
  return { state: 'missing' };
}

function stateOf(status: ScanRow['status']): TargetState {
  switch (status) {
    case 'blocked':
      return 'full-disk-access';
    case 'signed-out':
      return 'sign-in';
    default:
      return status;
  }
}

/** A state as a list says it: `needs Full Disk Access`. */
export function stateText(checked: Checked, exported: boolean): string {
  switch (checked.state) {
    case 'ready':
      return 'ready';
    case 'plugin':
      return 'plugin not installed';
    case 'full-disk-access':
      return 'needs Full Disk Access';
    case 'sign-in':
      return 'needs sign-in';
    case 'missing':
      return exported ? 'export not found' : 'not found on this Mac';
    case 'empty':
      return 'empty';
    case 'unsupported':
      return 'version not supported';
    case 'flags':
      return checked.problem!;
    default:
      return "can't read";
  }
}

/**
 * How many records a target's run would extract from `since` on, by its
 * survey: null for a source read over the network, or one that can't say.
 */
export async function surveyTarget(
  target: Target,
  extractors: ExtractorMetadata[],
  since: Date
): Promise<number | null> {
  const { strategy, type, ...options } = target.flags;
  const pool = extractors.filter(e => e.strategy === strategy);
  if (pool.length === 0 || pool.some(e => e.delivery === 'api')) return null;
  const Selected = await new ExtractorSelector({
    source: target.source,
    candidates: extractors,
    strategy: String(strategy),
    types: type,
    config: options,
    interactive: false,
  }).select();
  const survey = await surveyWith(Selected, { ...options, since });
  if (!survey) return null;
  return (type as string[]).reduce((sum, kind) => sum + (survey[kind]?.count ?? 0), 0);
}
