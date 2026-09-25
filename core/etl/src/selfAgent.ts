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
import type { AgentAndChildren, Entity, KeyField } from '@chronicle.app/schema';

/** The schema node types a self can be: `Agent` or one of its subtypes. */
export type SelfAgentType = AgentAndChildren['@type'];

/** The schema node `selfAgent` returns for a given type, e.g. `Person` for `'Person'`. */
export type SelfAgent<T extends SelfAgentType = 'Person'> = Extract<
  AgentAndChildren,
  { '@type': T }
>;

export interface SelfAgentOptions<T extends SelfAgentType = SelfAgentType> {
  /** Node type; the self is a Person unless the source says otherwise. */
  type?: T;
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
  key?: KeyField[];
  /** Existing cross-source identity edges; "@me" is appended after them. */
  sameAs?: NonNullable<Entity['sameAs']>;
}

/** Build the source's self node, typed as the schema node for `type` (`Person` by default). */
export function selfAgent<T extends SelfAgentType = 'Person'>(
  options: SelfAgentOptions<T>
): SelfAgent<T> {
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
  } as SelfAgent<T>;
}
