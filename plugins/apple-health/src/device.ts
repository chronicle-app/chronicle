/** A device as HealthKit describes it, field by field. */
export interface HealthDevice {
  /** The kind of device as Apple names it, such as `Apple Watch`. Not the name you gave it. */
  name?: string;
  manufacturer?: string;
  /** The product line, such as `Watch` or `iPhone`. */
  model?: string;
  /** The hardware identifier, such as `Watch6,14`. */
  hardware?: string;
  /** The OS release it ran, such as `10.2`. */
  software?: string;
}

/** A kind of device, by the Wikidata ID other sources can name too. */
export interface ProductLine {
  wikidataId: string;
  name: string;
  /** The device's :category. */
  category: string;
  /** What its OS is called, for the release's handle. */
  os: string;
}

const LINES: { [model: string]: ProductLine } = {
  iPhone: { wikidataId: 'Q2766', name: 'iPhone', category: 'phone', os: 'iOS' },
  Watch: { wikidataId: 'Q18010946', name: 'Apple Watch', category: 'watch', os: 'watchOS' },
};

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
    if (field === 'creation date') continue;
    device[field as keyof HealthDevice] = value.trim();
  }
  return device;
}

/** The kind of device a model names, when it's one Health records readings with. */
export function productLine(model: string | undefined): ProductLine | null {
  return (model && LINES[model]) || null;
}

/** The kind of device a hardware identifier belongs to, such as `Watch` for `Watch6,14`. */
export function lineOfHardware(hardware: string | undefined): ProductLine | null {
  const model = hardware?.match(/^([A-Za-z]+)\d/)?.[1];
  return productLine(model);
}
