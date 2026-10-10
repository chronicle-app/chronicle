import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The mbox is synthetic and every address is made up; the tests read nothing
// from the host's mail.
const ALICE = 'Alice Example <alice@example.test>';
const CAROL = 'Carol <carol@example.test>';
export const KEYED_DATE = 'Mon, 6 Jan 2025 10:00:00 +0000';
export const KEYLESS_DATE = 'Mon, 6 Jan 2025 11:00:00 +0000';

/** Render message specs as one mbox; an omitted field omits its header. */
export function mbox(specs) {
  return specs
    .map(s =>
      [
        'From sender@example.test Mon Jan  6 10:00:00 2025',
        ...(s.from === undefined ? [] : [`From: ${s.from}`]),
        `To: ${s.to ?? 'bob@example.test'}`,
        ...(s.cc === undefined ? [] : [`Cc: ${s.cc}`]),
        ...(s.subject === undefined ? [] : [`Subject: ${s.subject}`]),
        ...(s.date === undefined ? [] : [`Date: ${s.date}`]),
        ...(s.messageId === undefined ? [] : [`Message-ID: ${s.messageId}`]),
        ...(s.headers ?? []),
        '',
        s.body,
        '',
      ].join('\n')
    )
    .join('\n');
}

export const keyed = {
  from: ALICE,
  to: 'Bob <bob@example.test>, dana@example.test',
  cc: 'Erin <erin@example.test>',
  // RFC 2047 encoded words are decoded.
  subject: '=?UTF-8?Q?Caf=C3=A9_plans?=',
  date: KEYED_DATE,
  messageId: '<keyed-1@example.test>',
  headers: ['MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="b1"'],
  body: [
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Lunch at noon?',
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Lunch at noon?</p>',
    '--b1--',
  ].join('\n'),
};
export const keyless = {
  from: CAROL,
  subject: 'Keyless',
  date: KEYLESS_DATE,
  body: 'No Message-ID header.',
};

export function fixture(t, specs) {
  const dir = mkdtempSync(join(tmpdir(), 'email-fixture-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'mail.mbox');
  writeFileSync(input, mbox(specs));
  return input;
}
