import { z } from 'zod';
import { LoadResult, Record } from '../../types.js';
import { Loader } from '../../loader.js';

export class HttpLoader extends Loader<typeof HttpLoader> {
  static override source = 'http';
  static override schema = z.object({
    endpoint: z.string().describe('HTTP endpoint to POST records to'),
    method: z.string().default('POST').describe('HTTP method to use'),
    token: z.string().optional().describe('HTTP bearer token to use for authorization'),
  });

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
      return { success: false, record, error: await response.text() };
    }

    return { success: true, record };
  }
}
