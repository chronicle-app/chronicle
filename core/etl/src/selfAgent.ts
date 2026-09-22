/**
 * Helper for building the account-owner node a source emits about its own
 * user. Every source must tag its self with `sameAs: ["@me"]` — the reserved
 * token merges each source's self onto the internal Person hub — or the
 * source's own activity silently drops out of `agent:@me` queries.
 *
 * Identity comes only from what the source actually provides: pass the ids
 * you have, and the keyset is derived from them (never from a display name,
 * and never invented). A source with no owner identifiers at all gets the
 * per-source singleton `["@type", "source"]` — still merged into the real
 * person through `@me`.
 */

export interface SelfAgentOptions {
  /** Node type; the self is a Person unless the source says otherwise. */
  type?: string;
  source: string;
  sourceId?: string;
  handle?: string;
  /** Display name, only when the source reports one — never fabricate. */
  name?: string;
  /**
   * Keyset override. Default: `["@type", "source", "sourceId"]` when a
   * sourceId is given, `["@type", "source", "handle"]` when only a handle is,
   * `["@type", "source"]` when the source provides no identifier.
   */
  key?: string[];
  /** Existing cross-source identity edges; "@me" is appended after them. */
  sameAs?: unknown[];
}

export function selfAgent(options: SelfAgentOptions): Record<string, any> {
  const { type = 'Person', source, sourceId, handle, name, sameAs = [] } = options;

  const key =
    options.key ??
    (sourceId === undefined
      ? handle === undefined
        ? ['@type', 'source']
        : ['@type', 'source', 'handle']
      : ['@type', 'source', 'sourceId']);

  return {
    '@type': type,
    source,
    ...(sourceId !== undefined && { sourceId }),
    ...(handle !== undefined && { handle }),
    ...(name !== undefined && { name }),
    '@key': key,
    sameAs: [...sameAs, '@me'],
  };
}
