/**
 * One stream in the extended streaming history, as Spotify writes it, without
 * the IP address and user agent it logged with it. `ts` is when the stream
 * stopped, in UTC, and `ms_played` how long it played. A stream is of a track
 * or of a podcast episode, and has the URI of one of them.
 */
export interface SpotifyStream {
  ts: string;
  username?: string;
  platform?: string;
  ms_played: number;
  conn_country?: string;
  master_metadata_track_name?: string | null;
  /** The track's artist, or the album's: a compilation's is `Various Artists`. */
  master_metadata_album_artist_name?: string | null;
  master_metadata_album_album_name?: string | null;
  spotify_track_uri?: string | null;
  episode_name?: string | null;
  episode_show_name?: string | null;
  spotify_episode_uri?: string | null;
  reason_start?: string | null;
  reason_end?: string | null;
  shuffle?: boolean | null;
  skipped?: boolean | null;
  offline?: boolean | null;
  offline_timestamp?: number | null;
  incognito_mode?: boolean | null;
  /** The track as the Spotify API gives it, when a run looked it up. */
  apiTrack?: SpotifyApiTrack;
}

/** A liked song in YourLibrary.json. */
export interface SpotifyLibraryTrack {
  artist?: string;
  album?: string;
  track?: string;
  uri: string;
  /** The track as the Spotify API gives it, when a run looked it up. */
  apiTrack?: SpotifyApiTrack;
}

/** A saved album in YourLibrary.json. */
export interface SpotifyLibraryAlbum {
  artist?: string;
  album?: string;
  uri: string;
}

/** A saved episode in YourLibrary.json. */
export interface SpotifyLibraryEpisode {
  name?: string;
  show?: string;
  uri: string;
}

/** A followed artist in YourLibrary.json. */
export interface SpotifyLibraryArtist {
  name?: string;
  uri: string;
}

/** A followed podcast in YourLibrary.json. */
export interface SpotifyLibraryShow {
  name?: string;
  publisher?: string;
  uri: string;
}

/** A playlist in PlaylistN.json, without its items. */
export interface SpotifyPlaylist {
  name: string;
  lastModifiedDate?: string;
  description?: string | null;
  numberOfFollowers?: number;
}

/** One item in a playlist, with the date it was added: a track, an episode, or a local file. */
export interface SpotifyPlaylistItem {
  track?: { trackName?: string; artistName?: string; albumName?: string; trackUri: string } | null;
  episode?: { episodeName?: string; showName?: string; episodeUri: string } | null;
  localTrack?: { uri: string } | null;
  addedDate: string;
}

/** A playlist item a run reads, with the playlist it's in. */
export interface SpotifyPlaylistEntry {
  playlist: SpotifyPlaylist;
  item: SpotifyPlaylistItem;
  /** The item's track as the Spotify API gives it, when a run looked it up. */
  apiTrack?: SpotifyApiTrack;
}

/** A search in SearchQueries.json. `searchTime` ends in its zone, like `2024-07-08T16:07:06.581Z[UTC]`. */
export interface SpotifySearch {
  platform?: string;
  searchTime: string;
  searchQuery: string;
  searchInteractionURIs?: string[];
}

/** Whose download it is, from Userdata.json and Identity.json, when it has them. */
export interface SpotifyAccount {
  username?: string;
  displayName?: string;
}

/** An artist as the Spotify API gives it, within a track. */
export interface SpotifyApiArtist {
  id: string;
  name: string;
  external_urls?: { spotify: string };
}

/**
 * A track as the Spotify API gives it, cut to what becomes nodes: its
 * artists and album with their IDs, which the download only names.
 */
export interface SpotifyApiTrack {
  id: string;
  name: string;
  duration_ms: number;
  preview_url?: string;
  external_urls: { spotify: string };
  artists: SpotifyApiArtist[];
  album: {
    id: string;
    name: string;
    release_date?: string;
    images?: Array<{ url: string; width: number; height: number }>;
    external_urls?: { spotify: string };
    artists?: SpotifyApiArtist[];
  };
}
