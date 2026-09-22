import { inkSelect } from '../components/InkSelect.js';
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
  /** `--via` / `--strategy`: the named way in. */
  via?: string;
  /** `--type`: the record kinds asked for. */
  types?: string[];
  /** `--input`: a path, which points at an export when the source has one. */
  input?: string;
  /** Whether the source has stored credentials — decides the live way in. */
  hasCredentials?: boolean;
  /** Interactive selection is possible (a TTY for Ink's raw mode). */
  interactive?: boolean;
  theme?: string;
}

/**
 * Resolve a run to one extractor across the two axes: `strategy` (the named way
 * in, picked with `--via`) and `--type` (record kinds, the same vocabulary on
 * every way in).
 *
 * The way in resolves first — explicit `--via`, else the export a path implies,
 * else the live API when credentials exist, else the source's declared default.
 * Only then does `--type` choose among the extractors on that way in, preferring
 * the one that emits least of what wasn't asked for; whatever surplus remains is
 * the Runner's post-yield filter to drop.
 */
export class ExtractorSelector {
  constructor(private readonly input: SelectionInput) {}

  async select(): Promise<any> {
    const pool = await this.resolveWayIn();
    return this.resolveExtractor(pool);
  }

  /** The strategies a source offers, in declaration order. */
  private strategies(candidates = this.input.candidates): StrategyInfo[] {
    return strategiesOf(candidates);
  }

  private async resolveWayIn(): Promise<ExtractorMetadata[]> {
    const { candidates, via, input, hasCredentials } = this.input;
    const strategies = this.strategies();

    if (via) {
      const chosen = strategies.find(s => s.name === via);
      if (!chosen) {
        throw new Error(
          `No "${via}" way into ${this.input.source}. ${this.waysInSentence(strategies)}`
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
          `${exports.length} ways into ${this.input.source} read files: ` +
            `${exports.map(s => s.name).join(', ')} — pick one with --via.`
        );
      }
    }

    // No path and credentials on file: the live way in, unless the source
    // already declares which extractor a bare run means.
    const api = strategies.find(s => s.delivery === 'api');
    if (!input && hasCredentials && api && !candidates.some(c => c.default)) {
      return api.extractors;
    }

    return candidates;
  }

  private async resolveExtractor(pool: ExtractorMetadata[]): Promise<any> {
    const { types } = this.input;

    if (types && types.length > 0) {
      return this.byRecordType(pool, types);
    }

    if (pool.length === 1) return pool[0].extractor;

    const declaredDefault = pool.find(e => e.default);
    if (declaredDefault) return declaredDefault.extractor;

    return this.prompt(pool);
  }

  /**
   * `--type` as a filter over record kinds, not a name for an extractor: keep
   * the extractors that emit any requested kind, then prefer the one that emits
   * least of what wasn't asked for. So `--type app-activities` runs the focused
   * extractor rather than the everything-merge that also emits it.
   */
  private byRecordType(pool: ExtractorMetadata[], types: string[]): any {
    const available = [...new Set(pool.flatMap(e => e.recordType))];
    const unknown = types.filter(t => !available.includes(t));
    if (unknown.length > 0) {
      throw new Error(
        `${this.input.source} has no record type ${unknown.map(t => `"${t}"`).join(', ')}. ` +
          `Available: ${available.join(', ')}.`
      );
    }

    const matching = pool.filter(e => e.recordType.some(rt => types.includes(rt)));
    const surplus = (e: ExtractorMetadata) => e.recordType.filter(rt => !types.includes(rt)).length;
    const fewest = Math.min(...matching.map(e => surplus(e)));
    const best = matching.filter(e => surplus(e) === fewest);

    if (best.length === 1) return best[0].extractor;

    const preferred = best.find(e => e.default);
    if (preferred) return preferred.extractor;

    throw new Error(
      `${types.join(', ')} is ambiguous for ${this.input.source} — ` +
        `${[...new Set(best.map(e => e.strategy))].join(', ')} all read it. Pick one with --via.`
    );
  }

  /** Ask for the way in, then (only if it holds several) for the record kinds. */
  private async prompt(pool: ExtractorMetadata[]): Promise<any> {
    const strategies = this.strategies(pool);

    // Whichever axis is still open is the one to name.
    if (!this.input.interactive) {
      throw new Error(
        strategies.length > 1
          ? `${this.input.source} needs a way in — pick one with --via. ${this.waysInSentence(strategies)}`
          : `${this.input.source} needs a --type. Types: ${strategies[0].recordTypes.join(', ')}.`
      );
    }

    let chosen = pool;
    if (strategies.length > 1) {
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
      chosen = strategies.find(s => s.name === result.value)!.extractors;
    }

    if (chosen.length === 1) return chosen[0].extractor;

    const byType = await inkSelect(
      'Which records?',
      chosen.map((e, i) => ({
        label: e.recordType.join(', ') || e.extractor.name,
        value: String(i),
        description: e.description,
      })),
      undefined,
      this.input.theme
    );
    if (byType.cancelled)
      throw Object.assign(new Error('Selection cancelled'), { oclif: { exit: 130 } });
    return chosen[Number(byType.value)].extractor;
  }

  private waysInSentence(strategies: StrategyInfo[]): string {
    return `Ways in: ${strategies.map(s => `${s.name} (${s.delivery})`).join(' · ')}.`;
  }
}
