import { Record } from '@chronicle.app/etl';
import { GitHubStar } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

export default class GitHubStarsExtractor extends GitHubExtractor {
  static override description = 'Repositories you starred';
  static override recordTypes: string[] = ['stars'];
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    for await (const star of this.proxy.viewerConnection<GitHubStar>('starredRepositories')) {
      if (this.isBeforeSince(star.starredAt)) return;
      if (!this.inRange(star.starredAt)) continue;
      // You star a repository once, so the repository identifies the star.
      yield this.record('stars', star.node.nameWithOwner, star.starredAt, star);
    }
  }
}
