import ArenaExtractor from './ArenaExtractor.js';
import { Record } from '@chronicle.app/etl';

export default class ArenaFollowingExtractor extends ArenaExtractor {
  static override description = 'Users, channels, and groups you follow';
  static override recordTypes: string[] = ['follows'];

  async *extract(): AsyncGenerator<Record> {
    this.logger.verboseInfo('Starting Are.na following extraction', {
      userId: this.userId,
    });

    const following = await this.proxy.getUserFollowing(this.userId);
    this.logger.info(
      `Retrieved ${following.users.length} user, ${following.channels.length} channel, and ${following.groups.length} group follows from Are.na`
    );

    yield this.createRecord(
      { ...following, follower: this.selectedUser },
      { recordType: 'follows' }
    );
  }
}
