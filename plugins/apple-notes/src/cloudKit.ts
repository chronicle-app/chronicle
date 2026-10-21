import { parseBinaryPlist, Uid, type PlistValue } from '@chronicle.app/apple';

/**
 * Notes keeps the CloudKit record it last synced for each note, and the share
 * behind each shared one, as NSKeyedArchiver archives. CloudKit names a person
 * by a user ID that is theirs in Notes alone, the same in every note: it
 * gives each Apple Account a different ID in each app.
 * It names the current user `__defaultOwner__` in their own records.
 */
export const CURRENT_USER = '__defaultOwner__';

/** Someone a share lists, as iCloud showed them when the share last synced. */
export interface Participant {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

type Entry = { [key: string]: PlistValue };

function archive(bytes: Uint8Array) {
  const plist = parseBinaryPlist(bytes) as Entry | null;
  const objects = plist?.$objects;
  if (plist?.$archiver !== 'NSKeyedArchiver' || !Array.isArray(objects)) {
    throw new Error('Not a keyed archive');
  }
  // Entry 0 is `$null`, the archive's nil.
  const deref = (value: PlistValue | undefined): PlistValue | undefined =>
    value instanceof Uid ? (value.index === 0 ? null : objects[value.index]) : value;
  /** Follow keys from an object, through the archive's references. */
  const path = (value: PlistValue | undefined, ...keys: string[]): PlistValue | undefined => {
    for (const key of keys) {
      const object = deref(value);
      if (!object || typeof object !== 'object' || Array.isArray(object)) return undefined;
      value = (object as Entry)[key];
    }
    return deref(value);
  };
  return { top: (plist.$top ?? null) as PlistValue, objects, path };
}

const text = (value: PlistValue | undefined) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** The CloudKit user ID of whoever created a record (`ZSERVERRECORDDATA`). */
export function recordCreator(bytes: Uint8Array): string | null {
  const { top, path } = archive(bytes);
  return text(path(top, 'CreatorUserRecordID', 'RecordName'));
}

/** The CloudKit user ID of whoever last changed a record (`ZSERVERRECORDDATA`). */
export function recordModifier(bytes: Uint8Array): string | null {
  const { top, path } = archive(bytes);
  return text(path(top, 'LastModifiedUserRecordID', 'RecordName'));
}

/**
 * The people a share (`ZSERVERSHAREDATA`) lists, with the name, email, and
 * phone iCloud has for each. An invitation not yet accepted has no CloudKit
 * user ID, so it's left out.
 */
export function shareParticipants(bytes: Uint8Array): Participant[] {
  const { objects, path } = archive(bytes);
  const participants: Participant[] = [];
  for (const object of objects) {
    if (path(object, '$class', '$classname') !== 'CKShareParticipant') continue;
    const id = text(path(object, 'UserIdentity', 'UserRecordID', 'RecordName'));
    if (!id) continue;
    const parts = ['NS.givenName', 'NS.familyName'].map(part =>
      text(path(object, 'UserIdentity', 'NameComponents', 'NS.nameComponentsPrivate', part))
    );
    participants.push({
      id,
      name: parts.filter(Boolean).join(' ') || null,
      email: text(path(object, 'UserIdentity', 'LookupInfo', 'EmailAddress')),
      phone: text(path(object, 'UserIdentity', 'LookupInfo', 'PhoneNumber')),
    });
  }
  return participants;
}
