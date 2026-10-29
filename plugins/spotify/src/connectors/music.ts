import { createImageObject } from '@chronicle.app/etl';
import { MusicAlbum, MusicGroup, MusicRecording } from '@chronicle.app/schema';

// A track, artist, or album as the Spotify API gives it, keyed by its Spotify
// ID: the API's own records, and a data download's tracks looked up in it.

export function buildMusicRecording(trackData: any): MusicRecording {
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
    recording.artist = trackData.artists.map((artist: any) => buildMusicGroup(artist));
  }

  // Add album
  if (trackData.album) {
    recording.inAlbum = buildMusicAlbum(trackData.album);
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

export function buildMusicGroup(artistData: any): MusicGroup {
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

export function buildMusicAlbum(albumData: any): MusicAlbum {
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
    album.artist = albumData.artists.map((artist: any) => buildMusicGroup(artist));
  }

  return album;
}
