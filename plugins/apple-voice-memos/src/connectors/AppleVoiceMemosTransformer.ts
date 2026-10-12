import { extname } from 'node:path';
import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AudioObject,
  ProductModel,
  RecordAction,
  SoftwareApplication,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import { readEncoder } from '../encoder.js';
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
 *     instrument?: SoftwareApplication  (the OS release the file names)
 *                  ProductModel?        (the kind of device, by its Wikidata URL)
 *     result: AudioObject  (the recording, by its UUID)   transcript?
 */
export default class AppleVoiceMemosTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'recordings') return [];
    const memo = record.data as VoiceMemo;
    // Without an iCloud account the recorder can't be identified, so omit them.
    const recorder = await buildICloudPersonSchema(record.context.account);
    const instrument = buildInstrument(memo);

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
      ...(instrument.length > 0 && { instrument }),
      result: buildRecording(memo),
    };
    return [action];
  }
}

/**
 * What the recording was made on, from its file's encoder tag: the OS release,
 * as the tag writes it, and the kind of device when the tag names one. The
 * tag never says which device. A tag left by a later rewrite of the file says
 * nothing about the recording, so it gives none.
 */
function buildInstrument(memo: VoiceMemo): Array<SoftwareApplication | ProductModel> {
  const recorder = memo.encoder ? readEncoder(memo.encoder, new Date(memo.date)) : null;
  if (!recorder) return [];
  const release: SoftwareApplication = {
    '@type': 'SoftwareApplication',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: recorder.release,
    name: recorder.release,
  };
  if (!recorder.line) return [release];
  return [release, { '@type': 'ProductModel', '@key': ['url'], ...recorder.line }];
}

/**
 * The recording, keyed by its UUID, with its file when it's on this Mac and
 * the transcript Voice Memos made, unless it heard no speech.
 */
function buildRecording(memo: VoiceMemo): AudioObject {
  const mimeType = memo.file ? MIME_TYPES[extname(memo.file).toLowerCase()] : undefined;
  const transcript = memo.transcript?.text.trim();
  return {
    '@type': 'AudioObject',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: memo.uniqueID,
    ...(memo.title && { name: memo.title }),
    ...(memo.duration !== null && { duration: `PT${Math.floor(memo.duration)}S` }),
    ...(memo.file && { contentPath: memo.file }),
    ...(mimeType && { mimeType }),
    ...(transcript && { transcript }),
  };
}
