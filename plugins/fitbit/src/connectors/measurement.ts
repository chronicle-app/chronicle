/**
 * What a reading record holds: when it was taken, at an instant or over a
 * period, and the values it measured, by the property of you each is on,
 * such as `{ heartRate: 72 }`.
 */
export interface Measurement {
  timestamp?: string;
  startTime?: string;
  endTime?: string;
  values: { [property: string]: number };
  /** The archive's ID for the reading, when it gives one. */
  logId?: number;
  /** The device that took it, by the name the archive gives it, such as `Aria`. */
  device?: string;
  /** How sure the tracker was of a heart rate, from 0 to 3. */
  confidence?: number;
  /** The entry as the archive has it, when it says more than the values. */
  log?: unknown;
}
