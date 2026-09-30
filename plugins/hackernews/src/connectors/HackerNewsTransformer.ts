import { ChronicleTransformer, Record, htmlToText, selfAgent } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  Comment,
  Entity,
  Post,
  PublishAction,
  RespondAction,
} from '@chronicle.app/schema';
import { HackerNewsItem, HackerNewsUser } from '../utils/HackerNewsProxy.js';

const SOURCE = 'hacker-news';
const KEY: ['@type', 'source', 'sourceId'] = ['@type', 'source', 'sourceId'];

function itemUrl(id: number): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

function time(item: HackerNewsItem): Date {
  return new Date((item.time ?? 0) * 1000);
}

export default class HackerNewsTransformer extends ChronicleTransformer {
  /** The account being extracted, set per record from context. */
  private user?: HackerNewsUser;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    // Safe as a per-record field: everything below builds synchronously.
    this.user = record.context.user;
    const item = record.data as HackerNewsItem;

    switch (record.extraction.recordType) {
      case 'submissions': {
        return [this.buildPublish(item)];
      }
      // A reply is a comment by someone else; both answer their parent.
      case 'comments':
      case 'replies': {
        return [this.buildRespond(item, record.context.parent, record.context.root)];
      }
      default: {
        return [];
      }
    }
  }

  private buildPublish(item: HackerNewsItem): PublishAction {
    return {
      '@type': 'PublishAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: String(item.id),
      timestamp: time(item),
      ...(item.by && { agent: this.buildUser(item.by) }),
      object: this.buildPost(item),
    };
  }

  /**
   * A comment answers its direct parent (the action's `object`) and is about
   * the submission at the top of its thread (the comment's `about`). For a
   * top-level comment the two are the same Post.
   */
  private buildRespond(
    item: HackerNewsItem,
    parent: HackerNewsItem | null | undefined,
    root: HackerNewsItem | undefined
  ): RespondAction {
    return {
      '@type': 'RespondAction',
      '@key': KEY,
      source: SOURCE,
      sourceId: String(item.id),
      timestamp: time(item),
      ...(item.by && { agent: this.buildUser(item.by) }),
      ...(parent && { object: this.buildItem(parent, root) }),
      result: this.buildComment(item, root),
    };
  }

  private buildItem(item: HackerNewsItem, root: HackerNewsItem | undefined): Post | Comment {
    return item.type === 'comment' ? this.buildComment(item, root) : this.buildPost(item);
  }

  private buildPost(item: HackerNewsItem): Post {
    const body = htmlToText(item.text);
    return {
      '@type': 'Post',
      '@key': KEY,
      source: SOURCE,
      sourceId: String(item.id),
      url: itemUrl(item.id),
      ...(item.title && { name: item.title }),
      ...(body && { body }),
      ...(item.by && { author: [this.buildUser(item.by)] }),
      ...(item.url && { references: [this.buildLink(item.url)] }),
    };
  }

  private buildComment(item: HackerNewsItem, root: HackerNewsItem | undefined): Comment {
    const body = htmlToText(item.text);
    return {
      '@type': 'Comment',
      '@key': KEY,
      source: SOURCE,
      sourceId: String(item.id),
      url: itemUrl(item.id),
      ...(body && { body }),
      ...(item.by && { author: [this.buildUser(item.by)] }),
      ...(root && { about: [this.buildPost(root)] }),
    };
  }

  /**
   * The submitted page. Keyed to this source like Pinboard's bookmarks; the
   * `url` field still mints the shared `{url}` hub.
   */
  private buildLink(url: string): Entity {
    return { '@type': 'Entity', '@key': ['url', 'source'], source: SOURCE, url };
  }

  private buildUser(username: string): Agent {
    if (username !== this.user?.id) {
      return {
        '@type': 'Agent',
        '@key': KEY,
        source: SOURCE,
        sourceId: username,
        handle: username,
      };
    }
    const description = htmlToText(this.user.about);
    return {
      ...selfAgent({ type: 'Agent', source: SOURCE, sourceId: username, handle: username }),
      ...(description && { description }),
    };
  }
}
