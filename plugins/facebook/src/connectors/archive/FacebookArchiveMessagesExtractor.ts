import { Record, type Survey, type SurveyOptions } from '@chronicle.app/etl';
import { posix } from 'node:path';
import { FacebookArchiveExtractor } from './FacebookArchiveExtractor.js';
import FacebookTransformer from '../FacebookTransformer.js';

export class FacebookArchiveMessagesExtractor extends FacebookArchiveExtractor {
  static override recordTypes = ['messages'];
  static override description = 'Messenger conversations';
  static override default = true;
  static override defaultTransformer = FacebookTransformer;

  async *extract(): AsyncGenerator<Record> {
    let recordCount = 0;

    for await (const record of this.messages()) {
      yield record;
      recordCount++;

      if (this.shouldStopExtracting(recordCount)) {
        return;
      }
    }
  }

  /** The messages a run reads and when they were sent, with how many conversations they're in. */
  override async survey(options: SurveyOptions = {}): Promise<Survey> {
    const conversations = new Set<string>();
    const survey = await this.surveyOf(this.messages(), options, record =>
      conversations.add(record.context.conversationId)
    );
    survey.messages.measures = [
      { key: 'conversations', label: 'conversations', value: conversations.size },
    ];
    return survey;
  }

  /** Every message in the export, in the order a run reads them, before its limit. */
  private async *messages(): AsyncGenerator<Record> {
    await this.initialize();

    const processedConversations = new Set<string>();

    for await (const { fullPath } of this.iterateExportSegments()) {
      yield* this.extractMessagesFromSegment(fullPath, processedConversations);
    }
  }

  private async *extractMessagesFromSegment(
    segmentPath: string,
    processedConversations: Set<string>
  ): AsyncGenerator<Record> {
    const messagesPath = posix.join(segmentPath, 'your_facebook_activity', 'messages');

    if (!(await this.exists(messagesPath))) return; // No messages directory found

    // Process different message types
    yield* this.extractFromMessageFolder(messagesPath, 'inbox', processedConversations);
    yield* this.extractFromMessageFolder(messagesPath, 'archived_threads', processedConversations);
    yield* this.extractFromMessageFolder(messagesPath, 'message_requests', processedConversations);
    yield* this.extractFromMessageFolder(messagesPath, 'filtered_threads', processedConversations);
  }

  private async *extractFromMessageFolder(
    messagesPath: string,
    folderName: string,
    processedConversations: Set<string>
  ): AsyncGenerator<Record> {
    const folderPath = posix.join(messagesPath, folderName);

    if (!(await this.exists(folderPath))) return; // Folder doesn't exist in this segment

    try {
      const conversations = await this.files.children(folderPath);

      for (const conversation of conversations) {
        if (!conversation.endsWith('/')) continue;

        const conversationId = conversation.slice(0, -1);

        // Skip if already processed (avoid duplicates across segments)
        if (processedConversations.has(conversationId)) {
          continue;
        }

        const conversationPath = posix.join(folderPath, conversationId);

        try {
          yield* this.extractMessagesFromConversation(conversationPath, conversationId, folderName);
          processedConversations.add(conversationId);
        } catch {
          // Error processing conversation
        }
      }
    } catch {
      // Error reading message folder
    }
  }

  private async *extractMessagesFromConversation(
    conversationPath: string,
    conversationId: string,
    threadType: string
  ): AsyncGenerator<Record> {
    try {
      const files = await this.files.children(conversationPath);
      const messageFiles = files.filter(
        file => file.startsWith('message_') && file.endsWith('.json')
      );

      if (messageFiles.length === 0) {
        // No message files found in conversation
        return;
      }

      // Sort message files to process in order
      messageFiles.sort((a, b) => {
        const aNum = Number.parseInt(a.match(/message_(\d+)\.json/)?.[1] || '0');
        const bNum = Number.parseInt(b.match(/message_(\d+)\.json/)?.[1] || '0');
        return aNum - bNum;
      });

      for (const messageFile of messageFiles) {
        const filePath = posix.join(conversationPath, messageFile);

        try {
          const data = await this.readFacebookJson(filePath);
          yield* this.processConversationData(data, conversationId, threadType);
        } catch {
          // Error reading message file
        }
      }
    } catch {
      // Error processing conversation
    }
  }

  private async *processConversationData(
    data: any,
    conversationId: string,
    threadType: string
  ): AsyncGenerator<Record> {
    if (!data.messages || !Array.isArray(data.messages)) {
      // No messages array found in conversation
      return;
    }

    const participants = data.participants || [];
    const conversationTitle = data.title || conversationId;

    for (const message of data.messages) {
      // Skip messages outside date range if configured
      if (message.timestamp_ms && !this.isWithinDateRange(new Date(message.timestamp_ms))) {
        continue;
      }

      const processedMessage = {
        conversationId,
        conversationTitle,
        threadType,
        participants: participants.map((p: any) => p.name),
        senderName: message.sender_name,
        content: this.fixFacebookTextEncoding(message.content || ''),
        timestamp: message.timestamp_ms
          ? this.convertFacebookTimestamp(message.timestamp_ms)
          : null,
        messageType: this.determineMessageType(message),
        hasMedia: Boolean(
          message.photos || message.videos || message.audio_files || message.files || message.gifs
        ),
        photos:
          message.photos?.map((p: any) => ({
            uri: p.uri,
            creation_timestamp: p.creation_timestamp,
          })) || [],
        videos:
          message.videos?.map((v: any) => ({
            uri: v.uri,
            creation_timestamp: v.creation_timestamp,
          })) || [],
        audioFiles:
          message.audio_files?.map((a: any) => ({
            uri: a.uri,
            creation_timestamp: a.creation_timestamp,
          })) || [],
        files:
          message.files?.map((f: any) => ({
            uri: f.uri,
            creation_timestamp: f.creation_timestamp,
          })) || [],
        gifs:
          message.gifs?.map((g: any) => ({
            uri: g.uri,
          })) || [],
        sticker: message.sticker
          ? {
              uri: message.sticker.uri,
            }
          : null,
        reactions:
          message.reactions?.map((r: any) => ({
            reaction: r.reaction,
            actor: r.actor,
          })) || [],
        isUnsent: message.is_unsent || false,
        rawData: message,
      };

      yield this.createRecordWithArchiveContext(processedMessage, {
        conversationId,
        threadType,
        messageFile: true,
      });
    }
  }

  private determineMessageType(message: any): string {
    if (message.photos?.length > 0) return 'photo';
    if (message.videos?.length > 0) return 'video';
    if (message.audio_files?.length > 0) return 'audio';
    if (message.files?.length > 0) return 'file';
    if (message.gifs?.length > 0) return 'gif';
    if (message.sticker) return 'sticker';
    if (message.content) return 'text';
    if (message.is_unsent) return 'unsent';
    return 'unknown';
  }
}
