import { AgentAndChildren } from '@chronicle.app/schema';

// Shapes for the Arc Timeline automatic "Daily" backup (schemaVersion 2.2.0,
// written by the Arc Timeline Editor iOS app, built on LocoKit). The backup is
// a flat directory of one gzipped file per day:
//
//   YYYY-MM-DD.json.gz   a single self-contained day (see DailyExport)
//
// Each day's file inlines everything for that day — items, the places those
// items reference, the raw GPS samples, and any notes — so no cross-file joins
// are needed within a day. The one cross-file case is an item that spans
// midnight: it appears in both adjacent days' files, and its GPS samples are
// split between them (pre-midnight in one, post-midnight in the next), so a
// trip's full path is the union of its samples across the days its span covers.
//
// A timeline item is `{ base, trip | visit }`: `base` holds the fields common
// to every item, and exactly one of `trip` (movement) or `visit` (a stay)
// is present. `base.isVisit` distinguishes the two.

export interface ArcItemBase {
  id: string;
  startDate: string;
  endDate: string;
  isVisit: boolean;
  source: string;
  sourceVersion?: string;
  deleted?: boolean;
  disabled?: boolean;
  locked?: boolean;
  samplesChanged?: boolean;
  lastSaved?: string;
  previousItemId?: string;
  nextItemId?: string;
  stepCount?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  activeEnergyBurned?: number;
}

export interface ArcTrip {
  itemId: string;
  distance?: number;
  speed?: number;
  // LocoKit ActivityType raw enum value (integer). The code -> name mapping is
  // not carried in the export; it is resolved downstream, not invented here.
  classifiedActivityType?: number;
  confirmedActivityType?: number;
  uncertainActivityType?: boolean;
  lastSaved?: string;
}

export interface ArcVisit {
  itemId: string;
  placeId?: string;
  latitude: number;
  longitude: number;
  streetAddress?: string;
  customTitle?: string;
  radiusMean?: number;
  radiusSD?: number;
  confirmedPlace?: boolean;
  uncertainPlace?: boolean;
  lastSaved?: string;
}

export interface ArcItem {
  base: ArcItemBase;
  trip?: ArcTrip;
  visit?: ArcVisit;
}

// A raw GPS fix. Samples are inlined in each day's file and link to their item
// via `timelineItemId`; a trip's ordered samples form its path. Arc encodes
// unknown speed/course as -1.
export interface ArcSample {
  timelineItemId?: string;
  date: string;
  latitude?: number;
  longitude?: number;
  speed?: number;
  course?: number;
}

export interface ArcPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  streetAddress?: string;
  locality?: string;
  countryCode?: string;
  secondsFromGMT?: number;
  visitCount?: number;
  visitDays?: number;
  lastVisitDate?: string;
  isStale?: boolean;
  source?: string;
  lastSaved?: string;
  // External identity keys — strong cross-source dedupe handles.
  foursquarePlaceId?: string;
  foursquareCategoryId?: string;
  googlePlaceId?: string;
  googlePrimaryType?: string;
  mapboxPlaceId?: string;
  mapboxCategory?: string;
  mapboxMakiIcon?: string;
}

// One day's self-contained backup file (`YYYY-MM-DD.json.gz`, gunzipped). The
// `places` list is scoped to just the places that day's visits reference, and
// `samples` to just that day's fixes — both keyed back to items by id.
export interface DailyExport {
  items: ArcItem[];
  places: ArcPlace[];
  samples: ArcSample[];
  periodStart?: string;
  periodEnd?: string;
  periodId?: string;
}

// Record context attached by the extractor and read by the transformer.
export interface ArcRecordContext {
  recordType: 'visits' | 'travels';
  // The person whose timeline this is — the iCloud account, or an override.
  person: AgentAndChildren;
  // The place dictionary entry resolved from `visit.placeId`, when present.
  place?: ArcPlace;
  // A trip's ordered GPS samples, when present.
  samples?: ArcSample[];
}
