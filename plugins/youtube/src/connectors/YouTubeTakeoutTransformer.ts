import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AddAction,
  Agent,
  AnnotateAction,
  Collection,
  Comment,
  CreateAction,
  FindAction,
  FollowAction,
  PublishAction,
  Query,
  VideoObject,
  WatchAction,
} from '@chronicle.app/schema';
import { msToIsoDuration, ytTime } from '../utils/time.js';
import { channelUrl, playlistUrl, videoUrl } from '../utils/urls.js';
import {
  TakeoutCommentRecord,
  TakeoutPlaylistItemRecord,
  TakeoutPlaylistRecord,
  TakeoutSearchRecord,
  TakeoutSelfChannel,
  TakeoutSubscriptionRecord,
  TakeoutUploadRecord,
  TakeoutWatchRecord,
} from './YouTubeTakeoutExtractor.js';

/**
 * Transforms a Google Takeout "YouTube and YouTube Music" archive into the
 * same shapes the API transformer emits — identical entity keysets, URL
 * builders, and second-precision timestamps — so a full archive import and
 * API crawls fold onto the same actions and entities instead of duplicating
 * them.
 */
export default class YouTubeTakeoutTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    switch (record.extraction.recordType) {
      case 'watches': {
        return this.buildWatchAction(record);
      }
      case 'searches': {
        return this.buildSearchAction(record);
      }
      case 'subscriptions': {
        return this.buildFollowAction(record);
      }
      case 'playlists': {
        return this.buildPlaylistCreateAction(record);
      }
      case 'playlist-items': {
        return this.buildPlaylistAddAction(record);
      }
      case 'uploads': {
        return this.buildUploadPublishAction(record);
      }
      case 'comments': {
        return this.buildCommentAnnotateAction(record);
      }
      default: {
        return [];
      }
    }
  }

  private buildWatchAction(record: Record): ActionAndChildren[] {
    const watch = record.data as TakeoutWatchRecord;
    const agent = this.resolveSelf(record);

    const action: WatchAction = {
      '@type': 'WatchAction',
      '@key': this.agentScopedKey(agent, 'object.sourceId'),
      source: 'youtube',
      timestamp: ytTime(watch.time),
      agent,
      object: this.buildVideo(watch),
    };

    return [action];
  }

  private buildSearchAction(record: Record): ActionAndChildren[] {
    const search = record.data as TakeoutSearchRecord;
    const agent = this.resolveSelf(record);

    const query: Query = {
      '@type': 'Query',
      '@key': ['@type', 'source', 'body'],
      source: 'youtube',
      name: search.query,
      body: search.query,
    };

    const action: FindAction = {
      '@type': 'FindAction',
      '@key': this.agentScopedKey(agent, 'object.body'),
      source: 'youtube',
      timestamp: ytTime(search.time),
      agent,
      object: query,
    };

    return [action];
  }

  // Takeout reports which channels are followed but not since when — the
  // record carries no occurrence, only the snapshot's @assertedAt. Keyed on
  // the channel id exactly like the API FollowAction, so both paths converge
  // on one action and the API's real subscribe date owns the occurrence.
  private buildFollowAction(record: Record): ActionAndChildren[] {
    const subscription = record.data as TakeoutSubscriptionRecord;

    const action: FollowAction = {
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: subscription.channelId,
      agent: this.resolveSelf(record),
      object: this.buildChannelAgent(subscription.channelId, subscription.channelTitle),
    };

    return [action];
  }

  private buildPlaylistCreateAction(record: Record): ActionAndChildren[] {
    const playlist = record.data as TakeoutPlaylistRecord;

    const action: CreateAction = {
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: playlist.playlistId,
      timestamp: ytTime(playlist.createdAt),
      agent: this.resolveSelf(record),
      result: this.buildCollection(playlist.playlistId, {
        name: playlist.title,
        visibility: playlist.visibility,
      }),
    };

    return [action];
  }

  // Same membership key as the API path — (video, playlist, add instant) —
  // so an archive import and an API crawl of the same playlist fold onto one
  // AddAction.
  private buildPlaylistAddAction(record: Record): ActionAndChildren[] {
    const item = record.data as TakeoutPlaylistItemRecord;

    const action: AddAction = {
      '@type': 'AddAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp'],
      source: 'youtube',
      timestamp: ytTime(item.addedAt),
      agent: this.resolveSelf(record),
      object: this.buildBareVideo(item.videoId),
      target: this.buildCollection(item.playlistId, {
        name: item.playlistTitle,
      }),
    };

    return [action];
  }

  // Mirrors the API upload mapping: the action's timestamp IS datePublished, so
  // the video carries no datePublished scalar of its own.
  private buildUploadPublishAction(record: Record): ActionAndChildren[] {
    const upload = record.data as TakeoutUploadRecord;

    const video: VideoObject = {
      ...this.buildBareVideo(upload.videoId),
      ...(upload.title && { name: upload.title }),
      ...(upload.description && { description: upload.description }),
      ...(upload.durationMs && {
        duration: msToIsoDuration(Number(upload.durationMs)),
      }),
    };

    const action: PublishAction = {
      '@type': 'PublishAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: upload.videoId,
      timestamp: ytTime(upload.publishedAt),
      agent: this.resolveSelf(record),
      object: video,
    };

    return [action];
  }

  private buildCommentAnnotateAction(record: Record): ActionAndChildren[] {
    const data = record.data as TakeoutCommentRecord;
    const agent = this.resolveSelf(record);
    const video = this.buildBareVideo(data.videoId);

    const comment: Comment = {
      '@type': 'Comment',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: data.commentId,
      body: this.commentBody(data.rawText),
      author: [agent],
      about: [video],
    };

    const action: AnnotateAction = {
      '@type': 'AnnotateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: data.commentId,
      timestamp: ytTime(data.createdAt),
      agent,
      object: video,
      result: comment,
    };

    return [action];
  }

  // Takeout wraps comment text as JSON ({"text": "..."}); the raw string is
  // the fallback for rows that don't parse.
  private commentBody(rawText: string): string {
    try {
      const parsed = JSON.parse(rawText);
      if (typeof parsed?.text === 'string') return parsed.text;
    } catch {
      // fall through
    }
    return rawText;
  }

  private buildVideo(watch: TakeoutWatchRecord): VideoObject {
    // A deleted/private video's entry degrades to the bare watch URL in place
    // of a title — boilerplate, not the video's name (mirrors the API path's
    // placeholder handling).
    const unavailable = !watch.title || watch.title === watch.titleUrl;

    return {
      ...this.buildBareVideo(watch.videoId),
      ...(!unavailable && { name: watch.title }),
      ...(watch.channelId && {
        author: [this.buildChannelAgent(watch.channelId, watch.channelName)],
      }),
    };
  }

  private buildBareVideo(videoId: string): VideoObject {
    return {
      '@type': 'VideoObject',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: videoId,
      url: videoUrl(videoId),
    };
  }

  private buildCollection(
    playlistId: string,
    opts: { name?: string; visibility?: string }
  ): Collection {
    return {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: playlistId,
      url: playlistUrl(playlistId),
      ...(opts.name && { name: opts.name }),
      // The API reports privacyStatus lowercase; Takeout capitalizes. The
      // schema's visibility tokens are lowercase, and a casing mismatch would
      // flip-flop the run on every alternating import.
      ...(opts.visibility && { visibility: opts.visibility.toLowerCase() }),
    };
  }

  // A YouTube channel as an Agent — the same shape (and so the same keyset)
  // as the API transformer's channels, with the canonical https url in place
  // of Takeout's http:// links.
  private buildChannelAgent(channelId: string, name?: string): Agent {
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'youtube',
      handle: channelId,
      url: channelUrl(channelId),
      ...(name && { name }),
    };
  }

  // Watch/search actions key on the acting handle like the API LikeAction; an
  // archive without channels/channel.csv has no handle, so the key drops to
  // the remaining components rather than referencing a missing field.
  private agentScopedKey(agent: Agent, objectComponent: string): string[] {
    return agent.handle
      ? ['@type', 'source', 'agent.handle', objectComponent, 'timestamp']
      : ['@type', 'source', objectComponent, 'timestamp'];
  }

  // The account owner from channels/channel.csv (a real channel id, the same
  // handle keyset as the API self, so the two merge directly); an archive
  // missing that file falls back to the per-source singleton, still folded
  // into the person through @me.
  private resolveSelf(record: Record): Agent {
    const self = (record.context as { selfChannel?: TakeoutSelfChannel | null })?.selfChannel;

    if (self?.id) {
      return {
        ...(selfAgent({
          type: 'Agent',
          source: 'youtube',
          handle: self.id,
          name: self.title,
        }) as Agent),
        url: channelUrl(self.id),
      };
    }

    return selfAgent({ type: 'Agent', source: 'youtube' }) as Agent;
  }
}
