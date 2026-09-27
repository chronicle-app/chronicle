import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  MessageAction,
  Message,
  FindAction,
  Query,
  LikeAction,
  Post,
  RespondAction,
  Response,
} from '@chronicle.app/schema';

export default class FacebookTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    switch (record.extraction.recordType) {
      case 'messages': {
        actions.push(...this.buildMessageActions(record));

        break;
      }
      case 'searches': {
        actions.push(...this.buildSearchActions(record));

        break;
      }
      case 'reactions': {
        actions.push(...this.buildReactionActions(record));

        break;
      }
      case 'comments': {
        actions.push(...this.buildCommentActions(record));

        break;
      }
      // No default
    }

    return actions;
  }

  private buildMessageActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];

    if (!record.data.timestamp) {
      return actions;
    }

    try {
      const sender = this.buildMessageSender(record);
      const message = this.buildMessage(record);

      const messageAction: MessageAction = {
        '@type': 'MessageAction',
        timestamp: record.data.timestamp,
        '@key': ['@type', 'source', 'timestamp', 'agent.name', 'object.body'],
        source: 'facebook',
        agent: sender,
        object: message,
      };

      actions.push(messageAction);
    } catch {
      // Skip messages where we can't identify the sender
      // Skipping message due to unidentifiable sender
    }

    return actions;
  }

  private buildMessageSender(record: Record): Agent {
    // Improve name resolution - try to find a better name than "Unknown"
    let { senderName } = record.data;

    if (!senderName && record.data.participants?.length === 1) {
      // If only one participant, that must be the sender
      senderName = record.data.participants[0];
    } else if (!senderName && record.data.participants?.length === 2) {
      // In a 2-person conversation, try to identify which participant is the sender
      // This would require more context about the user's own name, which we don't have
      // For now, we'll skip this message rather than use "Unknown"
      senderName = null;
    }

    if (!senderName) {
      // Skip messages without identifiable senders rather than using "Unknown"
      throw new Error('Cannot identify sender for message');
    }

    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'name'],
      source: 'facebook',
      name: senderName,
    };
  }

  private buildMessage(record: Record): Message {
    const recipients =
      record.data.participants
        ?.filter((name: string) => name !== record.data.senderName)
        ?.map((name: string) => ({
          '@type': 'Agent' as const,
          '@key': ['@type', 'source', 'name'] as const,
          source: 'facebook',
          name,
        })) || [];

    return {
      '@type': 'Message',
      '@key': ['@type', 'source', 'body', 'recipient'],
      source: 'facebook',
      body: record.data.content || '',
      recipient: recipients,
    };
  }

  private buildSearchActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];

    if (!record.data.timestamp || !record.data.searchText) {
      return actions;
    }

    const agent = this.buildFacebookAgent();

    const findAction: FindAction = {
      '@type': 'FindAction',
      timestamp: record.data.timestamp,
      '@key': ['@type', 'source', 'timestamp', 'agent.name', 'object.body'],
      source: 'facebook',
      agent,
      object: {
        '@type': 'Query',
        '@key': ['@type', 'source', 'body'],
        source: 'facebook',
        name: record.data.searchText,
        body: record.data.searchText,
      } satisfies Query,
    };

    actions.push(findAction);
    return actions;
  }

  /**
   * The like button routes to LikeAction — payload-free, driving the boolean
   * `liked` run — while the emotive reactions (LOVE/HAHA/WOW/SAD/ANGRY/CARE)
   * are payloads: RespondAction → result Response carrying the export's own
   * reaction word verbatim in `body` (never mapped to an emoji or a sentiment;
   * that is a derivation, not data). A record whose reaction type didn't parse
   * keeps today's LikeAction routing rather than minting a fabricated payload.
   */
  private buildReactionActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];

    if (!record.data.timestamp) {
      return actions;
    }

    const agent = this.buildFacebookAgent();
    const target = this.buildReactionTarget(record);
    const { reactionType } = record.data;

    if (!reactionType || reactionType === 'like' || reactionType === 'unknown') {
      const likeAction: LikeAction = {
        '@type': 'LikeAction',
        timestamp: record.data.timestamp,
        '@key': ['@type', 'source', 'timestamp', 'agent.name', 'object.url'],
        source: 'facebook',
        agent,
        object: target,
      };

      actions.push(likeAction);
      return actions;
    }

    // The Response keys on real export data via `action.`-prefixed dot-paths
    // into the enclosing action's roles — no synthesized id. `action.timestamp`
    // stays in the key because the data-array export format carries no post
    // URL: without it, every same-word reaction by the same agent would
    // collapse into one artifact.
    const response: Response = {
      '@type': 'Response',
      '@key': [
        '@type',
        'source',
        'body',
        'action.timestamp',
        'action.agent.name',
        'action.object.url',
      ],
      source: 'facebook',
      body: reactionType,
    };

    const respondAction: RespondAction = {
      '@type': 'RespondAction',
      timestamp: record.data.timestamp,
      '@key': ['@type', 'source', 'timestamp', 'agent.name', 'object.url', 'result.body'],
      source: 'facebook',
      agent,
      object: target,
      result: response,
    };

    actions.push(respondAction);
    return actions;
  }

  /**
   * The reacted-to post. The label_values export format carries its URL and
   * owner; the data-array format carries the owner alone, leaving the post as
   * weak as the export makes it.
   */
  private buildReactionTarget(record: Record): Post {
    return {
      '@type': 'Post',
      '@key': ['@type', 'source', 'url'],
      source: 'facebook',
      url: record.data.contentUrl,
      author: record.data.targetPerson
        ? [
            {
              '@type': 'Person',
              '@key': ['@type', 'source', 'name'],
              source: 'facebook',
              name: record.data.targetPerson,
            },
          ]
        : undefined,
    };
  }

  /**
   * A comment is a prose response — RespondAction → result Comment (the
   * Response leaf), joining the same family as reactions. The action carries
   * no `object`: the export's only pointer to the commented-on post is a
   * localized prose title ("X commented on Y's post."), and scraping a name
   * out of that sentence would break silently on non-English archives — so
   * the edge is left unasserted rather than fabricated.
   */
  private buildCommentActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];

    if (!record.data.timestamp || !record.data.commentText) {
      return actions;
    }

    const agent = this.buildFacebookAgent(record.data.author);

    const respondAction: RespondAction = {
      '@type': 'RespondAction',
      timestamp: record.data.timestamp,
      '@key': ['@type', 'source', 'timestamp', 'agent.name', 'result.body'],
      source: 'facebook',
      agent,
      result: {
        '@type': 'Comment',
        '@key': ['@type', 'source', 'body'],
        source: 'facebook',
        body: record.data.commentText,
        author: [agent],
      },
    };

    actions.push(respondAction);
    return actions;
  }

  private buildFacebookAgent(name?: string): Agent {
    // This builder is only ever the account owner — their own searches,
    // reactions, and comments. Message senders go through buildMessageSender
    // (which can be the other party) and are left untagged. When the archive
    // carries no account name there is nothing to key on, so the node falls
    // back to the per-source singleton — identity is never invented.
    return selfAgent({
      type: 'Agent',
      source: 'facebook',
      ...(name ? { name, key: ['@type', 'source', 'name'] } : {}),
    }) as Agent;
  }
}
