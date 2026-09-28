import { Record } from '@chronicle.app/etl';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import TwitterTransformer from '../TwitterTransformer.js';
import { TwitterArchiveExtractor } from './TwitterArchiveExtractor.js';

export class TwitterArchiveDirectMessagesExtractor extends TwitterArchiveExtractor<
  typeof TwitterArchiveDirectMessagesExtractor
> {
  static override description = 'Direct messages';

  static override recordTypes = ['direct-messages', 'group-direct-messages'];
  static override defaultTransformer = TwitterTransformer;
  // extract() sorts every message by created_at descending before yielding,
  // which with keyOf opts this extractor into the frontier cursor.
  static override newestFirst = true;
  static override schema = TwitterArchiveExtractor.schema;

  /** The DM's message id — Twitter's own id, identical through any tool. */
  override keyOf(record: Record): string | null {
    return (record.data as { id?: string }).id ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof TwitterArchiveDirectMessagesExtractor.schema>;

    try {
      // Load account info first
      await this.loadAccountInfoFrom(config.input);

      // Collect all messages from both sources
      const allMessages: any[] = [];

      // Process 1:1 direct messages
      const oneOnOneMessages = await this.loadDirectMessages(
        `${config.input}/data/direct-messages.js`
      );
      allMessages.push(...oneOnOneMessages);

      // Process group direct messages (if enabled)
      if (config['include-group-dms']) {
        const groupMessages = await this.loadGroupDirectMessages(
          `${config.input}/data/direct-messages-group.js`
        );
        allMessages.push(...groupMessages);
      }

      // Sort by timestamp descending (newest first)
      allMessages.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      // Yield messages in chronological order (newest first)
      let count = 0;
      for (const message of allMessages) {
        if (this.shouldStopExtracting(count)) break;
        if (this.isWithinDateRange(new Date(message.created_at))) {
          yield this.createRecordWithArchiveContext(message.data, message.metadata);
          count++;
        }
      }
    } catch (error) {
      throw new Error(`Failed to process Twitter direct messages: ${error}`);
    }
  }

  private async loadDirectMessages(filePath: string): Promise<any[]> {
    const messages: any[] = [];

    try {
      const content = await readFile(filePath, 'utf-8');
      const jsData = this.parseTwitterJS(content, 'direct_messages');

      for (const item of jsData) {
        const conversation = item.dmConversation;
        if (conversation && conversation.messages) {
          for (const message of conversation.messages) {
            const msg = message.messageCreate;
            if (msg) {
              messages.push({
                created_at: msg.createdAt,
                data: {
                  type: 'direct-message',
                  id: msg.id,
                  conversationId: conversation.conversationId,
                  senderId: msg.senderId,
                  recipientId: msg.recipientId,
                  text: msg.text,
                  created_at: msg.createdAt,
                  mediaUrls: msg.mediaUrls,
                  urls: msg.urls,
                },
                metadata: { originalData: msg },
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Could not process 1:1 direct messages: ${error}`);
    }

    return messages;
  }

  private async loadGroupHeaders(filePath: string): Promise<Map<string, any>> {
    const groupHeaders = new Map<string, any>();

    try {
      const content = await readFile(filePath, 'utf-8');
      const jsData = this.parseTwitterJS(content, 'direct_message_group_headers');

      for (const item of jsData) {
        const conversation = item.dmConversation;
        if (conversation) {
          // Find the joinConversation event to get participants
          const joinEvent = conversation.messages?.find((msg: any) => msg.joinConversation);
          if (joinEvent) {
            groupHeaders.set(conversation.conversationId, {
              conversationId: conversation.conversationId,
              participants: joinEvent.joinConversation.participantsSnapshot || [],
              initiator: joinEvent.joinConversation.initiatingUserId,
            });
          }
        }
      }
    } catch (error) {
      console.warn(`Could not load group headers: ${error}`);
    }

    return groupHeaders;
  }

  private async loadGroupDirectMessages(filePath: string): Promise<any[]> {
    const messages: any[] = [];

    try {
      // First load group headers to get participant info
      const groupHeaders = await this.loadGroupHeaders(
        `${filePath.replace('direct-messages-group.js', 'direct-message-group-headers.js')}`
      );

      const content = await readFile(filePath, 'utf-8');
      const jsData = this.parseTwitterJS(content, 'direct_messages_group');

      for (const item of jsData) {
        const conversation = item.dmConversation;
        if (conversation && conversation.messages) {
          const groupInfo = groupHeaders.get(conversation.conversationId);

          for (const message of conversation.messages) {
            // Only process messageCreate events (actual messages), skip other events
            if (message.messageCreate) {
              const msg = message.messageCreate;

              messages.push({
                created_at: msg.createdAt,
                data: {
                  type: 'group-direct-message',
                  id: msg.id,
                  conversationId: conversation.conversationId,
                  senderId: msg.senderId,
                  participants: groupInfo?.participants || [],
                  text: msg.text || '',
                  created_at: msg.createdAt,
                  mediaUrls: msg.mediaUrls || [],
                  urls: msg.urls || [],
                },
                metadata: {
                  recordType: 'group-direct-messages',
                  originalData: msg,
                  groupInfo,
                },
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn(`Could not process group direct messages: ${error}`);
    }

    return messages;
  }

  override async determineCount(): Promise<number | null> {
    const config = this.config as z.infer<typeof TwitterArchiveDirectMessagesExtractor.schema>;

    try {
      let totalMessages = 0;

      // Count 1:1 direct messages
      try {
        const dmContent = await readFile(`${config.input}/data/direct-messages.js`, 'utf-8');
        const dmData = this.parseTwitterJS(dmContent, 'direct_messages');
        for (const item of dmData) {
          const conversation = item.dmConversation;
          if (conversation && conversation.messages) {
            totalMessages += conversation.messages.filter((msg: any) => msg.messageCreate).length;
          }
        }
      } catch {
        // 1:1 DMs file may not exist
      }

      // Count group direct messages (if enabled)
      if (config['include-group-dms']) {
        try {
          const groupContent = await readFile(
            `${config.input}/data/direct-messages-group.js`,
            'utf-8'
          );
          const groupData = this.parseTwitterJS(groupContent, 'direct_messages_group');
          for (const item of groupData) {
            const conversation = item.dmConversation;
            if (conversation && conversation.messages) {
              totalMessages += conversation.messages.filter((msg: any) => msg.messageCreate).length;
            }
          }
        } catch {
          // Group DMs file may not exist
        }
      }

      return totalMessages;
    } catch {
      return null;
    }
  }
}
