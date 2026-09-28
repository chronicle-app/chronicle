import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Extractor, Record } from '@chronicle.app/etl';
import { load, CORE_SCHEMA } from 'js-yaml';
import { z } from 'zod';
import ObsidianTransformer from './ObsidianTransformer.js';

export interface VaultNote {
  /** Path relative to the enclosing vault, including .md. */
  path: string;
  name: string;
  tags: string[];
  frontmatter: { [key: string]: unknown };
  /** Markdown after the YAML frontmatter, preserving plugin-specific syntax. */
  body: string;
  /** Filesystem birth time, when available; not an authored creation event. */
  birthtime?: string;
  mtime: string;
}

export interface VaultContext {
  recordType: string;
  vault: string;
  /** All Markdown paths in the vault, including notes outside the input folder. */
  paths: string[];
}

const FRONTMATTER = /^(?:\uFEFF)?---\r?\n((?:[^\n]*\n)*?)---(?:\r?\n|$)/;

/** A note located in setup; its body is read only when it is extracted. */
interface VaultEntry {
  file: string;
  /** Path relative to the enclosing vault, POSIX separators. */
  relative: string;
  mtime: Date;
  birthtime?: string;
}

export class ObsidianExtractor extends Extractor<typeof ObsidianExtractor> {
  static override source = 'obsidian';
  static override description = 'Notes and links from a vault';

  static override delivery = 'local' as const;
  static override strategy = 'vault';
  static override recordTypes = ['notes'];
  static override default = true;
  static override temporality = 'snapshot' as const;
  // Paths stay known when notes change. The key-only frontier would stop
  // after 25 existing notes even if more edits remain, so always scan the vault.
  static override newestFirst = false;
  static override defaultTransformer = ObsidianTransformer;
  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to an Obsidian vault or a folder within it'),
  }) as any;

  private entries: VaultEntry[] = [];
  private context!: VaultContext;
  private newestMtime?: Date;

  override async setup(): Promise<void> {
    this.entries = [];
    this.newestMtime = undefined;
    const input = path.resolve(String(this.config.input));
    const root = await this.vaultRoot(input);
    const files = await this.findMarkdownFiles(root);
    this.context = {
      recordType: 'notes',
      vault: path.basename(root),
      paths: files.map(file => path.relative(root, file).split(path.sep).join('/')),
    };

    for (const file of files) {
      const relativeToInput = path.relative(input, file);
      if (relativeToInput.startsWith(`..${path.sep}`) || relativeToInput === '..') continue;
      const stat = await fs.stat(file);
      if (!this.newestMtime || stat.mtime > this.newestMtime) this.newestMtime = stat.mtime;
      this.entries.push({
        file,
        relative: path.relative(root, file).split(path.sep).join('/'),
        mtime: stat.mtime,
        ...(stat.birthtimeMs > 0 && {
          birthtime: stat.birthtime.toISOString(),
        }),
      });
    }
    // Newest-first for limited imports; path order breaks ties so a
    // re-read of an unchanged vault yields the same stream.
    this.entries.sort(
      (a, b) => b.mtime.getTime() - a.mtime.getTime() || a.relative.localeCompare(b.relative)
    );
    this.logVerboseStep(`Vault "${this.context.vault}": ${this.entries.length} Markdown notes`);
  }

  /** Prefer the enclosing Obsidian vault so subfolder imports retain identity. */
  private async vaultRoot(input: string): Promise<string> {
    let dir = input;
    do {
      try {
        if ((await fs.stat(path.join(dir, '.obsidian'))).isDirectory()) return dir;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const parent = path.dirname(dir);
      if (parent === dir) return input;
      dir = parent;
    } while (dir !== path.dirname(dir));
    return input;
  }

  /** Re-reading unchanged files produces the same snapshot time. */
  protected override asOfTime(): Date {
    return this.newestMtime ?? super.asOfTime();
  }

  override keyOf(record: Record): string | null {
    return (record.data as VaultNote).path ?? null;
  }

  override async determineCount(): Promise<number | null> {
    const limit = this.getEffectiveLimit();
    return limit === null ? this.entries.length : Math.min(limit, this.entries.length);
  }

  async *extract(): AsyncGenerator<Record> {
    let count = 0;
    for (const entry of this.entries) {
      if (this.shouldStopExtracting(count)) return;
      yield this.createRecord(await this.readNote(entry), this.context);
      count++;
    }
  }

  private async readNote(entry: VaultEntry): Promise<VaultNote> {
    const body = await fs.readFile(entry.file, 'utf8');
    const frontmatter = this.frontmatter(body, entry.relative);
    return {
      path: entry.relative,
      name: path.basename(entry.file, path.extname(entry.file)),
      tags: this.tags(frontmatter),
      frontmatter,
      body: body.replace(FRONTMATTER, ''),
      ...(entry.birthtime !== undefined && { birthtime: entry.birthtime }),
      mtime: entry.mtime.toISOString(),
    };
  }

  /** Ignore hidden files/directories and symlinks; only Markdown is imported. */
  private async findMarkdownFiles(root: string): Promise<string[]> {
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md')
          files.push(full);
      }
    };
    await walk(root);
    return files.sort((a, b) => a.localeCompare(b));
  }

  private frontmatter(body: string, file: string): { [key: string]: unknown } {
    const match = FRONTMATTER.exec(body);
    if (!match) return {};
    try {
      const loaded = load(match[1], { schema: CORE_SCHEMA });
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded))
        return loaded as { [key: string]: unknown };
    } catch (error) {
      this.logger.warn(
        `Unparseable frontmatter in ${file}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return {};
  }

  private tags(frontmatter: { [key: string]: unknown }): string[] {
    const raw = frontmatter.tags;
    const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[\s,]+/) : [];
    return [
      ...new Set(
        values
          .filter((value): value is string => typeof value === 'string')
          .map(value => value.trim().replace(/^#/, ''))
          .filter(Boolean)
      ),
    ];
  }
}
