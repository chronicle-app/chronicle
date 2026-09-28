import { MergingExtractor, Record } from '@chronicle.app/etl';
import { z } from 'zod';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveConnectionsExtractor } from './LinkedInArchiveConnectionsExtractor.js';
import { LinkedInArchiveEducationExtractor } from './LinkedInArchiveEducationExtractor.js';
import { LinkedInArchiveEndorsementsExtractor } from './LinkedInArchiveEndorsementsExtractor.js';
import { LinkedInArchiveFollowsExtractor } from './LinkedInArchiveFollowsExtractor.js';
import { LinkedInArchiveLearningExtractor } from './LinkedInArchiveLearningExtractor.js';
import { LinkedInArchiveMessagesExtractor } from './LinkedInArchiveMessagesExtractor.js';
import { LinkedInArchivePositionsExtractor } from './LinkedInArchivePositionsExtractor.js';
import { LinkedInArchiveProfileExtractor } from './LinkedInArchiveProfileExtractor.js';

/**
 * The whole export in one reverse-chronological pass — what a bare
 * `extract linkedin -i <dir>` means.
 *
 * Every file is included rather than a curated subset: a LinkedIn export is
 * small enough to read end to end, and each of its files is the only copy of
 * what it holds. The profile record has no date and so lands last; everything
 * else interleaves by when it actually happened.
 */
export class LinkedInDefaultExtractor extends MergingExtractor<typeof LinkedInDefaultExtractor> {
  static override source = 'linkedin';
  static override description = 'Everything in the export, newest first';

  static override delivery = 'export' as const;
  static override strategy = 'archive';
  static override recordTypes = [
    'messages',
    'connections',
    'endorsements',
    'follows',
    'positions',
    'education',
    'learning',
    'profile',
  ];

  static override default = true;
  static override defaultTransformer = LinkedInTransformer;

  static override children = [
    LinkedInArchiveMessagesExtractor,
    LinkedInArchiveConnectionsExtractor,
    LinkedInArchiveEndorsementsExtractor,
    LinkedInArchiveFollowsExtractor,
    LinkedInArchivePositionsExtractor,
    LinkedInArchiveEducationExtractor,
    LinkedInArchiveLearningExtractor,
    LinkedInArchiveProfileExtractor,
  ];

  // The union of the children's flags, so the runner forwards them to the merge
  // and the merge forwards the raw config to each child.
  static override schema = MergingExtractor.schema.extend({
    input: z.string().describe('Path to the unpacked LinkedIn export directory'),
    'profile-url': z
      .string()
      .optional()
      .describe(
        'Your LinkedIn profile URL (https://www.linkedin.com/in/…). Only needed when the export carries no invitation to infer it from.'
      ),
  }) as any;

  /**
   * Every child dates its records the same way, on `occurredAt`. A record with
   * no date at all (the profile) sorts to the end rather than to 1970 by
   * accident — the merge is newest-first, and undated is not "oldest".
   */
  protected sortKey(record: Record): number {
    const { occurredAt } = record.data as { occurredAt?: string };
    if (!occurredAt) return Number.NEGATIVE_INFINITY;
    const parsed = Date.parse(occurredAt);
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  }
}
