import { Record } from '@chronicle.app/etl';
import { MarvinExtractor } from './MarvinExtractor.js';
import MarvinTransformer from './marvin-transformer.js';

export class MarvinSessionsExtractor extends MarvinExtractor {
  static override description = 'Reading sessions';
  static override recordTypes: string[] = ['reading-sessions'];
  static override default = true;
  static override defaultTransformer = MarvinTransformer;

  override async *extract(): AsyncGenerator<Record> {
    // Read all CSV rows first
    const rows: any[] = [];
    for await (const record of super.extract()) {
      rows.push(record.data); // CSV data is in the data field
    }

    // Group rows by Session ID
    const sessions = rows.reduce(
      (acc, row) => {
        const sessionId = row['Session ID'];
        if (!acc[sessionId]) {
          acc[sessionId] = [];
        }
        acc[sessionId].push(row);
        return acc;
      },
      {} as { [key: string]: any[] }
    );

    // Aggregate session data
    const reads = (Object.values(sessions) as any[][]).map((session: any[]) => {
      const aggregated = session.reduce(
        (memo: { [key: string]: any }, values: { [key: string]: any }) =>
          Object.entries(values).reduce((memo, [key, newValue]) => {
            if (key === 'Part Time') {
              // Sum all part times for the session
              memo[key] = (
                Number.parseFloat(memo[key] || '0') + Number.parseFloat(newValue as string)
              ).toString();
            } else if (key === 'Date Created') {
              // Use the latest date as session end time
              memo[key] = memo[key]
                ? new Date(
                    Math.max(new Date(memo[key]).getTime(), new Date(newValue as string).getTime())
                  ).toISOString()
                : newValue;
            } else {
              // For other fields, use latest value (last-wins strategy)
              memo[key] = newValue;
            }

            return memo;
          }, memo),
        {} as { [key: string]: any }
      );

      return aggregated;
    });

    // Filter out sessions without required fields and sort by Date Created
    let finalReads = reads
      .filter(read => read['Date Created'] && read['Session ID'])
      .sort(
        (a, b) => new Date(a['Date Created']).getTime() - new Date(b['Date Created']).getTime()
      );

    // Apply limit to final processed sessions (not raw CSV rows)
    if (this.config.limit) {
      finalReads = finalReads.slice(-this.config.limit);
    }

    // Yield each reading session as a record
    for (const read of finalReads) {
      yield this.createRecord(read);
    }
  }
}
