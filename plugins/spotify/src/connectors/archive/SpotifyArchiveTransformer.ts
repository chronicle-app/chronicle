import {
  ChronicleTransformer,
  Record,
  htmlToMarkdown,
  selfAgent,
  tidyText,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AddAction,
  Agent,
  BookmarkAction,
  Collection,
  FindAction,
  FollowAction,
  LikeAction,
  ListenAction,
  MusicAlbum,
  MusicGroup,
  MusicRecording,
  PodcastEpisode,
  PodcastSeries,
} from '@chronicle.app/schema';
import { LISTEN_KEY, toSecond } from '../../utils/listens.js';
import { buildMusicRecording } from '../music.js';
import { idOf, openUrl } from '../../utils/uris.js';
import { searchedAt, text } from './fields.js';
import type {
  SpotifyAccount,
  SpotifyLibraryAlbum,
  SpotifyLibraryArtist,
  SpotifyLibraryEpisode,
  SpotifyLibraryShow,
  SpotifyLibraryTrack,
  SpotifyPlaylist,
  SpotifyPlaylistEntry,
  SpotifySearch,
  SpotifyStream,
} from './types.js';

const SOURCE = 'spotify';
const KEY = ['@type', 'source', 'sourceId'];
const BY_NAME = ['@type', 'source', 'name'];

/** The artist Spotify gives a compilation's tracks, which is the album's, not theirs. */
const VARIOUS_ARTISTS = 'various artists';

/** Names of a track, as each file of the download gives them. */
interface TrackNames {
  name?: unknown;
  artist?: unknown;
  album?: unknown;
}

// A playlist's description can be HTML, with links and entities; Markdown here.
function markdown(value: unknown): string | undefined {
  const html = text(value);
  return html && text(tidyText(htmlToMarkdown(html) ?? ''));
}

/**
 * Transforms Spotify's data download into the shapes the API transformer
 * emits wherever the download says as much: a track, album, artist, episode,
 * or show it gives a URI for is keyed by its Spotify ID and has the same
 * open.spotify.com URL, so it's the same node. What it names without a URI,
 * like a stream's artist and album, is keyed by its name, unless the run
 * looked the track up in the API, which gives them their IDs.
 */
export default class SpotifyArchiveTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    switch (record.extraction.recordType) {
      case 'listens': {
        return this.buildListenAction(record);
      }
      case 'saved-tracks':
      case 'saved-albums': {
        return this.buildLikeAction(record);
      }
      case 'saved-episodes': {
        return this.buildBookmarkAction(record);
      }
      case 'follows': {
        return this.buildFollowAction(record);
      }
      case 'playlist-tracks': {
        return this.buildAddAction(record);
      }
      case 'searches': {
        return this.buildFindAction(record);
      }
      default: {
        return [];
      }
    }
  }

  // A listen is the second the stream stopped, `ts`, as the API's is. How
  // long it played isn't kept: pauses make it no guide to when it started.
  private buildListenAction(record: Record): ActionAndChildren[] {
    const stream = record.data as SpotifyStream;
    const object = stream.apiTrack
      ? buildMusicRecording(stream.apiTrack)
      : stream.spotify_track_uri
        ? this.buildRecording(stream.spotify_track_uri, {
            name: stream.master_metadata_track_name,
            artist: stream.master_metadata_album_artist_name,
            album: stream.master_metadata_album_album_name,
          })
        : this.buildEpisode(
            stream.spotify_episode_uri,
            stream.episode_name,
            stream.episode_show_name
          );
    if (!object) return [];
    const action: ListenAction = {
      '@type': 'ListenAction',
      '@key': LISTEN_KEY,
      source: SOURCE,
      timestamp: toSecond(stream.ts),
      agent: this.resolveSelf(record, stream.username),
      object,
    };

    return [action];
  }

  // Your Library says what's liked but not since when, so the like has no
  // timestamp. It's keyed by the account and what it likes, and sighted as
  // of the download.
  private buildLikeAction(record: Record): ActionAndChildren[] {
    const object =
      record.extraction.recordType === 'saved-tracks'
        ? this.buildLibraryTrack(record.data as SpotifyLibraryTrack)
        : this.buildLibraryAlbum(record.data as SpotifyLibraryAlbum);
    if (!object) return [];
    const agent = this.resolveSelf(record);

    const action: LikeAction = {
      '@type': 'LikeAction',
      '@key': this.agentScopedKey(agent, ['object.sourceId']),
      source: SOURCE,
      agent,
      object,
    };

    return [action];
  }

  // An episode saved to Your Episodes, to listen to later.
  private buildBookmarkAction(record: Record): ActionAndChildren[] {
    const saved = record.data as SpotifyLibraryEpisode;
    const object = this.buildEpisode(saved.uri, saved.name, saved.show);
    if (!object) return [];
    const agent = this.resolveSelf(record);

    const action: BookmarkAction = {
      '@type': 'BookmarkAction',
      '@key': this.agentScopedKey(agent, ['object.sourceId']),
      source: SOURCE,
      agent,
      object,
    };

    return [action];
  }

  // An artist or a podcast followed, which the library lists but doesn't date.
  private buildFollowAction(record: Record): ActionAndChildren[] {
    const followed = record.data as SpotifyLibraryArtist | SpotifyLibraryShow;
    const object = this.buildFollowedArtist(followed) ?? this.buildFollowedShow(followed);
    if (!object) return [];
    const agent = this.resolveSelf(record);

    const action: FollowAction = {
      '@type': 'FollowAction',
      '@key': this.agentScopedKey(agent, ['object.sourceId']),
      source: SOURCE,
      agent,
      object,
    };

    return [action];
  }

  // A track or episode added to a playlist, on the day the download gives.
  // The playlist has no ID, so the add is keyed by what was added, to which
  // playlist by its key, and the day.
  private buildAddAction(record: Record): ActionAndChildren[] {
    const { playlist, item, apiTrack } = record.data as SpotifyPlaylistEntry;
    const object = apiTrack
      ? buildMusicRecording(apiTrack)
      : item.track
        ? this.buildRecording(item.track.trackUri, {
            name: item.track.trackName,
            artist: item.track.artistName,
            album: item.track.albumName,
          })
        : this.buildEpisode(
            item.episode?.episodeUri,
            item.episode?.episodeName,
            item.episode?.showName
          );
    if (!object) return [];
    const agent = this.resolveSelf(record);
    const target = this.buildPlaylist(playlist, agent);
    const targetKey = target.inAccount
      ? ['target.inAccount[*].handle', 'target.name']
      : ['target.name'];

    const action: AddAction = {
      '@type': 'AddAction',
      '@key': ['@type', 'source', 'object.sourceId', ...targetKey, 'timestamp'],
      source: SOURCE,
      timestamp: item.addedDate,
      agent,
      object,
      target,
    };

    return [action];
  }

  private buildFindAction(record: Record): ActionAndChildren[] {
    const search = record.data as SpotifySearch;
    const query = text(search.searchQuery);
    const timestamp = searchedAt(search);
    if (!query || !timestamp) return [];
    const agent = this.resolveSelf(record);

    const action: FindAction = {
      '@type': 'FindAction',
      '@key': this.agentScopedKey(agent, ['object.body', 'timestamp']),
      source: SOURCE,
      timestamp,
      agent,
      object: {
        '@type': 'Query',
        '@key': ['@type', 'source', 'body'],
        source: SOURCE,
        body: query,
      },
    };

    return [action];
  }

  // A track by its Spotify ID. The download names its artist and album but
  // gives neither a URI. A compilation's tracks are by Various Artists, the
  // album's artist, which isn't theirs, so they have no artist.
  private buildRecording(uri: unknown, names: TrackNames): MusicRecording | undefined {
    const id = idOf(uri, 'track');
    if (!id) return undefined;
    const name = text(names.name);
    const artistName = text(names.artist);
    const album = this.buildAlbumByName(text(names.album), artistName);
    const artist =
      artistName && artistName.toLowerCase() !== VARIOUS_ARTISTS
        ? this.buildArtistByName(artistName)
        : undefined;

    return {
      '@type': 'MusicRecording',
      '@key': KEY,
      source: SOURCE,
      sourceId: id,
      url: openUrl('track', id),
      ...(name && { name }),
      ...(artist && { artist: [artist] }),
      ...(album && { inAlbum: album }),
    };
  }

  private buildLibraryTrack(saved: SpotifyLibraryTrack): MusicRecording | undefined {
    if (saved.apiTrack) return buildMusicRecording(saved.apiTrack);
    return this.buildRecording(saved.uri, {
      name: saved.track,
      artist: saved.artist,
      album: saved.album,
    });
  }

  private buildLibraryAlbum(saved: SpotifyLibraryAlbum): MusicAlbum | undefined {
    const id = idOf(saved.uri, 'album');
    if (!id) return undefined;
    const name = text(saved.album);
    const artistName = text(saved.artist);

    return {
      '@type': 'MusicAlbum',
      '@key': KEY,
      source: SOURCE,
      sourceId: id,
      url: openUrl('album', id),
      ...(name && { name }),
      ...(artistName && { artist: [this.buildArtistByName(artistName)] }),
    };
  }

  // An album the download names without a URI, keyed by its name and its
  // artist's, since many albums share a name.
  private buildAlbumByName(name?: string, artistName?: string): MusicAlbum | undefined {
    if (!name) return undefined;
    const artist = artistName ? this.buildArtistByName(artistName) : undefined;
    return {
      '@type': 'MusicAlbum',
      '@key': artist ? ['@type', 'source', 'name', 'artist[*].name'] : BY_NAME,
      source: SOURCE,
      name,
      ...(artist && { artist: [artist] }),
    };
  }

  private buildFollowedArtist(followed: SpotifyLibraryArtist): MusicGroup | undefined {
    const id = idOf(followed.uri, 'artist');
    if (!id) return undefined;
    const name = text(followed.name);
    return {
      '@type': 'MusicGroup',
      '@key': KEY,
      source: SOURCE,
      sourceId: id,
      url: openUrl('artist', id),
      ...(name && { name }),
    };
  }

  // An artist the download names without a URI, keyed by name.
  private buildArtistByName(name: string): MusicGroup {
    return { '@type': 'MusicGroup', '@key': BY_NAME, source: SOURCE, name };
  }

  private buildEpisode(uri: unknown, name: unknown, show: unknown): PodcastEpisode | undefined {
    const id = idOf(uri, 'episode');
    if (!id) return undefined;
    const title = text(name);
    const showName = text(show);
    return {
      '@type': 'PodcastEpisode',
      '@key': KEY,
      source: SOURCE,
      sourceId: id,
      url: openUrl('episode', id),
      ...(title && { name: title }),
      ...(showName && {
        series: [{ '@type': 'PodcastSeries', '@key': BY_NAME, source: SOURCE, name: showName }],
      }),
    };
  }

  // A followed podcast. Its publisher can be a host, a network, or several
  // people in one name, so it's an Agent keyed by that name, its author.
  private buildFollowedShow(followed: SpotifyLibraryShow): PodcastSeries | undefined {
    const id = idOf(followed.uri, 'show');
    if (!id) return undefined;
    const name = text(followed.name);
    const publisher = text(followed.publisher);
    return {
      '@type': 'PodcastSeries',
      '@key': KEY,
      source: SOURCE,
      sourceId: id,
      url: openUrl('show', id),
      ...(name && { name }),
      ...(publisher && {
        author: [{ '@type': 'Agent', '@key': BY_NAME, source: SOURCE, name: publisher }],
      }),
    };
  }

  // A playlist has a name but no ID in the download, and names are only
  // unique within an account, so it's keyed by its name in the account.
  private buildPlaylist(playlist: SpotifyPlaylist, agent: Agent): Collection {
    const description = markdown(playlist.description);
    return {
      '@type': 'Collection',
      '@key': agent.handle ? ['@type', 'source', 'inAccount[*].handle', 'name'] : BY_NAME,
      source: SOURCE,
      name: playlist.name.trim(),
      ...(description && { description }),
      ...(agent.handle && {
        inAccount: [
          {
            '@type': 'Agent',
            '@key': ['@type', 'source', 'handle'],
            source: SOURCE,
            handle: agent.handle,
          },
        ],
      }),
    };
  }

  // The account owner, by the username a stream or the account data gives:
  // the API's handle and URL for the account, so the two are one node. A
  // download that names no username has the per-source singleton, still
  // folded into the person through @me.
  private resolveSelf(record: Record, username?: string): Agent {
    const account = (record.context as { account?: SpotifyAccount }).account ?? {};
    const handle = text(username) ?? account.username;
    if (!handle) return selfAgent({ type: 'Agent', source: SOURCE }) as Agent;
    const name = handle === account.username ? account.displayName : undefined;
    return {
      ...(selfAgent({ type: 'Agent', source: SOURCE, handle, name }) as Agent),
      url: `https://open.spotify.com/user/${handle}`,
    };
  }

  // Actions key on the acting account, as the API's do; a download with no
  // username has no handle, so the key leaves it out rather than naming a
  // missing field.
  private agentScopedKey(agent: Agent, fields: string[]): string[] {
    return agent.handle
      ? ['@type', 'source', 'agent.handle', ...fields]
      : ['@type', 'source', ...fields];
  }
}
