import { extname } from 'node:path';
import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { ActionAndChildren, AudioObject, CreateAction } from '@chronicle.app/schema';
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
 *   CreateAction  agent: you   startTime, endTime
 *     result: AudioObject  (the recording, by its UUID)   transcript?
 */
export default class AppleVoiceMemosTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'recordings') return [];
    const memo = record.data as VoiceMemo;
    // Without an iCloud account the recorder can't be identified, so omit them.
    const recorder = await buildICloudPersonSchema(record.context.account);
    const start = new Date(memo.date);

    const action: CreateAction = {
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: memo.uniqueID,
      startTime: start,
      endTime: new Date(start.getTime() + memo.duration * 1000),
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
    ...(memo.transcript?.text && { transcript: memo.transcript.text }),
  };
}
