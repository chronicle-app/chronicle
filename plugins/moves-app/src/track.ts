import { movesTimeToIso } from './time.js';
import { MovesTrackPoint } from './types.js';

// A leg's GPS trail as a GeoJSON `Feature` (LineString) with per-point time
// carried in `properties.coordTimes`, the Mapbox convention — so it round-trips
// to GPX and renders directly. Stored verbatim as the Journey's `path` (a JSON
// string in a Text property), the same encoding the Arc Timeline plugin writes.
//
// Moves records only position and time per fix; there is no speed or course to
// carry, so those arrays are absent rather than filled with nulls.
//
// Returns undefined when there are fewer than two fixes — a line needs two
// points, and Moves leaves the track empty on legs it inferred without GPS.
export function buildTrackFeature(points: MovesTrackPoint[] | undefined): string | undefined {
  if (!points || points.length < 2) return undefined;

  const coordinates: [number, number][] = [];
  const coordTimes: string[] = [];

  for (const point of points) {
    if (typeof point.lat !== 'number' || typeof point.lon !== 'number') continue;
    const time = movesTimeToIso(point.time);
    if (!time) continue;
    coordinates.push([point.lon, point.lat]);
    coordTimes.push(time);
  }

  if (coordinates.length < 2) return undefined;

  return JSON.stringify({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: { coordTimes },
  });
}
