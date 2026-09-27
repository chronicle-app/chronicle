import axios, { AxiosInstance } from 'axios';

const API_BASE = 'https://api.are.na/v3';

// Are.na v3 entities. The v2 API has been retired; v3 uses a different shape
// (User has `name`/`slug` rather than `username`/`full_name`, Channel uses
// `owner`/`title`/`visibility`, and Blocks are typed by `type`).

export interface ArenaUser {
  id: number;
  type: 'User';
  slug: string;
  name: string;
  avatar: string | null;
  initials?: string;
}

export interface ArenaGroup {
  id: number;
  type: 'Group';
  slug: string;
  name: string;
  avatar: string | null;
}

export interface ArenaChannelCounts {
  blocks: number;
  channels: number;
  contents: number;
  collaborators: number;
}

export interface ArenaChannel {
  id: number;
  type: 'Channel';
  base_type?: 'Channel';
  slug: string;
  title: string;
  description: string | ArenaMarkdown | null;
  visibility: string;
  state: string;
  owner: ArenaUser;
  counts?: ArenaChannelCounts;
  created_at: string;
  updated_at: string;
  connection?: ArenaConnection | null;
}

export interface ArenaMarkdown {
  markdown?: string;
  html?: string;
  plain?: string;
}

export interface ArenaBlockImage {
  src?: string;
  width?: number | null;
  height?: number | null;
  alt_text?: string | null;
}

export interface ArenaBlockSource {
  url?: string;
  title?: string | null;
}

export interface ArenaBlockAttachment {
  url?: string;
  filename?: string | null;
  content_type?: string | null;
}

export interface ArenaBlockEmbed {
  url?: string | null;
  title?: string | null;
  source_url?: string | null;
}

export interface ArenaBlock {
  id: number;
  type: 'Text' | 'Image' | 'Link' | 'Attachment' | 'Embed';
  base_type: 'Block';
  title: string | null;
  description?: string | ArenaMarkdown | null;
  content?: string | ArenaMarkdown | null;
  source?: ArenaBlockSource | null;
  image?: ArenaBlockImage | null;
  attachment?: ArenaBlockAttachment | null;
  embed?: ArenaBlockEmbed | null;
  user: ArenaUser;
  comment_count: number;
  created_at: string;
  updated_at: string;
  connection?: ArenaConnection | null;
}

export interface ArenaConnection {
  id: number;
  position?: number;
  pinned?: boolean;
  connected_at: string;
  connected_by: ArenaUser;
}

export type ArenaContentItem = ArenaBlock | ArenaChannel;

export interface ArenaComment {
  id: number;
  type: 'Comment';
  body: string | ArenaMarkdown;
  created_at: string;
  updated_at: string;
  user: ArenaUser;
}

export interface ArenaFollowing {
  users: ArenaUser[];
  channels: ArenaChannel[];
  groups: ArenaGroup[];
}

// Page-based list envelope used by the v3 collection endpoints.
interface PageMeta {
  current_page: number;
  next_page: number | null;
  total_pages: number;
  has_more_pages: boolean;
}

interface PagedResponse<T> {
  meta: PageMeta;
  data: T[];
}

export function isChannel(item: ArenaContentItem): item is ArenaChannel {
  return item.type === 'Channel';
}

export function isBlock(item: ArenaContentItem): item is ArenaBlock {
  return item.type !== 'Channel';
}

export default class ArenaProxy {
  private client: AxiosInstance;

  constructor(accessToken?: string) {
    this.client = axios.create({
      baseURL: API_BASE,
      headers: {
        Authorization: accessToken ? `Bearer ${accessToken}` : undefined,
        'User-Agent': 'Chronicle/1.0',
        'Content-Type': 'application/json',
      },
    });
  }

  /** The authenticated user. */
  public async getMe(): Promise<ArenaUser> {
    const response = await this.client.get('/me');
    return response.data;
  }

  /** A user selected explicitly for extraction. */
  public async getUser(userId: number): Promise<ArenaUser> {
    const response = await this.client.get(`/users/${userId}`);
    return response.data;
  }

  /**
   * Walk every page of a page-based collection endpoint, collecting `data`.
   * Are.na asks API clients to be respectful, so pages are fetched serially
   * with a short delay.
   */
  private async getAllPages<T>(
    path: string,
    params: Record<string, string | number> = {}
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      // Fetch sequentially to respect pagination and API request limits.
      // eslint-disable-next-line no-await-in-loop
      const response = await this.client.get<PagedResponse<T>>(path, {
        params: { ...params, page, per: 50 },
      });
      const { data, meta } = response.data;
      all.push(...data);

      hasMore = Boolean(meta?.has_more_pages) && data.length > 0;
      if (hasMore) {
        page += 1;
        // eslint-disable-next-line no-await-in-loop -- Pace successive API pages.
        await this.delay(500);
      }
    }

    return all;
  }

  /**
   * The channels a user owns or collaborates on, most recently active first so
   * callers see the latest activity before older history. (Are.na's own `sort`
   * params are unreliable, so order client-side on the real timestamps.)
   */
  public async getUserChannels(userId: number): Promise<ArenaChannel[]> {
    const channels = await this.getAllPages<ArenaChannel>(`/users/${userId}/contents`, {
      type: 'Channel',
    });
    return channels.sort((a, b) => Number(new Date(b.updated_at)) - Number(new Date(a.updated_at)));
  }

  /**
   * Every content item (blocks and nested channels) in a channel, most recently
   * connected first (falling back to the item's own creation time).
   */
  public async getChannelContents(channelId: number): Promise<ArenaContentItem[]> {
    const items = await this.getAllPages<ArenaContentItem>(`/channels/${channelId}/contents`);
    const connectedAt = (item: ArenaContentItem): number =>
      Number(new Date(item.connection?.connected_at ?? item.created_at));
    return items.sort((a, b) => connectedAt(b) - connectedAt(a));
  }

  /** Comments on a block. */
  public async getBlockComments(blockId: number): Promise<ArenaComment[]> {
    return this.getAllPages<ArenaComment>(`/blocks/${blockId}/comments`);
  }

  /** The users, channels, and groups a user follows. */
  public async getUserFollowing(userId: number): Promise<ArenaFollowing> {
    const items = await this.getAllPages<ArenaUser | ArenaChannel | ArenaGroup>(
      `/users/${userId}/following`
    );

    const following: ArenaFollowing = { users: [], channels: [], groups: [] };
    for (const item of items) {
      switch (item.type) {
        case 'User':
          following.users.push(item);
          break;
        case 'Channel':
          following.channels.push(item);
          break;
        case 'Group':
          following.groups.push(item);
          break;
        // no default
      }
    }
    return following;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, ms);
    });
  }
}
