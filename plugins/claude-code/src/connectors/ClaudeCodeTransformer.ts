import { hostname } from 'node:os';
import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  Agent,
  Message,
  MessageAction,
  Person,
  Project,
  Realm,
  SoftwareAgent,
  SoftwareApplication,
  Thread,
} from '@chronicle.app/schema';
import type { Account, SessionContext, TranscriptMessage } from './ClaudeCodeExtractor.js';

const SOURCE = 'claude-code';
const BY_SOURCE_ID = ['@type', 'source', 'sourceId'];
const BY_HANDLE = ['@type', 'source', 'handle'];
/**
 * Claude Code only reports these ids: the account is claude.ai's (the same
 * uuid its exports carry); the assistant and its model ids are Anthropic's.
 */
const ACCOUNT_SOURCE = 'claude';
const ANTHROPIC = 'anthropic';

/**
 * The assistant you talk to, one entity across every surface it appears on:
 * Claude Code is Claude in a terminal, and the message source records which.
 */
const CLAUDE: SoftwareAgent = {
  '@type': 'SoftwareAgent',
  '@key': BY_HANDLE,
  source: ANTHROPIC,
  handle: 'claude',
  name: 'Claude',
};

/**
 * One MessageAction per transcript message: the person's prompts authored by
 * `@me`, the assistant's replies and tool calls authored by Claude with the
 * model that produced them as the action's instrument. Every message is part
 * of the session's Thread, and the Thread is part of the Project the session
 * ran in, scoped to this machine.
 */
export default class ClaudeCodeTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<MessageAction[]> {
    if (record.extraction.recordType !== 'messages') return [];
    const message = record.data as TranscriptMessage;
    const session = record.context as SessionContext;
    const human = message.role === 'human';
    if (!human && !message.model) return [];
    const author = human ? this.self(session.account) : CLAUDE;
    return [
      {
        '@type': 'MessageAction',
        '@key': BY_SOURCE_ID,
        source: SOURCE,
        sourceId: message.uuid,
        timestamp: new Date(message.timestamp),
        agent: author,
        ...(!human && { instrument: this.model(message.model!) }),
        object: {
          '@type': 'Message',
          '@key': BY_SOURCE_ID,
          source: SOURCE,
          sourceId: message.uuid,
          body: message.body,
          author: [author],
          isPartOf: [await this.thread(session)],
        } satisfies Message,
      },
    ];
  }

  /**
   * Me. Claude Code has no user identity of its own: the only id it records
   * is the Anthropic account uuid, which claude.ai exports of the same account
   * carry too, so the self IS that account's Person (the way iMessage's agents
   * are iCloud or phone identities under `imessage` messages). The email joins
   * the address the mail and messaging sources know. A transcript that names no
   * account gets the per-source singleton; `@me` still merges both.
   */
  private self(account: Account | undefined): Person {
    if (!account) return selfAgent({ source: SOURCE });
    const sameAs: Agent[] = account.email
      ? [
          {
            '@type': 'Agent',
            '@key': BY_HANDLE,
            source: 'email',
            handle: account.email,
            ...(account.name !== undefined && { name: account.name }),
          },
        ]
      : [];
    return selfAgent({
      source: ACCOUNT_SOURCE,
      sourceId: account.uuid,
      handle: account.email,
      name: account.name,
      sameAs,
    });
  }

  /**
   * The model a reply ran on: a kind, not an individual — the same weights
   * answer everyone — so it is the instrument of the reply, not its author.
   */
  private model(id: string): SoftwareApplication {
    return {
      '@type': 'SoftwareApplication',
      '@key': BY_HANDLE,
      source: ANTHROPIC,
      handle: id,
      name: id,
    };
  }

  private async thread(session: SessionContext): Promise<Thread> {
    return {
      '@type': 'Thread',
      '@key': BY_SOURCE_ID,
      source: SOURCE,
      sourceId: session.sessionId,
      name: session.title,
      isPartOf: [await this.project(session.cwd)],
    };
  }

  /**
   * The working directory as a Project on this machine — the same hostname
   * Realm the shell and Timing sources scope their paths and accounts by.
   */
  private async project(cwd: string): Promise<Project> {
    const realm: Realm = {
      '@type': 'Realm',
      '@key': BY_HANDLE,
      source: 'hostname',
      handle: (this.config.hostname ?? hostname()).trim().split('.')[0].toLowerCase(),
    };
    return {
      '@type': 'Project',
      '@key': ['@type', 'source', 'handle', 'inRealm.handle'],
      source: SOURCE,
      handle: cwd,
      // The full path, so projects that share a directory name stay apart.
      name: cwd,
      inRealm: realm,
    };
  }
}
