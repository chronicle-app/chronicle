import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { releaseTags } from '../scripts/release-tags.js';
import { checkPublished, firstReleases, redirects } from './deploy.js';

const ontology = version => `@prefix owl: <http://www.w3.org/2002/07/owl#> .
<https://schema.chronicle.app/> a owl:Ontology; owl:versionInfo "${version}" .`;

test('release tags are stable versions in numeric order', () => {
  assert.deepEqual(releaseTags(['v0.10.0', 'v0.2.0', 'v1.0.0-rc.1', 'nightly', '', 'v0.2.1']), [
    'v0.2.0',
    'v0.2.1',
    'v0.10.0',
  ]);
});

test('each vocabulary version is published from its first release', () => {
  const releases = firstReleases([
    ['v0.1.0', null],
    ['v0.2.0', ontology('0.1.0')],
    ['v0.3.0', ontology('0.1.0')],
    ['v0.4.0', ontology('0.2.0')],
  ]);
  assert.deepEqual(
    [...releases],
    [
      ['0.1.0', 'v0.2.0'],
      ['0.2.0', 'v0.4.0'],
    ]
  );
});

test('term IRIs redirect to their pages', () => {
  assert.equal(
    redirects({ classes: ['Task'], properties: ['name'] }),
    '/Task /classes/Task 303\n/name /properties/name 303'
  );
});

test('published snapshots must not change', async () => {
  const published = { '/releases/0.1.0/chronicle.ttl': 'old' };
  const server = createServer((request, response) => {
    const body = published[request.url];
    response.writeHead(body ? 200 : 404).end(body ?? 'Not found');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const output = mkdtempSync(join(tmpdir(), 'chronicle-schema-deploy-'));
  const snapshot = (version, body) => {
    mkdirSync(join(output, 'releases', version), { recursive: true });
    writeFileSync(join(output, 'releases', version, 'chronicle.ttl'), body);
  };
  try {
    snapshot('0.1.0', 'old');
    snapshot('0.2.0', 'new');
    await checkPublished(output, ['0.1.0', '0.2.0'], base);
    snapshot('0.1.0', 'changed');
    await assert.rejects(checkPublished(output, ['0.1.0'], base), /differs from the published/);
  } finally {
    server.close();
    rmSync(output, { recursive: true, force: true });
  }
});
