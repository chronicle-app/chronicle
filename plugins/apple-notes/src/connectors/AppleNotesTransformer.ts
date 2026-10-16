import {
  ChronicleTransformer,
  normalizePhoneNumber,
  Record,
  selfAgent,
  tidyText,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  Collection,
  CreateAction,
  Device,
  MediaObjectAndChildren,
  Note,
  Person,
  Quotation,
  UpdateAction,
} from '@chronicle.app/schema';
import type { AppleNote, Attachment, Author, Edit } from './AppleNotesExtractor.js';

const SOURCE = 'apple-notes';

/**
 *   notes:  CreateAction  agent: who made it   timestamp (when the note was made)
 *             result: Note  (by its UUID)  body  isPartOf: Collection (folder)
 *                     contains: attachments
 *   edits:  UpdateAction  agent: who typed it   startTime–endTime
 *             object: Note
 *             instrument: Device  (the Notes install that typed it, by replica UUID)
 *             result: Quotation  (the text from the session that's still there)
 *
 * A person is keyed by their CloudKit user ID in Notes. You are tagged
 * as yourself; anyone else is linked by their email and phone to the same
 * person in other sources.
 */
export default class AppleNotesTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    switch (record.extraction.recordType) {
      case 'notes':
        return [this.created(record.data as AppleNote)];
      case 'edits':
        return [this.edited(record.data as Edit)];
      default:
        return [];
    }
  }

  private created(note: AppleNote): CreateAction {
    const work = noteWork(note.id, note.title);
    const body = note.body && tidyText(note.body);
    if (body) work.body = body;
    if (note.hashtags.length > 0) work.tags = note.hashtags;
    if (note.folder) work.isPartOf = [folder(note.folder)];
    const media = note.attachments.map(a => attachment(a)).filter(m => m !== null);
    if (media.length > 0) work.contains = media;
    return {
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: note.id,
      timestamp: new Date(note.created),
      ...(note.creator && { agent: person(note.creator) }),
      result: work,
    };
  }

  private edited(edit: Edit): UpdateAction {
    const work = noteWork(edit.note.id, edit.note.title);
    // The passage is the session's, so it's keyed by the session.
    const passage: Quotation = {
      '@type': 'Quotation',
      '@key': [
        '@type',
        'source',
        'action.object.sourceId',
        'action.agent.sourceId',
        'action.startTime',
      ],
      source: SOURCE,
      body: edit.text,
      isPartOf: [noteWork(edit.note.id, edit.note.title)],
    };
    const devices: Device[] = edit.replicas.map(replica => ({
      '@type': 'Device',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: replica,
    }));
    return {
      '@type': 'UpdateAction',
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId', 'startTime'],
      source: SOURCE,
      startTime: new Date(edit.start),
      endTime: new Date(edit.end),
      ...(edit.author && { agent: person(edit.author) }),
      object: work,
      ...(devices.length > 0 && { instrument: devices }),
      result: passage,
    } as UpdateAction;
  }
}

/** You, or someone else, by their CloudKit user ID in Notes. */
function person(author: Author): Person {
  // iCloud writes a number with its country code but without the plus.
  const phone = author.phone && normalizePhoneNumber(author.phone.replace(/^(?=\d+$)/, '+'));
  const sameAs: Agent[] = [
    ...(author.email ? [identity('email', author.email)] : []),
    ...(phone ? [identity('phone', phone)] : []),
  ];
  if (author.self) {
    return selfAgent({
      source: SOURCE,
      ...(author.id && { sourceId: author.id }),
      ...(author.name && { name: author.name }),
      sameAs,
    }) as Person;
  }
  return {
    '@type': 'Person',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: author.id!,
    ...(author.name && { name: author.name }),
    ...(sameAs.length > 0 && { sameAs }),
  };
}

/** An address or number, keyed as the email and messaging plugins key theirs. */
function identity(source: 'email' | 'phone', handle: string): Agent {
  return { '@type': 'Agent', '@key': ['@type', 'source', 'handle'], source, handle };
}

function noteWork(id: string, title: string | null): Note {
  return {
    '@type': 'Note',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: id,
    ...(title && { name: title }),
  };
}

function folder({ id, title }: NonNullable<AppleNote['folder']>): Collection {
  return {
    '@type': 'Collection',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: id,
    ...(title && { name: title }),
  };
}

const MEDIA: Array<[RegExp, MediaObjectAndChildren['@type']]> = [
  [/jpeg|png|heic|gif|tiff|image/, 'ImageObject'],
  [/pdf|com\.apple\.paper/, 'DocumentObject'],
  [/audio|m4a/, 'AudioObject'],
  [/movie|video|mpeg-4|quicktime/, 'VideoObject'],
];

/** A file attachment. Tables, drawings, and link previews aren't files, so they're left out. */
function attachment(a: Attachment): MediaObjectAndChildren | null {
  const type = MEDIA.find(([pattern]) => pattern.test(a.uti))?.[1];
  if (!type) return null;
  return {
    '@type': type,
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: a.id,
    ...(a.title && { name: a.title }),
    ...(a.file && { contentPath: a.file }),
  } as MediaObjectAndChildren;
}
