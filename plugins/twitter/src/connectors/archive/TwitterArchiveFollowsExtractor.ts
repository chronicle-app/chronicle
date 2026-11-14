import { Record, type Survey } from '@chronicle.app/etl';
import TwitterTransformer from '../TwitterTransformer.js';
import { TwitterArchiveExtractor } from './TwitterArchiveExtractor.js';

/** The two follow lists, by record type, with their files and names in them. */
const LISTS = {
  followers: { path: 'data/follower.js', name: 'follower', key: 'follower' },
  following: { path: 'data/following.js', name: 'following', key: 'following' },
} as const;

type List = keyof typeof LISTS;

/**
 * Who follows you and whom you follow, from `follower.js` and
 * `following.js`. X gives each account's id and no date, so a follow is
 * one as of when X generated the archive.
 *
 * `snapshot`, because the lists are who follows whom then: a follow missing
 * from a later archive has ended.
 */
export class TwitterArchiveFollowsExtractor extends TwitterArchiveExtractor<
  typeof TwitterArchiveFollowsExtractor
> {
  static override description = 'Followers and accounts you follow';
  static override recordTypes = ['followers', 'following'];
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = TwitterTransformer;
  static override schema = TwitterArchiveExtractor.schema;

  /** The other account and which way the follow goes. */
  override keyOf(record: Record): string | null {
    const { accountId } = record.data as { accountId?: string };
    return accountId ? `${record.extraction.recordType}:${accountId}` : null;
  }

  override titleOf(record: Record): string {
    const { accountId } = record.data as { accountId: string };
    return record.extraction.recordType === 'followers'
      ? `Follower ${accountId}`
      : `Following ${accountId}`;
  }

  async *extract(): AsyncGenerator<Record> {
    this.accountInfo = await this.loadAccountInfo();
    let count = 0;
    for (const list of Object.keys(LISTS) as List[]) {
      for (const accountId of await this.loadList(list)) {
        if (this.shouldStopExtracting(count)) return;
        yield this.createRecordWithArchiveContext({ type: list, accountId }, { recordType: list });
        count++;
      }
    }
  }

  /** The account ids in one list, as the archive writes them. */
  private async loadList(list: List): Promise<string[]> {
    const { path, name, key } = LISTS[list];
    if (!(await this.files.has(path))) return [];
    const content = await this.files.readText(path);
    return this.parseTwitterJS(content, name)
      .map(item => item[key]?.accountId)
      .filter(Boolean);
  }

  override async determineCount(): Promise<number | null> {
    const lists = await Promise.all(
      (Object.keys(LISTS) as List[]).map(list => this.loadList(list))
    );
    return lists.reduce((total, ids) => total + ids.length, 0);
  }

  /** How many are in each list, as of when X generated the archive. */
  override async survey(): Promise<Survey> {
    const survey: Survey = {};
    for (const list of Object.keys(LISTS) as List[]) {
      const count = (await this.loadList(list)).length;
      survey[list] = { count, ...(count > 0 && { asOf: this.asOfTime() }) };
    }
    return survey;
  }
}
