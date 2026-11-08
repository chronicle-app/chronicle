import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// A synthetic Fitbit account archive, laid out as Fitbit's Data Export page
// wrote it: MyFitbitData/<Name>/<Category>/…. The profile is in Toronto, and
// one night and its days are spent in a zone seven hours behind UTC.

export const PROFILE = {
  id: '2ABCDE',
  name: 'Sam Example',
  email: 'sam@example.com',
};

const json = value => JSON.stringify(value, null, 2);

// Fitbit's own time, MM/DD/YY HH:MM:SS.
const fitbit = iso => {
  const [date, time] = iso.split('T');
  const [y, m, d] = date.split('-');
  return `${m}/${d}/${y.slice(2)} ${time}`;
};

const heartRate = (...times) =>
  times.map((time, i) => ({ dateTime: fitbit(time), value: { bpm: 60 + i, confidence: 2 } }));

const level = (dateTime, level, seconds) => ({ dateTime, level, seconds });

/** A stages night, with a brief wake inside light sleep and one across light and deep. */
const summerNight = thirtyDayAvgMinutes => ({
  logId: 2001,
  dateOfSleep: '2019-07-02',
  startTime: '2019-07-01T23:30:00.000',
  endTime: '2019-07-02T07:00:00.000',
  duration: 27_000_000,
  mainSleep: true,
  type: 'stages',
  logType: 'auto_detected',
  levels: {
    summary: { deep: { count: 1, minutes: 30, thirtyDayAvgMinutes } },
    data: [
      level('2019-07-01T23:30:00.000', 'wake', 300),
      level('2019-07-01T23:35:00.000', 'light', 3600),
      level('2019-07-02T00:35:00.000', 'deep', 1800),
      level('2019-07-02T01:05:00.000', 'rem', 21_300),
    ],
    shortData: [
      level('2019-07-02T00:00:00.000', 'wake', 60),
      level('2019-07-02T00:34:30.000', 'wake', 60),
    ],
  },
});

/** A classic nap, whose restless and awake minutes are one waking. */
const classicNap = {
  logId: 2002,
  dateOfSleep: '2019-06-20',
  startTime: '2019-06-20T13:00:00.000',
  endTime: '2019-06-20T14:00:30.000',
  duration: 3_630_000,
  mainSleep: false,
  type: 'classic',
  logType: 'auto_detected',
  levels: {
    data: [
      level('2019-06-20T13:00:00.000', 'asleep', 1800),
      level('2019-06-20T13:30:00.000', 'restless', 120),
      level('2019-06-20T13:32:00.000', 'awake', 60),
      level('2019-06-20T13:33:00.000', 'asleep', 1620),
    ],
  },
};

/** A night away, in a zone seven hours behind UTC, with a stretch the tracker couldn't read. */
const nightAway = {
  logId: 2003,
  dateOfSleep: '2019-07-11',
  startTime: '2019-07-10T23:00:00.000',
  endTime: '2019-07-11T06:00:00.000',
  duration: 25_200_000,
  mainSleep: true,
  type: 'stages',
  logType: 'auto_detected',
  levels: {
    data: [
      level('2019-07-10T23:00:00.000', 'light', 3600),
      level('2019-07-11T00:00:00.000', 'unknown', 600),
      level('2019-07-11T00:10:00.000', 'deep', 21_000),
    ],
    shortData: [],
  },
};

/** The night the clocks went forward, which Fitbit writes in one offset. */
const springNight = {
  logId: 2004,
  dateOfSleep: '2019-03-10',
  startTime: '2019-03-09T23:00:00.000',
  endTime: '2019-03-10T07:00:00.000',
  duration: 28_800_000,
  mainSleep: true,
  type: 'stages',
  logType: 'auto_detected',
  levels: { data: [level('2019-03-09T23:00:00.000', 'light', 28_800)], shortData: [] },
};

const exercise = fields => ({
  activityLevel: [],
  averageHeartRate: 110,
  calories: 200,
  activeDuration: fields.duration,
  manualValuesSpecified: { calories: false, distance: false, steps: false },
  hasGps: false,
  ...fields,
});

/** Every file of the archive, by its path in MyFitbitData. */
export function fitbitArchiveFiles() {
  const root = 'MyFitbitData/SamExample';
  return {
    [`${root}/Personal & Account/Profile.csv`]: [
      'id,full_name,first_name,email_address,timezone,locale,member_since,height,weight,height_unit,weight_unit',
      `${PROFILE.id},${PROFILE.name},Sam,${PROFILE.email},America/Toronto,en_CA,2016-01-01,180.0,75.0,METRIC,METRIC`,
    ].join('\n'),

    [`${root}/Physical Activity/exercise-0.json`]: json([
      exercise({
        logId: 1001,
        activityName: 'Outdoor Bike',
        activityTypeId: 90_001,
        startTime: '07/01/19 15:33:19',
        duration: 1_800_000,
        distance: 12.4,
        distanceUnit: 'Kilometer',
        source: { type: 'tracker', name: 'Charge 3', id: '111', url: 'https://www.fitbit.com/' },
        logType: 'tracker',
        lastModified: '07/01/19 16:10:00',
      }),
      exercise({
        logId: 1002,
        activityName: 'Walk',
        activityTypeId: 90_013,
        startTime: '07/02/19 12:00:00',
        duration: 900_000,
        steps: 1200,
        logType: 'auto_detected',
        lastModified: '07/02/19 12:20:00',
      }),
    ]),
    [`${root}/Physical Activity/exercise-100.json`]: json([
      exercise({
        logId: 1003,
        activityName: 'Run',
        activityTypeId: 90_009,
        startTime: '06/30/19 10:00:00',
        duration: 1_500_000,
        distance: 3.1,
        distanceUnit: 'Mile',
        source: { type: 'app', name: 'Strava', id: '22997K', url: 'https://strava.example/' },
        logType: 'manual',
        lastModified: '06/30/19 10:40:00',
      }),
    ]),

    // Each file holds a local day's readings in UTC. In July Toronto is four
    // hours behind UTC; away, seven.
    [`${root}/Physical Activity/heart_rate-2019-07-01.json`]: json(
      heartRate('2019-07-01T04:00:05', '2019-07-01T15:40:00', '2019-07-02T03:59:55')
    ),
    [`${root}/Physical Activity/heart_rate-2019-07-02.json`]: json(
      heartRate('2019-07-02T04:00:10', '2019-07-02T12:05:00', '2019-07-03T03:59:50')
    ),
    [`${root}/Physical Activity/heart_rate-2019-07-10.json`]: json(
      heartRate('2019-07-10T07:00:05', '2019-07-11T06:59:55')
    ),
    [`${root}/Physical Activity/heart_rate-2019-07-11.json`]: json(
      heartRate('2019-07-11T07:00:03', '2019-07-12T06:59:58')
    ),
    [`${root}/Physical Activity/resting_heart_rate-2019-06-01.json`]: json([
      { dateTime: '07/01/19 00:00:00', value: { date: '07/01/19', value: 58.25, error: 6.1 } },
      { dateTime: '07/02/19 00:00:00', value: { date: '07/02/19', value: 0, error: 0 } },
      { dateTime: '07/10/19 00:00:00', value: { date: '07/10/19', value: 61.5, error: 5.2 } },
      { dateTime: '07/11/19 00:00:00', value: { date: null, value: 0, error: 0 } },
    ]),
    // Not in order, as two of the real files aren't.
    [`${root}/Physical Activity/steps-2019-07-01.json`]: json([
      { dateTime: '07/01/19 15:34:00', value: '96' },
      { dateTime: '07/01/19 15:33:00', value: '0' },
      { dateTime: '07/01/19 15:36:00', value: '104' },
      { dateTime: '07/01/19 15:35:00', value: '0' },
    ]),
    [`${root}/Physical Activity/steps-2019-07-02.json`]: json([
      { dateTime: '07/02/19 12:00:00', value: '80' },
    ]),
    // Neither series this plugin reads.
    [`${root}/Physical Activity/time_in_heart_rate_zones-2019-07-01.json`]: json([
      { dateTime: '07/01/19 00:00:00', value: { valuesInZones: { IN_DEFAULT_ZONE_1: 5 } } },
    ]),
    [`${root}/Physical Activity/calories-2019-07-01.json`]: json([
      { dateTime: '07/01/19 00:00:00', value: '1.2' },
    ]),

    // Two 30-day files that both hold the summer night, with different averages.
    [`${root}/Sleep/sleep-2019-06-02.json`]: json([summerNight(70), classicNap]),
    [`${root}/Sleep/sleep-2019-07-02.json`]: json([nightAway, summerNight(72)]),
    [`${root}/Sleep/sleep-2019-02-10.json`]: json([springNight]),
    [`${root}/Sleep/sleep_score.csv`]:
      'sleep_log_entry_id,timestamp,overall_score\n2001,2019-07-02T07:00:00Z,84\n',

    // Weights in pounds, as Fitbit writes them, with one logged twice.
    [`${root}/Personal & Account/weight-2019-06-12.json`]: json([
      {
        logId: 1_561_975_200_000,
        weight: 165,
        bmi: 23.1,
        date: '07/01/19',
        time: '10:00:00',
        source: 'Aria',
      },
      {
        logId: 1_561_975_200_000,
        weight: 165,
        bmi: 23.1,
        date: '07/01/19',
        time: '10:00:00',
        source: 'Aria',
      },
      {
        logId: 1_562_803_200_000,
        weight: 166,
        bmi: 23.24,
        date: '07/11/19',
        time: '00:00:00',
        source: 'API',
      },
    ]),
    [`${root}/Personal & Account/height-2016-01-01.json`]: json([
      { dateTime: '01/01/16 00:00:00', value: '1800' },
    ]),
  };
}

/** Write the archive under a folder, and return the MyFitbitData folder a person passes. */
export function writeFitbitArchive(dir) {
  for (const [path, content] of Object.entries(fitbitArchiveFiles())) {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return join(dir, 'MyFitbitData');
}
