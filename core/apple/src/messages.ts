import type { Channel } from '@chronicle.app/schema';

/** A Messages chat's `style` when it's a group chat. A one-to-one chat's is 45. */
export const GROUP_CHAT_STYLE = 43;

/** Apple's IDs for a group chat, as Messages' `chat` table has them. */
export interface GroupChatIds {
  /** `group_id`, which Messages sometimes replaces. */
  groupId: string | null;
  /** `original_group_id`, the ID the group started with. */
  originalGroupId: string | null;
}

/**
 * A group chat in Messages as a `Channel`, keyed by Apple's ID for the group.
 * A chat keeps two: the one it started with, and the one it has now, which
 * Messages sometimes replaces. The Channel is keyed by the first, or the
 * second when there's no first, and is `sameAs` the second when they differ,
 * so a record of either lands on it: Photos' Shared with You keeps whichever
 * it saw. Each device keeps its own `chat_identifier` for a chat, so it isn't
 * a key. Null when the chat has neither ID.
 */
export function groupChatChannel({ groupId, originalGroupId }: GroupChatIds): Channel | null {
  const key = originalGroupId?.trim() || groupId?.trim();
  if (!key) return null;
  const now = groupId?.trim();
  return {
    ...groupChatRef(key),
    ...(now && now !== key && { sameAs: [groupChatRef(now)] }),
  };
}

function groupChatRef(id: string): Channel {
  return {
    '@type': 'Channel',
    '@key': ['@type', 'source', 'sourceId'],
    source: 'imessage',
    sourceId: id,
  };
}
