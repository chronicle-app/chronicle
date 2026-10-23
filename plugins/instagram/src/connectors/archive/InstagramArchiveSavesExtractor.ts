import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/** One save a run reads, before it's a record. */
interface Save {
  url: string;
  ownerHandle?: string;
  collectionName?: string;
  timestamp: number;
}

/**
 * Extract saved posts (bookmarks, optionally into collections) from an
 * Instagram export. Everything folds to a `BookmarkAction` on an external
 * `Post`, with a `Collection` when the save belongs to one.
 *
 * `saved_collections.json`, two dialects:
 * - `label_values` (older and 2026 exports): each entry is a whole collection
 *   carrying a `Name` and a nested `Media` list; items have no time of their
 *   own, so the collection's update time is used. 2026 items also carry a
 *   nested `Owner` dict (`Username`).
 * - 2025 `string_map_data` (under a `saved_saved_collections` wrapper): a FLAT
 *   list where a header entry (`title: "Collection"`, `Name.value`) precedes
 *   its item entries (`Name.href` = permalink, `Name.value` = owner handle,
 *   `Added Time`) — items keep their own save time.
 *
 * `saved_posts.json` — saves outside any collection, two dialects:
 * - 2025 (`saved_saved_media` wrapper): `title` = owner handle, `"Saved on"`
 *   carries permalink + time.
 * - 2026 (bare list): each entry is `{timestamp, media: [], label_values}`
 *   with `URL` / `Caption` / `Title` labels plus nested `Hashtags` / `Owner` /
 *   `Brand partner` dicts. `Title` is empty in practice; the owner handle is
 *   `Owner → Username`. The same item shape Meta now uses for posts and likes.
 */
export class InstagramArchiveSavesExtractor extends InstagramArchiveExtractor {
  static override description = 'Saved posts';

  static override recordTypes = ['saves'];
  static override default = false;
  static override defaultTransformer = InstagramTransformer;

  /** The saved post's shortcode — the save entry's only id, and Instagram's own. */
  override keyOf(record: Record): string | null {
    return (record.data as { targetId?: string }).targetId ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    let index = 0;
    for await (const { shortcode, save } of this.saves()) {
      if (this.shouldStopExtracting(index)) return;
      yield this.emitSave(shortcode, save);
      index++;
    }
  }

  /** The saves a run reads and when each was saved, or its collection last changed. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const saves = this.emptySurvey(options);
    for await (const { save } of this.saves()) {
      this.tally(saves, new Date(save.timestamp * 1000));
    }
    return { saves };
  }

  /**
   * The saves in collections, then the rest, in the run's window: those whose
   * permalink gives the post's shortcode, with it.
   */
  private async *saves(): AsyncGenerator<{ shortcode: string; save: Save }> {
    for (const part of [this.collected(), this.uncollected()]) {
      for await (const save of part) {
        const shortcode = this.shortcodeFromUrl(save.url);
        if (shortcode) yield { shortcode, save };
      }
    }
  }

  private async *collected(): AsyncGenerator<Save> {
    const entries = await this.readInstagramArray(
      'your_instagram_activity/saved/saved_collections.json'
    );

    // 2025 dialect: the current collection header applies to the flat item
    // entries that follow it.
    let currentCollection: string | undefined;

    for (const entry of entries) {
      // label_values dialect: one entry = one whole collection with nested media.
      if (Array.isArray(entry?.label_values)) {
        const labels = this.labelMap(entry);
        const name = labels.Name;
        const timestamp = entry.timestamp ?? labels['Update time#ts'];
        if (!name || !timestamp) continue;
        if (!this.inRange(Number(timestamp))) continue;
        for (const saved of this.nestedItems(entry)) {
          yield {
            url: saved.url,
            ownerHandle: saved.ownerHandle,
            collectionName: name,
            timestamp: Number(timestamp),
          };
        }
        continue;
      }

      const sm = entry?.string_map_data;
      if (!sm) continue;

      // 2025 header: names the collection for the items that follow.
      if (!sm.Name?.href && sm.Name?.value) {
        currentCollection = sm.Name.value;
        continue;
      }

      // 2025 item: permalink + owner, with its own save time.
      const url = sm.Name?.href;
      const timestamp = sm['Added Time']?.timestamp;
      if (!url || !timestamp) continue;
      if (!this.inRange(timestamp)) continue;
      yield {
        url,
        ownerHandle: sm.Name?.value || undefined,
        collectionName: currentCollection,
        timestamp,
      };
    }
  }

  /** Saves outside any collection (`saved_posts.json`), both dialects. */
  private async *uncollected(): AsyncGenerator<Save> {
    const entries = await this.readInstagramArray('your_instagram_activity/saved/saved_posts.json');
    for (const entry of entries) {
      let url: string | undefined;
      let ownerHandle: string | undefined;
      let timestamp: number | undefined;
      if (Array.isArray(entry?.label_values)) {
        // 2026 dialect: the item's own labels, save time on the entry.
        ({ url, ownerHandle } = this.savedItemFields(entry));
        timestamp = entry.timestamp;
      } else {
        // 2025 dialect: owner in `title`, permalink + time under "Saved on".
        const savedOn = entry?.string_map_data?.['Saved on'];
        url = savedOn?.href;
        ownerHandle = entry?.title || undefined;
        timestamp = savedOn?.timestamp;
      }
      if (!url || !timestamp) continue;
      if (!this.inRange(timestamp)) continue;
      yield { url, ownerHandle, timestamp };
    }
  }

  private emitSave(shortcode: string, data: Save): Record {
    return this.createRecordWithArchiveContext(
      {
        type: 'saves',
        targetId: shortcode,
        url: this.permalinkFromUrl(data.url) ?? undefined,
        ownerHandle: data.ownerHandle,
        collectionName: data.collectionName,
        ...(/\/reel\//.test(data.url) && { sourceFormat: 'reel' }),
        timestamp: this.convertInstagramTimestamp(data.timestamp),
      },
      { originalData: data }
    );
  }

  /**
   * The permalink and owner handle of one saved item in the `label_values`
   * shape — a bare `saved_posts.json` entry, or an item nested under a
   * collection's `Media` list. The owner lives in a nested `Owner` dict
   * (`Username`); the flat `Title` label is read as a fallback but is empty in
   * every export seen so far.
   */
  private savedItemFields(item: any): {
    url?: string;
    ownerHandle?: string;
  } {
    const labels = this.labelMap(item);
    const url: string | undefined = labels.URL ?? labels['URL#href'];
    let ownerHandle: string | undefined;
    for (const lv of item?.label_values ?? []) {
      if (lv?.title !== 'Owner' || !Array.isArray(lv.dict)) continue;
      ownerHandle = lv.dict[0]?.dict?.find((x: any) => x?.label === 'Username')?.value;
    }
    return { url, ownerHandle: ownerHandle || labels.Title || undefined };
  }

  /** label_values dialect: saved posts nested under the collection's `Media` list. */
  private nestedItems(collection: any): Array<{ url: string; ownerHandle?: string }> {
    const out: Array<{ url: string; ownerHandle?: string }> = [];
    for (const lv of collection?.label_values ?? []) {
      if (lv?.title === 'Media' && Array.isArray(lv.dict)) {
        for (const item of lv.dict) {
          const { url, ownerHandle } = this.savedItemFields({
            label_values: item?.dict ?? [],
          });
          if (url) out.push({ url, ownerHandle });
        }
      }
    }
    return out;
  }
}
