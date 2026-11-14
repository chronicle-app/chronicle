import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import TwitterTransformer from '../TwitterTransformer.js';
import { TwitterArchiveExtractor } from './TwitterArchiveExtractor.js';

/** One message in a chat with Grok, as a record carries it. */
export interface GrokMessage {
  type: 'grok-chat';
  /** Made from the chat, the time, and who wrote it: X gives a message no id of its own. */
  id: string;
  chatId: string;
  createdAt: string;
  /** You, or Grok. */
  sender: 'user' | 'grok';
  text: string;
  /** The posts Grok's answer drew on. */
  postIds?: string[];
}

/**
 * Your chats with Grok, X's assistant, from `grok-chat-item.js`: what you
 * asked and what it answered, oldest first in each chat. X stamps an answer
 * with its question's time.
 */
export class TwitterArchiveGrokExtractor extends TwitterArchiveExtractor<
  typeof TwitterArchiveGrokExtractor
> {
  static override description = 'Chats with Grok';
  static override recordTypes = ['grok-chats'];
  static override defaultTransformer = TwitterTransformer;
  static override schema = TwitterArchiveExtractor.schema;

  override keyOf(record: Record): string | null {
    return (record.data as GrokMessage).id ?? null;
  }

  override occurredAt(record: Record): Date | undefined {
    const { createdAt } = record.data as GrokMessage;
    return createdAt ? new Date(createdAt) : undefined;
  }

  async *extract(): AsyncGenerator<Record> {
    this.accountInfo = await this.loadAccountInfo();
    let count = 0;
    // Newest first. A question and its answer have one time, and keep X's order.
    const messages = (await this.loadMessages())
      .map((message, order) => ({ message, order }))
      .sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt) || a.order - b.order);
    for (const { message } of messages) {
      if (this.shouldStopExtracting(count)) return;
      yield this.createRecordWithArchiveContext(message);
      count++;
    }
  }

  /** The chats' messages within since and until. */
  private async loadMessages(): Promise<GrokMessage[]> {
    if (!(await this.files.has('data/grok-chat-item.js'))) return [];
    const content = await this.files.readText('data/grok-chat-item.js');
    return this.parseTwitterJS(content, 'grok_chat_item')
      .map(item => item.grokChatItem)
      .filter(item => item?.chatId && item.createdAt && typeof item.message === 'string')
      .filter(item => this.isWithinDateRange(new Date(item.createdAt)))
      .map((item): GrokMessage => {
        const sender = item.sender?.name === 'User' ? 'user' : 'grok';
        return {
          type: 'grok-chat',
          id: `${item.chatId}-${Date.parse(item.createdAt)}-${sender}`,
          chatId: item.chatId,
          createdAt: new Date(item.createdAt).toISOString(),
          sender,
          text: item.message,
          ...(item.postIds?.length > 0 && { postIds: item.postIds }),
        };
      });
  }

  override async determineCount(): Promise<number | null> {
    return (await this.loadMessages()).length;
  }

  /** The messages a run reads, when each was sent, and in how many chats. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const messages = await this.loadMessages();
    return {
      'grok-chats': {
        ...this.surveyOf(
          messages.map(message => new Date(message.createdAt)),
          options
        ),
        measures: [
          {
            key: 'chats',
            label: 'chats',
            value: new Set(messages.map(message => message.chatId)).size,
          },
        ],
      },
    };
  }
}
