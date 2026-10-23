import { ArchiveExtractor, Extractor } from '@chronicle.app/etl';
import { posix } from 'node:path';
import { z } from 'zod';

// The folders a Facebook export starts with, beside its other sections.
const SECTIONS = new Set(['personal_information/', 'your_facebook_activity/']);

export abstract class FacebookArchiveExtractor extends ArchiveExtractor<
  typeof FacebookArchiveExtractor
> {
  static override source = 'facebook';
  static override strategy = 'archive';

  static override schema = Extractor.schema.extend({
    input: z.string().describe('The Facebook export, as a folder or zip'),
  });

  protected override readonly exportName = 'Facebook export';

  /** The export's segments, by their paths in it: `''` when the export is one. */
  protected exportSegments: string[] = [];

  async initialize(): Promise<void> {
    await this.discoverExportSegments();
    this.accountInfo = await this.loadAccountInfo();
  }

  /** Whether a file or folder is in the export. */
  protected async exists(path: string): Promise<boolean> {
    return (await this.files.has(path)) || (await this.files.children(path)).length > 0;
  }

  protected async discoverExportSegments(): Promise<void> {
    const entries = await this.files.children('');

    // Check if this is a new format export (direct structure)
    if (entries.some(entry => SECTIONS.has(entry))) {
      // New format: direct structure
      this.exportSegments = [''];
      return;
    }
    // Old format: Find all export segment directories (meta-* or facebook-*)
    const segments = entries
      .filter(entry => entry.endsWith('/'))
      .map(entry => entry.slice(0, -1))
      .filter(name => name.startsWith('meta-') || name.startsWith('facebook-'));
    // Without any, fall back to the export's root
    this.exportSegments = segments.length > 0 ? segments : [''];
  }

  protected override async loadAccountInfo(): Promise<any> {
    // Try to find account info in any of the segments
    for (const segmentPath of this.exportSegments) {
      try {
        // Check for new format (direct structure)
        const directProfilePath = posix.join(
          segmentPath,
          'personal_information',
          'profile_information',
          'profile_information.json'
        );

        try {
          const data = await this.readFacebookJson(directProfilePath);

          return {
            name: data.profile_v2?.name?.full_name || data.profile_v2?.name?.value || 'unknown',
            email:
              data.profile_v2?.emails?.emails?.[0] ||
              data.profile_v2?.emails?.primary_email ||
              null,
            username: data.profile_v2?.username || null,
            phone:
              data.profile_v2?.phone_numbers?.[0]?.phone_number ||
              data.profile_v2?.phone_numbers?.primary_phone ||
              null,
          };
        } catch {
          // Not new format, try legacy format
        }

        // Legacy format: look for facebook-* subdirectories
        const facebookDirs = (await this.files.children(segmentPath))
          .filter(entry => entry.endsWith('/') && entry.startsWith('facebook-'))
          .map(entry => entry.slice(0, -1));

        for (const fbDir of facebookDirs) {
          try {
            const personalInfoPath = posix.join(
              segmentPath,
              fbDir,
              'personal_information',
              'profile_information',
              'profile_information.json'
            );

            const data = await this.readFacebookJson(personalInfoPath);

            return {
              name: data.profile_v2?.name?.full_name || data.profile_v2?.name?.value || 'unknown',
              email:
                data.profile_v2?.emails?.emails?.[0] ||
                data.profile_v2?.emails?.primary_email ||
                null,
              username: data.profile_v2?.username || null,
              phone:
                data.profile_v2?.phone_numbers?.[0]?.phone_number ||
                data.profile_v2?.phone_numbers?.primary_phone ||
                null,
            };
          } catch {
            // Continue to next directory
          }
        }
      } catch {
        // Continue to next segment
      }
    }

    // Could not load Facebook account info
    return { name: 'unknown' };
  }

  protected async *iterateExportSegments(): AsyncGenerator<{
    segmentPath: string;
    facebookDir: string;
    fullPath: string;
  }> {
    for (const segmentPath of this.exportSegments) {
      // Check if this is new format (direct structure)
      const entries = await this.files.children(segmentPath);
      if (entries.some(entry => SECTIONS.has(entry))) {
        // New format: yield the segment path directly
        yield { segmentPath, facebookDir: '', fullPath: segmentPath };
      } else {
        // Legacy format: look for facebook-* subdirectories
        const facebookDirs = entries
          .filter(entry => entry.endsWith('/') && entry.startsWith('facebook-'))
          .map(entry => entry.slice(0, -1));

        for (const facebookDir of facebookDirs) {
          const fullPath = posix.join(segmentPath, facebookDir);
          yield { segmentPath, facebookDir, fullPath };
        }
      }
    }
  }

  protected async readFacebookJson(filePath: string): Promise<any> {
    return this.readArchiveJson(filePath);
  }

  protected convertFacebookTimestamp(timestamp: number): string {
    // Facebook timestamps are in milliseconds
    return new Date(timestamp).toISOString();
  }

  protected fixFacebookTextEncoding(text: string): string {
    if (!text) return text;

    // Fix common social media export encoding issues
    const fixed = text
      // Handle escaped Unicode sequences (in JSON strings)
      .replaceAll('\\u00e2\\u0080\\u0099', "'") // Fix apostrophe
      .replaceAll('\\u00e2\\u0080\\u009c', '"') // Fix opening quote
      .replaceAll('\\u00e2\\u0080\\u009d', '"') // Fix closing quote
      .replaceAll('\\u00e2\\u0080\\u0094', '—') // Fix em dash
      .replaceAll('\\u00e2\\u0080\\u0093', '–') // Fix en dash
      .replaceAll('\\u00e2\\u0080\\u00a6', '...') // Fix ellipsis
      // Handle direct UTF-8 bytes interpreted as Latin-1
      .replaceAll('\u00E2\u0080\u0099', "'") // Fix apostrophe
      .replaceAll('\u00E2\u0080\u009C', '"') // Fix opening quote
      .replaceAll('\u00E2\u0080\u009D', '"') // Fix closing quote
      .replaceAll('\u00E2\u0080\u0094', '—') // Fix em dash
      .replaceAll('\u00E2\u0080\u0093', '–') // Fix en dash
      .replaceAll('\u00E2\u0080\u00A6', '...') // Fix ellipsis
      // Handle additional accented characters and emojis
      .replaceAll('\u00E2\u009D\u00A4', '❤') // Fix heart emoji
      .replaceAll('\u00C3\u00A9', 'é') // Fix é
      .replaceAll('\u00C3\u00A1', 'á') // Fix á
      .replaceAll('\u00C3\u00AD', 'í') // Fix í
      .replaceAll('\u00C3\u00B3', 'ó') // Fix ó
      .replaceAll('\u00C3\u00BA', 'ú') // Fix ú
      .replaceAll('\u00C3\u00B1', 'ñ') // Fix ñ
      .trim();

    return fixed;
  }
}
