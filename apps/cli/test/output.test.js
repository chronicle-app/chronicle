import assert from 'node:assert/strict';
import { test } from 'node:test';

const ANSI = /\u001B\[[0-9;]*m/g;

test('the gallery renders every block and event within its width, in every sink and theme', async () => {
  const { gallery, EVENTS } = await import('../dist/output/gallery.js');
  const sections = gallery();
  assert.ok(sections.length > 0);
  for (const { title, width, format, lines } of sections) {
    assert.ok(lines.length > 0, `${title} is empty`);
    if (format === 'json') {
      const events = lines.map(line => JSON.parse(line));
      // Personal fields are redacted, a keyed flood aggregates, progress is a heartbeat.
      const warning = events.find(e => e.message === 'unparseable line skipped');
      assert.equal(warning.fields.file, '[redacted]');
      assert.ok(
        events.some(e => e.message === '…and 2 more like this' && e.fields.suppressed === 2)
      );
      assert.equal(events.filter(e => e.kind === 'progress').length, 1);
      assert.equal(events.length, EVENTS.length - 2 + 1);
      continue;
    }
    if (format === 'plain') {
      for (const line of lines) assert.doesNotMatch(line, ANSI, `${title} has color`);
      assert.match(lines[0], /^\d{2}:\d{2}:\d{2} /);
    }
    for (const line of lines) {
      const visible = line.replaceAll(ANSI, '');
      assert.ok(visible.length <= width, `${title}: ${visible.length} > ${width}: ${visible}`);
    }
  }
});
