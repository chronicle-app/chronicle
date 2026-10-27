import { z } from 'zod';
import { appleDate } from '../coredata.js';
import {
  SHARED_WITH_YOU_LIBRARY,
  Scope,
  type Asset,
  type AssetRow,
  type PhotosLibrary,
} from '../library.js';
import { MESSAGES_DATABASE, MessagesDatabase, type SharedMessage } from '../messages.js';
import ApplePhotosExtractor, { type Found } from './ApplePhotosExtractor.js';

/** A photo or video shared with you in Messages, with the message it came in. */
export interface SharedPhoto extends Asset {
  /** Messages' ID for the attachment (`at_0_…`), which Photos keeps. */
  attachment: string;
  message: SharedMessage;
}

// Photos' kind of photo for a screenshot (`ZKINDSUBTYPE`).
const SCREENSHOT = 10;

/**
 * The photos and videos shared with you in Messages, from the library Photos
 * keeps of them, with where each was taken and who you said is in it. Each
 * one's sender comes from Messages, so a photo whose message is gone is left
 * out. So is one you sent: Photos keeps it as a copy with no link to your
 * library's photo, whose share `activity` already has.
 */
export class ApplePhotosSharedWithYouExtractor extends ApplePhotosExtractor {
  static override description = 'Photos and videos shared with you in Messages, with who sent them';
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

  protected read(library: PhotosLibrary): Array<Found<SharedPhoto>> {
    const shared = this.shared(library);
    const assets = library.describe(shared.map(({ row }) => row));
    return shared.map(({ attachment, message, time }, i) => ({
      key: attachment,
      time,
      data: { ...assets[i], attachment, message },
    }));
  }

  /** When each was shared, without who and what is in it. */
  protected override times(library: PhotosLibrary): string[] {
    return this.shared(library).map(({ time }) => time);
  }

  /**
   * Photos with camera data, videos, and screenshots, with the message each
   * came in and when it was sent. An image with no camera data is usually a
   * sticker, a meme, or an image saved from the web.
   */
  private shared(
    library: PhotosLibrary
  ): Array<{ row: AssetRow; attachment: string; message: SharedMessage; time: string }> {
    return library
      .rows(Scope.sharedWithYou)
      .filter(
        row =>
          row.syndicationId &&
          (row.kind === 1 || row.subtype === SCREENSHOT || row.cameraMake?.trim())
      )
      .flatMap(row => {
        const attachment = row.syndicationId!;
        const message = this.messages!.message(attachment);
        // Who sent it is unknown when the message is gone, or has no sender.
        if (!message || message.fromMe || !message.handle) return [];
        // When the message was sent. Photos dates a photo when it added it to
        // the Shared with You library, which is the rebuild after a rebuild.
        const time = message.sent ?? appleDate(row.addedDate);
        return time ? [{ row, attachment, message, time }] : [];
      });
  }
}
