import { createReadStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { Extractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import ClaudeCodeTransformer from './ClaudeCodeTransformer.js';

const ASSISTANT_MODES = ['full', 'terse', 'off'] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

/** How long a tool call's summary, or a title derived from a prompt, may be. */
const SUMMARY_LENGTH = 200;
const TITLE_LENGTH = 80;

/** One imported message: a human prompt, an assistant reply, or a tool call. */
export interface TranscriptMessage {
  /** The transcript line's own uuid: the extract-time key and the Message identity. */
  uuid: string;
  timestamp: string;
  role: 'human' | 'assistant' | 'tool';
  body: string;
  /** The model that produced an assistant reply or tool call (`message.model`). */
  model?: string;
}

/** The Anthropic account a session ran under. */
export interface Account {
  /** The account uuid, shared with claude.ai's own exports of the same account. */
  uuid: string;
  email?: string;
  name?: string;
}

/** The session every message of a file belongs to. */
export interface SessionContext {
  recordType: 'messages';
  /** The session uuid: the file basename and `sessionId` on every line. */
  sessionId: string;
  /** The last custom title, else the last AI title, else the first prompt. */
  title: string;
  /** Working directory of the first human prompt: the project the session belongs to. */
  cwd: string;
  file: string;
  /**
   * From the session's own `bridge-session` or artifact ledger lines, else
   * the logged-in account of the Claude Code install the transcript belongs
   * to. Absent when neither says.
   */
  account?: Account;
}

/** One API response: the assistant lines sharing a `message.id`. */
interface Response {
  /** `message.id`, shared by every line of the response. */
  id: string;
  model: string;
  texts: Array<{ uuid: string; timestamp: string; text: string }>;
  tools: Array<{
    /** The `tool_use` block's own id, so a call never shares a key with its line's text. */
    uuid: string;
    timestamp: string;
    name: string;
    input: unknown;
  }>;
}

/** A parsed session, before the assistant and tools flags are applied. */
interface Session {
  context: SessionContext;
  /** Human prompts and the responses that answered them, in file order. */
  turns: Array<{ prompt: TranscriptMessage; responses: Response[] }>;
}

/** Tools whose input is best summarised by the path they touch. */
const PATH_INPUTS = ['file_path', 'path', 'notebook_path', 'pattern'];

export class ClaudeCodeExtractor extends Extractor<typeof ClaudeCodeExtractor> {
  static override source = 'claude-code';
  static override description = 'Session transcripts: prompts and replies';

  static override delivery = 'local' as const;
  static override strategy = 'transcripts';
  static override recordTypes = ['messages'];
  static override default = true;
  static override temporality = 'event' as const;
  static override defaultTransformer = ClaudeCodeTransformer;
  static override schema = Extractor.schema.extend({
    input: z
      .string()
      .default(path.join(os.homedir(), '.claude', 'projects'))
      .describe('The Claude Code projects directory, one project directory, or one session file'),
    assistant: z
      .enum(ASSISTANT_MODES)
      .default('full')
      .describe(
        "Assistant replies to import: full (every reply), terse (each turn's final reply only), off"
      ),
    tools: z.boolean().default(false).describe('Import each tool call as a one-line message'),
  });

  private files: string[] = [];
  /** The install's logged-in account, when the input lives under its `.claude`. */
  private localAccount?: Account;

  override async setup(): Promise<void> {
    const input = path.resolve(String(this.config.input));
    this.localAccount = await this.readLocalAccount(input);
    const entries = await Promise.all(
      (await this.findSessionFiles(input)).map(async file => ({
        file,
        mtime: (await fs.stat(file)).mtime,
      }))
    );
    // Newest sessions first so a limited import shows recent work; path order
    // breaks ties so an unchanged directory yields the same stream.
    entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime() || a.file.localeCompare(b.file));
    this.files = entries.map(entry => entry.file);
    this.logVerboseStep(`${this.files.length} session files under ${input}`);
  }

  /**
   * A session file, a project directory (session files at its top level), or
   * the projects root (one directory per project). Subagent transcripts live
   * under a session's own directory and are never read.
   */
  private async findSessionFiles(input: string): Promise<string[]> {
    if ((await fs.stat(input)).isFile()) return [input];
    const own = await this.sessionFilesIn(input);
    if (own.length > 0) return own;
    const files: string[] = [];
    for (const entry of await fs.readdir(input, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.'))
        files.push(...(await this.sessionFilesIn(path.join(input, entry.name))));
    }
    return files;
  }

  /**
   * Claude Code keeps the logged-in account in `.claude.json` beside the
   * `.claude` directory its transcripts live under. Only that install's own
   * data is read: a copied directory carries no account of its own.
   */
  private async readLocalAccount(input: string): Promise<Account | undefined> {
    let dir = input;
    while (path.basename(dir) !== '.claude') {
      const parent = path.dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
    const file = path.join(path.dirname(dir), '.claude.json');
    let config: any;
    try {
      config = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      return undefined;
    }
    const oauth = config?.oauthAccount;
    if (typeof oauth?.accountUuid !== 'string') return undefined;
    return {
      uuid: oauth.accountUuid,
      ...(typeof oauth.emailAddress === 'string' && {
        email: oauth.emailAddress,
      }),
      ...(typeof oauth.fullName === 'string' && { name: oauth.fullName }),
    };
  }

  private async sessionFilesIn(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(entry => path.join(dir, entry.name))
      .sort((a, b) => a.localeCompare(b));
  }

  override async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof ClaudeCodeExtractor.schema>;
    let count = 0;
    for (const file of this.files) {
      if (this.shouldStopExtracting(count)) return;
      const session = await this.readSession(file);
      if (!session) continue;
      // Newest message first, like the sessions, so a limited import is the
      // latest messages rather than the openings of the latest sessions.
      const messages = [...this.messagesOf(session, config.assistant, config.tools)].reverse();
      for (const message of messages) {
        if (this.shouldStopExtracting(count)) return;
        const timestamp = new Date(message.timestamp);
        if (!Number.isFinite(timestamp.getTime())) continue;
        if (config.since && timestamp < config.since) continue;
        if (config.until && timestamp > config.until) continue;
        yield this.createRecord(message, session.context);
        count++;
      }
    }
  }

  /** Apply the assistant and tools flags to a parsed session, in file order. */
  private *messagesOf(
    session: Session,
    assistant: AssistantMode,
    tools: boolean
  ): Generator<TranscriptMessage> {
    for (const turn of session.turns) {
      yield turn.prompt;
      const replies = this.replies(turn.responses, assistant);
      for (const response of turn.responses) {
        if (replies.has(response)) {
          const [first] = response.texts;
          yield {
            uuid: first.uuid,
            timestamp: first.timestamp,
            role: 'assistant',
            body: response.texts.map(block => block.text).join('\n\n'),
            model: response.model,
          };
        }
        if (!tools) continue;
        for (const tool of response.tools)
          yield {
            uuid: tool.uuid,
            timestamp: tool.timestamp,
            role: 'tool',
            body: `${tool.name}: ${this.summarise(tool.name, tool.input)}`,
            model: response.model,
          };
      }
    }
  }

  /** The responses of a turn whose text becomes a Message. */
  private replies(responses: Response[], mode: AssistantMode): Set<Response> {
    const withText = responses.filter(response => response.texts.length > 0);
    if (mode === 'off') return new Set();
    if (mode === 'terse') return new Set(withText.slice(-1));
    return new Set(withText);
  }

  /** One line describing a tool call's input; the result is never imported. */
  private summarise(name: string, input: unknown): string {
    const fields = (input ?? {}) as { [key: string]: unknown };
    let summary: string | undefined;
    if (name === 'Bash') {
      summary =
        typeof fields.description === 'string'
          ? fields.description
          : typeof fields.command === 'string'
            ? fields.command
            : undefined;
    } else {
      const key = PATH_INPUTS.find(field => typeof fields[field] === 'string');
      if (key) summary = fields[key] as string;
    }
    summary ??= JSON.stringify(input ?? {});
    const line = summary.replaceAll(/\s*\n\s*/g, ' ').trim();
    return line.length > SUMMARY_LENGTH ? `${line.slice(0, SUMMARY_LENGTH - 1)}…` : line;
  }

  /** Parse one session file; null when it holds no human prompt. */
  private async readSession(file: string): Promise<Session | null> {
    const sessionId = path.basename(file, '.jsonl');
    let customTitle: string | undefined;
    let aiTitle: string | undefined;
    let cwd: string | undefined;
    let accountUuid: string | undefined;
    const turns: Session['turns'] = [];
    let responses: Response[] = [];
    let lineNumber = 0;

    const lines = readline.createInterface({
      input: createReadStream(file, { encoding: 'utf8' }),
      crlfDelay: Number.POSITIVE_INFINITY,
    });
    for await (const raw of lines) {
      lineNumber++;
      if (!raw.trim()) continue;
      let line: any;
      try {
        line = JSON.parse(raw);
      } catch {
        this.logger.warn(`${file}:${lineNumber}: unparseable line skipped`);
        continue;
      }
      if (!line || typeof line !== 'object') continue;
      switch (line.type) {
        case 'custom-title':
          if (typeof line.customTitle === 'string' && line.customTitle.trim())
            customTitle = line.customTitle.trim();
          break;
        case 'ai-title':
          if (typeof line.aiTitle === 'string' && line.aiTitle.trim())
            aiTitle = line.aiTitle.trim();
          break;
        case 'bridge-session':
          if (typeof line.ownerAccountUuid === 'string') accountUuid = line.ownerAccountUuid;
          break;
        case 'artifact-autoreact-ledger':
          if (typeof line.accountUuid === 'string') accountUuid = line.accountUuid;
          break;
        case 'user': {
          const prompt = this.humanPrompt(line);
          if (!prompt) break;
          cwd ??= typeof line.cwd === 'string' ? line.cwd : undefined;
          responses = [];
          turns.push({ prompt, responses });
          break;
        }
        case 'assistant':
          // Lines before the first prompt (a resumed session's history) have
          // no turn to belong to.
          if (turns.length > 0) this.collect(line, responses);
          break;
        default:
          break;
      }
    }

    if (turns.length === 0 || cwd === undefined) return null;
    const first = turns[0].prompt.body.replaceAll(/\s+/g, ' ').trim();
    const title =
      customTitle ??
      aiTitle ??
      (first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH - 1)}…` : first);
    const account = this.account(accountUuid);
    return {
      context: {
        recordType: 'messages',
        sessionId,
        title,
        cwd,
        file,
        ...(account && { account }),
      },
      turns,
    };
  }

  /**
   * The session's own account uuid wins; the install's email and name attach
   * only when they describe that same account.
   */
  private account(uuid: string | undefined): Account | undefined {
    const local = this.localAccount;
    if (uuid === undefined) return local;
    return local?.uuid === uuid ? local : { uuid };
  }

  /**
   * A prompt the person typed or queued. Tool results, compaction summaries,
   * interruptions, slash-command echoes and other harness-injected lines are
   * `user` lines too, but carry no human origin or are marked meta.
   */
  private humanPrompt(line: any): TranscriptMessage | null {
    if (line.isMeta === true || line.origin?.kind !== 'human') return null;
    if (typeof line.uuid !== 'string' || typeof line.timestamp !== 'string') return null;
    const content = line.message?.content;
    const body =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter(block => block?.type === 'text' && typeof block.text === 'string')
              .map(block => block.text)
              .join('\n')
          : '';
    if (!body.trim()) return null;
    return { uuid: line.uuid, timestamp: line.timestamp, role: 'human', body };
  }

  /** Add an assistant line's blocks to the response they belong to. */
  private collect(line: any, responses: Response[]): void {
    const model = line.message?.model;
    if (typeof model !== 'string' || model === '<synthetic>') return;
    if (typeof line.uuid !== 'string' || typeof line.timestamp !== 'string') return;
    const id = typeof line.message?.id === 'string' ? line.message.id : line.uuid;
    let response = responses.find(candidate => candidate.id === id);
    if (!response) {
      response = { id, model, texts: [], tools: [] };
      responses.push(response);
    }
    for (const block of Array.isArray(line.message?.content) ? line.message.content : []) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        if (block.text.trim())
          response.texts.push({
            uuid: line.uuid,
            timestamp: line.timestamp,
            text: block.text,
          });
      } else if (block?.type === 'tool_use' && typeof block.name === 'string') {
        response.tools.push({
          uuid: typeof block.id === 'string' ? block.id : line.uuid,
          timestamp: line.timestamp,
          name: block.name,
          input: block.input,
        });
      }
    }
  }
}
