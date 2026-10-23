import { readFile, stat } from 'node:fs/promises';
import { Extractor, Record, fileError } from '@chronicle.app/etl';
import { APPLE_EPOCH_OFFSET_SECONDS } from '@chronicle.app/etl-sqlite';
import { getICloudAccount, parseBinaryPlist, Uid, type PlistValue } from '@chronicle.app/apple';
import { z } from 'zod';
import { accountOption } from './SafariExtractor.js';
import SafariTransformer from './SafariTransformer.js';

/** A folder a bookmark is in. */
export interface BookmarkFolder {
  id: string;
  name: string;
}

/** A bookmark, a favorite, or a Reading List item. */
export interface Bookmark {
  id: string;
  url: string;
  title: string | null;
  /** When it was saved (ISO), or null when Safari doesn't say. */
  addedAt: string | null;
  /** The folders it's in, outermost first. */
  folders: BookmarkFolder[];
}

type Node = { [key: string]: PlistValue };

// The folders Safari makes, by the names its sidebar gives them.
const FOLDER_NAMES: { [title: string]: string } = {
  BookmarksBar: 'Favorites',
  BookmarksMenu: 'Bookmarks Menu',
  'com.apple.ReadingList': 'Reading List',
};

const isNode = (value: PlistValue | undefined): value is Node =>
  Boolean(value) &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  !(value instanceof Date) &&
  !(value instanceof Uint8Array) &&
  !(value instanceof Uid);

const text = (value: PlistValue | undefined) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const date = (value: PlistValue | undefined) => (value instanceof Date ? value : null);

const savedAt = (bookmark: Bookmark) => (bookmark.addedAt ? Date.parse(bookmark.addedAt) : null);

/** Follow keys from an NSKeyedArchiver archive's `$top`, through its references. */
function unarchive(bytes: Uint8Array, ...keys: string[]): PlistValue | undefined {
  const plist = parseBinaryPlist(bytes);
  if (!isNode(plist) || !Array.isArray(plist.$objects)) return undefined;
  const objects = plist.$objects;
  const deref = (value: PlistValue | undefined) =>
    value instanceof Uid ? objects[value.index] : value;
  let value: PlistValue | undefined = plist.$top;
  for (const key of keys) {
    const object = deref(value);
    if (!isNode(object)) return undefined;
    value = object[key];
  }
  return deref(value);
}

/**
 * When iCloud made the record of a bookmark, from the CloudKit record Safari
 * keeps in its `Sync.Data`. Null without iCloud, or if it doesn't read.
 */
function recordCreated(data: PlistValue | undefined): Date | null {
  if (!(data instanceof Uint8Array)) return null;
  try {
    const fields = unarchive(data, 'root', 'EncodedCKRecordSystemFields', 'NS.data');
    if (!(fields instanceof Uint8Array)) return null;
    const time = unarchive(fields, 'RecordCtime', 'NS.time');
    return typeof time === 'number' ? new Date((time + APPLE_EPOCH_OFFSET_SECONDS) * 1000) : null;
  } catch {
    return null;
  }
}

export class SafariBookmarksExtractor extends Extractor<typeof SafariBookmarksExtractor> {
  static override source = 'safari';
  static override delivery = 'local' as const;
  static override strategy = 'app-db';
  static override description = 'Bookmarks, favorites, and Reading List';
  static override default = true;
  static override recordTypes = ['bookmarks'];
  // Bookmarks.plist holds what's saved now, in the folder it's in now. See
  // Extractor.temporality.
  static override temporality = 'snapshot' as const;
  static override schema = Extractor.schema.extend({
    bookmarksFile: z
      .string()
      .describe('Path to Safari Bookmarks.plist')
      .default(`${process.env.HOME}/Library/Safari/Bookmarks.plist`),
    account: accountOption,
  });

  static override defaultTransformer = SafariTransformer;

  private bookmarks: Bookmark[] = [];
  private changed: Date | undefined;

  override async setup(): Promise<void> {
    await super.setup();
    const path = this.config.bookmarksFile;
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
      this.changed = (await stat(path)).mtime;
    } catch (error) {
      throw fileError(error, path, 'bookmarks file');
    }
    this.bookmarks = this.read(parseBinaryPlist(bytes));
  }

  /**
   * When the bookmarks last changed, not when the run started, so a re-read of
   * unchanged bookmarks comes out the same.
   */
  protected override asOfTime(): Date {
    return this.changed ?? super.asOfTime();
  }

  /** The bookmark's CloudKit record name, the same on each device, or its ID on this Mac. */
  override keyOf(record: Record): string | null {
    return (record.data as Bookmark).id;
  }

  override occurredAt(record: Record): Date | undefined {
    const { addedAt } = record.data as Bookmark;
    return addedAt ? new Date(addedAt) : undefined;
  }

  async *extract(): AsyncGenerator<Record> {
    const { since, until } = this.config;
    const limit = this.getEffectiveLimit();
    const undated = Number.NEGATIVE_INFINITY;
    // Newest first, then those with no date. A bound leaves out those with none.
    const bookmarks = this.bookmarks
      .filter(bookmark => {
        if (!since && !until) return true;
        const at = savedAt(bookmark);
        return at !== null && (!since || at > since.getTime()) && (!until || at < until.getTime());
      })
      .sort((a, b) => (savedAt(b) ?? undated) - (savedAt(a) ?? undated));

    const account =
      this.config.account === undefined ? await getICloudAccount() : this.config.account;

    for (const bookmark of bookmarks.slice(0, limit ?? undefined)) {
      yield this.createRecord(bookmark, { source: 'safari', account });
    }
  }

  /** Every bookmark in the file, with when it was saved where Safari says. */
  private read(root: PlistValue): Bookmark[] {
    const found: { node: Node; folders: BookmarkFolder[]; created: Date | null }[] = [];
    const walk = (node: Node, folders: BookmarkFolder[]) => {
      for (const child of Array.isArray(node.Children) ? node.Children : []) {
        if (!isNode(child)) continue;
        if (child.WebBookmarkType === 'WebBookmarkTypeList') {
          const title = text(child.Title) ?? '';
          walk(child, [...folders, { id: this.idOf(child), name: FOLDER_NAMES[title] ?? title }]);
        } else if (child.WebBookmarkType === 'WebBookmarkTypeLeaf' && text(child.URLString)) {
          found.push({
            node: child,
            folders,
            created: recordCreated(isNode(child.Sync) ? child.Sync.Data : undefined),
          });
        }
      }
    };
    if (isNode(root)) walk(root, []);

    // iCloud makes records together when it uploads bookmarks it already had,
    // such as on a new Mac or after a reset, and then that time isn't when any
    // of them was saved. Pages saved one at a time never share a second.
    const second = (at: Date) => Math.floor(at.getTime() / 1000);
    const together = new Map<number, number>();
    for (const { created } of found) {
      if (created) together.set(second(created), (together.get(second(created)) ?? 0) + 1);
    }

    return found.map(({ node, folders, created }) => {
      const id = this.idOf(node);
      const readingList = isNode(node.ReadingList) ? node.ReadingList : {};
      // A record named `DAV-` came over from iCloud's older bookmark sync, and
      // was made when it did.
      const madeInICloud =
        created && !id.startsWith('DAV-') && together.get(second(created)) === 1 ? created : null;
      const addedAt = date(readingList.DateAdded) ?? date(node.dateAdded) ?? madeInICloud;
      const uri = isNode(node.URIDictionary) ? node.URIDictionary : {};
      return {
        id,
        url: text(node.URLString)!,
        title: text(uri.title),
        addedAt: addedAt?.toISOString() ?? null,
        folders,
      };
    });
  }

  private idOf(node: Node): string {
    return (isNode(node.Sync) && text(node.Sync.ServerID)) || String(node.WebBookmarkUUID);
  }
}
