import { Record } from '@chronicle.app/etl';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FacebookArchiveExtractor } from './FacebookArchiveExtractor.js';
import FacebookTransformer from '../FacebookTransformer.js';

export class FacebookArchiveReactionsExtractor extends FacebookArchiveExtractor {
  static override recordTypes = ['reactions', 'comments'];
  static override description = 'Reactions, likes, and comments';
  static override default = false;
  static override defaultTransformer = FacebookTransformer;

  /**
   * The reaction's `fbid` — Facebook's own numeric id, carried verbatim by the
   * `label_values` export dialect. The data-array dialect and the comments file
   * carry no id at all, so those records are keyless.
   */
  override keyOf(record: Record): string | null {
    return (record.data as { fbid?: string }).fbid ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    await this.initialize();

    const processedReactions = new Set<string>();
    let recordCount = 0;

    for await (const { fullPath } of this.iterateExportSegments()) {
      for await (const record of this.extractReactionsFromSegment(fullPath, processedReactions)) {
        yield record;
        recordCount++;

        if (this.shouldStopExtracting(recordCount)) {
          return;
        }
      }
    }
  }

  private async *extractReactionsFromSegment(
    segmentPath: string,
    processedReactions: Set<string>
  ): AsyncGenerator<Record> {
    const reactionsPath = join(segmentPath, 'your_facebook_activity', 'comments_and_reactions');

    try {
      await stat(reactionsPath);
    } catch {
      // No reactions directory found
      return;
    }

    // Process different reaction/comment files
    yield* this.extractFromReactionsFile(
      reactionsPath,
      'likes_and_reactions.json',
      processedReactions
    );
    yield* this.extractFromReactionsFile(
      reactionsPath,
      'likes_and_reactions_1.json',
      processedReactions
    );
    yield* this.extractFromCommentsFile(reactionsPath, 'comments.json', processedReactions);
  }

  private async *extractFromReactionsFile(
    reactionsPath: string,
    fileName: string,
    processedReactions: Set<string>
  ): AsyncGenerator<Record> {
    const filePath = join(reactionsPath, fileName);

    try {
      await stat(filePath);
    } catch {
      return; // File doesn't exist
    }

    try {
      const data = await this.readFacebookJson(filePath);

      if (Array.isArray(data)) {
        // Handle array format (likes_and_reactions.json)
        yield* this.processReactionsArrayData(data, fileName, processedReactions);
      } else if (data.reactions_v2 || data.likes_and_reactions_v2) {
        // Handle object format with versioned arrays
        const reactions = data.reactions_v2 || data.likes_and_reactions_v2 || [];
        yield* this.processReactionsArrayData(reactions, fileName, processedReactions);
      }
    } catch {
      // Error reading reactions file
    }
  }

  private async *extractFromCommentsFile(
    reactionsPath: string,
    fileName: string,
    processedReactions: Set<string>
  ): AsyncGenerator<Record> {
    const filePath = join(reactionsPath, fileName);

    try {
      await stat(filePath);
    } catch {
      return; // File doesn't exist
    }

    try {
      const data = await this.readFacebookJson(filePath);

      if (data.comments_v2 && Array.isArray(data.comments_v2)) {
        yield* this.processCommentsData(data.comments_v2, fileName, processedReactions);
      }
    } catch {
      // Error reading comments file
    }
  }

  private async *processReactionsArrayData(
    reactions: any[],
    fileName: string,
    processedReactions: Set<string>
  ): AsyncGenerator<Record> {
    for (const reaction of reactions) {
      if (!reaction.timestamp) continue;

      // Skip reactions outside date range if configured
      if (!this.isWithinDateRange(new Date(reaction.timestamp * 1000))) {
        continue;
      }

      const reactionId = `reaction-${reaction.timestamp}-${fileName}-${this.hashReactionContent(reaction)}`;

      // Skip if already processed (avoid duplicates)
      if (processedReactions.has(reactionId)) {
        continue;
      }

      const processedReaction = this.parseReactionData(reaction, reactionId, fileName);

      if (processedReaction) {
        yield this.createRecordWithArchiveContext(processedReaction, {
          recordType: 'reactions',
          reactionType: processedReaction.reactionType,
          fileName,
          dataSource: 'reactions',
        });

        processedReactions.add(reactionId);
      }
    }
  }

  private async *processCommentsData(
    comments: any[],
    fileName: string,
    processedReactions: Set<string>
  ): AsyncGenerator<Record> {
    for (const commentEntry of comments) {
      if (!commentEntry.timestamp || !commentEntry.data) continue;

      // Skip comments outside date range if configured
      if (!this.isWithinDateRange(new Date(commentEntry.timestamp * 1000))) {
        continue;
      }

      const commentId = `comment-${commentEntry.timestamp}-${fileName}-${this.hashReactionContent(commentEntry)}`;

      // Skip if already processed (avoid duplicates)
      if (processedReactions.has(commentId)) {
        continue;
      }

      const processedComment = this.parseCommentData(commentEntry, commentId, fileName);

      if (processedComment) {
        yield this.createRecordWithArchiveContext(processedComment, {
          recordType: 'comments',
          reactionType: 'comment',
          fileName,
          dataSource: 'comments',
        });

        processedReactions.add(commentId);
      }
    }
  }

  private parseReactionData(reaction: any, reactionId: string, fileName: string): any | null {
    let reactionType = 'unknown';
    let contentUrl = null;
    let targetPerson = null;
    let targetPostId = null;
    let title = null;

    // Handle different reaction data formats
    if (reaction.label_values) {
      // Format: likes_and_reactions.json (label_values format)
      for (const labelValue of reaction.label_values) {
        switch (labelValue.label) {
          case 'Reaction':
            reactionType = labelValue.value.toLowerCase();
            break;
          case 'URL':
            contentUrl = labelValue.value;
            targetPostId = this.extractPostIdFromUrl(labelValue.value);
            break;
          case 'Name':
            targetPerson = labelValue.value;
            break;
        }
      }
    } else if (reaction.data && Array.isArray(reaction.data)) {
      // Format: likes_and_reactions_1.json (data array format)
      const reactionData = reaction.data[0]?.reaction;
      if (reactionData) {
        reactionType = reactionData.reaction ? reactionData.reaction.toLowerCase() : 'like';
        targetPerson = reactionData.actor;
      }
      title = reaction.title;
    }

    // Extract additional metadata
    const hasMedia = Boolean(reaction.media && reaction.media.length > 0);
    const { fbid } = reaction;

    return {
      id: reactionId,
      timestamp: this.convertFacebookTimestamp(reaction.timestamp * 1000),
      type: 'reaction',
      reactionType,
      contentUrl,
      targetPerson: targetPerson ? this.fixFacebookTextEncoding(targetPerson) : null,
      targetPostId,
      title: title ? this.fixFacebookTextEncoding(title) : null,
      hasMedia,
      fbid,
      fileName,
      rawData: reaction,
    };
  }

  private parseCommentData(commentEntry: any, commentId: string, fileName: string): any | null {
    if (!commentEntry.data || !Array.isArray(commentEntry.data) || !commentEntry.data[0]?.comment) {
      return null;
    }

    const { comment } = commentEntry.data[0];

    return {
      id: commentId,
      timestamp: this.convertFacebookTimestamp(commentEntry.timestamp * 1000),
      type: 'comment',
      reactionType: 'comment',
      commentText: comment.comment ? this.fixFacebookTextEncoding(comment.comment) : null,
      author: comment.author ? this.fixFacebookTextEncoding(comment.author) : null,
      title: commentEntry.title ? this.fixFacebookTextEncoding(commentEntry.title) : null,
      commentTimestamp: comment.timestamp
        ? this.convertFacebookTimestamp(comment.timestamp * 1000)
        : null,
      fileName,
      rawData: commentEntry,
    };
  }

  private extractPostIdFromUrl(url: string): string | null {
    if (!url) return null;

    // Extract post ID from Facebook URLs
    const patterns = [/\/posts\/([^/?]+)/, /story_fbid=([^&]+)/, /pfbid([^/?&]+)/];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }

  private hashReactionContent(reaction: any): string {
    // Create a simple hash of the reaction content for deduplication
    const content = JSON.stringify({
      label_values: reaction.label_values,
      data: reaction.data,
      title: reaction.title,
      fbid: reaction.fbid,
    });

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.codePointAt(i) ?? 0;
      hash = (hash * 33 + char) % 2_147_483_647; // Simple hash without bitwise operators
    }
    return Math.abs(hash).toString(36);
  }
}
