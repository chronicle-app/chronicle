import {
  ChronicleTransformer,
  Record,
  createImageObject,
  createVideoObject,
  decodeEntities,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  BookmarkAction,
  DeleteAction,
  Entity,
  FollowAction,
  LikeAction,
  Location,
  MediaObjectAndChildren,
  Message,
  MessageAction,
  PublishAction,
  Post,
  RespondAction,
  ShareAction,
  SoftwareAgent,
  SoftwareApplication,
  Tag,
  Thread,
  UpdateAction,
} from '@chronicle.app/schema';
import { type TweetMedia, mimeTypeOf } from '../utils/media.js';
import type { GrokMessage } from './archive/TwitterArchiveGrokExtractor.js';

const SOURCE = 'twitter';
const BY_SOURCE_ID = ['@type', 'source', 'sourceId'];

/**
 * Grok, X's assistant: one entity wherever it answers, as Claude is. xAI
 * makes it, so its handle is xAI's.
 */
const GROK: SoftwareAgent = {
  '@type': 'SoftwareAgent',
  '@key': ['@type', 'source', 'handle'],
  source: 'xai',
  handle: 'grok',
  name: 'Grok',
};

/**
 * A link to a tweet's page: under its author's handle, or X's own
 * `i/web/status` and `i/status`, which have none.
 */
const STATUS_LINK =
  /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/(?:#!\/)?(?:i\/(?:web\/)?|(\w+)\/)status(?:es)?\/(\d+)/i;

export default class TwitterTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    switch (record.extraction.recordType) {
      case 'tweets':
        return this.buildTweetActions(record);
      case 'likes':
        return [this.buildLikeAction(record)];
      case 'bookmarks':
        return [this.buildBookmarkAction(record)];
      case 'mentions':
        // From the API, whose entities are complete.
        return [this.buildPostAction(record.data, this.buildAuthor(record.data), true)];
      case 'direct-messages':
      case 'group-direct-messages':
        return this.buildMessageActions(record);
      case 'profile':
        return [this.buildProfileUpdate(record)];
      case 'followers':
      case 'following':
        return [this.buildFollow(record)];
      case 'grok-chats':
        return [this.buildGrokMessage(record)];
      default:
        return [];
    }
  }

  /** A tweet you posted, and that you deleted it, if you did. */
  private buildTweetActions(record: Record): ActionAndChildren[] {
    // The API's entities are complete, so its text isn't searched for more.
    const complete = record.context?.strategy === 'api';
    const author = this.buildAccountUser(record);
    const actions = [this.buildPostAction(record.data, author, complete)];
    if (record.data.deletedAt) actions.push(this.buildDeletion(record.data, author));
    return actions;
  }

  /**
   * A tweet's PublishAction by its author, where it was posted from and with
   * which app when the tweet says, or for a retweet, the author's ShareAction
   * of the post it retweets. The archive's retweets, which don't say which
   * post they were of, stay tweets.
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
        source: SOURCE,
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
      source: SOURCE,
      timestamp: data.created_at,
      ...(author && { agent: author }),
      ...placeOf(data.coordinates),
      ...appOf(data.source),
      result: this.buildPost(data, author, complete),
    };
    return publish;
  }

  /**
   * A tweet: its text, author, mentions, links, hashtags, photos, and videos,
   * and the post it replies to.
   */
  private buildPost(data: any, author: Agent | undefined, complete: boolean): Post {
    const text = complete ? '' : data.text;
    const references = [
      ...this.extractMentionedUsersFromEntities(data.entities, text),
      // A long post links to itself for the rest of its text.
      ...this.extractUrlReferencesFromEntities(data.entities, text).filter(
        link => !(link['@type'] === 'Post' && (link as Post).sourceId === data.id)
      ),
    ];
    const tags = this.buildHashtags(data.entities);
    const media = this.buildMedia(data.media);
    const repliedTo = this.buildRepliedTo(data, author);
    return {
      '@type': 'Post',
      '@key': BY_SOURCE_ID,
      source: SOURCE,
      sourceId: data.id,
      ...(author?.handle && { url: postUrl(author.handle, data.id) }),
      body: plain(data.text), // Keep original text with t.co URLs
      ...(author && { author: [author] }),
      ...(repliedTo && { inReplyTo: [repliedTo] }),
      ...(references.length > 0 && { references }),
      ...(tags.length > 0 && { about: tags }),
      ...(media.length > 0 && { contains: media }),
    };
  }

  /**
   * The post a reply answers, and who posted it. The archive gives their
   * handle; the API gives it only when they wrote the reply too, as in a
   * thread.
   */
  private buildRepliedTo(data: any, author: Agent | undefined): Post | undefined {
    const id = data.in_reply_to_status_id;
    if (!id) return undefined;
    const userId: string | undefined = data.in_reply_to_user_id;
    const handle: string | undefined =
      data.in_reply_to_screen_name ??
      (userId && userId === author?.sourceId ? author.handle : undefined);
    return {
      '@type': 'Post',
      '@key': BY_SOURCE_ID,
      source: SOURCE,
      sourceId: id,
      ...(handle && { url: postUrl(handle, id) }),
      ...(userId && {
        author: [
          {
            ...this.buildPersonFromUserId(userId),
            ...(handle && { handle, url: profileUrl(handle) }),
          },
        ],
      }),
    };
  }

  /** The post a retweet retweets: in full when X still has it, else just which. */
  private buildRetweeted(retweeted: any): Post {
    if (retweeted.text === undefined) return postById(retweeted.id);
    return this.buildPost(retweeted, this.buildAuthor(retweeted), true);
  }

  /** That you deleted a tweet, and when. */
  private buildDeletion(data: any, author: Agent): DeleteAction {
    return {
      '@type': 'DeleteAction',
      '@key': ['@type', 'source', 'object.sourceId'],
      source: SOURCE,
      timestamp: data.deletedAt,
      agent: author,
      object: postById(data.id),
    };
  }

  /** Who posted a tweet from the API, with their handle and name when X gave them. */
  private buildAuthor(data: any): Agent | undefined {
    const id = data.author?.id ?? data.authorId;
    if (!id) return undefined;
    const { username, name } = data.author ?? {};
    return {
      ...this.buildPersonFromUserId(id),
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
          ? { '@key': BY_SOURCE_ID, source: SOURCE, sourceId: item.id }
          : { '@key': ['@type', 'url'] }),
        ...(item.width && { width: item.width }),
        ...(item.height && { height: item.height }),
      };
      return item.type === 'photo'
        ? createImageObject({ ...options, ...(item.altText && { caption: item.altText }) })
        : createVideoObject({ ...options, ...(item.altText && { description: item.altText }) });
    });
  }

  private buildLikeAction(record: Record): LikeAction {
    return {
      '@type': 'LikeAction',
      // An account likes a tweet once, so the two identify the like: the
      // same tweet liked from two accounts is two likes.
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
      source: SOURCE,
      // The API gives when; the archive doesn't.
      ...when(record.data.likedAt, record.data.likedDuring),
      agent: this.buildAccountUser(record),
      object: this.buildTargetTweet(record),
    };
  }

  private buildBookmarkAction(record: Record): BookmarkAction {
    return {
      '@type': 'BookmarkAction',
      // An account bookmarks a tweet once, so the two identify the bookmark.
      '@key': ['@type', 'source', 'object.sourceId', 'agent.sourceId'],
      source: SOURCE,
      ...when(record.data.bookmarkedAt, record.data.bookmarkedDuring),
      agent: this.buildAccountUser(record),
      object: this.buildTargetTweet(record),
    };
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
      '@key': BY_SOURCE_ID,
      source: SOURCE,
      sourceId: record.data.tweetId,
      ...(author?.handle && { url: postUrl(author.handle, record.data.tweetId) }),
      body: plain(fullText),
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
      source: SOURCE,
      handle,
    }));
  }

  /**
   * A direct message, sent to the other participant, or in a group to
   * everyone else in it then, as part of its conversation, and the reactions
   * to it.
   */
  private buildMessageActions(record: Record): ActionAndChildren[] {
    const { data } = record;
    const sender = this.buildPersonFromUserId(data.senderId);
    const recipients =
      record.extraction.recordType === 'group-direct-messages'
        ? (data.participants ?? [])
            .filter((participantId: string) => participantId !== data.senderId)
            .map((participantId: string) => this.buildPersonFromUserId(participantId))
        : [this.buildPersonFromUserId(data.recipientId)];
    const references = messageLinks(data.urls);

    const message: Message = {
      '@type': 'Message',
      '@key': BY_SOURCE_ID,
      source: SOURCE,
      sourceId: data.id,
      body: plain(data.text),
      recipient: recipients,
      author: [sender],
      isPartOf: [conversation(data.conversationId, data.conversationName)],
      ...(references.length > 0 && { references }),
      ...this.containing(data.media),
    };

    const sendAction: MessageAction = {
      '@type': 'MessageAction',
      // Keyed by the message it sent.
      '@key': ['@type', 'source', 'result.sourceId'],
      source: SOURCE,
      timestamp: data.created_at,
      agent: sender,
      result: message,
    };

    return [sendAction, ...this.buildReactions(data)];
  }

  /**
   * The reactions to a message, each a RespondAction whose Response is the
   * reaction as X names it, such as `like` or `funny`.
   */
  private buildReactions(data: any): RespondAction[] {
    return (data.reactions ?? [])
      .filter((reaction: any) => reaction.eventId && reaction.senderId)
      .map((reaction: any): RespondAction => ({
        '@type': 'RespondAction',
        // Keyed by the reaction, which X gives an id.
        '@key': ['@type', 'source', 'result.sourceId'],
        source: SOURCE,
        timestamp: reaction.createdAt,
        agent: this.buildPersonFromUserId(reaction.senderId),
        object: { '@type': 'Message', '@key': BY_SOURCE_ID, source: SOURCE, sourceId: data.id },
        result: {
          '@type': 'Response',
          '@key': BY_SOURCE_ID,
          source: SOURCE,
          sourceId: reaction.eventId,
          body: reaction.reactionKey,
        },
      }));
  }

  /** A message's `contains`: its photos and videos, if it has any. */
  private containing(media: TweetMedia[] | undefined): { contains?: MediaObjectAndChildren[] } {
    const contains = this.buildMedia(media);
    return contains.length > 0 ? { contains } : {};
  }

  /**
   * Your profile when X generated the archive, carried by the UpdateAction
   * that sighted it, dated then: its bio, location, and avatar.
   */
  private buildProfileUpdate(record: Record): UpdateAction {
    const { bio, location, avatar } = record.data;
    const you = this.buildAccountUser(record);
    const sightedAt = record.extraction.assertedAt;
    return {
      '@type': 'UpdateAction',
      '@key': ['@type', 'source', 'object.sourceId', 'timestamp'],
      source: SOURCE,
      ...(sightedAt && { timestamp: sightedAt }),
      agent: you,
      object: {
        ...you,
        ...(bio && { description: decodeEntities(bio) }),
        ...(location && { location: { '@type': 'Location', address: decodeEntities(location) } }),
        ...(avatar && {
          emblem: createImageObject({
            url: avatar.url,
            path: avatar.path,
            mimeType: mimeTypeOf(avatar),
          }),
        }),
      },
    };
  }

  /**
   * A follow, either way: yours of an account, or an account's of you. X
   * gives no date for either.
   */
  private buildFollow(record: Record): FollowAction {
    const you = this.buildAccountUser(record);
    const them = this.buildPersonFromUserId(record.data.accountId);
    const yours = record.extraction.recordType === 'following';
    return {
      '@type': 'FollowAction',
      // An account follows another once.
      '@key': ['@type', 'source', 'agent.sourceId', 'object.sourceId'],
      source: SOURCE,
      agent: yours ? you : them,
      object: yours ? them : you,
    };
  }

  /**
   * A message in a chat with Grok, as Claude's are: yours authored by you,
   * Grok's by Grok, each part of the chat's Thread. X doesn't say which model
   * answered, so an answer names no instrument. An answer's references are
   * the posts it drew on.
   */
  private buildGrokMessage(record: Record): MessageAction {
    const message = record.data as GrokMessage;
    const author = message.sender === 'user' ? this.buildAccountUser(record) : GROK;
    const references = (message.postIds ?? []).map(id => postById(id));
    return {
      '@type': 'MessageAction',
      // Keyed by the message it sent.
      '@key': ['@type', 'source', 'result.sourceId'],
      source: SOURCE,
      timestamp: message.createdAt,
      agent: author,
      result: {
        '@type': 'Message',
        '@key': BY_SOURCE_ID,
        source: SOURCE,
        sourceId: message.id,
        body: message.text,
        author: [author],
        isPartOf: [conversation(message.chatId)],
        ...(references.length > 0 && { references }),
      } satisfies Message,
    };
  }

  private buildAccountUser(record: Record): Agent {
    const accountInfo = record.context?.accountInfo;

    if (!accountInfo) {
      throw new Error(
        'Account information is required to build user agent. Ensure account.js is present in Twitter export.'
      );
    }

    return {
      ...this.buildPersonFromUserId(accountInfo.accountId),
      handle: accountInfo.username,
      name: accountInfo.accountDisplayName,
      url: profileUrl(accountInfo.username),
      sameAs: ['@me'],
    };
  }

  private buildPersonFromUserId(userId: string): Agent {
    return {
      '@type': 'Agent',
      '@key': BY_SOURCE_ID,
      source: SOURCE,
      sourceId: userId,
    };
  }

  private extractMentionedUsersFromEntities(entities: any, text: string): Agent[] {
    const mentions: Agent[] = [];

    // Primary: Use entities.user_mentions for structured data
    if (entities?.user_mentions && entities.user_mentions.length > 0) {
      for (const mention of entities.user_mentions) {
        mentions.push({
          ...this.buildPersonFromUserId(mention.id_str),
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
          source: SOURCE,
          handle: username,
          url: profileUrl(username),
        });
      }
    }

    return mentions;
  }

  /** A tweet's links: a link to a tweet is that tweet, as a quote is. */
  private extractUrlReferencesFromEntities(entities: any, text: string): (Entity | Post)[] {
    const urls: (Entity | Post)[] = [];
    // A tweet's link to its own photo or video isn't a reference: the media
    // is in `contains`.
    const mediaLinks = new Set((entities?.media ?? []).map((media: any) => media.url));

    // Primary: Use entities.urls for structured data
    if (entities?.urls && entities.urls.length > 0) {
      for (const urlEntity of entities.urls) {
        if (mediaLinks.has(urlEntity.url)) continue;
        // Use expanded URL if available, otherwise fall back to original
        urls.push(linkTo(urlEntity.expanded_url || urlEntity.url));
      }
    } else {
      // Fallback: Use regex parsing for edge cases where entities is empty
      const urlRegex = /https?:\/\/[^\s)]+/g;
      let match;

      while ((match = urlRegex.exec(text)) !== null) {
        // Remove trailing punctuation that shouldn't be part of the URL
        const url = match[0].replace(/[).,;!?]+$/, '');
        if (mediaLinks.has(url)) continue;
        urls.push(linkTo(url));
      }
    }

    return urls;
  }
}

/** Text as its author wrote it: X escapes it as HTML (`&amp;`, `&lt;`). */
function plain(text: string | undefined): string | undefined {
  return text === undefined ? undefined : decodeEntities(text);
}

/** A post known only by its id. */
function postById(id: string): Post {
  return { '@type': 'Post', '@key': BY_SOURCE_ID, source: SOURCE, sourceId: id };
}

/**
 * What a link points to. A tweet's page is the tweet, so a quote, or a tweet
 * shared in a message, is that Post; anything else is the page.
 */
function linkTo(url: string): Entity | Post {
  const match = url.match(STATUS_LINK);
  if (!match) return { '@type': 'Entity', '@key': ['@type', 'url'], url };
  const [, handle, id] = match;
  return { ...postById(id), ...(handle && { url: postUrl(handle, id) }) };
}

/**
 * A message's links, each once, less the ones to its own photos and videos,
 * which it contains.
 */
function messageLinks(urls: { url?: string; expanded?: string }[] | undefined): (Entity | Post)[] {
  const links = new Set<string>();
  for (const link of urls ?? []) {
    const url = link.expanded || link.url;
    if (url && !url.includes('/messages/media/')) links.add(url);
  }
  return [...links].map(url => linkTo(url));
}

/** A conversation: a DM conversation, by X's id, with a group's name, or a chat with Grok. */
function conversation(id: string, name?: string): Thread {
  return {
    '@type': 'Thread',
    '@key': BY_SOURCE_ID,
    source: SOURCE,
    sourceId: id,
    ...(name && { name }),
  };
}

/** Where a tweet was posted from, when it says. */
function placeOf(coordinates?: { latitude: number; longitude: number }): { location?: Location } {
  return coordinates ? { location: { '@type': 'Location', ...coordinates } } : {};
}

/**
 * The app a tweet was posted with, from the archive's link to it, such as
 * `<a href="http://twitter.com/download/iphone">Twitter for iPhone</a>`.
 */
function appOf(source: string | undefined): { instrument?: SoftwareApplication[] } {
  const match = source?.match(/^<a href="([^"]*)"[^>]*>([^<]+)<\/a>$/);
  if (!match) return {};
  const [, url, name] = match;
  return {
    instrument: [
      {
        '@type': 'SoftwareApplication',
        '@key': ['@type', 'source', 'name'],
        source: SOURCE,
        name: decodeEntities(name),
        ...(url && { url }),
      },
    ],
  };
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
