import { allRows, iterateRows } from '@chronicle.app/etl-sqlite';
import { CoreDataStore, appleDate, changed } from './coredata.js';

/**
 * What Photos' change log says happened to the library and when. Core Data
 * keeps a transaction for every save (`ATRANSACTION`), with when it was made,
 * and a row for each object it changed (`ACHANGE`), with a bitmask of the
 * properties it changed (`ZCOLUMNS`). The bits are looked up by property name
 * in the store's own model, since they move between macOS versions.
 *
 * A change made on this Mac is dated when it was made. A change made on
 * another device arrives from iCloud, and is dated when this Mac received
 * it: usually soon after, but later if the Mac was asleep.
 */
export interface History {
  /** When each asset's favorite flag changed, oldest first, by the asset's row. */
  favorites: Map<number, string[]>;
  /** When a person changed an asset's caption or title. */
  edits: Array<{ asset: number; what: 'caption' | 'title'; time: string }>;
  /** When an asset was added to an album it's in now. */
  albumAdds: Array<{ asset: number; album: number; time: string }>;
}

// ZCHANGETYPE
const INSERT = 0;
const UPDATE = 1;

interface ChangeRow {
  tx: number;
  entity: number;
  pk: number;
  type: number;
  columns: Uint8Array | null;
  time: number | null;
}

/**
 * Read the change log, or null when the library keeps none or its model
 * can't be read. `membership` is which album each asset is in now, as
 * `album/asset` rows.
 */
export function readHistory(store: CoreDataStore, membership: Set<string>): History | null {
  if (store.columns('ACHANGE').size === 0 || store.columns('ATRANSACTION').size === 0) return null;
  const entity = {
    asset: store.entity('Asset'),
    album: store.entity('Album'),
    description: store.entity('AssetDescription'),
    attributes: store.entity('AdditionalAssetAttributes'),
  };
  const slots = {
    asset: store.changeSlots('Asset'),
    album: store.changeSlots('Album'),
    description: store.changeSlots('AssetDescription'),
    attributes: store.changeSlots('AdditionalAssetAttributes'),
  };
  if (Object.values(entity).includes(null) || Object.values(slots).includes(null)) return null;
  const favorite = slots.asset!.get('favorite');
  const albums = slots.asset!.get('albums');
  const albumAssets = slots.album!.get('assets');
  const caption = slots.description!.get('longDescription');
  const title = slots.attributes!.get('title');

  // A caption and a title are on rows of their own, which belong to an asset.
  const assetOfAttributes = new Map(
    allRows<{ pk: number; asset: number | null }>(
      store.db.prepare('SELECT Z_PK AS pk, ZASSET AS asset FROM ZADDITIONALASSETATTRIBUTES')
    ).map(row => [row.pk, row.asset])
  );
  const attributesOfDescription = new Map(
    allRows<{ pk: number; attributes: number | null }>(
      store.db.prepare('SELECT Z_PK AS pk, ZASSETATTRIBUTES AS attributes FROM ZASSETDESCRIPTION')
    ).map(row => [row.pk, row.attributes])
  );
  const assetOfDescription = (pk: number) =>
    assetOfAttributes.get(attributesOfDescription.get(pk) ?? -1) ?? null;

  const history: History = { favorites: new Map(), edits: [], albumAdds: [] };

  // One transaction's changes, gathered until the next one starts.
  let current: number | null = null;
  let time: string | null = null;
  let inserted = new Set<number>();
  let favorited: number[] = [];
  let regrouped: number[] = [];
  let changedAlbums: number[] = [];
  let captions: Array<{ pk: number; inserted: boolean }> = [];
  let titles: number[] = [];

  const finish = () => {
    if (current === null || time === null) return;
    for (const asset of favorited) {
      const times = history.favorites.get(asset) ?? [];
      times.push(time);
      history.favorites.set(asset, times);
    }
    for (const { pk, inserted: isNew } of captions) {
      const asset = assetOfDescription(pk);
      // A caption that arrives with its photo, such as on import, isn't an edit.
      if (asset !== null && !(isNew && inserted.has(asset))) {
        history.edits.push({ asset, what: 'caption', time });
      }
    }
    for (const pk of titles) {
      const asset = assetOfAttributes.get(pk);
      if (asset !== undefined && asset !== null) history.edits.push({ asset, what: 'title', time });
    }
    // Adding photos to an album changes both: the album's photos and each
    // photo's albums. A photo added to one of several albums changed together
    // was added to whichever of them it's in now.
    for (const asset of regrouped) {
      for (const album of changedAlbums) {
        if (membership.has(`${album}/${asset}`)) history.albumAdds.push({ asset, album, time });
      }
    }
  };

  const rows = iterateRows<ChangeRow>(
    store.db.prepare(`
      SELECT c.ZTRANSACTIONID AS tx, c.ZENTITY AS entity, c.ZENTITYPK AS pk,
        c.ZCHANGETYPE AS type, c.ZCOLUMNS AS columns, t.ZTIMESTAMP AS time
      FROM ACHANGE c JOIN ATRANSACTION t ON t.Z_PK = c.ZTRANSACTIONID
      WHERE c.ZENTITY IN (?, ?, ?, ?) AND c.ZCHANGETYPE IN (${INSERT}, ${UPDATE})
      ORDER BY c.Z_PK`),
    entity.asset,
    entity.album,
    entity.description,
    entity.attributes
  );
  for (const row of rows) {
    if (row.tx !== current) {
      finish();
      current = row.tx;
      time = appleDate(row.time);
      inserted = new Set();
      favorited = [];
      regrouped = [];
      changedAlbums = [];
      captions = [];
      titles = [];
    }
    const updated = row.type === UPDATE;
    switch (row.entity) {
      case entity.asset:
        if (!updated) inserted.add(row.pk);
        if (updated && changed(row.columns, favorite)) favorited.push(row.pk);
        if (updated && changed(row.columns, albums)) regrouped.push(row.pk);
        break;
      case entity.album:
        if (updated && changed(row.columns, albumAssets)) changedAlbums.push(row.pk);
        break;
      case entity.description:
        if (!updated || changed(row.columns, caption)) {
          captions.push({ pk: row.pk, inserted: !updated });
        }
        break;
      case entity.attributes:
        if (updated && changed(row.columns, title)) titles.push(row.pk);
        break;
    }
  }
  finish();
  return history;
}
