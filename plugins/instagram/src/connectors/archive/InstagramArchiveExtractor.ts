import { ArchiveExtractor, Extractor } from '@chronicle.app/etl';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';

export abstract class InstagramArchiveExtractor extends ArchiveExtractor<
  typeof InstagramArchiveExtractor
> {
  static override source = 'instagram';
  static override strategy = 'archive';

  static override schema = Extractor.schema.extend({
    input: z.string().describe('Path to the Instagram export directory'),
  });

  // nameToHandleMap stays out of the record context: it only maps
  // handle→handle (a membership set, not a name resolver) and a Map would
  // not survive a JSON round-trip of the record anyway.
  protected nameToHandleMap: Map<string, string> = new Map();
  protected allKnownHandles: Set<string> = new Set();

  override async setup(): Promise<void> {
    await super.setup();
    this.accountInfo = await this.loadAccountInfo();
    this.nameToHandleMap = await this.loadNameToHandleMapping();
  }

  protected override async loadAccountInfo(): Promise<any> {
    const config = this.config as z.infer<typeof InstagramArchiveExtractor.schema>;

    try {
      const profileInfoPath = join(
        config.input,
        'personal_information',
        'personal_information',
        'personal_information.json'
      );
      const content = await readFile(profileInfoPath, 'utf-8');
      const data = JSON.parse(content);

      // No fabricated fallbacks: a missing username stays undefined so the
      // transformer fails loudly instead of keying the self agent on a
      // synthetic handle.
      return {
        username: data.profile_user?.[0]?.string_map_data?.Username?.value,
        name: data.profile_user?.[0]?.string_map_data?.Name?.value,
        profile_pic_url: data.profile_user?.[0]?.string_map_data?.['Profile Picture URL']?.value,
        email: data.profile_user?.[0]?.string_map_data?.Email?.value,
        phone: data.profile_user?.[0]?.string_map_data?.['Phone number']?.value,
        bio: data.profile_user?.[0]?.string_map_data?.Biography?.value,
        website: data.profile_user?.[0]?.string_map_data?.Website?.value,
      };
    } catch (error) {
      this.logger.warn('Could not load Instagram account info', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  protected async readInstagramJson(filePath: string): Promise<any> {
    const config = this.config as z.infer<typeof InstagramArchiveExtractor.schema>;
    return this.readArchiveJson(join(config.input, filePath));
  }

  protected convertInstagramTimestamp(timestamp: number): string {
    return new Date(timestamp * 1000).toISOString();
  }

  /**
   * An activity file's item array, tolerant of the export's two framings: a
   * bare array (older exports) or an object with a single wrapper key
   * (`likes_media_likes`, `saved_saved_collections`, `comments_reels_comments`,
   * …) around the array (2025 exports). Missing/unparsable file → empty.
   */
  protected async readInstagramArray(filePath: string): Promise<any[]> {
    let data: any;
    try {
      data = await this.readInstagramJson(filePath);
    } catch {
      return [];
    }
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const values = Object.values(data);
      if (values.length === 1 && Array.isArray(values[0])) return values[0];
    }
    return [];
  }

  /** Whether a unix-seconds timestamp falls inside the configured since/until window. */
  protected inRange(timestampSeconds: number): boolean {
    return this.isWithinDateRange(new Date(timestampSeconds * 1000));
  }

  /**
   * Absolute path of a media `uri` inside the export directory, or null when
   * the uri escapes it (`../`, absolute paths) — export JSON is data, not a
   * trusted path source, and an escaping uri must not be captured into the
   * attachment store.
   */
  protected archiveMediaPath(uri: string): string | null {
    const config = this.config as z.infer<typeof InstagramArchiveExtractor.schema>;
    const root = resolve(config.input);
    const path = resolve(root, uri);
    return path.startsWith(root + sep) ? path : null;
  }

  /** Flatten a `label_values` array into a `{ label: value|href|timestamp }` map. */
  protected labelMap(item: any): { [key: string]: any } {
    const map: { [key: string]: any } = {};
    for (const lv of item?.label_values ?? []) {
      const label = lv?.label;
      if (!label) continue;
      if ('value' in lv) map[label] = lv.value;
      if ('href' in lv) map[`${label}#href`] = lv.href;
      if ('timestamp_value' in lv) map[`${label}#ts`] = lv.timestamp_value;
    }
    return map;
  }

  /**
   * The canonical shortcode from a post/reel permalink (`/p/<sc>/`,
   * `/reel/<sc>/`). A bare shortcode is 5–11 chars (it is base64 of the media
   * pk, so its length grew as pks grew: ~10 pre-2014, 11 after). Activity
   * exports instead emit a share permalink that appends a fixed 28-char routing
   * suffix onto that shortcode (`C0ExampleA1` + 28 chars, `Vf0Example` + 28
   * chars). Strip exactly that suffix rather than truncating to 11 — an older
   * 10-char code (`Vf0Example…` → correct) would otherwise keep a spurious 11th
   * char (`Vf0ExampleH`) and resolve to a nonexistent post.
   */
  protected shortcodeFromUrl(url: string | undefined): string | null {
    if (!url) return null;
    const match = url.match(/\/(?:p|reel|tv)\/([^/?#]+)/);
    if (!match) return null;
    const raw = match[1];
    return raw.length > 28 ? raw.slice(0, -28) : raw;
  }

  /**
   * The working permalink as Instagram exported it — the full path code (the
   * share token on modern posts), host+path only (no query/fragment), original
   * `p`/`reel`/`tv` kind preserved. Kept verbatim rather than rebuilt from the
   * trimmed shortcode: the bare shortcode returns "something went wrong" for
   * modern/private posts, so this is the link that actually opens the source.
   *
   * Identity/dedup keys off the trimmed `shortcodeFromUrl`, not this. Choosing a
   * canonical url form, splitting canonical vs locator, and making `url`
   * set-valued identity are deferred to the store-level url redesign, not this
   * plugin.
   */
  protected permalinkFromUrl(url: string | undefined): string | null {
    if (!url) return null;
    const match = url.match(/instagram\.com\/(p|reel|tv)\/([^/?#]+)/i);
    if (!match) return null;
    return `https://www.instagram.com/${match[1].toLowerCase()}/${match[2]}/`;
  }

  /** Repair Instagram's mojibake; see `ArchiveExtractor.fixArchiveTextEncoding`. */
  protected fixInstagramTextEncoding(text: string): string {
    return this.fixArchiveTextEncoding(text);
  }

  protected async loadNameToHandleMapping(): Promise<Map<string, string>> {
    const handleMap = new Map<string, string>();

    try {
      // First collect all known handles
      const allHandles = new Set<string>();

      // Load following data
      const following = await this.readInstagramJson(
        'connections/followers_and_following/following.json'
      );
      if (following?.relationships_following) {
        for (const rel of following.relationships_following) {
          // following entries carry the handle in `title`, not string_list_data.value
          const handle = rel.string_list_data?.[0]?.value || rel.title;
          if (handle) {
            allHandles.add(handle);
            handleMap.set(handle, handle); // handle -> handle mapping
          }
        }
      }

      // Load followers data
      const followers = await this.readInstagramJson(
        'connections/followers_and_following/followers_1.json'
      );
      if (Array.isArray(followers)) {
        for (const rel of followers) {
          const handle = rel.string_list_data?.[0]?.value || rel.title;
          if (handle) {
            allHandles.add(handle);
            handleMap.set(handle, handle); // handle -> handle mapping
          }
        }
      }

      // Store handles set for lookup
      this.allKnownHandles = allHandles;

      this.logger.verboseInfo('Loaded Instagram handles', {
        count: handleMap.size,
      });
    } catch (error) {
      this.logger.warn('Could not load Instagram connections', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return handleMap;
  }

  protected extractHandleFromConversationId(conversationId: string): string | null {
    // Try the first part of the conversation ID (before underscore)
    const parts = conversationId.split('_');
    const potentialHandle = parts[0];

    // Direct match check (works for ~25% of conversations)
    if (this.allKnownHandles.has(potentialHandle)) {
      return potentialHandle;
    }

    // Try partial matching for cases where folder name might be truncated
    // or slightly different from actual handle
    for (const knownHandle of this.allKnownHandles) {
      // Check if known handle starts with potential handle (e.g., "alex" → "alexexample")
      if (knownHandle.startsWith(potentialHandle) && potentialHandle.length >= 4) {
        return knownHandle;
      }
      // Check if potential handle starts with known handle (e.g., "alexsmith" → "alex")
      if (potentialHandle.startsWith(knownHandle) && knownHandle.length >= 4) {
        return knownHandle;
      }
    }

    // If no match found, return null
    return null;
  }
}
