import { PERSISTENCE_NAMESPACE, SCHEMA_NAMESPACE } from '../constants.js';

/**
 * Content-based entity IRI. The identity is the entity's keyset SET (a merged
 * entity owns the union of its contributors' keysets); we take the
 * lexicographically smallest keyset content key as the stable representative,
 * so the IRI is identical regardless of merge order and never reflects a
 * surrogate row id.
 */
export function entityIri(contentKey: string): string {
  return `<${PERSISTENCE_NAMESPACE}entity/${contentKey}>`;
}

/** Content-based action IRI (the action's dedupe keyset hash). */
export function actionIri(contentKey: string): string {
  return `<${PERSISTENCE_NAMESPACE}action/${contentKey}>`;
}

export function predicateIri(predicate: string): string {
  return `<${SCHEMA_NAMESPACE}${predicate}>`;
}

/** Annotation (meta) predicate IRI: source / validFrom / validTo / ... */
export function metaIri(name: string): string {
  return `<${SCHEMA_NAMESPACE}meta/${name}>`;
}
