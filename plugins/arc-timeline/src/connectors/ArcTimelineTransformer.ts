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
import { activityTypeName } from '../activityTypes.js';
import { buildTrackFeature } from '../track.js';
import { ArcItem, ArcPlace, ArcRecordContext, ArcSample, ArcVisit } from '../types.js';

export default class ArcTimelineTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const context = record.context as ArcRecordContext;
    const item = record.data as ArcItem;

    if (context.recordType === 'visits') {
      return this.buildVisit(item, context.person, context.place);
    }
    if (context.recordType === 'travels') {
      return this.buildTravel(item, context.person, context.samples);
    }
    return [];
  }

  private buildVisit(
    item: ArcItem,
    person: AgentAndChildren,
    place?: ArcPlace
  ): ActionAndChildren[] {
    const { visit } = item;
    if (!visit) return [];

    const action = {
      '@type': 'VisitAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'arc',
      sourceId: item.base.id,
      agent: person,
      object: this.buildPlace(visit, place),
      startTime: new Date(item.base.startDate),
      endTime: new Date(item.base.endDate),
    } as ActionAndChildren;

    return [action];
  }

  private buildTravel(
    item: ArcItem,
    person: AgentAndChildren,
    samples?: ArcSample[]
  ): ActionAndChildren[] {
    const { trip } = item;

    // The action stays sparse; the detail lives on the Journey it produces.
    // A user-confirmed activity type wins over the classifier's guess. The path
    // is the trip's GPS trail as a GeoJSON track (when enough fixes exist).
    const mode = activityTypeName(trip?.confirmedActivityType ?? trip?.classifiedActivityType);
    const path = buildTrackFeature(samples);

    const journey: Journey = {
      '@type': 'Journey',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'arc',
      sourceId: item.base.id,
      ...(trip?.distance !== undefined && { distance: trip.distance }),
      ...(mode && { travelMode: mode }),
      ...(path && { path }),
    };

    const action = {
      '@type': 'TravelAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'arc',
      sourceId: item.base.id,
      agent: person,
      result: journey,
      startTime: new Date(item.base.startDate),
      endTime: new Date(item.base.endDate),
    } as ActionAndChildren;

    return [action];
  }

  private buildPlace(visit: ArcVisit, place?: ArcPlace): PlaceAndChildren {
    if (place) return this.buildVenue(place);
    return this.buildPlaceFromVisit(visit);
  }

  // A dictionary-backed Arc place is a named point of interest → a Venue. It
  // carries the venue's category and sameAs edges to the foreign venue ids Arc
  // resolved against. Raw locality/country stay as plain strings folded into the
  // freeform address — they have no keyed City/Country entity here; the geocoder
  // resolves those later, and raw strings live on `address`.
  private buildVenue(place: ArcPlace): Venue {
    const sameAs = this.buildPlaceSameAs(place);
    const address = [place.streetAddress, place.locality, place.countryCode?.toUpperCase()]
      .filter(Boolean)
      .join(', ');

    return {
      '@type': 'Venue',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'arc',
      sourceId: place.id,
      name: place.name,
      // The venue's coordinates/address are its own Location value — a keyless
      // (content-interned) geo node, not entity properties on the Venue.
      location: this.buildLocation(place.latitude, place.longitude, address),
      ...(place.googlePrimaryType && { category: [place.googlePrimaryType] }),
      ...(sameAs.length > 0 && { sameAs }),
    };
  }

  // The geo as a `Location` value — a keyless StructuredValue that shred
  // content-interns into location_values (deduped by payload). Raw
  // locality/country are folded into the freeform address by the caller; the
  // geocoder resolves structured admin areas later.
  private buildLocation(latitude: number, longitude: number, address?: string): Location {
    return {
      '@type': 'Location',
      latitude,
      longitude,
      ...(address && { address }),
    };
  }

  // Arc's place dictionary carries the external venue ids it resolved a place
  // against. Emit a sameAs edge per id so the Arc venue collapses into the same
  // entity as the foreign source's own Venue (which keys identically on
  // [@type, source, sourceId]). The id is a real handle from the export — never
  // synthesized — and each edge carries the title so a yet-unseen foreign venue
  // still has a name when this edge is what mints it.
  private buildPlaceSameAs(place: ArcPlace): Venue[] {
    const edges: Array<{ source: string; sourceId?: string }> = [
      { source: 'foursquare', sourceId: place.foursquarePlaceId },
      { source: 'google-places', sourceId: place.googlePlaceId },
    ];

    return edges
      .filter((edge): edge is { source: string; sourceId: string } => Boolean(edge.sourceId))
      .map(edge => ({
        '@type': 'Venue',
        '@key': ['@type', 'source', 'sourceId'],
        source: edge.source,
        sourceId: edge.sourceId,
        name: place.name,
      }));
  }

  private buildPlaceFromVisit(visit: ArcVisit): Place {
    // No dictionary entry — a coordinate-identified place. Key on the visit's
    // coordinates via computed keyfields (a natural key, never synthesized) so
    // repeat visits to the same spot merge; the geo itself is a nested Location
    // value, like every other place's.
    const name = visit.customTitle ?? visit.streetAddress;
    return {
      '@type': 'Place',
      '@key': [
        '@type',
        'source',
        { key: 'lat', value: String(visit.latitude) },
        { key: 'lng', value: String(visit.longitude) },
      ],
      source: 'arc',
      ...(name && { name }),
      location: this.buildLocation(visit.latitude, visit.longitude, visit.streetAddress),
    };
  }
}
