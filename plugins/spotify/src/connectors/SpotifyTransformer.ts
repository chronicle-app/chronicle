import { ChronicleTransformer, Record, createImageObject } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  Entity,
  ListenAction,
  AddAction,
  LikeAction,
  MusicRecording,
  MusicGroup,
  MusicAlbum,
} from '@chronicle.app/schema';

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
    const track = this.buildMusicRecording(data.track);

    const action: ListenAction = {
      '@type': 'ListenAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.sourceId', 'timestamp'],
      timestamp: new Date(data.played_at),
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
      object = this.buildMusicRecording(data.track);
    } else if (data.album) {
      // Saved album
      object = this.buildMusicAlbum(data.album);
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
    const user = this.buildUser(record);
    const track = this.buildMusicRecording(data.track);
    const playlist = this.buildPlaylistEntity(data.playlist);

    // AddAction represents adding a track to a playlist collection
    const action: AddAction = {
      '@type': 'AddAction',
      '@key': ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp'],
      timestamp: new Date(data.added_at),
      source: 'spotify',
      agent: user,
      object: track, // The track being added
      target: playlist, // The playlist collection
    };

    return [action];
  }

  private buildMusicRecording(trackData: any): MusicRecording {
    const recording: MusicRecording = {
      '@type': 'MusicRecording',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'spotify',
      sourceId: trackData.id,
      url: trackData.external_urls.spotify,
      name: trackData.name,
      duration: `PT${Math.floor(trackData.duration_ms / 1000)}S`,
      ...(trackData.preview_url && { contentUrl: trackData.preview_url }),
    };

    // Add artists
    if (trackData.artists && trackData.artists.length > 0) {
      recording.artist = trackData.artists.map((artist: any) => this.buildMusicGroup(artist));
    }

    // Add album
    if (trackData.album) {
      recording.inAlbum = this.buildMusicAlbum(trackData.album);
    }

    // Add track image (usually from album artwork)
    if (trackData.album?.images?.[0]) {
      const largestImage = trackData.album.images[0];
      recording.emblem = createImageObject({
        url: largestImage.url,
        width: largestImage.width,
        height: largestImage.height,
      });
    }

    return recording;
  }

  private buildMusicGroup(artistData: any): MusicGroup {
    const group: MusicGroup = {
      '@type': 'MusicGroup',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'spotify',
      sourceId: artistData.id,
      url: artistData.external_urls?.spotify || `https://open.spotify.com/artist/${artistData.id}`,
      name: artistData.name,
      ...(artistData.genres && { genre: artistData.genres }),
    };

    // Add artist image as attachment if available
    if (artistData.images?.[0]) {
      const largestImage = artistData.images[0];
      group.emblem = createImageObject({
        url: largestImage.url,
        width: largestImage.width,
        height: largestImage.height,
      });
    }

    return group;
  }

  private buildPlaylistEntity(playlistData: any): Entity {
    const entity: Entity = {
      '@type': 'Entity',
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
      entity.emblem = createImageObject({
        url: largestImage.url,
        width: largestImage.width,
        height: largestImage.height,
      });
    }

    return entity;
  }

  private buildMusicAlbum(albumData: any): MusicAlbum {
    const album: MusicAlbum = {
      '@type': 'MusicAlbum',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'spotify',
      sourceId: albumData.id,
      url: albumData.external_urls?.spotify || `https://open.spotify.com/album/${albumData.id}`,
      name: albumData.name,
      ...(albumData.release_date && { datePublished: albumData.release_date }),
    };

    // Add album art as attachment if available
    if (albumData.images?.[0]) {
      const largestImage = albumData.images[0];
      album.emblem = createImageObject({
        url: largestImage.url,
        width: largestImage.width,
        height: largestImage.height,
      });
    }

    // Add album artists
    if (albumData.artists && albumData.artists.length > 0) {
      album.artist = albumData.artists.map((artist: any) => this.buildMusicGroup(artist));
    }

    return album;
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
