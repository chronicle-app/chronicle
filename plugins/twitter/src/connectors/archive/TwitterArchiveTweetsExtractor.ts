import { Record, type Survey, type SurveyOptions, decodeEntities } from '@chronicle.app/etl';
import { type TweetMedia, bestVideo } from '../../utils/media.js';
import TwitterTransformer from '../TwitterTransformer.js';
import { TwitterArchiveExtractor } from './TwitterArchiveExtractor.js';

/** How far a long post's note may be from its tweet, in milliseconds. */
const NOTE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Your tweets, retweets, and replies, from `tweets.js`, and the ones you
 * deleted in the last two weeks, from `deleted-tweets.js`, each with when you
 * deleted it. A long post's text is in full, from `note-tweet.js`. An edited
 * tweet is its latest version.
 */
export class TwitterArchiveTweetsExtractor extends TwitterArchiveExtractor<
  typeof TwitterArchiveTweetsExtractor
> {
  static override description = 'Tweets';
  static override recordTypes = ['tweets'];
  static override default = true;
  static override defaultTransformer = TwitterTransformer;
  static override schema = TwitterArchiveExtractor.schema;

  /** The tweet id (`id_str`) — Twitter's own id, identical through any tool. */
  override keyOf(record: Record): string | null {
    return (record.data as { id?: string }).id ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    try {
      // Load account info first
      this.accountInfo = await this.loadAccountInfo();

      yield* this.processTweets();
    } catch (error) {
      throw new Error(`Failed to process Twitter tweets: ${error}`);
    }
  }

  private async *processTweets(): AsyncGenerator<Record> {
    try {
      const notes = await this.loadNotes();
      let count = 0;
      for (const tweet of await this.loadTweets()) {
        if (this.shouldStopExtracting(count)) break;

        yield this.createRecordWithArchiveContext(
          {
            type: 'tweet',
            id: tweet.id_str,
            text: noteFor(tweet, notes) ?? (tweet.full_text || tweet.text),
            created_at: this.convertTwitterDateToISO(tweet.created_at),
            favorite_count: Number.parseInt(tweet.favorite_count) || 0,
            retweet_count: Number.parseInt(tweet.retweet_count) || 0,
            in_reply_to_status_id: tweet.in_reply_to_status_id_str,
            in_reply_to_user_id: tweet.in_reply_to_user_id_str,
            in_reply_to_screen_name: tweet.in_reply_to_screen_name,
            entities: tweet.entities,
            source: tweet.source,
            retweeted: tweet.retweeted,
            ...coordinatesOf(tweet),
            ...(tweet.deleted_at && { deletedAt: new Date(tweet.deleted_at).toISOString() }),
            ...(await this.mediaOf(tweet)),
          },
          { originalData: tweet }
        );
        count++;
      }
    } catch (error) {
      this.logger.warn('Could not process tweets', { error: String(error) });
    }
  }

  /** A tweet's photos and videos, with the archive's copies of their files. */
  private async mediaOf(tweet: any): Promise<{ media?: TweetMedia[] }> {
    const items: any[] = tweet.extended_entities?.media ?? [];
    const media = await Promise.all(
      items.map(async (item): Promise<TweetMedia> => {
        const url =
          item.type === 'photo' ? item.media_url_https : bestVideo(item.video_info?.variants ?? []);
        const path = await this.mediaPath('tweets_media', tweet.id_str, url);
        return { id: item.id_str, type: item.type, ...(url && { url }), ...(path && { path }) };
      })
    );
    return media.length > 0 ? { media } : {};
  }

  /**
   * The archive's tweets within since and until, as it writes them: yours,
   * then the ones you deleted lately. An edited tweet's earlier versions are
   * left out, so it's its latest, as X shows it.
   */
  private async loadTweets() {
    const tweets = [
      ...(await this.readTweets('data/tweets.js', 'tweets')),
      ...(await this.readTweets('data/deleted-tweets.js', 'deleted_tweets')),
    ];
    return tweets.filter(
      tweet => !isEarlierVersion(tweet) && this.isWithinDateRange(new Date(tweet.created_at))
    );
  }

  /** One file's tweets, or none if the archive doesn't have it. */
  private async readTweets(path: string, name: string): Promise<any[]> {
    if (!(await this.files.has(path))) return [];
    const content = await this.files.readText(path);
    return this.parseTwitterJS(content, name)
      .map(item => item.tweet)
      .filter(Boolean);
  }

  /** The archive's long posts, each its text in full and when it was posted. */
  private async loadNotes(): Promise<Note[]> {
    if (!(await this.files.has('data/note-tweet.js'))) return [];
    const content = await this.files.readText('data/note-tweet.js');
    return this.parseTwitterJS(content, 'note_tweet')
      .map(item => item.noteTweet)
      .filter(note => note?.core?.text && note.createdAt)
      .map(note => ({ text: note.core.text, at: Date.parse(note.createdAt) }));
  }

  override async determineCount(): Promise<number | null> {
    try {
      return (await this.loadTweets()).length;
    } catch {
      return null;
    }
  }

  /** The tweets a run reads and when they were posted. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const tweets = await this.loadTweets();
    return {
      tweets: this.surveyOf(
        tweets.map(tweet => new Date(tweet.created_at)),
        options
      ),
    };
  }
}

/** A long post's text in full, and when it was posted. */
interface Note {
  text: string;
  at: number;
}

/**
 * A tweet's version list, from its own edit record: the tweet ids of every
 * version, first to latest.
 */
function versionsOf(tweet: any): string[] {
  return (
    tweet.edit_info?.initial?.editTweetIds ??
    tweet.edit_info?.edit?.editControlInitial?.editTweetIds ??
    []
  );
}

/** Whether a tweet is a version that a later edit replaced. */
function isEarlierVersion(tweet: any): boolean {
  const versions = versionsOf(tweet);
  return versions.length > 1 && versions.at(-1) !== tweet.id_str;
}

/**
 * A long post's text in full. Its tweet holds only the start, cut off with
 * `…` and a link to the rest, so the note is the one posted then whose text
 * starts with the tweet's.
 */
function noteFor(tweet: any, notes: Note[]): string | undefined {
  if (notes.length === 0) return undefined;
  const start = decodeEntities(tweet.full_text ?? '')
    .replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/, '')
    .replace(/(…|\.\.\.)\s*$/, '')
    .trim();
  if (start.length < 20) return undefined;
  const at = Date.parse(tweet.created_at);
  const near = notes
    .filter(
      note =>
        Math.abs(note.at - at) <= NOTE_WINDOW_MS && decodeEntities(note.text).startsWith(start)
    )
    .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at));
  return near[0]?.text;
}

/** Where a tweet was posted from, when it says: `coordinates` is longitude, then latitude. */
function coordinatesOf(tweet: any): { coordinates?: { latitude: number; longitude: number } } {
  const [longitude, latitude] = (tweet.coordinates?.coordinates ?? []).map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return {};
  return { coordinates: { latitude, longitude } };
}
