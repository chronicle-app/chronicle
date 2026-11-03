import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { attachmentCidOf } from '../blob/BlobStore.js';
import { extractAttachments } from './attachments.js';
import { ValidationError } from './errors.js';

const helloBytes = new TextEncoder().encode('hello');
const helloUri = `data:image/png;base64,${Buffer.from(helloBytes).toString('base64')}`;
const helloCid = attachmentCidOf(helloBytes);

const imageWithData = (sourceId: string) => ({
  '@type': 'ImageObject',
  source: 'test',
  sourceId,
  '@key': ['source', 'sourceId'],
  contentData: helloUri,
});

const action = (image: Record<string, unknown>) => ({
  '@type': 'SendAction',
  source: 'test',
  sourceId: 's-1',
  '@key': ['source', 'sourceId'],
  object: {
    '@type': 'Message',
    source: 'test',
    sourceId: 'm-1',
    '@key': ['source', 'sourceId'],
    contains: [image],
  },
});

describe('extractAttachments', () => {
  it('rewrites a nested entity contentData into attachmentCid + mimeType', async () => {
    const input = action({
      '@type': 'ImageObject',
      source: 'test',
      sourceId: 'img-1',
      '@key': ['source', 'sourceId'],
      contentData: helloUri,
    });

    const { body, attachments } = await extractAttachments(input);

    const image = (body.object as any).contains[0];
    expect(image.contentData).toBeUndefined();
    expect(image.attachmentCid).toBe(helloCid);
    expect(image.mimeType).toBe('image/png');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ cid: helloCid, mimeType: 'image/png' });
    expect(Buffer.from(attachments[0].bytes).toString()).toBe('hello');
    // the input is not mutated
    expect((input.object.contains[0] as any).contentData).toBe(helloUri);
  });

  it('keeps an explicit mimeType over the data URI mime', async () => {
    const { body } = await extractAttachments(
      action({
        '@type': 'ImageObject',
        source: 'test',
        sourceId: 'img-1',
        '@key': ['source', 'sourceId'],
        mimeType: 'image/webp',
        contentData: helloUri,
      })
    );
    expect((body.object as any).contains[0].mimeType).toBe('image/webp');
  });

  it('replaces a stale attachmentCid sitting next to fresh contentData', async () => {
    const { body } = await extractAttachments(
      action({
        '@type': 'ImageObject',
        source: 'test',
        sourceId: 'img-1',
        '@key': ['source', 'sourceId'],
        attachmentCid: 'bafkreistale',
        contentData: helloUri,
      })
    );
    expect((body.object as any).contains[0].attachmentCid).toBe(helloCid);
  });

  it('is idempotent: a body without contentData comes back deep-equal', async () => {
    const input = action({
      '@type': 'ImageObject',
      source: 'test',
      sourceId: 'img-1',
      '@key': ['source', 'sourceId'],
      contentData: helloUri,
    });
    const first = await extractAttachments(input);
    const second = await extractAttachments(first.body);
    expect(second.body).toEqual(first.body);
    expect(second.attachments).toHaveLength(0);
  });

  it('dedupes identical bytes within one payload', async () => {
    const input = action(imageWithData('img-1'));
    (input.object.contains as unknown[]).push(imageWithData('img-2'));

    const { body, attachments } = await extractAttachments(input);

    expect(attachments).toHaveLength(1);
    const { contains } = body.object as any;
    expect(contains[0].attachmentCid).toBe(helloCid);
    expect(contains[1].attachmentCid).toBe(helloCid);
  });

  it('leaves contentData alone on non-entity objects', async () => {
    const input = {
      '@type': 'NoteAction',
      source: 'test',
      sourceId: 'n-1',
      '@key': ['source', 'sourceId'],
      metadata: { contentData: helloUri }, // no @type — not an entity node
    };
    const { body, attachments } = await extractAttachments(input);
    expect(attachments).toHaveLength(0);
    expect((body.metadata as any).contentData).toBe(helloUri);
  });

  it.each([
    ['not a data URI', 'plain string'],
    ['missing ;base64 marker', 'data:image/png,aGVsbG8='],
    ['invalid base64 characters', 'data:image/png;base64,!!!!'],
    ['bad base64 padding', 'data:image/png;base64,aGVsbG8'],
  ])('rejects malformed contentData (%s)', async (_label, contentData) => {
    const input = action({
      '@type': 'ImageObject',
      source: 'test',
      sourceId: 'img-1',
      '@key': ['source', 'sourceId'],
      contentData,
    });
    await expect(extractAttachments(input)).rejects.toThrow(ValidationError);
  });
});

const imageWithPath = (over: Record<string, unknown> = {}) => ({
  '@type': 'ImageObject',
  source: 'test',
  sourceId: 'img-1',
  '@key': ['source', 'sourceId'],
  ...over,
});

describe('extractAttachments — contentPath', () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-path-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the file and rewrites contentPath into attachmentCid', async () => {
    const filePath = join(dir, 'photo.bin');
    writeFileSync(filePath, 'file bytes');

    const { body, attachments } = await extractAttachments(
      action(imageWithPath({ contentPath: filePath, mimeType: 'image/jpeg' })),
      { readFile }
    );

    const image = (body.object as any).contains[0];
    expect(image.contentPath).toBeUndefined();
    expect(image.attachmentCid).toBe(attachmentCidOf(new TextEncoder().encode('file bytes')));
    expect(image.mimeType).toBe('image/jpeg');
    expect(attachments).toHaveLength(1);
    expect(attachments[0].mimeType).toBe('image/jpeg'); // the node's claim — paths carry no mime
    expect(Buffer.from(attachments[0].bytes).toString()).toBe('file bytes');
  });

  it('rejects a relative path', async () => {
    await expect(
      extractAttachments(action(imageWithPath({ contentPath: 'relative/photo.jpg' })), { readFile })
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a missing file', async () => {
    await expect(
      extractAttachments(action(imageWithPath({ contentPath: join(dir, 'nope.jpg') })), {
        readFile,
      })
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a contentPath when no reader is configured', async () => {
    const filePath = join(dir, 'noreader.bin');
    writeFileSync(filePath, 'file bytes');
    // The portable default: without an injected reader, a contentPath cannot be
    // resolved and must fail loudly rather than silently drop the content.
    await expect(
      extractAttachments(action(imageWithPath({ contentPath: filePath })))
    ).rejects.toThrow(ValidationError);
  });

  it('rejects a node carrying both contentData and contentPath', async () => {
    const filePath = join(dir, 'both.bin');
    writeFileSync(filePath, 'file bytes');
    await expect(
      extractAttachments(action(imageWithPath({ contentPath: filePath, contentData: helloUri })), {
        readFile,
      })
    ).rejects.toThrow(ValidationError);
  });
});
