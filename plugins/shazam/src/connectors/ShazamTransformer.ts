import {
  ChronicleTransformer,
  ISRC_SOURCE,
  Record,
  createImageObject,
  normalizeIsrc,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  ListenAction,
  Location,
  MusicAlbum,
  MusicGroup,
  MusicRecording,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import type { Shazam } from './ShazamExtractor.js';

const SOURCE = 'shazam';

/** Apple Music's catalog: the namespace of its song, album, and artist IDs. */
const APPLE_MUSIC = 'apple-music';

// Apple files every song under its root genre as well as its own.
const ROOT_GENRE = 'Music';

// The artwork Shazam shows for a song it has no cover for.
const NO_ARTWORK = /^https:\/\/images\.shazam\.com\/static\/coverart\/unavailable/;

/**
 *   ListenAction  agent: you   object: MusicRecording   location?
 *     MusicRecording  (Shazam's copy, by its Shazam key)
 *       artist: MusicGroup (Apple Music's, by its ID, or Shazam's artist line)
 *       inAlbum: MusicAlbum (Apple Music's, by its ID)
 *       sameAs: MusicRecording (ISRC), MusicRecording (Apple Music)
 */
export default class ShazamTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'shazams') return [];
    const shazam = record.data as Shazam;
    // Without an iCloud account the listener can't be identified, so omit them.
    const listener = await buildICloudPersonSchema(record.context.account);
    const recording = buildRecording(shazam);
    const location = locationOf(shazam);

    const action: ListenAction = {
      '@type': 'ListenAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: shazam.recognitionID,
      timestamp: new Date(shazam.date),
      ...(listener && { agent: listener }),
      ...(recording && { object: recording }),
      ...(location && { location }),
    };
    return [action];
  }
}

/** Shazam's copy of the song, keyed by its Shazam key and named as Shazam names it. */
function buildRecording(shazam: Shazam): MusicRecording | null {
  if (!shazam.shazamKey) return null;
  const attributes = shazam.song?.attributes ?? {};
  const { durationInMillis } = attributes;
  const genres = shazam.genres.filter(genre => genre !== ROOT_GENRE);
  const album = buildAlbum(shazam);
  const cover = coverOf(shazam.artworkURL);
  const artist = buildArtist(shazam);

  const sameAs: MusicRecording[] = [];
  const isrc = shazam.isrc && normalizeIsrc(shazam.isrc);
  if (isrc) sameAs.push(reference(ISRC_SOURCE, isrc));
  if (shazam.appleMusicID) {
    sameAs.push({
      ...reference(APPLE_MUSIC, shazam.appleMusicID),
      ...(shazam.appleMusicURL && { url: withoutTracking(shazam.appleMusicURL) }),
    });
  }

  return {
    '@type': 'MusicRecording',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: shazam.shazamKey,
    ...(shazam.title && { name: shazam.title }),
    ...(artist && { artist: [artist] }),
    ...(album && { inAlbum: album }),
    ...(typeof durationInMillis === 'number' && {
      duration: `PT${Math.floor(durationInMillis / 1000)}S`,
    }),
    ...(genres.length > 0 && { genre: genres }),
    ...(shazam.releaseDate && { datePublished: shazam.releaseDate }),
    ...(cover && { emblem: cover }),
    ...(sameAs.length > 0 && { sameAs }),
  };
}

/**
 * The song's main artist on Apple Music, by its ID, when `linkArtists` looked
 * it up. Otherwise the artist line as Shazam words it, such as `Artist Feat.
 * Guest`, keyed by that name, since Shazam gives no artist ID.
 */
function buildArtist(shazam: Shazam): MusicGroup | null {
  const linked = shazam.appleMusicArtist;
  if (linked) {
    return {
      '@type': 'MusicGroup',
      '@key': ['@type', 'source', 'sourceId'],
      source: APPLE_MUSIC,
      sourceId: linked.id,
      name: linked.name,
      ...(linked.url && { url: linked.url }),
    };
  }
  if (!shazam.subtitle) return null;
  return {
    '@type': 'MusicGroup',
    '@key': ['@type', 'source', 'name'],
    source: SOURCE,
    name: shazam.subtitle,
  };
}

/** The album is Apple Music's, keyed by the album ID in the song's Apple Music link. */
function buildAlbum(shazam: Shazam): MusicAlbum | null {
  const link = shazam.appleMusicURL ?? (shazam.song?.attributes?.url as string | undefined);
  const albumID = link?.match(/\/album\/(?:[^/?]+\/)?(\d+)/)?.[1];
  if (!shazam.albumName || !albumID) return null;
  return {
    '@type': 'MusicAlbum',
    '@key': ['@type', 'source', 'sourceId'],
    source: APPLE_MUSIC,
    sourceId: albumID,
    name: shazam.albumName,
  };
}

function reference(source: string, sourceId: string): MusicRecording {
  return {
    '@type': 'MusicRecording',
    '@key': ['@type', 'source', 'sourceId'],
    source,
    sourceId,
  };
}

/**
 * Where the song was recognized. A device without a fix records 0, 0 or
 * -180, -180, which is no place on Earth.
 */
function locationOf({ latitude, longitude }: Shazam): Location | null {
  if (latitude === null || longitude === null) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { '@type': 'Location', latitude, longitude };
}

/**
 * The cover. Apple Music covers are stored as HEIC, which most browsers can't
 * show, and Apple's image server gives the same size as a JPEG.
 */
function coverOf(link: string | null) {
  if (!link || NO_ARTWORK.test(link)) return null;
  const url = link.replace(/^(https:\/\/[^/]+\.mzstatic\.com\/.*bb)\.heic$/, '$1.jpg');
  const size = url.match(/\/(\d+)x(\d+)bb\.\w+$/);
  return createImageObject({
    url,
    ...(size && { width: Number(size[1]), height: Number(size[2]) }),
  });
}

/** An Apple Music link without its campaign parameters (`itscg`, `itsct`). */
function withoutTracking(link: string): string {
  try {
    const url = new URL(link);
    const kept = [...url.searchParams].filter(([name]) => !name.startsWith('its'));
    url.search = new URLSearchParams(kept).toString();
    return url.toString();
  } catch {
    return link;
  }
}
