import { ChronicleTransformer, Record } from '@chronicle.app/etl';
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
import { buildICloudPersonSchema, groupChatChannel } from '@chronicle.app/apple';
import type { Asset, PhotoAlbum, PhotoPerson } from '../library.js';
import type { Activity } from './ApplePhotosActivityExtractor.js';
import type { Favorite } from './ApplePhotosFavoritesExtractor.js';
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
 *       location?: Location (where it was taken)
 *       result: ImageObject | VideoObject  (the photo, by iCloud's ID)
 *     AddAction  agent: you   timestamp (when added)   instrument?: SoftwareApplication
 *       object: ImageObject | VideoObject  location?: Location (where it was taken)
 *   activity:
 *     ViewAction | ShareAction | UpdateAction | LikeAction | UnlikeAction | AddAction
 *       agent: you   timestamp   object: the photo, by key   target?: Collection (the album)
 *   favorites:
 *     LikeAction  agent: you   object: the photo, by key   (no timestamp: when isn't known)
 *   shared-with-you:
 *     ShareAction  agent: who sent it to you   timestamp   target?: Channel (the group chat)
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
        return [likeOf(record.data as Favorite, you)];
      case 'shared-with-you':
        return [shareAction(record.data as SharedPhoto, record.context.occurredAt)];
      default:
        return [];
    }
  }
}

/**
 * What you did to bring a photo or video into your library. Where it was taken
 * is where you took it, so it's the action's `location`. A photo an app saved
 * was taken by someone, somewhere, before you saved it, so its position is
 * the photo's own.
 */
function photoAction(photo: Photo, time: string, you: Person | null): ActionAndChildren {
  const timestamp = new Date(time);
  const where = locationOf(photo);
  const frame = {
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: photo.id,
    timestamp,
    ...(you && { agent: you }),
    ...(where && photo.origin !== 'saved' && { location: where }),
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
        object: { ...mediaOf(photo), ...(where && { location: where }) },
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
 * A favorite the change log has no date for. When you liked it isn't known,
 * so the like has no timestamp and is keyed by the photo alone. Removing it
 * is an `UnlikeAction` in `activity`, which the change log dates.
 */
function likeOf(favorite: Favorite, you: Person | null): ActionAndChildren {
  return {
    '@type': 'LikeAction',
    '@key': ['@type', 'source', 'object.sourceId'],
    source: SOURCE,
    ...(you && { agent: you }),
    object: photoRef(favorite),
  };
}

/**
 * A photo or video shared with you in Messages, keyed by its Messages
 * attachment. Who it was sent to is the message's recipient, as Messages has it.
 * One shared in a group chat targets the group's Channel, keyed as the iMessage
 * plugin keys it. A one-to-one chat has no Channel, and the share no target.
 */
function shareAction(shared: SharedPhoto, time: string): ActionAndChildren {
  const { message, attachment } = shared;
  const agent = message.handle ? senderOf(message.handle, message.service) : null;
  const group = message.group ? groupChatChannel(message.group) : null;
  const where = locationOf(shared);
  const object = mediaOf(shared, { id: attachment, clip: false });
  return {
    '@type': 'ShareAction',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: attachment,
    timestamp: new Date(time),
    ...(agent && { agent }),
    ...(group && { target: group }),
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
 * it is now, so an album, keyword, or person taken off it closes while it has
 * others. Taking off the last one leaves it: listing them in `@asserts` would
 * close it, at the cost of a marker on every photo that has none.
 */
function mediaOf(
  asset: Asset,
  { id = asset.id, clip = true }: { id?: string; clip?: boolean } = {}
): Media {
  const mimeType = asset.uti ? MIME_TYPES[asset.uti] : undefined;
  return {
    '@type': asset.kind === 'video' ? 'VideoObject' : 'ImageObject',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: id,
    ...(asset.title && { name: asset.title }),
    ...(asset.filename && { handle: asset.filename }),
    ...(asset.caption && { caption: asset.caption }),
    ...(asset.format && { sourceFormat: asset.format }),
    ...(asset.exif && { exifData: asset.exif }),
    ...(asset.keywords.length > 0 && { tags: asset.keywords }),
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

/** Where it was taken. */
function locationOf(asset: Asset): Location | null {
  if (!asset.location) return null;
  const { latitude, longitude } = asset.location;
  return { '@type': 'Location', latitude, longitude };
}

/**
 * The kind of camera, from the make and model its file names, such as
 * `Apple iPhone 14 Pro`. Photos can't tell two cameras of one model apart, so
 * it's a `ProductModel`. It has no ID, so it's keyed by its type and that
 * name, in the `exif` namespace, so other sources reading the same files name
 * the same one. A name isn't an ID, so the type keeps a lens or a device of
 * that name apart from it.
 */
function cameraOf(asset: Asset): ProductModel | null {
  const make = asset.camera?.make ?? null;
  const model = asset.camera?.model ?? null;
  const name =
    make && model && !model.toLowerCase().startsWith(make.toLowerCase())
      ? `${make} ${model}`
      : (model ?? make);
  if (!name) return null;
  return { '@type': 'ProductModel', '@key': ['@type', 'source', 'name'], source: 'exif', name };
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
