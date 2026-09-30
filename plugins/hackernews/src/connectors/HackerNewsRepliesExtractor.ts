import { Record } from '@chronicle.app/etl';
import HackerNewsExtractor from './HackerNewsExtractor.js';

export default class HackerNewsRepliesExtractor extends HackerNewsExtractor {
  static override description = "Other people's replies to your submissions and comments";
  static override recordTypes: string[] = ['replies'];

  protected async *records(): AsyncGenerator<Record> {
    // An old item can still get a new reply, so `since` can't end the walk.
    for await (const parent of this.ownItems({ stopAtSince: false })) {
      if (!parent.kids?.length) continue;
      const root = parent.type === 'comment' ? await this.proxy.getRoot(parent) : parent;
      for await (const reply of this.fetchEach(parent.kids)) {
        // Your own replies are already under `comments`.
        if (reply.by === this.user.id || !this.inRange(reply)) continue;
        yield this.createRecord(reply, this.context({ recordType: 'replies', parent, root }));
      }
    }
  }
}
