import { appleDate } from '../coredata.js';
import { readHistory } from '../history.js';
import { Scope, assetId, type PhotoAlbum, type PhotosLibrary } from '../library.js';
import ApplePhotosExtractor, { type Found } from './ApplePhotosExtractor.js';

/**
 * What you did with a photo:
 *
 * - `viewed`: you last looked at it
 * - `shared`: you last shared it
 * - `edited`: you last edited it
 * - `captioned`, `titled`: you changed its caption or title
 * - `liked`, `unliked`: you made it a favorite, or stopped
 * - `addedToAlbum`: you added it to an album
 */
export type ActivityEvent =
  'viewed' | 'shared' | 'edited' | 'captioned' | 'titled' | 'liked' | 'unliked' | 'addedToAlbum';

export interface Activity {
  event: ActivityEvent;
  time: string;
  photo: { id: string; kind: 'photo' | 'video' };
  /** The album, for `addedToAlbum`. */
  album?: PhotoAlbum;
}

/**
 * What you did with your photos, each dated. Photos keeps only when a photo
 * was last viewed, shared, and edited, so each run adds what it sees to what
 * earlier runs saw. Likes, caption and title changes, and adds to albums come
 * from the library's change log, which goes back as far as Photos has kept it.
 */
export class ApplePhotosActivityExtractor extends ApplePhotosExtractor {
  static override description = 'What you did with your photos: views, shares, edits, likes';
  static override recordTypes = ['activity'];

  protected read(library: PhotosLibrary): Array<Found<Activity>> {
    const rows = library.rows(Scope.own);
    const photos = new Map(
      rows.map(row => [
        row.pk,
        { id: assetId(row), kind: row.kind === 1 ? ('video' as const) : ('photo' as const) },
      ])
    );
    const found: Array<Found<Activity>> = [];
    const add = (activity: Activity) => {
      const album = activity.album ? `/${activity.album.id}` : '';
      found.push({
        key: `${activity.event}/${activity.photo.id}${album}/${activity.time}`,
        time: activity.time,
        data: activity,
      });
    };

    for (const row of rows) {
      const photo = photos.get(row.pk)!;
      const viewed = appleDate(row.lastViewed);
      const shared = appleDate(row.lastShared);
      const edited = (row.adjustments ?? 0) > 0 ? appleDate(row.adjusted) : null;
      if (viewed) add({ event: 'viewed', time: viewed, photo });
      if (shared) add({ event: 'shared', time: shared, photo });
      if (edited) add({ event: 'edited', time: edited, photo });
    }

    const membership = library.membership();
    const history = readHistory(library.store, {
      added: new Map(rows.map(row => [row.pk, row.addedDate])),
      membership: new Set(membership.map(({ album, asset }) => `${album}/${asset}`)),
    });
    if (!history) {
      if (library.store.columns('ACHANGE').size > 0) this.hintUnreadableHistory();
      return found;
    }

    // Photos keeps whether a photo is a favorite now, and the change log when
    // that changed. The latest change made it what it is now, and each change
    // before it turned it the other way.
    const favorites = new Map(rows.map(row => [row.pk, row.favorite === 1]));
    for (const [pk, times] of history.favorites) {
      const photo = photos.get(pk);
      if (!photo) continue;
      let liked = favorites.get(pk) ?? false;
      for (const time of [...times].reverse()) {
        add({ event: liked ? 'liked' : 'unliked', time, photo });
        liked = !liked;
      }
    }
    for (const { asset, what, time } of history.edits) {
      const photo = photos.get(asset);
      if (photo) add({ event: what === 'caption' ? 'captioned' : 'titled', time, photo });
    }
    const albums = library.albums();
    for (const { asset, album, time } of history.albumAdds) {
      const photo = photos.get(asset);
      const target = albums.get(album);
      if (photo && target) add({ event: 'addedToAlbum', time, photo, album: target });
    }
    return found;
  }

  private hintUnreadableHistory(): void {
    this.hint(
      'Photos’ change log couldn’t be read, so likes, captions, and album adds are left out',
      {
        action:
          'Photos may have changed how it keeps its library. Update Chronicle, and report it if that doesn’t help.',
      }
    );
  }
}
