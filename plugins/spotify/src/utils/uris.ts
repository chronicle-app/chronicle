/** The kinds of Spotify URI the data download names. */
export type SpotifyKind = 'track' | 'album' | 'artist' | 'episode' | 'show';

/**
 * The ID in a Spotify URI of one kind: `4uLU6hMCjMI75M1A2tKUQC` in
 * `spotify:track:4uLU6hMCjMI75M1A2tKUQC`. None for another kind, or for a
 * local file's `spotify:local:…`, which names no item in Spotify's catalog.
 */
export function idOf(uri: unknown, kind: SpotifyKind): string | undefined {
  if (typeof uri !== 'string') return undefined;
  return new RegExp(`^spotify:${kind}:([0-9A-Za-z]+)$`).exec(uri)?.[1];
}

/** An item's page on open.spotify.com, as the Web API's `external_urls` gives it. */
export function openUrl(kind: SpotifyKind, id: string): string {
  return `https://open.spotify.com/${kind}/${id}`;
}
