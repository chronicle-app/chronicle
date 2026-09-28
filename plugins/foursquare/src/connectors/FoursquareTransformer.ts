import { ChronicleTransformer, Record, createImageObject } from '@chronicle.app/etl';
import { ActionAndChildren, Agent, Location, Venue, CheckInAction } from '@chronicle.app/schema';
import { FoursquareCheckin, FoursquareUser } from '../utils/FoursquareProxy.js';

export default class FoursquareTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'checkins') {
      actions.push(...this.buildCheckinActions(record));
    }

    return actions;
  }

  private buildCheckinActions(record: Record): ActionAndChildren[] {
    const actions: ActionAndChildren[] = [];
    const checkin = record.data as FoursquareCheckin;
    const actor = record.context?.actor as FoursquareUser;

    const user: Agent = this.buildUser(actor);
    const venue: Venue = this.buildVenue(checkin);

    const action: CheckInAction = {
      '@type': 'CheckInAction',
      '@key': ['@type', 'source', 'sourceId'],
      timestamp: new Date(checkin.createdAt * 1000),
      source: 'foursquare',
      sourceId: checkin.id,
      agent: user,
      object: venue,
    };

    actions.push(action);

    return actions;
  }

  // A Foursquare venue is a named point of interest → a Venue. Its
  // coordinates/address are its own keyless Location value (content-interned),
  // not entity properties on the Venue. Keyed [@type, source, sourceId] with
  // source "foursquare", so an Arc place's sameAs edge to this id collapses onto
  // the same entity.
  private buildVenue(checkin: FoursquareCheckin): Venue {
    const { venue } = checkin;
    const { location } = venue;

    const address = location.formattedAddress ? location.formattedAddress.join(', ') : undefined;

    // Foursquare's category names (the primary one first), e.g. ["Park"].
    const category = [...(venue.categories ?? [])]
      .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))
      .map(c => c.name)
      .filter(Boolean);

    return {
      '@type': 'Venue',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'foursquare',
      sourceId: venue.id,
      name: venue.name,
      location: this.buildLocation(location.lat, location.lng, address),
      ...(category.length > 0 && { category }),
    };
  }

  // The geo as a `Location` value — a keyless StructuredValue that shred
  // content-interns into location_values (deduped by payload).
  private buildLocation(latitude: number, longitude: number, address?: string): Location {
    return {
      '@type': 'Location',
      latitude,
      longitude,
      ...(address && { address }),
    };
  }

  private buildUser(actor: FoursquareUser): Agent {
    // Foursquare photo URLs are assembled as `${prefix}${size}${suffix}`.
    const avatar = actor.photo?.prefix
      ? `${actor.photo.prefix}300x300${actor.photo.suffix}`
      : undefined;

    return {
      '@type': 'Agent',
      '@key': ['@type', 'source', 'sourceId'],
      source: 'foursquare',
      sourceId: actor.id,
      name: `${actor.firstName} ${actor.lastName}`,
      url: actor.canonicalUrl,
      sameAs: ['@me'],
      ...(avatar && { emblem: createImageObject({ url: avatar }) }),
    };
  }
}
