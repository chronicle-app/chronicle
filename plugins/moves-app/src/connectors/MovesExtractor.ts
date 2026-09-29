import { Extractor, Record, selfAgent } from '@chronicle.app/etl';
import { AgentAndChildren } from '@chronicle.app/schema';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { dayKey, parseMovesTime, shiftDayKey } from '../time.js';
import { MovesActivity, MovesDay, MovesSegment } from '../types.js';
import MovesTransformer from './MovesTransformer.js';

// A daily storyline file is named for the local day it covers.
const DAILY_FILE = /^storyline_(\d{8})\.json$/;

// One record to emit: a stay, or one leg of movement.
interface Selected {
  data: MovesSegment | MovesActivity;
  recordType: 'places' | 'moves';
}

export class MovesExtractor extends Extractor<typeof MovesExtractor> {
  static override source = 'moves-app';
  static override description = 'Location storyline: places and moves';

  static override delivery = 'export' as const;
  // The strategy, in Moves' own vocabulary: the archive the moves-export.com
  // service handed you, which is the only way this data ever left the app.
  static override strategy = 'moves-export';
  static override recordTypes = ['places', 'moves'];
  static override default = true;
  static override defaultTransformer = MovesTransformer;

  static override schema = Extractor.schema.extend({
    input: z
      .string()
      .describe(
        'Path to the unzipped Moves export — the export folder, its json/ folder, the daily storyline folder, or a storyline JSON file'
      ),
  });

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof MovesExtractor.schema>;

    // The export carries no account identity — no name, no handle, no user id.
    // So the self is the per-source singleton, merged onto the real person
    // through "@me" like every other source's self.
    const person: AgentAndChildren = selfAgent({
      source: 'moves-app',
    }) as AgentAndChildren;

    const selected: Selected[] = [];
    // A segment that spans midnight is written into both days, so the same
    // segment is read twice. Its start instant tells the copies apart — the
    // instant, not the string Moves wrote it as, which is the same identity the
    // transformer keys on and holds even if the two copies carry different
    // offsets.
    const seen = new Set<string>();

    for await (const day of this.readDays(config.input)) {
      for (const segment of [...(day.segments ?? [])].reverse()) {
        for (const item of this.selectFrom(segment)) {
          const start = parseMovesTime(item.data.startTime);
          if (!start) continue;

          const marker = `${item.recordType}:${start.toISOString()}`;
          if (seen.has(marker)) continue;

          if (config.since && start < config.since) continue;
          if (config.until && start > config.until) continue;

          seen.add(marker);
          selected.push(item);
          if (this.shouldStopExtracting(selected.length)) break;
        }
        if (this.shouldStopExtracting(selected.length)) break;
      }
      if (this.shouldStopExtracting(selected.length)) break;
    }

    this.logInitStep(
      `Emitting ${selected.length} records ` +
        `(${selected.filter(s => s.recordType === 'places').length} places, ` +
        `${selected.filter(s => s.recordType === 'moves').length} moves)`
    );

    for (const { data, recordType } of selected) {
      yield this.createRecord(data, { recordType, person });
    }
  }

  override async determineCount(): Promise<number | null> {
    const config = this.config as z.infer<typeof MovesExtractor.schema>;

    try {
      const seen = new Set<string>();
      for await (const day of this.readDays(config.input)) {
        for (const segment of day.segments ?? []) {
          for (const item of this.selectFrom(segment)) {
            const start = parseMovesTime(item.data.startTime);
            if (!start) continue;
            if (config.since && start < config.since) continue;
            if (config.until && start > config.until) continue;
            seen.add(`${item.recordType}:${start.toISOString()}`);
          }
        }
      }
      const limit = this.getEffectiveLimit();
      return limit === null ? seen.size : Math.min(seen.size, limit);
    } catch {
      return null;
    }
  }

  // The records a segment yields. A stay is one record. Movement splits into
  // its legs — each carries a single mode of travel, its own distance, and its
  // own track, which is what a Journey holds. A leg recorded while at a place
  // (walking around inside a venue) went nowhere, so it yields nothing.
  private selectFrom(segment: MovesSegment): Selected[] {
    if (segment.type === 'place') {
      return segment.place ? [{ data: segment, recordType: 'places' }] : [];
    }
    return (segment.activities ?? []).map(activity => ({
      data: activity,
      recordType: 'moves' as const,
    }));
  }

  // The storyline days, newest first, so `--limit N` yields the N most recent
  // records. A day file is read and released one at a time; the single full
  // file is read whole, because it is one JSON array.
  private async *readDays(input: string): AsyncGenerator<MovesDay> {
    const config = this.config as z.infer<typeof MovesExtractor.schema>;
    const source = await this.resolveInput(input);

    // The since/until window, widened by a day at each edge: a file is named
    // for the local day it covers and the window is UTC, so a file just outside
    // the window can still hold a segment inside it. The per-segment check is
    // what decides; this only skips files that cannot contribute.
    const sinceKey = config.since ? shiftDayKey(dayKey(config.since), -1) : undefined;
    const untilKey = config.until ? shiftDayKey(dayKey(config.until), 1) : undefined;

    if (source.kind === 'file') {
      const days = JSON.parse(await readFile(source.path, 'utf-8')) as MovesDay[];
      for (const day of [...days].reverse()) {
        if (sinceKey && day.date < sinceKey) break;
        if (untilKey && day.date > untilKey) continue;
        yield day;
      }
      return;
    }

    for (const { path, key } of source.files) {
      // Day keys sort chronologically, so every remaining file is older still.
      if (sinceKey && key < sinceKey) break;
      if (untilKey && key > untilKey) continue;
      const days = JSON.parse(await readFile(path, 'utf-8')) as MovesDay[];
      for (const day of [...days].reverse()) yield day;
    }
  }

  // Resolve the input to the storyline itself. The input may be the folder of
  // daily files, a single storyline JSON file, or a parent that is easier to
  // point at — the export root or its json/ folder. The daily folder wins when
  // both are present: it holds the same data, and a limited or windowed run
  // only opens the files it needs.
  private async resolveInput(
    input: string
  ): Promise<
    { kind: 'daily'; files: { path: string; key: string }[] } | { kind: 'file'; path: string }
  > {
    const dailyDirs = [
      input,
      join(input, 'daily', 'storyline'),
      join(input, 'json', 'daily', 'storyline'),
    ];
    for (const dir of dailyDirs) {
      const files = await this.listDayFiles(dir);
      if (files.length > 0) return { kind: 'daily', files };
    }

    const fullFiles = [
      input,
      join(input, 'full', 'storyline.json'),
      join(input, 'json', 'full', 'storyline.json'),
    ];
    for (const path of fullFiles) {
      if (!path.endsWith('.json')) continue;
      try {
        if ((await stat(path)).isFile()) return { kind: 'file', path };
      } catch {
        continue; // Not there — try the next candidate.
      }
    }

    throw new Error(
      `No Moves storyline found under ${input} — expected a folder of ` +
        `storyline_YYYYMMDD.json files or a storyline.json, in there, in ` +
        `daily/storyline/, in full/, or under json/`
    );
  }

  // The daily storyline files in a folder, newest first. An empty list means
  // this folder is not the one.
  private async listDayFiles(dir: string): Promise<{ path: string; key: string }[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return []; // Not a directory — the caller tries the next candidate.
    }
    return entries
      .map(name => DAILY_FILE.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(match => ({ path: join(dir, match[0]), key: match[1] }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }
}
