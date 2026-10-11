import { extname } from 'node:path';
import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AudioObject,
  Person,
  RecordAction,
  SoftwareApplication,
  TranscribeAction,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import type { VoiceMemo } from './AppleVoiceMemosExtractor.js';

const SOURCE = 'apple-voice-memos';

// What each kind of recording file is. `.qta` is a QuickTime audio movie,
// which macOS declares as `audio/x-quicktime`.
const MIME_TYPES: { [extension: string]: string } = {
  '.m4a': 'audio/mp4',
  '.qta': 'audio/x-quicktime',
};

// The app that recognized the speech, by its bundle ID, as Timing names apps.
const VOICE_MEMOS: SoftwareApplication = {
  '@type': 'SoftwareApplication',
  '@key': ['@type', 'source', 'handle'],
  source: 'apple-bundle-id',
  handle: 'com.apple.VoiceMemos',
  name: 'Voice Memos',
};

/**
 *   RecordAction  agent: you   timestamp (when recording started)
 *     result: AudioObject  (the recording, by its UUID)
 *   TranscribeAction  agent: you   instrument: Voice Memos   timestamp (when the file was saved)
 *     result: Transcript  (by the recording's UUID)   body
 *       isBasedOn: AudioObject  (the recording)
 */
export default class AppleVoiceMemosTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'recordings') return [];
    const memo = record.data as VoiceMemo;
    // Without an iCloud account the recorder can't be identified, so omit them.
    const recorder = await buildICloudPersonSchema(record.context.account);

    // Voice Memos keeps when recording started but not when it stopped: a
    // memo can be paused, resumed later, or trimmed, so the start plus the
    // recording's duration isn't always the end.
    const recording: RecordAction = {
      '@type': 'RecordAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: memo.uniqueID,
      timestamp: new Date(memo.date),
      ...(recorder && { agent: recorder }),
      result: buildRecording(memo),
    };
    const transcription = buildTranscription(memo, recorder);
    return transcription ? [recording, transcription] : [recording];
  }
}

/** The recording, keyed by its UUID, with its file when it's on this Mac. */
function buildRecording(memo: VoiceMemo): AudioObject {
  const mimeType = memo.file ? MIME_TYPES[extname(memo.file).toLowerCase()] : undefined;
  return {
    '@type': 'AudioObject',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: memo.uniqueID,
    ...(memo.title && { name: memo.title }),
    duration: `PT${Math.floor(memo.duration)}S`,
    ...(memo.file && { contentPath: memo.file }),
    ...(mimeType && { mimeType }),
  };
}

/**
 * Voice Memos' transcript of the recording, made when it saved the transcript
 * into the file. None when it heard no speech, or the file has no save time.
 */
function buildTranscription(memo: VoiceMemo, recorder: Person | null): TranscribeAction | null {
  if (!memo.transcript?.text || !memo.modified) return null;
  const key = { '@key': ['@type', 'source', 'sourceId'], source: SOURCE, sourceId: memo.uniqueID };
  return {
    '@type': 'TranscribeAction',
    ...key,
    timestamp: new Date(memo.modified),
    ...(recorder && { agent: recorder }),
    instrument: VOICE_MEMOS,
    result: {
      '@type': 'Transcript',
      ...key,
      body: memo.transcript.text,
      isBasedOn: [{ '@type': 'AudioObject', ...key }],
    },
  };
}
