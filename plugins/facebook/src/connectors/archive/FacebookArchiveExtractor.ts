import { ArchiveExtractor, Extractor } from '@chronicle.app/etl';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export abstract class FacebookArchiveExtractor extends ArchiveExtractor<
  typeof FacebookArchiveExtractor
> {
  static override source = 'facebook';
  static override strategy = 'archive';

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to the Facebook export directory'),
  });

  protected exportSegments: string[] = [];

  async initialize(): Promise<void> {
    await this.discoverExportSegments();
    this.accountInfo = await this.loadAccountInfo();
  }

  protected async discoverExportSegments(): Promise<void> {
    const config = this.config as z.infer<typeof FacebookArchiveExtractor.schema>;

    try {
      const entries = await readdir(config.input, { withFileTypes: true });

      // Check if this is a new format export (direct structure)
      const hasDirectStructure = entries.some(
        entry =>
          entry.isDirectory() &&
          (entry.name === 'personal_information' || entry.name === 'your_facebook_activity')
      );

      if (hasDirectStructure) {
        // New format: direct structure
        this.exportSegments = [config.input];
        // Detected new Facebook export format (direct structure)
      } else {
        // Old format: Find all export segment directories (meta-* or facebook-*)
        this.exportSegments = entries
          .filter(entry => entry.isDirectory())
          .map(entry => entry.name)
          .filter(name => name.startsWith('meta-') || name.startsWith('facebook-'))
          .map(name => join(config.input, name));

        // Discovered export segments (legacy format)
      }
    } catch {
      // Could not discover export segments
      this.exportSegments = [config.input]; // Fallback to input path
    }
  }

  protected override async loadAccountInfo(): Promise<any> {
    // Try to find account info in any of the segments
    for (const segmentPath of this.exportSegments) {
      try {
        // Check for new format (direct structure)
        const directProfilePath = join(
          segmentPath,
          'personal_information',
          'profile_information',
          'profile_information.json'
        );

        try {
          const content = await readFile(directProfilePath, 'utf-8');
          const data = JSON.parse(content);

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
        const entries = await readdir(segmentPath, { withFileTypes: true });
        const facebookDirs = entries
          .filter(entry => entry.isDirectory() && entry.name.startsWith('facebook-'))
          .map(entry => entry.name);

        for (const fbDir of facebookDirs) {
          try {
            const personalInfoPath = join(
              segmentPath,
              fbDir,
              'personal_information',
              'profile_information',
              'profile_information.json'
            );

            const content = await readFile(personalInfoPath, 'utf-8');
            const data = JSON.parse(content);

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
      try {
        // Check if this is new format (direct structure)
        const entries = await readdir(segmentPath, { withFileTypes: true });
        const hasDirectStructure = entries.some(
          entry =>
            entry.isDirectory() &&
            (entry.name === 'personal_information' || entry.name === 'your_facebook_activity')
        );

        if (hasDirectStructure) {
          // New format: yield the segment path directly
          yield { segmentPath, facebookDir: '', fullPath: segmentPath };
        } else {
          // Legacy format: look for facebook-* subdirectories
          const facebookDirs = entries
            .filter(entry => entry.isDirectory() && entry.name.startsWith('facebook-'))
            .map(entry => entry.name);

          for (const facebookDir of facebookDirs) {
            const fullPath = join(segmentPath, facebookDir);
            yield { segmentPath, facebookDir, fullPath };
          }
        }
      } catch {
        // Could not read segment
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
