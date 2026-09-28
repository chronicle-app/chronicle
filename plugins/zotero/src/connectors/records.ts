/**
 * The raw-record contract between ZoteroExtractor and ZoteroTransformer.
 *
 * The extractor walks the `items` spine of `zotero.sqlite` (Zotero 7 schema)
 * and emits four record types, each a self-contained denormalization of the
 * joins the transformer needs — the transformer never touches the database.
 *
 * All `dateAdded`/`dateModified` values are Zotero's UTC `YYYY-MM-DD HH:MM:SS`
 * strings, passed through verbatim.
 */

/** One creator row from `itemCreators` → `creators` → `creatorTypes`. */
export interface ZoteroCreator {
  firstName: string | null;
  lastName: string | null;
  /** 0 = two-field (person), 1 = single-field (institution; name in lastName). */
  fieldMode: number;
  /** Zotero role: author, editor, translator, contributor, seriesEditor, … */
  creatorType: string;
  orderIndex: number;
}

/** A collection with its ancestor chain resolved (root has no parent). */
export interface ZoteroCollection {
  /** 8-char collection key — the collection's sourceId. */
  key: string;
  name: string;
  parent?: ZoteroCollection;
}

export interface ZoteroTag {
  name: string;
  /** 0 = manual, 1 = automatic. */
  type: number;
}

/** An attachment row (child of a work, or standalone when orphaned). */
export interface ZoteroAttachment {
  /** 8-char item key — the attachment's sourceId and its storage folder name. */
  key: string;
  /** 0 imported file, 1 imported url snapshot, 2 linked file, 3 linked url. */
  linkMode: number;
  contentType: string | null;
  /** Raw `itemAttachments.path` (e.g. `storage:Paper.pdf`), if any. */
  path: string | null;
  /**
   * Absolute path to the file on disk, resolved by the extractor:
   * `storage:` paths resolve to `{dataDir}/storage/{key}/{filename}`; linked
   * files (linkMode 2) pass through their absolute path. Unresolvable
   * (linked-url, relative linked) attachments leave this unset.
   */
  resolvedPath?: string;
  /** The attachment item's own `title` field, when set. */
  title?: string;
  /** The attachment item's own `url` field (linked-url and snapshot sources). */
  url?: string;
  /** Unix seconds of the last open in the Zotero reader, when recorded. */
  lastRead?: number;
  /**
   * Set when this attachment's carrier (its resolved path, or its file's
   * content hash) also appears under a DIFFERENT parent work — e.g. one
   * anthology PDF attached to several chapter items. A shared carrier cannot
   * witness a single work, so the transformer withholds its carrier merge
   * edges (filesystem `sameAs`, `contentPath`) to keep distinct works from
   * welding through the shared file. Orphans never set this.
   */
  sharedCarrier?: boolean;
  dateAdded: string;
}

/**
 * `work` record — a top-level reference item (journalArticle, book, …) with
 * its EAV fields reconstructed and creators/collections/tags/attachments
 * joined in.
 */
export interface ZoteroWorkRecord {
  /** 8-char item key — the work's sourceId. */
  key: string;
  /** Zotero item type name: journalArticle, book, bookSection, preprint, … */
  itemType: string;
  dateAdded: string;
  dateModified: string;
  /**
   * The work's fields from the `itemData` EAV join, keyed by Zotero field
   * name (title, abstractNote, date, publisher, numPages, url, DOI, ISBN,
   * ISSN, publicationTitle, series, …), values verbatim.
   */
  fields: { [fieldName: string]: string };
  creators: ZoteroCreator[];
  collections: ZoteroCollection[];
  tags: ZoteroTag[];
  attachments: ZoteroAttachment[];
}

/** Slim parent-work context carried on annotation records. */
export interface ZoteroWorkRef {
  key: string;
  itemType: string;
  title?: string;
}

/**
 * `annotation` record — one row of `itemAnnotations` (a highlight, underline,
 * or note made in the Zotero reader) with its attachment and work context.
 */
export interface ZoteroAnnotationRecord {
  /** 8-char item key of the annotation — its sourceId. */
  key: string;
  /** Zotero annotation type: 1 highlight, 2 note, 3 image, 4 ink, 5 underline, 6 text. */
  type: number;
  /** The highlighted passage, if any. */
  text: string | null;
  /** The user's note on the annotation, if any. */
  comment: string | null;
  /** Highlight color as hex, e.g. `#ffd400`. */
  color: string | null;
  /** Human page label, e.g. `1412` (PDF only). */
  pageLabel: string | null;
  sortIndex: string;
  /**
   * Raw `position` JSON. PDF: `{"pageIndex":0,"rects":[…]}`. EPUB:
   * `{"type":"FragmentSelector","value":"epubcfi(…)"}`.
   */
  position: string;
  /** 1 when the annotation was embedded in the file rather than made in Zotero. */
  isExternal: number;
  /** Author of the annotation in group contexts; null for the local user. */
  authorName: string | null;
  dateAdded: string;
  dateModified: string;
  /** The attachment the annotation lives in. */
  attachment: ZoteroAttachment;
  /** The attachment's parent work; absent for annotations on orphan attachments. */
  work?: ZoteroWorkRef;
}

/**
 * `attachment` record — an orphan attachment (no parent work): a standalone
 * file saved directly to the library.
 */
export interface ZoteroOrphanAttachmentRecord extends ZoteroAttachment {
  dateModified: string;
  tags: ZoteroTag[];
  collections: ZoteroCollection[];
}

/**
 * `note` record — a Zotero note item: an HTML note written on a work (child
 * note) or standing alone in the library.
 */
export interface ZoteroNoteRecord {
  /** 8-char item key of the note — its sourceId. */
  key: string;
  /** Zotero's derived display title (the note's first line). */
  title: string | null;
  /** The note body, verbatim Zotero HTML. */
  note: string;
  dateAdded: string;
  dateModified: string;
  /** The parent work; absent for standalone notes. */
  work?: ZoteroWorkRef;
}

/** Per-record context: the library's identity, its owner, and this machine. */
export interface ZoteroContext {
  recordType: 'works' | 'annotations' | 'attachments' | 'notes';
  /** `settings.account.localUserKey` — present even without a zotero.org account. */
  localUserKey: string;
  /**
   * The library's scope handle — the `inRealm` disambiguator for item-keyed
   * entities, since Zotero item keys are only per-library unique. The
   * zotero.org `userID` when the library has synced (globally stable, the same
   * on every machine), else the `localUserKey`.
   */
  library: string;
  /**
   * The normalized short name of the machine this library lives on
   * (`SystemInfo.getMachineName()`) — the `inRealm` scope for
   * filesystem-keyed file identities, matching the timing/shell realm.
   */
  machine: string;
}
