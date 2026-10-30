import { z } from 'zod';
import { LoadResult, Record } from '../../types.js';
import { Loader } from '../../loader.js';

/** The most of a failed response's body a load error repeats. */
const BODY_LENGTH = 200;

export class HttpLoader extends Loader<typeof HttpLoader> {
  static override source = 'http';
  static override schema = z.object({
    endpoint: z.string().describe('HTTP endpoint to POST records to'),
    method: z.string().default('POST').describe('HTTP method to use'),
    token: z.string().optional().describe('HTTP bearer token to use for authorization'),
  });

  // It sends records to the endpoint and prints none.
  static override printsRecords = false;

  async load(record: Record): Promise<LoadResult> {
    const { endpoint, method, token } = this.config;

    const response = await fetch(endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(record.data),
    });

    if (!response.ok) {
      // The status first, short enough to leave room for the record the run
      // names beside it, and what the endpoint said on a line of its own.
      const status = `HTTP ${response.status} ${response.statusText}`.trim();
      const body = (await response.text()).replaceAll(/\s+/g, ' ').trim();
      const said = body.length > BODY_LENGTH ? `${body.slice(0, BODY_LENGTH - 1)}…` : body;
      return { success: false, record, error: said ? `${status}\n${said}` : status };
    }

    return { success: true, record };
  }
}
