// LocoKit2 `ActivityType` enum (Int rawValues) — the classifier codes Arc
// stores in a trip's `classifiedActivityType` / `confirmedActivityType`.
//
// Source of truth (LocoKit2 is the engine behind Arc Timeline, sourceVersion 9):
// https://github.com/sobri909/LocoKit2/blob/main/Sources/LocoKit2/ActivityTypes/ActivityType.swift
//
// `unknown` (-1) and `bogus` (0) carry no classification, so they are
// intentionally omitted: an unrecognised or unclassified code yields no mode.
// Multi-word values use the enum's own `displayName` spelling.
export const ARC_ACTIVITY_TYPES: Record<number, string> = {
  1: 'stationary',
  2: 'walking',
  3: 'running',
  4: 'cycling',
  5: 'car',
  6: 'airplane',
  20: 'train',
  21: 'bus',
  22: 'motorcycle',
  23: 'boat',
  24: 'tram',
  25: 'tractor',
  26: 'tuk-tuk',
  27: 'songthaew',
  28: 'scooter',
  29: 'metro',
  30: 'cable car',
  31: 'funicular',
  32: 'chairlift',
  33: 'ski lift',
  34: 'taxi',
  35: 'hot air balloon',
  50: 'skateboarding',
  51: 'inline skating',
  52: 'snowboarding',
  53: 'skiing',
  54: 'horseback',
  55: 'swimming',
  56: 'golf',
  57: 'wheelchair',
  58: 'rowing',
  59: 'kayaking',
  60: 'surfing',
  61: 'hiking',
};

export function activityTypeName(code: number | undefined): string | undefined {
  if (code === undefined) return undefined;
  return ARC_ACTIVITY_TYPES[code];
}
