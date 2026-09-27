import { Record } from '@chronicle.app/etl';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

export class InstagramArchiveMessagesExtractor extends InstagramArchiveExtractor {
  static override description = 'Direct messages';

  static override recordTypes = ['messages'];
  static override default = false;
  static override defaultTransformer = InstagramTransformer;
  // extract() sorts every message by timestamp_ms descending before yielding,
  // which with keyOf opts this extractor into the frontier cursor.
  static override newestFirst = true;

  /**
   * The conversation folder + `timestamp_ms`, both the export's own identifiers —
   * the DM export carries no message id, and the millisecond alone is only
   * unique within a thread.
   */
  override keyOf(record: Record): string | null {
    return (record.data as { id?: string }).id ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    // account info and handle mapping are loaded by the base setup()

    try {
      // Collect all messages from both inbox and message requests
      const allMessages: any[] = [];

      // Process inbox messages
      const inboxMessages = await this.loadMessages('your_instagram_activity/messages/inbox');
      allMessages.push(...inboxMessages);

      // Process message requests
      const requestMessages = await this.loadMessages(
        'your_instagram_activity/messages/message_requests'
      );
      allMessages.push(...requestMessages);

      // Sort by timestamp descending (newest first)
      allMessages.sort((a, b) => b.timestamp_ms - a.timestamp_ms);

      // Apply limit and yield messages
      let count = 0;
      for (const message of allMessages) {
        if (this.shouldStopExtracting(count)) break;
        if (!this.inRange(message.timestamp_ms / 1000)) continue;

        yield this.createRecordWithArchiveContext(
          {
            type: 'messages',
            // Composite of two real export identifiers: timestamp_ms alone is
            // only unique within a thread — two conversations can carry the
            // same millisecond.
            id: `${message.conversation_id}/${message.timestamp_ms}`,
            conversation_id: message.conversation_id,
            conversation_handle: message.conversation_handle,
            conversation_title: message.conversation_title,
            sender_name: message.sender_name,
            timestamp_ms: message.timestamp_ms,
            created_at: new Date(message.timestamp_ms).toISOString(),
            content: this.fixInstagramTextEncoding(message.content),
            shared: this.buildSharedRef(message.share),
            photos: message.photos,
            reactions: message.reactions,
            participants: message.participants,
            is_message_request: message.is_message_request,
            thread_path: message.thread_path,
          },
          {
            originalData: message,
            conversationPath: message.thread_path,
          }
        );

        count++;
      }
    } catch (error) {
      throw new Error(`Failed to extract Instagram messages: ${error}`);
    }
  }

  /**
   * Resolve a message's `share` into a clean reference the transformer can build
   * an entity from: an Instagram post/reel (canonical shortcode), a shared
   * profile (handle), or an external link. `share_text` is the shared item's
   * caption — not the sender's message text — so it rides the reference, not the
   * message body.
   */
  private buildSharedRef(share: any): any {
    if (!share?.link) return undefined;
    const shortcode = this.shortcodeFromUrl(share.link) || undefined;
    return {
      shortcode,
      profileHandle: share.profile_share_username || undefined,
      // The post/reel permalink as exported (full share token); raw link otherwise.
      url: (shortcode && this.permalinkFromUrl(share.link)) || share.link,
      caption: this.fixInstagramTextEncoding(share.share_text) || undefined,
      owner: share.original_content_owner || undefined,
    };
  }

  private async loadMessages(messagesPath: string): Promise<any[]> {
    const config = this.config as any;
    const fullPath = join(config.input, messagesPath);
    const messages: any[] = [];

    try {
      const conversationDirs = await readdir(fullPath, { withFileTypes: true });

      for (const dir of conversationDirs) {
        if (!dir.isDirectory()) continue;

        try {
          const conversationPath = join(fullPath, dir.name);

          const conversationData = await this.readInstagramJson(
            join(messagesPath, dir.name, 'message_1.json')
          );

          if (conversationData && conversationData.messages) {
            const conversationId = dir.name;
            const isMessageRequest = messagesPath.includes('message_requests');

            for (const message of conversationData.messages) {
              const conversationHandle = this.extractHandleFromConversationId(conversationId);
              messages.push({
                ...message,
                conversation_id: conversationId,
                conversation_handle: conversationHandle,
                conversation_title: conversationData.title || conversationId,
                participants: conversationData.participants || [],
                is_message_request: isMessageRequest,
                thread_path: conversationData.thread_path || conversationPath,
              });
            }
          }
        } catch (error) {
          this.logger.warn(`Could not process conversation ${dir.name}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch {
      // A missing inbox/message_requests folder is a normal export shape.
      this.logger.verboseInfo(`No messages at ${messagesPath}`);
    }

    return messages;
  }

  override async determineCount(): Promise<number | null> {
    try {
      let totalMessages = 0;

      // Count inbox messages
      totalMessages += await this.countMessagesInPath('your_instagram_activity/messages/inbox');

      // Count message requests
      totalMessages += await this.countMessagesInPath(
        'your_instagram_activity/messages/message_requests'
      );

      return totalMessages;
    } catch {
      return null;
    }
  }

  private async countMessagesInPath(messagesPath: string): Promise<number> {
    const config = this.config as any;
    const fullPath = join(config.input, messagesPath);
    let messageCount = 0;

    try {
      const conversationDirs = await readdir(fullPath, { withFileTypes: true });

      for (const dir of conversationDirs) {
        if (!dir.isDirectory()) continue;

        try {
          const conversationData = await this.readInstagramJson(
            join(messagesPath, dir.name, 'message_1.json')
          );

          if (conversationData && conversationData.messages) {
            messageCount += conversationData.messages.length;
          }
        } catch {
          // Skip conversations we can't read
        }
      }
    } catch {
      // Skip if path doesn't exist
    }

    return messageCount;
  }
}
