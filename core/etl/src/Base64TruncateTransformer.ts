import { z } from 'zod';
import { Record } from './types.js';
import { Transformer } from './transformer.js';

export class Base64TruncateTransformer extends Transformer {
  static override source = 'base64-truncate';
  static override description = 'Truncate base64 encoded strings in data for readable output';
  static override outputSchema = 'raw';

  static schema = z.object({
    maxLength: z.number().default(100).describe('Maximum length to show of base64 strings'),
    suffix: z.string().default('...').describe('Suffix to append to truncated strings'),
  });

  async transform(record: Record): Promise<any[]> {
    const truncatedData = this.truncateBase64InObject(record.data);
    return [truncatedData];
  }

  private truncateBase64InObject(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.truncateIfBase64(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.truncateBase64InObject(item));
    }

    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.truncateBase64InObject(value);
      }
      return result;
    }

    return obj;
  }

  private truncateIfBase64(str: string): string {
    const { maxLength, suffix } = this.config;
    const minLength = 50; // Don't truncate short strings that might just happen to be base64-like

    // Check for data URLs (data:mime/type;base64,...)
    const dataUrlMatch = str.match(/^data:[^;]+;base64,(.+)$/);
    if (dataUrlMatch) {
      const base64Part = dataUrlMatch[1];
      if (base64Part.length > maxLength) {
        const prefix = str.slice(0, Math.max(0, str.indexOf(base64Part)));
        const truncatedBase64 =
          base64Part.slice(0, Math.max(0, maxLength - prefix.length - suffix.length)) + suffix;
        return prefix + truncatedBase64;
      }
      return str;
    }

    // Check if string looks like pure base64:
    // - Contains only valid base64 characters
    // - Is reasonably long (likely to be encoded data)
    // - Optionally has proper padding
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;

    if (str.length >= minLength && base64Regex.test(str) && str.length > maxLength) {
      return str.slice(0, Math.max(0, maxLength)) + suffix;
    }

    return str;
  }
}
