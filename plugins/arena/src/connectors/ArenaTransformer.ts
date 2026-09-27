import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  CreateAction,
  BookmarkAction,
  FollowAction,
  Collection,
  Post,
  Comment,
  ImageObject,
} from '@chronicle.app/schema';
import {
  ArenaChannel,
  ArenaBlock,
  ArenaUser,
  ArenaGroup,
  ArenaConnection,
  ArenaContentItem,
  ArenaComment,
  ArenaFollowing,
  ArenaMarkdown,
  isChannel,
} from '../utils/ArenaProxy.js';

const SOURCE = 'arena';
const KEY = ['@type', 'source', 'sourceId'];

export default class ArenaTransformer extends ChronicleTransformer {
  /** Authenticated user id (the "me"), set per record from context. */
  private selfUserId?: number;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    this.logger.debug('Transforming arena record', {
      recordType: record.extraction.recordType,
    });

    // Safe as a per-record field: the build* methods below run synchronously,
    // with no await between this assignment and the buildUser calls.
    this.selfUserId = (record.context as { userId?: number })?.userId;

    let actions: ActionAndChildren[] = [];
    switch (record.extraction.recordType) {
      case 'channels':
        actions = this.buildChannelCreate(record.data as ArenaChannel);
        break;
      case 'connections':
        actions = this.buildConnectionBookmark(
          record.data as {
            item: ArenaContentItem;
            channel: ArenaChannel;
            connection: ArenaConnection;
          }
        );
        break;
      case 'blocks':
        actions = this.buildBlockCreate(record.data as ArenaBlock);
        break;
      case 'comments':
        actions = this.buildCommentCreate(
          record.data as { comment: ArenaComment; block: ArenaBlock }
        );
        break;
      case 'follows':
        actions = this.buildFollowActions(record.data as ArenaFollowing & { follower: ArenaUser });
        break;
    }

    this.logger.verboseInfo(`Generated ${actions.length} actions from arena record`);
    return actions;
  }

  // --- Actions ---------------------------------------------------------------

  private buildChannelCreate(channel: ArenaChannel): ActionAndChildren[] {
    const createAction: CreateAction = {
      '@type': 'CreateAction',
      '@key': KEY,
      timestamp: new Date(channel.created_at),
      source: SOURCE,
      sourceId: `channel-${channel.id}`,
      agent: this.buildUser(channel.owner),
      object: this.buildCollection(channel),
    };
    return [createAction];
  }

  private buildConnectionBookmark(data: {
    item: ArenaContentItem;
    channel: ArenaChannel;
    connection: ArenaConnection;
  }): ActionAndChildren[] {
    const { item, channel, connection } = data;
    const object = isChannel(item) ? this.buildCollection(item) : this.buildPost(item);

    const bookmarkAction: BookmarkAction = {
      '@type': 'BookmarkAction',
      '@key': KEY,
      timestamp: new Date(connection.connected_at),
      source: SOURCE,
      sourceId: connection.id.toString(),
      agent: this.buildUser(connection.connected_by),
      object,
      target: this.buildCollection(channel),
    };
    return [bookmarkAction];
  }

  private buildBlockCreate(block: ArenaBlock): ActionAndChildren[] {
    const createAction: CreateAction = {
      '@type': 'CreateAction',
      '@key': KEY,
      timestamp: new Date(block.created_at),
      source: SOURCE,
      sourceId: `block-${block.id}`,
      agent: this.buildUser(block.user),
      object: this.buildPost(block),
    };
    return [createAction];
  }

  private buildCommentCreate(data: {
    comment: ArenaComment;
    block: ArenaBlock;
  }): ActionAndChildren[] {
    const { comment, block } = data;
    const commentEntity: Comment = {
      '@type': 'Comment',
      '@key': KEY,
      source: SOURCE,
      sourceId: comment.id.toString(),
      author: [this.buildUser(comment.user)],
      about: [this.buildPost(block)],
    };
    const body = this.textOf(comment.body);
    if (body) {
      commentEntity.body = body;
    }

    const createAction: CreateAction = {
      '@type': 'CreateAction',
      '@key': KEY,
      timestamp: new Date(comment.created_at),
      source: SOURCE,
      sourceId: `comment-${comment.id}`,
      agent: this.buildUser(comment.user),
      object: commentEntity,
    };
    return [createAction];
  }

  private buildFollowActions(data: ArenaFollowing & { follower: ArenaUser }): ActionAndChildren[] {
    const follower = this.buildUser(data.follower);
    const actions: ActionAndChildren[] = [];

    const followObject = (object: Agent | Collection): FollowAction => ({
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'agent', 'object'],
      source: SOURCE,
      agent: follower,
      object,
    });

    for (const user of data.users) {
      actions.push(followObject(this.buildUser(user)));
    }
    for (const channel of data.channels) {
      actions.push(followObject(this.buildCollection(channel)));
    }
    for (const group of data.groups) {
      actions.push(followObject(this.buildGroup(group)));
    }

    return actions;
  }

  // --- Entities --------------------------------------------------------------

  private buildUser(user: ArenaUser): Agent {
    const agent: Agent = {
      '@type': 'Agent',
      '@key': KEY,
      source: SOURCE,
      sourceId: user.id.toString(),
      handle: user.slug,
      name: user.name,
      url: `https://www.are.na/${user.slug}`,
    };
    const avatar = this.buildAvatar(user.avatar);
    if (avatar) agent.emblem = avatar;
    // Tag the owner by id, since this builder also makes followed users and the
    // authors of others' bookmarked blocks.
    if (this.selfUserId !== undefined && user.id === this.selfUserId) {
      agent.sameAs = [...(agent.sameAs ?? []), '@me'];
    }
    return agent;
  }

  private buildGroup(group: ArenaGroup): Agent {
    const agent: Agent = {
      '@type': 'Agent',
      '@key': KEY,
      source: SOURCE,
      sourceId: group.id.toString(),
      handle: group.slug,
      name: group.name,
      url: `https://www.are.na/${group.slug}`,
    };
    const avatar = this.buildAvatar(group.avatar);
    if (avatar) agent.emblem = avatar;
    return agent;
  }

  /** An agent's profile picture, as an ImageObject. */
  private buildAvatar(avatar: string | null | undefined): ImageObject | undefined {
    const url = avatar?.trim();
    if (!url) return undefined;
    return { '@type': 'ImageObject', '@key': ['url'], url };
  }

  /**
   * Map Are.na's three channel states onto the coarse cross-source bucket.
   * `closed` is publicly viewable (only collaborators can add), so it folds into
   * `public`; `private` is collaborator-only visibility.
   */
  private mapVisibility(visibility: string | undefined): 'public' | 'private' | undefined {
    switch (visibility) {
      case 'public':
      case 'closed':
        return 'public';
      case 'private':
        return 'private';
      default:
        return undefined;
    }
  }

  private buildCollection(channel: ArenaChannel): Collection {
    const collection: Collection = {
      '@type': 'Collection',
      '@key': KEY,
      source: SOURCE,
      sourceId: channel.id.toString(),
      name: channel.title,
      url: `https://www.are.na/${channel.owner.slug}/${channel.slug}`,
    };
    const description = this.textOf(channel.description);
    if (description) {
      collection.description = description;
    }
    const visibility = this.mapVisibility(channel.visibility);
    if (visibility) {
      collection.visibility = visibility;
    }
    // Clearing a channel's description must close the old value on re-read; the
    // snapshot `'*'` default only covers predicates still present in the payload.
    (collection as Collection & { '@asserts'?: string[] })['@asserts'] = ['description'];
    return collection;
  }

  private buildPost(block: ArenaBlock): Post {
    const posting: Post = {
      '@type': 'Post',
      '@key': KEY,
      source: SOURCE,
      sourceId: block.id.toString(),
      url: `https://www.are.na/block/${block.id}`,
      author: [this.buildUser(block.user)],
    };

    const name = block.title || block.embed?.title;
    if (name?.trim()) {
      posting.name = name;
    }

    const body = this.textOf(block.content) || this.textOf(block.description);
    if (body) {
      posting.body = body;
    }

    const reference = this.referenceUrl(block);
    if (reference) {
      posting.references = [{ '@type': 'Entity', '@key': ['url'], url: reference }];
    }

    // The block's image is its content — the file it is made of — so it hangs
    // off `contains`, not `emblem` (which is for a representative avatar/
    // cover). A block has its own identity (id, title, connections), so it stays
    // a container rather than being typed as the ImageObject directly.
    const image = this.buildImageObject(block);
    if (image) {
      posting.contains = [image];
    }

    // A block's title, body, links, or image can all be removed by an edit;
    // list them so re-reads close the departed values (snapshot `'*'` only
    // covers predicates still present).
    (posting as Post & { '@asserts'?: string[] })['@asserts'] = [
      'name',
      'body',
      'references',
      'contains',
    ];

    return posting;
  }

  /** Extract plain text from a value that may be a string or markdown object. */
  private textOf(value: string | ArenaMarkdown | null | undefined): string | undefined {
    if (typeof value === 'string') {
      return value.trim() ? value : undefined;
    }
    if (value && typeof value === 'object') {
      const text = value.plain || value.markdown;
      return text?.trim() ? text : undefined;
    }
    return undefined;
  }

  /** The external URL a block points at, if any. */
  private referenceUrl(block: ArenaBlock): string | undefined {
    return (
      block.source?.url ||
      block.embed?.source_url ||
      block.embed?.url ||
      block.attachment?.url ||
      undefined
    );
  }

  private buildImageObject(block: ArenaBlock): ImageObject | undefined {
    const src = block.image?.src;
    if (!src) return undefined;

    const image: ImageObject = {
      '@type': 'ImageObject',
      '@key': ['url'],
      url: src,
    };
    if (block.image?.width) image.width = block.image.width;
    if (block.image?.height) image.height = block.image.height;
    const alt = block.image?.alt_text?.trim();
    if (alt) image.caption = alt;
    return image;
  }
}
