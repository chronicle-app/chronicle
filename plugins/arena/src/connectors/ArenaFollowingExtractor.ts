import ArenaExtractor from './ArenaExtractor.js';
import { Record } from '@chronicle.app/etl';
import type { ArenaFollowing } from '../utils/ArenaProxy.js';

export default class ArenaFollowingExtractor extends ArenaExtractor {
  static override description = 'Users, channels, and groups you follow';
  static override recordTypes: string[] = ['follows'];

  async *extract(): AsyncGenerator<Record> {
    this.logger.verboseInfo('Starting Are.na following extraction', {
      userId: this.userId,
    });

    const following = this.applyLimit(await this.proxy.getUserFollowing(this.userId));
    this.logger.info(
      `Retrieved ${following.users.length} user, ${following.channels.length} channel, and ${following.groups.length} group follows from Are.na`
    );

    yield this.createRecord(
      { ...following, follower: this.selectedUser },
      { recordType: 'follows' }
    );
  }

  // All follows travel in one record, and the transformer emits one
  // FollowAction per follow (users, then channels, then groups), so --limit
  // caps the follows rather than the record count.
  private applyLimit(following: ArenaFollowing): ArenaFollowing {
    const limit = this.getEffectiveLimit();
    if (limit === null) return following;
    const users = following.users.slice(0, limit);
    const channels = following.channels.slice(0, limit - users.length);
    const groups = following.groups.slice(0, limit - users.length - channels.length);
    return { users, channels, groups };
  }
}
