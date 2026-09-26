import { Extractor, Record } from '@chronicle.app/etl';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import { AgentAndChildren } from '@chronicle.app/schema';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { ArcItem, ArcPlace, ArcSample, DailyExport } from '../types.js';
import ArcTimelineTransformer from './ArcTimelineTransformer.js';

// A daily backup file is named for the UTC day it covers ("YYYY-MM-DD.json.gz").
const DAILY_FILE = /^(\d{4}-\d{2}-\d{2})\.json\.gz$/;

// Arc Timeline's iCloud Drive container, where the app writes its daily backup.
const DEFAULT_EXPORTS = `${process.env.HOME}/Library/Mobile Documents/iCloud~com~bigpaua~Arc-Timeline-Editor/Documents/Exports`;

// The "YYYY-MM-DD" UTC key for a date; daily files are named by this key, so a
// trip's samples can be loaded from just the day file(s) covering its span.
function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The day keys (inclusive) that an item's [start, end] span touches — a trip
// that crosses midnight has its samples split across each day's file.
function coveringDayKeys(startDate: string, endDate: string): string[] {
  const start = new Date(startDate);
  const endMs = new Date(endDate).getTime();
  const keys: string[] = [];
  for (
    let ms = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    ms <= endMs;
    ms += 86_400_000
  ) {
    keys.push(dayKey(new Date(ms)));
  }
  return keys;
}

export class ArcTimelineExtractor extends Extractor<typeof ArcTimelineExtractor> {
  static override source = 'arc';
  static override description = 'Location timeline: visits and trips';

  static override delivery = 'local' as const;
  // The way in, in Arc's own vocabulary: the app's iCloud backup (the daily
  // YYYY-MM-DD.json.gz folder) — "timeline" named the product, not the way in.
  static override strategy = 'icloud-backup';
  static override recordTypes = ['visits', 'travels'];
  static override default = true;
  static override defaultTransformer = ArcTimelineTransformer;

  static override schema = Extractor.schema.extend({
    input: z
      .string()
      .default(DEFAULT_EXPORTS)
      .describe(
        "Path to the Arc Timeline daily backup — the folder of YYYY-MM-DD.json.gz files, or a parent such as the iCloud Exports or Exports/Daily directory; defaults to Arc's iCloud Drive Exports folder"
      ),
    identity: z
      .string()
      .optional()
      .describe(
        'Override the person whose timeline this is (e.g. an email); defaults to the macOS iCloud account'
      ),
  });

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof ArcTimelineExtractor.schema>;

    const person = await this.resolvePerson(config.identity);

    // Pass 1: select the items to emit, reading day files newest-first. Each
    // day's file is self-contained (its `places` resolve its visits), but an
    // item that spans midnight appears in two adjacent files, so dedupe on the
    // stable item id. `--limit N` yields the N most recent items, and the early
    // break keeps a limited run from reading the whole archive.
    const dir = await this.findDailyDir(config.input);
    const dayFiles = await this.listDayFiles(dir);
    const sinceKey = config.since ? dayKey(config.since) : undefined;
    const untilKey = config.until ? dayKey(config.until) : undefined;

    const seen = new Set<string>();
    const selected: {
      item: ArcItem;
      recordType: 'visits' | 'travels';
      place?: ArcPlace;
    }[] = [];

    for (const { path, key } of dayFiles) {
      // Day keys sort chronologically, so (newest-first) every remaining file
      // is older than `since`; and any file newer than `until` holds nothing in
      // range (an item's earliest day file is its start day).
      if (sinceKey && key < sinceKey) break;
      if (untilKey && key > untilKey) continue;

      const day = await this.readDayFile(path);
      const places = this.indexPlaces(day.places);

      for (const item of day.items.reverse()) {
        const { base } = item;
        if (!base || base.deleted) continue;
        if (seen.has(base.id)) continue;

        if (config.since || config.until) {
          const start = new Date(base.startDate);
          if (config.since && start < config.since) continue;
          if (config.until && start > config.until) continue;
        }

        if (item.visit || base.isVisit) {
          const place = item.visit?.placeId ? places.get(item.visit.placeId) : undefined;
          selected.push({ item, recordType: 'visits', place });
        } else if (item.trip) {
          selected.push({ item, recordType: 'travels' });
        } else {
          continue;
        }
        seen.add(base.id);

        if (this.shouldStopExtracting(selected.length)) break;
      }
      if (this.shouldStopExtracting(selected.length)) break;
    }

    // Load GPS samples for just the trips we'll emit, keyed by their item id.
    const trips = selected.filter(s => s.recordType === 'travels').map(s => s.item);
    const samplesByItem = await this.loadSamples(dir, trips);
    this.logInitStep(
      `Emitting ${selected.length} items (${trips.length} trips, ${samplesByItem.size} with samples)`
    );

    // Pass 2: emit. Trips carry their ordered samples; the transformer encodes
    // them into the Journey's path.
    for (const { item, recordType, place } of selected) {
      if (recordType === 'visits') {
        yield this.createRecord(item, { recordType, person, place });
      } else {
        yield this.createRecord(item, {
          recordType,
          person,
          samples: samplesByItem.get(item.base.id),
        });
      }
    }
  }

  // The person whose timeline this is: an explicit `--identity` override, else
  // the macOS iCloud account (so Arc data merges onto the same person as other
  // iCloud-sourced data). An override is keyed the same way, so it merges too.
  private async resolvePerson(identity?: string): Promise<AgentAndChildren> {
    if (identity) {
      return {
        '@type': 'Person',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'icloud',
        sourceId: identity,
        handle: identity,
      };
    }
    return (
      ((await buildICloudPersonSchema()) as AgentAndChildren | null) ?? {
        '@type': 'Person',
        '@key': ['@type', 'source'],
        source: 'icloud',
      }
    );
  }

  // GPS samples for the given trips, grouped by `timelineItemId` and ordered by
  // time. Only the day buckets covering the trips' spans are read, so a
  // `--limit` run touches a handful of files; a midnight-spanning trip's samples
  // are merged from each day its span touches.
  private async loadSamples(root: string, trips: ArcItem[]): Promise<Map<string, ArcSample[]>> {
    const byItem = new Map<string, ArcSample[]>();
    if (trips.length === 0) return byItem;

    const wantIds = new Set(trips.map(t => t.base.id));
    const dayKeys = new Set<string>();
    for (const t of trips) {
      for (const key of coveringDayKeys(t.base.startDate, t.base.endDate)) {
        dayKeys.add(key);
      }
    }

    for (const key of dayKeys) {
      let day: DailyExport;
      try {
        day = await this.readDayFile(join(root, `${key}.json.gz`));
      } catch {
        continue; // Day file missing — trip predates the backup, or a gap.
      }
      for (const s of day.samples) {
        if (!s.timelineItemId || !wantIds.has(s.timelineItemId)) continue;
        const arr = byItem.get(s.timelineItemId);
        if (arr) arr.push(s);
        else byItem.set(s.timelineItemId, [s]);
      }
    }

    for (const samples of byItem.values()) {
      samples.sort((a, b) => a.date.localeCompare(b.date));
    }
    return byItem;
  }

  override async determineCount(): Promise<number | null> {
    const config = this.config as z.infer<typeof ArcTimelineExtractor.schema>;

    try {
      const dir = await this.findDailyDir(config.input);
      const dayFiles = await this.listDayFiles(dir);
      const sinceKey = config.since ? dayKey(config.since) : undefined;
      const untilKey = config.until ? dayKey(config.until) : undefined;

      // Count distinct items in range (midnight-spanning items appear in two
      // files; the id set keeps the total honest).
      const seen = new Set<string>();
      for (const { path, key } of dayFiles) {
        if (sinceKey && key < sinceKey) break;
        if (untilKey && key > untilKey) continue;

        const day = await this.readDayFile(path);
        for (const item of day.items) {
          const { base } = item;
          if (!base || base.deleted) continue;
          if (config.since && new Date(base.startDate) < config.since) continue;
          if (config.until && new Date(base.startDate) > config.until) continue;
          seen.add(base.id);
        }
      }
      return config.limit ? Math.min(seen.size, config.limit) : seen.size;
    } catch {
      return null;
    }
  }

  // The day's place dictionary, keyed by place id, joined to visits via
  // `visit.placeId`. Scoped to the day, but complete for that day's visits.
  private indexPlaces(places: ArcPlace[]): Map<string, ArcPlace> {
    const byId = new Map<string, ArcPlace>();
    for (const place of places) {
      if (place?.id) byId.set(place.id, place);
    }
    return byId;
  }

  // Resolve the input to the directory that actually holds the day files. The
  // input may be that directory, or a parent the user finds it easier to point
  // at — the iCloud "Exports" folder or its "Daily" subfolder.
  private async findDailyDir(input: string): Promise<string> {
    const candidates = [
      input,
      join(input, 'JSON'), // …/Daily
      join(input, 'Daily', 'JSON'), // …/Exports
    ];

    for (const dir of candidates) {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue; // Not a directory — try the next candidate.
      }
      if (entries.some(name => DAILY_FILE.test(name))) return dir;
    }

    throw new Error(
      `No Arc Timeline daily backup files (YYYY-MM-DD.json.gz) found under ${input} ` +
        `(looked in there, in JSON/, and in Daily/JSON/)`
    );
  }

  // The daily backup files in a resolved directory, sorted by their day key
  // descending (newest first).
  private async listDayFiles(dir: string): Promise<{ path: string; key: string }[]> {
    const entries = await readdir(dir);
    return entries
      .map(name => DAILY_FILE.exec(name))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => ({ path: join(dir, m[0]), key: m[1] }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  private async readDayFile(path: string): Promise<DailyExport> {
    const buf = await readFile(path);
    const parsed = JSON.parse(gunzipSync(buf).toString('utf-8')) as DailyExport;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      places: Array.isArray(parsed.places) ? parsed.places : [],
      samples: Array.isArray(parsed.samples) ? parsed.samples : [],
    };
  }
}
