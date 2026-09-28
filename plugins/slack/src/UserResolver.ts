import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedUser, SlackMessage, SlackMpim, SlackUser } from './types/slack.js';

/**
 * Resolves Slack user IDs to names/handles by combining multiple data sources:
 * 1. users.json - workspace members with full profiles
 * 2. mpims.json - co-occurrence of member IDs with @usernames in purpose field
 * 3. Message user_profile fields and file author metadata
 */
export class UserResolver {
  private users = new Map<string, ResolvedUser>();

  get(userId: string): ResolvedUser | undefined {
    return this.users.get(userId);
  }

  getOrStub(userId: string, teamId?: string): ResolvedUser {
    const existing = this.users.get(userId);
    if (existing) return existing;
    return { id: userId, teamId };
  }

  async resolve(basePath: string): Promise<Map<string, ResolvedUser>> {
    // Phase 1: Load users.json (most complete source)
    await this.loadUsersJson(basePath);

    // Phase 2: Co-occurrence from mpims.json purpose fields
    await this.loadMpimCoOccurrence(basePath);

    // Phase 3: Scan messages for user_profile fields
    await this.scanMessagesForProfiles(basePath);

    return this.users;
  }

  private async loadUsersJson(basePath: string): Promise<void> {
    try {
      const raw = await readFile(join(basePath, 'users.json'), 'utf-8');
      const users: SlackUser[] = JSON.parse(raw);

      for (const u of users) {
        const name = u.profile?.display_name || u.profile?.real_name || u.real_name || undefined;
        this.users.set(u.id, {
          id: u.id,
          handle: u.name || undefined,
          name,
          teamId: u.team_id,
        });
      }
    } catch {
      // users.json may not exist
    }
  }

  private async loadMpimCoOccurrence(basePath: string): Promise<void> {
    try {
      const raw = await readFile(join(basePath, 'mpims.json'), 'utf-8');
      const mpims: SlackMpim[] = JSON.parse(raw);

      // Iterate until stable: match member IDs to @usernames in purpose field
      for (const mpim of mpims) {
        const purpose = mpim.purpose?.value;
        if (!purpose || !mpim.members) continue;

        // Extract @usernames from purpose like "Group messaging with: @user1 @user2 @user3"
        const usernameMatches = purpose.match(/@([\w.]+)/g);
        if (!usernameMatches) continue;
        const usernames = usernameMatches.map(m => m.slice(1));

        // Also extract from mpim name like "mpdm-pat.example--alex.example--sam-1"
        const nameMatches = mpim.name.match(/^mpdm-(.+)-\d+$/);
        const nameUsernames = nameMatches ? nameMatches[1].split('--') : [];

        const allUsernames = [...new Set([...usernames, ...nameUsernames])];

        // For each member, try to match to a username
        for (const memberId of mpim.members) {
          const existing = this.users.get(memberId);

          // If we already have a handle, skip
          if (existing?.handle) continue;

          // Try to match this member to an unmatched username
          // Check if any username matches the existing name
          if (existing?.name) {
            const matched = allUsernames.find(
              u =>
                u.toLowerCase() === existing.name?.toLowerCase() ||
                existing.name?.toLowerCase().includes(u.toLowerCase())
            );
            if (matched) {
              existing.handle = matched;
              this.users.set(memberId, existing);
            }
          }
        }
      }
    } catch {
      // mpims.json may not exist
    }
  }

  private async scanMessagesForProfiles(basePath: string): Promise<void> {
    try {
      const entries = await readdir(basePath, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && e.name !== 'attachments');

      for (const dir of dirs) {
        const dirPath = join(basePath, dir.name);
        const files = await readdir(dirPath).catch(() => []);
        const jsonFiles = (typeof files[0] === 'string' ? files : []) as string[];

        for (const file of jsonFiles) {
          if (!file.endsWith('.json')) continue;

          try {
            const raw = await readFile(join(dirPath, file), 'utf-8');
            const messages: SlackMessage[] = JSON.parse(raw);

            for (const msg of messages) {
              if (!msg.user) continue;

              // Extract from user_profile field
              if (msg.user_profile) {
                const existing = this.users.get(msg.user);
                if (!existing || (!existing.name && !existing.handle)) {
                  const profile = msg.user_profile;
                  this.users.set(msg.user, {
                    id: msg.user,
                    handle: existing?.handle || profile.name || profile.display_name || undefined,
                    name: existing?.name || profile.real_name || profile.display_name || undefined,
                    teamId: existing?.teamId || msg.team,
                  });
                }
              }

              // Extract from files' user field (associates file author with user ID)
              if (msg.files) {
                for (const file of msg.files) {
                  if (file.user && !this.users.has(file.user)) {
                    this.users.set(file.user, {
                      id: file.user,
                      teamId: msg.team,
                    });
                  }
                }
              }
            }
          } catch {
            // Skip unreadable message files
          }
        }
      }
    } catch {
      // Can't read directory
    }
  }
}
