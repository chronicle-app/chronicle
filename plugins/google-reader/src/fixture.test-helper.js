import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Microseconds since the Unix epoch; this is 2010-01-01T00:00:00Z.
export const JAN_1_USEC = '1262304000000000';

export const OWNER_ID = '111';
export const FRIEND_ID = '222';

// Reader archive field names.
/* eslint-disable camelcase */
export const OWNER_INFO = {
  user_id: OWNER_ID,
  user_name: 'Pat Example',
  email: 'pat@example.com',
};
/* eslint-enable camelcase */

/** A Reader stream item the archive owner has read. */
export function item(id, timestampUsec = JAN_1_USEC) {
  return {
    id,
    title: id,
    published: 1_262_304_000,
    updated: 1_262_304_000,
    timestampUsec,
    crawlTimeMsec: '1262304000000',
    categories: [`user/${OWNER_ID}/state/com.google/read`],
    alternate: [{ href: `https://example.com/${id}`, type: 'text/html' }],
    origin: { streamId: 'feed/https://example.com/feed', title: 'Example Feed' },
  };
}

export function annotation(content, userId = OWNER_ID) {
  return { userId, author: 'Pat Example', content };
}

/**
 * An empty synthetic Reader archive: `data/user-info.json` (unless userInfo is
 * null) and an empty `_raw_data/`. Returns the archive directory.
 */
export function archive(t, userInfo = OWNER_INFO) {
  const dir = mkdtempSync(join(tmpdir(), 'google-reader-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '_raw_data'));
  mkdirSync(join(dir, 'data'));
  if (userInfo !== null) {
    writeFileSync(join(dir, 'data', 'user-info.json'), JSON.stringify(userInfo));
  }
  return dir;
}

/** Writes one raw Reader API stream response for `userId` into the archive. */
export function stream(dir, name, items, userId = OWNER_ID) {
  writeFileSync(
    join(
      dir,
      '_raw_data',
      `www.google.com-reader-api-0-stream-contents-user-${userId}-${name}.json`
    ),
    typeof items === 'string' ? items : JSON.stringify({ id: name, title: name, items })
  );
}
