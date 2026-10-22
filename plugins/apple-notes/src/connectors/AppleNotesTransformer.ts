import {
  ChronicleTransformer,
  normalizePhoneNumber,
  Record,
  selfAgent,
  tidyText,
} from '@chronicle.app/etl';
import { buildICloudPersonSchema, lookupContact, type Contact } from '@chronicle.app/apple';
import {
  ActionAndChildren,
  Agent,
  AgentAndChildren,
  Changeset,
  Collection,
  CreateAction,
  MediaObjectAndChildren,
  Note,
  Person,
  UpdateAction,
} from '@chronicle.app/schema';
import type { AppleNote, Attachment, Author, Edit } from './AppleNotesExtractor.js';

const SOURCE = 'apple-notes';

/**
 *   notes:  UpdateAction  agent: who last wrote in it   timestamp (when it was last edited)
 *             object: Note  (by its UUID)  body  isPartOf: Collection (folder)
 *                     contains: attachments
 *           CreateAction  agent: who made it   timestamp (when the note was made)
 *             result: Note
 *   edits:  UpdateAction  agent: who typed it   startTime–endTime (each burst)
 *             object: Note
 *             result: Changeset  (the text from the session that's still there)
 *
 * You are your Apple Account, as the other Apple plugins key you. Anyone else
 * is keyed by their CloudKit user ID in Notes, and linked to the same person
 * in other sources by their emails, phone numbers, and Contacts card.
 */
export default class AppleNotesTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  private mePromise?: Promise<Person | null>;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    const me = await this.me();
    switch (record.extraction.recordType) {
      case 'notes': {
        const note = record.data as AppleNote;
        return [this.lastEdited(note, me), this.created(note, me)];
      }
      case 'edits':
        return [this.edited(record.data as Edit, me)];
      default:
        return [];
    }
  }

  // Optional config: `account` (an iCloud account, or null for none) and
  // `lookupContact` replace the host's iCloud account and Contacts lookups.
  private me(): Promise<Person | null> {
    this.mePromise ??= buildICloudPersonSchema(this.config.account);
    return this.mePromise;
  }

  /** The note's last edit, with the note as it has been since. */
  private lastEdited(note: AppleNote, me: Person | null): UpdateAction {
    const work = noteWork(note.id, note.title);
    const body = note.body && tidyText(note.body);
    if (body) work.body = body;
    if (note.hashtags.length > 0) work.tags = note.hashtags;
    if (note.folder) {
      const { owner } = note.folder;
      work.isPartOf = [folder(note.folder, owner?.id ? this.person(owner, null) : null)];
    }
    const media = note.attachments.map(a => mediaObject(a)).filter(m => m !== null);
    if (media.length > 0) work.contains = media;
    const { at, author } = note.lastEdit;
    return {
      '@type': 'UpdateAction',
      '@key': ['@type', 'source', 'object.sourceId', 'timestamp'],
      source: SOURCE,
      timestamp: new Date(at),
      ...(author && { agent: this.person(author, me) }),
      object: work,
    } as UpdateAction;
  }

  private created(note: AppleNote, me: Person | null): CreateAction {
    return {
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: note.id,
      timestamp: new Date(note.created),
      ...(note.creator && { agent: this.person(note.creator, me) }),
      result: noteWork(note.id, note.title),
    };
  }

  private edited(edit: Edit, me: Person | null): UpdateAction {
    const work = noteWork(edit.note.id, edit.note.title);
    // The changeset is the session's, so it's keyed by the session.
    const changeset: Changeset = {
      '@type': 'Changeset',
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
    return {
      '@type': 'UpdateAction',
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId', 'startTime'],
      source: SOURCE,
      startTime: new Date(edit.start),
      endTime: new Date(edit.end),
      ...(edit.author && { agent: this.person(edit.author, me) }),
      object: work,
      result: changeset,
    } as UpdateAction;
  }

  /**
   * You, by your Apple Account, or as Notes knows you without one. Anyone else,
   * by their CloudKit user ID in Notes, with every address the shares list and
   * the Contacts card each one finds.
   */
  private person(author: Author, me: Person | null): Person {
    if (author.self) {
      // A copy for each payload, since a snapshot marks every node it holds.
      if (me) return structuredClone(me);
      return selfAgent({
        source: SOURCE,
        ...(author.id && { sourceId: author.id }),
        ...(author.name && { name: author.name }),
      }) as Person;
    }
    const lookup: (handle: string) => Contact | null = this.config.lookupContact ?? lookupContact;
    // iCloud writes a number with its country code but without the plus.
    const listed = author.phones.map(phone =>
      normalizePhoneNumber(phone.replace(/^(?=\d+$)/, '+'))
    );
    const contacts: Contact[] = [];
    for (const handle of distinct([...author.emails, ...listed])) {
      const contact = lookup(handle);
      if (
        contact &&
        !contacts.some(known => known === contact || (known.id && known.id === contact.id))
      )
        contacts.push(contact);
    }
    const emails = distinct([...author.emails, ...contacts.flatMap(c => c.emails)], email =>
      email.trim().toLowerCase()
    );
    const phones = distinct([
      ...listed,
      ...contacts.flatMap(c => c.phoneNumbers.map(phone => normalizePhoneNumber(phone))),
    ]);
    const sameAs: AgentAndChildren[] = [
      ...emails.map(email => identity('email', email)),
      ...phones.map(phone => identity('phone', phone)),
      ...contacts.filter(contact => contact.id).map(contact => contactNode(contact)),
    ];
    const name = author.name ?? contacts.find(contact => contact.fullName)?.fullName;
    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: author.id!,
      ...(name && { name }),
      ...(sameAs.length > 0 && { sameAs }),
    };
  }
}

/** Each value once, in its first spelling, compared by `as`. */
function distinct(values: Array<string | null>, as: (value: string) => string = value => value) {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(as(value))) return false;
    seen.add(as(value));
    return true;
  });
}

/** An address or number, keyed as the email and messaging plugins key theirs. */
function identity(source: 'email' | 'phone', handle: string): Agent {
  return { '@type': 'Agent', '@key': ['@type', 'source', 'handle'], source, handle };
}

/**
 * The Contacts card, keyed on its portable ID as Call History keys it. Typed
 * from the card: a person has a name, and a card with only a company is an
 * organization.
 */
function contactNode(contact: Contact): AgentAndChildren {
  return {
    '@type':
      contact.firstName || contact.lastName
        ? 'Person'
        : contact.organization
          ? 'Organization'
          : 'Agent',
    '@key': ['source', 'sourceId'],
    source: 'apple-contacts',
    sourceId: contact.id,
    ...(contact.fullName && { name: contact.fullName }),
  } as AgentAndChildren;
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

/**
 * A folder, in the account of whoever owns it, as Notes knows them. Notes
 * names its own folders the same in every account, such as
 * `DefaultFolder-CloudKit`, so an ID is unique only within its owner's.
 */
function folder({ id, title }: NonNullable<AppleNote['folder']>, owner: Person | null): Collection {
  return {
    '@type': 'Collection',
    '@key': ['@type', 'source', 'inAccount[*].sourceId', 'sourceId'],
    source: SOURCE,
    sourceId: id,
    ...(title && { name: title }),
    ...(owner && { inAccount: [owner] }),
  };
}

const MEDIA: Array<[RegExp, MediaObjectAndChildren['@type']]> = [
  [/jpeg|png|heic|gif|tiff|image/, 'ImageObject'],
  [/pdf|com\.apple\.paper/, 'DocumentObject'],
  [/audio|m4a/, 'AudioObject'],
  [/movie|video|mpeg-4|quicktime/, 'VideoObject'],
];

/**
 * A file attachment, as the note `contains` it and its text names it. Tables,
 * drawings, and link previews aren't files, so they have none.
 */
export function mediaObject(a: Attachment): MediaObjectAndChildren | null {
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
