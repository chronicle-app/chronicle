import { isPathArgument } from '../plugins/scan.js';

/**
 * What `setup`'s arguments name: folders or zips to look in, as a path
 * reads, and sources to set up alone, by name. A word that's neither is
 * unknown, even when a folder of that name is here: `./name` looks in it.
 */
export function splitArgs(
  words: string[],
  sources: string[]
): { folders: string[]; sources: string[]; unknown: string[] } {
  const split = { folders: [] as string[], sources: [] as string[], unknown: [] as string[] };
  for (const word of words) {
    if (isPathArgument(word)) split.folders.push(word);
    else if (sources.includes(word)) split.sources.push(word);
    else split.unknown.push(word);
  }
  return split;
}
