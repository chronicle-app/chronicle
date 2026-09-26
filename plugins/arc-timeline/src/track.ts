import { ArcSample } from './types.js';

// A trip's GPS trail as a GeoJSON `Feature` (LineString) with per-point time,
// speed, and course carried in `properties` via the Mapbox `coordTimes`
// convention — so it round-trips to GPX (togpx) and renders directly. Stored
// verbatim as the Journey's `path` (a JSON string in a Text property).
//
// Returns undefined when there aren't at least two located fixes to form a line.
export function buildTrackFeature(samples: ArcSample[] | undefined): string | undefined {
  if (!samples || samples.length === 0) return undefined;

  const fixes = samples
    .filter(s => typeof s.latitude === 'number' && typeof s.longitude === 'number')
    .sort((a, b) => a.date.localeCompare(b.date));

  if (fixes.length < 2) return undefined;

  const coordinates: [number, number][] = [];
  const coordTimes: string[] = [];
  const speeds: (number | null)[] = [];
  const courses: (number | null)[] = [];

  for (const s of fixes) {
    coordinates.push([s.longitude as number, s.latitude as number]);
    coordTimes.push(s.date);
    // Arc encodes unknown speed/course as -1; null keeps the arrays aligned.
    speeds.push(typeof s.speed === 'number' && s.speed >= 0 ? s.speed : null);
    courses.push(typeof s.course === 'number' && s.course >= 0 ? s.course : null);
  }

  return JSON.stringify({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { coordTimes, speeds, courses },
  });
}
