import { Record } from '@chronicle.app/etl';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FacebookArchiveExtractor } from './FacebookArchiveExtractor.js';
import FacebookTransformer from '../FacebookTransformer.js';

export class FacebookArchiveMessagesExtractor extends FacebookArchiveExtractor {
  static override recordTypes = ['messages'];
  static override description = 'Messenger conversations';
  static override default = false;
  static override defaultTransformer = FacebookTransformer;

  async *extract(): AsyncGenerator<Record> {
    await this.initialize();

    const processedConversations = new Set<string>();
    let recordCount = 0;

    for await (const { fullPath } of this.iterateExportSegments()) {
      for await (const record of this.extractMessagesFromSegment(
        fullPath,
        processedConversations
      )) {
        yield record;
        recordCount++;

        if (this.shouldStopExtracting(recordCount)) {
          return;
        }
      }
    }
  }

  private async *extractMessagesFromSegment(
    segmentPath: string,
    processedConversations: Set<string>
  ): AsyncGenerator<Record> {
    const messagesPath = join(segmentPath, 'your_facebook_activity', 'messages');

    try {
      await stat(messagesPath);
    } catch {
      // No messages directory found
      return;
    }

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
    const folderPath = join(messagesPath, folderName);

    try {
      await stat(folderPath);
    } catch {
      return; // Folder doesn't exist in this segment
    }

    try {
      const conversations = await readdir(folderPath, { withFileTypes: true });

      for (const conversation of conversations) {
        if (!conversation.isDirectory()) continue;

        const conversationId = conversation.name;

        // Skip if already processed (avoid duplicates across segments)
        if (processedConversations.has(conversationId)) {
          continue;
        }

        const conversationPath = join(folderPath, conversationId);

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
      const files = await readdir(conversationPath);
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
        const filePath = join(conversationPath, messageFile);

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
