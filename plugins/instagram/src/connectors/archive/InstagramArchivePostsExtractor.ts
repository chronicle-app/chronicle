import { Record } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/**
 * Extract feed posts and reels from an Instagram data export.
 *
 * Handles both export shapes: the newer `posts.json`, where media is nested
 * under a `label_values → "Media"` entry, and the older flat `posts_1.json`,
 * where each entry carries a `media[]` array directly. One record per post
 * (a carousel embodies several files); deduped by media pk across files.
 */
export class InstagramArchivePostsExtractor extends InstagramArchiveExtractor {
  static override description = 'Posts';
  static override recordTypes = ['posts'];
  static override default = true;
  static override defaultTransformer = InstagramTransformer;

  private static readonly FILES = [
    'your_instagram_activity/media/posts.json',
    'your_instagram_activity/media/posts_1.json',
    'your_instagram_activity/media/other_content.json',
  ];

  /** The media pk Instagram wrote into the export's own filename — its id for the post. */
  override keyOf(record: Record): string | null {
    return (record.data as { id?: string }).id ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    const seen = new Set<string>();
    let index = 0;

    for (const entry of await this.loadPostEntries()) {
      const media = this.mediaItems(entry)
        .filter(m => typeof m?.uri === 'string' && m.uri.includes('/'))
        .map(m => {
          const id = this.extractIdFromUri(m.uri);
          const kind = /\.mp4$/i.test(m.uri) ? 'video' : 'image';
          return {
            id,
            kind,
            path: this.archiveMediaPath(m.uri),
            mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
            creation_timestamp: m.creation_timestamp,
            title: m.title,
          };
        })
        .filter(m => m.path !== null);
      if (media.length === 0) continue;

      const { id } = media[0];
      if (seen.has(id)) continue;
      seen.add(id);

      const timestamp = entry.timestamp ?? media[0].creation_timestamp;
      if (!this.inRange(timestamp)) continue;
      if (this.shouldStopExtracting(index)) break;
      index++;

      yield this.createRecordWithArchiveContext(
        {
          type: 'posts',
          id,
          sourceFormat: this.isReel(entry) ? 'reel' : 'feed',
          // Newer exports carry the caption on the media item; the older flat
          // shape sometimes only on the post entry itself.
          caption: this.fixInstagramTextEncoding(media[0].title || entry.title || ''),
          timestamp: this.convertInstagramTimestamp(timestamp),
          media: media.map(({ id, kind, path, mimeType }) => ({
            id,
            kind,
            path,
            mimeType,
          })),
        },
        { originalData: entry }
      );
    }
  }

  /** Media items for an entry, from either the flat `media[]` or `label_values → "Media"`. */
  private mediaItems(entry: any): any[] {
    if (Array.isArray(entry?.media) && entry.media.length > 0) {
      return entry.media;
    }
    const out: any[] = [];
    for (const lv of entry?.label_values ?? []) {
      if (lv?.label === 'Media' && Array.isArray(lv.media)) out.push(...lv.media);
    }
    return out;
  }

  private isReel(entry: any): boolean {
    for (const lv of entry?.label_values ?? []) {
      if (lv?.label === 'Reel metadata') {
        const content = lv.dict ?? lv.value;
        if (Array.isArray(content) ? content.length > 0 : Boolean(content)) {
          return true;
        }
      }
    }
    return false;
  }

  private extractIdFromUri(uri: string): string {
    const filename = uri.split('/').pop();
    if (!filename) return uri;
    const match = filename.match(/^(\d+)_/);
    return match ? match[1] : filename.split('.')[0];
  }

  private async loadPostEntries(): Promise<any[]> {
    const entries: any[] = [];
    for (const file of InstagramArchivePostsExtractor.FILES) {
      try {
        const data = await this.readInstagramJson(file);
        if (Array.isArray(data)) entries.push(...data);
        else if (data && typeof data === 'object') entries.push(data);
      } catch {
        // File absent in this export shape; skip.
      }
    }
    return entries;
  }

  override async determineCount(): Promise<number | null> {
    try {
      let count = 0;
      const seen = new Set<string>();
      for (const entry of await this.loadPostEntries()) {
        const media = this.mediaItems(entry).filter(
          m =>
            typeof m?.uri === 'string' &&
            m.uri.includes('/') &&
            this.archiveMediaPath(m.uri) !== null
        );
        if (media.length === 0) continue;
        const id = this.extractIdFromUri(media[0].uri);
        if (seen.has(id)) continue;
        seen.add(id);
        count++;
      }
      return count;
    } catch {
      return null;
    }
  }
}
