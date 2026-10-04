import {
  ChronicleTransformer,
  Record,
  createImageObject,
  htmlToMarkdown,
  normalizePhoneNumber,
  selfAgent,
  tidyText,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  Organization,
  Person,
  UpdateAction,
} from '@chronicle.app/schema';
import { lastEdited } from './GoogleContactsExtractor.js';
import type { ContactPerson, ContactRecord } from '../types.js';

const source = 'google-contacts';

/**
 * A contact is a `Person`, carried by the `UpdateAction` of your last edit to
 * it: the store takes actions, and when you last edited a contact is the one
 * date Google keeps. A later edit is a new action, so runs over time build a
 * history of edits.
 *
 * The contact is linked (`sameAs`) to the identities other sources key a
 * person by: each email address in the `email` namespace and each phone
 * number in the `phone` namespace. That's what puts its name on the people
 * in your mail, calendar, and messages.
 */
export default class GoogleContactsTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'contacts') return [];
    const { person, labels } = record.data as ContactRecord;
    if (person.metadata?.deleted) return [];
    const contact = this.buildPerson(person, labels);
    const edited = lastEdited(person) ?? record.extraction.assertedAt;

    const update: UpdateAction = {
      '@type': 'UpdateAction',
      '@key': ['@type', 'source', 'object.sourceId', 'timestamp'],
      source,
      agent: selfAgent({ source }),
      object: contact,
      ...(edited && { timestamp: new Date(edited) }),
    };
    return [update];
  }

  private buildPerson(person: ContactPerson, labels: string[]): Person {
    const id = person.resourceName.replace(/^people\//, '');
    const name = primary(person.names)?.displayName;
    const biography = person.biographies?.[0];
    const description = biography?.value
      ? tidyText(
          biography.contentType === 'TEXT_HTML'
            ? (htmlToMarkdown(biography.value) ?? '')
            : biography.value
        )
      : '';
    const photo = person.photos?.find(candidate => candidate.url && !candidate.default);
    const organizations = (person.organizations ?? [])
      .filter(organization => organization.name && organization.current !== false)
      .map(organization => this.buildOrganization(organization.name!));
    const sameAs = [...this.emailIdentities(person), ...this.phoneIdentities(person)];

    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'sourceId'],
      source,
      sourceId: id,
      ...(name && { name }),
      ...(description && { description }),
      url: `https://contacts.google.com/person/${id}`,
      ...(photo?.url && { emblem: createImageObject({ url: photo.url }) }),
      ...(organizations.length > 0 && { memberOf: organizations }),
      ...(labels.length > 0 && { tags: labels }),
      ...(sameAs.length > 0 && { sameAs }),
    };
  }

  /** Each address, as mail keys a person: lowercased, in the `email` namespace. */
  private emailIdentities(person: ContactPerson): Agent[] {
    const addresses = (person.emailAddresses ?? [])
      .map(email => email.value?.trim().toLowerCase())
      .flatMap(address => (address ? [address] : []));
    return [...new Set(addresses)].map(handle => ({
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'email',
      handle,
    }));
  }

  /** Each number in E.164, as messages and calls key a person: in the `phone` namespace. */
  private phoneIdentities(person: ContactPerson): Agent[] {
    const numbers = (person.phoneNumbers ?? [])
      .map(phone => phone.canonicalForm ?? (phone.value ? normalizePhoneNumber(phone.value) : null))
      .flatMap(number => (number ? [number] : []));
    return [...new Set(numbers)].map(handle => ({
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'phone',
      handle,
    }));
  }

  private buildOrganization(name: string): Organization {
    return { '@type': 'Organization', '@key': ['@type', 'source', 'name'], source, name };
  }
}

/** The field marked primary, else the first. */
function primary<T extends { metadata?: { primary?: boolean } }>(fields: T[] | undefined) {
  return fields?.find(field => field.metadata?.primary) ?? fields?.[0];
}
