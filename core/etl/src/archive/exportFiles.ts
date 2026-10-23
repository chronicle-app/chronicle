import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { InputNotFound } from '@chronicle.app/logging';
import yauzl from 'yauzl';
import { fileError } from '../fileErrors.js';

/**
 * The files of an export, however it was handed over: a folder, a zip, or the
 * numbered zips Google Takeout splits a large export into. Paths are relative
 * to the export's root and use `/`, such as
 * `Takeout/YouTube and YouTube Music/history/watch-history.html`. Files in a
 * zip are read in place and decompressed as they stream, so nothing is
 * unpacked to disk.
 */
export interface ExportFiles {
  /** What was opened, for messages: the folder, or the first zip. */
  readonly location: string;
  /** Every file's path, sorted. With a prefix, only the paths that start with it. */
  list(prefix?: string): Promise<string[]>;
  has(path: string): Promise<boolean>;
  /** The path of the file with this name nearest the root, such as `export.xml`. */
  find(name: string): Promise<string | null>;
  /** A stream of the file's bytes. */
  open(path: string): Promise<Readable>;
  read(path: string): Promise<Buffer>;
  /** The file as UTF-8 text, without a byte order mark. */
  readText(path: string): Promise<string>;
  readJson<T = unknown>(path: string): Promise<T>;
  /**
   * When the file was last changed: in a zip, as its index says, which is
   * when the service wrote the export. Null when it isn't there.
   */
  modified(path: string): Promise<Date | null>;
  close(): Promise<void>;
}

// A part of a Takeout split into several zips, such as
// `takeout-20250101T000000Z-001.zip`: the same name with a three-digit number.
const PART = /^(.+)-\d{3}\.zip$/i;

export const isZip = (path: string) => path.toLowerCase().endsWith('.zip');

/**
 * Open an export from the path a person passed. A folder is read as it is,
 * unless all it holds is zips, which are then read as one export. A zip
 * that's one part of a split Takeout brings in its sibling parts. A path
 * through a zip, like `export.zip/apple_health_export`, is that folder in it.
 */
export async function openExport(input: string): Promise<ExportFiles> {
  let stats;
  try {
    stats = await stat(input);
  } catch (error) {
    const inZip = await zipAlong(input);
    if (inZip) return ZipExport.open(await partsOf(inZip.zip), inZip.folder);
    throw fileError(error, input, 'export');
  }
  if (stats.isDirectory()) {
    const zips = await zipsIn(input);
    return zips ? ZipExport.open(zips) : new FolderExport(input);
  }
  if (isZip(input)) return ZipExport.open(await partsOf(input));
  throw new InputNotFound('That isn’t an export', {
    path: input,
    hint: 'Pass the export’s folder or its zip with `--input <path>`.',
  });
}

/** The zips a folder holds, when they're all it holds (other than hidden files). */
async function zipsIn(folder: string): Promise<string[] | null> {
  const entries = (await readdir(folder, { withFileTypes: true })).filter(
    entry => !entry.name.startsWith('.')
  );
  if (entries.length === 0) return null;
  if (!entries.every(entry => entry.isFile() && isZip(entry.name))) return null;
  return entries.map(entry => join(folder, entry.name)).sort();
}

/**
 * The zip a path that isn't there runs through, and the folder in it the
 * rest of the path names. Null when the path doesn't run through a zip.
 */
async function zipAlong(input: string): Promise<{ zip: string; folder: string } | null> {
  for (let zip = dirname(input); zip !== dirname(zip); zip = dirname(zip)) {
    let stats;
    try {
      stats = await stat(zip);
    } catch {
      continue;
    }
    if (!stats.isFile() || !isZip(zip)) return null;
    return { zip, folder: relative(zip, input).split(sep).join('/') };
  }
  return null;
}

/** A zip and, when it's one part of a split Takeout, its sibling parts. */
export async function partsOf(zip: string): Promise<string[]> {
  const stem = PART.exec(basename(zip))?.[1];
  if (!stem) return [zip];
  const folder = dirname(zip);
  const siblings = (await readdir(folder)).filter(name => PART.exec(name)?.[1] === stem);
  return siblings.map(name => join(folder, name)).sort();
}

/** How many folders deep a path is. */
const depthOf = (path: string) => path.split('/').length;

/** A file's path as given, without leading `./` or `/`. */
function normalize(path: string): string {
  return path.replace(/^(\.?\/)+/, '');
}

function missing(path: string, location: string): InputNotFound {
  return new InputNotFound(`No ${path} in the export`, { path: location });
}

abstract class BaseExport implements ExportFiles {
  abstract readonly location: string;
  protected abstract paths(): Promise<string[]>;
  abstract open(path: string): Promise<Readable>;
  abstract modified(path: string): Promise<Date | null>;
  abstract close(): Promise<void>;

  async list(prefix = ''): Promise<string[]> {
    const want = normalize(prefix);
    return (await this.paths()).filter(path => path.startsWith(want));
  }

  async has(path: string): Promise<boolean> {
    return (await this.paths()).includes(normalize(path));
  }

  async find(name: string): Promise<string | null> {
    const matches = (await this.paths()).filter(path => basename(path) === name);
    matches.sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
    return matches[0] ?? null;
  }

  async read(path: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of await this.open(path)) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  async readText(path: string): Promise<string> {
    return (await this.read(path)).toString('utf8').replace(/^\uFEFF/, '');
  }

  async readJson<T = unknown>(path: string): Promise<T> {
    const text = await this.readText(path);
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new InputNotFound(`Can’t read ${path} as JSON`, { path: this.location, cause: error });
    }
  }
}

class FolderExport extends BaseExport {
  private cached: Promise<string[]> | null = null;

  constructor(readonly location: string) {
    super();
  }

  protected paths(): Promise<string[]> {
    this.cached ??= walk(this.location).then(paths => paths.sort());
    return this.cached;
  }

  async open(path: string): Promise<Readable> {
    const file = join(this.location, normalize(path));
    try {
      await stat(file);
    } catch (error) {
      throw (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? missing(path, this.location)
        : fileError(error, file, 'export');
    }
    return createReadStream(file);
  }

  async modified(path: string): Promise<Date | null> {
    try {
      return (await stat(join(this.location, normalize(path)))).mtime;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {}
}

/** Every file under a folder, as paths relative to it with `/`. */
async function walk(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry =>
      join(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .split('\\')
        .join('/')
    );
}

class ZipExport extends BaseExport {
  private constructor(
    readonly location: string,
    private readonly zips: yauzl.ZipFile[],
    private readonly entries: Map<string, { zip: yauzl.ZipFile; entry: yauzl.Entry }>
  ) {
    super();
  }

  /**
   * Open the zips and read their indexes. A path in more than one zip is
   * taken from the first. With a folder, only what's in it, by paths from it.
   */
  static async open(files: string[], folder = ''): Promise<ZipExport> {
    const zips: yauzl.ZipFile[] = [];
    const entries = new Map<string, { zip: yauzl.ZipFile; entry: yauzl.Entry }>();
    const within = folder ? `${folder}/` : '';
    try {
      for (const file of files) {
        const zip = await openZip(file);
        zips.push(zip);
        for (const entry of await readIndex(zip, file)) {
          if (entry.fileName.endsWith('/')) continue;
          const path = normalize(entry.fileName);
          if (!path.startsWith(within)) continue;
          const inside = path.slice(within.length);
          if (!entries.has(inside)) entries.set(inside, { zip, entry });
        }
      }
      if (folder && entries.size === 0) {
        throw new InputNotFound(`No ${folder} in the zip`, { path: files[0] });
      }
    } catch (error) {
      for (const zip of zips) zip.close();
      throw error;
    }
    return new ZipExport(files[0], zips, entries);
  }

  protected async paths(): Promise<string[]> {
    return [...this.entries.keys()].sort();
  }

  open(path: string): Promise<Readable> {
    const found = this.entries.get(normalize(path));
    if (!found) return Promise.reject(missing(path, this.location));
    return new Promise((resolve, reject) => {
      found.zip.openReadStream(found.entry, (error, stream) =>
        error ? reject(unreadable(this.location, error)) : resolve(stream)
      );
    });
  }

  async modified(path: string): Promise<Date | null> {
    return this.entries.get(normalize(path))?.entry.getLastModDate() ?? null;
  }

  async close(): Promise<void> {
    for (const zip of this.zips) zip.close();
  }
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false }, (error, zip) => {
      if (error) {
        const { code } = error as NodeJS.ErrnoException;
        reject(code ? fileError(error, file, 'export') : unreadable(file, error));
      } else resolve(zip);
    });
  });
}

function readIndex(zip: yauzl.ZipFile, file: string): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', error => reject(unreadable(file, error)));
    zip.readEntry();
  });
}

function unreadable(file: string, cause: unknown): InputNotFound {
  return new InputNotFound('Can’t read the zip', {
    path: file,
    cause,
    hint: 'Check that the download finished. If it did, unzip it and pass the folder with `--input <path>`.',
  });
}
