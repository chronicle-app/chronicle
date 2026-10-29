import { ChronicleTransformer, Record, createImageObject } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  Collection,
  ListenAction,
  AddAction,
  LikeAction,
  MusicRecording,
  MusicAlbum,
} from '@chronicle.app/schema';
import { LISTEN_KEY, toSecond } from '../utils/listens.js';
import { buildMusicAlbum, buildMusicRecording } from './music.js';

export default class SpotifyTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    switch (record.extraction.recordType) {
      case 'listens':
        actions.push(...this.buildListenActions(record));
        break;
      case 'saved-tracks':
      case 'saved-albums':
        actions.push(...this.buildSaveActions(record));
        break;
      case 'playlist-tracks':
        actions.push(...this.buildPlaylistTrackActions(record));
        break;
    }

    return actions;
  }

  private buildListenActions(record: Record): ActionAndChildren[] {
    const { data } = record;
    const user = this.buildUser(record);
    const track = buildMusicRecording(data.track);

    // `played_at` is when the track stopped, to the millisecond. A data
    // download logs the same moment to the second, so a listen keeps the
    // second, and a play read both ways is one listen.
    const action: ListenAction = {
      '@type': 'ListenAction',
      '@key': LISTEN_KEY,
      timestamp: toSecond(data.played_at),
      source: 'spotify',
      agent: user,
      object: track,
    };

    return [action];
  }

  private buildSaveActions(record: Record): ActionAndChildren[] {
    const { data } = record;
    const user = this.buildUser(record);

    let object: MusicRecording | MusicAlbum;

    if (data.track) {
      // Saved track
      object = buildMusicRecording(data.track);
    } else if (data.album) {
      // Saved album
      object = buildMusicAlbum(data.album);
    } else {
      throw new Error('Save action must have either track or album data');
    }

    const action: LikeAction = {
      '@type': 'LikeAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.sourceId', 'timestamp'],
      timestamp: new Date(data.added_at),
      source: 'spotify',
      agent: user,
      object,
    };

    return [action];
  }

  private buildPlaylistTrackActions(record: Record): ActionAndChildren[] {
    const { data } = record;
    // A local file in a playlist has no Spotify ID to key it by, so it's left
    // out, as it is from a data download.
    if (!data.track?.id) return [];
    const user = this.buildUser(record);
    const track = buildMusicRecording(data.track);
    const playlist = this.buildPlaylist(data.playlist);
    const agent = this.buildAddedBy(data.added_by, user);

    // AddAction represents adding a track to a playlist collection
    const action: AddAction = {
      '@type': 'AddAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp'],
      timestamp: new Date(data.added_at),
      source: 'spotify',
      ...(agent && { agent }),
      object: track, // The track being added
      target: playlist, // The playlist collection
    };

    return [action];
  }

  // A playlist is a Collection, as a data download's is, keyed by its ID.
  private buildPlaylist(playlistData: any): Collection {
    const playlist: Collection = {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'spotify',
      sourceId: playlistData.id,
      url: playlistData.external_urls.spotify,
      name: playlistData.name,
      description: playlistData.description,
    };

    // Add playlist image as attachment if available
    if (playlistData.images?.[0]) {
      const largestImage = playlistData.images[0];
      playlist.emblem = createImageObject({
        url: largestImage.url,
        width: largestImage.width,
        height: largestImage.height,
      });
    }

    return playlist;
  }

  // Who added a playlist item: the account, or for a playlist it follows or
  // shares, whoever else did, by their Spotify ID. Spotify leaves the ID
  // empty on some items, mostly old ones, which then have no agent. A record
  // from before `added_by` was asked for is the account's.
  private buildAddedBy(addedBy: { id?: string } | undefined, user: Agent): Agent | undefined {
    if (!addedBy || addedBy.id === user.handle) return user;
    if (!addedBy.id) return undefined;
    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'spotify',
      handle: addedBy.id,
      url: `https://open.spotify.com/user/${addedBy.id}`,
    };
  }

  private buildUser(record: Record): Agent {
    const userData = (record.context as any)?.user;

    if (!userData) {
      throw new Error('User data not available in record context');
    }

    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'handle'],
      source: 'spotify',
      handle: userData.id,
      name: userData.display_name || userData.id,
      url: userData.external_urls?.spotify || `https://open.spotify.com/user/${userData.id}`,
      sameAs: ['@me'],
    };
  }
}
