import { statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import {
  APPLE_EPOCH_OFFSET_SECONDS,
  SqliteExtractor,
  allRows,
  countsByMonth,
  getRow,
  iterateRows,
  monthSql,
  timeRangeConditions,
  unixToSafariTimestamp,
} from '@chronicle.app/etl-sqlite';
import { getICloudAccount } from '@chronicle.app/apple';
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
  /** How long the recording lasts, in seconds, when the library says. */
  duration: number | null;
  /** The title. `New Recording 3` and the like until it's renamed. */
  title: string | null;
  /** The audio file's name in the library's folder, which starts with the local start time. */
  path: string | null;
  flags: number;
  /** The audio file's absolute path, when it's on this Mac. */
  file: string | null;
  /** The file's `©too` tag: the app, and the kind of device and OS version that last wrote the file. */
  encoder: string | null;
  /** The transcript Voice Memos made, when the file has one. */
  transcript: Transcript | null;
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

  private libraryChanged: Date | null = null;
  // Files and transcripts that didn't read this run, for the run's summary.
  private unreadable = { files: 0, transcripts: 0 };

  override async setup(): Promise<void> {
    await super.setup();
    this.libraryChanged = lastChanged(this.config.input);
  }

  /**
   * When the library last changed, not when the run started. A recording's
   * title and transcript can change after it's recorded, so each record is
   * observed as of the library it was read from. An unchanged library gives
   * the same time on every run, so its records come out the same.
   */
  protected override asOfTime(): Date {
    return this.libraryChanged ?? super.asOfTime();
  }

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
    const folder = dirname(resolve(this.config.input));

    this.unreadable = { files: 0, transcripts: 0 };
    for (const row of iterateRows<Row>(this.db.prepare(ordered), ...values)) {
      yield this.createRecord(
        this.memoOf(row, folder),
        { account },
        { assertedAt: this.asOfTime() }
      );
    }
    this.hintUnreadable();
  }

  private memoOf(row: Row, folder: string): VoiceMemo {
    const file = row.path ? onDisk(join(folder, row.path)) : null;
    const metadata = file ? this.readFile(file) : null;
    return {
      uniqueID: row.uniqueID,
      date: appleDate(row.date),
      duration: row.duration ?? null,
      title: row.title ?? null,
      path: row.path ?? null,
      flags: row.flags ?? 0,
      file,
      encoder: metadata?.encoder ?? null,
      transcript: metadata?.transcript ? this.parse(metadata.transcript) : null,
    };
  }

  // A file that doesn't read loses only its tags and transcript, not the memo.
  private readFile(file: string) {
    try {
      return readRecordingMetadata(file);
    } catch (error) {
      this.logger.warn(`Can't read a voice memo's audio file: ${(error as Error).message}`);
      this.unreadable.files++;
      return null;
    }
  }

  private parse(json: string): Transcript | null {
    try {
      return parseTranscript(json);
    } catch (error) {
      this.logger.warn(`Can't read a voice memo's transcript: ${(error as Error).message}`);
      this.unreadable.transcripts++;
      return null;
    }
  }

  /**
   * Say when files or transcripts didn't read. The memos are kept, but a
   * format Voice Memos changed would otherwise only show in the log.
   */
  private hintUnreadable(): void {
    const { files, transcripts } = this.unreadable;
    const action =
      'Voice Memos may have changed how it stores recordings. Update Chronicle, and report it if that doesn’t help.';
    if (files > 0) {
      const memos =
        files === 1
          ? '1 audio file couldn’t be read, so its memo has'
          : `${files} audio files couldn’t be read, so their memos have`;
      this.hint(`${memos} no transcript or device`, { action });
    }
    if (transcripts > 0) {
      const memos =
        transcripts === 1
          ? '1 transcript couldn’t be read, so its memo has'
          : `${transcripts} transcripts couldn’t be read, so their memos have`;
      this.hint(`${memos} none`, { action });
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

  /** The recordings a run reads and when they started, with how long they last, to the second. */
  override async survey(options: SurveyOptions = {}): Promise<Survey | null> {
    if (!this.db) return null;
    const { sql, values } = this.query(
      `COUNT(*) AS n, MIN(ZDATE) AS first, MAX(ZDATE) AS last,
       COALESCE(ROUND(SUM(ZDURATION)), 0) AS seconds`
    );
    const row = getRow<{ n: number; first: number | null; last: number | null; seconds: number }>(
      this.db.prepare(sql),
      ...values
    )!;
    const months = this.query(
      `${monthSql(`ZDATE + ${APPLE_EPOCH_OFFSET_SECONDS}`)} AS month, COUNT(*) AS n`
    );
    const byMonth =
      options.byMonth &&
      countsByMonth(
        allRows<{ month: string | null; n: number }>(
          this.db.prepare(`${months.sql} GROUP BY month`),
          ...months.values
        )
      );
    return {
      recordings: {
        count: row.n,
        ...(row.first !== null && { earliest: new Date(appleDate(row.first)) }),
        ...(row.last !== null && { latest: new Date(appleDate(row.last)) }),
        ...(byMonth && { byMonth }),
        measures: [
          { key: 'recordingSeconds', label: 'recordings', value: row.seconds, unit: 'seconds' },
        ],
      },
    };
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

/**
 * When the library last changed: the database, or its write-ahead log, which
 * holds changes Core Data hasn't yet written back.
 */
function lastChanged(database: string): Date {
  const times = [database, `${database}-wal`].flatMap(file => {
    try {
      return [statSync(file).mtime.getTime()];
    } catch {
      return [];
    }
  });
  return new Date(Math.max(...times));
}

function appleDate(seconds: number): string {
  return new Date((seconds + APPLE_EPOCH_OFFSET_SECONDS) * 1000).toISOString();
}
