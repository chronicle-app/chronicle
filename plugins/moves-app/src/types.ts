import { AgentAndChildren } from '@chronicle.app/schema';

// Shapes for the JSON storyline in a Moves data export (the archive the
// moves-export.com service produced before the app shut down in 2018). The
// export holds the same data at five roll-ups (daily, weekly, monthly, yearly,
// full) and in four cuts (storyline, places, activities, summary). The
// storyline cut is the superset: it inlines each day's places AND its
// activities with their GPS track, so nothing has to be joined across files.
//
//   json/daily/storyline/storyline_YYYYMMDD.json   one day per file
//   json/full/storyline.json                       every day in one array
//
// A day is a list of segments, in order. A segment is one of:
//
//   place   a stay: the `place` it was at, plus any activity recorded there
//   move    movement between two stays: one activity per leg
//   off     tracking was off, but the phone still recorded activity
//
// A `move`/`off` segment splits into legs — walk to the station, take the
// train, walk to the office is one segment of three activities, each with its
// own type, distance, and track. The leg, not the segment, is the unit that
// carries a single mode of travel.
//
// A segment that spans midnight is written into both days' entries, so the same
// segment is read twice; its `startTime` is what tells the two copies apart.

// A time in the ISO 8601 basic format Moves writes: "20140510T134349-0300"
// (local time with its UTC offset) or "20141021T042519Z".
export type MovesTime = string;

export interface MovesLocation {
  lat: number;
  lon: number;
}

// A place in Moves' own dictionary. `id` is Moves' id for it and is stable
// across every visit. `type` says where the place came from: `home`/`work`/
// `user` are the user's own named places, `foursquare`/`facebook` are places
// matched against those services (and carry that service's id), and `unknown`
// is a spot Moves detected but never named.
export interface MovesPlace {
  id: number;
  name?: string;
  type: 'home' | 'work' | 'user' | 'foursquare' | 'facebook' | 'unknown';
  location: MovesLocation;
  foursquareId?: string;
  foursquareCategoryIds?: string[];
  facebookPlaceId?: string;
}

export interface MovesTrackPoint {
  lat: number;
  lon: number;
  time: MovesTime;
}

// One leg of movement. `activity` is the specific mode, `group` the coarse
// bucket Moves rolled it up under. Distances are meters, durations seconds.
// `manual` marks a leg the user corrected by hand.
export interface MovesActivity {
  activity: string;
  group?: string;
  manual?: boolean;
  startTime: MovesTime;
  endTime: MovesTime;
  duration?: number;
  distance?: number;
  steps?: number;
  calories?: number;
  trackPoints?: MovesTrackPoint[];
}

export interface MovesSegment {
  type: 'place' | 'move' | 'off';
  startTime: MovesTime;
  endTime: MovesTime;
  place?: MovesPlace;
  activities?: MovesActivity[];
  lastUpdate?: MovesTime;
}

// One day of the storyline. `date` is the local day, "YYYYMMDD".
export interface MovesDay {
  date: string;
  segments?: MovesSegment[];
  lastUpdate?: MovesTime;
}

// Record context attached by the extractor and read by the transformer.
export interface MovesRecordContext {
  recordType: 'places' | 'moves';
  // The person whose storyline this is. The export carries no account
  // identity, so this is the per-source self, merged through "@me".
  person: AgentAndChildren;
}
