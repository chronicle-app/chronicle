import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { countMbox, identityOf, messageBody, parseMessage, readMbox } from '../dist/index.js';

test('an mbox splits at From lines after a blank line, and gives escaped lines back', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-mail-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'mail.mbox');
  writeFileSync(
    path,
    [
      'From a@example.com Mon Jan  6 10:00:00 2025',
      'From: A <a@example.com>',
      'Subject: One',
      'Message-ID: <one@example.com>',
      '',
      'A body line that says',
      'From here on, nothing splits.',
      '>From a quoted line.',
      '',
      'From b@example.com Mon Jan  6 11:00:00 2025',
      'From: b@example.com',
      'Subject: =?UTF-8?Q?Caf=C3=A9?=',
      'Date: Mon, 6 Jan 2025 11:00:00 +0000',
      '',
      'Two.',
      '',
    ].join('\n')
  );

  assert.equal(await countMbox(path), 2);
  const messages = [];
  const envelopes = [];
  for await (const { raw, envelopeDate } of readMbox(path)) {
    messages.push(await parseMessage(raw));
    envelopes.push(envelopeDate);
  }
  // The `From ` line's date, read as UTC when it gives no zone.
  assert.deepEqual(envelopes, ['2025-01-06T10:00:00.000Z', '2025-01-06T11:00:00.000Z']);
  assert.deepEqual(
    messages.map(m => m.subject),
    ['One', 'Café']
  );
  assert.equal(
    messages[0].text,
    'A body line that says\nFrom here on, nothing splits.\nFrom a quoted line.'
  );

  // With a Message-ID, that's who it is; without, sender, date, and subject.
  assert.equal(identityOf(messages[0]), '<one@example.com>');
  assert.equal(
    identityOf(messages[1]),
    ['b@example.com', '2025-01-06T11:00:00.000Z', 'Café'].join('\u001F')
  );
  // No date and no Message-ID: nothing to identify it by.
  assert.equal(identityOf({ ...messages[1], date: null }), null);
});

test('a body is what the sender wrote: no HTML, quoted history, signature, or tracking', () => {
  // A reply: the quote under the attribution, and the signature, go.
  assert.equal(
    messageBody({
      text: [
        'Saturday works.',
        '',
        '-- ',
        'Test Owner',
        '',
        'On Sat, Mar 1, 2025 at 8:00 AM Test Friend <',
        'friend@example.com> wrote:',
        '> Coffee this weekend?',
        '>',
      ].join('\n'),
    }),
    'Saturday works.'
  );
  // A reply written between quotes keeps only what was written.
  assert.equal(
    messageBody({ text: '> Saturday?\nYes.\n> Ten?\nEleven is better.' }),
    'Yes.\nEleven is better.'
  );
  // Reply headers in other languages too.
  assert.equal(
    messageBody({
      text: 'Merci.\n\nLe lun. 3 mars 2025 à 09:00, Ami <ami@example.com> a écrit :\n> Bonjour',
    }),
    'Merci.'
  );
  // Outlook's quoted block goes from its separator.
  assert.equal(
    messageBody({
      text: 'Sounds good.\n\nSent from my iPhone\n\n-----Original Message-----\nFrom: Friend\nSent: Monday\n\nPlans?',
    }),
    'Sounds good.'
  );
  // A forward with no note keeps what it forwards.
  assert.equal(messageBody({ text: '> Read this.' }), '> Read this.');

  // HTML-only mail becomes Markdown: links kept, untracked; the preheader,
  // images, and styles gone.
  assert.equal(
    messageBody({
      html: [
        '<html><head><style>p { color: red }</style></head><body>',
        '<div style="display:none;max-height:0">Preview text nobody sees</div>',
        '<img src="https://track.example.com/open.gif" width="1" height="1">',
        '<h1>Spring sale</h1>',
        '<p>Half&nbsp;off <a href="https://shop.example.com/sale?utm_source=mail&amp;id=7">everything</a>.</p>',
        '<ul><li>Shoes</li><li>Hats</li></ul>',
        '</body></html>',
      ].join(''),
    }),
    '# Spring sale\n\nHalf off [everything](https://shop.example.com/sale?id=7).\n\n- Shoes\n- Hats'
  );
  // A text part that only points at the HTML gives way to it.
  assert.equal(
    messageBody({
      text: 'View this email in your browser: https://example.com/v',
      html: '<p>The real <b>news</b>, at length.</p>',
    }),
    'The real **news**, at length.'
  );
  // Markup in a text part is converted too, and preview padding is invisible
  // characters that go.
  assert.equal(
    messageBody({ text: '<body></body>\u034F \u034F\u200B\nShop<br>1 Example St' }),
    'Shop\n1 Example St'
  );
  // Tracking comes off any link, a mailto included, and nothing else is touched.
  assert.equal(
    messageBody({ text: 'Ask? Mail [us](mailto:us@example.com?subject=Hi&utm_source=news).' }),
    'Ask? Mail [us](mailto:us@example.com?subject=Hi).'
  );
  // A click-tracking redirect keeps its words and loses its URL.
  const redirect = `https://click.example.com/ls/${'x'.repeat(240)}`;
  assert.equal(
    messageBody({ text: `See [the sale](${redirect}).\nOr go to ${redirect}` }, { bulk: true }),
    'See the sale.\nOr go to'
  );
  // In a person's mail a long link stays: a meeting's join link is one.
  assert.equal(messageBody({ text: `Join: ${redirect}` }), `Join: ${redirect}`);
  // Joiners an emoji or a script needs are kept.
  assert.equal(
    messageBody({ text: 'At the 👨\u200D💻 desk, می\u200Cخواهم' }),
    'At the 👨\u200D💻 desk, می\u200Cخواهم'
  );
  // Bulk mail loses its footer; a person's mail that mentions unsubscribing keeps it.
  const newsletter = [
    'This week: three new trails.',
    '',
    'The ridge loop reopened, and you can unsubscribe from trail alerts in the app.',
    '',
    'See you out there.',
    '',
    'You are receiving this because you subscribed.',
    'Unsubscribe | Manage preferences',
    '1 Example St',
  ].join('\n');
  assert.equal(
    messageBody({ text: newsletter }, { bulk: true }),
    'This week: three new trails.\n\nThe ridge loop reopened, and you can unsubscribe from trail alerts in the app.\n\nSee you out there.'
  );
  assert.equal(messageBody({ text: newsletter }), newsletter);
  // A list post that only mentions opting out keeps all of it.
  const post =
    'Hi team,\nQuick update.\nWe will let people opt out of the second part.\nAlso the budget review moved.\nBob';
  assert.equal(messageBody({ text: post }, { bulk: true }), post);
  // A real text part wins over the HTML.
  assert.equal(messageBody({ text: 'Plain words.', html: '<p>Plain words.</p>' }), 'Plain words.');
});
