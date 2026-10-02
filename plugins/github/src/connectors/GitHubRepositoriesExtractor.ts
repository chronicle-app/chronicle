import { Record } from '@chronicle.app/etl';
import { GitHubOwnRepository } from '../utils/GitHubProxy.js';
import GitHubExtractor from './GitHubExtractor.js';

export default class GitHubRepositoriesExtractor extends GitHubExtractor {
  static override description = 'Repositories you created, forks included';
  static override recordTypes: string[] = ['repositories'];
  static override newestFirst = true;

  protected async *records(): AsyncGenerator<Record> {
    for await (const repository of this.proxy.viewerConnection<GitHubOwnRepository>(
      'createdRepositories'
    )) {
      if (this.isBeforeSince(repository.createdAt)) return;
      if (!this.inRange(repository.createdAt)) continue;
      yield this.record('repositories', repository.id, repository.createdAt, repository);
    }
  }
}
