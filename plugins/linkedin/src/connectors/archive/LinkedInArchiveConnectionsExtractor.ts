import { Record } from '@chronicle.app/etl';
import { memberName, parseDayDate, profileHandle, profileUrl } from '../fields.js';
import LinkedInTransformer from '../LinkedInTransformer.js';
import { LinkedInArchiveExtractor } from './LinkedInArchiveExtractor.js';

/**
 * `Connections.csv` — everyone you are connected to, with the day it happened,
 * newest-first.
 *
 * The email column is nearly always blank: LinkedIn only releases a
 * connection's address when they opted into sharing it. The rows that do carry
 * one are worth keeping — an email is a portable identity that merges this
 * person with the one your mail archive already knows.
 *
 * `snapshot`, because a row is two things at once. "Connected On" is a real
 * past event and stays where LinkedIn put it. Their company and title are
 * whatever they are *today* — back-dating those to a connection made in 2010
 * would claim they worked there then, which is a claim the export never made.
 */
export class LinkedInArchiveConnectionsExtractor extends LinkedInArchiveExtractor<
  typeof LinkedInArchiveConnectionsExtractor
> {
  static override description = 'Connections';
  static override recordTypes = ['connections'];
  static override temporality = 'snapshot' as const;
  static override defaultTransformer = LinkedInTransformer;
  static override schema = LinkedInArchiveExtractor.schema;

  /** The connection's profile URL — LinkedIn's own id for them, and stable per export. */
  override keyOf(record: Record): string | null {
    return (record.data as { url?: string }).url ?? null;
  }

  async *extract(): AsyncGenerator<Record> {
    const rows = await this.readCsv('Connections.csv');

    const connections = rows
      .map(row => {
        const handle = profileHandle(row.URL);
        const name = memberName(
          [row['First Name'], row['Last Name']]
            .map(part => part?.trim())
            .filter(Boolean)
            .join(' ')
        );
        return {
          handle,
          name: name || undefined,
          url: handle ? profileUrl(handle) : undefined,
          email: row['Email Address']?.trim() || undefined,
          company: row.Company?.trim() || undefined,
          position: row.Position?.trim() || undefined,
          connectedOn: parseDayDate(row['Connected On']),
        };
      })
      // A row with neither a profile URL nor a name names nobody.
      .filter(connection => connection.handle || connection.name)
      .sort((a, b) => ((a.connectedOn ?? '') < (b.connectedOn ?? '') ? 1 : -1));

    let count = 0;
    for (const connection of connections) {
      if (this.shouldStopExtracting(count)) break;
      if (!this.withinWindow(connection.connectedOn)) continue;
      yield this.createRecordWithArchiveContext({
        ...connection,
        occurredAt: connection.connectedOn,
      });
      count++;
    }
  }

  override async determineCount(): Promise<number> {
    return (await this.readCsv('Connections.csv')).length;
  }
}
