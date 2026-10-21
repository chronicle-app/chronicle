import {
  ChronicleTransformer,
  Record,
  createImageObject,
  createAudioObject,
  htmlToMarkdown,
  tidyText,
} from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Agent,
  AgentAndChildren,
  Entity,
  Organization,
  PodcastSeries,
  PodcastEpisode,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/apple';

// Apple's library has null/empty values across most optional columns. The schema
// treats optional fields as absent-or-undefined (never null), so coalesce to a
// trimmed string or undefined and omit the field when there's nothing to set.
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// A publisher that retires a show can retitle it and its episodes "Podcast no
// longer available". That names neither, so it's no title, and a title an
// earlier run extracted stays.
function title(value: unknown): string | undefined {
  const text = str(value);
  return text?.toLowerCase() === 'podcast no longer available' ? undefined : text;
}

// Apple keeps an episode's description as HTML; Markdown here.
function markdown(value: unknown): string | undefined {
  const html = str(value);
  return html && str(tidyText(htmlToMarkdown(html) ?? ''));
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

// Unix seconds (as converted by the extractor) → Date, or undefined when absent.
function date(unixSeconds: unknown): Date | undefined {
  return typeof unixSeconds === 'number' && unixSeconds > 0
    ? new Date(unixSeconds * 1000)
    : undefined;
}

// Apple's catalog ID for a show, an episode, or a channel (the podcasts.apple.com
// ID), the same on each device, as a key; undefined when it isn't in the
// catalog. The library's own UUIDs differ from one device to the next.
function catalogId(storeId: unknown): string | undefined {
  return typeof storeId === 'number' && storeId > 0 ? String(storeId) : undefined;
}

// A show's page on Apple Podcasts, or one of its episodes', by their catalog
// IDs. A feed's own link for an episode or a show is often the show's or the
// network's home page, which would merge every node that has it, so `url` is
// Apple's page instead, and the feed's link is a page it references.
function applePage(showId: string, episodeId?: string): string {
  const page = `https://podcasts.apple.com/podcast/id${showId}`;
  return episodeId ? `${page}?i=${episodeId}` : page;
}

// Episode artwork is stored as an mzstatic template with `{w}x{h}bb.{f}`
// placeholders; fill them in for a concrete, fetchable image URL.
function feedLink(value: unknown): Entity[] | undefined {
  const url = str(value);
  return url && isHttpUrl(url) ? [{ '@type': 'Entity', '@key': ['url'], url }] : undefined;
}

function resolveArtwork(template: string): string {
  return template.replace('{w}', '600').replace('{h}', '600').replace('{f}', 'jpg');
}

const SOURCE = 'apple-podcasts';

export default class ApplePodcastsTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType === 'listens') {
      return this.buildEpisodeActions(record);
    }
    if (record.extraction.recordType === 'subscriptions') {
      return this.buildSubscriptionActions(record);
    }
    return [];
  }

  // A played/bookmarked episode fans out into the acts it took part in: a
  // ListenAction (and a CompleteAction once finished) and a BookmarkAction.
  private async buildEpisodeActions(record: Record): Promise<ActionAndChildren[]> {
    const { data } = record;
    const actions: ActionAndChildren[] = [];

    // The extractor leaves out episodes that aren't in Apple's catalog.
    const sourceId = catalogId(data.storeTrackId);
    if (!sourceId) throw new Error('An Apple Podcasts episode has no catalog ID');

    const user = await this.buildUser(record);
    const podcast = this.buildPodcast(data);
    const episode = this.buildEpisode(data, sourceId, podcast);

    // The real listen moment: Apple's last-played time, then the user-marked
    // played date, then when the playback position last synced (many played
    // episodes have no last-played time), falling back to the play-state change
    // time, which feed refreshes and library-wide updates also change.
    const listenAt = date(
      data.lastDatePlayed ??
        data.userMarkedPlayedDate ??
        data.playbackSyncedDate ??
        data.stateModified
    );

    const played = data.playCount > 0 || data.playhead > 10;
    if (played) {
      actions.push({
        '@type': 'ListenAction',
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId,
        ...(listenAt && { timestamp: listenAt }),
        agent: user,
        object: episode,
      } as ActionAndChildren);

      // A non-zero play count means the episode was finished at least once —
      // closing the `consuming` interval the ListenAction opened.
      if (data.playCount > 0) {
        actions.push({
          '@type': 'CompleteAction',
          '@key': ['@type', 'source', 'sourceId'],
          source: SOURCE,
          sourceId,
          ...(listenAt && { timestamp: listenAt }),
          agent: user,
          object: episode,
        } as ActionAndChildren);
      }
    }

    if (data.isBookmarked) {
      const bookmarkedAt = date(data.lastBookmarkedDate) ?? listenAt;
      actions.push({
        '@type': 'BookmarkAction',
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId,
        ...(bookmarkedAt && { timestamp: bookmarkedAt }),
        agent: user,
        object: episode,
      } as ActionAndChildren);
    }

    return actions;
  }

  // A subscribed show becomes a FollowAction dated when it was added to the
  // library — capturing shows the user follows even if they never played one.
  private async buildSubscriptionActions(record: Record): Promise<ActionAndChildren[]> {
    const { data } = record;
    // The extractor leaves out followed shows that aren't in Apple's catalog.
    const podcast = this.buildPodcast(data);
    if (!podcast) throw new Error('A followed Apple Podcasts show has no catalog ID');
    const user = await this.buildUser(record);
    const followedAt = date(data.addedDate);

    return [
      {
        '@type': 'FollowAction',
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId: podcast.sourceId,
        ...(followedAt && { timestamp: followedAt }),
        agent: user,
        object: podcast,
      } as ActionAndChildren,
    ];
  }

  private async buildUser(record: Record): Promise<AgentAndChildren> {
    // The listener is the macOS iCloud account, so Apple Podcasts listening
    // merges onto the same person as other iCloud-sourced data. Keyed on the
    // account's DSID/email by buildICloudPersonSchema. The extractor stops
    // when it can't find the account, so every record names one.
    const user = await buildICloudPersonSchema(record.context.account);
    if (!user) throw new Error('An Apple Podcasts record has no Apple Account');
    return user as AgentAndChildren;
  }

  // The show, keyed by its catalog ID; undefined when it isn't in the catalog.
  private buildPodcast(data: any): PodcastSeries | undefined {
    const sourceId = catalogId(data.storeCollectionId);
    if (!sourceId) return undefined;
    // The feed's address when the show was followed, unless the feed has moved
    // since, which the library notes. The old address redirects to the new.
    const feed = str(data.updatedFeedUrl) ?? str(data.feedUrl);
    const image = str(data.imageUrl);
    const category = str(data.podcastCategory);
    return {
      '@type': 'PodcastSeries',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId,
      url: applePage(sourceId),
      ...(title(data.podcastTitle) && { name: title(data.podcastTitle) }),
      ...(markdown(data.podcastDescription) && {
        description: markdown(data.podcastDescription),
      }),
      ...(feed && isHttpUrl(feed) && { webFeed: [feed] }),
      ...(feedLink(data.podcastWebUrl) && { references: feedLink(data.podcastWebUrl) }),
      ...(category && { genre: [category] }),
      ...(image &&
        isHttpUrl(image) && {
          emblem: createImageObject({ url: image }),
        }),
      ...(this.author(data.podcastAuthor) && { author: this.author(data.podcastAuthor) }),
      ...(this.publisher(data) && { publisher: this.publisher(data) }),
    };
  }

  private buildEpisode(
    data: any,
    sourceId: string,
    podcast: PodcastSeries | undefined
  ): PodcastEpisode {
    // The audio file lives on `contains`, not `url`, so the episode isn't
    // merged with its own AudioObject through their url.
    const audio = str(data.audioUrl);
    const artwork = str(data.artworkUrl);
    return {
      '@type': 'PodcastEpisode',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId,
      ...(title(data.episodeTitle) && { name: title(data.episodeTitle) }),
      ...(markdown(data.episodeDescription) && {
        description: markdown(data.episodeDescription),
      }),
      ...(podcast?.sourceId && { url: applePage(podcast.sourceId, sourceId) }),
      ...(feedLink(data.webUrl) && { references: feedLink(data.webUrl) }),
      ...(data.duration && { duration: this.formatDuration(data.duration) }),
      ...(date(data.publishDate) && { datePublished: date(data.publishDate) }),
      ...(artwork &&
        isHttpUrl(artwork) && {
          emblem: createImageObject({ url: resolveArtwork(artwork) }),
        }),
      ...(audio &&
        isHttpUrl(audio) && {
          contains: [createAudioObject({ url: audio })],
        }),
      ...(str(data.transcript) && { transcript: str(data.transcript) }),
      ...(podcast && { series: [podcast] }),
      ...(this.author(data.episodeAuthor) && { author: this.author(data.episodeAuthor) }),
    };
  }

  // The author the feed names for a show or an episode. It can be a host, a
  // network, or several people in one name, so it's an Agent rather than a
  // Person or an Organization, keyed by that name, which is all there is.
  private author(name: unknown): Agent[] | undefined {
    const text = str(name);
    if (!text) return undefined;
    return [{ '@type': 'Agent', '@key': ['@type', 'source', 'name'], source: SOURCE, name: text }];
  }

  // The show's publisher: its channel on Apple Podcasts, keyed by the channel's
  // catalog ID. A show published independently has none.
  private publisher(data: any): Organization[] | undefined {
    const sourceId = catalogId(data.channelStoreId);
    if (!sourceId) return undefined;
    return [
      {
        '@type': 'Organization',
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId,
        url: `https://podcasts.apple.com/channel/id${sourceId}`,
        ...(str(data.channelName) && { name: str(data.channelName) }),
      },
    ];
  }

  // An ISO 8601 duration in whole seconds, such as `PT3121S`.
  private formatDuration(seconds: number): string {
    return `PT${Math.floor(seconds)}S`;
  }
}
