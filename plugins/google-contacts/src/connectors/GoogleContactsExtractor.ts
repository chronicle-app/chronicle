import { Extractor, Record } from '@chronicle.app/etl';
import { GoogleApi, googleAccountOptions } from '@chronicle.app/google';
import { z } from 'zod';
import GoogleContactsTransformer from './GoogleContactsTransformer.js';
import type { ContactPerson, ContactRecord } from '../types.js';

/** The fields read for each contact. */
const PERSON_FIELDS = [
  'names',
  'nicknames',
  'emailAddresses',
  'phoneNumbers',
  'organizations',
  'biographies',
  'photos',
  'urls',
  'memberships',
  'metadata',
].join(',');

/** Google Contacts' own labels by the names it shows; "My Contacts" is everyone, so it isn't one. */
const SYSTEM_GROUPS: { [resourceName: string]: string | undefined } = {
  'contactGroups/starred': 'Starred',
  'contactGroups/friends': 'Friends',
  'contactGroups/family': 'Family',
  'contactGroups/coworkers': 'Coworkers',
};

/**
 * Your Google Contacts, most recently edited first. The People API keeps no
 * history: a contact says only when it was last edited, so each run reads
 * the current state, dated by that edit.
 */
export class GoogleContactsExtractor extends Extractor<typeof GoogleContactsExtractor> {
  static override source = 'google-contacts';
  static override description = 'Your Google Contacts';
  static override delivery = 'api' as const;
  static override strategy = 'api';
  static override recordTypes = ['contacts'];
  static override default = true;
  static override temporality = 'snapshot' as const;
  static override newestFirst = true;
  static override defaultTransformer = GoogleContactsTransformer;
  /** Swapped for a fake server in tests. */
  static apiBaseURL = 'https://people.googleapis.com/v1';

  static override schema = Extractor.schema.extend({ ...googleAccountOptions });

  private api!: GoogleApi;
  private groupNames = new Map<string, string>();

  override keyOf(record: Record): string {
    return (record.data as ContactRecord).person.resourceName;
  }

  override occurredAt(record: Record): Date | undefined {
    const at = lastEdited((record.data as ContactRecord).person);
    return at ? new Date(at) : undefined;
  }

  override async setup(): Promise<void> {
    await super.setup();
    const config = this.config as z.infer<typeof GoogleContactsExtractor.schema>;
    this.api = new GoogleApi({
      service: 'contacts',
      baseURL: GoogleContactsExtractor.apiBaseURL,
      account: config.account,
      accessToken: config.accessToken,
    });
    await this.api.initialize();
    const groups = this.api.pages<{ resourceName: string; name?: string; groupType?: string }>(
      '/contactGroups',
      { pageSize: 1000 },
      'contactGroups'
    );
    for await (const group of groups) {
      const name =
        group.groupType === 'USER_CONTACT_GROUP' ? group.name : SYSTEM_GROUPS[group.resourceName];
      if (name) this.groupNames.set(group.resourceName, name);
    }
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof GoogleContactsExtractor.schema>;
    const people = this.api.pages<ContactPerson>(
      '/people/me/connections',
      { personFields: PERSON_FIELDS, sortOrder: 'LAST_MODIFIED_DESCENDING', pageSize: 1000 },
      'connections'
    );
    let count = 0;
    for await (const person of people) {
      // Most recently edited first, so the window's start ends the read.
      const edited = lastEdited(person);
      if (config.since && edited && new Date(edited) < config.since) return;
      if (config.until && edited && new Date(edited) > config.until) continue;
      const labels = (person.memberships ?? [])
        .map(membership => membership.contactGroupMembership?.contactGroupResourceName)
        .map(group => (group ? this.groupNames.get(group) : undefined))
        .filter((name): name is string => name !== undefined);
      const data: ContactRecord = { person, labels };
      yield this.createRecord(data, { recordType: 'contacts' });
      if (this.shouldStopExtracting(++count)) return;
    }
  }

  override recordToString(data?: ContactRecord): string {
    return data?.person?.names?.[0]?.displayName ?? 'google-contacts.contacts';
  }
}

/**
 * When you last edited the contact: your own card's update time. A contact
 * also carries the person's own Google profile as a source, whose time moves
 * when they change their photo or name, which says nothing about you.
 */
export function lastEdited(person: ContactPerson): string | undefined {
  return (person.metadata?.sources ?? [])
    .filter(source => source.type === 'CONTACT')
    .map(source => source.updateTime)
    .flatMap(time => (time ? [time] : []))
    .sort()
    .at(-1);
}
