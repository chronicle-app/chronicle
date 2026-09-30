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
      // Repeated chatter groups by its message without a key: three examples, then roll-ups
      // with how often each value came up, and every event is accounted for.
      const chatter = events.filter(e => e.scope === 'arena.api');
      assert.equal(chatter.filter(e => !e.fields.suppressed).length, 3);
      assert.ok(chatter.some(e => /^…\d+ more like this in \d+s$/.test(e.message)));
      const rolled = chatter.reduce((sum, e) => sum + (e.fields.suppressed ?? 0), 0);
      assert.equal(rolled, 27);
      assert.ok(chatter.some(e => e.fields.values?.recordType?.blocks > 0));
      continue;
    }
    if (format === 'plain') {
      for (const line of lines) assert.doesNotMatch(line, ANSI, `${title} has color`);
      assert.match(lines[0], /^\d{2}:\d{2}:\d{2} /);
    }
    if (format === 'pretty') {
      // The time sits at the right edge of notices when there's room, and gives way when not.
      const warning = lines
        .map(line => line.replaceAll(ANSI, ''))
        .find(line => line.startsWith('! '));
      if (width === 120) assert.ok(warning.endsWith(' 09:30:05') && warning.length === width);
      if (width === 40) assert.doesNotMatch(warning, /09:30:05/);
      assert.ok(lines.every(line => !/✓.*09:30:05/.test(line.replaceAll(ANSI, ''))));
    }
    for (const line of lines) {
      const visible = line.replaceAll(ANSI, '');
      assert.ok(visible.length <= width, `${title}: ${visible.length} > ${width}: ${visible}`);
    }
  }
});
