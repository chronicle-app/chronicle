import { attachmentCidOf } from '../blob/BlobStore.js';
import { Base64Error, decodeBase64 } from '../util/base64.js';
import { ValidationError } from './errors.js';

export interface ExtractedAttachment {
  cid: string;
  bytes: Uint8Array;
  mimeType: string | null;
}

/**
 * Reader for a `contentPath` local file. Injected by the caller so the core
 * stays free of `node:fs` — Node callers pass `fs/promises`' `readFile`; a
 * runtime without a filesystem passes nothing and any `contentPath` is a
 * validation error. Kept broad (returns `Uint8Array`) so a Buffer-returning
 * Node reader satisfies it without a wrapper.
 */
export type ContentReader = (path: string) => Promise<Uint8Array>;

export interface ExtractAttachmentsOptions {
  /** Reader for `contentPath` inputs. Absent → `contentPath` throws. */
  readFile?: ContentReader;
}

const DATA_URI = /^data:([^;,]*);base64,([\S\s]*)$/;

// A POSIX ("/…") or Windows ("C:\…", "\\…") absolute path. Portable string
// check — no `node:path` — so a relative `contentPath` is rejected the same way
// on every runtime.
function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[/\\]/.test(value) || value.startsWith('\\\\');
}

function isEntityNode(v: unknown): v is Record<string, unknown> {
  return (
    Boolean(v) &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as Record<string, unknown>)['@type'] === 'string'
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function decodeDataUri(value: string): { bytes: Uint8Array; mimeType: string | null } {
  const match = DATA_URI.exec(value);
  if (!match) {
    throw new ValidationError('contentData must be a base64 data URI (data:<mime>;base64,…)', {
      contentData: value.length > 80 ? `${value.slice(0, 80)}…` : value,
    });
  }
  const [, mimeType, body] = match;
  // The pure-JS decoder is strict (rejects non-canonical input), so different
  // malformed inputs cannot collapse to the same bytes and mint a phantom CID.
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(body);
  } catch (error) {
    if (error instanceof Base64Error) {
      throw new ValidationError('contentData carries malformed base64', {
        length: body.length,
        cause: error.message,
      });
    }
    throw error;
  }
  return { bytes, mimeType: mimeType || null };
}

async function readContentPath(value: string, readFile?: ContentReader): Promise<Uint8Array> {
  if (!isAbsolutePath(value)) {
    throw new ValidationError('contentPath must be an absolute path', { contentPath: value });
  }
  if (!readFile) {
    throw new ValidationError('contentPath is not supported without a configured file reader', {
      contentPath: value,
    });
  }
  try {
    return await readFile(value);
  } catch (error) {
    throw new ValidationError('contentPath could not be read', {
      contentPath: value,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Deep-clone an event body, rewriting every entity node's binary content into
 * an `attachmentCid`. Two authored input forms:
 *
 * - `contentData` — a base64 data URI; bytes decoded inline, `mimeType` set
 *   from the URI when the node lacks one.
 * - `contentPath` — an absolute local file path; bytes read at ingest. The
 *   node's own `mimeType` (if any) is the only mime claim — paths carry none.
 *
 * The caller is responsible for putting the returned bytes into a blob store
 * before the event is appended. Deterministic and idempotent: the same bytes
 * always mint the same CID, and a body with neither input form comes back
 * deep-equal — so re-ingesting either the raw payload or an already-rewritten
 * body dedupes to the same event CID. (`contentPath` determinism holds while
 * the file's bytes do; the captured CID pins what was actually read.)
 *
 * `contentPath` needs a reader (`options.readFile`); Node callers pass
 * `fs/promises`' `readFile`, and without one any `contentPath` is a validation
 * error (a filesystem-less runtime supports only `contentData`).
 *
 * Throws {@link ValidationError} on a malformed data URI, an unreadable or
 * relative path, a `contentPath` with no configured reader, or a node carrying
 * both input forms.
 */
export async function extractAttachments(
  body: Record<string, unknown>,
  options: ExtractAttachmentsOptions = {}
): Promise<{
  body: Record<string, unknown>;
  attachments: ExtractedAttachment[];
}> {
  const found = new Map<string, ExtractedAttachment>();

  const rewriteValue = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) {
      const out = [];
      for (const item of value) out.push(await rewriteValue(item));
      return out;
    }
    if (isPlainObject(value)) return rewriteNode(value);
    return value;
  };

  const rewriteNode = async (node: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const entity = isEntityNode(node);
    const dataUri = entity && typeof node.contentData === 'string' ? node.contentData : undefined;
    const filePath = entity && typeof node.contentPath === 'string' ? node.contentPath : undefined;
    if (dataUri !== undefined && filePath !== undefined) {
      throw new ValidationError('Entity carries both contentData and contentPath', {
        contentPath: filePath,
      });
    }
    const rewriting = dataUri !== undefined || filePath !== undefined;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      // When rewriting, these keys are replaced by the computed values below
      // (a stale attachmentCid must not survive next to fresh content).
      if (rewriting && (key === 'contentData' || key === 'contentPath' || key === 'attachmentCid'))
        continue;
      out[key] = await rewriteValue(value);
    }

    if (rewriting) {
      let bytes: Uint8Array;
      let mimeType: string | null = null;
      if (dataUri === undefined) {
        bytes = await readContentPath(filePath!, options.readFile);
      } else {
        ({ bytes, mimeType } = decodeDataUri(dataUri));
      }
      const cid = attachmentCidOf(bytes);
      const nodeMime = typeof out.mimeType === 'string' ? out.mimeType : null;
      if (!found.has(cid)) found.set(cid, { cid, bytes, mimeType: nodeMime ?? mimeType });
      out.attachmentCid = cid;
      if (out.mimeType === undefined && mimeType) out.mimeType = mimeType;
    }
    return out;
  };

  return { body: await rewriteNode(body), attachments: [...found.values()] };
}
