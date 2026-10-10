import { normalizePhoneNumber } from '@chronicle.app/etl';
import type { Agent } from '@chronicle.app/schema';
import { z } from 'zod';
import { googleAccount } from './account.js';
import { GoogleApi } from './GoogleApi.js';

/**
 * What your contacts say about an email address: the contact's other
 * addresses, lowercased, and its phone numbers, in E.164. Plain data, so it
 * rides a raw record.
 */
export interface ContactLinks {
  /** The contact's ID in the account's contacts, from its `people/<id>` name. */
  id: string;
  /** The name you saved for the contact, not the person's own profile name. */
  name?: string;
  emails: string[];
  phones: string[];
}

interface Connection {
  resourceName?: string;
  names?: { displayName?: string; metadata?: { source?: { type?: string } } }[];
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
        { personFields: 'names,emailAddresses,phoneNumbers', pageSize: 1000 },
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
        const id = person.resourceName?.replace(/^people\//, '');
        // A contact is found by its addresses, so one without any can't be.
        if (!id || emails.length === 0) continue;
        // The name you saved (a CONTACT source), not the one the person gave
        // their own Google profile (a PROFILE source).
        const name = person.names
          ?.find(entry => entry.metadata?.source?.type === 'CONTACT')
          ?.displayName?.trim();
        for (const email of emails) {
          byAddress.set(email, { id, ...(name && { name }), emails, phones });
        }
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
 * Your contact for an address, as the identity it links the address to: the
 * entry in the Google account's contacts, keyed by its ID within the account,
 * named as you saved it, and `sameAs` its other addresses in the `email`
 * namespace and its numbers in the `phone` namespace, keyed as mail,
 * messages, and calls key people. None without the account whose contacts
 * they are.
 */
export function contactIdentities(
  address: string,
  links: ContactLinks | undefined,
  account: string | null | undefined
): Agent[] {
  if (!links || !account) return [];
  const self = address.toLowerCase();
  const identity = (source: string, handle: string): Agent => ({
    '@type': 'Agent',
    '@key': ['@type', 'source', 'handle'],
    source,
    handle,
  });
  const sameAs = [
    ...links.emails.filter(email => email !== self).map(email => identity('email', email)),
    ...links.phones.map(phone => identity('phone', phone)),
  ];
  return [
    {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'inAccount[*].handle', 'sourceId'],
      source: 'google-contacts',
      sourceId: links.id,
      inAccount: [googleAccount(account)],
      ...(links.name && { name: links.name }),
      ...(sameAs.length > 0 && { sameAs }),
    },
  ];
}

const unique = (values: (string | null | undefined)[]) => [
  ...new Set(values.flatMap(value => (value ? [value] : []))),
];
