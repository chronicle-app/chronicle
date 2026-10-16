import { z } from 'zod';
import { appleDate } from '../coredata.js';
import { SHARED_WITH_YOU_LIBRARY, Scope, type Asset, type PhotosLibrary } from '../library.js';
import { MESSAGES_DATABASE, MessagesDatabase, type SharedMessage } from '../messages.js';
import ApplePhotosExtractor, { type Found } from './ApplePhotosExtractor.js';

/** A photo or video shared in Messages, with the message it came in. */
export interface SharedPhoto extends Asset {
  /** Messages' ID for the attachment (`at_0_…`), which Photos keeps. */
  attachment: string;
  message: SharedMessage;
}

// Photos' kind of photo for a screenshot (`ZKINDSUBTYPE`).
const SCREENSHOT = 10;

/**
 * The photos and videos shared with you, and by you, in Messages, from the
 * library Photos keeps of them. Photos adds what it knows about each one:
 * who is in it, what's in it, and where it was taken. Each one's sender comes
 * from Messages, so a photo whose message is gone is left out.
 */
export class ApplePhotosSharedWithYouExtractor extends ApplePhotosExtractor {
  static override description = 'Photos and videos shared in Messages, with who sent them';
  static override recordTypes = ['shared-with-you'];
  static override temporality = 'snapshot' as const;

  static override schema = ApplePhotosExtractor.schema.extend({
    syndication: z
      .string()
      .describe('Path to the Shared with You library')
      .default(SHARED_WITH_YOU_LIBRARY),
    messages: z.string().describe('Path to the Messages database').default(MESSAGES_DATABASE),
  }) as any;

  private messages: MessagesDatabase | null = null;

  override async setup(): Promise<void> {
    await super.setup();
    this.messages = new MessagesDatabase(this.config.messages);
  }

  override async teardown(): Promise<void> {
    this.messages?.close();
    this.messages = null;
    await super.teardown();
  }

  protected override libraryPath(): string {
    return this.config.syndication;
  }

  /**
   * Photos with camera data, videos, and screenshots. An image with no camera
   * data is usually a sticker, a meme, or an image saved from the web.
   */
  protected read(library: PhotosLibrary): Array<Found<SharedPhoto>> {
    const rows = library
      .rows(Scope.sharedWithYou)
      .filter(
        row =>
          row.syndicationId &&
          (row.kind === 1 || row.subtype === SCREENSHOT || row.cameraMake?.trim())
      );
    const assets = library.describe(rows);
    return rows.flatMap((row, i) => {
      const attachment = row.syndicationId!;
      const message = this.messages!.message(attachment);
      // Who sent it is unknown when the message is gone, or has no sender.
      if (!message || (!message.fromMe && !message.handle)) return [];
      const time = appleDate(row.addedDate);
      return time ? [{ key: attachment, time, data: { ...assets[i], attachment, message } }] : [];
    });
  }
}
