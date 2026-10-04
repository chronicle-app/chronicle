import { createServer } from 'node:http';
import { GoogleContactsExtractor } from '../dist/index.js';

/** Synthetic contacts; nothing here is anyone's real data. */
export const TOKEN = 'synthetic-token';

const GROUPS = [
  {
    resourceName: 'contactGroups/myContacts',
    groupType: 'SYSTEM_CONTACT_GROUP',
    name: 'myContacts',
  },
  { resourceName: 'contactGroups/starred', groupType: 'SYSTEM_CONTACT_GROUP', name: 'starred' },
  { resourceName: 'contactGroups/abc123', groupType: 'USER_CONTACT_GROUP', name: 'Book club' },
];

const member = group => ({ contactGroupMembership: { contactGroupResourceName: group } });

/** Most recently edited first, as `LAST_MODIFIED_DESCENDING` lists them. */
export const CONTACTS = [
  {
    resourceName: 'people/c111',
    metadata: {
      sources: [
        { type: 'CONTACT', id: '111', updateTime: '2025-03-01T10:00:00Z' },
        // Ada changed her own Google profile since: that isn't an edit of yours.
        { type: 'PROFILE', id: '999', updateTime: '2026-09-01T00:00:00Z' },
      ],
    },
    names: [{ displayName: 'Ada Example', metadata: { primary: true } }],
    emailAddresses: [{ value: 'Ada@Example.com' }, { value: 'ada@work.example' }],
    phoneNumbers: [{ value: '(416) 555-0100', canonicalForm: '+14165550100' }],
    organizations: [
      { name: 'Example Co', title: 'Engineer', current: true },
      { name: 'Old Co', current: false },
    ],
    biographies: [{ value: 'Met at <b>the conference</b>.', contentType: 'TEXT_HTML' }],
    photos: [{ url: 'https://photos.example/ada.jpg', default: false }],
    memberships: [
      member('contactGroups/myContacts'),
      member('contactGroups/starred'),
      member('contactGroups/abc123'),
    ],
  },
  {
    resourceName: 'people/c222',
    metadata: { sources: [{ type: 'CONTACT', id: '222', updateTime: '2025-02-01T09:00:00Z' }] },
    names: [{ displayName: 'Bo Sample' }],
    phoneNumbers: [{ value: '+1 416 555 0199' }],
    photos: [{ url: 'https://photos.example/default.png', default: true }],
    memberships: [member('contactGroups/myContacts')],
  },
];

/** The People API on 127.0.0.1, one contact to a page. */
export async function fakePeople(t) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const query = Object.fromEntries(url.searchParams);
    requests.push({ path: url.pathname, query });
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { error: {} });
    if (url.pathname === '/contactGroups') return reply(200, { contactGroups: GROUPS });
    if (url.pathname === '/people/me/connections') {
      const at = Number(query.pageToken ?? 0);
      return reply(200, {
        connections: CONTACTS.slice(at, at + 1),
        ...(at + 1 < CONTACTS.length && { nextPageToken: String(at + 1) }),
      });
    }
    reply(404, { error: { code: 404, message: 'Not found' } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { apiBaseURL } = GoogleContactsExtractor;
  GoogleContactsExtractor.apiBaseURL = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    GoogleContactsExtractor.apiBaseURL = apiBaseURL;
    server.close();
  });
  return requests;
}
