import { readHistory } from '../history.js';
import { Scope, assetId, type PhotosLibrary } from '../library.js';
import ApplePhotosExtractor, { type Found } from './ApplePhotosExtractor.js';

/** Your favorites the change log has no date for. */
export interface Favorites {
  favorites: Array<{ id: string; kind: 'photo' | 'video' }>;
}

/**
 * The photos you made favorites before the library's change log begins, as
 * one record, read as of when the library last changed. A favorite the change
 * log dates is a like in `activity` instead. The record lists them all, so a
 * favorite you remove drops out of it.
 */
export class ApplePhotosFavoritesExtractor extends ApplePhotosExtractor {
  static override description = 'Your favorite photos that have no date';
  static override recordTypes = ['favorites'];
  static override temporality = 'snapshot' as const;

  protected read(library: PhotosLibrary): Array<Found<Favorites>> {
    const history = readHistory(library.store, new Set());
    const favorites = library
      .rows(Scope.own)
      .filter(row => row.favorite === 1 && !history?.favorites.has(row.pk))
      .map(row => ({
        id: assetId(row),
        kind: row.kind === 1 ? ('video' as const) : ('photo' as const),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const time = this.asOfTime().toISOString();
    return [{ key: 'favorites', time, data: { favorites } }];
  }
}
