// Generated from schema.ttl. Do not edit; run npm run schema:generate.
import { z } from 'zod';

// Record identity key field: a property path, or a computed {key, value} entry
export type KeyField = string | { key: string; value: string };

function requireNodeIdentity(
  node: { '@key'?: unknown; '@id'?: unknown },
  ctx: z.RefinementCtx
): void {
  const hasKey = Array.isArray(node['@key']) && node['@key'].length > 0;
  const hasId = typeof node['@id'] === 'string' && node['@id'].length > 0;
  if (!hasKey && !hasId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Node must carry @key or @id — every identity-bearing node needs an identity.',
    });
  }
}

// Base, child of
export interface Base {
  '@type': 'Base';
  sourceId?: string;
  '@key'?: KeyField[];
  '@id'?: string;
}

export type BaseAndChildren = Base | ActionAndChildren | EntityAndChildren;

const BaseProperties = {
  sourceId: z.lazy(() => z.string()).optional(),
  '@key': z
    .array(z.union([z.string(), z.object({ key: z.string(), value: z.string() })]))
    .optional(),
  '@id': z.string().optional(),
};

export const BaseSchema: z.ZodType<Base> = z
  .object({
    '@type': z.literal('Base'),
    ...BaseProperties,
  })
  .superRefine(requireNodeIdentity);

// Action, child of https://schema.chronicle.app/Base
export interface Action extends Omit<Base, '@type'> {
  '@type': 'Action';
  object?: EntityAndChildren;
}

export type ActionAndChildren = Action;

const ActionProperties = {
  ...BaseProperties,
  object: z.lazy(() => EntityAndChildrenSchema).optional(),
};

export const ActionSchema: z.ZodType<Action> = z
  .object({
    '@type': z.literal('Action'),
    ...ActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Entity, child of https://schema.chronicle.app/Base
export interface Entity extends Omit<Base, '@type'> {
  '@type': 'Entity';
  name?: string;
  url?: string;
}

export type EntityAndChildren = Entity;

const EntityProperties = {
  ...BaseProperties,
  name: z.lazy(() => z.string()).optional(),
  url: z.lazy(() => z.string().url()).optional(),
};

export const EntitySchema: z.ZodType<Entity> = z
  .object({
    '@type': z.literal('Entity'),
    ...EntityProperties,
  })
  .superRefine(requireNodeIdentity);

export const EntityAndChildrenSchema = EntitySchema;

export const ActionAndChildrenSchema = ActionSchema;

export const BaseAndChildrenSchema: z.ZodType<BaseAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Base'),
      ...BaseProperties,
    }),

    z.object({
      '@type': z.literal('Entity'),
      ...EntityProperties,
    }),

    z.object({
      '@type': z.literal('Action'),
      ...ActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
