import { normalizePhoneNumber } from '@chronicle.app/etl';
import type { Agent } from '@chronicle.app/schema';
import { z } from 'zod';
import { GoogleApi } from './GoogleApi.js';

/**
 * What your contacts say about an email address: the contact's other
 * addresses, lowercased, and its phone numbers, in E.164. Plain data, so it
 * rides a raw record.
 */
export interface ContactLinks {
  emails: string[];
  phones: string[];
}

interface Connection {
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string; canonicalForm?: string }[];
}

/** The option a Google source takes to link people to your contacts. Off unless asked for. */
export const contactOptions = {
  linkContacts: z
    .boolean()
    .optional()
    .describe(
      'Link people to the other addresses and phone numbers your Google Contacts have for them'
    ),
};

/**
 * Your Google Contacts as a lookup, not a source: Gmail and Calendar ask it
 * about each address they see, and link the person to the contact's other
 * addresses and numbers. Nothing from it is extracted on its own.
 */
export class ContactDirectory {
  /** Swapped for a fake server in tests. */
  static apiBaseURL = 'https://people.googleapis.com/v1';

  private constructor(private readonly byAddress: Map<string, ContactLinks>) {}

  /** A directory with no contacts in it, for a run without Contacts access. */
  static readonly empty = new ContactDirectory(new Map());

  /**
   * Your contacts, read once for a run with `linkContacts`. Without Contacts
   * access, or with the People API off, it's empty and says why: linking is
   * a bonus, so the run goes on.
   */
  static async load(options: {
    account?: string;
    accessToken?: string;
    linkContacts?: boolean;
  }): Promise<{ directory: ContactDirectory; missing?: unknown }> {
    // Not asked for: your address book isn't read at all.
    if (!options.linkContacts) return { directory: ContactDirectory.empty };
    const api = new GoogleApi({
      service: 'contacts',
      baseURL: ContactDirectory.apiBaseURL,
      account: options.account,
      accessToken: options.accessToken,
    });
    const byAddress = new Map<string, ContactLinks>();
    try {
      await api.initialize();
      const people = api.pages<Connection>(
        '/people/me/connections',
        { personFields: 'emailAddresses,phoneNumbers', pageSize: 1000 },
        'connections'
      );
      for await (const person of people) {
        const emails = unique(
          (person.emailAddresses ?? []).map(email => email.value?.trim().toLowerCase())
        );
        const phones = unique(
          (person.phoneNumbers ?? []).map(
            phone => phone.canonicalForm ?? (phone.value ? normalizePhoneNumber(phone.value) : null)
          )
        );
        if (emails.length < 2 && phones.length === 0) continue;
        for (const email of emails) byAddress.set(email, { emails, phones });
      }
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === 'auth-required' || code === 'api-disabled') {
        return { directory: ContactDirectory.empty, missing: error };
      }
      throw error;
    }
    return { directory: new ContactDirectory(byAddress) };
  }

  /** The links for each of these addresses that's on a contact. */
  linksFor(addresses: string[]): { [address: string]: ContactLinks } {
    const found: { [address: string]: ContactLinks } = {};
    for (const address of addresses) {
      const key = address.toLowerCase();
      const links = this.byAddress.get(key);
      if (links) found[key] = links;
    }
    return found;
  }
}

/**
 * The identities a contact links an address to: its other addresses in the
 * `email` namespace and its numbers in the `phone` namespace, keyed as mail,
 * messages, and calls key people.
 */
export function contactIdentities(address: string, links: ContactLinks | undefined): Agent[] {
  if (!links) return [];
  const self = address.toLowerCase();
  const identity = (source: string, handle: string): Agent => ({
    '@type': 'Agent',
    '@key': ['@type', 'source', 'handle'],
    source,
    handle,
  });
  return [
    ...links.emails.filter(email => email !== self).map(email => identity('email', email)),
    ...links.phones.map(phone => identity('phone', phone)),
  ];
}

const unique = (values: (string | null | undefined)[]) => [
  ...new Set(values.flatMap(value => (value ? [value] : []))),
];
