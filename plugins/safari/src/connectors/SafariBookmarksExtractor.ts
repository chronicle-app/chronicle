import { readFile, stat } from 'node:fs/promises';
import { Extractor, Record, fileError } from '@chronicle.app/etl';
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
    const bookmarks: Bookmark[] = [];
    const walk = (node: Node, folders: BookmarkFolder[]) => {
      for (const child of Array.isArray(node.Children) ? node.Children : []) {
        if (!isNode(child)) continue;
        if (child.WebBookmarkType === 'WebBookmarkTypeList') {
          const title = text(child.Title) ?? '';
          walk(child, [...folders, { id: this.idOf(child), name: FOLDER_NAMES[title] ?? title }]);
        } else if (child.WebBookmarkType === 'WebBookmarkTypeLeaf' && text(child.URLString)) {
          const readingList = isNode(child.ReadingList) ? child.ReadingList : {};
          const uri = isNode(child.URIDictionary) ? child.URIDictionary : {};
          // Safari dates bookmarks it saves now, but not those from before.
          const addedAt = date(readingList.DateAdded) ?? date(child.dateAdded);
          bookmarks.push({
            id: this.idOf(child),
            url: text(child.URLString)!,
            title: text(uri.title),
            addedAt: addedAt?.toISOString() ?? null,
            folders,
          });
        }
      }
    };
    if (isNode(root)) walk(root, []);
    return bookmarks;
  }

  private idOf(node: Node): string {
    return (isNode(node.Sync) && text(node.Sync.ServerID)) || String(node.WebBookmarkUUID);
  }
}
