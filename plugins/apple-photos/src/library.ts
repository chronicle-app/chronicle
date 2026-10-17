import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertReadable } from '@chronicle.app/etl';
import { allRows } from '@chronicle.app/etl-sqlite';
import { placeAddress } from './archive.js';
import { CoreDataStore, appleDate, lastChanged } from './coredata.js';

/** The library Photos opens by default. */
export const SYSTEM_LIBRARY = `${process.env.HOME}/Pictures/Photos Library.photoslibrary`;
/** The library Photos keeps of what was shared with you in Messages. */
export const SHARED_WITH_YOU_LIBRARY = `${process.env.HOME}/Library/Photos/Libraries/Syndication.photoslibrary`;

/** Which part of a library an asset is in (`ZBUNDLESCOPE`). */
export const Scope = {
  /** Your own library. */
  own: 0,
  /** Shared with You, in its own library. */
  sharedWithYou: 3,
} as const;

/** One person Photos recognized in a photo, by the name you gave them. */
export interface PhotoPerson {
  /** Photos' ID for the person (`ZPERSONUUID`), the same on every Mac on the iCloud library. */
  id: string;
  name: string;
  /** Whether Photos knows this person is you. */
  me: boolean;
}

/** An album, with the folders it's in, innermost first. */
export interface PhotoAlbum {
  /** iCloud's ID for the album, or the library's own when it isn't in iCloud. */
  id: string;
  title: string | null;
  folders: Array<{ id: string; title: string | null }>;
}

/** A photo or video, with what Photos knows about it. */
export interface Asset {
  /** iCloud's ID for it (`ZCLOUDASSETGUID`), or the library's own (`ZUUID`) when it isn't in iCloud. */
  id: string;
  /** The library's own ID, which other databases in the library join on. */
  uuid: string;
  kind: 'photo' | 'video';
  /** Photos' kind of photo or video (`ZKINDSUBTYPE`): 2 is a Live Photo, 10 a screenshot, 103 a screen recording. */
  subtype: number;
  /** When it was taken, as Photos has it, in UTC. */
  created: string | null;
  /** When it was added to the library. */
  added: string | null;
  /** The app that added it, by its bundle identifier. */
  importer: string | null;
  importerName: string | null;
  /** The camera's make and model, from the file. */
  camera: { make: string | null; model: string | null } | null;
  width: number | null;
  height: number | null;
  /** How long a video lasts, in seconds. */
  duration: number | null;
  /** Its file type, as a uniform type identifier. */
  uti: string | null;
  /** The title you gave it. */
  title: string | null;
  /** The name of the file it was added from. */
  filename: string | null;
  /** The caption you wrote. */
  caption: string | null;
  keywords: string[];
  /** The caption Photos' model wrote. */
  aiDescription: string | null;
  /** What Photos recognized in it, as its search shows it. */
  labels: string[];
  location: { latitude: number; longitude: number; address: string | null } | null;
  people: PhotoPerson[];
  albums: PhotoAlbum[];
  /** A Live Photo's video, with how long it lasts in seconds. */
  clip: { duration: number | null } | null;
}

/** An asset's row, as the query selects it. */
export interface AssetRow {
  pk: number;
  attributes: number | null;
  uuid: string;
  cloudGuid: string | null;
  kind: number;
  subtype: number | null;
  dateCreated: number | null;
  addedDate: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  uti: string | null;
  latitude: number | null;
  longitude: number | null;
  favorite: number | null;
  clipValue: number | null;
  clipScale: number | null;
  title: string | null;
  filename: string | null;
  importer: string | null;
  importerName: string | null;
  place: Uint8Array | null;
  caption: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lastViewed: number | null;
  lastShared: number | null;
  adjusted: number | null;
  adjustments: number | null;
  syndicationId: string | null;
}

// A user album and a folder of albums (`ZGENERICALBUM.ZKIND`).
const ALBUM = 2;
const FOLDER = 4000;
// Photos' detection type for a person rather than a pet.
const HUMAN = 1;
// What Photos' search calls a label: something recognized in the image.
const LABEL_CATEGORY = 4000;
// Search terms Photos keeps for itself, not words a person would search for.
const PLACEHOLDER = /^PG[A-Za-z0-9]+SearchableText$/;

/** Where a library's databases are, given the library or its `Photos.sqlite`. */
export function libraryFiles(input: string) {
  const path = resolve(input);
  const root = basename(path) === 'Photos.sqlite' ? dirname(dirname(path)) : path;
  return {
    root,
    photos: join(root, 'database', 'Photos.sqlite'),
    mediaAnalysis: join(
      root,
      'private',
      'com.apple.mediaanalysisd',
      'MediaAnalysis',
      'MediaAnalysis.sqlite'
    ),
    search: join(root, 'database', 'search', 'leo.sqlite'),
  };
}

/**
 * A Photos library on this Mac, read in place. Photos keeps the library's
 * changes in `Photos.sqlite`'s write-ahead log while it runs, so the database
 * is opened read-only where it is, never copied without its log.
 */
export class PhotosLibrary {
  readonly files: ReturnType<typeof libraryFiles>;
  readonly store: CoreDataStore;
  private readonly db: DatabaseSync;

  private constructor(files: ReturnType<typeof libraryFiles>, db: DatabaseSync) {
    this.files = files;
    this.db = db;
    this.store = new CoreDataStore(db);
  }

  static open(input: string): PhotosLibrary {
    const files = libraryFiles(input);
    assertReadable(files.photos, 'Photos library');
    return new PhotosLibrary(files, new DatabaseSync(files.photos, { readOnly: true }));
  }

  close(): void {
    this.db.close();
  }

  /** When the library last changed. */
  lastChanged(): Date | null {
    return lastChanged(this.files.photos);
  }

  /**
   * The photos and videos in one part of the library, as Photos shows them:
   * not in Recently Deleted, and of a burst, only the photos Photos shows.
   */
  rows(scope: number): AssetRow[] {
    const { store } = this;
    const c = (alias: string, table: string, column: string) => store.column(alias, table, column);
    const sql = `
      SELECT a.Z_PK AS pk, x.Z_PK AS attributes, a.ZUUID AS uuid,
        ${c('a', 'ZASSET', 'ZCLOUDASSETGUID')} AS cloudGuid,
        a.ZKIND AS kind, ${c('a', 'ZASSET', 'ZKINDSUBTYPE')} AS subtype,
        a.ZDATECREATED AS dateCreated, ${c('a', 'ZASSET', 'ZADDEDDATE')} AS addedDate,
        a.ZWIDTH AS width, a.ZHEIGHT AS height, a.ZDURATION AS duration,
        ${c('a', 'ZASSET', 'ZUNIFORMTYPEIDENTIFIER')} AS uti,
        a.ZLATITUDE AS latitude, a.ZLONGITUDE AS longitude, a.ZFAVORITE AS favorite,
        ${c('a', 'ZASSET', 'ZVIDEOCPDURATIONVALUE')} AS clipValue,
        ${c('x', 'ZADDITIONALASSETATTRIBUTES', 'ZVIDEOCPDURATIONTIMESCALE')} AS clipScale,
        ${c('x', 'ZADDITIONALASSETATTRIBUTES', 'ZTITLE')} AS title,
        ${c('x', 'ZADDITIONALASSETATTRIBUTES', 'ZORIGINALFILENAME')} AS filename,
        ${c('x', 'ZADDITIONALASSETATTRIBUTES', 'ZIMPORTEDBYBUNDLEIDENTIFIER')} AS importer,
        ${c('x', 'ZADDITIONALASSETATTRIBUTES', 'ZIMPORTEDBYDISPLAYNAME')} AS importerName,
        ${c('x', 'ZADDITIONALASSETATTRIBUTES', 'ZREVERSELOCATIONDATA')} AS place,
        ${c('d', 'ZASSETDESCRIPTION', 'ZLONGDESCRIPTION')} AS caption,
        ${c('e', 'ZEXTENDEDATTRIBUTES', 'ZCAMERAMAKE')} AS cameraMake,
        ${c('e', 'ZEXTENDEDATTRIBUTES', 'ZCAMERAMODEL')} AS cameraModel,
        ${c('x', 'ZADDITIONALASSETATTRIBUTES', 'ZLASTVIEWEDDATE')} AS lastViewed,
        ${c('a', 'ZASSET', 'ZLASTSHAREDDATE')} AS lastShared,
        ${c('a', 'ZASSET', 'ZADJUSTMENTTIMESTAMP')} AS adjusted,
        ${c('a', 'ZASSET', 'ZADJUSTMENTSSTATE')} AS adjustments,
        ${c('x', 'ZADDITIONALASSETATTRIBUTES', 'ZSYNDICATIONIDENTIFIER')} AS syndicationId
      FROM ZASSET a
      LEFT JOIN ZADDITIONALASSETATTRIBUTES x ON x.ZASSET = a.Z_PK
      LEFT JOIN ZASSETDESCRIPTION d ON d.ZASSETATTRIBUTES = x.Z_PK
      LEFT JOIN ZEXTENDEDATTRIBUTES e ON e.ZASSET = a.Z_PK
      WHERE COALESCE(${c('a', 'ZASSET', 'ZBUNDLESCOPE')}, 0) = ?
        AND COALESCE(${c('a', 'ZASSET', 'ZTRASHEDSTATE')}, 0) = 0
        AND COALESCE(${c('a', 'ZASSET', 'ZVISIBILITYSTATE')}, 0) = 0
        AND a.ZUUID IS NOT NULL`;
    return allRows<AssetRow>(this.db.prepare(sql), scope);
  }

  /** Each row as an asset, with what's joined to it. */
  describe(rows: AssetRow[]): Asset[] {
    const people = this.people();
    const albums = this.albumsOfAssets();
    const keywords = this.keywords();
    const captions = this.aiDescriptions();
    const labels = this.labels();
    return rows.map(row => ({
      id: assetId(row),
      uuid: row.uuid,
      kind: row.kind === 1 ? 'video' : 'photo',
      subtype: row.subtype ?? 0,
      created: appleDate(row.dateCreated),
      added: appleDate(row.addedDate),
      importer: clean(row.importer),
      importerName: clean(row.importerName),
      camera:
        clean(row.cameraMake) || clean(row.cameraModel)
          ? { make: clean(row.cameraMake), model: clean(row.cameraModel) }
          : null,
      width: positive(row.width),
      height: positive(row.height),
      duration: row.kind === 1 ? positive(row.duration) : null,
      uti: clean(row.uti),
      title: clean(row.title),
      filename: clean(row.filename),
      caption: clean(row.caption),
      keywords: (row.attributes !== null && keywords.get(row.attributes)) || [],
      aiDescription: captions.get(row.uuid.toUpperCase()) ?? null,
      labels: labels.get(row.uuid.toUpperCase()) ?? [],
      location: locationOf(row),
      people: people.get(row.pk) ?? [],
      albums: albums.get(row.pk) ?? [],
      clip:
        row.subtype === 2
          ? { duration: row.clipScale ? positive((row.clipValue ?? 0) / row.clipScale) : null }
          : null,
    }));
  }

  /** The albums you made, with their folders, by row. */
  albums(): Map<number, PhotoAlbum> {
    const rows = allRows<{
      pk: number;
      kind: number;
      title: string | null;
      cloudGuid: string | null;
      uuid: string | null;
      parent: number | null;
    }>(
      this.db.prepare(`
        SELECT Z_PK AS pk, ZKIND AS kind, ZTITLE AS title,
          ${this.store.column('g', 'ZGENERICALBUM', 'ZCLOUDGUID')} AS cloudGuid,
          ZUUID AS uuid, ZPARENTFOLDER AS parent
        FROM ZGENERICALBUM g
        WHERE ZKIND IN (${ALBUM}, ${FOLDER}) AND COALESCE(ZTRASHEDSTATE, 0) = 0`)
    );
    const byPk = new Map(rows.map(row => [row.pk, row]));
    const albums = new Map<number, PhotoAlbum>();
    for (const row of rows) {
      const id = row.cloudGuid || row.uuid;
      if (row.kind !== ALBUM || !id) continue;
      const folders: PhotoAlbum['folders'] = [];
      const seen = new Set<number>();
      for (
        let parent = byPk.get(row.parent ?? -1);
        parent;
        parent = byPk.get(parent.parent ?? -1)
      ) {
        const folderId = parent.cloudGuid || parent.uuid;
        if (parent.kind !== FOLDER || !folderId || seen.has(parent.pk)) break;
        seen.add(parent.pk);
        folders.push({ id: folderId, title: clean(parent.title) });
      }
      albums.set(row.pk, { id, title: clean(row.title), folders });
    }
    return albums;
  }

  /** Which albums each asset is in now, as `album/asset` rows. */
  membership(): Array<{ album: number; asset: number }> {
    const join = this.store.joinTable(['Album', 'assets'], ['Asset', 'albums']);
    if (!join) return [];
    return allRows<{ album: number; asset: number }>(
      this.db.prepare(`SELECT ${join.a} AS album, ${join.b} AS asset FROM ${join.table}`)
    );
  }

  /** Each asset's albums, by the asset's row. */
  private albumsOfAssets(): Map<number, PhotoAlbum[]> {
    const albums = this.albums();
    const byAsset = new Map<number, PhotoAlbum[]>();
    for (const { album, asset } of this.membership()) {
      const found = albums.get(album);
      if (!found) continue;
      const list = byAsset.get(asset) ?? [];
      list.push(found);
      byAsset.set(asset, list);
    }
    for (const list of byAsset.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return byAsset;
  }

  /** Each asset's keywords, by its attributes row. */
  private keywords(): Map<number, string[]> {
    const join = this.store.joinTable(
      ['AdditionalAssetAttributes', 'keywords'],
      ['Keyword', 'assetAttributes']
    );
    if (!join) return new Map();
    const rows = allRows<{ attributes: number; title: string | null }>(
      this.db.prepare(`
        SELECT j.${join.a} AS attributes, k.ZTITLE AS title
        FROM ${join.table} j JOIN ZKEYWORD k ON k.Z_PK = j.${join.b}
        ORDER BY k.ZTITLE`)
    );
    return groupBy(
      rows,
      row => row.attributes,
      row => clean(row.title)
    );
  }

  /**
   * The people you named in each asset, by the asset's row. A person merged
   * into another is the one they were merged into. Pets and people you
   * haven't named are left out.
   */
  private people(): Map<number, PhotoPerson[]> {
    const people = new Map(
      allRows<{
        pk: number;
        uuid: string | null;
        name: string | null;
        detection: number | null;
        mergedInto: number | null;
        me: number | null;
      }>(
        this.db.prepare(`
          SELECT Z_PK AS pk, ZPERSONUUID AS uuid, ZFULLNAME AS name, ZDETECTIONTYPE AS detection,
            ZMERGETARGETPERSON AS mergedInto,
            ${this.store.column('p', 'ZPERSON', 'ZISMECONFIDENCE')} AS me
          FROM ZPERSON p`)
      ).map(row => [row.pk, row])
    );
    const resolved = new Map<number, PhotoPerson | null>();
    const personOf = (pk: number): PhotoPerson | null => {
      if (resolved.has(pk)) return resolved.get(pk)!;
      let person = people.get(pk);
      const seen = new Set<number>();
      while (person?.mergedInto && people.has(person.mergedInto) && !seen.has(person.pk)) {
        seen.add(person.pk);
        person = people.get(person.mergedInto);
      }
      const name = clean(person?.name);
      const found =
        person?.uuid && name && person.detection === HUMAN
          ? { id: person.uuid, name, me: (person.me ?? 0) >= 1 }
          : null;
      resolved.set(pk, found);
      return found;
    };

    const byAsset = new Map<number, PhotoPerson[]>();
    const faces = allRows<{ asset: number; person: number }>(
      this.db.prepare(`
        SELECT ZASSETFORFACE AS asset, ZPERSONFORFACE AS person FROM ZDETECTEDFACE
        WHERE ZASSETFORFACE IS NOT NULL AND ZPERSONFORFACE IS NOT NULL`)
    );
    for (const face of faces) {
      const person = personOf(face.person);
      if (!person) continue;
      const list = byAsset.get(face.asset) ?? [];
      if (!list.some(other => other.id === person.id)) list.push(person);
      byAsset.set(face.asset, list);
    }
    for (const list of byAsset.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    return byAsset;
  }

  /**
   * The caption Photos' model wrote for each asset, by its UUID, from the
   * library's media analysis. A video's caption is its own.
   */
  private aiDescriptions(): Map<string, string> {
    const captions = new Map<string, { caption: string; confidence: number }>();
    withDatabase(this.files.mediaAnalysis, db => {
      for (const table of ['ZIMAGECAPTIONRESULT', 'ZVIDEOCAPTIONRESULT']) {
        const columns = new Set(
          allRows<{ name: string }>(db.prepare(`PRAGMA table_info(${table})`)).map(c => c.name)
        );
        if (!columns.has('ZCAPTION')) continue;
        const rows = allRows<{
          id: string | null;
          caption: string | null;
          confidence: number | null;
        }>(
          db.prepare(`
            SELECT a.ZLOCALIDENTIFIER AS id, r.ZCAPTION AS caption,
              ${columns.has('ZCONFIDENCE') ? 'r.ZCONFIDENCE' : 'NULL'} AS confidence
            FROM ${table} r JOIN ZASSET a ON a.Z_PK = r.ZASSET`)
        );
        for (const row of rows) {
          // A local identifier is the asset's UUID and its resource, `<UUID>/L0/001`.
          const uuid = row.id?.split('/')[0]?.toUpperCase();
          const caption = clean(row.caption);
          if (!uuid || !caption) continue;
          const confidence = row.confidence ?? 0;
          const best = captions.get(uuid);
          if (!best || confidence > best.confidence) captions.set(uuid, { caption, confidence });
        }
      }
    });
    return new Map([...captions].map(([uuid, { caption }]) => [uuid, caption]));
  }

  /**
   * What Photos recognized in each asset, by its UUID, as its search shows
   * it: the labels in the library's search index, `leo.sqlite`. Each asset
   * lists its search terms as little-endian 32-bit IDs.
   */
  private labels(): Map<string, string[]> {
    const labels = new Map<string, string[]>();
    withDatabase(this.files.search, db => {
      const terms = new Map(
        allRows<{ id: number; content: string | null }>(
          db.prepare(
            'SELECT lexeme_id AS id, content FROM lexicon WHERE category = ? AND type = 1'
          ),
          LABEL_CATEGORY
        ).flatMap(row => {
          const content = clean(row.content);
          return content && !PLACEHOLDER.test(content) ? [[row.id, content]] : [];
        })
      );
      const items = allRows<{ identifier: string | null; ids: Uint8Array | null }>(
        db.prepare('SELECT identifier, lexeme_ids AS ids FROM items WHERE type = 1')
      );
      for (const item of items) {
        if (!item.identifier || !item.ids) continue;
        const ids = Buffer.from(item.ids.buffer, item.ids.byteOffset, item.ids.byteLength);
        const found: string[] = [];
        for (let at = 0; at + 4 <= ids.length; at += 4) {
          const term = terms.get(ids.readUInt32LE(at));
          if (term && !found.includes(term)) found.push(term);
        }
        if (found.length > 0) labels.set(item.identifier.toUpperCase(), found);
      }
    });
    return labels;
  }
}

/** An asset's key: iCloud's ID for it, or the library's own when it isn't in iCloud. */
export function assetId(row: Pick<AssetRow, 'cloudGuid' | 'uuid'>): string {
  return clean(row.cloudGuid) ?? row.uuid;
}

/**
 * Where a photo was taken. Photos records no position as -180, -180, and a
 * device without a fix can record 0, 0, so both are left out.
 */
function locationOf(row: AssetRow): Asset['location'] {
  const { latitude, longitude } = row;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  if (latitude === -180 || (latitude === 0 && longitude === 0)) return null;
  let address: string | null = null;
  if (row.place) {
    try {
      address = placeAddress(row.place);
    } catch {
      address = null;
    }
  }
  return { latitude, longitude, address };
}

/**
 * Read a database beside the library, when it's there. The library is
 * complete without it, so one that's missing or doesn't open is skipped.
 */
function withDatabase(path: string, read: (db: DatabaseSync) => void): void {
  if (!existsSync(path)) return;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    read(db);
  } catch {
    // A database Photos hasn't finished writing, or in a newer format.
  } finally {
    db?.close();
  }
}

function groupBy<T, K, V>(rows: T[], key: (row: T) => K, value: (row: T) => V | null): Map<K, V[]> {
  const groups = new Map<K, V[]>();
  for (const row of rows) {
    const found = value(row);
    if (found === null) continue;
    const list = groups.get(key(row)) ?? [];
    list.push(found);
    groups.set(key(row), list);
  }
  return groups;
}

/** Text with its whitespace trimmed, or null when there's none. Some rows hold a lone NUL. */
export function clean(value: string | null | undefined): string | null {
  const text = value?.replace(/\0/g, '').trim();
  return text || null;
}

function positive(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
