// Moves' activity vocabulary, mapped to the travel-mode names Chronicle already
// carries for the same modes (the Arc Timeline plugin writes `metro`, so Moves'
// `underground` is written the same way — one word per mode across sources).
//
// Where Moves has no counterpart the source's own word stands: `transport` is
// Moves saying "motorized, but I could not tell which", and narrowing it to a
// car would be an invention. `escalator` is Moves' own too.
//
// `group` is the coarse bucket Moves rolled an activity up under (walking,
// running, cycling, transport); it is derivable from the activity, so only the
// specific one is carried.
export const MOVES_TRAVEL_MODES: Record<string, string> = {
  walking: 'walking',
  running: 'running',
  cycling: 'cycling',
  transport: 'transport',
  train: 'train',
  bus: 'bus',
  tram: 'tram',
  underground: 'metro',
  airplane: 'airplane',
  boat: 'boat',
  funicular: 'funicular',
  escalator: 'escalator',
  snowboarding: 'snowboarding',
};

export function travelModeName(activity: string | undefined): string | undefined {
  if (!activity) return undefined;
  return MOVES_TRAVEL_MODES[activity] ?? activity;
}
