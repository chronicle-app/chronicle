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
  AgentAndChildren,
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

// Episode artwork is stored as an mzstatic template with `{w}x{h}bb.{f}`
// placeholders; fill them in for a concrete, fetchable image URL.
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

    const user = await this.buildUser(record);
    const podcast = this.buildPodcast(data);
    const episode = this.buildEpisode(data, podcast);

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
        sourceId: data.episodeId,
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
          sourceId: data.episodeId,
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
        sourceId: data.episodeId,
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
    const user = await this.buildUser(record);
    const podcast = this.buildPodcast(data);
    const followedAt = date(data.addedDate);

    return [
      {
        '@type': 'FollowAction',
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId: data.podcastId,
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

  private buildPodcast(data: any): PodcastSeries {
    const feed = str(data.feedUrl);
    const image = str(data.imageUrl);
    const category = str(data.podcastCategory);
    const sameAs = this.storeSameAs(
      'PodcastSeries',
      data.storeCollectionId,
      str(data.podcastTitle)
    );
    return {
      '@type': 'PodcastSeries',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: data.podcastId,
      ...(str(data.podcastTitle) && { name: str(data.podcastTitle) }),
      ...(markdown(data.podcastDescription) && {
        description: markdown(data.podcastDescription),
      }),
      ...(feed && isHttpUrl(feed) && { webFeed: feed }),
      ...(category && { genre: [category] }),
      ...(image &&
        isHttpUrl(image) && {
          emblem: createImageObject({ url: image }),
        }),
      ...(this.publisher(data.podcastAuthor) && {
        publisher: this.publisher(data.podcastAuthor),
      }),
      ...(sameAs && { sameAs }),
    };
  }

  private buildEpisode(data: any, podcast: PodcastSeries): PodcastEpisode {
    // `url` is the episode's web page only. The audio file lives on `contains`;
    // keeping it out of `url` avoids fusing the episode with its own AudioObject
    // through the shared `{url}` identity hub (shred auto-keys any node by url).
    const url = str(data.webUrl);
    const audio = str(data.audioUrl);
    const artwork = str(data.artworkUrl);
    const sameAs = this.storeSameAs('PodcastEpisode', data.storeTrackId, str(data.episodeTitle));
    return {
      '@type': 'PodcastEpisode',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: data.episodeId,
      ...(str(data.episodeTitle) && { name: str(data.episodeTitle) }),
      ...(markdown(data.episodeDescription) && {
        description: markdown(data.episodeDescription),
      }),
      ...(url && { url }),
      ...(data.duration && { duration: this.formatDuration(data.duration) }),
      ...(artwork &&
        isHttpUrl(artwork) && {
          emblem: createImageObject({ url: resolveArtwork(artwork) }),
        }),
      ...(audio &&
        isHttpUrl(audio) && {
          contains: [createAudioObject({ url: audio })],
        }),
      ...(str(data.transcript) && { transcript: str(data.transcript) }),
      series: [podcast],
      ...(this.publisher(data.episodeAuthor) && {
        publisher: this.publisher(data.episodeAuthor),
      }),
      ...(sameAs && { sameAs }),
    };
  }

  // The feed's author/network as an Organization publisher. Keyed on the name —
  // the only handle Apple gives for it — so repeated authors collapse. Returns
  // undefined when there is no author, so the slot is omitted rather than nulled.
  private publisher(author: unknown): Organization[] | undefined {
    const name = str(author);
    if (!name) return undefined;
    return [
      {
        '@type': 'Organization',
        '@key': ['@type', 'source', 'name'],
        source: SOURCE,
        name,
      },
    ];
  }

  // A sameAs edge to Apple's public catalog id (the podcasts.apple.com id), a
  // real Apple-issued handle distinct from the local library UUID we key on — so
  // the show/episode merges with anything else referencing the catalog id.
  private storeSameAs(
    type: 'PodcastSeries' | 'PodcastEpisode',
    storeId: unknown,
    name?: string
  ): any[] | undefined {
    if (typeof storeId !== 'number' || storeId <= 0) return undefined;
    return [
      {
        '@type': type,
        '@key': ['@type', 'source', 'sourceId'],
        source: SOURCE,
        sourceId: String(storeId),
        ...(name && { name }),
      },
    ];
  }

  // An ISO 8601 duration in whole seconds, such as `PT3121S`.
  private formatDuration(seconds: number): string {
    return `PT${Math.floor(seconds)}S`;
  }
}
