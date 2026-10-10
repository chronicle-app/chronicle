import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import { googleAccount } from '@chronicle.app/google';
import { ActionAndChildren, Agent, Article, Comment } from '@chronicle.app/schema';

import { GoogleReaderItem, UserInfo } from './types.js';

export default class GoogleReaderTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'stream-contents') {
      actions.push(...this.buildStreamContentActions(record));
    }

    return actions;
  }

  private buildStreamContentActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];
    const { item } = record.data;

    if (!item.categories) return actions;

    const personalUserId = record.data.userId ?? record.data.userInfo?.user_id;
    if (!personalUserId) return actions;

    const user = this.buildUser(personalUserId, record.data.userInfo);
    const article = this.buildArticle(item);

    // Detect action types from categories
    const actionTypes = this.classifyActions(item, personalUserId);

    // Convert microsecond timestamp to Date object
    const timestamp = this.convertTimestamp(item.timestampUsec);

    for (const actionType of actionTypes) {
      switch (actionType) {
        case 'ReadAction':
          actions.push({
            '@type': 'ReadAction',
            '@key': ['@type', 'source', 'sourceId', 'agent.sourceId'],
            source: 'google-reader',
            sourceId: item.id,
            timestamp,
            agent: user,
            object: article,
          });
          break;

        case 'PublishAction':
          actions.push({
            '@type': 'PublishAction',
            '@key': ['@type', 'source', 'sourceId', 'agent.sourceId'],
            source: 'google-reader',
            sourceId: item.id,
            timestamp,
            agent: user,
            object: article,
          });
          break;

        case 'LikeAction':
          actions.push({
            '@type': 'LikeAction',
            '@key': ['@type', 'source', 'sourceId', 'agent.sourceId'],
            source: 'google-reader',
            sourceId: item.id,
            timestamp,
            agent: user,
            object: article,
          });
          break;
      }
    }

    // Handle annotations separately
    if (item.annotations) {
      const userAnnotations = item.annotations.filter(
        (ann: { userId?: string; content?: string }) => ann.userId === personalUserId
      );
      for (const annotation of userAnnotations) {
        const comment: Comment = {
          '@type': 'Comment',
          '@key': ['@type', 'source', 'body', 'about.0.sourceId', 'author.0.sourceId'],
          source: 'google-reader',
          body: annotation.content,
          author: [user],
          about: [article],
        };

        actions.push({
          '@type': 'AnnotateAction',
          '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId', 'result.body'],
          source: 'google-reader',
          timestamp,
          agent: user,
          object: article,
          result: comment,
        });
      }
    }

    // Article is already included as the object of each action

    return actions;
  }

  private buildUser(userId: string, userInfo: UserInfo | null): Agent {
    const profile = userInfo?.user_id === userId ? userInfo : null;
    const email = profile?.email?.trim() || undefined;
    const name = profile?.user_name;
    // Your address, and the Google account it is, keyed by that address as
    // Gmail, Google Calendar, and Chrome key it.
    const sameAs: Agent[] = email
      ? [
          {
            '@type': 'Agent',
            '@key': ['@type', 'source', 'handle'],
            source: 'email',
            handle: email.toLowerCase(),
            ...(name && { name }),
          },
          googleAccount(email),
        ]
      : [];
    return selfAgent({
      type: 'Agent',
      source: 'google-reader',
      sourceId: userId,
      handle: email,
      name,
      sameAs,
    }) as Agent;
  }

  private buildArticle(item: GoogleReaderItem): Article {
    const url = item.alternate?.[0]?.href || '';

    return {
      '@type': 'Article',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'google-reader',
      sourceId: item.id,
      ...(url && { url }),
      name: item.title,
      body: item.content?.content || item.summary?.content || '',
      // Note: author field expects EntityAndChildren[] but we only have string
      // Could create Agent entities for authors if needed
    };
  }

  private classifyActions(item: GoogleReaderItem, userId: string): string[] {
    const actions: string[] = [];

    if (!item.categories) return actions;

    for (const category of item.categories) {
      // Only match exact personal states, not friend states
      if (category === `user/${userId}/state/com.google/read`) {
        actions.push('ReadAction');
      }
      if (category === `user/${userId}/state/com.google/broadcast`) {
        actions.push('PublishAction');
      }
      if (category === `user/${userId}/state/com.google/starred`) {
        actions.push('LikeAction');
      }
    }

    return actions;
  }

  private convertTimestamp(timestampUsec: string): Date {
    // Convert microseconds to milliseconds and create Date object
    const milliseconds = Math.floor(Number.parseInt(timestampUsec) / 1000);
    return new Date(milliseconds);
  }
}
