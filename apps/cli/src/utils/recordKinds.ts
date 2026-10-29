import type { Delivery } from '@chronicle.app/etl';
import type { ExtractorMetadata } from '../plugins/PluginScanner.js';

/** `--type all`: every kind the strategy reads. */
export const ALL_KINDS = 'all';
/** `--type defaults`: the kinds the plugin reads when none are named. */
export const DEFAULT_KINDS = 'defaults';

/** Every kind the extractors read, in declaration order. */
export function allKinds(pool: ExtractorMetadata[]): string[] {
  return [...new Set(pool.flatMap(e => e.recordType))];
}

/**
 * The kinds a run reads when none are named: those of the extractors the
 * plugin marks default, or a lone extractor's. Empty when the plugin declares
 * none, and a person picks.
 */
export function defaultKinds(pool: ExtractorMetadata[]): string[] {
  if (pool.length === 1) return pool[0].recordType;
  return allKinds(pool.filter(e => e.default));
}

/** Requested kinds with `all` and `defaults` spelled out, each kind once. */
export function expandKinds(requested: string[], pool: ExtractorMetadata[]): string[] {
  return [
    ...new Set(
      requested.flatMap(kind =>
        kind === ALL_KINDS ? allKinds(pool) : kind === DEFAULT_KINDS ? defaultKinds(pool) : [kind]
      )
    ),
  ];
}

/**
 * Of the strategies with default kinds, the one a run takes when it names no
 * strategy and passes no `--input`: the first that doesn't read a file handed
 * to it, else the first. An export's default kinds are what `--input` reads.
 */
export function bareRunStrategy<S extends { delivery: Delivery }>(
  strategies: S[],
  hasDefaults: (strategy: S) => boolean
): S | undefined {
  const withDefaults = strategies.filter(strategy => hasDefaults(strategy));
  return withDefaults.find(s => s.delivery !== 'export') ?? withDefaults[0];
}
