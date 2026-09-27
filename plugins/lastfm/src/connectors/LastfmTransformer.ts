import { ChronicleTransformer, Record, createImageObject } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  MusicRecording,
  MusicAlbum,
  MusicGroup,
  ListenAction,
  LikeAction,
  FollowAction,
} from '@chronicle.app/schema';
import { LastfmFriend, LastfmTrack } from '../utils/LastfmProxy.js';

// Last.fm returns each image at several sizes; pick the largest non-empty URL.
function largestImage(images?: Array<{ '#text': string; size: string }>): string | undefined {
  if (!images?.length) return undefined;
  const order = ['mega', 'extralarge', 'large', 'medium', 'small'];
  for (const size of order) {
    const found = images.find(i => i.size === size && i['#text']?.trim());
    if (found) return found['#text'].trim();
  }
  return images.find(i => i['#text']?.trim())?.['#text'].trim();
}

export default class LastfmTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    switch (record.extraction.recordType) {
      case 'listens': {
        actions.push(...this.buildListenAction(record));
        break;
      }
      case 'loved-tracks': {
        actions.push(...this.buildLoveAction(record));
        break;
      }
      case 'friends': {
        actions.push(...this.buildFriendAction(record));
        break;
      }
    }

    return actions;
  }

  // A Last.fm friend is a user the listener follows. Last.fm gives no
  // befriended date, so the FollowAction carries no timestamp — it's sighted at
  // read time by the snapshot extractor — and keys on the followed user's handle
  // so re-reads supersede rather than duplicate.
  private buildFriendAction(record: Record): ActionAndChildren[] {
    const friend = record.data as LastfmFriend;
    const friendAgent = this.buildLastfmAgent(friend.name, {
      realname: friend.realname,
      url: friend.url,
      image: largestImage(friend.image),
    });

    const actions: ActionAndChildren[] = [
      {
        '@type': 'FollowAction',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'lastfm',
        sourceId: friend.name,
        agent: this.resolveUser(record),
        object: friendAgent,
      } as FollowAction,
    ];

    const join = this.buildJoinAction(friend.name, friend.registered?.unixtime);
    if (join) {
      actions.push(join);
    }

    return actions;
  }

  // When a Last.fm account was created (its `registered` date). This is a real
  // source event with a real timestamp, so it's a keyed action — not synthetic —
  // keyed on the account handle so it's referenceable and re-reads supersede. The
  // account's coming-into-being is origin-grade evidence carried on `result`; a
  // bare handle reference is used so the friend's *current* avatar/name aren't
  // back-dated to the registration instant — those stay on the FollowAction.
  private buildJoinAction(handle: string, unixtime?: string): ActionAndChildren | null {
    if (!unixtime) return null;
    const at = new Date(Number.parseInt(unixtime, 10) * 1000);
    if (Number.isNaN(at.getTime())) return null;

    const ref: Agent = {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'lastfm',
      handle,
    };

    return {
      '@type': 'CreateAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'lastfm',
      sourceId: handle,
      timestamp: at,
      agent: ref,
      result: ref,
    } as ActionAndChildren;
  }

  private buildListenAction(record: Record): ActionAndChildren[] {
    const track = record.data as LastfmTrack;
    const timestamp = new Date(Number.parseInt(track.date.uts) * 1000);

    const action: ListenAction = {
      '@type': 'ListenAction',
      timestamp,
      '@key': ['@type', 'source', 'timestamp'],
      source: 'lastfm',
      agent: this.resolveUser(record),
      object: this.buildMusicRecording(track),
    };

    return [action];
  }

  private buildLoveAction(record: Record): ActionAndChildren[] {
    const track = record.data as LastfmTrack;

    const action: LikeAction = {
      '@type': 'LikeAction',
      timestamp: track.date ? new Date(Number.parseInt(track.date.uts) * 1000) : new Date(),
      '@key': ['@type', 'source', 'timestamp'],
      source: 'lastfm',
      agent: this.resolveUser(record),
      object: this.buildMusicRecording(track),
    };

    return [action];
  }

  private buildMusicRecording(track: LastfmTrack): MusicRecording {
    const artist = this.buildMusicGroup(track.artist, track.url);
    // Last.fm serves a track's image as its album art.
    const artUrl = largestImage(track.image);

    // Use MBID for recording deduplication if available, otherwise fall back to URL
    const recordingDedupeOn = track.mbid ? ['@type', 'source', 'sourceId'] : ['url'];

    const recording: MusicRecording = {
      '@type': 'MusicRecording',
      '@key': recordingDedupeOn,
      url: track.url,
      name: track.name,
      artist: [artist],
      ...(artUrl && { emblem: createImageObject({ url: artUrl }) }),
    };

    // Add MBID as sourceId if available
    if (track.mbid) {
      (recording as any).sourceId = track.mbid;
      (recording as any).source = 'lastfm';
    }

    // Add album if available
    if (track.album?.['#text']) {
      const album: MusicAlbum = {
        '@type': 'MusicAlbum',
        '@key': track.album.mbid
          ? ['@type', 'source', 'sourceId']
          : ['@type', 'source', 'name', 'byArtist[*].name'],
        source: 'lastfm',
        name: track.album['#text'],
        artist: [artist],
        ...(artUrl && { emblem: createImageObject({ url: artUrl }) }),
      };

      // Add MBID as sourceId only if available
      if (track.album.mbid) {
        (album as any).sourceId = track.album.mbid;
      }

      recording.inAlbum = album;
    }

    return recording;
  }

  private buildMusicGroup(
    artistData: {
      name?: string;
      '#text'?: string;
      url?: string;
      mbid?: string;
      image?: Array<{ '#text': string; size: string }>;
    },
    trackUrl?: string
  ): MusicGroup {
    // Use MBID for artist deduplication if available, otherwise fall back to URL
    const artistDedupeOn = artistData.mbid ? ['@type', 'source', 'sourceId'] : ['url'];

    // Handle both name and #text fields from Last.fm API
    const artistName = artistData.name || artistData['#text'];

    // Derive artist URL from track URL if not provided
    let artistUrl = artistData.url;
    if (!artistUrl && trackUrl) {
      // Remove the last two path segments from track URL to get artist URL
      // e.g., "https://www.last.fm/music/Reese+Witherspoon/_/Break+Free+(with+Nick+Kroll)"
      // becomes "https://www.last.fm/music/Reese+Witherspoon"
      const urlParts = trackUrl.split('/');
      if (urlParts.length >= 2) {
        urlParts.pop(); // Remove track name
        urlParts.pop(); // Remove "_" separator
        artistUrl = urlParts.join('/');
      }
    }

    const artUrl = largestImage(artistData.image);

    const artist: MusicGroup = {
      '@type': 'MusicGroup',
      '@key': artistDedupeOn,
      source: 'lastfm',
      name: artistName,
      url: artistUrl,
      ...(artUrl && { emblem: createImageObject({ url: artUrl }) }),
    };

    // Add MBID as sourceId if available
    if (artistData.mbid) {
      (artist as any).sourceId = artistData.mbid;
    }

    return artist;
  }

  // The listener, from the canonical Last.fm username (user.getInfo), falling
  // back to the resolved extractor config. Never a hardcoded handle.
  private resolveUser(record: Record): Agent {
    const metadata = (record.context as any)?.metadata;
    const userInfo = metadata?.userInfo;
    const username = userInfo?.name ?? metadata?.username;
    if (!username) {
      throw new Error('Last.fm username could not be resolved for the listener');
    }
    // Only the listener (the account owner) is tagged as self; friends route
    // through the same buildLastfmAgent and must not.
    const user = this.buildUser(username, userInfo);
    return { ...user, sameAs: [...(user.sameAs ?? []), '@me'] };
  }

  private buildUser(username: string, userInfo?: any): Agent {
    return this.buildLastfmAgent(username, {
      realname: userInfo?.realname,
      url: userInfo?.url || `https://last.fm/user/${username}`,
      image: largestImage(userInfo?.image),
    });
  }

  // A Last.fm user as an Agent, keyed on their handle (username), carrying the
  // real name, profile URL, and avatar when available. Shared by the listener
  // and their friends so both merge on the same handle.
  private buildLastfmAgent(
    handle: string,
    opts: { realname?: string; url?: string; image?: string }
  ): Agent {
    const agent: Agent = {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'lastfm',
      handle,
    };

    if (opts.url) {
      agent.url = opts.url;
    }

    const realname = opts.realname?.trim();
    if (realname) {
      agent.name = realname;
    }

    if (opts.image) {
      agent.emblem = createImageObject({ url: opts.image });
    }

    return agent;
  }
}
