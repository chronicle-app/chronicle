import { extname } from 'node:path';
import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { ActionAndChildren, AudioObject, RecordAction } from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import type { VoiceMemo } from './AppleVoiceMemosExtractor.js';

const SOURCE = 'apple-voice-memos';

// What each kind of recording file is. `.qta` is a QuickTime audio movie,
// which macOS declares as `audio/x-quicktime`.
const MIME_TYPES: { [extension: string]: string } = {
  '.m4a': 'audio/mp4',
  '.qta': 'audio/x-quicktime',
};

/**
 *   RecordAction  agent: you   timestamp (when recording started)
 *     result: AudioObject  (the recording, by its UUID)   transcript?
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
    const action: RecordAction = {
      '@type': 'RecordAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: memo.uniqueID,
      timestamp: new Date(memo.date),
      ...(recorder && { agent: recorder }),
      result: buildRecording(memo),
    };
    return [action];
  }
}

/**
 * The recording, keyed by its UUID, with its file when it's on this Mac and
 * the transcript Voice Memos made, unless it heard no speech.
 */
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
    ...(memo.transcript?.text && { transcript: [memo.transcript.text] }),
  };
}
