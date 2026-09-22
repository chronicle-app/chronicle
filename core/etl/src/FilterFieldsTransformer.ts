import { get } from 'es-toolkit/compat';
import { Record } from './types.js';
import { Transformer } from './transformer.js';

export class FilterFieldsTransformer extends Transformer {
  static override outputSchema: string = 'raw';

  async transform(record: Record) {
    const filteredFields = buildFlatObjectFromPaths(this.config.fields, record.data);

    return [filteredFields];
  }
}

export function buildFlatObjectFromPaths(paths: string[], nestedObject: any) {
  const flatObject: { [key: string]: any } = {};

  for (const path of paths) {
    if (path.includes('*')) {
      // Handle wildcard expansion
      const expandedResults = expandWildcardPath(path, nestedObject);

      // Check if path contains [*] to collect as array
      if (path.includes('[*]')) {
        const basePath = path.replace('[*]', '');
        const values = expandedResults.map(([, value]) => value);
        flatObject[basePath] = values;
      } else {
        // Expand individual fields
        for (const [expandedPath, value] of expandedResults) {
          flatObject[expandedPath] = value;
        }
      }
    } else {
      // Use es-toolkit's get function which supports both dot notation and bracket notation
      // e.g., 'object.isPartOf[0]', 'object.isPartOf.0', 'user.name'
      const value = get(nestedObject, path);
      flatObject[path] = value;
    }
  }

  return flatObject;
}

function expandWildcardPath(path: string, nestedObject: any): [string, any][] {
  const results: [string, any][] = [];

  // Handle [*] pattern by normalizing it to . and *
  const normalizedPath = path.replaceAll('[*]', '.*');
  const parts = normalizedPath.split('.');

  function traverse(currentPath: string[], remainingParts: string[], currentObject: any) {
    if (remainingParts.length === 0) {
      // End of path, collect the value
      const fullPath = currentPath.join('.');
      results.push([fullPath, currentObject]);
      return;
    }

    const [nextPart, ...restParts] = remainingParts;

    if (nextPart === '*') {
      // Wildcard expansion
      if (Array.isArray(currentObject)) {
        // Expand array indices
        for (const [index, item] of currentObject.entries()) {
          traverse([...currentPath, index.toString()], restParts, item);
        }
      } else if (currentObject && typeof currentObject === 'object') {
        // Expand object keys
        for (const key of Object.keys(currentObject)) {
          traverse([...currentPath, key], restParts, currentObject[key]);
        }
      }
    } else {
      // Regular path navigation
      const nextObject = get(currentObject, nextPart);
      if (nextObject !== undefined) {
        traverse([...currentPath, nextPart], restParts, nextObject);
      }
    }
  }

  traverse([], parts, nestedObject);
  return results;
}
