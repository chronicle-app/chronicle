import { EXIT_CODES, ExtractorError } from '@chronicle.app/logging';
import { inkSelect } from '../components/InkSelect.js';
import { closest } from './closest.js';
import { canMerge, combineExtractors } from './combineExtractors.js';
import { ALL_KINDS, DEFAULT_KINDS, allKinds, defaultKinds, expandKinds } from './recordKinds.js';
import {
  strategiesOf,
  type ExtractorMetadata,
  type StrategyInfo,
} from '../plugins/PluginScanner.js';

export interface SelectionInput {
  /** The source being run, for error messages. */
  source: string;
  /** Every extractor discovered for the source. */
  candidates: ExtractorMetadata[];
  /** `--strategy`: the named strategy. */
  strategy?: string;
  /** `--type`: the record kinds asked for. */
  types?: string[];
  /** `--input`: a path, which points at an export when the source has one. */
  input?: string;
  /** Whether the source has stored credentials — decides the live strategy. */
  hasCredentials?: boolean;
  /** Interactive selection is possible (a TTY for Ink's raw mode). */
  interactive?: boolean;
  theme?: string;
}

/**
 * Resolve a run to one extractor across the two axes: `--strategy` (how the
 * source is read) and `--type` (record kinds, the same vocabulary on every
 * strategy).
 *
 * The strategy resolves first — explicit `--strategy`, else the export a path
 * implies, else the live API when credentials exist, else the source's declared
 * default. Only then does `--type` choose among the extractors on that strategy, preferring
 * the one that emits least of what wasn't asked for; whatever surplus remains is
 * the Runner's post-yield filter to drop.
 */
export class ExtractorSelector {
  constructor(private readonly input: SelectionInput) {}

  async select(): Promise<any> {
    const pool = await this.resolveStrategy();
    return this.resolveExtractor(pool);
  }

  /** The strategies a source offers, in declaration order. */
  private strategies(candidates = this.input.candidates): StrategyInfo[] {
    return strategiesOf(candidates);
  }

  private async resolveStrategy(): Promise<ExtractorMetadata[]> {
    const { candidates, strategy, input, hasCredentials } = this.input;
    const strategies = this.strategies();

    if (strategy) {
      const chosen = strategies.find(s => s.name === strategy);
      if (!chosen) {
        throw new Error(
          `${this.input.source} has no "${strategy}" strategy. ${this.strategiesSentence(strategies)}`
        );
      }
      return chosen.extractors;
    }

    // A path names an export — unless the source has none, in which case
    // `--input` is just pointing a local reader at a different file.
    if (input) {
      const exports = strategies.filter(s => s.delivery === 'export');
      if (exports.length === 1) return exports[0].extractors;
      if (exports.length > 1) {
        throw new Error(
          `${exports.length} strategies for ${this.input.source} read files: ` +
            `${exports.map(s => s.name).join(', ')} — pick one with --strategy.`
        );
      }
    }

    // No path and credentials on file: the live strategy, unless the source
    // already declares which extractor a bare run means.
    const api = strategies.find(s => s.delivery === 'api');
    if (!input && hasCredentials && api && !candidates.some(c => c.default)) {
      return api.extractors;
    }

    return candidates;
  }

  /**
   * What the run reads, once selected, for the dispatcher to say: the kinds,
   * those of the strategy left out, how they were chosen, and whether several
   * extractors' records merge newest first or run one after another.
   */
  selection?: {
    kinds: string[];
    excluded: string[];
    how: 'named' | 'defaults' | 'picked';
    merged: boolean;
  };

  /**
   * The kinds to read, then the extractor (or extractors, combined) that read
   * them. Named kinds (`--type`, or positionals) win, `all` and `defaults`
   * spelled out; without any, the kinds the plugin declares default; without
   * those, a person picks.
   */
  private async resolveExtractor(pool: ExtractorMetadata[]): Promise<any> {
    const named = this.input.types?.length ? this.input.types : undefined;
    const strategyPool = await this.resolveStrategyFor(pool, named);

    let kinds: string[];
    let how: 'named' | 'defaults' | 'picked';
    if (named) {
      if (named.includes(DEFAULT_KINDS) && defaultKinds(strategyPool).length === 0) {
        throw this.noDefaults(strategyPool);
      }
      kinds = expandKinds(named, strategyPool);
      how = 'named';
    } else if (defaultKinds(strategyPool).length > 0) {
      kinds = defaultKinds(strategyPool);
      how = 'defaults';
    } else {
      kinds = await this.pickKinds(strategyPool);
      how = 'picked';
    }

    const { extractor, parts } = this.byRecordType(strategyPool, kinds);
    this.selection = {
      kinds,
      excluded: allKinds(strategyPool).filter(kind => !kinds.includes(kind)),
      how,
      merged: parts.length <= 1 || canMerge(parts),
    };
    return extractor;
  }

  /**
   * The strategy's extractors, when the pool still spans several strategies:
   * the one that reads every named kind, else the one with defaults, else a
   * person's pick.
   */
  private async resolveStrategyFor(
    pool: ExtractorMetadata[],
    named: string[] | undefined
  ): Promise<ExtractorMetadata[]> {
    const strategies = this.strategies(pool);
    if (strategies.length === 1) return strategies[0].extractors;
    const literal = named?.filter(kind => kind !== ALL_KINDS && kind !== DEFAULT_KINDS) ?? [];
    const covering =
      literal.length > 0
        ? strategies.filter(s => literal.every(kind => s.recordTypes.includes(kind)))
        : strategies;
    const withDefaults = covering.find(s => s.extractors.some(e => e.default));
    if (covering.length === 1) return covering[0].extractors;
    if (withDefaults) return withDefaults.extractors;
    if (covering.length === 0) {
      // No one strategy reads them all: say which kinds are unknown, or that they span.
      return pool;
    }
    return this.pickStrategy(covering);
  }

  private noDefaults(pool: ExtractorMetadata[]): ExtractorError {
    const { source } = this.input;
    return new ExtractorError(`${source} has no default record types`, {
      code: 'no-default-record-types',
      exitCode: EXIT_CODES.usage,
      hint: `name some: \`chronicle extract ${source} ${allKinds(pool)[0]}\`, or \`-t all\` · \`--list-types\` lists them`,
    });
  }

  /** Ask which kinds to read; outside a terminal, say how to name them. */
  private async pickKinds(pool: ExtractorMetadata[]): Promise<string[]> {
    if (!this.input.interactive) throw this.noDefaults(pool);
    const { inkMultiSelect } = await import('../components/InkMultiSelect.js');
    const result = await inkMultiSelect(
      `Which ${this.input.source} records?`,
      allKinds(pool).map(kind => ({
        label: kind,
        value: kind,
        description: pool.find(e => e.recordType.includes(kind))?.description,
      })),
      defaultKinds(pool),
      this.input.theme
    );
    if (result.cancelled)
      throw Object.assign(new Error('Selection cancelled'), { oclif: { exit: 130 } });
    return result.values;
  }

  /**
   * The extractor for `kinds`: one that reads them all with least else besides
   * (the Runner drops the rest), or, when separate extractors fit better, the
   * best one for each kind, combined.
   */
  private byRecordType(
    pool: ExtractorMetadata[],
    types: string[]
  ): { extractor: any; parts: ExtractorMetadata[] } {
    const available = allKinds(pool);
    const unknown = types.filter(t => !available.includes(t));
    if (unknown.length > 0) {
      const guess = unknown.length === 1 ? closest(unknown[0], available) : undefined;
      throw new ExtractorError(
        `${this.input.source} has no record type ${unknown.map(t => `"${t}"`).join(', ')}`,
        {
          code: 'unknown-record-type',
          exitCode: EXIT_CODES.usage,
          hint: guess
            ? `did you mean \`${guess}\`? Kinds: ${available.join(', ')}`
            : `pick from ${available.join(', ')}`,
        }
      );
    }

    const surplus = (e: ExtractorMetadata) => e.recordType.filter(rt => !types.includes(rt)).length;
    const byFit = (a: ExtractorMetadata, b: ExtractorMetadata) =>
      surplus(a) - surplus(b) || Number(Boolean(b.default)) - Number(Boolean(a.default));

    const [whole] = pool.filter(e => types.every(t => e.recordType.includes(t))).sort(byFit);
    const parts = [
      ...new Set(types.map(t => pool.filter(e => e.recordType.includes(t)).sort(byFit)[0])),
    ];
    const partsSurplus = parts.reduce((n, e) => n + surplus(e), 0);
    if (whole && (parts.length === 1 || surplus(whole) <= partsSurplus)) {
      return { extractor: whole.extractor, parts: [whole] };
    }
    const strategies = [...new Set(parts.map(e => e.strategy))];
    if (strategies.length > 1) {
      throw new ExtractorError(
        `${types.join(', ')} come from different strategies of ${this.input.source} (${strategies.join(', ')})`,
        {
          code: 'record-types-span-strategies',
          exitCode: EXIT_CODES.usage,
          hint: 'pick one with `--strategy`',
        }
      );
    }
    return { extractor: combineExtractors(parts), parts };
  }

  /** Ask for the strategy; outside a terminal, say to name one. */
  private async pickStrategy(strategies: StrategyInfo[]): Promise<ExtractorMetadata[]> {
    if (!this.input.interactive) {
      throw new Error(
        `${this.input.source} needs a strategy — pick one with --strategy. ${this.strategiesSentence(strategies)}`
      );
    }
    const result = await inkSelect(
      `How should ${this.input.source} be read?`,
      strategies.map(s => ({
        label: s.name,
        value: s.name,
        description: `${s.delivery} · ${s.recordTypes.join(', ')}`,
      })),
      undefined,
      this.input.theme
    );
    if (result.cancelled)
      throw Object.assign(new Error('Selection cancelled'), { oclif: { exit: 130 } });
    return strategies.find(s => s.name === result.value)!.extractors;
  }

  private strategiesSentence(strategies: StrategyInfo[]): string {
    return `Strategies: ${strategies.map(s => `${s.name} (${s.delivery})`).join(' · ')}.`;
  }
}
