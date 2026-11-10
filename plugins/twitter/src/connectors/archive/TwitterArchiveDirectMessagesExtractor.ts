import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { z } from 'zod';
import { type TweetMedia, fileName } from '../../utils/media.js';
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
    try {
      // Load account info first
      this.accountInfo = await this.loadAccountInfo();

      // Collect all messages from both sources
      const allMessages = await this.loadMessages();

      // Sort by timestamp descending (newest first)
      allMessages.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      // Yield messages in chronological order (newest first)
      let count = 0;
      for (const message of allMessages) {
        if (this.shouldStopExtracting(count)) break;
        const media = await this.mediaOf(message.data);
        yield this.createRecordWithArchiveContext(
          { ...message.data, ...(media.length > 0 && { media }) },
          message.metadata
        );
        count++;
      }
    } catch (error) {
      throw new Error(`Failed to process Twitter direct messages: ${error}`);
    }
  }

  /** A message's photos and videos, with the archive's copies of their files. */
  private async mediaOf(data: any): Promise<TweetMedia[]> {
    const folder =
      data.type === 'group-direct-message'
        ? 'direct_messages_group_media'
        : 'direct_messages_media';
    return Promise.all(
      (data.mediaUrls ?? []).map(async (url: string): Promise<TweetMedia> => {
        const path = await this.mediaPath(folder, data.id, url);
        const type = fileName(url).toLowerCase().endsWith('.mp4') ? 'video' : 'photo';
        return { type, url, ...(path && { path }) };
      })
    );
  }

  /** The 1:1 messages, and group messages if enabled, within since and until. */
  private async loadMessages(): Promise<any[]> {
    const config = this.config as z.infer<typeof TwitterArchiveDirectMessagesExtractor.schema>;

    // Process 1:1 direct messages
    const messages = await this.loadDirectMessages(`data/direct-messages.js`);

    // Process group direct messages (if enabled)
    if (config['include-group-dms']) {
      messages.push(...(await this.loadGroupDirectMessages(`data/direct-messages-group.js`)));
    }

    return messages.filter(message => this.isWithinDateRange(new Date(message.created_at)));
  }

  private async loadDirectMessages(filePath: string): Promise<any[]> {
    const messages: any[] = [];

    try {
      const content = await this.files.readText(filePath);
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
      this.logger.warn('Could not process 1:1 direct messages', { error: String(error) });
    }

    return messages;
  }

  /**
   * Group messages, each with who was in the group when it was sent. X lists
   * a conversation's events newest first; played oldest first, your joining
   * the group gives who was in it then, and later joins and leaves change
   * that.
   */
  private async loadGroupDirectMessages(filePath: string): Promise<any[]> {
    const messages: any[] = [];

    try {
      const content = await this.files.readText(filePath);
      const jsData = this.parseTwitterJS(content, 'direct_messages_group');

      for (const item of jsData) {
        const conversation = item.dmConversation;
        if (!conversation?.messages) continue;
        const events = [...conversation.messages].reverse();
        let members = this.foundingMembers(events);
        for (const event of events) {
          if (event.joinConversation) {
            members = new Set(event.joinConversation.participantsSnapshot ?? []);
          }
          for (const id of event.participantsJoin?.userIds ?? []) members.add(id);
          for (const id of event.participantsLeave?.userIds ?? []) members.delete(id);

          const msg = event.messageCreate;
          if (!msg) continue;
          messages.push({
            created_at: msg.createdAt,
            data: {
              type: 'group-direct-message',
              id: msg.id,
              conversationId: conversation.conversationId,
              senderId: msg.senderId,
              // Who was in the group when it was sent, the sender among them.
              participants: [...members],
              text: msg.text || '',
              created_at: msg.createdAt,
              mediaUrls: msg.mediaUrls || [],
              urls: msg.urls || [],
            },
            metadata: {
              recordType: 'group-direct-messages',
              originalData: msg,
            },
          });
        }
      }
    } catch (error) {
      this.logger.warn('Could not process group direct messages', { error: String(error) });
    }

    return messages;
  }

  /**
   * Who was in a group from its start, before any event about it. When you
   * joined a group, your joining says who was in it, so none are needed. A
   * group you started has no such event: it had you and everyone who wrote in
   * it or left it, less those X records joining later.
   */
  private foundingMembers(events: any[]): Set<string> {
    if (events.some(event => event.joinConversation)) return new Set();
    const firstSeen = new Map<string, 'there' | 'joined'>();
    const see = (id: string, how: 'there' | 'joined') => {
      if (!firstSeen.has(id)) firstSeen.set(id, how);
    };
    for (const event of events) {
      if (event.messageCreate) see(event.messageCreate.senderId, 'there');
      for (const id of event.participantsJoin?.userIds ?? []) see(id, 'joined');
      for (const id of event.participantsLeave?.userIds ?? []) see(id, 'there');
    }
    const founders = [...firstSeen].filter(([, how]) => how === 'there').map(([id]) => id);
    return new Set([...(this.accountInfo ? [this.accountInfo.accountId] : []), ...founders]);
  }

  override async determineCount(): Promise<number | null> {
    const config = this.config as z.infer<typeof TwitterArchiveDirectMessagesExtractor.schema>;

    try {
      let totalMessages = 0;

      // Count 1:1 direct messages
      try {
        const dmContent = await this.files.readText(`data/direct-messages.js`);
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
          const groupContent = await this.files.readText(`data/direct-messages-group.js`);
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

  /** The messages a run reads, when they were sent, and in how many conversations. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const config = this.config as z.infer<typeof TwitterArchiveDirectMessagesExtractor.schema>;
    const messages = await this.loadMessages();
    const survey: Survey = {};
    for (const recordType of TwitterArchiveDirectMessagesExtractor.recordTypes) {
      if (recordType === 'group-direct-messages' && !config['include-group-dms']) continue;
      // A 1:1 message names no record type, so its record is the first, as in a run.
      const sent = messages.filter(
        message => (message.metadata.recordType ?? 'direct-messages') === recordType
      );
      const times = sent.map(message => new Date(message.created_at));
      const conversations = new Set(sent.map(message => message.data.conversationId)).size;
      survey[recordType] = {
        ...this.surveyOf(times, options),
        measures: [{ key: 'conversations', label: 'conversations', value: conversations }],
      };
    }
    return survey;
  }
}
