import { BaseCommand } from '../baseCommand.js';
import { getTheme } from '../theme.js';
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
        summary: d.summary || d.description,
        default: typeof d.default === 'function' ? undefined : d.default,
        options: Array.isArray(d.options) ? d.options : undefined,
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What a strategy needs from the person running it, for the help line. */
function needsNote(delivery: string): string {
  if (delivery === 'export') return 'export, needs --input';
  if (delivery === 'api') return 'live, needs auth';
  if (delivery === 'local') return 'live, reads in place';
  return delivery;
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
 * What a run without `--type` reads, mirroring ExtractorSelector: the only
 * extractor, else the declared default. Undefined when the run would ask.
 */
function bareRunKinds(candidates: ExtractorMetadata[]): string[] | undefined {
  const chosen = candidates.length === 1 ? candidates[0] : candidates.find(e => e.default);
  return chosen?.recordType;
}

/** What a run without `--type` reads: `only submissions`, `every kind`, or undefined when it asks. */
function bareRunSummary(candidates: ExtractorMetadata[]): string | undefined {
  const kinds = bareRunKinds(candidates);
  if (!kinds) return undefined;
  const all = new Set(candidates.flatMap(e => e.recordType));
  return kinds.length === all.size ? 'every kind' : `only ${kinds.join(', ')}`;
}

/**
 * How to pick from `--list-types`, as a runnable example: kinds a bare run
 * leaves out when there are some, with `--strategy` only when there is a
 * choice. Printed as a hint on stderr, so the list on stdout still pipes.
 */
export function recordTypesHint(
  source: string,
  candidates: ExtractorMetadata[],
  verb = 'extract'
): { message: string; action: string } {
  const strategies = strategiesOf(candidates);
  const chosen = strategies.find(s => s.extractors.some(e => e.default)) ?? strategies[0];
  const strategy = strategies.length > 1 ? ` --strategy ${chosen.name}` : '';
  const bare = bareRunKinds(candidates) ?? [];
  const others = chosen.recordTypes.filter(kind => !bare.includes(kind));
  // One kind: two kinds read by separate extractors can't run together.
  const kinds = (others.length > 0 ? others : chosen.recordTypes)[0];
  return {
    message: `pick kinds with --type; without it, ${bareRunSummary(candidates) ?? 'you’re asked which'}`,
    action: `\`chronicle ${verb} ${source}${strategy} --type ${kinds}\``,
  };
}

/**
 * Render a source as strategies × record kinds, plus the flags they accept. Shared
 * by the custom Help class (`extract <source> --help`) and the dispatcher's
 * `--list-types` / non-TTY selection error, so the surfaces never drift.
 */
export function renderSourceHelp(
  source: string,
  candidates: ExtractorMetadata[],
  opts: { verb?: string; theme?: string } = {}
): string {
  const theme = getTheme(opts.theme);
  const verb = opts.verb || 'extract';
  const lines: string[] = [];
  const strategies = strategiesOf(candidates);

  lines.push(theme.textBold(source), '', theme.textDim('strategies:'));
  for (const s of strategies) {
    const def = s.extractors.some(e => e.default) ? theme.success(' (default)') : '';
    lines.push(
      `  ${theme.text(s.name.padEnd(12))} ${theme.textDim(`${needsNote(s.delivery)}`)}${def}`,
      `  ${' '.repeat(12)} ${theme.textDim(`types: ${s.recordTypes.join(', ')}`)}`
    );
  }

  const flags = sourceFlagInfos(candidates);
  if (flags.length > 0) {
    lines.push('', theme.textDim('flags:'));
    for (const f of flags) {
      const value = f.isBoolean ? '' : f.options ? ` <${f.options.join('|')}>` : ' <value>';
      const meta: string[] = [];
      if (f.required) meta.push(theme.warning('required'));
      if (f.default !== undefined && f.default !== '' && f.default !== false) {
        meta.push(theme.textDim(`default: ${String(f.default)}`));
      }
      const metaStr = meta.length > 0 ? `  ${meta.join('  ')}` : '';
      const summary = f.summary ? `\n      ${theme.textDim(f.summary)}` : '';
      lines.push(`  ${theme.text(`--${f.name}${value}`)}${metaStr}${summary}`);
    }
  }

  lines.push('', theme.textDim('common flags:'));
  for (const name of COMMON_FLAG_KEYS) {
    const f = BASE_FLAGS[name];
    if (!f) continue;
    const value =
      f.type === 'boolean'
        ? ''
        : f.options
          ? ` <${f.options.join('|')}>`
          : ` ${f.helpValue ?? '<value>'}`;
    const short = f.char ? `-${f.char}, ` : '';
    const def =
      f.default !== undefined && typeof f.default !== 'function'
        ? `  ${theme.textDim(`default: ${String(f.default)}`)}`
        : '';
    lines.push(
      `  ${theme.text(`${short}--${name}${value}`)}${def}`,
      `      ${theme.textDim(f.summary)}`
    );
  }

  lines.push(
    '',
    theme.textDim('usage:'),
    `  chronicle ${verb} ${source} [--strategy <name>] [--type <kind[,kind]>] [flags]`,
    theme.textDim(
      `  no --type reads ${bareRunSummary(candidates) ?? 'the kinds you pick when asked'}`
    )
  );
  return lines.join('\n');
}
