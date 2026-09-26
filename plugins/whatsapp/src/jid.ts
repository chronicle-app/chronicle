/**
 * WhatsApp JID (Jabber ID) parsing.
 *
 * Every WhatsApp address is a JID: `<local>@<suffix>`. The suffix names the
 * identity namespace, which decides how (and whether) we can resolve a real,
 * portable identifier:
 *
 * - `@s.whatsapp.net` — an individual. `<local>` is the full international phone
 *   number WITHOUT a leading `+` (e.g. `14157550454`), so it maps to E.164.
 * - `@g.us`           — a group. `<local>` is an opaque group id
 *   (`<creator>-<created-ts>` or a long number), NOT a phone number.
 * - `@lid`            — a "linked id": WhatsApp's privacy identifier used when a
 *   member's phone number is hidden (common in communities/large groups).
 *   `<local>` is opaque and MUST NOT be treated as a phone number.
 * - `@broadcast` / `@status` / `@lid.status` — broadcast lists and status
 *   ("stories"), not real conversations.
 *
 * This module is dependency-free so it is trivial to unit test. Turning a phone
 * into canonical E.164 (via the `phone` library) is left to the transformer so
 * WhatsApp numbers normalize identically to AddressBook ones and merge.
 */

export type JidKind = 'individual' | 'group' | 'lid' | 'broadcast' | 'status' | 'unknown';

export interface ParsedJid {
  /** The original JID string. */
  jid: string;
  /** Which identity namespace the JID belongs to. */
  kind: JidKind;
  /**
   * The international phone number with a leading `+`, for individual JIDs whose
   * local part is all digits. `null` for groups, LIDs, status, and anything that
   * does not look like a phone number — never synthesize one.
   */
  phone: string | null;
}

const SUFFIX_KINDS: Record<string, JidKind> = {
  's.whatsapp.net': 'individual',
  'c.us': 'individual', // legacy individual suffix
  'g.us': 'group',
  lid: 'lid',
  'lid.status': 'status',
  broadcast: 'broadcast',
  status: 'status',
};

export function parseJid(jid: string | null | undefined): ParsedJid | null {
  if (!jid || typeof jid !== 'string') return null;
  const at = jid.lastIndexOf('@');
  if (at <= 0) return null;

  const local = jid.slice(0, at);
  const suffix = jid.slice(at + 1).toLowerCase();
  const kind = SUFFIX_KINDS[suffix] ?? 'unknown';

  // Only individual JIDs carry a phone number; the local part of a 1:1 chat is
  // the bare international number. A group id can also contain a hyphen + digits
  // (`<phone>-<ts>@g.us`), which is why we gate on `kind`, not on shape alone.
  const phone = kind === 'individual' && /^\d{6,15}$/.test(local) ? `+${local}` : null;

  return { jid, kind, phone };
}

/** True for JIDs that represent a real, ingestable conversation (1:1 or group). */
export function isConversationJid(jid: string | null | undefined): boolean {
  const parsed = parseJid(jid);
  return parsed?.kind === 'individual' || parsed?.kind === 'group';
}
