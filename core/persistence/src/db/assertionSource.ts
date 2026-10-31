/**
 * Where an assertion's `source` lives: inside its payload body, never as a
 * column on the log. `body.source` is part of the hashed CID bytes, so a lifted
 * copy on the `assertions` row would only duplicate the log's source of truth —
 * and the fold never read one (shred takes `source` off the parsed body). The
 * few source-scoped readers of the log — `archive clear`, `archive assertions
 * --source`, `archive stats`, the debug views — read it back off
 * `assertion_payloads.body` with this expression. That is a body scan rather
 * than an indexed predicate: the accepted cost of keeping the log to its hashed
 * content plus the join keys the fold needs.
 *
 * A `confirm` body names a claim and carries no `source` of its own, so the
 * expression is NULL on confirm rows; callers coalesce where a string is
 * expected.
 *
 * @param bodyRef the SQL reference to the payload body column, e.g. `body` or
 *   an aliased `p.body`.
 */
export function assertionSourceSql(bodyRef = 'body'): string {
  return `json_extract(${bodyRef}, '$.source')`;
}
