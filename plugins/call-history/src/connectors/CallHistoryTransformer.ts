import { ChronicleTransformer, Record, normalizePhoneNumber } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  AgentAndChildren,
  CallAction,
  CallSession,
  Channel,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema, lookupContact, type Contact } from '@chronicle.app/icloud';

// The call UUID is issued by Apple's phone/call subsystem and shared with Timing's
// relay (see the timing-app plugin), so both key on it here and fold.
const SOURCE = 'apple-phone';

/**
 * Modeled like a message (produced artifact → `result`, receiver → `recipient`):
 *
 *   CallAction  agent: caller
 *     result: CallSession  recipient: [receiver(s)]   isPartOf: [Channel] (groups)
 *
 * The service (phone/FaceTime) is deferred; the message frame (object → result)
 * will be unified across all comms plugins in a follow-up.
 */
export default class CallHistoryTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  private mePromise?: Promise<Agent>;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType === 'calls') {
      return [await this.buildAppleCall(record)];
    }
    return [];
  }

  // Optional config: `account` (an iCloud account, or null for none) and
  // `lookupContact` replace the host's iCloud account and Contacts lookups.
  private me(): Promise<Agent> {
    if (!this.mePromise)
      this.mePromise = buildICloudPersonSchema(this.config.account) as unknown as Promise<Agent>;
    return this.mePromise;
  }

  private async buildAppleCall(record: Record): Promise<ActionAndChildren> {
    const ctx = record.context as {
      uuid: string;
      startSec: number;
      durationSec: number;
      originated: number | null; // 1 out, 0 in
      name: string | null;
      handles: string[];
      groupUuid: string | null;
    };

    const outgoing = ctx.originated === 1;
    const me = await this.me();

    // Apple's per-call ZNAME is only meaningful for a 1:1 counterpart.
    const singleName = ctx.handles.length === 1 ? ctx.name : null;
    const others = ctx.handles
      .map((h, i) => buildCallParty(h, i === 0 ? singleName : null, this.config.lookupContact))
      .filter((p): p is AgentAndChildren => p !== null);

    const session: CallSession = {
      '@type': 'CallSession',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: ctx.uuid,
    };

    const action: CallAction & ActionAndChildren = {
      '@type': 'CallAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: ctx.uuid,
      startTime: secondsToISO(ctx.startSec),
      endTime: secondsToISO(ctx.startSec + ctx.durationSec),
      result: session,
    } as any;

    if (ctx.groupUuid) {
      // Group call → a Channel (the roster), mirroring group messages.
      const channel: Channel = {
        '@type': 'Channel',
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId: ctx.groupUuid,
      };
      if (others.length > 0) channel.member = others;
      session.isPartOf = [channel];
      if (outgoing)
        action.agent = me; // I called the group
      else session.recipient = [me]; // group called me; initiator unknown
    } else if (others.length === 1) {
      if (outgoing) {
        action.agent = me;
        session.recipient = [others[0]];
      } else {
        action.agent = others[0]; // the caller
        session.recipient = [me];
      }
    } else if (others.length === 0) {
      // Blocked/private number — no keyable participant (and a name is not a
      // session label). Keep the call on the timeline.
      if (outgoing) action.agent = me;
    } else if (outgoing) {
      // Multiple handles without a group id (unusual), outgoing.
      action.agent = me;
      session.recipient = others;
    } else {
      // Multiple handles, incoming — initiator not identifiable.
      session.recipient = [me];
    }

    return action;
  }
}

/**
 * A call party as an `apple-phone` identity (Apple's calling namespace — which
 * covers FaceTime/VoIP that never touch the phone network), with `sameAs` edges to
 * the underlying handle (`phone` or `email`, kept nameless — a number has no
 * canonical name) and, when in Contacts, the `apple-contacts` entry (its stable
 * ZEXTERNALUUID carries the name). The `apple-phone` name is Apple's ZNAME, falling
 * back to the contact's name.
 *
 * Identity keys on the stable identifier alone (`['source','handle']` /
 * `['source','sourceId']`), not `@type`: a bare handle could be a person, a
 * business, or a robocaller — `@type` is a union annotation (`Agent` here), never
 * part of the key. A contact card, where the kind is known, refines it (Person /
 * Organization).
 */
function buildCallParty(
  handle: string,
  znameFallback: string | null,
  lookup: (handle: string) => Contact | null = lookupContact
): AgentAndChildren | null {
  const value = handle.trim();
  if (!value) return null;

  const isEmail = value.includes('@');
  const canonical = isEmail ? value.toLowerCase() : normalizePhoneNumber(value) || value;
  const contact = lookup(canonical);

  const party: AgentAndChildren = {
    '@type': 'Agent',
    '@key': ['source', 'handle'],
    source: 'apple-phone',
    handle: canonical,
  } as AgentAndChildren;
  const name = znameFallback ?? contact?.fullName;
  if (name) party.name = name;

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
 * The Address Book entry, keyed on its portable id. Typed from the card — a person
 * (has a name) or an organization (org-only card) — the one place the kind is known.
 */
function contactNode(contact: Contact): AgentAndChildren {
  return {
    '@type': contactType(contact),
    '@key': ['source', 'sourceId'],
    source: 'apple-contacts',
    sourceId: contact.id,
    ...(contact.fullName ? { name: contact.fullName } : {}),
  } as AgentAndChildren;
}

function contactType(contact: Contact): 'Person' | 'Organization' | 'Agent' {
  if (contact.firstName || contact.lastName) return 'Person';
  if (contact.organization) return 'Organization';
  return 'Agent';
}

function secondsToISO(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
