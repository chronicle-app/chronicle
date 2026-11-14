import { ChronicleTransformer, Record, reference, selfAgent } from '@chronicle.app/etl';
import {
  BaseAndChildren,
  BookmarkAction,
  Comment,
  LikeAction,
  Movie,
  Person,
  RespondAction,
  Response,
  WatchAction,
} from '@chronicle.app/schema';
import type {
  LetterboxdAccount,
  LetterboxdFilm,
  LikeRecord,
  RatingRecord,
  ReviewRecord,
  WatchlistRecord,
  WatchRecord,
} from './LetterboxdArchiveExtractor.js';

const SOURCE = 'letterboxd';
const BY_SOURCE_ID = ['@type', 'source', 'sourceId'];
// What the member does to a film once at a time: rate it, like it, list it.
const BY_AGENT_AND_OBJECT = ['@type', 'source', 'agent.handle', 'object.sourceId'];
// Letterboxd rates in half stars, up to five.
const BEST_RATING = 5;

/**
 * The one transformer for every file in the export.
 *
 * **Ids are the codes of Letterboxd's short links.** `https://boxd.it/1TzQ`
 * is film `1TzQ`, and `https://boxd.it/2Vy6mz` is diary entry `2Vy6mz`. The
 * short link is a redirect and not the page's address, so it is never a `url`:
 * a film has one only when its page has been fetched.
 *
 * **What happens once has the entry's id, and what stands has the member and
 * the film.** A viewing, and a rating or review given on it, are a diary entry
 * and keyed by its code. A film's current rating, a like, and a place on the
 * watchlist are keyed by who and which film, so a changed date or rating
 * changes the one there is.
 */
export default class LetterboxdTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<BaseAndChildren[]> {
    switch (record.extraction.recordType) {
      case 'watches': {
        return this.buildWatch(record);
      }
      case 'ratings': {
        return this.buildRating(record);
      }
      case 'reviews': {
        return this.buildReview(record);
      }
      case 'watchlist': {
        return this.buildWatchlist(record);
      }
      case 'likes': {
        return this.buildLike(record);
      }
      default: {
        return [];
      }
    }
  }

  /**
   * A viewing. A diary entry is one, on the day it says. A film marked watched
   * with no entry was seen on no day the export knows, so it has no
   * `timestamp`: the day it was marked is when the mark was made.
   */
  private buildWatch(record: Record): BaseAndChildren[] {
    const data = record.data as WatchRecord;
    const watch: WatchAction = {
      '@type': 'WatchAction',
      '@key': data.entry ? BY_SOURCE_ID : BY_AGENT_AND_OBJECT,
      source: SOURCE,
      ...(data.entry && { sourceId: data.entry }),
      agent: this.self(record),
      object: this.movie(data.film),
      ...(data.watchedOn && { timestamp: data.watchedOn }),
      ...(data.tags && { tags: data.tags }),
    };
    return [watch];
  }

  /**
   * A rating. One given on a diary entry is that entry's, and stays what it
   * was. The film's current rating is one per member and film.
   */
  private buildRating(record: Record): BaseAndChildren[] {
    const data = record.data as RatingRecord;
    const self = this.self(record);
    const film = this.movie(data.film);
    const response: Response = {
      '@type': 'Response',
      '@key': data.entry
        ? BY_SOURCE_ID
        : ['@type', 'source', 'action.agent.handle', 'action.object.sourceId'],
      source: SOURCE,
      ...(data.entry && { sourceId: data.entry }),
      ratingValue: data.rating,
      bestRating: BEST_RATING,
      author: [reference(self) as Person],
      about: [reference(film) as Movie],
    };
    const rating: RespondAction = {
      '@type': 'RespondAction',
      '@key': data.entry ? ['@type', 'source', 'result.sourceId'] : BY_AGENT_AND_OBJECT,
      source: SOURCE,
      agent: self,
      object: film,
      ...(data.occurredOn && { timestamp: data.occurredOn }),
      result: response,
    };
    return [rating];
  }

  /** A review, with the rating given along with it. */
  private buildReview(record: Record): BaseAndChildren[] {
    const data = record.data as ReviewRecord;
    const self = this.self(record);
    const film = this.movie(data.film);
    const comment: Comment = {
      '@type': 'Comment',
      '@key': BY_SOURCE_ID,
      source: SOURCE,
      sourceId: data.entry,
      body: data.review,
      ...(data.rating !== undefined && { ratingValue: data.rating, bestRating: BEST_RATING }),
      author: [reference(self) as Person],
      about: [reference(film) as Movie],
    };
    const review: RespondAction = {
      '@type': 'RespondAction',
      '@key': ['@type', 'source', 'result.sourceId'],
      source: SOURCE,
      agent: self,
      object: film,
      ...(data.occurredOn && { timestamp: data.occurredOn }),
      result: comment,
    };
    return [review];
  }

  private buildWatchlist(record: Record): BaseAndChildren[] {
    const data = record.data as WatchlistRecord;
    const bookmark: BookmarkAction = {
      '@type': 'BookmarkAction',
      '@key': BY_AGENT_AND_OBJECT,
      source: SOURCE,
      agent: this.self(record),
      object: this.movie(data.film),
      ...(data.occurredOn && { timestamp: data.occurredOn }),
    };
    return [bookmark];
  }

  /**
   * A like, of a film or of someone's review. The export gives a liked review
   * as its short link alone, so the review is its code and nothing more.
   */
  private buildLike(record: Record): BaseAndChildren[] {
    const data = record.data as LikeRecord;
    const object = data.film
      ? this.movie(data.film)
      : data.review && {
          '@type': 'Comment' as const,
          '@key': BY_SOURCE_ID,
          source: SOURCE,
          sourceId: data.review,
        };
    if (!object) return [];

    const like: LikeAction = {
      '@type': 'LikeAction',
      '@key': BY_AGENT_AND_OBJECT,
      source: SOURCE,
      agent: this.self(record),
      object,
      ...(data.occurredOn && { timestamp: data.occurredOn }),
    };
    return [like];
  }

  /**
   * A film, keyed on its code. A diary row whose film the export doesn't
   * identify is keyed on its name and year, a film of its own.
   *
   * With its page fetched, the film has its address on Letterboxd and its IMDb
   * and TMDB ids as `sameAs`, so it is the same film another source names by
   * either. Those keysets are type-free and must stay identical across every
   * plugin minting into the `imdb` and `tmdb` namespaces. A TMDB id carries its
   * kind, such as `movie/11551`: TMDB numbers films and series apart.
   */
  private movie(film: LetterboxdFilm): Movie {
    const sameAs: Movie[] = [];
    if (film.page?.imdb) sameAs.push(this.external('imdb', film.page.imdb, film.name));
    if (film.page?.tmdb) sameAs.push(this.external('tmdb', film.page.tmdb, film.name));

    return {
      '@type': 'Movie',
      '@key': film.code ? BY_SOURCE_ID : ['@type', 'source', 'name', 'datePublished'],
      source: SOURCE,
      ...(film.code && { sourceId: film.code }),
      name: film.name,
      ...(film.year && { datePublished: film.year }),
      ...(film.page && { url: `https://letterboxd.com/film/${film.page.slug}/` }),
      ...(sameAs.length > 0 && { sameAs }),
    };
  }

  private external(source: string, sourceId: string, name: string): Movie {
    return { '@type': 'Movie', '@key': ['source', 'sourceId'], source, sourceId, name };
  }

  /**
   * The member whose export this is, keyed on their username: the export has
   * no other id for them. Without a `profile.csv`, the source's one self.
   */
  private self(record: Record): Person {
    const account = (record.context?.accountInfo ?? {}) as LetterboxdAccount;
    return {
      ...selfAgent({ source: SOURCE, handle: account.username, name: account.name }),
      ...(account.username && { url: `https://letterboxd.com/${account.username}/` }),
    } as Person;
  }
}
