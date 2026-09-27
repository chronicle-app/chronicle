import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArchiveExtractor } from '../dist/index.js';

// All identifiers and records in this file are synthetic fixtures.
class FixtureArchiveExtractor extends ArchiveExtractor {
  static source = 'fixture-archive';
  static strategy = 'archive';
  static recordTypes = ['posts'];

  async loadAccountInfo() {
    return this.readArchiveJson(join(this.config.input, 'profile.json'));
  }

  async setup() {
    await super.setup();
    this.accountInfo = await this.loadAccountInfo();
  }

  async *extract() {
    const posts = await this.readArchiveJson(join(this.config.input, 'posts.json'));
    for (const post of posts) {
      if (!this.isWithinDateRange(new Date(post.timestamp * 1000))) continue;
      yield this.createRecordWithArchiveContext(
        { ...post, text: this.fixArchiveTextEncoding(post.text) },
        { recordType: 'posts' }
      );
    }
  }
}

/** Write each UTF-8 byte of `text` as its own `\u00XX` escape, as these exports do. */
function mojibake(text) {
  return String.fromCodePoint(...new TextEncoder().encode(text));
}

test('reads a synthetic archive with its account context, date window and text repair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chronicle-archive-'));
  try {
    await writeFile(
      join(directory, 'profile.json'),
      JSON.stringify({ username: 'example.person', name: mojibake('Exämple Person') })
    );
    await writeFile(
      join(directory, 'posts.json'),
      JSON.stringify([
        { id: 'post-1', timestamp: 1_767_225_600, text: ` ${mojibake('Café ☕ “quoted”')} ` },
        { id: 'post-2', timestamp: 1_735_689_600, text: 'Outside the window' },
        { id: 'post-3', timestamp: 1_769_904_000, text: 'Already decoded ☕ café' },
        { id: 'post-4', timestamp: 1_769_904_000, text: 'Invalid bytes ÿþ' },
      ])
    );

    const extractor = new FixtureArchiveExtractor({
      input: directory,
      since: new Date('2026-01-01T00:00:00Z'),
    });
    assert.equal(FixtureArchiveExtractor.delivery, 'export');
    await extractor.setup();
    const records = [];
    for await (const record of extractor.extract()) records.push(record);
    await extractor.teardown();

    assert.deepEqual(
      records.map(r => [r.data.id, r.data.text]),
      [
        ['post-1', 'Café ☕ “quoted”'],
        ['post-3', 'Already decoded ☕ café'],
        ['post-4', 'Invalid bytes ÿþ'],
      ]
    );
    assert.deepEqual(records[0].context, {
      recordType: 'posts',
      strategy: 'archive',
      accountInfo: { username: 'example.person', name: mojibake('Exämple Person') },
    });
    assert.equal(records[0].extraction.delivery, 'export');

    await assert.rejects(
      extractor.readArchiveJson(join(directory, 'missing.json')),
      /Failed to read archive JSON file/
    );
    assert.throws(() => new FixtureArchiveExtractor({}), /input/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
