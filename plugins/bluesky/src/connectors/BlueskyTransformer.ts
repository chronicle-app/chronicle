import { ChronicleTransformer, Record, createImageObject } from '@chronicle.app/etl';

import {
  ActionAndChildren,
  Agent,
  FollowAction,
  LikeAction,
  PublishAction,
  Post,
} from '@chronicle.app/schema';

export default class BlueskyTransformer extends ChronicleTransformer {
  /** DID of the authenticated account (the "me"), set per record from context. */
  private meDid?: string;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    const type = record.extraction.recordType;
    // record.context.agent is the authenticated account; remember its DID so the
    // shared buildUser tags only the owner, not followed users/authors.
    // Safe as a per-record field: transform builds synchronously below, with no
    // await between this assignment and the buildUser calls.
    this.meDid = record.context.agent?.did;
    this.logger.debug('Transforming Bluesky record', { recordType: type });

    const actions: ActionAndChildren[] = [];

    switch (type) {
      case 'likes': {
        actions.push(
          this.buildLike({
            post: record.data.post,
            agent: record.context.agent,
            timestamp: record.context.atprotoRecord.value.createdAt,
          }),
          this.buildPublish({
            post: record.data.post,
          })
        );

        break;
      }

      case 'follows': {
        actions.push(
          this.buildFollow({
            account: record.data,
            agent: record.context.agent,
            timestamp: record.context.atprotoRecord.value.createdAt,
            recordUri: record.data.viewer.following,
          })
        );

        break;
      }

      case 'followers': {
        actions.push(
          this.buildFollow({
            account: record.context.agent,
            agent: record.data,
            timestamp: record.context.atprotoRecord.value.createdAt,
            recordUri: record.data.viewer.followedBy,
          })
        );

        break;
      }

      default: {
        return [];
      }
    }

    this.logger.verboseInfo(`Generated ${actions.length} actions from Bluesky ${type} record`);
    return actions;
  }

  private buildFollow({
    account,
    agent,
    timestamp,
    recordUri,
  }: {
    account: any;
    agent: any;
    recordUri: string;
    timestamp: string;
  }): FollowAction {
    return {
      '@type': 'FollowAction',
      source: 'bluesky',
      sourceId: this.uriToId(recordUri),
      timestamp: new Date(timestamp),
      '@key': ['@type', 'source', 'sourceId'],
      agent: this.buildUser(agent),
      object: this.buildUser(account),
    };
  }

  private buildLike({
    post,
    agent,
    timestamp,
  }: {
    agent: any;
    post: any;
    timestamp: string;
  }): LikeAction {
    return {
      '@type': 'LikeAction',
      source: 'bluesky',
      sourceId: this.uriToId(post.viewer.like),
      timestamp: new Date(timestamp),
      '@key': ['@type', 'source', 'sourceId'],
      agent: this.buildUser(agent),
      object: this.buildPost(post),
    };
  }

  private buildPublish({ post }: { post: any }): PublishAction {
    return {
      '@type': 'PublishAction',
      source: 'bluesky',
      sourceId: this.uriToId(post.uri),
      timestamp: new Date(post.record.createdAt),
      '@key': ['@type', 'source', 'sourceId'],
      agent: this.buildUser(post.author),
      object: this.buildPost(post),
    };
  }

  private buildPost(post: any): Post {
    const posting: Post = {
      '@type': 'Post',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'bluesky',
      sourceId: this.uriToId(post.uri),
      body: post.record.text,
      author: [this.buildUser(post.author)],
    };

    // Extract images from embed data - based on app.bsky.embed.images#view structure
    // Put all images in the contains property instead of the image field
    if (post.embed?.$type === 'app.bsky.embed.images#view' && post.embed.images?.length > 0) {
      posting.contains = post.embed.images.map((img: any) => {
        const imageOptions: any = {
          url: img.fullsize,
          width: img.aspectRatio?.width,
          height: img.aspectRatio?.height,
        };

        // Only include description if it's not empty
        if (img.alt && img.alt.trim() !== '') {
          imageOptions.description = img.alt;
        }

        return createImageObject(imageOptions);
      });
    }

    return posting;
  }

  private buildUser(agentProfile: any): Agent {
    const agent: Agent = {
      '@type': 'Agent',
      source: 'bluesky',
      sourceId: agentProfile.did,
      '@key': ['@type', 'source', 'sourceId'],
      name: agentProfile.displayName,
      description: agentProfile.description,
    };
    // Tag the owner by identity (DID): this builder also constructs followed
    // accounts and post authors, so match only the authenticated account.
    if (this.meDid && agentProfile.did === this.meDid)
      agent.sameAs = [...(agent.sameAs ?? []), '@me'];
    return agent;
  }

  private uriToId(uri: string): string | undefined {
    return uri.split('://').pop();
  }
}
