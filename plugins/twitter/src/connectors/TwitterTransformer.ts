import {
  ChronicleTransformer,
  Record,
  createImageObject,
  createVideoObject,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  BookmarkAction,
  LikeAction,
  MediaObjectAndChildren,
  Message,
  MessageAction,
  PublishAction,
  Post,
  ShareAction,
  Tag,
} from '@chronicle.app/schema';
import { type TweetMedia, mimeTypeOf } from '../utils/media.js';
import { unescapeText } from '../utils/text.js';

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
      case 'bookmarks':
        actions.push(...this.buildBookmarkActions(record));
        break;
      case 'mentions':
        // From the API, whose entities are complete.
        actions.push(this.buildPostAction(record.data, this.buildAuthor(record.data), true));
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
    // The API's entities are complete, so its text isn't searched for more.
    const complete = record.context?.strategy === 'api';
    return [this.buildPostAction(record.data, this.buildAccountUser(record), complete)];
  }

  /**
   * A tweet's PublishAction by its author, or for a retweet, the author's
   * ShareAction of the post it retweets. The archive's retweets, which don't
   * say which post they were of, stay tweets.
   */
  private buildPostAction(
    data: any,
    author: Agent | undefined,
    complete: boolean
  ): ActionAndChildren {
    if (data.retweeted?.id) {
      const share: ShareAction = {
        '@type': 'ShareAction',
        // An account retweets a post once, so the two identify the retweet.
        '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
        source: 'twitter',
        timestamp: data.created_at,
        ...(author && { agent: author }),
        object: this.buildRetweeted(data.retweeted),
      };
      return share;
    }
    const publish: PublishAction = {
      '@type': 'PublishAction',
      // Keyed by the tweet it published.
      '@key': ['@type', 'source', 'result.sourceId'],
      source: 'twitter',
      timestamp: data.created_at,
      ...(author && { agent: author }),
      result: this.buildPost(data, author, complete),
    };
    return publish;
  }

  /** A tweet: its text, author, mentions, links, hashtags, photos, and videos. */
  private buildPost(data: any, author: Agent | undefined, complete: boolean): Post {
    const text = complete ? '' : data.text;
    const references = [
      ...this.extractMentionedUsersFromEntities(data.entities, text),
      ...this.extractUrlReferencesFromEntities(data.entities, text),
    ];
    const tags = this.buildHashtags(data.entities);
    const media = this.buildMedia(data.media);
    return {
      '@type': 'Post',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: data.id,
      ...(author?.handle && { url: postUrl(author.handle, data.id) }),
      body: unescapeText(data.text), // Keep original text with t.co URLs
      ...(author && { author: [author] }),
      ...(references.length > 0 && { references }),
      ...(tags.length > 0 && { about: tags }),
      ...(media.length > 0 && { contains: media }),
    };
  }

  /** The post a retweet retweets: in full when X still has it, else just which. */
  private buildRetweeted(retweeted: any): Post {
    if (retweeted.text === undefined) {
      return {
        '@type': 'Post',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'twitter',
        sourceId: retweeted.id,
      };
    }
    return this.buildPost(retweeted, this.buildAuthor(retweeted), true);
  }

  /** Who posted a tweet from the API, with their handle and name when X gave them. */
  private buildAuthor(data: any): Agent | undefined {
    const id = data.author?.id ?? data.authorId;
    if (!id) return undefined;
    const { username, name } = data.author ?? {};
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: id,
      ...(username && { handle: username, url: profileUrl(username) }),
      ...(name && { name }),
    };
  }

  /**
   * A tweet's or message's photos and videos (a GIF is a short video). X's
   * media id keys a tweet's, so the archive's and the API's are one; a
   * message's has none, so its URL keys it.
   */
  private buildMedia(media: TweetMedia[] | undefined): MediaObjectAndChildren[] {
    return (media ?? []).map(item => {
      const options = {
        url: item.url,
        path: item.path,
        mimeType: mimeTypeOf(item),
        ...(item.id
          ? { '@key': ['@type', 'source', 'sourceId'], source: 'twitter', sourceId: item.id }
          : { '@key': ['@type', 'url'] }),
        ...(item.width && { width: item.width }),
        ...(item.height && { height: item.height }),
      };
      return item.type === 'photo'
        ? createImageObject({ ...options, ...(item.altText && { caption: item.altText }) })
        : createVideoObject({ ...options, ...(item.altText && { description: item.altText }) });
    });
  }

  private buildLikeActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];
    const user = this.buildAccountUser(record);

    const likeAction: LikeAction = {
      '@type': 'LikeAction',
      // An account likes a tweet once, so the two identify the like: the
      // same tweet liked from two accounts is two likes.
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
      source: 'twitter',
      // The API gives when; the archive doesn't.
      ...when(record.data.likedAt, record.data.likedDuring),
      agent: user,
      object: this.buildTargetTweet(record),
    };

    actions.push(likeAction);
    return actions;
  }

  private buildBookmarkActions(record: Record): ActionAndChildren[] {
    const bookmarkAction: BookmarkAction = {
      '@type': 'BookmarkAction',
      // An account bookmarks a tweet once, so the two identify the bookmark.
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
      source: 'twitter',
      ...when(record.data.bookmarkedAt, record.data.bookmarkedDuring),
      agent: this.buildAccountUser(record),
      object: this.buildTargetTweet(record),
    };

    return [bookmarkAction];
  }

  /**
   * A tweet you liked or bookmarked. The API names its author and gives its
   * mentions, links, hashtags, and media; the archive gives only its text.
   */
  private buildTargetTweet(record: Record): Post {
    const { entities, fullText } = record.data;
    // Only the API gives entities, and they're complete, so the text isn't
    // searched for more.
    const references = entities
      ? [
          ...this.extractMentionedUsersFromEntities(entities, ''),
          ...this.extractUrlReferencesFromEntities(entities, ''),
        ]
      : [];
    const tags = this.buildHashtags(entities);
    const media = this.buildMedia(record.data.media);
    const author = this.buildAuthor(record.data);
    return {
      '@type': 'Post',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'twitter',
      sourceId: record.data.tweetId,
      ...(author?.handle && { url: postUrl(author.handle, record.data.tweetId) }),
      body: unescapeText(fullText),
      ...(author && { author: [author] }),
      ...(references.length > 0 && { references }),
      ...(tags.length > 0 && { about: tags }),
      ...(media.length > 0 && { contains: media }),
    };
  }

  /**
   * The hashtags a tweet is about, from its entities, each once. X matches a
   * hashtag whatever its case, so `#AI` and `#ai` are one tag, `ai`.
   */
  private buildHashtags(entities: any): Tag[] {
    const handles = new Set<string>();
    for (const hashtag of entities?.hashtags ?? []) {
      const handle = String(hashtag?.text ?? '').toLowerCase();
      if (handle) handles.add(handle);
    }
    return [...handles].map(handle => ({
      '@type': 'Tag',
      '@key': ['@type', 'source', 'handle'],
      source: 'twitter',
      handle,
    }));
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
      body: unescapeText(record.data.text),
      recipient: [recipient],
      author: [sender],
      ...this.containing(record.data.media),
    };

    const sendAction: MessageAction = {
      '@type': 'MessageAction',
      // Keyed by the message it sent.
      '@key': ['@type', 'source', 'result.sourceId'],
      source: 'twitter',
      timestamp: record.data.created_at,
      agent: sender,
      result: message,
    };

    actions.push(sendAction);
    return actions;
  }

  /** A message's `contains`: its photos and videos, if it has any. */
  private containing(media: TweetMedia[] | undefined): { contains?: MediaObjectAndChildren[] } {
    const contains = this.buildMedia(media);
    return contains.length > 0 ? { contains } : {};
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
      url: profileUrl(accountInfo.username),
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
          // The archive names a mentioned account; the API gives only its handle.
          ...(mention.name && { name: mention.name }),
          url: profileUrl(mention.screen_name),
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
          url: profileUrl(username),
        });
      }
    }

    return mentions;
  }

  private extractUrlReferencesFromEntities(entities: any, text: string): any[] {
    const urls: any[] = [];
    // A tweet's link to its own photo or video isn't a reference: the media
    // is in `contains`.
    const mediaLinks = new Set((entities?.media ?? []).map((media: any) => media.url));

    // Primary: Use entities.urls for structured data
    if (entities?.urls && entities.urls.length > 0) {
      for (const urlEntity of entities.urls) {
        if (mediaLinks.has(urlEntity.url)) continue;
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
        if (mediaLinks.has(url)) continue;

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
      body: unescapeText(record.data.text),
      recipient: recipients,
      author: [sender],
      ...this.containing(record.data.media),
    };

    const sendAction: MessageAction = {
      '@type': 'MessageAction',
      // Keyed by the message it sent.
      '@key': ['@type', 'source', 'result.sourceId'],
      source: 'twitter',
      timestamp: record.data.created_at,
      agent: sender,
      result: message,
    };

    actions.push(sendAction);
    return actions;
  }
}

/**
 * An account's page on X, as a browser has it, so it's the page in your
 * browser history.
 */
function profileUrl(handle: string): string {
  return `https://x.com/${handle}`;
}

/**
 * A tweet's page on X, as a browser has it: under its author's handle, so a
 * post needs one to have it.
 */
function postUrl(handle: string, id: string): string {
  return `${profileUrl(handle)}/status/${id}`;
}

/**
 * An action's timestamp: the instant, or else the shortest UTC day, month,
 * or year that holds the stretch it's known to be in. None for a stretch
 * across years.
 */
function when(at: string | undefined, during: string | undefined): { timestamp?: string } {
  if (at) return { timestamp: at };
  const [start, end] = (during ?? '').split('/');
  if (!start || !end) return {};
  // The stretch ends before `end`, so its last moment is just before it.
  const first = new Date(start).toISOString();
  const last = new Date(Date.parse(end) - 1).toISOString();
  for (const length of [10, 7, 4]) {
    if (first.slice(0, length) === last.slice(0, length))
      return { timestamp: first.slice(0, length) };
  }
  return {};
}
