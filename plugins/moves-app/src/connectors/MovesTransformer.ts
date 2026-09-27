import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  AgentAndChildren,
  Journey,
  Location,
  Place,
  PlaceAndChildren,
  Venue,
} from '@chronicle.app/schema';
import { travelModeName } from '../activityTypes.js';
import { movesTimeToIso } from '../time.js';
import { buildTrackFeature } from '../track.js';
import { MovesActivity, MovesPlace, MovesRecordContext, MovesSegment } from '../types.js';

export default class MovesTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const context = record.context as MovesRecordContext;

    if (context.recordType === 'places') {
      return this.buildVisit(record.data as MovesSegment, context.person);
    }
    if (context.recordType === 'moves') {
      return this.buildTravel(record.data as MovesActivity, context.person);
    }
    return [];
  }

  private buildVisit(segment: MovesSegment, person: AgentAndChildren): ActionAndChildren[] {
    const { place } = segment;
    const startTime = movesTimeToIso(segment.startTime);
    const endTime = movesTimeToIso(segment.endTime);
    if (!place || !startTime) return [];

    const action = {
      '@type': 'VisitAction',
      '@key': this.spanKey(startTime),
      source: 'moves-app',
      agent: person,
      object: this.buildPlace(place),
      startTime,
      ...(endTime && { endTime }),
    } as ActionAndChildren;

    return [action];
  }

  private buildTravel(activity: MovesActivity, person: AgentAndChildren): ActionAndChildren[] {
    const startTime = movesTimeToIso(activity.startTime);
    const endTime = movesTimeToIso(activity.endTime);
    if (!startTime) return [];

    // The action stays sparse; the detail lives on the Journey it produces.
    const mode = travelModeName(activity.activity);
    const path = buildTrackFeature(activity.trackPoints);

    const journey: Journey = {
      '@type': 'Journey',
      '@key': this.spanKey(startTime),
      source: 'moves-app',
      ...(activity.distance !== undefined && { distance: activity.distance }),
      ...(mode && { travelMode: mode }),
      ...(path && { path }),
    };

    const action = {
      '@type': 'TravelAction',
      '@key': this.spanKey(startTime),
      source: 'moves-app',
      agent: person,
      result: journey,
      startTime,
      ...(endTime && { endTime }),
    } as ActionAndChildren;

    return [action];
  }

  // A segment carries no id in the export — Moves numbered its places, never
  // its segments. What identifies one is when it began: a person is in one
  // place, and on one leg of one journey, at a time. So the start instant is
  // the natural key, spelled as a UTC ISO string so it hashes the same on every
  // replica. The type is part of the keyset, so a stay, the leg that ended it,
  // and that leg's Journey never collide.
  private spanKey(startTime: string) {
    return ['@type', 'source', { key: 'startTime', value: startTime }] as Venue['@key'];
  }

  // A named place is a point of interest → a Venue; an unnamed one is a spot
  // Moves detected but never named → a Place. Either way it keys on the Moves
  // place id, which is the id Moves issued and reused on every visit, and either
  // way it carries whatever identity edges the place has: the name decides the
  // type, never whether a foreign id is reported.
  private buildPlace(place: MovesPlace): PlaceAndChildren {
    const sameAs = this.buildPlaceSameAs(place);
    const common = {
      '@key': ['@type', 'source', 'sourceId'],
      source: 'moves-app',
      sourceId: String(place.id),
      // The place's coordinates are its own Location value — a keyless
      // (content-interned) geo node, not entity properties on the place.
      location: this.buildLocation(place),
      ...(sameAs.length > 0 && { sameAs }),
    };

    return place.name
      ? ({ '@type': 'Venue', ...common, name: place.name } as Venue)
      : ({ '@type': 'Place', ...common } as Place);
  }

  private buildLocation(place: MovesPlace): Location {
    return {
      '@type': 'Location',
      latitude: place.location.lat,
      longitude: place.location.lon,
    };
  }

  // Moves matched some places against Foursquare and Facebook and kept those
  // services' ids. Emit a sameAs edge per id so the Moves place collapses into
  // the same entity as that service's own Venue (which keys identically on
  // [@type, source, sourceId]). The id is a real handle from the export — never
  // synthesized — and each edge carries the title when there is one, so a
  // yet-unseen foreign venue still has a name when this edge is what mints it.
  private buildPlaceSameAs(place: MovesPlace): Venue[] {
    const edges: { source: string; sourceId?: string }[] = [
      { source: 'foursquare', sourceId: place.foursquareId },
      { source: 'facebook', sourceId: place.facebookPlaceId },
    ];

    return edges
      .filter((edge): edge is { source: string; sourceId: string } => Boolean(edge.sourceId))
      .map(edge => ({
        '@type': 'Venue',
        '@key': ['@type', 'source', 'sourceId'],
        source: edge.source,
        sourceId: edge.sourceId,
        ...(place.name && { name: place.name }),
      }));
  }
}
