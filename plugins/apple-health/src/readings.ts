import type { HealthDevice } from './device.js';

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
    property: 'heartRateVariability',
    units: { ms: same },
  },
  HKQuantityTypeIdentifierHeartRateRecoveryOneMinute: {
    property: 'heartRateRecovery',
    units: { 'count/min': same },
  },
};

export const VITALS: { [type: string]: ReadingType } = {
  HKQuantityTypeIdentifierRespiratoryRate: {
    property: 'respiratoryRate',
    units: { 'count/min': same },
  },
  HKQuantityTypeIdentifierOxygenSaturation: { property: 'oxygenSaturation', units: { '%': same } },
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: {
    property: 'sleepingWristTemperature',
    units: { degC: same, degF: fahrenheit },
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

// The ECG classifications that name a rhythm. Others, such as `Inconclusive`
// or `Poor Recording`, say the recording couldn't tell.
export const RHYTHMS = new Set(['Sinus Rhythm', 'Atrial Fibrillation']);

/** The reading's key: its type, source, start, end, and values. */
export function readingKey(reading: Reading): string {
  const values = Object.values(reading.values).join('/');
  return [reading.type, reading.sourceName ?? '', reading.start, reading.end, values].join('|');
}
