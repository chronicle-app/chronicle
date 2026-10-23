import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/** One of a post's media files, as a run reads it. */
interface PostMedia {
  id: string;
  kind: 'image' | 'video';
  path: string;
  mimeType: string;
  creation_timestamp?: number;
  title?: string;
}

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
    let index = 0;

    for await (const { entry, media, timestamp } of this.posts(uri => this.archiveMediaPath(uri))) {
      if (!this.inRange(timestamp)) continue;
      if (this.shouldStopExtracting(index)) break;
      index++;

      yield this.createRecordWithArchiveContext(
        {
          type: 'posts',
          id: media[0].id,
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

  /**
   * The posts a run reads and when each was posted. Their media files aren't
   * looked for, so a post whose files a zip is missing still counts.
   */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const posts = this.emptySurvey(options);
    for await (const { timestamp } of this.posts(uri => this.archiveMediaFile(uri))) {
      if (this.inRange(timestamp)) this.tally(posts, new Date(timestamp * 1000));
    }
    return { posts };
  }

  /**
   * Each post once, with its media and when it was posted. `locate` gives a
   * media file's path, or null to leave the file out; a post left with none
   * is skipped. Deduped by the first file's media pk, across files.
   */
  private async *posts(
    locate: (uri: string) => Promise<string | null> | string | null
  ): AsyncGenerator<{ entry: any; media: PostMedia[]; timestamp: number }> {
    const seen = new Set<string>();
    for (const entry of await this.loadPostEntries()) {
      const media: PostMedia[] = [];
      for (const m of this.mediaItems(entry)) {
        if (typeof m?.uri !== 'string' || !m.uri.includes('/')) continue;
        const path = await locate(m.uri);
        if (path === null) continue;
        const kind = /\.mp4$/i.test(m.uri) ? 'video' : 'image';
        media.push({
          id: this.extractIdFromUri(m.uri),
          kind,
          path,
          mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
          creation_timestamp: m.creation_timestamp,
          title: m.title,
        });
      }
      if (media.length === 0) continue;

      const { id } = media[0];
      if (seen.has(id)) continue;
      seen.add(id);

      yield { entry, media, timestamp: entry.timestamp ?? media[0].creation_timestamp };
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
      const posts = this.posts(uri => this.archiveMediaFile(uri));
      while (!(await posts.next()).done) count++;
      return count;
    } catch {
      return null;
    }
  }
}
