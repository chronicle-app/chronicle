import path from 'node:path';
import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  DocumentObject,
  EntityAndChildren,
  Person,
  Realm,
  UpdateAction,
} from '@chronicle.app/schema';
import type { VaultContext, VaultNote } from './ObsidianExtractor.js';

const SOURCE = 'obsidian';
const NOTE_KEY = ['source', 'handle', 'inRealm.handle'];
const withExtension = (value: string) => (/\.md$/i.test(value) ? value : `${value}.md`);

/** Every note is a document; custom properties never infer a real-world subject. */
export default class ObsidianTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<UpdateAction[]> {
    if (record.extraction.recordType !== 'notes') return [];
    const note = record.data as VaultNote;
    const ctx = record.context as VaultContext;
    const document = this.document(note.path, ctx);
    document.body = note.body;
    document.tags = note.tags;
    document.references = this.references(note, ctx);
    return [
      {
        '@type': 'UpdateAction',
        '@key': ['@type', 'source', 'object.handle', 'object.inRealm.handle', 'timestamp'],
        source: SOURCE,
        timestamp: note.mtime as unknown as Date,
        agent: selfAgent({ source: SOURCE }) as Person,
        object: document,
      },
    ];
  }

  private document(handle: string, ctx: VaultContext): DocumentObject {
    const realm: Realm = {
      '@type': 'Realm',
      '@key': ['@type', 'source', 'handle'],
      source: SOURCE,
      handle: ctx.vault,
    };
    return {
      '@type': 'DocumentObject',
      '@key': NOTE_KEY,
      source: SOURCE,
      handle,
      name: path.posix.basename(handle, path.posix.extname(handle)),
      inRealm: realm,
      mimeType: 'text/markdown',
    };
  }

  private references(note: VaultNote, ctx: VaultContext): EntityAndChildren[] {
    const references = new Map<string, EntityAndChildren>();
    // Ignore code examples and comments when recognizing links. The original
    // Markdown is preserved verbatim on the document.
    const text = note.body
      .replaceAll(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*(?:\n|$)/gm, '')
      .replaceAll(/(`+)[^\n]*?\1/g, '')
      .replaceAll(/<!--[^]*?-->|%%[^]*?%%/g, '');
    const add = (raw: string, wiki: boolean) => {
      let target = raw.trim();
      if (/^https?:\/\//i.test(target)) {
        try {
          const url = new URL(target).href;
          references.set(url, {
            '@type': 'Entity',
            '@key': ['url'],
            source: 'url',
            url,
          });
        } catch {
          /* Keep malformed links in the body only. */
        }
        return;
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) return;
      try {
        target = decodeURIComponent(target);
      } catch {
        return;
      }
      target = target.split('#')[0];
      if (!target) return;
      const resolved = this.resolve(target, note.path, ctx.paths, wiki);
      if (resolved && resolved !== note.path)
        references.set(resolved, this.document(resolved, ctx));
    };
    for (const match of text.matchAll(/(?<!\\)\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g))
      add(match[1], true);
    for (const match of text.matchAll(
      /(?<!!)(?<!\\)\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"\n]*")?\s*\)/g
    ))
      add(match[1] ?? match[2], false);
    return [...references.values()];
  }

  /** Resolve only existing notes; never guess among ambiguous basenames. */
  private resolve(
    target: string,
    from: string,
    paths: string[],
    wiki: boolean
  ): string | undefined {
    const root = withExtension(path.posix.normalize(target.replace(/^\//, '')));
    const relative = withExtension(
      path.posix.normalize(path.posix.join(path.posix.dirname(from), target))
    );
    const candidates = wiki && !target.startsWith('.') ? [root, relative] : [relative, root];
    for (const candidate of candidates) if (paths.includes(candidate)) return candidate;
    if (!wiki || target.startsWith('.')) return undefined;
    const matches = paths.filter(value => value.endsWith(`/${root}`));
    return matches.length === 1 ? matches[0] : undefined;
  }
}
