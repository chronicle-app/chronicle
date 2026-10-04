/**
 * Gmail's own labels by the names Gmail shows, the same names a Takeout
 * writes in `X-Gmail-Labels`, so a message has the same labels either way.
 * Read state (Unread, Opened) changes as you read, so it isn't a label here.
 */
const SYSTEM_LABELS: Record<string, string> = {
  INBOX: 'Inbox',
  SENT: 'Sent',
  DRAFT: 'Drafts',
  STARRED: 'Starred',
  IMPORTANT: 'Important',
  SPAM: 'Spam',
  TRASH: 'Trash',
  CHAT: 'Chat',
  CATEGORY_PERSONAL: 'Category Personal',
  CATEGORY_SOCIAL: 'Category Social',
  CATEGORY_PROMOTIONS: 'Category Promotions',
  CATEGORY_UPDATES: 'Category Updates',
  CATEGORY_FORUMS: 'Category Forums',
};

const READ_STATE = new Set(['UNREAD', 'Unread', 'Opened']);

/** A label's name from its API ID: Gmail's own by its shown name, yours from `names`. */
export function labelName(id: string, names: Map<string, string>): string | undefined {
  if (READ_STATE.has(id)) return undefined;
  return SYSTEM_LABELS[id] ?? names.get(id);
}

/** A label's API ID from its name, either kind, ignoring case. */
export function labelId(name: string, names: Map<string, string>): string | undefined {
  const wanted = name.toLowerCase();
  for (const [id, shown] of Object.entries(SYSTEM_LABELS)) {
    if (shown.toLowerCase() === wanted || id.toLowerCase() === wanted) return id;
  }
  for (const [id, shown] of names) if (shown.toLowerCase() === wanted) return id;
  return undefined;
}

/**
 * The labels in a Takeout message's `X-Gmail-Labels` header: comma-separated,
 * a name with a comma in quotes. Read state is left out.
 */
export function takeoutLabels(header: string | undefined): string[] {
  const labels = (header ?? '').match(/"[^"]*"|[^,]+/g) ?? [];
  return labels
    .map(label => label.trim().replaceAll(/^"|"$/g, ''))
    .filter(label => label && !READ_STATE.has(label));
}

/**
 * Gmail's thread and message IDs: the API writes them in hex, a Takeout's
 * `X-GM-THRID` and `X-GM-MSGID` in decimal. Hex either way, so they match.
 */
export function hexId(decimal: string | undefined): string | null {
  if (!decimal || !/^\d+$/.test(decimal.trim())) return null;
  return BigInt(decimal.trim()).toString(16);
}
