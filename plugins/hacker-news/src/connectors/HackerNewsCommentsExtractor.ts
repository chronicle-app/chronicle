import { Record } from '@chronicle.app/etl';
import HackerNewsExtractor from './HackerNewsExtractor.js';

export default class HackerNewsCommentsExtractor extends HackerNewsExtractor {
  static override description = 'Comments you wrote';
  static override recordTypes: string[] = ['comments'];
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    for await (const item of this.ownItems({ stopAtSince: true })) {
      if (item.type !== 'comment' || !this.inRange(item)) continue;
      // The direct parent is what the comment answers; the root is the
      // submission whose discussion it belongs to.
      const parent = item.parent === undefined ? null : await this.proxy.getItem(item.parent);
      const root = await this.proxy.getRoot(item);
      yield this.createRecord(item, this.context({ recordType: 'comments', parent, root }));
    }
  }
}
