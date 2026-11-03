import { CLASS_PARENTS, PROPERTY_PARENTS } from './schema.js';

// A term can have two parents, so the walk up tracks what it has seen.
const descendsFrom = (
  parents: Record<string, string[]>,
  term: string,
  ancestor: string,
  seen = new Set<string>()
): boolean => {
  if (term === ancestor) return true;
  if (seen.has(term)) return false;
  seen.add(term);
  return (parents[term] ?? []).some(parent => descendsFrom(parents, parent, ancestor, seen));
};

const below = (parents: Record<string, string[]>, name: string): string[] => {
  if (!(name in parents)) return [];
  return [
    name,
    ...Object.keys(parents).filter(term => term !== name && descendsFrom(parents, term, name)),
  ];
};

/** A class and every class below it, or nothing for a class chronicle.ttl doesn't declare. */
export function getAllSubtypes(type: string): string[] {
  return below(CLASS_PARENTS, type);
}

/** A property and every property below it, or nothing for a property chronicle.ttl doesn't declare. */
export function getAllSubproperties(property: string): string[] {
  return below(PROPERTY_PARENTS, property);
}
