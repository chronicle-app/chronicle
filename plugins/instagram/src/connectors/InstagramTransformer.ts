import {
  ChronicleTransformer,
  Record,
  createImageObject,
  createVideoObject,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  EntityAndChildren,
  Post,
  PublishAction,
  Message,
  MessageAction,
  MediaObjectAndChildren,
  LikeAction,
  FollowAction,
  BookmarkAction,
  CreateAction,
  FindAction,
  Comment,
  Collection,
  Query,
  RespondAction,
  Response,
} from '@chronicle.app/schema';

/** A single media file within a publication record, resolved by the extractor. */
interface StoryMedia {
  /** Instagram media pk (filename stem). */
  id: string;
  kind: 'image' | 'video';
  /** Absolute path to the archive file; captured into the blob store at ingest. */
  path: string;
  mimeType: string;
}

/**
 * Action `@key`s use dot-paths into the role entities (`agent.handle`,
 * `object.sourceId`) rather than the whole role objects: a whole object in the
 * key hashes every property it carries, so a caption or display name rendered
 * differently in a later export would silently re-key — duplicate — the
 * action. The dot-path pins the key to the roles' stable identity fields only.
 */
export default class InstagramTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    switch (record.data.type) {
      case 'posts':
      case 'stories':
        actions.push(...this.buildPublicationActions(record));
        break;
      case 'messages':
        actions.push(...this.buildMessageActions(record));
        break;
      case 'likes':
        actions.push(...this.buildLikeActions(record));
        break;
      case 'follows':
        actions.push(...this.buildFollowActions(record));
        break;
      case 'saves':
        actions.push(...this.buildSaveActions(record));
        break;
      case 'comments':
        actions.push(...this.buildCommentActions(record));
        break;
      case 'searches':
        actions.push(...this.buildSearchActions(record));
        break;
    }

    return actions;
  }

  /**
   * A like on an external post/story: LikeAction → external Post(shortcode/
   * story-id). Keyed on (agent, object) — I like a given post once — so no
   * synthesized id.
   */
  private buildLikeActions(record: Record): ActionAndChildren[] {
    const d = record.data;
    const target: Post = {
      '@type': 'Post',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'instagram',
      sourceId: d.targetId,
      ...(d.sourceFormat && { sourceFormat: d.sourceFormat }),
      ...(d.url && { url: d.url }),
      ...(d.caption && { body: d.caption }),
      ...(d.ownerHandle && { author: [this.buildAgent(d.ownerHandle)] }),
    };

    const like: LikeAction = {
      '@type': 'LikeAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.sourceId'],
      source: 'instagram',
      timestamp: d.timestamp,
      agent: this.buildUser(record),
      object: target,
    };

    return [like];
  }

  /** A follow edge: FollowAction, keyed on (type, source, agent, object). */
  private buildFollowActions(record: Record): ActionAndChildren[] {
    const d = record.data;
    const self = this.buildUser(record);
    const other = this.buildAgent(d.handle);

    const follow: FollowAction = {
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.handle'],
      source: 'instagram',
      timestamp: d.timestamp,
      agent: d.direction === 'following' ? self : other,
      object: d.direction === 'following' ? other : self,
    };

    return [follow];
  }

  /**
   * A save: BookmarkAction → external Post, optionally into a Collection.
   * Keyed on (object, target) — this post saved into this
   * collection — with the collection keyed on its name; a collection-less save
   * (saved_posts.json) simply drops that key field. No synthesized id.
   */
  private buildSaveActions(record: Record): ActionAndChildren[] {
    const d = record.data;
    const target: Post = {
      '@type': 'Post',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'instagram',
      sourceId: d.targetId,
      ...(d.sourceFormat && { sourceFormat: d.sourceFormat }),
      ...(d.url && { url: d.url }),
      ...(d.ownerHandle && { author: [this.buildAgent(d.ownerHandle)] }),
    };

    const collection: Collection | undefined = d.collectionName
      ? {
          '@type': 'Collection',
          '@key': ['@type', 'source', 'name'],
          source: 'instagram',
          name: d.collectionName,
        }
      : undefined;

    const bookmark: BookmarkAction = {
      '@type': 'BookmarkAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.name'],
      source: 'instagram',
      timestamp: d.timestamp,
      agent: this.buildUser(record),
      object: target,
      ...(collection && { target: collection }),
    };

    return [bookmark];
  }

  /**
   * An authored comment, text-only (no post attached — the export carries no
   * post id or comment id). Keyed on the natural composite (owner handle, text,
   * authored time) — all real values, no synthesized id. The time matters:
   * without it, every "Congrats!" to the same account would collapse into one
   * Comment. An entity object must never sit in the key directly (it would
   * stringify to `[object Object]` and discriminate nothing), hence the
   * `references[*].handle` dot-path.
   */
  private buildCommentActions(record: Record): ActionAndChildren[] {
    const d = record.data;

    // The Media Owner (author of the commented-on post) is an entity the comment
    // points to, not its subject matter — `references` (a `mentions` subproperty),
    // not `about`. No post is stubbed: the export gives no post id, only the owner.
    // No date facet either: `datePublished`/`dateCreated` are lifecycle facets that
    // would reify a spurious occurrence; the authored time lives on the
    // CreateAction and reaches this key via the `action.` prefix.
    const comment: Comment = {
      '@type': 'Comment',
      '@key': ['@type', 'source', 'references[*].handle', 'body', 'action.timestamp'],
      source: 'instagram',
      body: d.text,
      ...(d.ownerHandle && { references: [this.buildAgent(d.ownerHandle)] }),
    };

    const create: CreateAction = {
      '@type': 'CreateAction',
      // The same composite as the comment itself (`timestamp` resolves on the
      // action body directly): one CreateAction per comment occurrence.
      '@key': ['@type', 'source', 'object.references[*].handle', 'object.body', 'timestamp'],
      source: 'instagram',
      timestamp: d.timestamp,
      agent: this.buildUser(record),
      object: comment,
    };

    return [create];
  }

  /**
   * A recent search: FindAction → Agent (a profile lookup, by handle) or a
   * `Query` (a free-text search, keyed on its text — the synthetic plugin's
   * pattern). The unresolved object path simply drops from the keyset, so
   * profiles key on (object.handle, timestamp) and queries on (object.body,
   * timestamp).
   */
  private buildSearchActions(record: Record): ActionAndChildren[] {
    const d = record.data;
    const query: Query | undefined = d.query
      ? {
          '@type': 'Query',
          '@key': ['@type', 'source', 'body'],
          source: 'instagram',
          name: d.query,
          body: d.query,
        }
      : undefined;
    const object: EntityAndChildren | undefined = d.handle ? this.buildAgent(d.handle) : query;
    if (!object) return [];

    const find: FindAction = {
      '@type': 'FindAction',
      '@key': ['@type', 'source', 'object.handle', 'object.body', 'timestamp'],
      source: 'instagram',
      timestamp: d.timestamp,
      agent: this.buildUser(record),
      object,
    };

    return [find];
  }

  /**
   * An external Instagram account, keyed by handle. Typed `Agent`, not `Person`:
   * from the export we can't tell a personal account from a brand/organization —
   * all we observe is the handle.
   */
  private buildAgent(handle: string): Agent {
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'instagram',
      handle,
      url: `https://www.instagram.com/${handle}`,
    };
  }

  /**
   * A published post or story: PublishAction → Post → contains → Media.
   * The Post is the semantic work (identity, caption, url, sourceFormat) — it
   * has its own shortcode identity, receives likes/comments, and can be a
   * carousel — so it stays a container; the file(s) it is made of hang off it
   * as MediaObjects via `contains`. Work and file share the media pk and differ
   * only by @type, so both key cleanly.
   */
  private buildPublicationActions(record: Record): ActionAndChildren[] {
    const d = record.data;
    const user = this.buildUser(record);

    const media: StoryMedia[] = Array.isArray(d.media) ? d.media : d.media ? [d.media] : [];
    const contains: MediaObjectAndChildren[] = media.map(m => this.buildMedia(m));

    const post: Post = {
      '@type': 'Post',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'instagram',
      sourceId: d.id,
      sourceFormat: d.sourceFormat,
      ...(d.visibility && { visibility: d.visibility }),
      ...(d.url && { url: d.url }),
      ...(d.caption && { body: d.caption }),
      ...(contains.length > 0 && { contains }),
    };

    const publishAction: PublishAction = {
      '@type': 'PublishAction',
      // Keyed on the post's identity: one publish per post, no synthesized id.
      '@key': ['@type', 'source', 'object.sourceId'],
      source: 'instagram',
      timestamp: d.timestamp,
      agent: user,
      object: post,
    };

    return [publishAction];
  }

  /** An Image/VideoObject keyed on the media pk (overriding the helper's `['url']`). */
  private buildMedia(m: StoryMedia): MediaObjectAndChildren {
    const options = {
      path: m.path,
      mimeType: m.mimeType,
      '@key': ['@type', 'source', 'sourceId'],
      source: 'instagram',
      sourceId: m.id,
    };
    return m.kind === 'video' ? createVideoObject(options) : createImageObject(options);
  }

  private buildMessageActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];

    const d = record.data;

    // The export duplicates each DM reaction as an echo message whose body is
    // only the notification text, with no pointer to the reacted-to message.
    // The reactions[] array on the target message is the real substrate (built
    // below), so the echoes are dropped rather than emitted as Messages.
    if (this.isReactionEchoBody(d.content)) {
      return actions;
    }

    const self = this.buildUser(record);

    // Sender vs recipient. Direction comes from whether the sender's display
    // name is mine (from the archive's account info). The folder-derived
    // conversation handle names the other party of a 1:1 thread only — in a
    // group it names at most one member, so it must never stand in for a group
    // sender; there the display name is the only identifier the export gives.
    const participants: any[] = Array.isArray(d.participants) ? d.participants : [];
    const isGroup = participants.length > 2;
    const other =
      !isGroup && d.conversation_handle ? this.buildAgent(d.conversation_handle) : undefined;
    const iSent = Boolean(d.sender_name && d.sender_name === record.context?.accountInfo?.name);
    const sender = iSent
      ? self
      : (other ?? (d.sender_name ? this.buildNamedAgent(d.sender_name) : self));
    // A group's recipients are the whole thread; without member handles we
    // assert none rather than a wrong single recipient.
    const recipient = isGroup ? undefined : iSent ? other : self;

    // Body is the sender's typed text only. A shared post's caption is the
    // shared item's, not the message's — it rides the reference below.
    const body = d.content || undefined;
    const references = this.buildMessageReferences(d.shared);

    const message: Message = {
      '@type': 'Message',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'instagram',
      // conversation folder + timestamp_ms, both real export identifiers —
      // the millisecond alone is only unique within a thread.
      sourceId: d.id,
      ...(body && { body }),
      ...(recipient && { recipient: [recipient] }),
      ...(references.length > 0 && { references }),
    };

    const messageAction: MessageAction = {
      '@type': 'MessageAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'instagram',
      sourceId: d.id,
      timestamp: d.created_at || d.timestamp,
      agent: sender,
      object: message,
    };

    actions.push(messageAction, ...this.buildReactionActions(record, message, self, other));
    return actions;
  }

  /**
   * An emoji reaction on a DM: RespondAction → result Response, one pair per
   * reactions[] entry (the produced-artifact pattern, like CallAction →
   * CallSession). Not a LikeAction — a like is binary and opens a `liked` run,
   * while a reaction is a payload (the emoji) with no standing state.
   *
   * The actor resolves like a sender: me → self, a 1:1 thread → the
   * counterpart, a group → a name-keyed agent (the display name is the only
   * identifier the export has for group members). The keys carry both
   * `agent.handle` and `agent.name` — the unresolved path drops, so
   * handle-keyed reactors key on their stable handle and name-only group
   * reactors on their name, never a display name on top of a handle.
   *
   * The Response keys on real export data via `action.`-prefixed dot-paths
   * into the enclosing action's roles — no synthesized id. Old entries lack a
   * timestamp (the echo message was the only carrier of when, with no reliable
   * join back), so those become timeless RespondActions and dedupe under the
   * same key.
   */
  private buildReactionActions(
    record: Record,
    message: Message,
    self: Agent,
    other: Agent | undefined
  ): ActionAndChildren[] {
    const d = record.data;
    const entries: any[] = Array.isArray(d.reactions) ? d.reactions : [];
    const actions: ActionAndChildren[] = [];

    for (const entry of entries) {
      if (!entry?.reaction || !entry?.actor) continue;

      const actorIsMe = entry.actor === record.context?.accountInfo?.name;
      const reactor = actorIsMe ? self : (other ?? this.buildNamedAgent(entry.actor));

      const response: Response = {
        '@type': 'Response',
        '@key': [
          '@type',
          'source',
          'body',
          'action.object.sourceId',
          'action.agent.handle',
          'action.agent.name',
        ],
        source: 'instagram',
        body: entry.reaction,
      };

      const respond: RespondAction = {
        '@type': 'RespondAction',
        '@key': ['@type', 'source', 'object.sourceId', 'agent.handle', 'agent.name', 'result.body'],
        source: 'instagram',
        ...(entry.timestamp && {
          timestamp: new Date(entry.timestamp * 1000).toISOString(),
        }),
        agent: reactor,
        object: message,
        result: response,
      };

      actions.push(respond);
    }

    return actions;
  }

  /**
   * The notification-text body of a reaction echo message ("Liked a message",
   * "Reacted ❤️ to your message ").
   */
  private isReactionEchoBody(body?: string): boolean {
    if (!body) return false;
    return body === 'Liked a message' || /^Reacted .+ to your message\s*$/u.test(body);
  }

  /**
   * The entity a DM shared: an Instagram post/reel (a `Post`, keyed by its
   * canonical shortcode, carrying the shared item's caption and owner), a
   * shared profile (an `Agent`), or an external link (a url-keyed `Entity`).
   *
   * The external link is a referenced node, never the Message's own `url`: a
   * string `url` doubles as an identity keyset (the `{url}` hub), so a link on
   * the Message itself would fuse every message sharing that link into one
   * entity. On the referenced node the merge is the point — all shares of a
   * page meet at the page.
   */
  private buildMessageReferences(shared: any): EntityAndChildren[] {
    if (!shared) return [];
    if (shared.shortcode) {
      const post: Post = {
        '@type': 'Post',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'instagram',
        sourceId: shared.shortcode,
        ...(shared.url && { url: shared.url }),
        ...(shared.caption && { body: shared.caption }),
        ...(shared.owner && { author: [this.buildAgent(shared.owner)] }),
      };
      return [post];
    }
    if (shared.profileHandle) {
      return [this.buildAgent(shared.profileHandle)];
    }
    if (shared.url) {
      // Bare root type: a url locates a thing of unknown kind. The share_text
      // (a preview title/snippet) is the only description the export gives.
      return [
        {
          '@type': 'Entity',
          '@key': ['@type', 'url'],
          url: shared.url,
          ...(shared.caption && { name: shared.caption }),
        } as EntityAndChildren,
      ];
    }
    return [];
  }

  /**
   * A group-thread participant the export identifies by display name only (no
   * handle exists anywhere in the archive for group senders). Keyed on that
   * name — a weak but real natural key, never synthesized.
   */
  private buildNamedAgent(name: string): Agent {
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'name'],
      source: 'instagram',
      name,
    };
  }

  /**
   * The account owner, keyed by their real handle from the archive
   * (personal_information.json → Username), tagged `@me` so it merges to the
   * self hub. Typed `Agent`, not `Person`: from Instagram's data alone the
   * account isn't provably a person (it could be a brand) — personhood comes
   * from the `@me` hub, not from this assertion. The handle is a real
   * identifier, never synthesized — a missing one is a broken export and fails
   * the import loudly rather than keying the self on an invented handle.
   */
  private buildUser(record: Record): Agent {
    const account = record.context?.accountInfo;
    const handle: string | undefined = account?.username;
    if (!handle) {
      throw new Error(
        'Instagram export carries no account username (personal_information.json missing or unreadable) — cannot attribute records to the account owner'
      );
    }
    const agent: Agent = {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'instagram',
      handle,
      sameAs: ['@me'],
    };
    if (account.name) agent.name = account.name;
    return agent;
  }
}
