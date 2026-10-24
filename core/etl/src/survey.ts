/** A total an extractor chooses to report beside a count, like conversations or attachment bytes. */
export interface Measure {
  /** Stable, for whatever reads the survey as data: `attachmentBytes`. */
  key: string;
  /**
   * What a person reads beside the number, a plural noun: `conversations`.
   * With a unit, what the amount is of: `attachments`, for 107 GB of attachments.
   */
  label: string;
  value: number;
  /** How to show the value. Without one, it's a count. */
  unit?: 'bytes' | 'seconds';
}

/** How much of one record type a run would read, and over when. */
export interface KindSurvey {
  count: number;
  /**
   * What one record is, a plural noun, when its record type doesn't say:
   * each of FoodNoms' `meals` is one food or drink logged, so `items`.
   */
  label?: string;
  /**
   * For records with a time of their own (a message sent, a transaction
   * made, a note written): the first and last, by a time a run gives each
   * record. Snapshot kinds have them too when their records carry times.
   */
  earliest?: Date;
  latest?: Date;
  /** For records without one (a subscription, a profile): when they were true, like the file's last change. */
  asOf?: Date;
  measures?: Measure[];
  /**
   * How many records each month holds, by `YYYY-MM` in local time, by the
   * same time as `earliest` and `latest`. Only when the survey is asked for it.
   */
  byMonth?: { [month: string]: number };
}

/** What a survey is asked for beyond counts and dates. */
export interface SurveyOptions {
  /** Count each kind's records by month: a query or a tally more, so asked of one source at a time. */
  byMonth?: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A date's month as `byMonth` keys it: `2021-03`, in local time. */
export const monthKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

/** Count one record in its month, for a survey that tallies as it reads. */
export function countMonth(byMonth: { [month: string]: number }, date: Date): void {
  const month = monthKey(date);
  byMonth[month] = (byMonth[month] ?? 0) + 1;
}

/** A survey of a run, by record type. */
export interface Survey {
  [recordType: string]: KindSurvey;
}

const earlier = (a?: Date, b?: Date) => (a && b ? (a <= b ? a : b) : (a ?? b));
const later = (a?: Date, b?: Date) => (a && b ? (a >= b ? a : b) : (a ?? b));

/** Two surveys of one kind as one: counts and measures added, times widened. */
function mergeKind(a: KindSurvey, b: KindSurvey): KindSurvey {
  const measures = [...(a.measures ?? [])];
  for (const measure of b.measures ?? []) {
    const same = measures.findIndex(m => m.key === measure.key && m.unit === measure.unit);
    if (same === -1) measures.push(measure);
    else measures[same] = { ...measures[same], value: measures[same].value + measure.value };
  }
  const merged: KindSurvey = { count: a.count + b.count };
  const label = a.label ?? b.label;
  if (label) merged.label = label;
  const earliest = earlier(a.earliest, b.earliest);
  const latest = later(a.latest, b.latest);
  const asOf = later(a.asOf, b.asOf);
  if (a.byMonth || b.byMonth) {
    const byMonth = { ...a.byMonth };
    for (const [month, n] of Object.entries(b.byMonth ?? {}))
      byMonth[month] = (byMonth[month] ?? 0) + n;
    merged.byMonth = byMonth;
  }
  if (earliest) merged.earliest = earliest;
  if (latest) merged.latest = latest;
  if (asOf) merged.asOf = asOf;
  if (measures.length > 0) merged.measures = measures;
  return merged;
}

/**
 * Several extractors' surveys as one run's, for a run that combines them:
 * the kinds of those that could say. Null when none could.
 */
export function mergeSurveys(surveys: (Survey | null)[]): Survey | null {
  const answered = surveys.filter((survey): survey is Survey => survey !== null);
  if (answered.length === 0) return null;
  const merged: Survey = {};
  for (const survey of answered) {
    for (const [kind, part] of Object.entries(survey)) {
      merged[kind] = merged[kind] ? mergeKind(merged[kind], part) : part;
    }
  }
  return merged;
}
