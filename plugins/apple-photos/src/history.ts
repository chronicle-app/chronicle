import { allRows, iterateRows } from '@chronicle.app/etl-sqlite';
import { CoreDataStore, appleDate, changed } from './coredata.js';
import { clean } from './library.js';

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
 *
 * A photo that was in the library before this Mac had it, such as when the
 * library is rebuilt from iCloud, arrives first, and its albums, favorite,
 * caption, and title follow it over the next hour or so, in transactions of
 * their own. A change to such a photo within a day of it arriving is it
 * arriving, not something you did then, so it's left out.
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

const DAY = 86_400;

interface ChangeRow {
  tx: number;
  entity: number;
  pk: number;
  type: number;
  columns: Uint8Array | null;
  time: number | null;
}

/**
 * Read the change log, or null when the library keeps none, or its model
 * can't be read or lacks a property it's read by. `added` is when each asset
 * was added to the library (`ZADDEDDATE`), by its row, and `membership` is
 * which album each asset is in now, as `album/asset` rows. Without
 * `membership`, only favorites are read, from the assets' own changes.
 */
export function readHistory(
  store: CoreDataStore,
  { added, membership }: { added: Map<number, number | null>; membership?: Set<string> }
): History | null {
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
  // A property the model doesn't have, such as one a macOS release renamed,
  // would never show as changed.
  if ([favorite, albums, albumAssets, caption, title].includes(undefined)) return null;

  // A caption and a title are on rows of their own, which belong to an asset.
  // They're read the first time a change needs them.
  let owners: ReturnType<typeof readOwners> | undefined;
  const ownersOf = () => {
    owners ??= readOwners(store);
    return owners;
  };
  const assetOfAttributes = (pk: number) => ownersOf().assetOfAttributes.get(pk) ?? null;
  const assetOfDescription = (pk: number) =>
    assetOfAttributes(ownersOf().attributesOfDescription.get(pk) ?? -1);

  // When each asset arrived on this Mac, as its insert dates it, by its row.
  const arrived = new Map<number, number>();
  // Whether a change at `seconds` is the asset arriving: within a day of the
  // insert of a photo that was in the library a day before.
  const arriving = (asset: number, seconds: number) => {
    const at = arrived.get(asset);
    const inLibrary = added.get(asset);
    if (at === undefined || typeof inLibrary !== 'number') return false;
    return at - inLibrary > DAY && seconds - at < DAY;
  };

  const history: History = { favorites: new Map(), edits: [], albumAdds: [] };

  // One transaction's changes, gathered until the next one starts.
  let current: number | null = null;
  let seconds: number | null = null;
  let time: string | null = null;
  let inserted = new Set<number>();
  let favorited: number[] = [];
  let regrouped: number[] = [];
  let changedAlbums: number[] = [];
  let captions: Array<{ pk: number; inserted: boolean }> = [];
  let titles: number[] = [];

  const finish = () => {
    if (current === null || seconds === null || time === null) return;
    const at = seconds;
    for (const asset of favorited) {
      if (arriving(asset, at)) continue;
      const times = history.favorites.get(asset) ?? [];
      times.push(time);
      history.favorites.set(asset, times);
    }
    for (const { pk, inserted: isNew } of captions) {
      const asset = assetOfDescription(pk);
      if (asset === null || arriving(asset, at)) continue;
      // A caption that arrives with its photo, such as on import, isn't an
      // edit, and nor is a caption's row added with nothing in it.
      if (isNew && (inserted.has(asset) || !ownersOf().captioned.has(pk))) continue;
      history.edits.push({ asset, what: 'caption', time });
    }
    for (const pk of titles) {
      const asset = assetOfAttributes(pk);
      if (asset === null || arriving(asset, at)) continue;
      history.edits.push({ asset, what: 'title', time });
    }
    // Adding photos to an album changes both: the album's photos and each
    // photo's albums. A photo added to one of several albums changed together
    // was added to whichever of them it's in now.
    for (const asset of regrouped) {
      if (arriving(asset, at)) continue;
      for (const album of changedAlbums) {
        if (membership?.has(`${album}/${asset}`)) history.albumAdds.push({ asset, album, time });
      }
    }
  };

  const read = membership
    ? [entity.asset!, entity.album!, entity.description!, entity.attributes!]
    : [entity.asset!];
  const rows = iterateRows<ChangeRow>(
    store.db.prepare(`
      SELECT c.ZTRANSACTIONID AS tx, c.ZENTITY AS entity, c.ZENTITYPK AS pk,
        c.ZCHANGETYPE AS type, c.ZCOLUMNS AS columns, t.ZTIMESTAMP AS time
      FROM ACHANGE c JOIN ATRANSACTION t ON t.Z_PK = c.ZTRANSACTIONID
      WHERE c.ZENTITY IN (${read.map(() => '?').join(', ')})
        AND c.ZCHANGETYPE IN (${INSERT}, ${UPDATE})
      ORDER BY c.Z_PK`),
    ...read
  );
  for (const row of rows) {
    if (row.tx !== current) {
      finish();
      current = row.tx;
      seconds = row.time;
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
        if (!updated && row.time !== null && !arrived.has(row.pk)) arrived.set(row.pk, row.time);
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

/** Which asset each caption's and title's row belongs to, and the captions that have text. */
function readOwners(store: CoreDataStore) {
  const assetOfAttributes = new Map(
    allRows<{ pk: number; asset: number | null }>(
      store.db.prepare('SELECT Z_PK AS pk, ZASSET AS asset FROM ZADDITIONALASSETATTRIBUTES')
    ).map(row => [row.pk, row.asset])
  );
  const descriptions = allRows<{ pk: number; attributes: number | null; caption: string | null }>(
    store.db.prepare(`
      SELECT Z_PK AS pk, ZASSETATTRIBUTES AS attributes,
        ${store.column('d', 'ZASSETDESCRIPTION', 'ZLONGDESCRIPTION')} AS caption
      FROM ZASSETDESCRIPTION d`)
  );
  return {
    assetOfAttributes,
    attributesOfDescription: new Map(descriptions.map(row => [row.pk, row.attributes])),
    captioned: new Set(descriptions.filter(row => clean(row.caption)).map(row => row.pk)),
  };
}
