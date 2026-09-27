/**
 * Pagination strategies for API proxies. Each drives a fetch-page callback to
 * exhaustion (or to `limit`) and returns the accumulated items; the three
 * shapes cover how APIs express "next": a growing offset, a numbered page, or
 * an opaque cursor.
 */

export const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

interface CommonOptions {
  /** Stop once this many items are collected (result is sliced to it). */
  limit?: number;
  /** Wait between page requests, in ms. */
  pageDelayMs?: number;
}

/**
 * Offset pagination: `fetchPage(offset)` returns a batch; the next call's
 * offset is advanced by the batch length. Stops on an empty or short batch
 * (fewer than `pageSize` items), or at `limit`.
 */
export async function paginateOffset<T>(
  options: CommonOptions & {
    fetchPage: (offset: number) => Promise<T[]>;
    /** Expected full-batch size; a shorter batch means the end was reached. */
    pageSize: number;
  }
): Promise<T[]> {
  const { fetchPage, pageSize, limit = Number.POSITIVE_INFINITY } = options;
  const items: T[] = [];
  let offset = 0;

  for (;;) {
    const batch = await fetchPage(offset);
    items.push(...batch);
    if (batch.length === 0 || batch.length < pageSize || items.length >= limit) {
      break;
    }
    offset += batch.length;
    if (options.pageDelayMs) await delay(options.pageDelayMs);
  }

  return Number.isFinite(limit) ? items.slice(0, limit) : items;
}

/**
 * Numbered-page pagination: `fetchPage(page)` returns a batch plus (usually on
 * the first response) the total number of pages. Stops past `totalPages`, on
 * an empty batch, or at `limit`.
 */
export async function paginateByPage<T>(
  options: CommonOptions & {
    fetchPage: (page: number) => Promise<{ items: T[]; totalPages?: number }>;
    startPage?: number;
  }
): Promise<T[]> {
  const { fetchPage, startPage = 1, limit = Number.POSITIVE_INFINITY } = options;
  const items: T[] = [];
  let totalPages = Number.POSITIVE_INFINITY;

  for (let page = startPage; page - startPage < totalPages; page++) {
    const response = await fetchPage(page);
    items.push(...response.items);
    if (response.totalPages !== undefined) {
      totalPages = response.totalPages;
    }
    if (response.items.length === 0 || items.length >= limit) break;
    if (page - startPage + 1 >= totalPages) break;
    if (options.pageDelayMs) await delay(options.pageDelayMs);
  }

  return Number.isFinite(limit) ? items.slice(0, limit) : items;
}

/**
 * Cursor pagination: `fetchPage(cursor)` returns a batch plus the cursor for
 * the next call (absent/null when exhausted). Stops on a missing cursor, an
 * empty batch after the first, or at `limit`.
 */
export async function paginateCursor<T>(
  options: CommonOptions & {
    fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; cursor?: string | null }>;
  }
): Promise<T[]> {
  const { fetchPage, limit = Number.POSITIVE_INFINITY } = options;
  const items: T[] = [];
  let cursor: string | undefined;

  do {
    const response = await fetchPage(cursor);
    items.push(...response.items);
    cursor = response.cursor ?? undefined;
    if (cursor && items.length < limit && options.pageDelayMs) {
      await delay(options.pageDelayMs);
    }
  } while (cursor && items.length < limit);

  return Number.isFinite(limit) ? items.slice(0, limit) : items;
}
