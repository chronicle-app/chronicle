import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  LikeAction,
  Message,
  MessageAction,
  PublishAction,
  Post,
} from '@chronicle.app/schema';

export default class TwitterTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    switch (record.extraction.recordType) {
      case 'tweets':
        actions.push(...(await this.buildTweetActions(record)));
        break;
      case 'likes':
        actions.push(...this.buildLikeActions(record));
        break;
      case 'direct-messages':
        actions.push(...this.buildDirectMessageActions(record));
        break;
      case 'group-direct-messages':
        actions.push(...this.buildGroupDirectMessageActions(record));
        break;
    }

    return actions;
  }

  private async buildTweetActions(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];
    const user = this.buildAccountUser(record);
    const mentions = this.extractMentionedUsersFromEntities(record.data.entities, record.data.text);
    const urls = this.extractUrlReferencesFromEntities(record.data.entities, record.data.text);
    const references = [...mentions, ...urls];

    const tweet: Post = {
      '@type': 'Post',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: record.data.id,
      body: record.data.text, // Keep original text with t.co URLs
      author: [user],
      ...(references.length > 0 && { references }),
    };

    const publishAction: PublishAction = {
      '@type': 'PublishAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: record.data.id,
      timestamp: record.data.created_at,
      agent: user,
      object: tweet,
    };

    actions.push(publishAction);
    return actions;
  }

  private buildLikeActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];
    const user = this.buildAccountUser(record);

    const targetTweet: Post = {
      '@type': 'Post',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: record.data.tweetId,
      body: record.data.fullText,
    };

    const likeAction: LikeAction = {
      '@type': 'LikeAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: `${record.data.tweetId}-like`,
      agent: user,
      object: targetTweet,
    };

    actions.push(likeAction);
    return actions;
  }

  private buildDirectMessageActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];

    const sender = this.buildPersonFromUserId(record.data.senderId);
    const recipient = this.buildPersonFromUserId(record.data.recipientId);

    const message: Message = {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: record.data.id,
      body: record.data.text,
      recipient: [recipient],
      author: [sender],
    };

    // Media URLs would need to be handled separately or added to schema

    const sendAction: MessageAction = {
      '@type': 'MessageAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: record.data.id,
      timestamp: record.data.created_at,
      agent: sender,
      object: message,
    };

    actions.push(sendAction);
    return actions;
  }

  private buildAccountUser(record: Record): Agent {
    // const strategy = record.context?.strategy || 'archive'; // Future use
    const accountInfo = record.context?.accountInfo;

    if (!accountInfo) {
      throw new Error(
        'Account information is required to build user agent. Ensure account.js is present in Twitter export.'
      );
    }

    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: accountInfo.accountId,
      handle: accountInfo.username,
      name: accountInfo.accountDisplayName,
      url: `https://twitter.com/${accountInfo.username}`,
      sameAs: ['@me'],
    };
  }

  private buildPersonFromUserId(userId: string): Agent {
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: userId,
    };
  }

  private extractMentionedUsersFromEntities(entities: any, text: string): Agent[] {
    const mentions: Agent[] = [];

    // Primary: Use entities.user_mentions for structured data
    if (entities?.user_mentions && entities.user_mentions.length > 0) {
      for (const mention of entities.user_mentions) {
        mentions.push({
          '@type': 'Agent',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'twitter',
          sourceId: mention.id_str,
          handle: mention.screen_name,
          name: mention.name,
          url: `https://twitter.com/${mention.screen_name}`,
        });
      }
    } else {
      // Fallback: Use regex parsing for edge cases where entities is empty
      const mentionRegex = /@([a-zA-Z0-9_]+)/g;
      let match;

      while ((match = mentionRegex.exec(text)) !== null) {
        const username = match[1];
        mentions.push({
          '@type': 'Agent',
          '@key': ['@type', 'source', 'handle'],
          source: 'twitter',
          handle: username,
          url: `https://twitter.com/${username}`,
        });
      }
    }

    return mentions;
  }

  private extractUrlReferencesFromEntities(entities: any, text: string): any[] {
    const urls: any[] = [];

    // Primary: Use entities.urls for structured data
    if (entities?.urls && entities.urls.length > 0) {
      for (const urlEntity of entities.urls) {
        // Use expanded URL if available, otherwise fall back to original
        const finalUrl = urlEntity.expanded_url || urlEntity.url;

        urls.push({
          '@type': 'Entity',
          '@key': ['@type', 'url'],
          url: finalUrl,
        });
      }
    } else {
      // Fallback: Use regex parsing for edge cases where entities is empty
      const urlRegex = /https?:\/\/[^\s)]+/g;
      let match;

      while ((match = urlRegex.exec(text)) !== null) {
        let url = match[0];
        // Remove trailing punctuation that shouldn't be part of the URL
        url = url.replace(/[).,;!?]+$/, '');

        urls.push({
          '@type': 'Entity',
          '@key': ['@type', 'url'],
          url,
        });
      }
    }

    return urls;
  }

  private buildGroupDirectMessageActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];

    const sender = this.buildPersonFromUserId(record.data.senderId);
    // Build recipients from all participants except the sender
    const participants = record.data.participants || [];
    const recipients = participants
      .filter((participantId: string) => participantId !== record.data.senderId)
      .map((participantId: string) => this.buildPersonFromUserId(participantId));

    const message: Message = {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: record.data.id,
      body: record.data.text,
      recipient: recipients,
      author: [sender],
    };

    const sendAction: MessageAction = {
      '@type': 'MessageAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: record.data.id,
      timestamp: record.data.created_at,
      agent: sender,
      object: message,
    };

    actions.push(sendAction);
    return actions;
  }
}
