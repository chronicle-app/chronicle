/** A device as HealthKit describes it, in the field Chronicle reads. */
export interface HealthDevice {
  /** Apple's identifier for the device's model, such as `Watch6,14`. */
  hardware?: string;
}

const FIELDS = ['name', 'manufacturer', 'model', 'hardware', 'software', 'creation date'];
// A field's value runs to the next known field or the closing bracket. Values
// can hold commas themselves, such as the hardware `Watch6,14`.
const FIELD = new RegExp(
  `(${FIELDS.join('|')}):(.*?)(?=, (?:${FIELDS.join('|')}|[A-Za-z]+):|>$)`,
  'g'
);

/**
 * Read HealthKit's description of a device, such as `<<HKDevice: 0x2836c5e50>,
 * name:Apple Watch, manufacturer:Apple Inc., model:Watch, hardware:Watch6,14,
 * software:10.2, creation date:…>`. The address at the start changes from one
 * sample to the next for the same device, so it's dropped.
 */
export function parseDevice(description: string | undefined): HealthDevice | null {
  if (!description?.startsWith('<<HKDevice:')) return null;
  const device: HealthDevice = {};
  for (const [, field, value] of description.matchAll(FIELD)) {
    if (field === 'hardware') device.hardware = value.trim();
  }
  return device;
}

/** Whether a hardware identifier is Apple's identifier for a model, such as `iPhone15,2`. */
export function isAppleModel(hardware: string | undefined): hardware is string {
  return /^[A-Za-z]+\d+,\d+$/.test(hardware ?? '');
}
