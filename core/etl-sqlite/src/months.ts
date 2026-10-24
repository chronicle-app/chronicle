/**
 * A month bucket in SQL, `YYYY-MM` in local time, as a survey's `byMonth`
 * keys it, from an expression in Unix seconds.
 * @param unixSeconds A trusted, developer-supplied SQL expression
 */
export function monthSql(unixSeconds: string): string {
  return `strftime('%Y-%m', ${unixSeconds}, 'unixepoch', 'localtime')`;
}

/** Rows of a `GROUP BY` month, as a survey's `byMonth`: a row without a month is left out. */
export function countsByMonth(rows: Array<{ month: string | null; n: number }>): {
  [month: string]: number;
} {
  const byMonth: { [month: string]: number } = {};
  for (const { month, n } of rows) if (month) byMonth[month] = n;
  return byMonth;
}
