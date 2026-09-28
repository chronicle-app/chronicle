import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  ReadAction,
  Book,
  Person,
  QuoteAction,
  AnnotateAction,
  Quotation,
  Comment,
} from '@chronicle.app/schema';

export default class MarvinTransformer extends ChronicleTransformer {
  static override source = 'marvin';

  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'reading-sessions') {
      actions.push(...this.buildReadAction(record));
    } else if (record.extraction.recordType === 'annotations') {
      actions.push(...this.buildAnnotationActions(record));
    }

    return actions;
  }

  private buildReadAction(record: Record): ReadAction[] {
    const { data } = record;

    // add "Part Time" (seconds) to "Date Created" to get "endTime"
    const startTime = new Date(
      new Date(data['Date Created']).getTime() - Number.parseFloat(data['Part Time']) * 1000
    );

    const obj: ReadAction = {
      '@type': 'ReadAction',
      '@key': ['@type', 'source', 'sourceId'],
      startTime,
      endTime: new Date(data['Date Created']),
      source: 'marvin',
      sourceId: data['Session ID'],
      agent: this.buildAgent(),
      object: this.buildBook(record),
    };

    return [obj];
  }

  private buildBook(record: Record): Book {
    const { data } = record;
    return {
      '@type': 'Book',
      '@key': ['@type', 'source', 'name', 'author.name'],
      name: data['Book Title'],
      source: 'marvin',
      sourceId: data['Book Title'], // Use title as sourceId since no unique book ID
      author: [this.buildAuthor(record)],
    };
  }

  private buildAuthor(record: Record): Person {
    const { data } = record;
    // Properly unescape the author name (Marvin exports with comma escaping)
    const authorName = data['Book Author'].replaceAll('\\,', ',');

    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'name'],
      name: authorName,
      source: 'marvin',
      sourceId: authorName, // Use cleaned name as sourceId
    };
  }

  private buildAgent(): Person {
    // The Marvin export carries no owner identity at all, so the self is the
    // per-source singleton — merged into the real person through "@me",
    // never a fabricated name.
    return selfAgent({ source: 'marvin' }) as Person;
  }

  private buildAnnotationActions(record: Record): ActionAndChildren[] {
    const { data } = record;
    const actions: ActionAndChildren[] = [];

    // Parse the date
    const timestamp = new Date(data.Date || data.Created);

    // Unescape author name
    const authorName = data.Author ? data.Author.replaceAll('\\,', ',') : 'Unknown Author';

    // Create the book that contains the content
    const sourceBook = this.buildAnnotationBook(data, authorName);

    // Create quotation first if it exists (so comment can reference it)
    let quotation: Quotation | undefined;
    if (data.HighlightText) {
      quotation = {
        '@type': 'Quotation',
        '@key': ['@type', 'source', 'sourceId'],
        body: data.HighlightText,
        source: 'marvin',
        sourceId: data.ID,
        isPartOf: [sourceBook],
      };

      const quoteAction: QuoteAction = {
        '@type': 'QuoteAction',
        '@key': ['@type', 'source', 'sourceId'],
        timestamp,
        source: 'marvin',
        sourceId: data.ID,
        agent: this.buildAgent(),
        result: quotation,
      };

      actions.push(quoteAction);
    }

    // Handle annotation (EntryText)
    if (data.EntryText) {
      const comment: Comment = {
        '@type': 'Comment',
        '@key': ['@type', 'source', 'sourceId'],
        description: data.EntryText,
        source: 'marvin',
        sourceId: data.ID,
        about: quotation ? [quotation] : [sourceBook], // Comment about quote if it exists, otherwise about book
      };

      const annotateAction: AnnotateAction = {
        '@type': 'AnnotateAction',
        '@key': ['@type', 'source', 'sourceId'],
        timestamp,
        source: 'marvin',
        sourceId: data.ID,
        agent: this.buildAgent(),
        result: comment,
      };

      actions.push(annotateAction);
    }

    return actions;
  }

  private buildAnnotationBook(data: any, authorName: string): Book {
    return {
      '@type': 'Book',
      '@key': ['@type', 'source', 'name', 'author.name'],
      name: data.Title,
      source: 'marvin',
      sourceId: data.Title,
      author: [
        {
          '@type': 'Person',
          '@key': ['@type', 'source', 'name'],
          name: authorName,
          source: 'marvin',
          sourceId: authorName,
        },
      ],
    };
  }
}
