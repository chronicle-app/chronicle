/**
 * Canonical https URL builders shared by the API and Takeout paths. `url` is a
 * cardinality-one property and mints a `{url}` identity keyset, so the two
 * paths must emit byte-identical values — Takeout renders `http://` channel
 * links and music.youtube.com watch links, which are never passed through.
 */
export function channelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

export function videoUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}
