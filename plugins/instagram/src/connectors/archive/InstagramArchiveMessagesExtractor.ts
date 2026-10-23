import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { posix } from 'node:path';
import { InstagramArchiveExtractor } from './InstagramArchiveExtractor.js';
import InstagramTransformer from '../InstagramTransformer.js';

// The folders of conversations: the inbox, then message requests.
const FOLDERS = [
  'your_instagram_activity/messages/inbox',
  'your_instagram_activity/messages/message_requests',
];

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
      for (const folder of FOLDERS) allMessages.push(...(await this.loadMessages(folder)));

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

  /** The messages a run reads and when, with how many conversations they're in. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const messages = this.emptySurvey(options);
    const conversations = new Set<string>();
    for (const folder of FOLDERS) {
      for await (const { name, data } of this.conversations(folder)) {
        for (const message of data.messages) {
          if (!this.inRange(message.timestamp_ms / 1000)) continue;
          this.tally(messages, new Date(message.timestamp_ms));
          conversations.add(name);
        }
      }
    }
    return {
      messages: {
        ...messages,
        measures: [{ key: 'conversations', label: 'conversations', value: conversations.size }],
      },
    };
  }

  private async loadMessages(messagesPath: string): Promise<any[]> {
    const messages: any[] = [];
    const isMessageRequest = messagesPath.includes('message_requests');

    for await (const { name, path, data } of this.conversations(messagesPath)) {
      const conversationHandle = this.extractHandleFromConversationId(name);
      for (const message of data.messages) {
        messages.push({
          ...message,
          conversation_id: name,
          conversation_handle: conversationHandle,
          conversation_title: data.title || name,
          participants: data.participants || [],
          is_message_request: isMessageRequest,
          thread_path: data.thread_path || path,
        });
      }
    }

    return messages;
  }

  /**
   * Each conversation in a folder of them, by its folder's name, with the
   * thread its `message_1.json` holds. One that can't be read is skipped.
   */
  private async *conversations(
    messagesPath: string
  ): AsyncGenerator<{ name: string; path: string; data: any }> {
    let names: string[] = [];
    try {
      names = (await this.files.children(messagesPath))
        .filter(entry => entry.endsWith('/'))
        .map(entry => entry.slice(0, -1));
    } catch {
      // A folder that can't be listed reads as missing.
    }
    if (names.length === 0) {
      // A missing inbox/message_requests folder is a normal export shape.
      this.logger.verboseInfo(`No messages at ${messagesPath}`);
      return;
    }

    for (const name of names) {
      const path = posix.join(messagesPath, name);
      let data: any;
      try {
        data = await this.readInstagramJson(posix.join(path, 'message_1.json'));
      } catch (error) {
        this.logger.warn(`Could not process conversation ${name}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (Array.isArray(data?.messages)) yield { name, path, data };
    }
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
    let messageCount = 0;

    try {
      const conversationDirs = (await this.files.children(messagesPath))
        .filter(entry => entry.endsWith('/'))
        .map(entry => entry.slice(0, -1));

      for (const name of conversationDirs) {
        try {
          const conversationData = await this.readInstagramJson(
            posix.join(messagesPath, name, 'message_1.json')
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
