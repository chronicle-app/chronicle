import { Record } from '@chronicle.app/etl';
import { memberName, parseSlashStamp, profileHandle, profileUrl } from '../fields.js';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

/**
 * Skill endorsements, both directions, merged newest-first:
 * `Endorsement_Given_Info.csv` and `Endorsement_Received_Info.csv`.
 *
 * `direction` records which file a row came from, which is the only thing that
 * says who vouched for whom — the two files are otherwise identical in shape.
 *
 * A row LinkedIn has not marked `ACCEPTED` still describes an endorsement that
 * happened, so it is extracted like any other. The status itself is a moderation
 * state rather than history — it can flip long after the act — and the
 * transformer leaves it off the payload instead of dating today's value to the
 * day of the endorsement.
 */
export class LinkedInArchiveEndorsementsExtractor extends LinkedInArchiveExtractor<
  typeof LinkedInArchiveEndorsementsExtractor
> {
  static override description = 'Skill endorsements given and received';
  static override recordTypes = ['endorsements'];
  static override defaultTransformer = LinkedInTransformer;
  static override schema = LinkedInArchiveExtractor.schema;

  async *extract(): AsyncGenerator<Record> {
    const given = await this.readEndorsements('Endorsement_Given_Info.csv', 'given');
    const received = await this.readEndorsements('Endorsement_Received_Info.csv', 'received');

    const endorsements = [...given, ...received].sort((a, b) =>
      (a.endorsedAt ?? '') < (b.endorsedAt ?? '') ? 1 : -1
    );

    let count = 0;
    for (const endorsement of endorsements) {
      if (this.shouldStopExtracting(count)) break;
      if (!this.withinWindow(endorsement.endorsedAt)) continue;
      yield this.createRecordWithArchiveContext({
        ...endorsement,
        occurredAt: endorsement.endorsedAt,
      });
      count++;
    }
  }

  /** One endorsement file, with the other party's columns read by prefix. */
  private async readEndorsements(fileName: string, direction: 'given' | 'received') {
    const prefix = direction === 'given' ? 'Endorsee' : 'Endorser';
    const rows = await this.readCsv(fileName);

    return rows
      .map(row => {
        const handle = profileHandle(row[`${prefix} Public Url`]);
        const name = memberName(
          [row[`${prefix} First Name`], row[`${prefix} Last Name`]]
            .map(part => part?.trim())
            .filter(Boolean)
            .join(' ')
        );
        return {
          direction,
          skill: row['Skill Name']?.trim(),
          status: row['Endorsement Status']?.trim() || undefined,
          otherHandle: handle,
          otherName: name || undefined,
          otherUrl: handle ? profileUrl(handle) : undefined,
          endorsedAt: parseSlashStamp(row['Endorsement Date']),
        };
      })
      .filter(row => row.skill && (row.otherHandle || row.otherName));
  }

  override async determineCount(): Promise<number> {
    const given = await this.readCsv('Endorsement_Given_Info.csv');
    const received = await this.readCsv('Endorsement_Received_Info.csv');
    return given.length + received.length;
  }
}
