import { type HealthSample, instant } from './health.js';

/** One stage of a night, between two instants. */
export interface Stage {
  /** The stage, such as `light`, `deep`, `REM`, or `awake`. */
  stage: string;
  start: string;
  end: string;
}

/** The samples one source wrote for one stretch of sleep, such as a night or a nap. */
export interface SleepPeriod {
  sourceName: string;
  start: string;
  end: string;
  /** The time zone the samples were written in, such as `America/New_York`, when Health kept it. */
  timeZone?: string;
  /** When Health last wrote one of its samples, if the export says. */
  recorded?: string;
  stages: Stage[];
}

// HealthKit's values for SleepAnalysis, by the stage each records. Health's
// core sleep is light sleep. Time in bed overlaps the stages, so it isn't one,
// and isn't read.
const STAGES: { [value: string]: string } = {
  HKCategoryValueSleepAnalysisAsleep: 'asleep',
  HKCategoryValueSleepAnalysisAsleepUnspecified: 'asleep',
  HKCategoryValueSleepAnalysisAsleepCore: 'light',
  HKCategoryValueSleepAnalysisAsleepDeep: 'deep',
  HKCategoryValueSleepAnalysisAsleepREM: 'REM',
  HKCategoryValueSleepAnalysisAwake: 'awake',
};

/** Samples further apart than this belong to different periods. */
export const PERIOD_GAP_MS = 2 * 60 * 60 * 1000;

/**
 * Group sleep samples into periods, each source on its own: samples from one
 * source that overlap or fall within two hours of each other are one period.
 * Sources aren't merged, so two devices that tracked the same night give two
 * periods.
 */
export function groupSleep(samples: HealthSample[]): SleepPeriod[] {
  const bySource = new Map<string, HealthSample[]>();
  for (const sample of samples) {
    if (!(sample.value && sample.value in STAGES)) continue;
    const list = bySource.get(sample.sourceName) ?? [];
    list.push(sample);
    bySource.set(sample.sourceName, list);
  }

  const periods: SleepPeriod[] = [];
  for (const [sourceName, list] of bySource) {
    const timed = list
      .map(sample => ({ sample, start: instant(sample.startDate), end: instant(sample.endDate) }))
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime());
    let current: { start: Date; end: Date; samples: HealthSample[] } | null = null;
    for (const { sample, start, end } of timed) {
      if (current && start.getTime() <= current.end.getTime() + PERIOD_GAP_MS) {
        if (end > current.end) current.end = end;
        current.samples.push(sample);
        continue;
      }
      if (current) periods.push(periodOf(sourceName, current));
      current = { start, end, samples: [sample] };
    }
    if (current) periods.push(periodOf(sourceName, current));
  }
  return periods;
}

function periodOf(
  sourceName: string,
  { start, end, samples }: { start: Date; end: Date; samples: HealthSample[] }
): SleepPeriod {
  // The same stage over the same span, written twice, is one stage.
  const stages = new Map<string, Stage>();
  for (const sample of samples) {
    const stage = {
      stage: STAGES[sample.value!],
      start: instant(sample.startDate).toISOString(),
      end: instant(sample.endDate).toISOString(),
    };
    stages.set(`${stage.stage}|${stage.start}|${stage.end}`, stage);
  }
  const timeZone = samples.find(sample => sample.metadata.HKTimeZone)?.metadata.HKTimeZone;
  const written = samples.flatMap(sample =>
    sample.creationDate ? [instant(sample.creationDate).getTime()] : []
  );
  return {
    sourceName,
    start: start.toISOString(),
    end: end.toISOString(),
    ...(timeZone && { timeZone }),
    ...(written.length > 0 && { recorded: new Date(Math.max(...written)).toISOString() }),
    stages: [...stages.values()],
  };
}
