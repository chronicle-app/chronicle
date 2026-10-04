import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  CredentialManager,
  type ClientCredentials,
  type ProviderSetupContext,
} from '@chronicle.app/auth';
import { EXIT_CODES, ExtractorError } from '@chronicle.app/logging';
import { CommandLineGcloud, GcloudError, type Gcloud } from './gcloud.js';
import { GOOGLE_SERVICES, isGoogleService } from './services.js';

const CONSOLE = 'https://console.cloud.google.com';

/** A Google Cloud project ID: 6 to 30 lowercase letters, digits, and hyphens. */
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

/** What setup has done so far, kept so a second run picks up where it left off. */
interface SetupState {
  /** The Google account that owns the project. */
  account?: string;
  projectId?: string;
  /** APIs turned on in the project. */
  apis?: string[];
  consentScreen?: boolean;
  client?: ClientCredentials;
}

/** Stand-ins for the machine, so tests never reach gcloud. */
export interface SetupOptions {
  gcloud?: Gcloud;
  /** A new project's ID. */
  newProjectId?: () => string;
}

/**
 * Walk a person through making their own Google OAuth client, once: a Google
 * Cloud project with the APIs their sources read, a consent screen, and a
 * desktop client. gcloud does what it can (the project and APIs), in a config
 * directory of Chronicle's own; the consent screen and the client have no
 * API, so the person makes them in the Cloud console, one page at a time.
 *
 * Each finished step is saved, so stopping halfway loses nothing. Later runs
 * reuse the client, and only turn on the APIs for access added since.
 */
export async function setupGoogleClient(
  context: ProviderSetupContext,
  options: SetupOptions = {}
): Promise<ClientCredentials> {
  const dir = join(context.configDir, 'google');
  const statePath = join(dir, 'setup.json');
  const gcloud = options.gcloud ?? new CommandLineGcloud(join(dir, 'gcloud'));
  const { logger } = context;

  const state: SetupState = context.fresh ? {} : await load(statePath);
  const save = async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  };

  // A client passed with --client-id on an earlier sign-in counts too.
  if (!state.client && !context.fresh) {
    const stored = await CredentialManager.getCredentials('google');
    if (stored?.clientId) {
      state.client = { clientId: stored.clientId, clientSecret: stored.clientSecret };
    }
  }

  const services = context.scopeSets.filter(set => isGoogleService(set));
  const apis = services.map(service => GOOGLE_SERVICES[service].api);
  const missingApis = state.projectId ? apis.filter(api => !state.apis?.includes(api)) : [];

  // Set up before: nothing to do, unless access was added since. A client
  // made by hand has no project on record, so its APIs are the person's.
  if (state.client && missingApis.length === 0) {
    logger.debug('Using the Google client set up before', { project: state.projectId });
    return state.client;
  }

  if (!context.interactive) {
    throw new ExtractorError('Google sign-in needs a one-time setup in a terminal', {
      code: 'setup-required',
      exitCode: EXIT_CODES.auth,
      hint: [
        'Run `chronicle auth login google` in a terminal.',
        'Or pass a client you made with `--client-file <path>`.',
      ].join('\n'),
    });
  }

  /** A section of the walkthrough: a title, a few sentences, then what to do. */
  const guide = (title: string, text: string[], steps: string[] = []) =>
    logger.emit({ level: 'info', kind: 'guide', message: title, guide: { text, steps } });

  // Access added to a client set up before: just turn its APIs on.
  if (state.client && state.projectId) {
    await enableApis(missingApis);
    await signOut();
    return state.client;
  }

  const titles = {
    project: 'Create a Google Cloud project',
    consent: 'Set up the sign-in screen',
    client: 'Create the app’s credentials',
  };
  // Always numbered out of all three, so a step keeps its number when a
  // second run picks up where the first stopped.
  const order = ['project', 'consent', 'client'] as const;
  const done = {
    project: Boolean(state.projectId) && missingApis.length === 0,
    consent: Boolean(state.consentScreen),
    client: false,
  };
  const steps = order.filter(name => !done[name]);
  const step = (name: keyof typeof titles) =>
    `Step ${order.indexOf(name) + 1} of ${order.length}: ${titles[name]}`;
  const overview = order.map(name => (done[name] ? `${titles[name]} (done)` : titles[name]));

  if (steps.length < order.length) {
    guide('Setting up Google access', ['Picking up where you left off.'], overview);
  } else {
    guide(
      'Setting up Google access',
      [
        'To read your Gmail and Calendar, Chronicle signs in to Google as an app. Chronicle doesn’t come with one, so you’ll create your own in Google Cloud.',
        'It’s free, only you use it, and your data goes straight from Google to this computer.',
        'It takes about 5 minutes, once. You’ll switch between here and your browser.',
      ],
      overview
    );
  }

  if (steps.includes('project')) {
    if (state.projectId) {
      guide(step('project'), ['The project is where your app lives.']);
      await enableApis(missingApis);
    } else if (await gcloud.available()) {
      await projectWithGcloud();
    } else {
      await projectInConsole();
    }
  }
  const projectId = state.projectId!;

  if (!state.consentScreen) {
    guide(
      step('consent'),
      [
        `This is the Google page you’ll see when you sign in. Check the project at the top of the page is \`${projectId}\`.`,
        'If the page shows OAuth Overview with charts instead of Get started, the project already has one. Press Enter here and go on.',
      ],
      [
        'Click Get started.',
        'Name the app Chronicle, pick your email for user support, and click Next.',
        'Pick External for the audience and click Next.',
        'Enter your email for contact, agree to the policy, and click Create.',
      ]
    );
    await context.openUrl(`${CONSOLE}/auth/overview?project=${projectId}`);
    await context.ask('Press Enter when it’s created.');

    guide(
      'Publish the app',
      [
        'Without this, Google signs you out every 7 days. Publishing doesn’t make the app public. It’s still only for you.',
        'If it already says In production, there’s nothing to do.',
      ],
      [
        'Check the user type is External. With Internal, only accounts in that Workspace can sign in.',
        'Under Publishing status, click Publish app, then Confirm.',
      ]
    );
    await context.openUrl(`${CONSOLE}/auth/audience?project=${projectId}`);
    await context.ask('Press Enter when it’s published.');
    state.consentScreen = true;
    await save();
  }

  guide(
    step('client'),
    [
      `Chronicle uses these to sign in as your app. Check the project at the top of the page is \`${projectId}\`.`,
      'If you see a list of OAuth 2.0 Client IDs instead, click Create credentials at the top, then OAuth client ID. Clients already there won’t work unless they’re Desktop apps.',
    ],
    [
      'Pick Desktop app as the type, name it Chronicle, and click Create.',
      'The window that opens shows the client ID and secret. Copy each one and paste it here.',
    ]
  );
  await context.openUrl(`${CONSOLE}/auth/clients/create?project=${projectId}`);
  state.client = await askClient(context);
  await save();
  // Setup is done: its gcloud sign-in isn't needed until access is added.
  await signOut();

  guide(
    'Your app is ready',
    [
      'Next, sign in with the Google account whose mail and calendar you want.',
      'Google warns that it hasn’t verified the app. That’s expected for an app only you use.',
    ],
    [
      'Click Continue, or Advanced and then Go to Chronicle.',
      'Tick every box, so Chronicle can read your mail and calendar.',
    ]
  );
  logger.emit({
    level: 'info',
    kind: 'hint',
    message: 'To add another account later, run `chronicle auth login google` again.',
  });
  return state.client;

  async function projectWithGcloud() {
    let account = await gcloud.account();
    guide(step('project'), [
      'The project is where your app lives. Chronicle creates it for you with gcloud.',
      ...(account
        ? []
        : [
            'First, sign in to Google Cloud with the account that will own the app. Your personal account is a good choice. Any of your Google accounts, personal or work, can use the app later.',
            'If you already use gcloud, this sign-in is kept separate and won’t change it. Chronicle signs out again when setup is done.',
          ]),
    ]);
    if (!account) {
      await context.ask('Press Enter to open the sign-in page.');
      await gcloud.login();
      account = await gcloud.account();
      if (!account) {
        throw new ExtractorError('The Google Cloud sign-in didn’t finish', {
          code: 'setup-failed',
          exitCode: EXIT_CODES.auth,
          hint: 'Run `chronicle auth login google` again to pick up where you left off.',
        });
      }
    }
    state.account = account;

    if (!state.projectId) {
      const projectId = options.newProjectId?.() ?? newProjectId();
      const projects: string[] = await gcloud.listProjects().catch(() => []);
      guide('Confirm the project', [
        `A new project, \`${projectId}\`, owned by ${account}.`,
        ...(projects.length > 0
          ? [
              `To use a project you already have instead, paste its ID. Yours are ${projects.map(id => `\`${id}\``).join(', ')}.`,
            ]
          : []),
      ]);
      const chosen = await pickProject(
        'Press Enter to create it, or paste a project ID:',
        projects
      );
      if (chosen) {
        state.projectId = chosen;
        await save();
        await enableApis(apis);
        return;
      }
      logger.info('Creating a Google Cloud project', { project: projectId });
      try {
        await gcloud.createProject(projectId, 'Chronicle');
        state.projectId = projectId;
      } catch (error) {
        if (!(error instanceof GcloudError && /quota/i.test(error.said))) {
          throw gcloudFailure(error, 'Couldn’t create a Google Cloud project');
        }
        state.projectId = await existingProject();
      }
      await save();
    }
    await enableApis(apis);
  }

  /**
   * At the project limit, an existing project can hold the app instead: the
   * person picks one of theirs, or stops to delete one.
   */
  async function existingProject(): Promise<string> {
    const projects: string[] = await gcloud.listProjects().catch(() => []);
    guide(
      'You’ve reached your Google Cloud project limit',
      [
        'Google limits how many projects an account can have. Projects you deleted still count for 30 days.',
        'You can put the app in a project you already have instead. It only adds the app and turns on the APIs.',
        ...(projects.length > 0
          ? [`Your projects: ${projects.map(id => `\`${id}\``).join(', ')}`]
          : []),
      ],
      [
        'Paste the ID of the project to use.',
        `Or press Enter to stop, delete a project you don’t need at \`${CONSOLE}/cloud-resource-manager\`, and run \`chronicle auth login google\` again.`,
      ]
    );
    const chosen = await pickProject('Project ID to use:', projects);
    if (!chosen) {
      throw new ExtractorError('No Google Cloud project to use', {
        code: 'setup-failed',
        exitCode: EXIT_CODES.auth,
        hint: `Delete a project you don’t need at \`${CONSOLE}/cloud-resource-manager\`.\nThen run \`chronicle auth login google\` again.`,
      });
    }
    return chosen;
  }

  /** One of `projects`, as the person pastes it, or undefined for just Enter. */
  async function pickProject(prompt: string, projects: string[]): Promise<string | undefined> {
    for (;;) {
      const answer = await context.ask(prompt);
      if (!answer) return undefined;
      if (!PROJECT_ID.test(answer)) {
        logger.emit({
          level: 'warn',
          kind: 'notice',
          message: 'That doesn’t look like a project ID',
          hint: { action: 'Paste an ID like chronicle-123456, or press Enter.' },
        });
        continue;
      }
      if (projects.length === 0 || projects.includes(answer)) return answer;
      logger.emit({
        level: 'warn',
        kind: 'notice',
        message: 'That isn’t one of your projects',
        hint: { action: 'Paste one of the IDs above, or press Enter.' },
      });
    }
  }

  async function projectInConsole() {
    guide(
      step('project'),
      [
        'The project is where your app lives.',
        'With gcloud installed, this step happens for you: `https://cloud.google.com/sdk/docs/install`',
      ],
      [
        'Sign in with the Google account that will own the app. Your personal account is a good choice.',
        'Name the project Chronicle and click Create.',
        'Copy its project ID, like chronicle-123456, and paste it here.',
      ]
    );
    await context.openUrl(`${CONSOLE}/projectcreate`);
    state.projectId = await askProjectId();
    await save();
    await enableApis(apis);
  }

  async function askProjectId(): Promise<string> {
    for (;;) {
      const answer = await context.ask('Paste the project ID:');
      if (PROJECT_ID.test(answer)) return answer;
      logger.emit({
        level: 'warn',
        kind: 'notice',
        message: 'That doesn’t look like a project ID',
        hint: { action: 'Copy the ID under the project name, like chronicle-123456.' },
      });
    }
  }

  /** Sign out of the gcloud setup used, if it signed in. */
  async function signOut() {
    if (state.account && (await gcloud.available())) await gcloud.signOut();
  }

  /** Turn on APIs: with gcloud when it's there, otherwise on a console page. */
  async function enableApis(wanted: string[]) {
    const projectId = state.projectId!;
    const labels = Object.values(GOOGLE_SERVICES)
      .filter(service => wanted.includes(service.api))
      .map(service => service.label);
    if (wanted.length === 0) return;
    if (state.account && (await gcloud.available())) {
      if (!(await gcloud.account())) {
        guide(`Sign in to Google Cloud to turn on the ${list(labels)} APIs`, [
          `Use ${state.account}, the account that owns the project. Chronicle signs out again when they’re on.`,
        ]);
        await context.ask('Press Enter to open the sign-in page.');
        await gcloud.login();
      }
      logger.info(`Turning on the ${list(labels)} APIs`, { project: projectId });
      try {
        await gcloud.enableApis(projectId, wanted);
      } catch (error) {
        throw gcloudFailure(error, `Couldn’t turn on the ${list(labels)} APIs`);
      }
    } else {
      guide(
        `Turn on the ${list(labels)} APIs`,
        [],
        [`Check the project is ${projectId}, then click Next and Enable.`]
      );
      await context.openUrl(
        `${CONSOLE}/flows/enableapi?apiid=${wanted.join(',')}&project=${projectId}`
      );
      await context.ask('Press Enter when they’re on.');
    }
    state.apis = [...new Set([...(state.apis ?? []), ...wanted])];
    await save();
  }
}

/**
 * The client the person made, pasted from the console's window: its ID, then
 * its secret. A path to its downloaded JSON file works in place of the ID.
 */
async function askClient(context: ProviderSetupContext): Promise<ClientCredentials> {
  const { logger } = context;
  const warn = (message: string, action: string) =>
    logger.emit({ level: 'warn', kind: 'notice', message, hint: { action } });

  for (;;) {
    const answer = await context.ask('Client ID:');
    if (/\.json$/i.test(answer)) {
      try {
        return await readClientFile(answer.replace(/^~(?=$|\/)/, homedir()));
      } catch (error) {
        warn(
          error instanceof Error ? error.message : String(error),
          'Paste the client ID instead.'
        );
        continue;
      }
    }
    if (!/\.apps\.googleusercontent\.com$/.test(answer)) {
      warn(
        'That doesn’t look like a client ID',
        'It ends in .apps.googleusercontent.com. Copy it from the window that opened.'
      );
      continue;
    }
    for (;;) {
      const clientSecret = await context.ask('Client secret:');
      if (clientSecret) return { clientId: answer, clientSecret };
      warn('No client secret given', 'Copy it from the same window, under the client ID.');
    }
  }
}

/** A desktop client as the console downloads it: `{ "installed": { client_id, … } }`. */
async function readClientFile(path: string): Promise<ClientCredentials> {
  let parsed: any;
  try {
    parsed = JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    throw new Error('Can’t read that client file');
  }
  if (parsed?.web) {
    throw new Error('That’s a web client. Chronicle needs a Desktop app client');
  }
  const client = parsed?.installed;
  if (typeof client?.client_id !== 'string' || typeof client?.client_secret !== 'string') {
    throw new TypeError('That isn’t a Google OAuth client file');
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

async function load(path: string): Promise<SetupState> {
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return {};
  }
}

/** `chronicle-` and six random characters: project IDs are unique across Google. */
function newProjectId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(6);
  return `chronicle-${[...bytes].map(byte => alphabet[byte % alphabet.length]).join('')}`;
}

function gcloudFailure(error: unknown, message: string): ExtractorError {
  const said = error instanceof GcloudError ? error.stderr : String(error);
  if (/terms of service/i.test(said)) {
    return new ExtractorError('Google Cloud needs you to accept its terms first', {
      code: 'setup-failed',
      exitCode: EXIT_CODES.auth,
      hint: [
        `Open ${CONSOLE} and accept the terms.`,
        'Then run `chronicle auth login google` again.',
      ].join('\n'),
      cause: error,
    });
  }
  // What gcloud said, on a line of its own under the message.
  const reason = error instanceof GcloudError ? error.said : said;
  return new ExtractorError(reason ? `${message}\n${reason}` : message, {
    code: 'setup-failed',
    exitCode: EXIT_CODES.auth,
    hint: 'Run `chronicle auth login google` again to pick up where you left off.',
    cause: error,
  });
}

const list = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
