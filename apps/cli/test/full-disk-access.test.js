import assert from 'node:assert/strict';
import { test } from 'node:test';

const { appBundle } = await import('../dist/commands/setup/full-disk-access.js');

/** `ps -A -o pid=,ppid=,comm=` for these processes. */
const ps = (...processes) =>
  processes
    .map(([pid, ppid, comm]) => `${String(pid).padStart(5)} ${String(ppid).padStart(5)} ${comm}`)
    .join('\n');

test('the app a shell runs in is its nearest ancestor that is an app', () => {
  const listing = ps(
    [1, 0, '/sbin/launchd'],
    [500, 1, '/Applications/Ghostty.app/Contents/MacOS/ghostty'],
    [600, 500, '/usr/bin/login'],
    [700, 600, '-/bin/zsh'],
    [800, 700, 'node']
  );
  assert.equal(appBundle(listing, 800), '/Applications/Ghostty.app');
});

test("an editor's terminal runs in a helper inside the editor, which is the app", () => {
  const listing = ps(
    [1, 0, '/sbin/launchd'],
    [500, 1, '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'],
    [
      510,
      500,
      '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
    ],
    [700, 510, '/bin/zsh'],
    [800, 700, 'node']
  );
  assert.equal(appBundle(listing, 800), '/Applications/Visual Studio Code.app');
});

test('a shell no app started, like one in tmux, has none', () => {
  const listing = ps(
    [1, 0, '/sbin/launchd'],
    [400, 1, 'tmux'],
    [700, 400, '-zsh'],
    [800, 700, 'node']
  );
  assert.equal(appBundle(listing, 800), undefined);
  assert.equal(appBundle(listing, 999), undefined);
});
