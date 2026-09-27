import { ChronicleTransformer, Record as EtlRecord, createMediaObject } from '@chronicle.app/etl';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ActionAndChildren, Agent, Message, MessageAction } from '@chronicle.app/schema';
import type { ConversationMeta, ResolvedUser, SlackFile, SlackMessage } from '../types/slack.js';

type UserMap = { [userId: string]: ResolvedUser };

const SMALL_CHANNEL_THRESHOLD = 10;

export default class SlackTransformer extends ChronicleTransformer {
  async transform(record: EtlRecord): Promise<ActionAndChildren[]> {
    if (record.data.type === 'message') {
      return this.buildMessageActions(record);
    }
    return [];
  }

  private buildMessageActions(record: EtlRecord): ActionAndChildren[] {
    const msg: SlackMessage = record.data.message;
    const { conversation } = record.context;
    const { userMap } = record.context;
    const { teamId } = record.context;
    const { includeAttachments } = record.data;

    const senderId = msg.user || msg.bot_id;
    if (!senderId) return [];

    const sender = this.buildAgent(senderId, userMap[senderId], teamId);
    // Build Message entity
    const message: Message = {
      '@type': 'Message',
      '@key': ['@type', 'source', 'body', 'author'],
      source: 'slack',
      body: msg.text,
      author: [sender],
    };

    // Add recipients based on conversation type
    const recipients = this.buildRecipients(conversation, senderId, userMap, teamId);
    if (recipients.length > 0) {
      message.recipient = recipients;
    }

    // Add attachments if enabled and present
    if (includeAttachments && msg.files && msg.files.length > 0) {
      const attachments = this.buildAttachments(
        msg.files,
        record.context.basePath,
        conversation.dirName
      );
      if (attachments.length > 0) {
        message.contains = attachments;
      }
    }

    // Build MessageAction
    const messageAction: MessageAction = {
      '@type': 'MessageAction',
      '@key': ['@type', 'source', 'timestamp', 'agent'],
      source: 'slack',
      timestamp: new Date(Number.parseFloat(msg.ts) * 1000),
      agent: sender,
      object: message,
    };

    return [messageAction];
  }

  private buildAgent(
    userId: string,
    resolved: ResolvedUser | undefined,
    teamId: string | undefined
  ): Agent {
    const agent: Agent = {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'slack',
      sourceId: userId,
    };

    if (resolved?.handle) {
      agent.handle = resolved.handle;
    }

    if (resolved?.name) {
      agent.name = resolved.name;
    }

    // The workspace as a real Realm the agent is a member of — replaces the old
    // `handleNamespace: teamId` scalar with a traversable edge to a keyed
    // workspace node. A Realm (a bounded account domain), not an Organization:
    // the workspace may itself belong to a company.
    const workspaceId = resolved?.teamId || teamId;
    if (workspaceId) {
      agent.memberOf = [
        {
          '@type': 'Realm',
          '@key': ['@type', 'source', 'sourceId'],
          source: 'slack',
          sourceId: workspaceId,
        },
      ];
    }

    return agent;
  }

  private buildRecipients(
    conversation: ConversationMeta,
    senderId: string,
    userMap: UserMap,
    teamId: string | undefined
  ): Agent[] {
    const { members } = conversation;

    switch (conversation.type) {
      case 'dm':
        // DMs: recipient is the other person
        if (members && members.length === 2) {
          const otherId = members.find(m => m !== senderId);
          if (otherId) {
            return [this.buildAgent(otherId, userMap[otherId], teamId)];
          }
        }
        return [];

      case 'mpim':
        // MPIMs: recipients are all other members
        if (members) {
          return members
            .filter(m => m !== senderId)
            .map(m => this.buildAgent(m, userMap[m], teamId));
        }
        return [];

      case 'channel':
        // Small private channels: recipients are other members
        if (conversation.isPrivate && members && members.length <= SMALL_CHANNEL_THRESHOLD) {
          return members
            .filter(m => m !== senderId)
            .map(m => this.buildAgent(m, userMap[m], teamId));
        }
        // Large/public channels: no recipients (broadcast)
        return [];

      default:
        return [];
    }
  }

  private buildAttachments(files: SlackFile[], basePath: string, dirName: string): any[] {
    const attachments: any[] = [];

    for (const file of files) {
      // slackdump writes downloaded files to disk as `<fileId>-<name>`, in the
      // conversation's own `attachments/` dir (and a top-level aggregate one).
      // When the bytes are on disk we emit a contentPath so ingest captures
      // them; otherwise the node stays metadata-only (the url-gated Slack file
      // would need an auth token to fetch).
      const localPath = this.resolveAttachmentPath(basePath, dirName, file.id);

      const mediaObject = createMediaObject({
        mimeType: file.mimetype,
        source: 'slack',
        sourceId: file.id,
        '@key': ['@type', 'source', 'sourceId'],
        name: file.name,
        ...(localPath && { path: localPath }),
        ...(file.original_w && file.original_w > 0 && { width: file.original_w }),
        ...(file.original_h && file.original_h > 0 && { height: file.original_h }),
      });

      attachments.push(mediaObject);
    }

    return attachments;
  }

  /** Listings of attachment dirs, memoized for the run (one instance per run). */
  private attachmentDirCache = new Map<string, string[]>();

  /**
   * Resolve a Slack file id to the absolute path of its downloaded bytes, or
   * undefined if slackdump did not export the file locally. Matches by id
   * prefix (`<fileId>-...`) so a sanitized on-disk name still resolves.
   */
  private resolveAttachmentPath(
    basePath: string,
    dirName: string,
    fileId: string
  ): string | undefined {
    const candidateDirs = [join(basePath, dirName, 'attachments'), join(basePath, 'attachments')];

    for (const dir of candidateDirs) {
      let entries = this.attachmentDirCache.get(dir);
      if (entries === undefined) {
        try {
          entries = readdirSync(dir);
        } catch {
          entries = [];
        }
        this.attachmentDirCache.set(dir, entries);
      }

      const match = entries.find(entry => entry.startsWith(`${fileId}-`));
      if (match) return resolve(dir, match);
    }

    return undefined;
  }
}
