import type { Survey } from '@chronicle.app/etl';
import { readHistory } from '../history.js';
import { Scope, assetId, type PhotosLibrary } from '../library.js';
import ApplePhotosExtractor, { type Found } from './ApplePhotosExtractor.js';

/** A favorite the change log has no date for. */
export interface Favorite {
  id: string;
  kind: 'photo' | 'video';
}

/**
 * The photos you made favorites before the library's change log begins, one
 * record each. When you liked one isn't known, so each is read as of when the
 * library last changed. A favorite the change log dates is a like in
 * `activity` instead, and so is removing one.
 */
export class ApplePhotosFavoritesExtractor extends ApplePhotosExtractor {
  static override description = 'Your favorite photos that have no date';
  static override recordTypes = ['favorites'];
  static override temporality = 'snapshot' as const;

  protected read(library: PhotosLibrary): Array<Found<Favorite>> {
    const history = readHistory(library.store, new Set());
    const time = this.asOfTime().toISOString();
    return library
      .rows(Scope.own)
      .filter(row => row.favorite === 1 && !history?.favorites.has(row.pk))
      .map(row => {
        const id = assetId(row);
        const kind = row.kind === 1 ? ('video' as const) : ('photo' as const);
        return { key: id, time, data: { id, kind } };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * How many favorites a run reads, as of when the library last changed,
   * since none has a date. None when that's outside `--since` and `--until`.
   */
  override async survey(): Promise<Survey | null> {
    if (!this.library) return null;
    const asOf = this.asOfTime();
    if (!this.inRange(asOf.getTime())) return { favorites: { count: 0 } };
    return { favorites: { count: this.read(this.library).length, asOf } };
  }
}
