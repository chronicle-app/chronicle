import {
  Extractor,
  Record,
  countMonth,
  openExport,
  type ExportFiles,
  type KindSurvey,
  type Survey,
  type SurveyOptions,
} from '@chronicle.app/etl';
import { z } from 'zod';
import { UserResolver } from '../UserResolver.js';
import type {
  ConversationMeta,
  ResolvedUser,
  SlackChannel,
  SlackDm,
  SlackFile,
  SlackMessage,
  SlackMpim,
} from '../types/slack.js';
import SlackTransformer from './SlackTransformer.js';

/** A message paired with the conversation it belongs to. */
type ConversationMessage = {
  msg: SlackMessage;
  conversation: ConversationMeta;
};

export class SlackExtractor extends Extractor<typeof SlackExtractor> {
  static override source = 'slack';
  static override description = 'Messages from a slackdump export';

  static override delivery = 'export' as const;
  static override strategy = 'archive';
  static override recordTypes = ['messages'];
  static override default = true;
  static override defaultTransformer = SlackTransformer;

  static override schema = Extractor.schema.extend({
    input: z.string().describe('The slackdump export, as a folder or zip'),
    attachments: z.boolean().optional().default(false).describe('Include file attachments'),
  });

  private files!: ExportFiles;
  private conversations: ConversationMeta[] = [];
  private userMap = new Map<string, ResolvedUser>();
  private teamId: string | undefined;

  override async setup(): Promise<void> {
    const config = this.config as z.infer<typeof SlackExtractor.schema>;
    this.files = await openExport(config.input, 'slackdump export');

    // Resolve users
    const resolver = new UserResolver();
    this.userMap = await resolver.resolve(this.files);

    // Extract teamId from first user that has one
    for (const user of this.userMap.values()) {
      if (user.teamId) {
        this.teamId = user.teamId;
        break;
      }
    }

    // Load conversation metadata
    await this.loadConversations();
  }

  override async teardown(): Promise<void> {
    await this.files?.close();
    await super.teardown();
  }

  async *extract(): AsyncGenerator<Record> {
    const config = this.config as z.infer<typeof SlackExtractor.schema>;
    const basePath = config.input;
    const userMap = Object.fromEntries(this.userMap);
    let count = 0;

    // Each conversation yields its messages newest-first; merge those streams
    // by timestamp (descending) so the output is globally reverse-chronological
    // — `--limit 1` is the single latest message across the whole workspace.
    const heads: Array<{
      iterator: AsyncGenerator<ConversationMessage>;
      value: ConversationMessage;
      ts: number;
    }> = [];

    for (const conversation of this.conversations) {
      const iterator = this.extractConversation(conversation, config);
      const next = await iterator.next();
      if (!next.done) {
        heads.push({
          iterator,
          value: next.value,
          ts: Number.parseFloat(next.value.msg.ts),
        });
      }
    }

    while (heads.length > 0) {
      if (this.shouldStopExtracting(count)) return;

      // Pick the head with the latest timestamp.
      let maxIndex = 0;
      for (let i = 1; i < heads.length; i++) {
        if (heads[i].ts > heads[maxIndex].ts) maxIndex = i;
      }
      const head = heads[maxIndex];
      const { msg, conversation } = head.value;

      // Where each attached file's bytes are, for the transformer to point at.
      const attachmentPaths =
        config.attachments && msg.files?.length
          ? await this.attachmentPaths(msg.files, conversation.dirName)
          : undefined;
      yield this.createRecord(
        {
          type: 'message',
          message: msg,
          includeAttachments: config.attachments,
        },
        {
          conversation,
          userMap,
          teamId: this.teamId,
          basePath,
          ...(attachmentPaths && { attachmentPaths }),
        }
      );
      count++;

      // Advance the chosen stream; drop it once exhausted.
      const next = await head.iterator.next();
      if (next.done) {
        heads.splice(maxIndex, 1);
      } else {
        head.value = next.value;
        head.ts = Number.parseFloat(next.value.msg.ts);
      }
    }
  }

  /**
   * Each downloaded file's path on disk, by its id. slackdump writes a file as
   * `<fileId>-<name>`, in the conversation's own `attachments/` folder or a
   * top-level aggregate one; a sanitized name still matches by its id. A file
   * slackdump didn't download has none.
   */
  private async attachmentPaths(
    files: SlackFile[],
    dirName: string
  ): Promise<{ [fileId: string]: string }> {
    const paths: { [fileId: string]: string } = {};
    for (const file of files) {
      for (const dir of [`${dirName}/attachments`, 'attachments']) {
        const match = (await this.files.children(dir)).find(entry =>
          entry.startsWith(`${file.id}-`)
        );
        const path = match && (await this.files.localPath(`${dir}/${match}`));
        if (path) {
          paths[file.id] = path;
          break;
        }
      }
    }
    return paths;
  }

  /** Yield a single conversation's messages newest-first, applying filters. */
  private async *extractConversation(
    conversation: ConversationMeta,
    config: z.infer<typeof SlackExtractor.schema>
  ): AsyncGenerator<ConversationMessage> {
    const dirPath = conversation.dirName;
    const files = await this.files.children(dirPath);

    // Dated JSON files, newest first.
    const jsonFiles = files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse();

    for (const file of jsonFiles) {
      // Quick date range check using filename
      const fileDate = file.replace('.json', '');
      if (config.until && new Date(fileDate) > config.until) continue;
      if (config.since && new Date(fileDate + 'T23:59:59.999Z') < config.since) {
        continue;
      }

      let messages: SlackMessage[];
      try {
        const raw = await this.files.readText(`${dirPath}/${file}`);
        messages = JSON.parse(raw);
      } catch {
        continue;
      }

      // Keep real messages in range, then sort newest-first so the merge across
      // conversations stays correct even if a day file isn't perfectly ordered.
      const valid = messages.filter(msg => {
        if (msg.type !== 'message') return false;
        if (msg.subtype && !['bot_message', 'thread_broadcast'].includes(msg.subtype)) {
          return false;
        }
        const msgDate = this.tsToDate(msg.ts);
        if (config.since && msgDate < config.since) return false;
        if (config.until && msgDate > config.until) return false;
        return true;
      });
      valid.sort((a, b) => Number.parseFloat(b.ts) - Number.parseFloat(a.ts));

      for (const msg of valid) {
        yield { msg, conversation };
      }
    }
  }

  override async determineCount(): Promise<number | null> {
    const { count } = (await this.survey()).messages;
    const limit = this.getEffectiveLimit();
    return limit === null ? count : Math.min(count, limit);
  }

  /**
   * The messages a run reads, when they were sent, and in how many
   * conversations, from every day file in range: the export has no index.
   */
  override async survey(options: SurveyOptions = {}): Promise<{ messages: KindSurvey } & Survey> {
    const config = this.config as z.infer<typeof SlackExtractor.schema>;
    const messages: KindSurvey = { count: 0, ...(options.byMonth && { byMonth: {} }) };
    let conversations = 0;
    for (const conversation of this.conversations) {
      const before = messages.count;
      for await (const { msg } of this.extractConversation(conversation, config)) {
        const sent = this.tsToDate(msg.ts);
        messages.count++;
        if (!messages.earliest || sent < messages.earliest) messages.earliest = sent;
        if (!messages.latest || sent > messages.latest) messages.latest = sent;
        if (messages.byMonth) countMonth(messages.byMonth, sent);
      }
      if (messages.count > before) conversations++;
    }
    messages.measures = [{ key: 'conversations', label: 'conversations', value: conversations }];
    return { messages };
  }

  private async loadConversations(): Promise<void> {
    // Load channels
    try {
      const raw = await this.files.readText('channels.json');
      const channels: SlackChannel[] = JSON.parse(raw);
      for (const ch of channels) {
        this.conversations.push({
          id: ch.id,
          name: ch.name,
          type: 'channel',
          members: ch.members ?? undefined,
          isPrivate: ch.is_private,
          dirName: ch.name,
        });
      }
    } catch {
      // channels.json may not exist
    }

    // Load DMs
    try {
      const raw = await this.files.readText('dms.json');
      const dms: SlackDm[] = JSON.parse(raw);
      for (const dm of dms) {
        this.conversations.push({
          id: dm.id,
          type: 'dm',
          members: dm.members,
          dirName: dm.id,
        });
      }
    } catch {
      // dms.json may not exist
    }

    // Load MPIMs
    try {
      const raw = await this.files.readText('mpims.json');
      const mpims: SlackMpim[] = JSON.parse(raw);
      for (const mpim of mpims) {
        this.conversations.push({
          id: mpim.id,
          name: mpim.name,
          type: 'mpim',
          members: mpim.members,
          dirName: mpim.name,
        });
      }
    } catch {
      // mpims.json may not exist
    }

    // Filter to only conversations that have folders in the export
    const entries = await this.files.children('');
    const dirNames = new Set(entries.filter(e => e.endsWith('/')).map(e => e.slice(0, -1)));
    this.conversations = this.conversations.filter(c => dirNames.has(c.dirName));
  }

  private tsToDate(ts: string): Date {
    return new Date(Number.parseFloat(ts) * 1000);
  }
}
