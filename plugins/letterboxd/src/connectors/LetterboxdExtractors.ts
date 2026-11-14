import { MergingExtractor, Record } from '@chronicle.app/etl';
import { LetterboxdArchiveExtractor } from './LetterboxdArchiveExtractor.js';
import LetterboxdTransformer from './LetterboxdTransformer.js';

/**
 * `diary.csv`, a viewing per row, and the films in `watched.csv` that have no
 * diary entry.
 */
export class LetterboxdWatchesExtractor extends LetterboxdArchiveExtractor {
  static override description = 'Films you watched, from your diary and your watched films';
  static override recordTypes = ['watches'];
  static override defaultTransformer = LetterboxdTransformer;
  static override schema = LetterboxdArchiveExtractor.schema;
}

/** `ratings.csv`, each film's current rating, and the ratings given on diary entries. */
export class LetterboxdRatingsExtractor extends LetterboxdArchiveExtractor {
  static override description = 'Ratings you gave films';
  static override recordTypes = ['ratings'];
  static override defaultTransformer = LetterboxdTransformer;
  static override schema = LetterboxdArchiveExtractor.schema;
}

/** `reviews.csv`. */
export class LetterboxdReviewsExtractor extends LetterboxdArchiveExtractor {
  static override description = 'Reviews you wrote';
  static override recordTypes = ['reviews'];
  static override defaultTransformer = LetterboxdTransformer;
  static override schema = LetterboxdArchiveExtractor.schema;
}

/** `watchlist.csv`. */
export class LetterboxdWatchlistExtractor extends LetterboxdArchiveExtractor {
  static override description = 'Films on your watchlist';
  static override recordTypes = ['watchlist'];
  static override defaultTransformer = LetterboxdTransformer;
  static override schema = LetterboxdArchiveExtractor.schema;
}

/** `likes/films.csv` and `likes/reviews.csv`. */
export class LetterboxdLikesExtractor extends LetterboxdArchiveExtractor {
  static override description = 'Films and reviews you liked';
  static override recordTypes = ['likes'];
  static override defaultTransformer = LetterboxdTransformer;
  static override schema = LetterboxdArchiveExtractor.schema;
}

/** The whole export in one pass, newest first: what a bare `extract letterboxd -i <dir>` means. */
export class LetterboxdDefaultExtractor extends MergingExtractor<
  typeof LetterboxdDefaultExtractor
> {
  static override source = 'letterboxd';
  static override description = 'Everything in the export, newest first';
  static override delivery = 'export' as const;
  static override strategy = 'archive';
  static override recordTypes = ['watches', 'ratings', 'reviews', 'watchlist', 'likes'];
  static override default = true;
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = LetterboxdTransformer;

  static override children = [
    LetterboxdWatchesExtractor,
    LetterboxdRatingsExtractor,
    LetterboxdReviewsExtractor,
    LetterboxdWatchlistExtractor,
    LetterboxdLikesExtractor,
  ];

  // The children's flags, so the runner forwards them to the merge and the
  // merge forwards the raw config to each child.
  static override schema = MergingExtractor.schema.merge(
    LetterboxdArchiveExtractor.schema.pick({
      input: true,
      'film-pages': true,
      'film-cache': true,
    })
  ) as any;

  // A record with no day, a film marked watched with no diary entry, sorts
  // last: undated is not oldest.
  protected sortKey(record: Record): number {
    const { occurredOn } = record.data as { occurredOn?: string };
    const time = occurredOn ? Date.parse(occurredOn) : Number.NaN;
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  }
}
