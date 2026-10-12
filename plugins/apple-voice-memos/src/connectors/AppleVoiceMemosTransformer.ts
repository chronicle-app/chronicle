import { extname } from 'node:path';
import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AudioObject,
  OperatingSystem,
  ProductModel,
  RecordAction,
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
 *     instrument?: OperatingSystem  (the release the file names, as written)
 *                  ProductModel?    (the kind of device, by its Wikidata ID)
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
 * tag never says which device. A tag that doesn't name an OS release, or that
 * iOS 13 left when it rewrote an older file, gives none.
 */
function buildInstrument(memo: VoiceMemo): Array<OperatingSystem | ProductModel> {
  const recorder = memo.encoder ? readEncoder(memo.encoder, new Date(memo.date)) : null;
  if (!recorder) return [];
  const release: OperatingSystem = {
    '@type': 'OperatingSystem',
    '@key': ['@type', 'source', 'handle'],
    source: SOURCE,
    handle: recorder.release,
  };
  if (!recorder.line) return [release];
  const { wikidataId, name } = recorder.line;
  return [
    release,
    // Keyed like an ISBN: by the ID alone, so anything naming the same item
    // merges with it. Its page's address, as a browser records it, joins a
    // visit to that page.
    {
      '@type': 'ProductModel',
      '@key': ['source', 'sourceId'],
      source: 'wikidata',
      sourceId: wikidataId,
      name,
      url: `https://www.wikidata.org/wiki/${wikidataId}`,
    },
  ];
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
