import { Record } from '@chronicle.app/etl';
import { GitHubGist } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

export default class GitHubGistsExtractor extends GitHubExtractor {
  static override description = 'Gists you created, public and secret';
  static override recordTypes: string[] = ['gists'];
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    for await (const gist of this.proxy.viewerConnection<GitHubGist>('gists')) {
      if (this.isBeforeSince(gist.createdAt)) return;
      if (!this.inRange(gist.createdAt)) continue;
      yield this.record('gists', gist.id, gist.createdAt, gist);
    }
  }
}
