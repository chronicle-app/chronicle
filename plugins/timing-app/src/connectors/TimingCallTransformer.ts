import { ChronicleTransformer, Record, normalizePhoneNumber } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AgentAndChildren,
  CallAction,
  CallSession,
} from '@chronicle.app/schema';
import { lookupContact, lookupContactByName, type Contact } from '@chronicle.app/icloud';

// The call UUID is Apple's (relayed through Timing's Event.origin_id), so calls
// key on `apple-phone` + UUID and fold with the Apple Call History plugin's calls.
const SOURCE = 'apple-phone';

/**
 * Timing's relay of Apple Call History — the historical supplement for the long
 * tail Apple has pruned (82% of Timing calls predate Apple's retention). Same
 * shape as an Apple call. The party:
 *   - unnamed contact (a raw handle)  → an `apple-phone` party (folds via handle),
 *   - named contact, resolvable       → the `apple-contacts` party,
 *   - named contact, unresolvable     → no party; Timing's label rides on a
 *       `sameAs`'d `timing-app` CallSession (a sourced fact, not a fabricated
 *       Person, not the canonical session's own name).
 *
 * Caveat: Timing records no direction, so a resolved party goes on `recipient`
 * (the best available slot). For a call that ALSO exists in Apple, Apple is
 * authoritative for direction; this adds coverage for the pruned tail.
 */
export default class TimingCallTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType === 'calls') {
      return [this.buildTimingCall(record)];
    }
    return [];
  }

  private buildTimingCall(record: Record): ActionAndChildren {
    const ctx = record.context as {
      uuid: string;
      startSec: number;
      endSec: number | null;
      handle: string | null;
      contactName: string | null;
    };

    const session: CallSession = {
      '@type': 'CallSession',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: ctx.uuid,
    };

    if (ctx.handle) {
      // A real calling handle → a proper party (folds via the handle).
      const party = partyFromHandle(ctx.handle);
      if (party) session.recipient = [party];
    } else if (ctx.contactName) {
      const party = partyFromContact(ctx.contactName);
      if (party) {
        session.recipient = [party];
      } else {
        // Unresolvable name (ambiguous / no exact match): preserve Timing's label
        // as a `sameAs`'d timing-app session node — a properly sourced fact, not a
        // fabricated Person and not the canonical session's own name.
        session.sameAs = [
          {
            '@type': 'CallSession',
            '@key': ['@type', 'source', 'sourceId'],
            source: 'timing-app',
            sourceId: ctx.uuid,
            name: ctx.contactName,
          },
        ] as any;
      }
    }

    return {
      '@type': 'CallAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: ctx.uuid,
      startTime: secondsToISO(ctx.startSec),
      endTime: secondsToISO(ctx.endSec ?? ctx.startSec),
      result: session,
    } as CallAction & ActionAndChildren as any;
  }
}

/**
 * An `apple-phone` party from a calling handle (like the Apple plugin). Identity
 * keys on the handle alone (`['source','handle']`); `@type` is an `Agent`
 * annotation — a bare number could be a person or an org.
 */
function partyFromHandle(handle: string): AgentAndChildren | null {
  const value = handle.trim();
  if (!value) return null;
  const isEmail = value.includes('@');
  const canonical = isEmail ? value.toLowerCase() : normalizePhoneNumber(value) || value;
  const contact = lookupContact(canonical);

  const party: AgentAndChildren = {
    '@type': 'Agent',
    '@key': ['source', 'handle'],
    source: 'apple-phone',
    handle: canonical,
  } as AgentAndChildren;
  if (contact?.fullName) party.name = contact.fullName;

  const sameAs: AgentAndChildren[] = [
    {
      '@type': 'Agent',
      '@key': ['source', 'handle'],
      source: isEmail ? 'email' : 'phone',
      handle: canonical,
    } as AgentAndChildren,
  ];
  if (contact?.id) sameAs.push(contactNode(contact));
  party.sameAs = sameAs as any;
  return party;
}

/**
 * When Timing gives only a contact name (no number), the identity is the Address
 * Book entry itself — `apple-contacts` primary, keyed on its stable id, with the
 * contact's handles as `sameAs` (which is how it folds into the phone/email graph).
 */
function partyFromContact(name: string): AgentAndChildren | null {
  // It's a call, so break a same-name tie by the phone-bearing card.
  const contact = lookupContactByName(name, { preferPhone: true });
  if (!contact?.id) return null; // no stable identity → don't guess

  const sameAs: AgentAndChildren[] = [];
  for (const phone of contact.phoneNumbers) {
    sameAs.push({
      '@type': 'Agent',
      '@key': ['source', 'handle'],
      source: 'phone',
      handle: normalizePhoneNumber(phone) || phone,
    } as AgentAndChildren);
  }
  for (const email of contact.emails) {
    sameAs.push({
      '@type': 'Agent',
      '@key': ['source', 'handle'],
      source: 'email',
      handle: email.toLowerCase(),
    } as AgentAndChildren);
  }

  const party = contactNode(contact);
  if (sameAs.length > 0) party.sameAs = sameAs as any;
  return party;
}

/**
 * The Address Book entry, keyed on its portable id and typed from the card (a
 * person, or an org-only card → Organization) — the one place the kind is known.
 */
function contactNode(contact: Contact): AgentAndChildren {
  const type =
    contact.firstName || contact.lastName
      ? 'Person'
      : contact.organization
        ? 'Organization'
        : 'Agent';
  return {
    '@type': type,
    '@key': ['source', 'sourceId'],
    source: 'apple-contacts',
    sourceId: contact.id,
    ...(contact.fullName ? { name: contact.fullName } : {}),
  } as AgentAndChildren;
}

function secondsToISO(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
