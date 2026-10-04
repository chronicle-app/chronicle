import type { MailMessage } from '@chronicle.app/email-core';
import { z } from 'zod';

/**
 * What to extract. `--sent` and `--label` work with the API and a Takeout
 * alike; anything else is a Gmail search, which needs the API.
 */
export const filterOptions = {
  sent: z.boolean().optional().describe('Only mail you sent'),
  label: z
    .string()
    .optional()
    .describe(
      'Only mail with all of these labels, comma-separated, like "Work" or "Starred". Spam and Trash are left out unless named.'
    ),
  query: z
    .string()
    .optional()
    .describe('A Gmail search, as in Gmail’s search box, like "from:boss has:attachment"'),
};

export interface Filters {
  sent?: boolean;
  label?: string;
  query?: string;
  since?: Date;
  until?: Date;
}

/** Whether a run asks for anything less than the whole mailbox. */
export const narrows = (filters: Filters) =>
  Boolean(filters.sent || filters.label || filters.query || filters.since || filters.until);

/** The label names every message must have: `--label`, and Sent for `--sent`. */
export function wantedLabels(filters: Filters): string[] {
  const labels = (filters.label ?? '')
    .split(',')
    .map(label => label.trim())
    .filter(Boolean);
  return filters.sent ? [...labels, 'Sent'] : labels;
}

/** Spam and Trash are read only when a run names them. */
export const includesSpamTrash = (filters: Filters) =>
  wantedLabels(filters).some(label => /^(spam|trash)$/i.test(label));

/**
 * The Gmail search for a run: its `--query`, and the window (`after:` and
 * `before:` take epoch seconds). Labels go by ID instead, in `labelIds`.
 */
export function gmailSearch(filters: Filters): string | undefined {
  const terms = [
    filters.query,
    filters.since && `after:${Math.floor(filters.since.getTime() / 1000)}`,
    filters.until && `before:${Math.floor(filters.until.getTime() / 1000)}`,
  ].filter(Boolean);
  return terms.length > 0 ? terms.join(' ') : undefined;
}

/** Whether a message read from a Takeout passes the filters, given its labels. */
export function matches(mail: MailMessage, labels: string[], filters: Filters): boolean {
  const has = new Set(labels.map(label => label.toLowerCase()));
  if (!includesSpamTrash(filters) && (has.has('spam') || has.has('trash'))) return false;
  if (!wantedLabels(filters).every(label => has.has(label.toLowerCase()))) return false;
  const sent = mail.date ? new Date(mail.date) : undefined;
  if (filters.since && (!sent || sent < filters.since)) return false;
  if (filters.until && (!sent || sent >= filters.until)) return false;
  return true;
}
