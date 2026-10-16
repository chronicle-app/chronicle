import { ChronicleTransformer, Record, reference } from '@chronicle.app/etl';
import type {
  ActionAndChildren,
  Agent,
  BaseAndChildren,
  Collection,
  ImageObject,
  Location,
  Person,
  ProductModel,
  SoftwareApplication,
  VideoObject,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/apple';
import type { Asset, PhotoAlbum, PhotoPerson } from '../library.js';
import type { Activity } from './ApplePhotosActivityExtractor.js';
import type { Favorites } from './ApplePhotosFavoritesExtractor.js';
import type { Photo } from './ApplePhotosPhotosExtractor.js';
import type { SharedPhoto } from './ApplePhotosSharedWithYouExtractor.js';

const SOURCE = 'apple-photos';

// What each kind of file is, by its uniform type identifier.
const MIME_TYPES: { [uti: string]: string } = {
  'public.jpeg': 'image/jpeg',
  'public.heic': 'image/heic',
  'public.heif': 'image/heif',
  'public.png': 'image/png',
  'public.tiff': 'image/tiff',
  'com.compuserve.gif': 'image/gif',
  'org.webmproject.webp': 'image/webp',
  'com.apple.quicktime-movie': 'video/quicktime',
  'public.mpeg-4': 'video/mp4',
};

// The app a Live Photo taken during a FaceTime call was taken with.
const FACETIME: SoftwareApplication = {
  '@type': 'SoftwareApplication',
  '@key': ['@type', 'source', 'handle'],
  source: 'apple-bundle-id',
  handle: 'com.apple.FaceTime',
  name: 'FaceTime',
};

type Media = ImageObject | VideoObject;

/**
 *   photos:
 *     PhotographAction | RecordAction | ScreenshotAction  agent: you   timestamp (when taken)
 *       instrument?: ProductModel (the camera) | SoftwareApplication (FaceTime)
 *       location?: Location
 *       result: ImageObject | VideoObject  (the photo, by iCloud's ID)
 *     AddAction  agent: you   timestamp (when added)   instrument?: SoftwareApplication
 *       object: ImageObject | VideoObject
 *   activity:
 *     ViewAction | ShareAction | UpdateAction | LikeAction | UnlikeAction | AddAction
 *       agent: you   timestamp   object: the photo, by key   target?: Collection (the album)
 *   favorites:
 *     UpdateAction  agent: you   timestamp (when the library last changed)
 *       object: Person (you)  likes[]: the photos, by key
 *   shared-with-you:
 *     ShareAction  agent: who sent it   recipient?: who it was sent to   timestamp
 *       object: ImageObject | VideoObject  (by Messages' attachment ID)  sameAs: the attachment
 */
export default class ApplePhotosTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<BaseAndChildren[]> {
    // Without an iCloud account you can't be identified, so you're omitted.
    const you = await buildICloudPersonSchema(record.context.account);
    switch (record.extraction.recordType) {
      case 'photos':
        return [photoAction(record.data as Photo, record.context.occurredAt, you)];
      case 'activity':
        return [activityAction(record.data as Activity, you)];
      case 'favorites':
        return you ? [favoritesOf(record.data as Favorites, record.context.occurredAt, you)] : [];
      case 'shared-with-you':
        return [shareAction(record.data as SharedPhoto, record.context.occurredAt, you)];
      default:
        return [];
    }
  }
}

/** What you did to bring a photo or video into your library. */
function photoAction(photo: Photo, time: string, you: Person | null): ActionAndChildren {
  const timestamp = new Date(time);
  const where = locationOf(photo);
  const frame = {
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: photo.id,
    timestamp,
    ...(you && { agent: you }),
    ...(where && { location: where }),
  };
  switch (photo.origin) {
    case 'camera': {
      const camera = cameraOf(photo);
      const instrument = camera ? { instrument: [camera] } : {};
      const result = mediaOf(photo);
      return photo.kind === 'video'
        ? { '@type': 'RecordAction', ...frame, ...instrument, result }
        : { '@type': 'PhotographAction', ...frame, ...instrument, result };
    }
    case 'screenshot':
      return { '@type': 'ScreenshotAction', ...frame, result: mediaOf(photo) };
    case 'screenRecording':
      return { '@type': 'RecordAction', ...frame, result: mediaOf(photo) };
    case 'faceTime':
      // What FaceTime records is the clip. The still is part of it.
      return {
        '@type': 'RecordAction',
        ...frame,
        instrument: [FACETIME],
        result: { ...clipOf(photo), contains: [mediaOf(photo, { clip: false })] },
      };
    case 'saved': {
      const app = appOf(photo);
      return {
        '@type': 'AddAction',
        ...frame,
        ...(app && { instrument: [app] }),
        object: mediaOf(photo),
      };
    }
  }
}

/** Something you did with a photo, keyed by the photo and when. */
function activityAction(activity: Activity, you: Person | null): ActionAndChildren {
  const frame = {
    '@key': ['@type', 'source', 'object.sourceId', 'timestamp'],
    source: SOURCE,
    timestamp: new Date(activity.time),
    ...(you && { agent: you }),
    object: photoRef(activity.photo),
  };
  switch (activity.event) {
    case 'viewed':
      return { '@type': 'ViewAction', ...frame };
    case 'shared':
      return { '@type': 'ShareAction', ...frame };
    case 'edited':
    case 'captioned':
    case 'titled':
      return { '@type': 'UpdateAction', ...frame };
    case 'liked':
      return { '@type': 'LikeAction', ...frame };
    case 'unliked':
      return { '@type': 'UnlikeAction', ...frame };
    case 'addedToAlbum':
      return {
        '@type': 'AddAction',
        ...frame,
        '@key': ['@type', 'source', 'object.sourceId', 'target.sourceId', 'timestamp'],
        target: collectionOf(activity.album!, { asserts: false }),
      };
  }
}

/**
 * Your favorites with no date, as one list on you, which is the whole list:
 * a favorite you remove drops out of it, and you assert `likes` so the last
 * one dropping out still counts. A record is an action, so the list arrives
 * on the reading that saw it, as you, dated when the library last changed.
 */
function favoritesOf(favorites: Favorites, time: string, you: Person): ActionAndChildren {
  return {
    '@type': 'UpdateAction',
    '@key': ['@type', 'source', 'object.sourceId', 'timestamp'],
    source: SOURCE,
    timestamp: new Date(time),
    agent: reference(you),
    object: {
      ...you,
      '@asserts': ['likes'],
      likes: favorites.favorites.map(photo => photoRef(photo)),
    },
  };
}

/** A photo or video shared in Messages, keyed by its Messages attachment. */
function shareAction(shared: SharedPhoto, time: string, you: Person | null): ActionAndChildren {
  const { message, attachment } = shared;
  const other = message.handle ? senderOf(message.handle, message.service) : null;
  const agent = message.fromMe ? you : other;
  // You sent it to the other person in a one-to-one conversation. Who's in a
  // group isn't known.
  const recipient = message.fromMe ? (!message.group && other ? [other] : []) : you ? [you] : [];
  const where = locationOf(shared);
  const object = mediaOf(shared, { id: attachment, clip: false, asserts: ['depicts', 'category'] });
  return {
    '@type': 'ShareAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: attachment,
    timestamp: new Date(time),
    ...(agent && { agent }),
    ...(recipient.length > 0 && { recipient }),
    object: {
      ...object,
      ...(where && { location: where }),
      // The same attachment as Messages has it: iMessage keys it by its ID alone.
      sameAs: [
        {
          '@type': object['@type'],
          '@key': ['source', 'sourceId'],
          source: 'imessage',
          sourceId: attachment,
        },
      ],
    } as Media,
  };
}

/**
 * The photo or video, keyed by iCloud's ID for it. Each run is the library as
 * it is now, so it asserts its albums, keywords, people, and labels, which
 * closes one that's gone even when none are left.
 */
function mediaOf(
  asset: Asset,
  {
    id = asset.id,
    clip = true,
    asserts = ['isPartOf', 'tags', 'depicts', 'category'],
  }: { id?: string; clip?: boolean; asserts?: string[] } = {}
): Media {
  const mimeType = asset.uti ? MIME_TYPES[asset.uti] : undefined;
  return {
    '@type': asset.kind === 'video' ? 'VideoObject' : 'ImageObject',
    '@key': ['@type', 'source', 'sourceId'],
    '@asserts': asserts,
    source: SOURCE,
    sourceId: id,
    ...(asset.title && { name: asset.title }),
    ...(asset.filename && { handle: asset.filename }),
    ...(asset.caption && { caption: asset.caption }),
    ...(asset.aiDescription && { aiDescription: asset.aiDescription }),
    ...(asset.keywords.length > 0 && { tags: asset.keywords }),
    ...(asset.labels.length > 0 && { category: asset.labels }),
    ...(asset.people.length > 0 && { depicts: asset.people.map(person => personOf(person)) }),
    ...(asset.albums.length > 0 && {
      isPartOf: asset.albums.map(album => collectionOf(album, { asserts: true })),
    }),
    ...(clip && asset.clip && { contains: [clipOf(asset)] }),
    ...(asset.width && { width: asset.width }),
    ...(asset.height && { height: asset.height }),
    ...(asset.duration && { duration: isoDuration(asset.duration) }),
    ...(mimeType && { mimeType }),
  } as Media;
}

/**
 * A Live Photo's video. It's the same asset as the photo, so it takes the
 * photo's ID, as a `VideoObject`.
 */
function clipOf(asset: Asset): VideoObject {
  return {
    '@type': 'VideoObject',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: asset.id,
    ...(asset.clip?.duration && { duration: isoDuration(asset.clip.duration) }),
  };
}

/** A photo or video by its key alone. */
function photoRef(photo: { id: string; kind: 'photo' | 'video' }): Media {
  return {
    '@type': photo.kind === 'video' ? 'VideoObject' : 'ImageObject',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: photo.id,
  };
}

/** A person you named in Photos, keyed by Photos' ID for them. */
function personOf(person: PhotoPerson): Person {
  return {
    '@type': 'Person',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: person.id,
    name: person.name,
    ...(person.me && { sameAs: ['@me'] }),
  };
}

/** An album, keyed by iCloud's ID for it, in the folders it's in. */
function collectionOf(album: PhotoAlbum, { asserts }: { asserts: boolean }): Collection {
  // The outermost folder first, each inside the one before it.
  let folder: Collection | undefined;
  for (const { id, title } of [...album.folders].reverse()) {
    folder = {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'sourceId'],
      ...(asserts && { '@asserts': ['isPartOf'] }),
      source: SOURCE,
      sourceId: id,
      ...(title && { name: title }),
      ...(folder && { isPartOf: [folder] }),
    };
  }
  return {
    '@type': 'Collection',
    '@key': ['@type', 'source', 'sourceId'],
    ...(asserts && { '@asserts': ['isPartOf'] }),
    source: SOURCE,
    sourceId: album.id,
    ...(album.title && { name: album.title }),
    ...(folder && { isPartOf: [folder] }),
  };
}

/** Where it was taken, with the address Photos looked up. */
function locationOf(asset: Asset): Location | null {
  if (!asset.location) return null;
  const { latitude, longitude, address } = asset.location;
  return { '@type': 'Location', latitude, longitude, ...(address && { address }) };
}

/**
 * The kind of camera, from the make and model its file names, such as
 * `Apple iPhone 14 Pro`. Photos can't tell two cameras of one model apart, so
 * it's a `ProductModel`, keyed by that name so other sources reading the
 * same files name the same one.
 */
function cameraOf(asset: Asset): ProductModel | null {
  const make = asset.camera?.make ?? null;
  const model = asset.camera?.model ?? null;
  const name =
    make && model && !model.toLowerCase().startsWith(make.toLowerCase())
      ? `${make} ${model}`
      : (model ?? make);
  if (!name) return null;
  return {
    '@type': 'ProductModel',
    '@key': ['source', 'sourceId'],
    source: 'exif',
    sourceId: name,
    name,
  };
}

/** The app that added a photo, by its bundle identifier. */
function appOf(asset: Asset): SoftwareApplication | null {
  if (!asset.importer) return null;
  return {
    '@type': 'SoftwareApplication',
    '@key': ['@type', 'source', 'handle'],
    source: 'apple-bundle-id',
    handle: asset.importer,
    ...(asset.importerName && { name: asset.importerName }),
  };
}

/**
 * Who you shared with in Messages, by their handle there. Photos knows them
 * only by the handle, so they're the same as Messages' participant: iMessage
 * keys one by handle, in `icloud` for iMessage and `phone` for SMS.
 */
function senderOf(handle: string, service: string | null): Person {
  const identity: Agent = {
    '@type': 'Agent',
    '@key': ['@type', 'source', 'handle'],
    source: service?.toLowerCase() === 'sms' ? 'phone' : 'icloud',
    handle,
  };
  return {
    '@type': 'Person',
    '@key': ['@type', 'source', 'handle'],
    source: SOURCE,
    handle,
    sameAs: [identity],
  };
}

/** Seconds as an ISO 8601 duration, to the millisecond. */
function isoDuration(seconds: number): string {
  return `PT${Math.round(seconds * 1000) / 1000}S`;
}
