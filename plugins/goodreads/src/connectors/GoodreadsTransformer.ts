import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Book,
  Collection,
  ConsumeAction,
  CompleteAction,
  BookmarkAction,
  Organization,
  Person,
} from '@chronicle.app/schema';

export default class GoodreadsTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'shelves') {
      actions.push(...(await this.buildGoodreadsActions(record)));
    }

    return actions;
  }

  private async buildGoodreadsActions(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];
    const { data } = record;

    const user: Person = this.buildUser();
    const book: Book = this.buildBook(data);

    const dateAdded = data['Date Added'] ? this.parseDate(data['Date Added']) : undefined;
    const dateRead = data['Date Read']?.trim() ? this.parseDate(data['Date Read']) : undefined;

    // Adding a book to any shelf is a bookmark (the "saved it" signal), placed
    // at when it was added.
    if (dateAdded) {
      actions.push({
        '@type': 'BookmarkAction',
        '@key': ['@type', 'source', 'object.sourceId', 'timestamp'],
        source: 'goodreads',
        agent: user,
        object: book,
        timestamp: dateAdded,
      } as BookmarkAction);
    }

    // The exclusive shelf is the book's reading state. `read` is a finish (a
    // CompleteAction, which opens the `completed` run on the persistence side).
    // An in-progress shelf is a status, not a session: Goodreads knows the book
    // is being read but not when reading started, so it opens the `consuming`
    // run with a bare, undated ConsumeAction (unknown start). ReadAction is
    // reserved for genuine reading sessions with a real start.
    const shelf = data['Exclusive Shelf'];
    if (shelf === 'read') {
      const finishedAt = dateRead ?? dateAdded;
      actions.push({
        '@type': 'CompleteAction',
        '@key': ['@type', 'source', 'object.sourceId', 'timestamp'],
        source: 'goodreads',
        agent: user,
        object: book,
        ...(finishedAt && { timestamp: finishedAt }),
      } as CompleteAction);
    } else if (shelf === 'currently-reading' || shelf === 'to-finish') {
      actions.push({
        '@type': 'ConsumeAction',
        '@key': ['@type', 'source', 'object.sourceId'],
        source: 'goodreads',
        agent: user,
        object: book,
      } as ConsumeAction);
    }

    return actions;
  }

  private buildBook(data: any): Book {
    const book: Book = {
      '@type': 'Book',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'goodreads',
      sourceId: data['Book Id'],
      name: data.Title,
      url: `https://www.goodreads.com/book/show/${data['Book Id']}`,
    };

    const review = data['My Review']?.trim();
    if (review) book.description = review;

    const authors = this.buildAuthors(data.Author, data['Additional Authors']);
    if (authors.length > 0) book.author = authors;

    const pages = Number.parseInt(data['Number of Pages'], 10);
    if (Number.isFinite(pages) && pages > 0) book.pageCount = pages;

    const shelves = this.buildShelves(data.Bookshelves, data['Exclusive Shelf']);
    if (shelves.length > 0) {
      book.isPartOf = shelves;
      // A book removed from all custom shelves drops `isPartOf` from the payload,
      // which the snapshot `'*'` default wouldn't close — list it so un-shelving
      // closes the old memberships.
      (book as Book & { '@asserts'?: string[] })['@asserts'] = ['isPartOf'];
    }

    const publisher = data.Publisher?.trim();
    if (publisher) book.publisher = [this.buildPublisher(publisher)];

    const isbn13 = this.isbn13(data.ISBN13);
    if (isbn13) book.sameAs = [this.buildIsbnSameAs(isbn13, data.Title)];

    return book;
  }

  /**
   * The ISBN-13 as a `sameAs` edge to the `isbn` namespace (a portable, standard
   * id → protocol source), so this edition collapses onto the same book read
   * through any other ISBN-bearing source. Carries the title so the edge still
   * names the book if it's what mints it. The keyset is type-free — the ISBN
   * names one work however a source typed it — and must stay identical across
   * every plugin minting into the `isbn` namespace.
   */
  private buildIsbnSameAs(isbn13: string, title: string): Book {
    return {
      '@type': 'Book',
      '@key': ['source', 'sourceId'],
      source: 'isbn',
      sourceId: isbn13,
      name: title,
    };
  }

  /** Goodreads wraps ISBNs as `="9780…"`; return the bare 13-digit id, or none. */
  private isbn13(raw: string | undefined): string | undefined {
    const digits = (raw ?? '').replaceAll(/\D/g, '');
    return digits.length === 13 ? digits : undefined;
  }

  /**
   * The user's custom shelves, as Collections the book `isPartOf`. A shelf is a
   * real user-owned list with a permalink, not a free-text tag. The `Bookshelves`
   * column repeats the exclusive shelf (the reading state, already modeled as
   * actions), so drop it.
   */
  private buildShelves(
    bookshelves: string | undefined,
    exclusiveShelf: string | undefined
  ): Collection[] {
    if (!bookshelves) return [];
    const exclusive = exclusiveShelf?.trim();
    return bookshelves
      .split(',')
      .map(s => s.trim())
      .filter(s => s && s !== exclusive)
      .map(shelf => this.buildShelf(shelf));
  }

  /**
   * A shelf as a Collection. When the user's review-list id is configured we can
   * build the real per-user permalink and key on it (distinct across users);
   * otherwise the shelf is keyed on its name within the source.
   */
  private buildShelf(shelf: string): Collection {
    const userId = this.userId();
    if (userId) {
      return {
        '@type': 'Collection',
        '@key': ['@type', 'url'],
        source: 'goodreads',
        name: shelf,
        url: `https://www.goodreads.com/review/list/${userId}?shelf=${encodeURIComponent(shelf)}`,
      };
    }
    return {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'name'],
      source: 'goodreads',
      name: shelf,
    };
  }

  private buildPublisher(name: string): Organization {
    return {
      '@type': 'Organization',
      '@key': ['@type', 'source', 'name'],
      source: 'goodreads',
      name,
    };
  }

  /**
   * The primary author followed by any `Additional Authors` (translators,
   * co-authors, illustrators — a comma-separated list), deduped by name.
   */
  private buildAuthors(primary: string | undefined, additional: string | undefined): Person[] {
    const names = [primary ?? '', ...(additional ?? '').split(',')]
      .map(n => n.trim())
      .filter(n => n.length > 0);
    return [...new Set(names)].map(name => this.buildAuthor(name));
  }

  private buildAuthor(authorName: string): Person {
    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'name'],
      source: 'goodreads',
      name: authorName,
    };
  }

  private buildUser(): Person {
    const displayName = (this.config.displayName as string | undefined)?.trim();

    // The numeric Goodreads id is the user's real, stable identity. When it's
    // configured, key on it (and link the profile) so the agent survives a
    // display-name change and stays distinct across imported users; the name is
    // then just an optional label. Without an id we can only key on the name.
    const userId = this.userId();
    if (userId) {
      return {
        '@type': 'Person',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'goodreads',
        sourceId: userId,
        ...(displayName && { name: displayName }),
        url: `https://www.goodreads.com/user/show/${userId}`,
        sameAs: ['@me'],
      };
    }
    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'name'],
      source: 'goodreads',
      name: displayName || 'Unknown User',
      sameAs: ['@me'],
    };
  }

  /**
   * The user's numeric Goodreads id from config, the stable handle behind both
   * the profile and shelf permalinks. Accepts either the bare id or the
   * `{id}-{slug}` token (the slug is cosmetic and can change), normalizing to
   * the numeric part.
   */
  private userId(): string | undefined {
    const raw = (this.config.userId as string | undefined)?.trim();
    return raw ? raw.split('-')[0] : undefined;
  }

  private parseDate(dateString: string): Date {
    if (!dateString) return new Date();

    // Handle Goodreads date format: YYYY/MM/DD
    const parts = dateString.split('/');
    if (parts.length === 3) {
      return new Date(
        Number.parseInt(parts[0]),
        Number.parseInt(parts[1]) - 1,
        Number.parseInt(parts[2])
      );
    }

    return new Date(dateString);
  }
}
