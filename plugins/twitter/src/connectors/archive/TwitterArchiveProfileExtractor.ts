import { Record, type Survey } from '@chronicle.app/etl';
import TwitterTransformer from '../TwitterTransformer.js';
import { TwitterArchiveExtractor } from './TwitterArchiveExtractor.js';

/**
 * Your profile, from `profile.js`: its bio, location, and avatar, with the
 * archive's copy of the avatar's file. X keeps only the current one, so it's
 * your profile when X generated the archive.
 *
 * `snapshot`, because the profile is what it was then, not something that
 * happened. Its website is left out: X gives it only as a `t.co` link.
 */
export class TwitterArchiveProfileExtractor extends TwitterArchiveExtractor<
  typeof TwitterArchiveProfileExtractor
> {
  static override description = 'Your profile';
  static override recordTypes = ['profile'];
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = TwitterTransformer;
  static override schema = TwitterArchiveExtractor.schema;

  /** Yours: one profile to an archive. */
  override keyOf(record: Record): string | null {
    return (record.data as { accountId?: string }).accountId ?? null;
  }

  override titleOf(): string {
    return 'Profile';
  }

  async *extract(): AsyncGenerator<Record> {
    this.accountInfo = await this.loadAccountInfo();
    const profile = await this.loadProfile();
    if (!profile || !this.accountInfo || this.shouldStopExtracting(0)) return;
    const { bio, location } = profile.description ?? {};
    const avatar = profile.avatarMediaUrl as string | undefined;
    const path = await this.mediaPath('profile_media', this.accountInfo.accountId, avatar);
    yield this.createRecordWithArchiveContext(
      {
        type: 'profile',
        accountId: this.accountInfo.accountId,
        ...(bio && { bio }),
        ...(location && { location }),
        ...(avatar && { avatar: { type: 'photo', url: avatar, ...(path && { path }) } }),
      },
      { originalData: profile }
    );
  }

  private async loadProfile(): Promise<any> {
    if (!(await this.files.has('data/profile.js'))) return undefined;
    const content = await this.files.readText('data/profile.js');
    return this.parseTwitterJS(content, 'profile')[0]?.profile;
  }

  override async determineCount(): Promise<number | null> {
    return (await this.loadProfile()) ? 1 : 0;
  }

  /** One profile, as of when X generated the archive. */
  override async survey(): Promise<Survey> {
    const count = (await this.loadProfile()) ? 1 : 0;
    return { profile: { count, ...(count > 0 && { asOf: this.asOfTime() }) } };
  }
}
