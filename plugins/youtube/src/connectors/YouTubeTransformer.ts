import { ChronicleTransformer, Record, createImageObject } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AddAction,
  Agent,
  Collection,
  CreateAction,
  FollowAction,
  LikeAction,
  PublishAction,
  VideoObject,
} from '@chronicle.app/schema';
import {
  YouTubePlaylist,
  YouTubeSelfChannel,
  YouTubeSubscription,
  YouTubeThumbnails,
} from '../utils/YouTubeProxy.js';
import { ytTime } from '../utils/time.js';
import { channelUrl, playlistUrl, videoUrl } from '../utils/urls.js';
import { YouTubeLikedVideo } from './YouTubeLikesExtractor.js';
import { YouTubePlaylistItemRecord } from './YouTubePlaylistsExtractor.js';

// YouTube returns thumbnails at several sizes; pick the largest available.
function largestThumbnail(thumbnails?: YouTubeThumbnails): string | undefined {
  if (!thumbnails) return undefined;
  const order = ['maxres', 'standard', 'high', 'medium', 'default'] as const;
  for (const size of order) {
    const url = thumbnails[size]?.url;
    if (url) return url;
  }
  return undefined;
}

// When a liked video has been deleted or made private, videos.list returns
// nothing and the playlist item carries these literal placeholder strings in
// place of the video's real title — never assert them as data.
const PLACEHOLDER_TITLES = new Set(['Deleted video', 'Private video']);

export default class YouTubeTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    switch (record.extraction.recordType) {
      case 'likes': {
        return this.buildLikeAction(record);
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
      default: {
        return [];
      }
    }
  }

  private buildLikeAction(record: Record): ActionAndChildren[] {
    const liked = record.data as YouTubeLikedVideo;

    const action: LikeAction = {
      '@type': 'LikeAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.sourceId', 'timestamp'],
      source: 'youtube',
      timestamp: ytTime(liked.item.snippet.publishedAt),
      agent: this.resolveSelf(record),
      object: this.buildVideo(liked),
    };

    return [action];
  }

  // A subscription is a state row (current channel title/avatar at read time),
  // but its publishedAt is the real subscribe instant. Keyed on the followed
  // channel's id so snapshot re-reads supersede rather than duplicate.
  private buildFollowAction(record: Record): ActionAndChildren[] {
    const subscription = record.data as YouTubeSubscription;
    const { channelId } = subscription.snippet.resourceId;

    const action: FollowAction = {
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: channelId,
      timestamp: ytTime(subscription.snippet.publishedAt),
      agent: this.resolveSelf(record),
      object: this.buildChannelAgent(channelId, {
        name: subscription.snippet.title,
        description: subscription.snippet.description,
        image: largestThumbnail(subscription.snippet.thumbnails),
      }),
    };

    return [action];
  }

  // A playlist's coming-into-being: real creation timestamp from the API, the
  // account owner as agent, the Collection as origin-grade result.
  private buildPlaylistCreateAction(record: Record): ActionAndChildren[] {
    const playlist = record.data as YouTubePlaylist;

    const action: CreateAction = {
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: playlist.id,
      timestamp: ytTime(playlist.snippet.publishedAt),
      agent: this.resolveSelf(record),
      result: this.buildCollection(playlist),
    };

    return [action];
  }

  // Adding a video to a playlist. The membership's identity is (video,
  // playlist, add instant) — the only identity every reader of the account
  // shares (a Takeout archive has no playlist-item ids), so assertions from
  // any path converge on one action. A re-added video is a new instant, hence
  // a new action; the item id rides along as provenance.
  private buildPlaylistAddAction(record: Record): ActionAndChildren[] {
    const { playlist, item, video } = record.data as YouTubePlaylistItemRecord;

    const action: AddAction = {
      '@type': 'AddAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp'],
      source: 'youtube',
      sourceId: item.id,
      timestamp: ytTime(item.snippet.publishedAt),
      agent: this.resolveSelf(record),
      object: this.buildVideo({ item, video }),
      target: this.buildCollection(playlist),
    };

    return [action];
  }

  // An upload is the video's lifecycle occurrence: the action's own timestamp
  // IS datePublished (carrying the scalar on the video too would make the fold
  // derive a duplicate agentless occurrence), the video rides in `object`
  // (where the lifecycle render-back and edge facets look), and the agent is
  // routed onto the video's `publisher` edge by the fold.
  private buildUploadPublishAction(record: Record): ActionAndChildren[] {
    const upload = record.data as YouTubeLikedVideo;

    const video = this.buildVideo(upload);
    delete video.datePublished;

    const action: PublishAction = {
      '@type': 'PublishAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: upload.item.snippet.resourceId.videoId,
      timestamp: ytTime(upload.item.snippet.publishedAt),
      agent: this.resolveSelf(record),
      object: video,
    };

    return [action];
  }

  private buildCollection(playlist: YouTubePlaylist): Collection {
    const thumbnail = largestThumbnail(playlist.snippet.thumbnails);

    return {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: playlist.id,
      url: playlistUrl(playlist.id),
      name: playlist.snippet.title,
      ...(playlist.snippet.description && {
        description: playlist.snippet.description,
      }),
      ...(playlist.status?.privacyStatus && {
        visibility: playlist.status.privacyStatus,
      }),
      ...(thumbnail && { emblem: createImageObject({ url: thumbnail }) }),
    };
  }

  private buildVideo(liked: YouTubeLikedVideo): VideoObject {
    const { item, video } = liked;
    const { videoId } = item.snippet.resourceId;

    // The hydrated videos.list response is canonical; the playlist item is the
    // fallback for videos that have since gone private or been deleted — but
    // its placeholder title/description are YouTube boilerplate, not the
    // video's metadata, so an unavailable video keeps only its id and url.
    const snippet = video?.snippet ?? item.snippet;
    const unavailable = !video && PLACEHOLDER_TITLES.has(item.snippet.title);
    const uploaderChannelId = video?.snippet.channelId ?? item.snippet.videoOwnerChannelId;
    const uploaderChannelTitle = video?.snippet.channelTitle ?? item.snippet.videoOwnerChannelTitle;

    const thumbnail = largestThumbnail(snippet.thumbnails);

    const videoObject: VideoObject = {
      '@type': 'VideoObject',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'youtube',
      sourceId: videoId,
      url: videoUrl(videoId),
      ...(!unavailable && { name: snippet.title }),
      ...(!unavailable && snippet.description && { description: snippet.description }),
      ...(video?.contentDetails?.duration && {
        duration: video.contentDetails.duration,
      }),
      ...(video?.snippet.publishedAt && {
        datePublished: video.snippet.publishedAt,
      }),
      ...(thumbnail && { emblem: createImageObject({ url: thumbnail }) }),
      ...(uploaderChannelId && {
        author: [
          this.buildChannelAgent(uploaderChannelId, {
            name: uploaderChannelTitle,
          }),
        ],
      }),
    };

    return videoObject;
  }

  // A YouTube channel as an Agent, keyed on its channel id. Shared by the
  // account owner and subscribed/uploading channels so all merge on the id.
  private buildChannelAgent(
    channelId: string,
    opts: { name?: string; description?: string; image?: string }
  ): Agent {
    const agent: Agent = {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'youtube',
      handle: channelId,
      url: channelUrl(channelId),
    };

    if (opts.name) {
      agent.name = opts.name;
    }

    if (opts.description) {
      agent.description = opts.description;
    }

    if (opts.image) {
      agent.emblem = createImageObject({ url: opts.image });
    }

    return agent;
  }

  // The account owner, from the self channel resolved in extractor setup.
  // Only this agent is tagged @me; other channels route through
  // buildChannelAgent and must not.
  private resolveSelf(record: Record): Agent {
    const user = (record.context as any)?.user as YouTubeSelfChannel | undefined;
    if (!user?.id) {
      throw new Error('YouTube self channel could not be resolved for the account owner');
    }

    const self = this.buildChannelAgent(user.id, {
      name: user.snippet?.title,
      image: largestThumbnail(user.snippet?.thumbnails),
    });

    return { ...self, sameAs: [...(self.sameAs ?? []), '@me'] };
  }
}
