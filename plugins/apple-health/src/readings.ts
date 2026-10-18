import type { HealthDevice } from './device.js';
import { shortType } from './health.js';

/** A measurement, ready to become a MeasureAction. */
export interface Reading {
  /** What was measured, as Health's type without its prefix, such as `HeartRate`. */
  type: string;
  /** The device or app that took it, by the name it goes by in Health. None for an ECG. */
  sourceName?: string;
  /** Whether the source is an app rather than a device. */
  app: boolean;
  /** The device, as far as the export describes it. */
  device: HealthDevice | null;
  start: string;
  end: string;
  /** The time zone the sample was written in, when Health kept it. */
  timeZone?: string;
  /** Each value, by the property it is on the person measured, such as `{ heartRate: 72 }`. */
  values: { [property: string]: number | string };
}

type Convert = (value: number) => number;
const same: Convert = value => value;
const fahrenheit: Convert = value => Math.round(((value - 32) * 5 * 1000) / 9) / 1000;
const kilojoules: Convert = value => Math.round((value * 1000) / 4.184) / 1000;

/** A Health type a reading comes from: the property its value becomes, by the units it can arrive in. */
export interface ReadingType {
  property: string;
  units: { [unit: string]: Convert };
}

// Oxygen saturation arrives as a fraction even though its unit is `%`.
export const HEART: { [type: string]: ReadingType } = {
  HKQuantityTypeIdentifierHeartRate: { property: 'heartRate', units: { 'count/min': same } },
  HKQuantityTypeIdentifierRestingHeartRate: {
    property: 'restingHeartRate',
    units: { 'count/min': same },
  },
  HKQuantityTypeIdentifierWalkingHeartRateAverage: {
    property: 'walkingHeartRate',
    units: { 'count/min': same },
  },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: {
    property: 'heartRateVariabilitySdnn',
    units: { ms: same },
  },
  HKQuantityTypeIdentifierHeartRateRecoveryOneMinute: {
    property: 'heartRateRecovery',
    units: { 'count/min': same },
  },
};

export const RESPIRATORY: { [type: string]: ReadingType } = {
  HKQuantityTypeIdentifierRespiratoryRate: {
    property: 'respiratoryRate',
    units: { 'count/min': same },
  },
  HKQuantityTypeIdentifierOxygenSaturation: { property: 'oxygenSaturation', units: { '%': same } },
};

export const BODY_MEASUREMENTS: { [type: string]: ReadingType } = {
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: {
    property: 'sleepingWristTemperature',
    units: { degC: same, degF: fahrenheit },
  },
};

// Amounts over each sample's period. Health writes energy in `Cal`, its name
// for the kilocalorie, or in `kJ`.
export const ACTIVITY: { [type: string]: ReadingType } = {
  HKQuantityTypeIdentifierStepCount: { property: 'stepCount', units: { count: same } },
  HKQuantityTypeIdentifierActiveEnergyBurned: {
    property: 'activeEnergyBurned',
    units: { Cal: same, kcal: same, kJ: kilojoules },
  },
};

/** A blood pressure correlation's two samples, by the property each becomes. */
export const BLOOD_PRESSURE = 'HKCorrelationTypeIdentifierBloodPressure';
export const BLOOD_PRESSURE_PARTS: { [type: string]: ReadingType } = {
  HKQuantityTypeIdentifierBloodPressureSystolic: {
    property: 'systolicBloodPressure',
    units: { mmHg: same },
  },
  HKQuantityTypeIdentifierBloodPressureDiastolic: {
    property: 'diastolicBloodPressure',
    units: { mmHg: same },
  },
};

/**
 * A sample's value in the unit its property is defined in, or null when it
 * arrives in a unit there's no conversion for, or isn't a number.
 */
export function convert(
  readingType: ReadingType,
  value: string | undefined,
  unit: string | undefined
): number | null {
  const toCanonical = unit === undefined ? undefined : readingType.units[unit];
  const number = value === undefined ? Number.NaN : Number(value);
  if (!toCanonical || !Number.isFinite(number)) return null;
  return toCanonical(number);
}

/** Every type a Health reading can come from, by the property its value becomes. */
export const READING_TYPES = {
  ...HEART,
  ...RESPIRATORY,
  ...BODY_MEASUREMENTS,
  ...ACTIVITY,
  ...BLOOD_PRESSURE_PARTS,
};

export const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis';
export const ELECTROCARDIOGRAM = 'Electrocardiogram';

/**
 * Each kind, by the series it reads: Health's types, without their prefix,
 * grouped as the Health app groups them.
 */
export const SERIES: { [kind: string]: string[] } = {
  heart: [...Object.keys(HEART), BLOOD_PRESSURE, ELECTROCARDIOGRAM].map(type => shortType(type)),
  respiratory: Object.keys(RESPIRATORY).map(type => shortType(type)),
  'body-measurements': Object.keys(BODY_MEASUREMENTS).map(type => shortType(type)),
  sleep: [shortType(SLEEP)],
  activity: Object.keys(ACTIVITY).map(type => shortType(type)),
};

// The ECG classifications that name a rhythm. Others, such as `Inconclusive`
// or `Poor Recording`, say the recording couldn't tell.
export const RHYTHMS = new Set(['Sinus Rhythm', 'Atrial Fibrillation']);
