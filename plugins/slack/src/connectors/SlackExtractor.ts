import { Extractor, Record } from '@chronicle.app/etl';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { UserResolver } from '../UserResolver.js';
import type {
  ConversationMeta,
  ResolvedUser,
  SlackChannel,
  SlackDm,
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
    input: z.string().describe('Path to slackdump export directory'),
    attachments: z.boolean().optional().default(false).describe('Include file attachments'),
  });

  private conversations: ConversationMeta[] = [];
  private userMap = new Map<string, ResolvedUser>();
  private teamId: string | undefined;

  override async setup(): Promise<void> {
    const config = this.config as z.infer<typeof SlackExtractor.schema>;
    const basePath = config.input;

    // Resolve users
    const resolver = new UserResolver();
    this.userMap = await resolver.resolve(basePath);

    // Extract teamId from first user that has one
    for (const user of this.userMap.values()) {
      if (user.teamId) {
        this.teamId = user.teamId;
        break;
      }
    }

    // Load conversation metadata
    await this.loadConversations(basePath);
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

      yield this.createRecord(
        {
          type: 'message',
          message: msg,
          includeAttachments: config.attachments,
        },
        { conversation, userMap, teamId: this.teamId, basePath }
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

  /** Yield a single conversation's messages newest-first, applying filters. */
  private async *extractConversation(
    conversation: ConversationMeta,
    config: z.infer<typeof SlackExtractor.schema>
  ): AsyncGenerator<ConversationMessage> {
    const dirPath = join(config.input, conversation.dirName);

    let files: string[];
    try {
      files = await readdir(dirPath);
    } catch {
      return;
    }

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
        const raw = await readFile(join(dirPath, file), 'utf-8');
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
    const config = this.config as z.infer<typeof SlackExtractor.schema>;
    const basePath = config.input;
    let total = 0;

    for (const conversation of this.conversations) {
      const dirPath = join(basePath, conversation.dirName);
      let files: string[];
      try {
        files = await readdir(dirPath);
      } catch {
        continue;
      }

      const jsonFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f));

      for (const file of jsonFiles) {
        try {
          const raw = await readFile(join(dirPath, file), 'utf-8');
          const messages: SlackMessage[] = JSON.parse(raw);
          total += messages.filter(
            m =>
              m.type === 'message' &&
              (!m.subtype || ['bot_message', 'thread_broadcast'].includes(m.subtype))
          ).length;
        } catch {
          continue;
        }
      }
    }

    return total;
  }

  private async loadConversations(basePath: string): Promise<void> {
    // Load channels
    try {
      const raw = await readFile(join(basePath, 'channels.json'), 'utf-8');
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
      const raw = await readFile(join(basePath, 'dms.json'), 'utf-8');
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
      const raw = await readFile(join(basePath, 'mpims.json'), 'utf-8');
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

    // Filter to only conversations that have directories on disk
    const entries = await readdir(basePath, { withFileTypes: true }).catch(() => []);
    const dirNames = new Set(entries.filter(e => e.isDirectory()).map(e => e.name));
    this.conversations = this.conversations.filter(c => dirNames.has(c.dirName));
  }

  private tsToDate(ts: string): Date {
    return new Date(Number.parseFloat(ts) * 1000);
  }
}
