import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLogger } from '@chronicle.app/logging';
import { GcloudError, GoogleApi, GoogleOAuthProvider, setupGoogleClient } from '../dist/index.js';

const CLIENT = { client_id: 'synthetic.apps.googleusercontent.com', client_secret: 'synthetic' };

/** A config dir of the test's own, never the host's, and a place for files. */
function machine(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chronicle-google-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const configDir = join(dir, 'config');
  // CredentialManager reads the config dir from the environment.
  process.env.CHRONICLE_CONFIG_DIR = configDir;
  return { dir, configDir };
}

/** gcloud as a list of what it was asked to do. */
function fakeGcloud({ installed = true, account, atQuota = false } = {}) {
  const calls = [];
  return {
    listProjects: async () => ['old-project', 'other-project'],
    calls,
    available: async () => installed,
    account: async () => account,
    async login() {
      calls.push('login');
      account = 'owner@example.com';
    },
    async createProject(id) {
      calls.push(`create ${id}`);
      if (atQuota) {
        // As gcloud prints it: an update notice, then its error wrapped at 80 columns.
        throw new GcloudError(
          ['projects', 'create'],
          [
            'Updates are available for some Google Cloud CLI components.',
            '',
            'ERROR: (gcloud.projects.create) FAILED_PRECONDITION: Callers must have',
            '    project quota.',
            '',
          ].join('\n')
        );
      }
    },
    enableApis: async (id, apis) => calls.push(`enable ${apis.join(' ')}`),
    async signOut() {
      calls.push('sign out');
      account = undefined;
    },
  };
}

/**
 * A person at the terminal who presses Enter at every question, types
 * `answers` when asked for a project, and pastes `pastes` (by default the
 * client's ID and secret) when asked for the client.
 */
function person(
  { configDir },
  {
    scopeSets,
    pastes = [CLIENT.client_id, CLIENT.client_secret],
    answers = [],
    pick = '',
    interactive = true,
  } = {}
) {
  const events = [];
  const opened = [];
  const asked = [];
  const logger = createLogger({ sink: { emit: event => events.push(event) } });
  const context = {
    logger,
    configDir,
    scopeSets,
    interactive,
    fresh: false,
    signal: new AbortController().signal,
    async openUrl(url) {
      opened.push(url.replace(/\?.*/, ''));
    },
    async ask(prompt) {
      asked.push(prompt);
      if (prompt.startsWith('Press Enter to create')) return pick;
      if (prompt.startsWith('Paste the project ID') || prompt.startsWith('Project ID to use')) {
        return answers.shift();
      }
      if (prompt.startsWith('Client')) return pastes.shift();
      return '';
    },
  };
  return { context, events, opened, asked };
}

const options = (paths, gcloud) => ({ gcloud, newProjectId: () => 'chronicle-test01' });

test('setup makes the project with gcloud, walks through the console, and reuses it after', async t => {
  const paths = machine(t);
  const gcloud = fakeGcloud();
  const first = person(paths, { scopeSets: ['gmail', 'calendar'] });

  const client = await setupGoogleClient(first.context, options(paths, gcloud));

  assert.deepEqual(client, { clientId: CLIENT.client_id, clientSecret: CLIENT.client_secret });
  assert.deepEqual(gcloud.calls, [
    'login',
    'create chronicle-test01',
    'enable gmail.googleapis.com calendar-json.googleapis.com',
    // Done: the gcloud sign-in isn't kept.
    'sign out',
  ]);
  // The consent screen, publishing it, then the client.
  assert.deepEqual(first.opened, [
    'https://console.cloud.google.com/auth/overview',
    'https://console.cloud.google.com/auth/audience',
    'https://console.cloud.google.com/auth/clients/create',
  ]);
  const headings = new Set(first.events.filter(e => e.kind === 'guide').map(e => e.message));
  assert.ok(headings.has('Step 1 of 3: Create a Google Cloud project'));
  assert.ok(headings.has('Step 3 of 3: Create the app’s credentials'));
  const state = JSON.parse(readFileSync(join(paths.configDir, 'google', 'setup.json'), 'utf8'));
  assert.equal(state.projectId, 'chronicle-test01');
  assert.equal(state.account, 'owner@example.com');

  // A second sign-in reuses the client without a word.
  const again = person(paths, { scopeSets: ['gmail', 'calendar'] });
  assert.deepEqual(await setupGoogleClient(again.context, options(paths, gcloud)), client);
  assert.deepEqual(again.opened, []);

  // Adding Drive only turns its API on.
  const drive = person(paths, { scopeSets: ['gmail', 'calendar', 'drive'] });
  assert.deepEqual(await setupGoogleClient(drive.context, options(paths, gcloud)), client);
  // Adding Drive signs in to gcloud again just to turn its API on.
  assert.deepEqual(gcloud.calls.slice(-3), ['login', 'enable drive.googleapis.com', 'sign out']);
  assert.deepEqual(drive.opened, []);
});

test('setup confirms the new project, or takes one you already have', async t => {
  const paths = machine(t);
  const gcloud = fakeGcloud({ account: 'owner@example.com' });
  const walk = person(paths, { scopeSets: ['gmail'], pick: 'other-project' });

  await setupGoogleClient(walk.context, options(paths, gcloud));

  // Nothing was created; the APIs went on in the project picked.
  assert.deepEqual(gcloud.calls, ['enable gmail.googleapis.com', 'sign out']);
  const confirm = walk.events.find(e => e.kind === 'guide' && e.message === 'Confirm the project');
  assert.match(confirm.guide.text[0], /chronicle-test01.*owner@example\.com/);
  assert.match(confirm.guide.text[1], /old-project/);
  const state = JSON.parse(readFileSync(join(paths.configDir, 'google', 'setup.json'), 'utf8'));
  assert.equal(state.projectId, 'other-project');
});

test('at the project limit, setup puts the app in a project you pick', async t => {
  const paths = machine(t);
  const gcloud = fakeGcloud({ account: 'owner@example.com', atQuota: true });
  const walk = person(paths, { scopeSets: ['gmail'], answers: ['typo', 'old-project'] });

  await setupGoogleClient(walk.context, options(paths, gcloud));

  assert.deepEqual(gcloud.calls, [
    'create chronicle-test01',
    'enable gmail.googleapis.com',
    'sign out',
  ]);
  const state = JSON.parse(readFileSync(join(paths.configDir, 'google', 'setup.json'), 'utf8'));
  assert.equal(state.projectId, 'old-project');
  assert.ok(walk.events.some(e => e.kind === 'guide' && /project limit/.test(e.message)));

  // Pressing Enter instead stops, saying how to make room; gcloud's wrapped
  // error reads as one line.
  const error = new GcloudError(
    ['projects', 'create'],
    'ERROR: (gcloud.projects.create) A\n    b.\n'
  );
  assert.equal(error.said, 'A b.');
  const quit = person(machine(t), { scopeSets: ['gmail'], answers: [''] });
  await assert.rejects(
    setupGoogleClient(
      quit.context,
      options(paths, fakeGcloud({ account: 'o@example.com', atQuota: true }))
    ),
    /No Google Cloud project to use/
  );
});

test('a second run picks up where the first stopped, keeping step numbers', async t => {
  const paths = machine(t);
  mkdirSync(join(paths.configDir, 'google'), { recursive: true });
  writeFileSync(
    join(paths.configDir, 'google', 'setup.json'),
    JSON.stringify({
      account: 'owner@example.com',
      projectId: 'chronicle-test01',
      apis: ['gmail.googleapis.com'],
    })
  );
  const walk = person(paths, { scopeSets: ['gmail'] });
  await setupGoogleClient(
    walk.context,
    options(paths, fakeGcloud({ account: 'owner@example.com' }))
  );

  const guides = walk.events.filter(e => e.kind === 'guide');
  assert.deepEqual(guides[0].guide.steps, [
    'Create a Google Cloud project (done)',
    'Set up the sign-in screen',
    'Create the app’s credentials',
  ]);
  assert.deepEqual(
    guides.map(e => e.message).filter(title => title.startsWith('Step')),
    ['Step 2 of 3: Set up the sign-in screen', 'Step 3 of 3: Create the app’s credentials']
  );
});

test('without gcloud, setup asks for the project and turns the APIs on in the console', async t => {
  const paths = machine(t);
  const webFile = join(paths.dir, 'client_secret_web.json');
  const desktopFile = join(paths.dir, 'client_secret_desktop.json');
  writeFileSync(webFile, JSON.stringify({ web: CLIENT }));
  writeFileSync(desktopFile, JSON.stringify({ installed: CLIENT }));
  const walk = person(paths, {
    scopeSets: ['calendar'],
    // A web client's file is refused, then an ID that isn't one; then the
    // desktop client's file is taken.
    pastes: [webFile, 'not-an-id', desktopFile],
    answers: ['Not An ID', 'chronicle-123456'],
  });

  const client = await setupGoogleClient(
    walk.context,
    options(paths, fakeGcloud({ installed: false }))
  );

  assert.equal(client.clientId, CLIENT.client_id);
  assert.deepEqual(walk.opened, [
    'https://console.cloud.google.com/projectcreate',
    'https://console.cloud.google.com/flows/enableapi',
    'https://console.cloud.google.com/auth/overview',
    'https://console.cloud.google.com/auth/audience',
    'https://console.cloud.google.com/auth/clients/create',
  ]);
  assert.equal(walk.asked.filter(prompt => prompt.startsWith('Paste the project ID')).length, 2);
  const warnings = walk.events.filter(e => e.level === 'warn').map(e => e.message);
  assert.ok(warnings.some(message => /web client/.test(message)));
  assert.ok(warnings.includes('That doesn’t look like a client ID'));
});

test('setup needs a terminal, unless a client is already known', async t => {
  const paths = machine(t);
  const unattended = person(paths, { scopeSets: ['gmail'], interactive: false });
  await assert.rejects(
    setupGoogleClient(unattended.context, options(paths, fakeGcloud())),
    error => {
      assert.equal(error.code, 'setup-required');
      assert.match(error.hint, /chronicle auth login google/);
      return true;
    }
  );

  mkdirSync(join(paths.configDir, 'google'), { recursive: true });
  writeFileSync(
    join(paths.configDir, 'google', 'setup.json'),
    JSON.stringify({
      projectId: 'chronicle-test01',
      apis: ['gmail.googleapis.com'],
      client: { clientId: 'known', clientSecret: 'secret' },
    })
  );
  const known = await setupGoogleClient(unattended.context, options(paths, fakeGcloud()));
  assert.equal(known.clientId, 'known');
});

test('Google refusals say what to run', async t => {
  // Rate limited for the first `busy` requests, as Google says it: a 403.
  let busy = 0;
  const server = createServer((request, response) => {
    const reason = new URL(request.url, 'http://127.0.0.1').searchParams.get('reason');
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (reason === 'busy' && busy-- > 0) {
      return reply(403, { error: { code: 403, errors: [{ reason: 'rateLimitExceeded' }] } });
    }
    if (reason === 'busy') return reply(200, { ok: true });
    if (reason === 'expired') return reply(401, { error: { code: 401 } });
    if (reason === 'off') {
      return reply(403, {
        error: {
          code: 403,
          details: [
            {
              reason: 'SERVICE_DISABLED',
              metadata: {
                activationUrl:
                  'https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123',
              },
            },
          ],
        },
      });
    }
    if (reason === 'other')
      return reply(403, { error: { code: 403, message: 'The caller does not have permission' } });
    reply(403, { error: { code: 403, details: [{ reason }] } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const api = new GoogleApi({
    service: 'gmail',
    baseURL: `http://127.0.0.1:${server.address().port}`,
    accessToken: 'synthetic',
    retryDelaysMs: [1, 1],
  });

  const refusal = async reason => {
    try {
      await api.get('/', { reason });
    } catch (error) {
      return [error.code, error.hint];
    }
  };
  assert.deepEqual(await refusal('ACCESS_TOKEN_SCOPE_INSUFFICIENT'), [
    'auth-required',
    'Run `chronicle auth login google --add gmail` to add it.',
  ]);
  assert.deepEqual(await refusal('SERVICE_DISABLED'), [
    'api-disabled',
    'Run `chronicle auth login google --add gmail` to turn it on.',
  ]);
  assert.deepEqual(await refusal('expired'), [
    'auth-required',
    'Run `chronicle auth login google` to sign in again.',
  ]);

  // Google's own link to turn an API on comes first.
  const [, offHint] = await refusal('off');
  assert.match(
    offHint,
    /^Turn it on here.*overview\?project=123\nOr run `chronicle auth login google --add gmail`/
  );

  // A rate limit is waited out, and said plainly when it lasts.
  busy = 2;
  assert.deepEqual(await api.get('/', { reason: 'busy' }), { ok: true });
  busy = 5;
  assert.deepEqual(await refusal('busy'), ['rate-limited', 'Try again in a minute.']);
  // Anything else is Google's own words.
  await assert.rejects(api.get('/', { reason: 'other' }), {
    code: 'api-error',
    message: 'Gmail: The caller does not have permission',
  });
});

test('the Google sign-in asks for each source’s scopes and names the account', async () => {
  const claims = Buffer.from(JSON.stringify({ email: 'ada@example.com' })).toString('base64url');
  class Offline extends GoogleOAuthProvider {
    async postToken() {
      return { access_token: 'access', token_type: 'Bearer', id_token: `h.${claims}.s` };
    }
  }
  const provider = new Offline({
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'http://127.0.0.1:1/callback',
    scopes: GoogleOAuthProvider.scopesFor(GoogleOAuthProvider.defaultScopeSets),
  });
  const scope = new URL(provider.buildAuthUrl()).searchParams.get('scope').split(' ');
  assert.deepEqual(scope, [
    'openid',
    'email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
    // Asked for with them: it links the people in mail and calendars.
    'https://www.googleapis.com/auth/contacts.readonly',
  ]);
  assert.equal((await provider.exchangeCodeForToken('code')).account, 'ada@example.com');
});

test('a token refused partway through a run is refreshed, and the request tried again', async t => {
  const paths = machine(t);
  const refreshes = [];
  const server = createServer((request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (request.url === '/token') {
      refreshes.push(request.url);
      return reply(200, { access_token: 'fresh', expires_in: 3600 });
    }
    // The stored token still looks current, but Google has stopped taking it.
    if (request.headers.authorization === 'Bearer fresh') return reply(200, { ok: true });
    reply(401, { error: { code: 401 } });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(
    join(paths.configDir, 'credentials.json'),
    JSON.stringify({
      google: [
        {
          accessToken: 'stale',
          refreshToken: 'refresh',
          tokenType: 'Bearer',
          expiresIn: 3600,
          createdAt: new Date().toISOString(),
          clientId: 'stored-client',
          clientSecret: 'secret',
          tokenUrl: `${base}/token`,
          account: 'ada@example.com',
        },
      ],
    })
  );

  const api = new GoogleApi({ service: 'gmail', baseURL: base });
  await api.initialize();
  assert.deepEqual(await api.get('/'), { ok: true });
  assert.equal(refreshes.length, 1);

  // A client from an earlier sign-in is reused without a setup, even with no
  // terminal to ask at.
  const unattended = person(paths, { scopeSets: ['gmail'], interactive: false });
  const client = await setupGoogleClient(unattended.context, options(paths, fakeGcloud()));
  assert.equal(client.clientId, 'stored-client');
});

test('a client found without setup state turns APIs on in its own project', async t => {
  const paths = machine(t);
  // Signed in before, but setup.json is gone: the client ID names the project.
  mkdirSync(paths.configDir, { recursive: true });
  writeFileSync(
    join(paths.configDir, 'credentials.json'),
    JSON.stringify({
      google: [
        {
          accessToken: 'a',
          tokenType: 'Bearer',
          createdAt: new Date().toISOString(),
          clientId: '123456789012-abc.apps.googleusercontent.com',
          clientSecret: 's',
        },
      ],
    })
  );
  const walk = person(paths, { scopeSets: ['gmail', 'contacts'] });
  const client = await setupGoogleClient(
    walk.context,
    options(paths, fakeGcloud({ installed: false }))
  );

  assert.equal(client.clientId, '123456789012-abc.apps.googleusercontent.com');
  assert.deepEqual(walk.opened, ['https://console.cloud.google.com/flows/enableapi']);
  const state = JSON.parse(readFileSync(join(paths.configDir, 'google', 'setup.json'), 'utf8'));
  assert.equal(state.projectId, '123456789012');
  assert.ok(state.apis.includes('people.googleapis.com'));
});
