import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Record } from '@chronicle.app/etl';
import {
  APPLE_EPOCH_OFFSET_SECONDS,
  SqliteExtractor,
  getRow,
  iterateRows,
  timeRangeConditions,
  unixToSafariTimestamp,
} from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/icloud';
import { z } from 'zod';
import { readRecordingMetadata } from '../mp4.js';
import { parseTranscript, type Transcript } from '../transcript.js';
import AppleVoiceMemosTransformer from './AppleVoiceMemosTransformer.js';

const DEFAULT_DB = `${process.env.HOME}/Library/Group Containers/group.com.apple.VoiceMemos.shared/Recordings/CloudRecordings.db`;

// since/until bounds land on ZDATE, which is seconds since the Apple epoch.
const appleBound = (date: Date) => unixToSafariTimestamp(date.getTime() / 1000);

// A memo moved to Recently Deleted has an eviction date. It's left out.
const NOT_DELETED = 'ZEVICTIONDATE IS NULL';

/** One recording as the library row and its file give it, named after the row's Core Data attributes. */
export interface VoiceMemo {
  /** The recording's UUID, which Voice Memos also writes into the audio file. */
  uniqueID: string;
  /** When recording started, in UTC. */
  date: string;
  /** How long the recording lasts, in seconds. */
  duration: number;
  /** The title. `New Recording 3` and the like until it's renamed. */
  title: string | null;
  /** The audio file's name in the library's folder, which starts with the local start time. */
  path: string | null;
  flags: number;
  /** The audio file's absolute path, when it's on this Mac. */
  file: string | null;
  /** The file's `©too` tag: the app and the kind of device that recorded it. */
  encoder: string | null;
  /** The transcript Voice Memos made, when the file has one. */
  transcript: Transcript | null;
  /**
   * When the file was last saved, in UTC, from its movie header. Voice Memos
   * saves a transcript into the file, so this is when the transcript was
   * written, or a later edit.
   */
  modified: string | null;
}

/** A ZCLOUDRECORDING row, as the query selects it. */
interface Row {
  uniqueID: string;
  date: number;
  duration: number | null;
  title: string | null;
  path: string | null;
  flags: number | null;
}

/**
 * The Voice Memos library. It syncs through iCloud, so it holds the
 * recordings made on every device signed in to the account. Their audio
 * files sit beside the database.
 */
export class AppleVoiceMemosExtractor extends SqliteExtractor<typeof AppleVoiceMemosExtractor> {
  static override source = 'apple-voice-memos';
  static override description = 'Your Voice Memos recordings and their transcripts';

  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override recordTypes = ['recordings'];
  static override default = true;
  static override defaultTransformer = AppleVoiceMemosTransformer;
  static override newestFirst = true;

  static override schema = SqliteExtractor.schema.omit({ input: true }).extend({
    input: z.string().describe('Path to CloudRecordings.db').default(DEFAULT_DB),
    account: z
      .object({
        accountID: z.string(),
        email: z.string(),
        displayName: z.string(),
        dsid: z.string().optional(),
      })
      .nullable()
      .optional(),
  }) as any;

  /** The recording's UUID: the same in the library and in the audio file. */
  override keyOf(record: Record): string | null {
    return (record.data as VoiceMemo).uniqueID ?? null;
  }

  override occurredAt(record: Record): Date | undefined {
    return new Date((record.data as VoiceMemo).date);
  }

  private query(select: string): { sql: string; values: Array<number | string> } {
    const range = timeRangeConditions('ZDATE', this.config, { convert: appleBound });
    const where = [
      'ZUNIQUEID IS NOT NULL',
      'ZDATE IS NOT NULL',
      NOT_DELETED,
      ...range.conditions,
    ].join(' AND ');
    return { sql: `SELECT ${select} FROM ZCLOUDRECORDING WHERE ${where}`, values: range.values };
  }

  async *extract(): AsyncGenerator<Record> {
    if (!this.db) throw new Error('Database not initialized');

    const { sql, values } = this.query(`
      ZUNIQUEID AS uniqueID, ZDATE AS date, ZDURATION AS duration,
      ZENCRYPTEDTITLE AS title, ZPATH AS path, ZFLAGS AS flags`);
    let ordered = `${sql} ORDER BY ZDATE DESC`;
    const limit = this.getEffectiveLimit();
    if (limit !== null) {
      ordered += ' LIMIT ?';
      values.push(limit);
    }

    const account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;
    const folder = dirname(this.config.input);

    for (const row of iterateRows<Row>(this.db.prepare(ordered), ...values)) {
      yield this.createRecord(this.memoOf(row, folder), { account });
    }
  }

  private memoOf(row: Row, folder: string): VoiceMemo {
    const file = row.path ? onDisk(join(folder, row.path)) : null;
    const metadata = file ? this.readFile(file) : null;
    return {
      uniqueID: row.uniqueID,
      date: appleDate(row.date),
      duration: row.duration ?? 0,
      title: row.title ?? null,
      path: row.path ?? null,
      flags: row.flags ?? 0,
      file,
      encoder: metadata?.encoder ?? null,
      transcript: metadata?.transcript ? this.parse(metadata.transcript) : null,
      modified: metadata?.modified?.toISOString() ?? null,
    };
  }

  // A file that doesn't read loses only its tags, transcript, and time, not the memo.
  private readFile(file: string) {
    try {
      return readRecordingMetadata(file);
    } catch (error) {
      this.logger.warn(`Can't read a voice memo's audio file: ${(error as Error).message}`);
      return null;
    }
  }

  private parse(json: string): Transcript | null {
    try {
      return parseTranscript(json);
    } catch (error) {
      this.logger.warn(`Can't read a voice memo's transcript: ${(error as Error).message}`);
      return null;
    }
  }

  override async determineCount(): Promise<number | null> {
    if (!this.db) return null;
    try {
      const { sql, values } = this.query('COUNT(*) AS n');
      return getRow<{ n: number }>(this.db.prepare(sql), ...values)?.n ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * The file, when it's on this Mac. A recording iCloud hasn't downloaded has
 * no file, or an empty one.
 */
function onDisk(file: string): string | null {
  try {
    return statSync(file).size > 0 ? file : null;
  } catch {
    return null;
  }
}

function appleDate(seconds: number): string {
  return new Date((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}
