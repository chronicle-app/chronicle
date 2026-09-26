import type { AgentAndChildren, Channel } from '@chronicle.app/schema';

/**
 * WhatsApp identity construction — one place that builds the keysets, so the
 * transformer (message senders/recipients) and the extractor ("me") agree.
 *
 * Every WhatsApp identity is keyed in the `whatsapp` namespace on its raw JID — a
 * genuine WhatsApp-issued id, never synthesized. A person additionally carries the
 * portable phone number as a `sameAs` edge to the `phone` namespace (when known),
 * so the sameAs fold merges them with the same number seen via
 * iMessage/contacts and converges a person's phone-JID and LID identities on one hub.
 */

/** A person keyed on their WhatsApp JID, with the phone (if known) as a `sameAs` edge. */
export function whatsappPerson(opts: {
  /** The raw WhatsApp JID (`<n>@s.whatsapp.net` or `<id>@lid`). */
  jid: string;
  /** The person's phone, already normalized to E.164 (`+…`), or null/absent. */
  phoneHandle?: string | null;
  name?: string | null;
}): AgentAndChildren {
  const person: AgentAndChildren = {
    '@type': 'Person',
    source: 'whatsapp',
    handle: opts.jid,
    '@key': ['@type', 'source', 'handle'],
  };
  if (opts.name) person.name = opts.name;
  if (opts.phoneHandle) {
    const phone: AgentAndChildren = {
      '@type': 'Person',
      source: 'phone',
      handle: opts.phoneHandle,
      '@key': ['@type', 'source', 'handle'],
    };
    if (opts.name) phone.name = opts.name;
    person.sameAs = [phone];
  }
  return person;
}

/** The messaging container a group's messages belong to (`isPartOf` target), keyed on the `@g.us` JID. */
export function whatsappChannel(
  jid: string,
  name?: string | null,
  members?: AgentAndChildren[]
): Channel {
  const channel: Channel = {
    '@type': 'Channel',
    source: 'whatsapp',
    handle: jid,
    '@key': ['@type', 'source', 'handle'],
  };
  if (name) channel.name = name;
  if (members && members.length > 0) channel.member = members;
  return channel;
}

/** A non-person WhatsApp identity (a group, or any JID we don't treat as a person). */
export function whatsappAgent(jid: string, name?: string | null): AgentAndChildren {
  const agent: AgentAndChildren = {
    '@type': 'Agent',
    source: 'whatsapp',
    handle: jid,
    '@key': ['@type', 'source', 'handle'],
  };
  if (name) agent.name = name;
  return agent;
}

/**
 * The WhatsApp phone-number JID for an E.164 number (`+1416…` → `1416…@s.whatsapp.net`).
 * A WhatsApp account *is* its phone-number JID, so this reconstructs the owner's own
 * (real, not synthesized) WhatsApp id from their number.
 */
export function phoneToJid(e164: string): string {
  return `${e164.replace(/^\+/, '')}@s.whatsapp.net`;
}
