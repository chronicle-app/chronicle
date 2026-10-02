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
    // However narrow, a failed run's summary keeps its failure count, on a
    // line of its own under the outcome.
    const failedAt = lines.findIndex(line => line.includes('✗') && line.includes('sessions'));
    if (failedAt >= 0) {
      const counts = lines.slice(failedAt + 1, failedAt + 6).map(line => line.replaceAll(ANSI, ''));
      assert.ok(
        counts.some(line => /5 failed/.test(line)),
        title
      );
    }
    for (const line of lines) {
      const visible = line.replaceAll(ANSI, '');
      // A hint's command prints whole, on a line of its own: one split can't be copied.
      const command = /^(\d\d:\d\d:\d\d )? {4,6}`?chronicle [^`]*`?[.?]?$/.test(visible);
      if (command) continue;
      assert.ok(visible.length <= width, `${title}: ${visible.length} > ${width}: ${visible}`);
    }
  }
});

test('a group that goes quiet still gets its roll-up on time', async () => {
  const { JsonSink } = await import('@chronicle.app/logging');
  const lines = [];
  const sink = new JsonSink({
    level: 'debug',
    write: line => lines.push(JSON.parse(line)),
    aggregate: { examples: 1, windowMs: 100 },
  });
  for (let i = 0; i < 4; i++) {
    sink.emit({ time: new Date(), level: 'info', kind: 'notice', scope: 'x', message: 'tick' });
  }
  assert.equal(lines.length, 1);
  // Nothing else arrives; the sink's own timer reports the three held back.
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(lines.length, 2);
  assert.equal(lines[1].fields.suppressed, 3);
  sink.flush();
});
