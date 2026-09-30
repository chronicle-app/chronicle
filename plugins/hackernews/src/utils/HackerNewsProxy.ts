import { ApiProxy } from '@chronicle.app/etl';

/** A user profile from the Firebase API. */
export interface HackerNewsUser {
  id: string;
  created: number;
  karma?: number;
  about?: string;
  /** Every item the user posted, newest first. */
  submitted?: number[];
}

/** An item from the Firebase API: a story, comment, poll, poll option, or job. */
export interface HackerNewsItem {
  id: number;
  type?: 'story' | 'comment' | 'poll' | 'pollopt' | 'job';
  by?: string;
  /** Unix time in seconds. */
  time?: number;
  text?: string;
  url?: string;
  title?: string;
  parent?: number;
  kids?: number[];
  deleted?: boolean;
  dead?: boolean;
}

export default class HackerNewsProxy extends ApiProxy {
  // Items never move between threads, so one fetch per run serves every
  // comment that shares an ancestor.
  private items = new Map<number, Promise<HackerNewsItem | null>>();

  constructor() {
    super({ baseURL: 'https://hacker-news.firebaseio.com/v0' });
  }

  // The API is public; there is nothing to load.
  public async initialize(): Promise<void> {}

  /** The profile, or null when no such user exists. */
  public async getUser(username: string): Promise<HackerNewsUser | null> {
    return this.request<HackerNewsUser | null>({
      url: `/user/${encodeURIComponent(username)}.json`,
      method: 'GET',
    });
  }

  /** The item, or null when the id doesn't exist. */
  public getItem(id: number): Promise<HackerNewsItem | null> {
    let item = this.items.get(id);
    if (!item) {
      item = this.request<HackerNewsItem | null>({ url: `/item/${id}.json`, method: 'GET' });
      this.items.set(id, item);
    }
    return item;
  }

  /** The story, poll, or job at the top of the item's thread. */
  public async getRoot(item: HackerNewsItem): Promise<HackerNewsItem | undefined> {
    let current: HackerNewsItem | null = item;
    const seen = new Set<number>();
    while (current?.type === 'comment' && current.parent !== undefined) {
      if (seen.has(current.id)) return undefined;
      seen.add(current.id);
      current = await this.getItem(current.parent);
    }
    return current && current.type !== 'comment' ? current : undefined;
  }
}
