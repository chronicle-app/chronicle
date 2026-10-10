import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContactDirectory } from '@chronicle.app/google';
import { GmailApiExtractor } from '../dist/index.js';

/** Synthetic mail between made-up people; nothing here is anyone's real data. */
export const TOKEN = 'synthetic-token';
export const OWNER = 'owner@example.com';
export const FRIEND = 'friend@example.com';
/** One thread, in hex as the API writes it. */
export const THREAD = '18c1f0a2b3c4d5e6';

/**
 * Each message: its raw RFC 5322 text, and what Gmail knows of it, with
 * label IDs as the API has them and names as a Takeout writes them.
 */
export const MESSAGES = [
  {
    id: '18c1f0a2b3c4d5e7',
    threadId: THREAD,
    labelIds: ['SENT'],
    takeoutLabels: 'Sent,Opened',
    receivedAt: '2025-03-02T09:00:05Z',
    raw: [
      `From: Test Owner <${OWNER}>`,
      `To: Test Friend <${FRIEND}>`,
      'Subject: Re: Plans',
      'Date: Sun, 2 Mar 2025 09:00:00 +0000',
      'Message-ID: <reply@example.com>',
      'In-Reply-To: <plans@example.com>',
      'References: <plans@example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Saturday works.',
    ],
  },
  {
    id: THREAD,
    threadId: THREAD,
    labelIds: ['INBOX', 'STARRED', 'UNREAD', 'Label_1', 'Label_2'],
    // A Takeout writes a label with an accent as an encoded word.
    takeoutLabels: 'Inbox,Starred,Unread,Work,=?UTF-8?Q?Caf=C3=A9?=',
    receivedAt: '2025-03-01T08:00:05Z',
    raw: [
      `From: Test Friend <${FRIEND}>`,
      `To: ${OWNER}`,
      'Subject: Plans',
      'Date: Sat, 1 Mar 2025 08:00:00 +0000',
      'Message-ID: <plans@example.com>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Caf=C3=A9 this weekend?',
      '--b1',
      'Content-Type: text/calendar; name="plans.ics"',
      'Content-Disposition: attachment; filename="plans.ics"',
      '',
      'BEGIN:VCALENDAR',
      '--b1--',
    ],
  },
  {
    id: '18c1f0a2b3c4d5d0',
    threadId: '18c1f0a2b3c4d5d0',
    labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
    takeoutLabels: 'Inbox,Category Promotions,Opened',
    receivedAt: '2025-02-20T12:00:05Z',
    raw: [
      'From: Shop <shop@example.com>',
      `To: ${OWNER}`,
      'Subject: Sale',
      'Date: Thu, 20 Feb 2025 12:00:00 +0000',
      'Message-ID: <sale@example.com>',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body><p>Half&nbsp;off</p><style>p{}</style></body></html>',
    ],
  },
  {
    // Deleted between the listing and the fetch: the API answers 404.
    id: '18c1f0a2b3c4d5c9',
    threadId: '18c1f0a2b3c4d5c9',
    labelIds: ['INBOX'],
    gone: true,
    raw: [],
  },
  {
    // Never sent: a draft isn't a message.
    id: '18c1f0a2b3c4d5c8',
    threadId: '18c1f0a2b3c4d5c8',
    labelIds: ['DRAFT'],
    takeoutLabels: 'Drafts',
    receivedAt: '2025-02-15T12:00:05Z',
    raw: [
      `From: Test Owner <${OWNER}>`,
      `To: ${FRIEND}`,
      'Subject: Unsent',
      'Date: Sat, 15 Feb 2025 12:00:00 +0000',
      'Message-ID: <draft@example.com>',
      '',
      'Not yet.',
    ],
  },
  {
    id: '18c1f0a2b3c4d5c0',
    threadId: '18c1f0a2b3c4d5c0',
    labelIds: ['SPAM'],
    takeoutLabels: 'Spam',
    receivedAt: '2025-02-10T12:00:05Z',
    raw: [
      'From: spam@example.net',
      `To: ${OWNER}`,
      'Subject: Prize',
      'Date: Mon, 10 Feb 2025 12:00:00 +0000',
      'Message-ID: <prize@example.net>',
      '',
      'Claim it.',
    ],
  },
];

/**
 * Your contact for the friend: the name you saved, beside the one on their own
 * profile, another address, and a number.
 */
export const FRIEND_CONTACT = {
  resourceName: 'people/c1001',
  names: [
    { displayName: 'Friend From Contacts', metadata: { source: { type: 'CONTACT' } } },
    { displayName: 'Friend Profile Name', metadata: { source: { type: 'PROFILE' } } },
  ],
  emailAddresses: [{ value: 'Friend@Example.com' }, { value: 'friend@home.example' }],
  phoneNumbers: [{ value: '416 555 0100', canonicalForm: '+14165550100' }],
};

/** Labels you made, as the API lists them. */
const USER_LABELS = [
  { id: 'Label_1', name: 'Work' },
  { id: 'Label_2', name: 'Café' },
];

/**
 * The Gmail API on 127.0.0.1, listing messages newest first, two to a page,
 * filtered by `labelIds` and Spam and Trash as Gmail does. The search (`q`)
 * is recorded, not applied: what it asks for is the test's to check.
 */
export async function fakeGmail(t, options = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requests.push({
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      labelIds: url.searchParams.getAll('labelIds'),
    });
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: {} });
    if (url.pathname === '/people/me/connections') {
      // Without Contacts access, Google refuses with this reason.
      if (options.noContacts) {
        return reply(403, {
          error: { code: 403, details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] },
        });
      }
      return reply(200, { connections: [FRIEND_CONTACT] });
    }
    if (url.pathname === '/users/me/profile') {
      return reply(200, { emailAddress: OWNER, messagesTotal: MESSAGES.length });
    }
    if (url.pathname === '/users/me/labels') {
      return reply(200, { labels: [{ id: 'INBOX', name: 'INBOX' }, ...USER_LABELS] });
    }
    if (url.pathname === '/users/me/messages') {
      const wanted = url.searchParams.getAll('labelIds');
      const all = url.searchParams.get('includeSpamTrash') === 'true';
      const listed = MESSAGES.filter(
        m => all || !m.labelIds.some(id => id === 'SPAM' || id === 'TRASH')
      )
        .filter(m => wanted.every(id => m.labelIds.includes(id)))
        .map(m => ({ id: m.id, threadId: m.threadId }));
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      return reply(200, {
        messages: listed.slice(start, start + 2),
        ...(start + 2 < listed.length && { nextPageToken: String(start + 2) }),
      });
    }
    const message = MESSAGES.find(m => url.pathname === `/users/me/messages/${m.id}`);
    if (!message || message.gone) {
      return reply(404, { error: { code: 404, message: 'Requested entity was not found.' } });
    }
    reply(200, {
      id: message.id,
      threadId: message.threadId,
      labelIds: message.labelIds,
      internalDate: String(Date.parse(message.receivedAt)),
      // Gmail sends the message with CRLF line ends.
      raw: Buffer.from(message.raw.join('\r\n')).toString('base64url'),
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { apiBaseURL, batchIntervalMs } = GmailApiExtractor;
  const contactsBaseURL = ContactDirectory.apiBaseURL;
  GmailApiExtractor.apiBaseURL = `http://127.0.0.1:${server.address().port}`;
  ContactDirectory.apiBaseURL = GmailApiExtractor.apiBaseURL;
  GmailApiExtractor.batchIntervalMs = 0;
  t.after(() => {
    GmailApiExtractor.apiBaseURL = apiBaseURL;
    ContactDirectory.apiBaseURL = contactsBaseURL;
    GmailApiExtractor.batchIntervalMs = batchIntervalMs;
    server.close();
  });
  return requests;
}

/**
 * The same messages as a Takeout writes them: one mbox, Gmail's thread and
 * message IDs in decimal, and label names in `X-Gmail-Labels`.
 */
export function takeout(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-gmail-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'All mail Including Spam and Trash.mbox');
  const mbox = MESSAGES.filter(m => !m.gone)
    .map(m =>
      [
        `From ${BigInt(`0x${m.id}`)}@xxx Mon Mar 03 00:00:00 +0000 2025`,
        `X-GM-THRID: ${BigInt(`0x${m.threadId}`)}`,
        `X-GM-MSGID: ${BigInt(`0x${m.id}`)}`,
        `X-Gmail-Labels: ${m.takeoutLabels}`,
        `Delivered-To: ${OWNER}`,
        ...m.raw,
        '',
      ].join('\n')
    )
    .join('\n');
  writeFileSync(path, mbox);
  return path;
}
