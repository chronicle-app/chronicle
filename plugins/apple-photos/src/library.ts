import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assertReadable, type DatabaseSchema } from '@chronicle.app/etl';
import { allRows, assertDatabaseSchema } from '@chronicle.app/etl-sqlite';
import { CoreDataStore, appleDate, lastChanged } from './coredata.js';

/** The library Photos opens by default. */
export const SYSTEM_LIBRARY = `${process.env.HOME}/Pictures/Photos Library.photoslibrary`;
/** The library Photos keeps of what was shared with you in Messages. */
export const SHARED_WITH_YOU_LIBRARY = `${process.env.HOME}/Library/Photos/Libraries/Syndication.photoslibrary`;

/**
 * What a library's `Photos.sqlite` must have for a run and a survey to read
 * it. A column ending in `?` is one a query reads only when it's there. The
 * change log's tables, the model cache, the join tables, which Core Data
 * names by entity number, and the keywords, read through one of them, are
 * read only when they're there, so they aren't declared.
 */
export const DATABASES: DatabaseSchema[] = [
  {
    tables: {
      Z_PRIMARYKEY: ['Z_NAME', 'Z_ENT'],
      ZASSET: [
        'Z_PK',
        'ZUUID',
        'ZKIND',
        'ZDATECREATED',
        'ZWIDTH',
        'ZHEIGHT',
        'ZDURATION',
        'ZLATITUDE',
        'ZLONGITUDE',
        'ZFAVORITE',
        'ZCLOUDASSETGUID?',
        'ZKINDSUBTYPE?',
        'ZDEPTHTYPE?',
        'ZAVALANCHEUUID?',
        'ZADDEDDATE?',
        'ZUNIFORMTYPEIDENTIFIER?',
        'ZVIDEOCPDURATIONVALUE?',
        'ZLASTSHAREDDATE?',
        'ZADJUSTMENTTIMESTAMP?',
        'ZADJUSTMENTSSTATE?',
        'ZBUNDLESCOPE?',
        'ZTRASHEDSTATE?',
        'ZVISIBILITYSTATE?',
      ],
      ZADDITIONALASSETATTRIBUTES: [
        'Z_PK',
        'ZASSET',
        'ZVIDEOCPDURATIONTIMESCALE?',
        'ZTITLE?',
        'ZORIGINALFILENAME?',
        'ZIMPORTEDBYBUNDLEIDENTIFIER?',
        'ZIMPORTEDBYDISPLAYNAME?',
        'ZLASTVIEWEDDATE?',
        'ZSYNDICATIONIDENTIFIER?',
      ],
      ZASSETDESCRIPTION: ['Z_PK', 'ZASSETATTRIBUTES', 'ZLONGDESCRIPTION?'],
      ZEXTENDEDATTRIBUTES: ['ZASSET', 'ZCAMERAMAKE?', 'ZCAMERAMODEL?'],
      ZGENERICALBUM: [
        'Z_PK',
        'ZKIND',
        'ZTITLE',
        'ZUUID',
        'ZPARENTFOLDER',
        'ZTRASHEDSTATE',
        'ZCLOUDGUID?',
      ],
      ZPERSON: ['Z_PK', 'ZPERSONUUID', 'ZFULLNAME', 'ZDETECTIONTYPE', 'ZMERGETARGETPERSON'],
      ZDETECTEDFACE: ['ZASSETFORFACE', 'ZPERSONFORFACE', 'ZNAMESOURCE?', 'ZMANUAL?'],
    },
  },
];

/** Which part of a library an asset is in (`ZBUNDLESCOPE`). */
export const Scope = {
  /** Your own library. */
  own: 0,
  /** Shared with You, in its own library. */
  sharedWithYou: 3,
} as const;

/** One person you said is in a photo, by the name you gave them. */
export interface PhotoPerson {
  /** Photos' ID for the person (`ZPERSONUUID`), the same on every Mac on the iCloud library. */
  id: string;
  name: string;
}

/** An album, with the folders it's in, innermost first. */
export interface PhotoAlbum {
  /** iCloud's ID for the album, or the library's own when it isn't in iCloud. */
  id: string;
  title: string | null;
  folders: Array<{ id: string; title: string | null }>;
}

/**
 * The camera's mode a photo or video was taken in, as Photos' Media Types
 * name them: a Live Photo, a Portrait, a panorama, a burst, a slo-mo video,
 * a time-lapse, or a Cinematic video.
 */
export type Format =
  'livePhoto' | 'portrait' | 'panorama' | 'burst' | 'sloMo' | 'timeLapse' | 'cinematic';

/** A photo or video, with what its file and you recorded about it. */
export interface Asset {
  /** iCloud's ID for it (`ZCLOUDASSETGUID`), or the library's own (`ZUUID`) when it isn't in iCloud. */
  id: string;
  /** The library's own ID, which other databases in the library join on. */
  uuid: string;
  kind: 'photo' | 'video';
  /** Photos' kind of photo or video (`ZKINDSUBTYPE`): 2 is a Live Photo, 10 a screenshot, 103 a screen recording. */
  subtype: number;
  /** The camera's mode it was taken in, when it was one. */
  format: Format | null;
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
  location: { latitude: number; longitude: number } | null;
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
  depth: number | null;
  burst: string | null;
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
// How a face came to be a person's (`ZDETECTEDFACE.ZNAMESOURCE`), as Photos
// names them: you named a group of faces (`user-cluster`), one face
// (`user-single`), or one in iPhoto or Aperture (`user-migration`). The rest
// are Photos' own matches.
const NAMED_BY_YOU = [1, 3, 4];

/** Where a library's databases are, given the library or its `Photos.sqlite`. */
export function libraryFiles(input: string) {
  const path = resolve(input);
  const root = basename(path) === 'Photos.sqlite' ? dirname(dirname(path)) : path;
  return {
    root,
    photos: join(root, 'database', 'Photos.sqlite'),
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

  /** Open a library, refusing one whose `Photos.sqlite` isn't in {@link DATABASES}. */
  static open(input: string): PhotosLibrary {
    const files = libraryFiles(input);
    assertReadable(files.photos, 'Photos library');
    const db = new DatabaseSync(files.photos, { readOnly: true });
    try {
      assertDatabaseSchema(db, DATABASES, files.photos);
    } catch (error) {
      db.close();
      throw error;
    }
    return new PhotosLibrary(files, db);
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
        ${c('a', 'ZASSET', 'ZDEPTHTYPE')} AS depth, ${c('a', 'ZASSET', 'ZAVALANCHEUUID')} AS burst,
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
    return rows.map(row => {
      const { subtype, created, added, importer, camera } = provenanceOf(row);
      return {
        id: assetId(row),
        uuid: row.uuid,
        kind: row.kind === 1 ? 'video' : 'photo',
        subtype,
        format: formatOf(row),
        created,
        added,
        importer,
        importerName: clean(row.importerName),
        camera,
        width: positive(row.width),
        height: positive(row.height),
        duration: row.kind === 1 ? positive(row.duration) : null,
        uti: clean(row.uti),
        title: clean(row.title),
        filename: clean(row.filename),
        caption: clean(row.caption),
        keywords: (row.attributes !== null && keywords.get(row.attributes)) || [],
        location: locationOf(row),
        people: people.get(row.pk) ?? [],
        albums: albums.get(row.pk) ?? [],
        clip:
          row.subtype === 2
            ? { duration: row.clipScale ? positive((row.clipValue ?? 0) / row.clipScale) : null }
            : null,
      };
    });
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
   * The people you said are in each asset, by the asset's row: a face you
   * named, on its own or in a group of faces, or one you added. A face Photos
   * matched to a person itself is left out, as are pets and people you
   * haven't named. A person merged into another is the one they were merged
   * into.
   */
  private people(): Map<number, PhotoPerson[]> {
    const people = new Map(
      allRows<{
        pk: number;
        uuid: string | null;
        name: string | null;
        detection: number | null;
        mergedInto: number | null;
      }>(
        this.db.prepare(`
          SELECT Z_PK AS pk, ZPERSONUUID AS uuid, ZFULLNAME AS name, ZDETECTIONTYPE AS detection,
            ZMERGETARGETPERSON AS mergedInto
          FROM ZPERSON`)
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
        person?.uuid && name && person.detection === HUMAN ? { id: person.uuid, name } : null;
      resolved.set(pk, found);
      return found;
    };

    const byAsset = new Map<number, PhotoPerson[]>();
    const nameSource = this.store.column('f', 'ZDETECTEDFACE', 'ZNAMESOURCE');
    const manual = this.store.column('f', 'ZDETECTEDFACE', 'ZMANUAL');
    const faces = allRows<{ asset: number; person: number }>(
      this.db.prepare(`
        SELECT ZASSETFORFACE AS asset, ZPERSONFORFACE AS person FROM ZDETECTEDFACE f
        WHERE ZASSETFORFACE IS NOT NULL AND ZPERSONFORFACE IS NOT NULL
          AND (${nameSource} IN (${NAMED_BY_YOU.join(', ')}) OR ${manual} = 1)`)
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
}

/** How an asset came to be in the library, and when: what its row says without the joins. */
export type Provenance = Pick<Asset, 'subtype' | 'created' | 'added' | 'importer' | 'camera'>;

/** An asset's provenance, from its row alone, as {@link PhotosLibrary.describe} gives it. */
export function provenanceOf(row: AssetRow): Provenance {
  const make = clean(row.cameraMake);
  const model = clean(row.cameraModel);
  return {
    subtype: row.subtype ?? 0,
    created: appleDate(row.dateCreated),
    added: appleDate(row.addedDate),
    importer: clean(row.importer),
    camera: make || model ? { make, model } : null,
  };
}

// Photos' kinds of photo and video (`ZKINDSUBTYPE`) that are a camera's mode.
const SUBTYPE_FORMATS: { [subtype: number]: Format } = {
  1: 'panorama',
  2: 'livePhoto',
  101: 'sloMo',
  102: 'timeLapse',
};
// What depth a photo or video was taken with (`ZDEPTHTYPE`): a Portrait's,
// or a Cinematic video's.
const PORTRAIT = 1;
const CINEMATIC = 2;

/**
 * The camera's mode an asset was taken in. A Portrait or a burst can be a
 * Live Photo too, so it's named as the Portrait or the burst.
 */
function formatOf(row: AssetRow): Format | null {
  const photo = row.kind === 0;
  if (!photo && row.depth === CINEMATIC) return 'cinematic';
  if (photo && row.depth === PORTRAIT) return 'portrait';
  if (photo && clean(row.burst)) return 'burst';
  return SUBTYPE_FORMATS[row.subtype ?? 0] ?? null;
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
  return { latitude, longitude };
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
