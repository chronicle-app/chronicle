import type {
  actions,
  entities,
  entityTypes,
  assertionPayloads,
  assertions,
  metrics,
  observations,
  properties,
  sourcedEntities,
  vals,
} from './schema.js';

export type AssertionRow = typeof assertions.$inferSelect;
export type AssertionInsert = typeof assertions.$inferInsert;

export type EventPayloadRow = typeof assertionPayloads.$inferSelect;
export type EventPayloadInsert = typeof assertionPayloads.$inferInsert;

export type ValRow = typeof vals.$inferSelect;

export type EntityRow = typeof entities.$inferSelect;
export type EntityInsert = typeof entities.$inferInsert;

export type SourcedEntityRow = typeof sourcedEntities.$inferSelect;
export type SourcedEntityInsert = typeof sourcedEntities.$inferInsert;

export type EntityTypeRow = typeof entityTypes.$inferSelect;
export type EntityTypeInsert = typeof entityTypes.$inferInsert;

export type ActionRow = typeof actions.$inferSelect;
export type ActionInsert = typeof actions.$inferInsert;

export type ObservationRow = typeof observations.$inferSelect;
export type ObservationInsert = typeof observations.$inferInsert;

export type PropertyRow = typeof properties.$inferSelect;
export type PropertyInsert = typeof properties.$inferInsert;

export type MetricRow = typeof metrics.$inferSelect;
export type MetricInsert = typeof metrics.$inferInsert;
