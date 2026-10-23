import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileError } from '../fileErrors.js';
import { segmentPattern } from '../locator.js';
import { type DatabaseSchema, isSqlite, matchSchema, readColumns } from './databases.js';
import { isZip, openExport, partsOf } from './exportFiles.js';

/**
 * What an export looks like from inside, from
 * `chronicle.sources.<source>.strategies.<strategy>.layouts`: paths that
 * are there, relative to the folder the export starts at. `*` matches within
 * one path segment, and `{name}` matches like `*` and binds what it matched
 * to the option `name`.
 *
 * The paths start at the export's own top folder, the one its service puts
 * its files in, never a folder above it: the Health app's
 * `apple_health_export` holds `export.xml`, so its layout names `export.xml`.
 */
export interface Layout {
  /** Every path that must be there, each a file or a folder. */
  files: string[];
  /** A name to tell this layout from the source's others, like the year it's from. */
  name?: string;
  /** False for a layout the plugin recognizes but can't read. */
  supported?: boolean;
}

/** A strategy's layouts and databases, for {@link findExports} to look for. */
export interface LayoutSet {
  source: string;
  strategy: string;
  layouts: Layout[];
  /** The schemas of the SQLite databases it reads. */
  databases?: DatabaseSchema[];
  /**
   * The names its databases go by, like `History.db`, which a walk opens
   * files by. A file passed as the path is opened whatever its name.
   */
  names?: string[];
}

/** A strategy's layout that matched where an export starts, or its database's schema. */
export interface LayoutMatch {
  source: string;
  strategy: string;
  layout: Layout | DatabaseSchema;
  /** The paths that matched, from where the export starts. */
  files: string[];
  /** What each `{name}` matched. */
  options: { [option: string]: string };
  /** For a database: the schema's tables, which it has. */
  tables?: string[];
  /** For a database: the needed columns it lacks, as `table.column`, when a run can't read it. */
  missing?: string[];
}

/** An export found, and every strategy whose layout says it reads it. */
export interface FoundExport {
  /**
   * Where the export starts, which a run takes as its input: a folder, a
   * zip, or a folder in a zip as `export.zip/apple_health_export`.
   */
  root: string;
  /** The zips it's in, when it's a split Takeout's parts. */
  parts?: string[];
  /** True when it's one file, a database, rather than a folder or zip. */
  file?: boolean;
  matches: LayoutMatch[];
}

/** A folder or zip that couldn't be looked in, and why. */
export interface Refused {
  path: string;
  /**
   * The error's code, like `EPERM`, `EZIP` for a zip that won't open, or
   * `EDB` for a database whose schema can't be read, as an encrypted one.
   */
  code: string;
}

export interface FoundExports {
  exports: FoundExport[];
  /**
   * The folders and zips directly in the path that hold no export, by name,
   * with a split Takeout's parts named by its first.
   */
  unrecognized: string[];
  refused: Refused[];
  /** How many folders were looked in. */
  looked: number;
}

export interface FindOptions {
  /** How many folders below the path to look. */
  depth?: number;
  /** Told how many folders it has looked in, as it goes. */
  onFolder?: (looked: number) => void;
}

/** How far below the path to look, unless told. */
const DEPTH = 8;

/**
 * macOS bundles, which Finder shows as one file: an export is never inside
 * one, and a photo library can hold hundreds of thousands of files.
 */
const BUNDLES = new Set([
  '.app',
  '.bundle',
  '.framework',
  '.fcpbundle',
  '.imovielibrary',
  '.lrdata',
  '.lrlibrary',
  '.musiclibrary',
  '.photolibrary',
  '.photoslibrary',
  '.pkg',
  '.sparsebundle',
  '.tvlibrary',
]);

// A part of a Takeout split into several zips, as `openExport` groups them.
const PART = /^(.+)-\d{3}\.zip$/i;

type Kind = 'file' | 'folder' | 'zip' | 'link';

/** The names in each folder of a folder on disk or a zip, by kind. */
interface Tree {
  /** A folder's names, sorted, by a path from the top: `''` is the top. Null when it can't be listed. */
  children(dir: string): Promise<Map<string, Kind> | null>;
  /** Done with a folder and what's in it. */
  forget(dir: string): void;
  /** Where a path from the top is on disk, for a tree that's a folder on disk. */
  onDisk?(path: string): string;
}

const within = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Names in code-point order, so a walk finds the same first match wherever it runs. */
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** A folder on disk, listed as the walk asks, noting what it can't list. */
function folderTree(base: string, refused: Refused[]): Tree {
  const listed = new Map<string, Map<string, Kind> | null>();
  return {
    async children(dir) {
      if (listed.has(dir)) return listed.get(dir)!;
      let names: Map<string, Kind> | null = null;
      try {
        const entries = await readdir(join(base, dir), { withFileTypes: true });
        entries.sort((a, b) => byName(a.name, b.name));
        names = new Map(
          entries.map(entry => [
            entry.name,
            entry.isSymbolicLink()
              ? 'link'
              : entry.isDirectory()
                ? 'folder'
                : isZip(entry.name)
                  ? 'zip'
                  : 'file',
          ])
        );
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? 'EIO';
        if (code !== 'ENOENT' && code !== 'ENOTDIR') refused.push({ path: join(base, dir), code });
      }
      listed.set(dir, names);
      return names;
    },
    forget(dir) {
      for (const key of listed.keys()) {
        if (key === dir || key.startsWith(`${dir}/`)) listed.delete(key);
      }
    },
    onDisk: path => join(base, path),
  };
}

/** A zip's files as folders, from its index. A zip in a zip is a file. */
function listingTree(paths: string[]): Tree {
  const folders = new Map<string, Map<string, Kind>>([['', new Map()]]);
  for (const path of paths) {
    const segments = path.split('/');
    for (const [i, name] of segments.entries()) {
      const dir = segments.slice(0, i).join('/');
      const last = i === segments.length - 1;
      folders.get(dir)!.set(name, last ? 'file' : 'folder');
      if (!last) folders.set(within(dir, name), folders.get(within(dir, name)) ?? new Map());
    }
  }
  for (const [dir, names] of folders) {
    folders.set(dir, new Map([...names].sort(([a], [b]) => byName(a, b))));
  }
  return {
    async children(dir) {
      return folders.get(dir) ?? null;
    },
    forget() {},
  };
}

/**
 * Where one of a layout's paths is, from `dir`, and what its `{name}`s
 * matched. The first match in name order, or null when nothing matches.
 */
async function matchPath(
  tree: Tree,
  dir: string,
  pattern: string
): Promise<{ path: string; options: { [option: string]: string } } | null> {
  const segments = pattern.split('/');
  let partial = [{ path: dir, options: {} as { [option: string]: string } }];
  for (const [i, segment] of segments.entries()) {
    const last = i === segments.length - 1;
    const wild = /[*{]/.test(segment) ? segmentPattern(segment) : null;
    const next: typeof partial = [];
    for (const p of partial) {
      const names = await tree.children(p.path);
      if (!names) continue;
      const matching = wild ? [...names.keys()] : names.has(segment) ? [segment] : [];
      for (const name of matching) {
        if (!last && names.get(name) !== 'folder') continue;
        const match = wild ? wild.exec(name) : null;
        if (wild && !match) continue;
        next.push({ path: within(p.path, name), options: { ...p.options, ...match?.groups } });
      }
    }
    if (next.length === 0) return null;
    partial = next;
  }
  const [found] = partial;
  return { path: dir ? found.path.slice(dir.length + 1) : found.path, options: found.options };
}

/** Each strategy's first layout that matches at `dir`. */
async function matchAt(tree: Tree, dir: string, sets: LayoutSet[]): Promise<LayoutMatch[]> {
  const matches: LayoutMatch[] = [];
  for (const { source, strategy, layouts } of sets) {
    for (const layout of layouts) {
      const found = [];
      for (const pattern of layout.files) {
        const match = await matchPath(tree, dir, pattern);
        if (!match) break;
        found.push(match);
      }
      if (found.length < layout.files.length || found.length === 0) continue;
      matches.push({
        source,
        strategy,
        layout,
        files: found.map(f => f.path),
        options: Object.assign({}, ...found.map(f => f.options)),
      });
      break;
    }
  }
  return matches;
}

/** A name the walk doesn't go into: hidden, or what macOS adds to a zip it makes. */
const skipped = (name: string) => name.startsWith('.') || name === '__MACOSX';

/** An empty result, for a walk to fill. */
const nothingFound = (): FoundExports => ({
  exports: [],
  unrecognized: [],
  refused: [],
  looked: 0,
});

/**
 * A walk that fills `found`: `search` looks in a folder of a tree, and
 * `searchZip` in a zip on disk. `base` is the folder on disk a tree's zips
 * are in.
 */
function walker(base: string, sets: LayoutSet[], options: FindOptions, found: FoundExports) {
  const depth = options.depth ?? DEPTH;
  const named = sets
    .flatMap(set => (set.databases ? (set.names ?? []) : []))
    .map(name => segmentPattern(name));

  /**
   * Whether `dir` in `tree`, or anything in it, is an export. At the top of
   * the path, each folder and zip in it that holds none is unrecognized.
   */
  const search = async (
    tree: Tree,
    dir: string,
    level: number,
    root: (dir: string) => Omit<FoundExport, 'matches'>,
    top = false
  ): Promise<boolean> => {
    const names = await tree.children(dir);
    if (!names) return false;
    options.onFolder?.(++found.looked);
    const matches = await matchAt(tree, dir, sets);
    if (matches.length > 0) {
      found.exports.push({ ...root(dir), matches });
      tree.forget(dir);
      return true;
    }
    let any = false;
    const grouped = new Set<string>();
    for (const [name, kind] of names) {
      if (skipped(name) || kind === 'link') continue;
      const child = within(dir, name);
      if (kind === 'file') {
        // A file is opened only on disk, and only when it's named as a database is.
        if (tree.onDisk && named.some(pattern => pattern.test(name))) {
          any = (await searchFile(tree.onDisk(child))) || any;
        }
        continue;
      }
      // Null for a zip that won't open, which is refused rather than unrecognized.
      let held: boolean | null = false;
      if (kind === 'folder') {
        // A bundle is looked at, in case a layout is one, but not into.
        const bundle = BUNDLES.has(extname(name).toLowerCase());
        if (level < depth) held = await search(tree, child, bundle ? depth : level + 1, root);
      } else {
        const stem = PART.exec(name)?.[1];
        if (stem && grouped.has(stem)) continue;
        if (stem) grouped.add(stem);
        if (level < depth) held = await searchZip(join(base, child), level + 1);
      }
      if (held === false && top) found.unrecognized.push(name);
      any ||= held === true;
    }
    tree.forget(dir);
    return any;
  };

  /** Whether a zip, or a split Takeout by one of its parts, holds an export. Null when it won't open. */
  const searchZip = async (zip: string, level: number): Promise<boolean | null> => {
    let files;
    try {
      files = await openExport(zip);
    } catch {
      found.refused.push({ path: zip, code: 'EZIP' });
      return null;
    }
    const parts = await partsOf(zip);
    try {
      const tree = listingTree(await files.list());
      return await search(tree, '', level, dir => ({
        root: dir ? `${zip}/${dir}` : zip,
        ...(parts.length > 1 && { parts }),
      }));
    } finally {
      await files.close();
    }
  };

  /**
   * Whether a file is a database a strategy reads, by its schema: its
   * tables, and whether it has every column a run needs. It's read without
   * writing beside it.
   */
  const searchFile = async (file: string): Promise<boolean> => {
    const databases = sets.filter(set => set.databases?.length);
    if (databases.length === 0 || !(await isSqlite(file))) return false;
    let columns;
    try {
      columns = readColumns(file);
    } catch {
      found.refused.push({ path: file, code: 'EDB' });
      return false;
    }
    const matches: LayoutMatch[] = [];
    for (const { source, strategy, databases: schemas } of databases) {
      const match = matchSchema(columns, schemas!);
      if (!match) continue;
      matches.push({
        source,
        strategy,
        layout: match.schema,
        files: [],
        options: {},
        tables: Object.keys(match.schema.tables),
        ...(match.missing.length > 0 && { missing: match.missing }),
      });
    }
    if (matches.length === 0) return false;
    found.exports.push({ root: file, file: true, matches });
    return true;
  };

  /**
   * Whether a path is in an export, as an export's `export.xml` or one of its
   * folders is: the nearest folder above it where a layout matches. A folder
   * above that can't be listed ends the search, unreported.
   */
  const searchAbove = async (path: string): Promise<boolean> => {
    let dir = dirname(path);
    for (let level = 0; level < depth && dir !== dirname(dir); level++, dir = dirname(dir)) {
      const tree = folderTree(dir, []);
      if (!(await tree.children(''))) break;
      options.onFolder?.(++found.looked);
      const matches = await matchAt(tree, '', sets);
      if (matches.length > 0) {
        found.exports.push({ root: dir, matches });
        return true;
      }
    }
    return false;
  };

  return { search, searchZip, searchFile, searchAbove };
}

/**
 * Every export in a folder or a zip, found by the layouts that match where
 * each starts. A folder whose layout matches is that export, so the walk
 * doesn't go into it, though other strategies' layouts can match it too, as
 * several sources share a Takeout. The walk opens each zip it finds, reading
 * only its index, and reads a split Takeout's parts as one. It reads no file,
 * follows no link, and doesn't go into hidden folders or macOS bundles. It
 * opens a file only when it's named as a strategy's database is, to read its
 * schema. A file passed as the path is a database, or is looked for in the
 * export it's in, as is a folder with no export in it.
 */
export async function findExports(
  path: string,
  sets: LayoutSet[],
  options: FindOptions = {}
): Promise<FoundExports> {
  const found = nothingFound();
  const { search, searchZip, searchFile, searchAbove } = walker(path, sets, options, found);
  let stats;
  try {
    stats = await stat(path);
  } catch (error) {
    throw fileError(error, path, 'folder or zip');
  }
  if (stats.isDirectory()) {
    const tree = folderTree(path, found.refused);
    const held = await search(tree, '', 0, dir => ({ root: dir ? join(path, dir) : path }), true);
    // What's in a folder of an export is part of it, not unrecognized.
    if (!held && (await searchAbove(path))) found.unrecognized = [];
  } else if (isZip(path)) {
    if ((await searchZip(path, 0)) === false) found.unrecognized.push(basename(path));
  } else if (!(await searchFile(path)) && !(await searchAbove(path))) {
    found.unrecognized.push(basename(path));
  }
  found.exports.sort((a, b) => byName(a.root, b.root));
  return found;
}

/**
 * Every export in a list of files, as a zip's index or a package's manifest
 * lists them, without looking at a disk. Roots are paths from the list's
 * top, `''` when the whole list is one export.
 */
export async function findExportsIn(
  paths: string[],
  sets: LayoutSet[],
  options: FindOptions = {}
): Promise<FoundExports> {
  const found = nothingFound();
  const { search } = walker('', sets, options, found);
  await search(listingTree(paths), '', 0, dir => ({ root: dir }), true);
  found.exports.sort((a, b) => byName(a.root, b.root));
  return found;
}
