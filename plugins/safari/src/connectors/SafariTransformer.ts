import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  BookmarkAction,
  Collection,
  Entity,
  ViewAction,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/apple';
import type { Bookmark } from './SafariBookmarksExtractor.js';

export default class SafariTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'views') {
      actions.push(...(await this.buildViewActions(record)));
    } else if (record.extraction.recordType === 'bookmarks') {
      actions.push(await this.buildBookmarkAction(record));
    }

    return actions;
  }

  private async buildViewActions(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    const user = await buildICloudPersonSchema(record.context.account);
    const webpage: Entity = this.buildWebPage(record);

    // Create a ViewAction for the browser visit
    const viewAction: ViewAction = {
      '@type': 'ViewAction',
      timestamp: new Date(record.data.unix_timestamp * 1000),
      '@key': ['@type', 'source', 'timestamp'],
      source: 'safari',
      // Without an iCloud account the viewer can't be identified, so omit them.
      ...(user && { agent: user }),
      object: webpage,
    };

    actions.push(viewAction);

    return actions;
  }

  // A bookmark, a favorite, and a Reading List item are each a page saved to
  // a folder: the folder is the target, and a favorite's is Favorites.
  private async buildBookmarkAction(record: Record): Promise<BookmarkAction> {
    const bookmark = record.data as Bookmark;
    const user = await buildICloudPersonSchema(record.context.account);
    let target: Collection | undefined;
    for (const folder of bookmark.folders) {
      target = {
        '@type': 'Collection',
        '@key': ['@type', 'source', 'sourceId'],
        source: 'safari',
        sourceId: folder.id,
        name: folder.name,
        ...(target && { isPartOf: [target] }),
      };
    }

    return {
      '@type': 'BookmarkAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'safari',
      sourceId: bookmark.id,
      ...(bookmark.addedAt && { timestamp: new Date(bookmark.addedAt) }),
      ...(user && { agent: user }),
      object: this.buildWebPage(record),
      ...(target && { target }),
    };
  }

  private buildWebPage(record: Record): Entity {
    return {
      '@type': 'Entity',
      '@key': ['url'],
      url: record.data.url,
      name: record.data.title || record.data.url,
    };
  }
}
