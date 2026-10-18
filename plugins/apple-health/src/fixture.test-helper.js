import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const account = {
  accountID: 'you@example.com',
  email: 'you@example.com',
  displayName: 'You',
  dsid: '1234567890',
};

export const WATCH = 'Sam’s Apple Watch';
export const OLD_WATCH = 'Apple Watch';
export const PHONE = 'Sam’s iPhone';

// HealthKit's description of a device. The address changes from sample to
// sample for the same device.
const device = (address, model, hardware, software) =>
  `&lt;&lt;HKDevice: ${address}&gt;, name:${model === 'Watch' ? 'Apple Watch' : 'iPhone'}, manufacturer:Apple Inc., model:${model}, hardware:${hardware}, software:${software}, creation date:2024-01-20 03:28:19 +0000&gt;`;
const watch = (address, software) => device(address, 'Watch', 'Watch7,1', software);
const phone = address => device(address, 'iPhone', 'iPhone15,2', '18.1');

const record = (type, attributes, children = '') => {
  const attrs = Object.entries({ type, ...attributes })
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
  return children ? ` <Record ${attrs}>\n${children} </Record>` : ` <Record ${attrs}/>`;
};
const meta = (key, value, indent = '  ') =>
  `${indent}<MetadataEntry key="${key}" value="${value}"/>\n`;
const quantity = name => `HKQuantityTypeIdentifier${name}`;
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
const stage = name => `HKCategoryValueSleepAnalysis${name}`;
const sleep = (source, value, start, end) =>
  record(
    SLEEP,
    {
      sourceName: source,
      sourceVersion: '11.2',
      creationDate: end,
      startDate: start,
      endDate: end,
      value: stage(value),
    },
    meta('HKTimeZone', 'America/Toronto')
  );

// An ECG recording as the export writes it: a header, then the voltage samples.
const ecg = (date, classification) =>
  [
    'Name,Sam Example',
    'Date of Birth,"Jan 1, 1990"',
    `Recorded Date,${date}`,
    `Classification,${classification}`,
    'Symptoms,',
    'Software Version,1.90',
    'Device,"Watch7,1"',
    'Sample Rate,512 hertz',
    '',
    '',
    'Lead,Lead I',
    'Unit,µV',
    '',
    '12.5',
    '-3.75',
    '',
  ].join('\n');

/**
 * A synthetic Health export, as the unzipped `apple_health_export` folder:
 * `export.xml` and two ECG recordings. Every date carries the offset in effect
 * when the export was made (`-0400`), even in winter.
 *
 * Heart: a watch's heart rate under two device addresses and two OS releases,
 * an exact duplicate, a different value at the same instant, a reading over a
 * period, one from an app, and one from the watch under its earlier name. A
 * resting heart rate whose sample doesn't describe the watch. HRV with its
 * beat list, walking heart rate, and recovery. A blood pressure correlation
 * whose two values the export repeats as separate samples. ECGs: one sinus
 * rhythm, one inconclusive.
 *
 * Respiratory: respiratory rate and blood oxygen. Body measurements: a wrist
 * temperature in °F, and one in an unknown unit.
 *
 * Activity: the phone's steps over nine minutes, and the watch's over one of
 * them. The watch's active energy in `Cal`, and an app's in `kJ`.
 *
 * Sleep, out of order: a watch night with `in bed` and a stage over the same
 * span, the phone's time in bed over the same night, a nap later that day,
 * and an older night from an app.
 *
 * Also skipped elements: a food correlation and a workout.
 */
export function writeHealthExport(dir) {
  const folder = join(dir, 'apple_health_export');
  mkdirSync(join(folder, 'electrocardiograms'), { recursive: true });

  const body = [
    record(
      quantity('HeartRate'),
      {
        sourceName: WATCH,
        sourceVersion: '9.2',
        device: watch('0x1', '9.2'),
        unit: 'count/min',
        creationDate: '2025-01-15 08:01:00 -0400',
        startDate: '2025-01-15 08:00:00 -0400',
        endDate: '2025-01-15 08:00:00 -0400',
        value: '72',
      },
      meta('HKMetadataKeyHeartRateMotionContext', '1')
    ),
    record(quantity('HeartRate'), {
      sourceName: WATCH,
      sourceVersion: '9.2',
      device: watch('0x1', '9.2'),
      unit: 'count/min',
      creationDate: '2025-01-15 08:01:00 -0400',
      startDate: '2025-01-15 08:00:00 -0400',
      endDate: '2025-01-15 08:00:00 -0400',
      value: '72',
    }),
    record(quantity('HeartRate'), {
      sourceName: WATCH,
      sourceVersion: '9.2',
      device: watch('0x2', '9.2'),
      unit: 'count/min',
      creationDate: '2025-01-15 08:01:00 -0400',
      startDate: '2025-01-15 08:00:00 -0400',
      endDate: '2025-01-15 08:00:00 -0400',
      value: '74',
    }),
    record(quantity('HeartRate'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      device: watch('0x3', '10.2'),
      unit: 'count/min',
      creationDate: '2025-02-01 09:10:00 -0400',
      startDate: '2025-02-01 09:00:00 -0400',
      endDate: '2025-02-01 09:05:00 -0400',
      value: '64.5',
    }),
    record(quantity('HeartRate'), {
      sourceName: 'Pulse Pal',
      sourceVersion: '2.0',
      unit: 'count/min',
      creationDate: '2024-06-01 10:00:00 -0400',
      startDate: '2024-06-01 10:00:00 -0400',
      endDate: '2024-06-01 10:00:00 -0400',
      value: '80',
    }),
    record(quantity('HeartRate'), {
      sourceName: OLD_WATCH,
      sourceVersion: '9.1',
      device: watch('0x4', '9.1'),
      unit: 'count/min',
      creationDate: '2024-12-01 07:00:00 -0400',
      startDate: '2024-12-01 07:00:00 -0400',
      endDate: '2024-12-01 07:00:00 -0400',
      value: '61',
    }),
    record(quantity('StepCount'), {
      sourceName: PHONE,
      sourceVersion: '18.1',
      device: phone('0x5'),
      unit: 'count',
      creationDate: '2025-01-15 09:00:00 -0400',
      startDate: '2025-01-15 08:50:00 -0400',
      endDate: '2025-01-15 08:59:00 -0400',
      value: '512',
    }),
    record(quantity('StepCount'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      device: watch('0xa', '10.2'),
      unit: 'count',
      creationDate: '2025-01-15 08:53:10 -0400',
      startDate: '2025-01-15 08:52:00 -0400',
      endDate: '2025-01-15 08:53:00 -0400',
      value: '96',
    }),
    record(quantity('ActiveEnergyBurned'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      device: watch('0xa', '10.2'),
      unit: 'Cal',
      creationDate: '2025-01-15 08:53:10 -0400',
      startDate: '2025-01-15 08:52:00 -0400',
      endDate: '2025-01-15 08:53:00 -0400',
      value: '4.125',
    }),
    record(quantity('ActiveEnergyBurned'), {
      sourceName: 'Pulse Pal',
      sourceVersion: '2.0',
      unit: 'kJ',
      creationDate: '2025-01-15 18:36:00 -0400',
      startDate: '2025-01-15 18:15:00 -0400',
      endDate: '2025-01-15 18:35:00 -0400',
      value: '418.4',
    }),
    record(quantity('RestingHeartRate'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      unit: 'count/min',
      creationDate: '2025-01-16 07:00:00 -0400',
      startDate: '2025-01-15 00:00:00 -0400',
      endDate: '2025-01-15 23:59:00 -0400',
      value: '58',
    }),
    record(quantity('WalkingHeartRateAverage'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      unit: 'count/min',
      creationDate: '2025-01-16 07:00:00 -0400',
      startDate: '2025-01-15 00:00:00 -0400',
      endDate: '2025-01-15 23:59:00 -0400',
      value: '97',
    }),
    record(
      quantity('HeartRateVariabilitySDNN'),
      {
        sourceName: WATCH,
        sourceVersion: '10.2',
        device: watch('0x6', '10.2'),
        unit: 'ms',
        creationDate: '2025-01-15 03:01:00 -0400',
        startDate: '2025-01-15 03:00:00 -0400',
        endDate: '2025-01-15 03:01:00 -0400',
        value: '48.25',
      },
      `${meta('HKAlgorithmVersion', '2')}  <HeartRateVariabilityMetadataList>\n   <InstantaneousBeatsPerMinute bpm="61" time="3:00:01.20 AM"/>\n   <InstantaneousBeatsPerMinute bpm="63" time="3:00:02.15 AM"/>\n  </HeartRateVariabilityMetadataList>\n`
    ),
    record(
      quantity('HeartRateRecoveryOneMinute'),
      {
        sourceName: WATCH,
        sourceVersion: '10.2',
        unit: 'count/min',
        creationDate: '2025-01-15 18:40:00 -0400',
        startDate: '2025-01-15 18:35:00 -0400',
        endDate: '2025-01-15 18:35:00 -0400',
        value: '31',
      },
      meta('HKMetadataKeyHeartRateRecoveryActivityType', '37')
    ),
    record(quantity('RespiratoryRate'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      device: watch('0x7', '10.2'),
      unit: 'count/min',
      creationDate: '2025-01-15 04:00:00 -0400',
      startDate: '2025-01-15 03:30:00 -0400',
      endDate: '2025-01-15 03:35:00 -0400',
      value: '15.5',
    }),
    record(quantity('OxygenSaturation'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      device: watch('0x8', '10.2'),
      unit: '%',
      creationDate: '2025-01-15 04:00:00 -0400',
      startDate: '2025-01-15 03:40:00 -0400',
      endDate: '2025-01-15 03:40:00 -0400',
      value: '0.97',
    }),
    record(quantity('AppleSleepingWristTemperature'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      unit: 'degF',
      creationDate: '2025-01-15 07:00:00 -0400',
      startDate: '2025-01-15 01:00:00 -0400',
      endDate: '2025-01-15 06:00:00 -0400',
      value: '96.8',
    }),
    record(quantity('AppleSleepingWristTemperature'), {
      sourceName: WATCH,
      sourceVersion: '10.2',
      unit: 'K',
      creationDate: '2025-01-16 07:00:00 -0400',
      startDate: '2025-01-16 01:00:00 -0400',
      endDate: '2025-01-16 06:00:00 -0400',
      value: '309.15',
    }),
    ` <Correlation type="HKCorrelationTypeIdentifierBloodPressure" sourceName="Health" sourceVersion="18.1" creationDate="2025-01-15 12:00:00 -0400" startDate="2025-01-15 11:58:00 -0400" endDate="2025-01-15 11:58:00 -0400">
${meta('HKWasUserEntered', '1')}${record(quantity('BloodPressureSystolic'), { sourceName: 'Health', sourceVersion: '18.1', unit: 'mmHg', creationDate: '2025-01-15 12:00:00 -0400', startDate: '2025-01-15 11:58:00 -0400', endDate: '2025-01-15 11:58:00 -0400', value: '118' }).replace(/^ /, '  ')}
${record(quantity('BloodPressureDiastolic'), { sourceName: 'Health', sourceVersion: '18.1', unit: 'mmHg', creationDate: '2025-01-15 12:00:00 -0400', startDate: '2025-01-15 11:58:00 -0400', endDate: '2025-01-15 11:58:00 -0400', value: '76' }).replace(/^ /, '  ')}
 </Correlation>`,
    record(quantity('BloodPressureSystolic'), {
      sourceName: 'Health',
      sourceVersion: '18.1',
      unit: 'mmHg',
      creationDate: '2025-01-15 12:00:00 -0400',
      startDate: '2025-01-15 11:58:00 -0400',
      endDate: '2025-01-15 11:58:00 -0400',
      value: '118',
    }),
    record(quantity('BloodPressureDiastolic'), {
      sourceName: 'Health',
      sourceVersion: '18.1',
      unit: 'mmHg',
      creationDate: '2025-01-15 12:00:00 -0400',
      startDate: '2025-01-15 11:58:00 -0400',
      endDate: '2025-01-15 11:58:00 -0400',
      value: '76',
    }),
    ` <Correlation type="HKCorrelationTypeIdentifierFood" sourceName="Food Log" sourceVersion="1" creationDate="2025-01-15 12:30:00 -0400" startDate="2025-01-15 12:30:00 -0400" endDate="2025-01-15 12:30:00 -0400">
${record(quantity('DietaryEnergyConsumed'), { sourceName: 'Food Log', unit: 'Cal', creationDate: '2025-01-15 12:30:00 -0400', startDate: '2025-01-15 12:30:00 -0400', endDate: '2025-01-15 12:30:00 -0400', value: '420' }).replace(/^ /, '  ')}
 </Correlation>`,
    ` <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="20" durationUnit="min" sourceName="${WATCH}" sourceVersion="10.2" device="${watch('0x9', '10.2')}" creationDate="2025-01-15 18:35:00 -0400" startDate="2025-01-15 18:15:00 -0400" endDate="2025-01-15 18:35:00 -0400">
${meta('HKTimeZone', 'America/Toronto')}  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2025-01-15 18:15:00 -0400" endDate="2025-01-15 18:35:00 -0400" average="150" minimum="120" maximum="171" unit="count/min"/>
 </Workout>`,
    // The night of January 14 to 15, out of order, with the phone's time in bed over it.
    sleep(WATCH, 'AsleepDeep', '2025-01-15 00:10:00 -0400', '2025-01-15 00:40:00 -0400'),
    sleep(WATCH, 'InBed', '2025-01-14 23:05:00 -0400', '2025-01-15 06:50:00 -0400'),
    sleep(WATCH, 'AsleepCore', '2025-01-14 23:20:00 -0400', '2025-01-15 00:10:00 -0400'),
    sleep(WATCH, 'InBed', '2025-01-14 23:20:00 -0400', '2025-01-15 00:10:00 -0400'),
    sleep(WATCH, 'AsleepREM', '2025-01-15 00:40:00 -0400', '2025-01-15 01:10:00 -0400'),
    sleep(WATCH, 'Awake', '2025-01-15 06:30:00 -0400', '2025-01-15 06:50:00 -0400'),
    sleep(PHONE, 'InBed', '2025-01-14 22:45:00 -0400', '2025-01-15 07:00:00 -0400'),
    // A nap that afternoon, hours after the night ended.
    sleep(WATCH, 'AsleepCore', '2025-01-15 14:00:00 -0400', '2025-01-15 14:30:00 -0400'),
    // An older night from an app.
    record(SLEEP, {
      sourceName: 'Sleep Cycle',
      sourceVersion: '3.1',
      creationDate: '2016-03-02 07:00:00 -0400',
      startDate: '2016-03-01 23:30:00 -0400',
      endDate: '2016-03-02 06:45:00 -0400',
      value: stage('InBed'),
    }),
  ].join('\n');

  writeFileSync(
    join(folder, 'export.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!-- HealthKit Export Version: 14 -->
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord|Audiogram|VisionPrescription)*)>
<!ATTLIST HealthData
  locale CDATA #REQUIRED
>
]>
<HealthData locale="en_CA">
 <ExportDate value="2025-08-10 10:13:08 -0400"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth="" HKCharacteristicTypeIdentifierBiologicalSex="HKBiologicalSexNotSet" HKCharacteristicTypeIdentifierBloodType="HKBloodTypeNotSet" HKCharacteristicTypeIdentifierFitzpatrickSkinType="HKFitzpatrickSkinTypeNotSet" HKCharacteristicTypeIdentifierCardioFitnessMedicationsUse="None"/>
${body}
</HealthData>
`
  );

  writeFileSync(
    join(folder, 'electrocardiograms', 'ecg_2025-01-20.csv'),
    ecg('2025-01-20 13:04:55 -0400', 'Sinus Rhythm')
  );
  writeFileSync(
    join(folder, 'electrocardiograms', 'ecg_2025-01-21.csv'),
    ecg('2025-01-21 09:00:00 -0400', 'Inconclusive')
  );
  return folder;
}
