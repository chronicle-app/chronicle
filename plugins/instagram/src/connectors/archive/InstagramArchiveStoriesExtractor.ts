import { Record } from '@chronicle.app/etl';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

/**
 * Extract Instagram stories (photo and video) from a data export.
 *
 * `stories.json` → `ig_stories[]`; each item is exactly one media file whose
 * `uri` carries the media pk (`media/stories/YYYYMM/<pk>.<jpg|mp4>`). Photos and
 * videos are distinguished by extension, confirmed against `media_metadata`
 * (`photo_metadata` vs `video_metadata`). No public permalink exists; the owner-
 * private archive link `https://www.instagram.com/stories/archive/<pk>/` is stable.
 */
export class InstagramArchiveStoriesExtractor extends InstagramArchiveExtractor {
  static override description = 'Stories';
  static override recordTypes = ['stories'];
  static override default = false;
  static override defaultTransformer = InstagramTransformer;

  private static readonly FILE = 'your_instagram_activity/media/stories.json';

  /** The media pk Instagram wrote into the export's own filename — its id for the story. */
  override keyOf(record: Record): string | null {
    return (record.data as { id?: string }).id ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    // Absent in exports where the account posted no stories — not an error.
    let data: any;
    try {
      data = await this.readInstagramJson(InstagramArchiveStoriesExtractor.FILE);
    } catch {
      this.logger.warn('No stories.json in this export; nothing to extract');
      return;
    }
    const stories = data?.ig_stories;
    if (!Array.isArray(stories)) {
      this.logger.warn('Instagram stories.json missing ig_stories array');
      return;
    }

    for (const [index, story] of stories.entries()) {
      if (this.shouldStopExtracting(index)) break;
      if (!story?.uri) continue;
      if (!this.inRange(story.creation_timestamp)) continue;

      const id = this.extractIdFromUri(story.uri);
      const kind = this.mediaKind(story);
      const path = this.archiveMediaPath(story.uri);
      if (!path) continue;

      yield this.createRecordWithArchiveContext(
        {
          type: 'stories',
          id,
          sourceFormat: 'story',
          visibility: 'private',
          url: `https://www.instagram.com/stories/archive/${id}/`,
          caption: this.fixInstagramTextEncoding(story.title || ''),
          timestamp: this.convertInstagramTimestamp(story.creation_timestamp),
          media: {
            id,
            kind,
            path,
            mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
          },
        },
        { originalData: story }
      );
    }
  }

  /** Photo vs video from the file extension, confirmed by media_metadata. */
  private mediaKind(story: any): 'image' | 'video' {
    const isVideoExt = /\.mp4$/i.test(story.uri);
    const hasVideoMeta = Boolean(story.media_metadata?.video_metadata);
    return isVideoExt || hasVideoMeta ? 'video' : 'image';
  }

  /** The media pk is the filename stem (single-numeric in current exports). */
  private extractIdFromUri(uri: string): string {
    const filename = uri.split('/').pop();
    if (!filename) return uri;
    const match = filename.match(/^(\d+)_/);
    return match ? match[1] : filename.split('.')[0];
  }

  override async determineCount(): Promise<number | null> {
    try {
      const data = await this.readInstagramJson(InstagramArchiveStoriesExtractor.FILE);
      return Array.isArray(data?.ig_stories) ? data.ig_stories.length : null;
    } catch {
      return null;
    }
  }
}
