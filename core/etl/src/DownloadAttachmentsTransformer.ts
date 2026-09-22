/**
 * Generic transformer that downloads media referenced by `url` and embeds the
 * bytes inline, so any pipeline can materialize attachments synchronously
 * (extract → transform → ingest) without running the out-of-band materializer.
 *
 * It walks a record's Chronicle JSON-LD for media nodes (MediaObject and its
 * subtypes — ImageObject / AudioObject / VideoObject / DocumentObject) that
 * carry a `url` and no bytes yet (no `contentData` / `contentPath` /
 * `attachmentCid`), downloads each url, and embeds the result as either a
 * `contentData` data URI (default) or an absolute `contentPath` to a temp file.
 *
 * Downstream is unchanged: ingest's `extractAttachments` decodes the bytes,
 * mints an `attachmentCid`, and stores the blob. A fetch failure leaves the
 * node url-only — it never fails the record.
 *
 * The download is per-record and streaming, but a url is fetched at most once
 * per instance (the same instance processes every record in a run), so a url
 * repeated across records downloads once. This is an in-memory memo, not a disk
 * cache — nothing outlives the run. Content-level dedup still happens at ingest
 * via the attachment CID.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { Record } from './types.js';
import { Transformer } from './transformer.js';

/** Local names of the Chronicle media classes we treat as downloadable. */
const MEDIA_TYPES = new Set([
  'MediaObject',
  'ImageObject',
  'AudioObject',
  'VideoObject',
  'DocumentObject',
]);

export const downloadAttachmentsConfigSchema = z.object({
  /**
   * How to embed downloaded bytes. `contentData` keeps everything in the record
   * (nothing to clean up); `contentPath` writes a per-run temp file under the OS
   * temp dir and keeps the record small for large media.
   */
  embedAs: z.enum(['contentData', 'contentPath']).default('contentData'),
  /** Max concurrent downloads within a single record. */
  concurrency: z.number().int().positive().default(4),
  /** Per-request timeout in milliseconds. */
  timeoutMs: z.number().int().positive().default(30_000),
  /** Leave url-only any download whose body exceeds this many bytes. */
  maxBytes: z.number().int().positive().optional(),
});

export type DownloadAttachmentsConfig = z.input<typeof downloadAttachmentsConfigSchema>;

interface DownloadResult {
  bytes: Buffer;
  mimeType: string | null;
}

/** Strip an `@type` IRI down to its local name (`.../ImageObject` → `ImageObject`). */
function localName(type: string): string {
  const idx = Math.max(type.lastIndexOf('/'), type.lastIndexOf('#'));
  return idx === -1 ? type : type.slice(idx + 1);
}

type Node = { [key: string]: unknown };

function isMediaNodeNeedingDownload(
  node: unknown
): node is Node & { '@type': string; url: string } {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  const n = node as Node;
  if (typeof n['@type'] !== 'string' || !MEDIA_TYPES.has(localName(n['@type']))) return false;
  if (typeof n.url !== 'string' || n.url.length === 0) return false;
  return (
    n.contentData === undefined && n.contentPath === undefined && n.attachmentCid === undefined
  );
}

export class DownloadAttachmentsTransformer extends Transformer {
  static override source = 'download-attachments';
  static override description =
    'Download media referenced by url and embed the bytes inline (contentData or temp-file contentPath)';

  static schema = downloadAttachmentsConfigSchema;

  /** Memo across the whole run: a url is fetched at most once per instance. */
  private readonly downloads = new Map<string, Promise<DownloadResult | null>>();
  private tempDir: string | null = null;
  private fileCounter = 0;

  constructor(config: DownloadAttachmentsConfig & { quiet?: boolean; verbose?: boolean } = {}) {
    super(config);
    this.config = downloadAttachmentsConfigSchema.parse(config ?? {});
  }

  async transform(record: Record): Promise<any[]> {
    // Collect unique urls first so duplicates within the record fetch once.
    const urls = new Set<string>();
    this.collectUrls(record.data, urls);

    if (urls.size > 0) {
      await this.fetchAll([...urls]);
    }

    return [await this.rewrite(record.data)];
  }

  override async teardown(): Promise<void> {
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true }).catch(() => {});
      this.tempDir = null;
    }
  }

  private collectUrls(value: unknown, urls: Set<string>): void {
    if (Array.isArray(value)) {
      for (const item of value) this.collectUrls(item, urls);
      return;
    }
    if (value && typeof value === 'object') {
      if (isMediaNodeNeedingDownload(value)) urls.add(value.url);
      for (const v of Object.values(value)) this.collectUrls(v, urls);
    }
  }

  private async fetchAll(urls: string[]): Promise<void> {
    const { concurrency } = this.config;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < urls.length) {
        await this.download(urls[next++]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  }

  /** Download a url once; subsequent calls (this record or later) reuse it. */
  private download(url: string): Promise<DownloadResult | null> {
    let pending = this.downloads.get(url);
    if (!pending) {
      pending = this.fetchOne(url);
      this.downloads.set(url, pending);
    }
    return pending;
  }

  private async fetchOne(url: string): Promise<DownloadResult | null> {
    const { timeoutMs, maxBytes } = this.config;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        this.logger.warn(`Skipping ${url}: HTTP ${response.status}`);
        return null;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (maxBytes !== undefined && bytes.length > maxBytes) {
        this.logger.warn(`Skipping ${url}: ${bytes.length} bytes exceeds maxBytes ${maxBytes}`);
        return null;
      }
      const contentType = response.headers.get('content-type');
      return { bytes, mimeType: contentType ? contentType.split(';')[0].trim() : null };
    } catch (error) {
      this.logger.warn(
        `Failed to download ${url}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async rewrite(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) {
      return Promise.all(value.map(item => this.rewrite(item)));
    }
    // Dates (and other non-plain objects) have no enumerable keys, so the
    // object rewrite below would flatten them to `{}` and destroy values like
    // an action's `timestamp`. Pass them through untouched.
    if (value instanceof Date) {
      return value;
    }
    if (value && typeof value === 'object') {
      const out: Node = {};
      for (const [key, v] of Object.entries(value)) {
        out[key] = await this.rewrite(v);
      }
      if (isMediaNodeNeedingDownload(value)) {
        const result = await this.downloads.get(value.url);
        if (result) await this.embed(out, result);
      }
      return out;
    }
    return value;
  }

  private async embed(node: Node, result: DownloadResult): Promise<void> {
    const mimeType =
      (typeof node.mimeType === 'string' && node.mimeType) || result.mimeType || null;
    if (this.config.embedAs === 'contentPath') {
      node.contentPath = await this.writeTempFile(result.bytes);
    } else {
      node.contentData = `data:${mimeType ?? 'application/octet-stream'};base64,${result.bytes.toString('base64')}`;
    }
    if (node.mimeType === undefined && mimeType) node.mimeType = mimeType;
  }

  private async writeTempFile(bytes: Buffer): Promise<string> {
    if (!this.tempDir) {
      this.tempDir = await mkdtemp(join(tmpdir(), 'chronicle-etl-media-'));
    }
    const file = join(this.tempDir, `attachment-${this.fileCounter++}`);
    await writeFile(file, bytes);
    return file;
  }
}
