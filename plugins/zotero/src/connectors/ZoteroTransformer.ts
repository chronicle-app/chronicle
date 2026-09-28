import path from 'node:path';
import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AnnotateAction,
  BookmarkAction,
  Collection,
  Comment,
  CreativeWork,
  CreativeWorkAndChildren,
  EntityAndChildren,
  MediaObjectAndChildren,
  Organization,
  Person,
  QuoteAction,
  Quotation,
  Realm,
  SelectorAndChildren,
  Tag,
  ViewAction,
} from '@chronicle.app/schema';
import {
  ZoteroAnnotationRecord,
  ZoteroAttachment,
  ZoteroCollection,
  ZoteroContext,
  ZoteroCreator,
  ZoteroNoteRecord,
  ZoteroOrphanAttachmentRecord,
  ZoteroTag,
  ZoteroWorkRecord,
} from './records.js';

const SOURCE = 'zotero';

/** Zotero timestamps are UTC `YYYY-MM-DD HH:MM:SS`, no zone marker. */
function parseZoteroDate(raw: string): Date {
  return new Date(`${raw.replace(' ', 'T')}Z`);
}

type WorkType =
  | 'Book'
  | 'Article'
  | 'Post'
  | 'Message'
  | 'VideoObject'
  | 'AudioObject'
  | 'PodcastEpisode'
  | 'SoftwareApplication'
  | 'ImageObject'
  | 'CreativeWork';

/** Zotero itemType → the Chronicle work subtype (every value here exists in the schema). */
const WORK_TYPE_BY_ITEM_TYPE: { [itemType: string]: WorkType } = {
  book: 'Book',
  bookSection: 'Book',
  journalArticle: 'Article',
  magazineArticle: 'Article',
  newspaperArticle: 'Article',
  encyclopediaArticle: 'Article',
  dictionaryEntry: 'Article',
  conferencePaper: 'Article',
  preprint: 'Article',
  report: 'Article',
  thesis: 'Article',
  blogPost: 'Post',
  forumPost: 'Post',
  email: 'Message',
  instantMessage: 'Message',
  film: 'VideoObject',
  videoRecording: 'VideoObject',
  tvBroadcast: 'VideoObject',
  audioRecording: 'AudioObject',
  radioBroadcast: 'AudioObject',
  podcast: 'PodcastEpisode', // Zotero's "podcast" item is a single episode
  computerProgram: 'SoftwareApplication',
  artwork: 'ImageObject',
};

/**
 * The work entity keys on `(source, sourceId)` (plus the library realm) —
 * `@type` isn't part of its identity — so refining this map later retypes an
 * existing entity in place instead of re-minting it.
 */
function mapWorkType(itemType: string): WorkType {
  return WORK_TYPE_BY_ITEM_TYPE[itemType] ?? 'CreativeWork';
}

/** image/* → ImageObject; pdf/epub/text/* → DocumentObject; everything else (incl. null) → MediaObject. */
function mapAttachmentType(
  contentType: string | null
): 'ImageObject' | 'DocumentObject' | 'MediaObject' {
  if (!contentType) return 'MediaObject';
  if (contentType.startsWith('image/')) return 'ImageObject';
  if (
    contentType === 'application/pdf' ||
    contentType === 'application/epub+zip' ||
    contentType.startsWith('text/')
  ) {
    return 'DocumentObject';
  }
  return 'MediaObject';
}

/** Basename of a Zotero attachment path (e.g. `storage:Paper.pdf` → `Paper.pdf`). */
function filenameFromPath(rawPath: string | null | undefined): string | undefined {
  if (!rawPath) return undefined;
  const base = rawPath
    .replace(/^storage:/, '')
    .split('/')
    .pop();
  return base || undefined;
}

/**
 * Zotero's multipart `date` field, e.g. `'2024-07-00 7/2024'` — take the first
 * whitespace token and strip trailing `-00` (unknown month/day) segments.
 * Stays a string so day/month/year precision survives; never fabricates an
 * instant.
 */
function parseDatePublished(raw: string): string {
  const token = raw.trim().split(/\s+/)[0];
  return token.replace(/(-00)+$/, '');
}

/** Strip a `doi.org`/`doi:` prefix and lowercase, per the DOI display convention. */
function normalizeDoi(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:https?:\/\/doi\.org\/|doi\.org\/|doi:)/i, '')
    .toLowerCase();
}

/**
 * Normalize one ISBN token to ISBN-13: a 13-digit ISBN passes through; a
 * 10-char ISBN-10 converts (978 prefix + its first 9 digits, with a
 * recomputed EAN-13 check digit); anything else is skipped.
 */
function toIsbn13(raw: string): string | undefined {
  const cleaned = raw.replaceAll(/[^0-9Xx]/g, '').toUpperCase();
  if (cleaned.length === 13) return cleaned;
  if (cleaned.length === 10) {
    const core = `978${cleaned.slice(0, 9)}`;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += i % 2 === 0 ? Number(core[i]) : Number(core[i]) * 3;
    }
    const check = (10 - (sum % 10)) % 10;
    return `${core}${check}`;
  }
  return undefined;
}

/** `archiveID` holds an `arXiv:<id>` prefix, or a bare id when `repository` says arXiv. */
function extractArxivFromArchiveId(
  archiveID: string | undefined,
  repository: string | undefined
): string | undefined {
  if (!archiveID) return undefined;
  const trimmed = archiveID.trim();
  const prefixed = /^arXiv:(.+)$/i.exec(trimmed);
  if (prefixed) return prefixed[1].trim();
  if (repository === 'arXiv') return trimmed;
  return undefined;
}

/** Every `arXiv:<id>` line in the free-text `extra` field, stripping a trailing ` [cs.XX]` classification. */
function extractArxivIdsFromExtra(extra: string | undefined): string[] {
  if (!extra) return [];
  const ids: string[] = [];
  for (const line of extra.split(/\r?\n/)) {
    const match = /arXiv:\s*(\S+)/i.exec(line);
    if (!match) continue;
    const id = match[1].replace(/\[[^\]]*\]$/, '').trim();
    if (id) ids.push(id);
  }
  return ids;
}

/** An arXiv-minted DOI (`10.48550/arxiv.<id>`) names the same paper by its arXiv id. */
function extractArxivIdFromDoi(normalizedDoi: string | undefined): string | undefined {
  if (!normalizedDoi) return undefined;
  const match = /^10\.48550\/arxiv\.(.+)$/i.exec(normalizedDoi);
  return match ? match[1] : undefined;
}

const GENERIC_ATTACHMENT_TITLES = new Set([
  'pdf',
  'full text pdf',
  'snapshot',
  'ebook',
  'epub',
  'attachment',
]);

/**
 * Zotero auto-titles child attachments with generic labels ("PDF", "Full
 * Text PDF", "Snapshot", "Ebook", "EPUB", "Attachment") that make a
 * meaningless feed row — the filename is usually the descriptive one. Prefer
 * the title unless it's one of those generic labels, in which case prefer
 * the filename; fall back to the title when there's no filename to prefer.
 * Both are real source data — this only chooses which one names the entity.
 */
function attachmentDisplayName(attachment: ZoteroAttachment): string | undefined {
  const filename = filenameFromPath(attachment.path);
  if (attachment.title && !GENERIC_ATTACHMENT_TITLES.has(attachment.title.trim().toLowerCase())) {
    return attachment.title;
  }
  return filename ?? attachment.title;
}

const ANNOTATION_STYLES: { [type: number]: string } = {
  1: 'highlight',
  2: 'note',
  3: 'image',
  4: 'ink',
  5: 'underline',
  6: 'text',
};

/**
 * A local Zotero library (`zotero.sqlite`) → Chronicle JSON-LD.
 *
 * Four record shapes come off the extractor: `work` (a reference item with
 * its creators/collections/tags/attachments joined in), `annotation` (a
 * highlight/note made in the reader, with its attachment and parent work
 * context), `attachment` (an orphan file saved directly to the library, with
 * no parent work), and `note` (an HTML note item, on a work or standalone).
 * All four are re-read on every crawl (`snapshot` temporality), so mutable
 * attributes — collection membership, tags, the last-read timestamp — are
 * sighted at crawl time, not back-dated.
 */
export default class ZoteroTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    const context = record.context as ZoteroContext;

    switch (record.extraction.recordType) {
      case 'works':
        return this.buildWorkActions(record.data as ZoteroWorkRecord, context);
      case 'annotations':
        return this.buildAnnotationActions(record.data as ZoteroAnnotationRecord, context);
      case 'attachments':
        return this.buildOrphanAttachmentActions(
          record.data as ZoteroOrphanAttachmentRecord,
          context
        );
      case 'notes':
        return this.buildNoteActions(record.data as ZoteroNoteRecord, context);
      default:
        return [];
    }
  }

  // ---------------------------------------------------------------------
  // Agent / realm
  // ---------------------------------------------------------------------

  /**
   * The library owner. The Zotero DB carries no name for the local user, only
   * the install-stable `localUserKey`, so that's the whole identity. Not
   * realm-scoped: a person is not a per-library thing.
   */
  private buildAgent(context: ZoteroContext): Person {
    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: context.localUserKey,
      sameAs: ['@me'],
    };
  }

  /**
   * The library's scope realm. Zotero item keys are only per-library unique,
   * so every item-keyed entity below (works, attachments, Quotations,
   * Comments, Collections) carries this in both its `@key` and `inRealm` —
   * the obsidian note-key precedent, applied to a db-local id instead of a
   * filename.
   */
  private buildRealm(context: ZoteroContext): Realm {
    return {
      '@type': 'Realm',
      '@key': ['@type', 'source', 'handle'],
      source: SOURCE,
      handle: context.library,
    };
  }

  // ---------------------------------------------------------------------
  // work
  // ---------------------------------------------------------------------

  private buildWorkActions(work: ZoteroWorkRecord, context: ZoteroContext): ActionAndChildren[] {
    const me = this.buildAgent(context);
    const workEntity = this.buildWorkEntity(work, context);
    const workRef = this.buildWorkRef(work.key, work.itemType, context, work.fields.title);

    // Zotero operates on the catalog-level work, not its files: one save
    // gesture, one BookmarkAction, object = the work. Files never get their
    // own save event — they enter the log only through viewing (below), so an
    // attachment never opened in the reader appears nowhere in the output.
    const actions: ActionAndChildren[] = [
      {
        '@type': 'BookmarkAction',
        '@key': ['@type', 'source', 'sourceId', 'object.inRealm.handle'],
        source: SOURCE,
        sourceId: work.key,
        timestamp: parseZoteroDate(work.dateAdded),
        agent: me,
        object: workEntity,
      } as BookmarkAction,
    ];

    for (const attachment of work.attachments) {
      if (attachment.lastRead) {
        // The file is what was actually opened (lastRead is its own
        // timestamp), so it's `object` — a sparse facet of the work, not a
        // separate entity (option B): `sameAs` collapses it onto the work,
        // so each viewing independently witnesses the merge regardless of
        // fold order.
        const facet = this.buildFileFacet(attachment, context, workRef);
        actions.push(this.buildViewAction(attachment.key, attachment.lastRead, facet, me));
      }
    }

    return actions;
  }

  /**
   * `lastRead` is a single overwritten "last opened" timestamp, not an
   * append-only log — key the timestamp itself in so each newly sighted
   * value lands as its own event instead of one event that moves in place.
   * It's `ViewAction`, not `ReadAction`: `ReadAction` opens a `consuming` run
   * that only a `CompleteAction` closes, and Zotero has no completion signal
   * — a `ReadAction` here would strand the work in an eternal
   * "currently reading" state. A single sighted open is one-shot
   * consumption; `ViewAction` is its honest weight.
   */
  private buildViewAction(
    sourceId: string,
    lastRead: number,
    object: EntityAndChildren,
    agent: Person
  ): ViewAction {
    return {
      '@type': 'ViewAction',
      '@key': ['@type', 'source', 'sourceId', 'object.inRealm.handle', 'timestamp'],
      source: SOURCE,
      sourceId,
      timestamp: new Date(lastRead * 1000),
      agent,
      object,
    };
  }

  private buildWorkEntity(work: ZoteroWorkRecord, context: ZoteroContext): CreativeWorkAndChildren {
    const type = mapWorkType(work.itemType);
    const { fields } = work;

    // A Zotero item key is unique only per library — the entity IS its key
    // scoped to the library realm; the type is a refinable attribute
    // (obsidian's note-key precedent: "a retag refines, never re-mints").
    const node: { [key: string]: unknown } = {
      '@type': type,
      '@key': ['source', 'sourceId', 'inRealm.handle'],
      source: SOURCE,
      sourceId: work.key,
      inRealm: this.buildRealm(context),
    };

    if (fields.title) node.name = fields.title;
    if (fields.abstractNote) node.description = fields.abstractNote;
    if (fields.date) node.datePublished = parseDatePublished(fields.date);
    // The zotero:// deep link is not the work's own address — it stays
    // derivable from (source, sourceId) — so `url` carries only a real web
    // address.
    if (fields.url) node.url = fields.url;

    // pageCount only exists on the Book branch of the schema.
    if (type === 'Book' && fields.numPages) {
      const pages = Number.parseInt(fields.numPages, 10);
      if (Number.isFinite(pages)) node.pageCount = pages;
    }

    if (fields.publisher) node.publisher = [this.buildPublisher(fields.publisher)];

    const { authors, creators } = this.buildCreators(work.creators);
    if (authors.length > 0) node.author = authors;
    if (creators.length > 0) node.creator = creators;

    const sameAs = this.buildWorkSameAs(work, type);
    if (sameAs.length > 0) node.sameAs = sameAs;

    const isPartOf = this.buildWorkIsPartOf(work, context);
    if (isPartOf.length > 0) node.isPartOf = isPartOf;

    const about = this.buildTags(work.tags);
    if (about.length > 0) node.about = about;

    // A crawl re-enumerates the work's full current collection membership and
    // tag set, so assert completeness on both: un-filing a work from a
    // collection or clearing a tag must close the old membership on the next
    // crawl (the goodreads/pinboard `@asserts` idiom for a snapshot source).
    node['@asserts'] = ['isPartOf', 'about'];

    return node as unknown as CreativeWorkAndChildren;
  }

  private buildPublisher(name: string): Organization {
    return {
      '@type': 'Organization',
      '@key': ['@type', 'source', 'name'],
      source: SOURCE,
      name,
    };
  }

  /**
   * Creators ordered by `orderIndex`. `author` credits the primary authors;
   * `editor`/`translator`/`contributor` (and any other credited role Zotero
   * reports) land in the generic `creator` bucket; `seriesEditor` is skipped
   * outright — it credits the series, not this work.
   */
  private buildCreators(creators: ZoteroCreator[]): {
    authors: (Person | Organization)[];
    creators: (Person | Organization)[];
  } {
    const authors: (Person | Organization)[] = [];
    const creatorsOut: (Person | Organization)[] = [];

    const ordered = [...creators].sort((a, b) => a.orderIndex - b.orderIndex);
    for (const creator of ordered) {
      if (creator.creatorType === 'seriesEditor') continue;
      const node = this.buildCreatorNode(creator);
      if (!node) continue;
      if (creator.creatorType === 'author') authors.push(node);
      else creatorsOut.push(node);
    }

    return { authors, creators: creatorsOut };
  }

  /** fieldMode 0 = two-field person; fieldMode 1 = single-field institution (name in lastName). */
  private buildCreatorNode(creator: ZoteroCreator): Person | Organization | undefined {
    if (creator.fieldMode === 1) {
      const name = creator.lastName?.trim();
      if (!name) return undefined;
      return {
        '@type': 'Organization',
        '@key': ['@type', 'source', 'name'],
        source: SOURCE,
        name,
      };
    }
    const name = [creator.firstName, creator.lastName]
      .filter((part): part is string => part !== null && part.trim().length > 0)
      .join(' ')
      .trim();
    if (!name) return undefined;
    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'name'],
      source: SOURCE,
      name,
    };
  }

  /**
   * Protocol `sameAs` edges (the goodreads idiom): each is an entity in the
   * other namespace, keyed there — type-free, since a DOI/ISBN/arXiv/PubMed
   * id names one work however a source typed it — carrying the work's title
   * as name so the edge still identifies the work if it's what mints it.
   * ISSN is handled separately (`buildPeriodical`) — it identifies the
   * periodical, not the work itself.
   */
  private buildWorkSameAs(work: ZoteroWorkRecord, type: WorkType): EntityAndChildren[] {
    const { fields } = work;
    const { title } = fields;
    const edges: EntityAndChildren[] = [];

    if (fields.DOI) {
      const doiEdge = this.buildDoiEdge(fields.DOI, type, title);
      if (doiEdge) edges.push(doiEdge);
    }

    // bookSection: Zotero stamps the containing BOOK's ISBN on every section
    // row — kept here it would merge different chapters of one book onto a
    // single isbn edge. Redirected onto a containing-book isPartOf entry
    // instead (see buildContainingBook), or dropped when there's no
    // bookTitle to hang it on.
    if (work.itemType !== 'bookSection' && fields.ISBN) {
      edges.push(...this.buildIsbnEdges(fields.ISBN, type, title));
    }

    edges.push(
      ...this.buildArxivSameAs(fields, type, title),
      ...this.buildPubmedSameAs(fields, type, title)
    );

    return edges;
  }

  /**
   * The DOI `sameAs` edge. Its own resolver url mints the url hub, so a
   * browser visit to the DOI link folds onto the work.
   */
  private buildDoiEdge(
    doiField: string,
    type: WorkType,
    title?: string
  ): EntityAndChildren | undefined {
    const doi = normalizeDoi(doiField);
    if (!doi) return undefined;
    const node: { [key: string]: unknown } = {
      '@type': type,
      '@key': ['source', 'sourceId'],
      source: 'doi',
      sourceId: doi,
      url: `https://doi.org/${doi}`,
    };
    if (title) node.name = title;
    return node as unknown as EntityAndChildren;
  }

  /** ISBN `sameAs` edges — the field can hold several space-separated ISBNs. */
  private buildIsbnEdges(isbnField: string, type: string, title?: string): EntityAndChildren[] {
    const edges: { [key: string]: unknown }[] = [];
    for (const token of isbnField.split(/\s+/).filter(Boolean)) {
      const isbn13 = toIsbn13(token);
      if (isbn13) {
        edges.push({
          '@type': type,
          '@key': ['source', 'sourceId'],
          source: 'isbn',
          sourceId: isbn13,
          ...(title && { name: title }),
        });
      }
    }
    return edges as unknown as EntityAndChildren[];
  }

  /**
   * arXiv `sameAs` edges, mined from up to three places and deduped by id:
   * `archiveID` (an `arXiv:<id>` prefix, or a bare id when `repository` says
   * arXiv), an `arXiv:<id>` line in the free-text `extra` field, and an
   * arXiv-minted DOI (`10.48550/arxiv.<id>`).
   */
  private buildArxivSameAs(
    fields: { [fieldName: string]: string },
    type: WorkType,
    title?: string
  ): EntityAndChildren[] {
    const ids = new Set<string>();

    const fromArchiveId = extractArxivFromArchiveId(fields.archiveID, fields.repository);
    if (fromArchiveId) ids.add(fromArchiveId);

    for (const id of extractArxivIdsFromExtra(fields.extra)) ids.add(id);

    const fromDoi = fields.DOI ? extractArxivIdFromDoi(normalizeDoi(fields.DOI)) : undefined;
    if (fromDoi) ids.add(fromDoi);

    return [...ids].map(id => {
      const node: { [key: string]: unknown } = {
        '@type': type,
        '@key': ['source', 'sourceId'],
        source: 'arxiv',
        sourceId: id,
        url: `https://arxiv.org/abs/${id}`,
      };
      if (title) node.name = title;
      return node as unknown as EntityAndChildren;
    });
  }

  /**
   * PMID/PMCID `sameAs` edges, mined from `PMID: <digits>` / `PMCID:
   * PMC<digits>` lines in the free-text `extra` field.
   */
  private buildPubmedSameAs(
    fields: { [fieldName: string]: string },
    type: WorkType,
    title?: string
  ): EntityAndChildren[] {
    const { extra } = fields;
    if (!extra) return [];

    const edges: { [key: string]: unknown }[] = [];

    const pmid = /PMID:\s*(\d+)/i.exec(extra);
    if (pmid) {
      edges.push({
        '@type': type,
        '@key': ['source', 'sourceId'],
        source: 'pubmed',
        sourceId: pmid[1],
        ...(title && { name: title }),
      });
    }

    const pmcid = /PMCID:\s*(PMC\d+)/i.exec(extra);
    if (pmcid) {
      edges.push({
        '@type': type,
        '@key': ['source', 'sourceId'],
        source: 'pmc',
        sourceId: pmcid[1],
        ...(title && { name: title }),
      });
    }

    return edges as unknown as EntityAndChildren[];
  }

  private buildWorkIsPartOf(work: ZoteroWorkRecord, context: ZoteroContext): EntityAndChildren[] {
    const { fields } = work;
    const isPartOf: EntityAndChildren[] = [];

    if (work.itemType === 'bookSection') {
      const containingBook = this.buildContainingBook(fields);
      if (containingBook) isPartOf.push(containingBook);
    }

    if (fields.publicationTitle) {
      isPartOf.push(this.buildPeriodical(fields.publicationTitle, fields.ISSN));
    }
    if (fields.series) {
      isPartOf.push({
        '@type': 'Collection',
        '@key': ['@type', 'source', 'name'],
        source: SOURCE,
        name: fields.series,
      });
    }
    for (const collection of work.collections) {
      isPartOf.push(this.buildCollectionNode(collection, context));
    }

    return isPartOf;
  }

  /**
   * The containing book of a bookSection, name-keyed (cross-library merge by
   * title is fine — same idiom as the periodical/series below) and carrying
   * the section's ISBN as its own `sameAs` edges, since that ISBN identifies
   * the book, not the section. No bookTitle → nothing honest to key the book
   * on, so the ISBN is dropped entirely (see buildWorkSameAs).
   */
  private buildContainingBook(fields: { [fieldName: string]: string }): CreativeWork | undefined {
    if (!fields.bookTitle) return undefined;
    const book: { [key: string]: unknown } = {
      '@type': 'Book',
      '@key': ['@type', 'source', 'name'],
      source: SOURCE,
      name: fields.bookTitle,
    };
    if (fields.ISBN) {
      const isbnEdges = this.buildIsbnEdges(fields.ISBN, 'Book', fields.bookTitle);
      if (isbnEdges.length > 0) book.sameAs = isbnEdges;
    }
    return book as unknown as CreativeWork;
  }

  /** The journal/magazine a work ran in. ISSN identifies IT, not the work. Name-keyed — not realm-scoped, cross-library merge by name is fine. */
  private buildPeriodical(publicationTitle: string, issnField?: string): CreativeWork {
    const periodical: CreativeWork = {
      '@type': 'CreativeWork',
      '@key': ['@type', 'source', 'name'],
      source: SOURCE,
      name: publicationTitle,
    };

    if (issnField) {
      const issns = issnField
        .split(',')
        .map(issn => issn.trim())
        .filter(Boolean);
      if (issns.length > 0) {
        periodical.sameAs = issns.map(issn => ({
          '@type': 'CreativeWork',
          '@key': ['source', 'sourceId'],
          source: 'issn',
          sourceId: issn,
          name: publicationTitle,
        }));
      }
    }

    return periodical;
  }

  /** A Zotero collection, realm-scoped (per-library keys), with its ancestor chain carried as nested `isPartOf`. */
  private buildCollectionNode(collection: ZoteroCollection, context: ZoteroContext): Collection {
    const node: Collection = {
      '@type': 'Collection',
      '@key': ['@type', 'source', 'sourceId', 'inRealm.handle'],
      source: SOURCE,
      sourceId: collection.key,
      name: collection.name,
      inRealm: this.buildRealm(context),
    };
    if (collection.parent) node.isPartOf = [this.buildCollectionNode(collection.parent, context)];
    return node;
  }

  private buildTags(tags: ZoteroTag[]): Tag[] {
    return tags.map(tag => ({
      '@type': 'Tag',
      '@key': ['@type', 'source', 'handle'],
      source: SOURCE,
      handle: tag.name,
    }));
  }

  /**
   * A child attachment as a SPARSE facet of its work, not a separate entity
   * (option B): the file merges INTO the work via `sameAs`, so it carries no
   * `name` of its own — the merged entity's name comes uncontested from the
   * work facet. `sameAs` is the collapsing edge — the work ref, plus the
   * filesystem node when this copy has one — replacing `instanceOf`, which
   * this transformer no longer emits anywhere.
   */
  private buildFileFacet(
    attachment: ZoteroAttachment,
    context: ZoteroContext,
    workRef: EntityAndChildren
  ): MediaObjectAndChildren {
    const type = mapAttachmentType(attachment.contentType);
    const node: { [key: string]: unknown } = {
      '@type': type,
      '@key': ['source', 'sourceId', 'inRealm.handle'],
      source: SOURCE,
      sourceId: attachment.key,
      inRealm: this.buildRealm(context),
    };

    if (attachment.contentType) node.mimeType = attachment.contentType;
    // The zotero://open-pdf deep link is not the attachment's own address —
    // it stays derivable from (source, sourceId) — so `url` carries only a
    // real web address (a linked-url/snapshot attachment's own url).
    if (attachment.url) node.url = attachment.url;

    const sameAs: EntityAndChildren[] = [workRef];

    // A shared carrier (the same file/path attached to several works — an
    // anthology PDF fanned across its chapter items) can't witness any one
    // work's copy: welding it in would collapse those distinct works through
    // the shared file. Withhold the carrier merge edges (filesystem sameAs,
    // contentPath) for a shared carrier; the work sameAs, mimeType, and url
    // still apply.
    if (attachment.resolvedPath && !attachment.sharedCarrier) {
      node.contentPath = attachment.resolvedPath;
      sameAs.push(this.buildFilesystemSameAs(attachment.resolvedPath, type, context.machine));
    }
    node.sameAs = sameAs;

    // linkMode 1 = an imported url snapshot: a captured copy of a web page,
    // not an arbitrary file — point it at the url hub it's a snapshot of
    // (the same edge browsing-history snapshots use), so the two auto-merge.
    if (attachment.linkMode === 1 && attachment.url) {
      node.snapshotOf = [{ '@type': 'Entity', '@key': ['url'], url: attachment.url }];
    }

    return node as unknown as MediaObjectAndChildren;
  }

  /**
   * A sparse reference to the file facet — used off the annotation record
   * (Quotation.isPartOf, the comment-only `about` fallback) so an anchored
   * selector records which copy it's valid in. No name (sparse, like the
   * facet); carries `sameAs: [work ref]` so an annotation arriving before
   * its work record still witnesses the merge.
   */
  private buildFileFacetRef(
    attachment: ZoteroAttachment,
    context: ZoteroContext,
    workRef: EntityAndChildren
  ): EntityAndChildren {
    const node: { [key: string]: unknown } = {
      '@type': mapAttachmentType(attachment.contentType),
      '@key': ['source', 'sourceId', 'inRealm.handle'],
      source: SOURCE,
      sourceId: attachment.key,
      inRealm: this.buildRealm(context),
      sameAs: [workRef],
    };
    return node as unknown as EntityAndChildren;
  }

  private buildFilesystemSameAs(
    resolvedPath: string,
    leafType: string,
    machine: string
  ): EntityAndChildren {
    const node: { [key: string]: unknown } = {
      '@type': leafType,
      '@key': ['source', 'handle', 'inRealm.handle'],
      source: 'filesystem',
      handle: resolvedPath,
      name: path.basename(resolvedPath),
      inRealm: {
        '@type': 'Realm',
        '@key': ['@type', 'source', 'handle'],
        source: 'hostname',
        handle: machine,
      },
    };
    return node as unknown as EntityAndChildren;
  }

  /** A slim, typed, named, realm-scoped reference to a work — used off actions that don't own the work's full state. */
  private buildWorkRef(
    key: string,
    itemType: string,
    context: ZoteroContext,
    title?: string
  ): EntityAndChildren {
    const node: { [key: string]: unknown } = {
      '@type': mapWorkType(itemType),
      '@key': ['source', 'sourceId', 'inRealm.handle'],
      source: SOURCE,
      sourceId: key,
      inRealm: this.buildRealm(context),
    };
    if (title) node.name = title;
    return node as unknown as EntityAndChildren;
  }

  /** A slim, typed, named, realm-scoped reference to an attachment (orphan-annotation subject, standalone-attachment ref). */
  private buildAttachmentRef(
    attachment: ZoteroAttachment,
    context: ZoteroContext
  ): EntityAndChildren {
    const node: { [key: string]: unknown } = {
      '@type': mapAttachmentType(attachment.contentType),
      '@key': ['source', 'sourceId', 'inRealm.handle'],
      source: SOURCE,
      sourceId: attachment.key,
      inRealm: this.buildRealm(context),
    };
    const name = attachmentDisplayName(attachment);
    if (name) node.name = name;
    return node as unknown as EntityAndChildren;
  }

  // ---------------------------------------------------------------------
  // annotation
  // ---------------------------------------------------------------------

  private buildAnnotationActions(
    annotation: ZoteroAnnotationRecord,
    context: ZoteroContext
  ): ActionAndChildren[] {
    const hasText = Boolean(annotation.text);
    const hasComment = Boolean(annotation.comment);
    if (!hasText && !hasComment) return [];

    const me = this.buildAgent(context);
    const realm = this.buildRealm(context);
    // Anchoring the selector on the file facet (not the work ref) records
    // which copy it's valid in; under the merge they resolve to the same
    // entity either way. Orphans have no work, so their subject stays the
    // attachment's own (named) entity.
    const workRef = annotation.work
      ? this.buildWorkRef(
          annotation.work.key,
          annotation.work.itemType,
          context,
          annotation.work.title
        )
      : undefined;
    const subjectRef = workRef
      ? this.buildFileFacetRef(annotation.attachment, context, workRef)
      : this.buildAttachmentRef(annotation.attachment, context);

    const actions: ActionAndChildren[] = [];
    let quotation: Quotation | undefined;

    if (hasText) {
      const style = ANNOTATION_STYLES[annotation.type];
      quotation = {
        '@type': 'Quotation',
        '@key': ['@type', 'source', 'sourceId', 'inRealm.handle'],
        source: SOURCE,
        sourceId: annotation.key,
        inRealm: realm,
        body: annotation.text as string,
        ...(annotation.color && { color: annotation.color }),
        ...(style && { annotationStyle: style }),
        isPartOf: [subjectRef],
      };
      const selector = this.buildSelector(annotation.position, annotation.pageLabel);
      if (selector) quotation.selector = [selector];

      actions.push({
        '@type': 'QuoteAction',
        '@key': ['@type', 'source', 'sourceId', 'result.inRealm.handle'],
        source: SOURCE,
        sourceId: annotation.key,
        timestamp: parseZoteroDate(annotation.dateAdded),
        agent: me,
        result: quotation,
      } as QuoteAction);
    }

    if (hasComment) {
      const comment: Comment = {
        '@type': 'Comment',
        '@key': ['@type', 'source', 'sourceId', 'inRealm.handle'],
        source: SOURCE,
        sourceId: annotation.key,
        inRealm: realm,
        description: annotation.comment as string,
        about: [quotation ?? subjectRef],
      };

      actions.push({
        '@type': 'AnnotateAction',
        '@key': ['@type', 'source', 'sourceId', 'result.inRealm.handle'],
        source: SOURCE,
        sourceId: annotation.key,
        timestamp: parseZoteroDate(annotation.dateAdded),
        agent: me,
        result: comment,
      } as AnnotateAction);
    }

    return actions;
  }

  /** Parses the raw `position` JSON defensively; omits the selector on any failure or unrecognized shape. */
  private buildSelector(
    positionJson: string,
    pageLabel: string | null
  ): SelectorAndChildren | undefined {
    let position: unknown;
    try {
      position = JSON.parse(positionJson);
    } catch {
      return undefined;
    }

    if (!position || typeof position !== 'object') return undefined;
    const pos = position as { pageIndex?: unknown; value?: unknown };

    // PDF: 0-based pageIndex → the 1-based page number readers display. Keyed
    // on its own value, like every selector (no source/sourceId — the
    // selector isn't its own identity-bearing subject).
    if (typeof pos.pageIndex === 'number') {
      const selector: SelectorAndChildren = {
        '@type': 'PageSelector',
        '@key': ['@type', 'selectorValue'],
        selectorValue: String(pos.pageIndex + 1),
      };
      if (pageLabel) selector.selectorLabel = pageLabel;
      return selector;
    }

    // EPUB: an EPUB CFI fragment selector.
    if (typeof pos.value === 'string' && pos.value.startsWith('epubcfi(')) {
      return {
        '@type': 'EpubCfiSelector',
        '@key': ['@type', 'selectorValue'],
        selectorValue: pos.value,
      };
    }

    return undefined;
  }

  // ---------------------------------------------------------------------
  // attachment (orphan)
  // ---------------------------------------------------------------------

  private buildOrphanAttachmentActions(
    attachment: ZoteroOrphanAttachmentRecord,
    context: ZoteroContext
  ): ActionAndChildren[] {
    const me = this.buildAgent(context);
    const entity = this.buildStandaloneAttachmentEntity(attachment, context);

    // An orphan attachment IS the catalog item — no work sits above it — so,
    // unlike a child attachment, it gets its own BookmarkAction. Its
    // ViewAction's object is the same slim attachment ref either way.
    const actions: ActionAndChildren[] = [
      {
        '@type': 'BookmarkAction',
        '@key': ['@type', 'source', 'sourceId', 'object.inRealm.handle'],
        source: SOURCE,
        sourceId: attachment.key,
        timestamp: parseZoteroDate(attachment.dateAdded),
        agent: me,
        object: entity,
      } as BookmarkAction,
    ];

    if (attachment.lastRead) {
      actions.push(
        this.buildViewAction(
          attachment.key,
          attachment.lastRead,
          this.buildAttachmentRef(attachment, context),
          me
        )
      );
    }

    return actions;
  }

  /**
   * A standalone (orphan) attachment: unlike a child attachment it IS the
   * catalog item, not a facet of anything — its own named entity (via the
   * display-name heuristic), unconditional filesystem `sameAs` (orphans
   * never set `sharedCarrier`), plus its own collections/tags.
   */
  private buildStandaloneAttachmentEntity(
    attachment: ZoteroOrphanAttachmentRecord,
    context: ZoteroContext
  ): MediaObjectAndChildren {
    const type = mapAttachmentType(attachment.contentType);
    const node: { [key: string]: unknown } = {
      '@type': type,
      '@key': ['source', 'sourceId', 'inRealm.handle'],
      source: SOURCE,
      sourceId: attachment.key,
      inRealm: this.buildRealm(context),
    };

    const name = attachmentDisplayName(attachment);
    if (name) node.name = name;
    if (attachment.contentType) node.mimeType = attachment.contentType;
    if (attachment.resolvedPath) node.contentPath = attachment.resolvedPath;
    // The zotero://open-pdf deep link is not the attachment's own address —
    // it stays derivable from (source, sourceId) — so `url` carries only a
    // real web address (a linked-url/snapshot attachment's own url).
    if (attachment.url) node.url = attachment.url;

    // linkMode 1 = an imported url snapshot: a captured copy of a web page,
    // not an arbitrary file — point it at the url hub it's a snapshot of
    // (the same edge browsing-history snapshots use), so the two auto-merge.
    if (attachment.linkMode === 1 && attachment.url) {
      node.snapshotOf = [{ '@type': 'Entity', '@key': ['url'], url: attachment.url }];
    }

    // The attachment stays PRIMARILY keyed on its Zotero (source, sourceId,
    // inRealm.handle): that identity is portable across machines under
    // Zotero storage sync, while a filesystem path is per-machine. Each
    // machine's crawl contributes its own filesystem `sameAs` edge, matching
    // timing's `buildResource`/`buildRealm` keyset exactly so a timing
    // app-session on the same file folds onto this attachment.
    if (attachment.resolvedPath) {
      node.sameAs = [this.buildFilesystemSameAs(attachment.resolvedPath, type, context.machine)];
    }

    const isPartOf = attachment.collections.map(collection =>
      this.buildCollectionNode(collection, context)
    );
    if (isPartOf.length > 0) node.isPartOf = isPartOf;

    const about = this.buildTags(attachment.tags);
    if (about.length > 0) node.about = about;

    // Same snapshot-source completeness idiom as the work entity: a crawl
    // re-enumerates this attachment's full collection membership and tags.
    node['@asserts'] = ['isPartOf', 'about'];

    return node as unknown as MediaObjectAndChildren;
  }

  // ---------------------------------------------------------------------
  // note
  // ---------------------------------------------------------------------

  /**
   * A Zotero note item — an HTML note written on a work (child) or standing
   * alone in the library — becomes an AnnotateAction over a Comment. Unlike
   * a highlight-comment (which shares its parent annotation's key), this
   * Comment is keyed on the note item's OWN key; the keyset shape is
   * identical either way, so there's no collision.
   */
  private buildNoteActions(note: ZoteroNoteRecord, context: ZoteroContext): ActionAndChildren[] {
    const me = this.buildAgent(context);

    const comment: Comment = {
      '@type': 'Comment',
      '@key': ['@type', 'source', 'sourceId', 'inRealm.handle'],
      source: SOURCE,
      sourceId: note.key,
      inRealm: this.buildRealm(context),
      // Zotero's own HTML, wrapper divs included, verbatim — the source
      // truth; a display layer may strip it, the transformer never does.
      body: note.note,
    };
    if (note.title) comment.name = note.title;
    if (note.work) {
      comment.about = [
        this.buildWorkRef(note.work.key, note.work.itemType, context, note.work.title),
      ];
    }

    return [
      {
        '@type': 'AnnotateAction',
        '@key': ['@type', 'source', 'sourceId', 'result.inRealm.handle'],
        source: SOURCE,
        sourceId: note.key,
        timestamp: parseZoteroDate(note.dateAdded),
        agent: me,
        result: comment,
      } as AnnotateAction,
    ];
  }
}
