import { BaseCommand } from '../baseCommand.js';
import { sourceHelp, helpWidth, type FlagLike, type SourceHelpInput } from '../help/render.js';
import { tokens } from '../output/index.js';
import { defaultKinds } from './recordKinds.js';
import { FlagManager } from './FlagManager.js';
import { strategiesOf, type ExtractorMetadata } from '../plugins/PluginScanner.js';

// Global/base flags (limit, since, loader, etc.) — excluded from the per-source
// flag list so help shows only what's specific to the source.
const BASE_FLAGS = FlagManager.getBaseFlags(BaseCommand.baseFlags) as Record<string, any>;
const BASE_FLAG_KEYS = new Set(Object.keys(BASE_FLAGS));

// The base flags worth showing beside a source's own: scope and output.
const COMMON_FLAG_KEYS = ['type', 'list-types', 'limit', 'since', 'until', 'loader', 'output'];

export interface SourceFlagInfo {
  name: string;
  required: boolean;
  isBoolean: boolean;
  /** A boolean that also takes `--no-<name>`. */
  allowNo?: boolean;
  summary?: string;
  default?: unknown;
  options?: string[];
}

/** The union of every candidate extractor's source-specific (non-base) flags. */
export function sourceFlagInfos(candidates: ExtractorMetadata[]): SourceFlagInfo[] {
  const byName = new Map<string, SourceFlagInfo>();
  for (const c of candidates) {
    const flags = FlagManager.schemaToFlags(c.extractor, 'EXTRACTION', {}) as Record<string, any>;
    for (const [name, def] of Object.entries(flags)) {
      const d = def as any;
      const required = Boolean(d.required);
      // Skip global/base flags (limit, since, loader…) — but keep a base-named
      // flag when a source makes it required (e.g. file sources require --input).
      if ((BASE_FLAG_KEYS.has(name) && !required) || byName.has(name)) continue;
      byName.set(name, {
        name,
        required,
        isBoolean: d.type === 'boolean',
        allowNo: Boolean(d.allowNo),
        summary: d.summary || d.description,
        default: typeof d.default === 'function' ? undefined : d.default,
        options: Array.isArray(d.options) ? d.options : undefined,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A source's record kinds, one per line with the strategies that carry them:
 * `--list-types`, plain so it pipes (`cut -d' ' -f1` gives the kinds).
 */
export function renderRecordTypes(candidates: ExtractorMetadata[]): string {
  const byType = new Map<string, string[]>();
  for (const s of strategiesOf(candidates)) {
    for (const type of s.recordTypes) byType.set(type, [...(byType.get(type) ?? []), s.name]);
  }
  const width = Math.max(0, ...[...byType.keys()].map(type => type.length));
  return [...byType]
    .map(([type, strategies]) => `${type.padEnd(width)}  ${strategies.join(',')}`)
    .join('\n');
}

/**
 * What a run without kinds reads, mirroring ExtractorSelector: the default
 * strategy's (or the only one's) declared default kinds. Undefined when the
 * plugin declares none and the run asks.
 */
function bareRunKinds(candidates: ExtractorMetadata[]): string[] | undefined {
  const strategies = strategiesOf(candidates);
  const chosen = strategies.find(s => s.extractors.some(e => e.default)) ?? strategies[0];
  const kinds = chosen ? defaultKinds(chosen.extractors) : [];
  return kinds.length > 0 ? kinds : undefined;
}

/**
 * How to pick from `--list-types`, as a runnable example: a kind a bare run
 * leaves out when there is one, with `--strategy` only when there is a
 * choice. Printed as a hint on stderr, so the list on stdout still pipes.
 * A source with one kind has nothing to pick, and gets no hint.
 */
export function recordTypesHint(
  source: string,
  candidates: ExtractorMetadata[],
  verb = 'extract'
): { message: string; action: string } | undefined {
  if (new Set(candidates.flatMap(e => e.recordType)).size <= 1) return undefined;
  const strategies = strategiesOf(candidates);
  const chosen = strategies.find(s => s.extractors.some(e => e.default)) ?? strategies[0];
  const strategy = strategies.length > 1 ? ` --strategy ${chosen.name}` : '';
  const bare = bareRunKinds(candidates) ?? [];
  const others = chosen.recordTypes.filter(kind => !bare.includes(kind));
  const kinds = (others.length > 0 ? others : chosen.recordTypes).slice(0, 2).join(' ');
  const bareKinds = bareRunKinds(candidates);
  const all = new Set(candidates.flatMap(e => e.recordType));
  const opening = bareKinds
    ? bareKinds.length === all.size
      ? 'The default is all of them.'
      : `The default is ${bareKinds.join(', ')}.`
    : "There's no default; you'll be asked.";
  return {
    message: `${opening} To pick others: \`chronicle ${verb} ${source}${strategy} ${kinds}\``,
    action: '',
  };
}

/** What a verb shows beside a source's own flags, when it isn't extract's. */
export interface VerbHelp {
  /** The verb's flags worth showing beside the source's, by name. */
  common: string[];
  /** Where those flags are defined. */
  flags: Record<string, any>;
  /** The kinds a run of the verb reads when it names none. */
  defaults?: 'all';
}

/** A source's help, as data: its strategies, its flags and the common ones, its defaults. */
export function describeSource(
  source: string,
  candidates: ExtractorMetadata[],
  verb = 'extract',
  help?: VerbHelp
): SourceHelpInput {
  const kinds = bareRunKinds(candidates);
  const commonFlags = help?.flags ?? BASE_FLAGS;
  const all = new Set(candidates.flatMap(e => e.recordType));
  return {
    source,
    verb,
    strategies: strategiesOf(candidates).map(s => ({
      name: s.name,
      delivery: s.delivery,
      default: s.extractors.some(e => e.default),
      recordTypes: s.recordTypes,
    })),
    flags: sourceFlagInfos(candidates).map(f => ({
      name: f.name,
      type: f.isBoolean ? 'boolean' : 'option',
      summary: f.summary,
      default: f.default,
      options: f.options,
      required: f.required,
      allowNo: f.allowNo,
    })),
    common: (help?.common ?? COMMON_FLAG_KEYS)
      .filter(name => commonFlags[name])
      .map(name => ({ ...commonFlags[name], name }) as FlagLike),
    defaults: help?.defaults ?? (kinds && kinds.length === all.size ? 'all' : kinds),
  };
}

/**
 * A source's help: its strategies and record types, and the flags they take.
 * Shared by the help class (`extract <source> --help`) and the dispatcher, so
 * the two never drift.
 */
export function renderSourceHelp(
  source: string,
  candidates: ExtractorMetadata[],
  opts: { verb?: string; theme?: string; help?: VerbHelp } = {}
): string {
  return sourceHelp(
    describeSource(source, candidates, opts.verb || 'extract', opts.help),
    tokens({ stream: 'stdout', theme: opts.theme }),
    helpWidth()
  );
}
