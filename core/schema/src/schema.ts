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
  source?: string;
  sourceId?: string;
  '@key'?: KeyField[];
  '@id'?: string;
}

export type BaseAndChildren = Base | ActionAndChildren | EntityAndChildren;

const BaseProperties = {
  source: z.lazy(() => z.string()).optional(),
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
  agent?: AgentAndChildren;
  object?: EntityAndChildren;
  timestamp?: Date;
}

export type ActionAndChildren =
  | Action
  | CancelActionAndChildren
  | CompleteActionAndChildren
  | DeleteActionAndChildren
  | PlanActionAndChildren
  | UpdateActionAndChildren;

const ActionProperties = {
  ...BaseProperties,
  agent: z.lazy(() => AgentAndChildrenSchema).optional(),
  object: z.lazy(() => EntityAndChildrenSchema).optional(),
  timestamp: z.lazy(() => z.coerce.date()).optional(),
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
  about?: EntityAndChildren[];
  description?: string;
  handle?: string;
  isPartOf?: EntityAndChildren[];
  name?: string;
  sameAs?: (EntityAndChildren | string)[];
  url?: string;
}

export type EntityAndChildren =
  Entity | AgentAndChildren | CollectionAndChildren | TagAndChildren | TaskAndChildren;

const EntityProperties = {
  ...BaseProperties,
  about: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  description: z.lazy(() => z.string()).optional(),
  handle: z.lazy(() => z.string()).optional(),
  isPartOf: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  name: z.lazy(() => z.string()).optional(),
  sameAs: z.lazy(() => z.array(z.union([EntityAndChildrenSchema, z.string()]))).optional(),
  url: z.lazy(() => z.string().url()).optional(),
};

export const EntitySchema: z.ZodType<Entity> = z
  .object({
    '@type': z.literal('Entity'),
    ...EntityProperties,
  })
  .superRefine(requireNodeIdentity);

// Agent, child of https://schema.chronicle.app/Entity
export interface Agent extends Omit<Entity, '@type'> {
  '@type': 'Agent';
}

export type AgentAndChildren = Agent;

const AgentProperties = {
  ...EntityProperties,
};

export const AgentSchema: z.ZodType<Agent> = z
  .object({
    '@type': z.literal('Agent'),
    ...AgentProperties,
  })
  .superRefine(requireNodeIdentity);

// CancelAction, child of https://schema.chronicle.app/Action
export interface CancelAction extends Omit<Action, '@type'> {
  '@type': 'CancelAction';
}

export type CancelActionAndChildren = CancelAction;

const CancelActionProperties = {
  ...ActionProperties,
};

export const CancelActionSchema: z.ZodType<CancelAction> = z
  .object({
    '@type': z.literal('CancelAction'),
    ...CancelActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Collection, child of https://schema.chronicle.app/Entity
export interface Collection extends Omit<Entity, '@type'> {
  '@type': 'Collection';
}

export type CollectionAndChildren = Collection | ProjectAndChildren;

const CollectionProperties = {
  ...EntityProperties,
};

export const CollectionSchema: z.ZodType<Collection> = z
  .object({
    '@type': z.literal('Collection'),
    ...CollectionProperties,
  })
  .superRefine(requireNodeIdentity);

// CompleteAction, child of https://schema.chronicle.app/Action
export interface CompleteAction extends Omit<Action, '@type'> {
  '@type': 'CompleteAction';
}

export type CompleteActionAndChildren = CompleteAction;

const CompleteActionProperties = {
  ...ActionProperties,
};

export const CompleteActionSchema: z.ZodType<CompleteAction> = z
  .object({
    '@type': z.literal('CompleteAction'),
    ...CompleteActionProperties,
  })
  .superRefine(requireNodeIdentity);

// DeleteAction, child of https://schema.chronicle.app/Action
export interface DeleteAction extends Omit<Action, '@type'> {
  '@type': 'DeleteAction';
}

export type DeleteActionAndChildren = DeleteAction;

const DeleteActionProperties = {
  ...ActionProperties,
};

export const DeleteActionSchema: z.ZodType<DeleteAction> = z
  .object({
    '@type': z.literal('DeleteAction'),
    ...DeleteActionProperties,
  })
  .superRefine(requireNodeIdentity);

// PlanAction, child of https://schema.chronicle.app/Action
export interface PlanAction extends Omit<Action, '@type'> {
  '@type': 'PlanAction';
}

export type PlanActionAndChildren = PlanAction;

const PlanActionProperties = {
  ...ActionProperties,
};

export const PlanActionSchema: z.ZodType<PlanAction> = z
  .object({
    '@type': z.literal('PlanAction'),
    ...PlanActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Project, child of https://schema.chronicle.app/Collection
export interface Project extends Omit<Collection, '@type'> {
  '@type': 'Project';
}

export type ProjectAndChildren = Project;

const ProjectProperties = {
  ...CollectionProperties,
};

export const ProjectSchema: z.ZodType<Project> = z
  .object({
    '@type': z.literal('Project'),
    ...ProjectProperties,
  })
  .superRefine(requireNodeIdentity);

// Tag, child of https://schema.chronicle.app/Entity
export interface Tag extends Omit<Entity, '@type'> {
  '@type': 'Tag';
}

export type TagAndChildren = Tag;

const TagProperties = {
  ...EntityProperties,
};

export const TagSchema: z.ZodType<Tag> = z
  .object({
    '@type': z.literal('Tag'),
    ...TagProperties,
  })
  .superRefine(requireNodeIdentity);

// Task, child of https://schema.chronicle.app/Entity
export interface Task extends Omit<Entity, '@type'> {
  '@type': 'Task';
}

export type TaskAndChildren = Task;

const TaskProperties = {
  ...EntityProperties,
};

export const TaskSchema: z.ZodType<Task> = z
  .object({
    '@type': z.literal('Task'),
    ...TaskProperties,
  })
  .superRefine(requireNodeIdentity);

// UpdateAction, child of https://schema.chronicle.app/Action
export interface UpdateAction extends Omit<Action, '@type'> {
  '@type': 'UpdateAction';
}

export type UpdateActionAndChildren = UpdateAction;

const UpdateActionProperties = {
  ...ActionProperties,
};

export const UpdateActionSchema: z.ZodType<UpdateAction> = z
  .object({
    '@type': z.literal('UpdateAction'),
    ...UpdateActionProperties,
  })
  .superRefine(requireNodeIdentity);

export const UpdateActionAndChildrenSchema = UpdateActionSchema;

export const TaskAndChildrenSchema = TaskSchema;

export const TagAndChildrenSchema = TagSchema;

export const ProjectAndChildrenSchema = ProjectSchema;

export const PlanActionAndChildrenSchema = PlanActionSchema;

export const DeleteActionAndChildrenSchema = DeleteActionSchema;

export const CompleteActionAndChildrenSchema = CompleteActionSchema;

export const CollectionAndChildrenSchema: z.ZodType<CollectionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Collection'),
      ...CollectionProperties,
    }),

    z.object({
      '@type': z.literal('Project'),
      ...ProjectProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const CancelActionAndChildrenSchema = CancelActionSchema;

export const AgentAndChildrenSchema = AgentSchema;

export const EntityAndChildrenSchema: z.ZodType<EntityAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Entity'),
      ...EntityProperties,
    }),

    z.object({
      '@type': z.literal('Task'),
      ...TaskProperties,
    }),

    z.object({
      '@type': z.literal('Tag'),
      ...TagProperties,
    }),

    z.object({
      '@type': z.literal('Collection'),
      ...CollectionProperties,
    }),

    z.object({
      '@type': z.literal('Project'),
      ...ProjectProperties,
    }),

    z.object({
      '@type': z.literal('Agent'),
      ...AgentProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const ActionAndChildrenSchema: z.ZodType<ActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Action'),
      ...ActionProperties,
    }),

    z.object({
      '@type': z.literal('UpdateAction'),
      ...UpdateActionProperties,
    }),

    z.object({
      '@type': z.literal('PlanAction'),
      ...PlanActionProperties,
    }),

    z.object({
      '@type': z.literal('DeleteAction'),
      ...DeleteActionProperties,
    }),

    z.object({
      '@type': z.literal('CompleteAction'),
      ...CompleteActionProperties,
    }),

    z.object({
      '@type': z.literal('CancelAction'),
      ...CancelActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
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
      '@type': z.literal('Task'),
      ...TaskProperties,
    }),

    z.object({
      '@type': z.literal('Tag'),
      ...TagProperties,
    }),

    z.object({
      '@type': z.literal('Collection'),
      ...CollectionProperties,
    }),

    z.object({
      '@type': z.literal('Project'),
      ...ProjectProperties,
    }),

    z.object({
      '@type': z.literal('Agent'),
      ...AgentProperties,
    }),

    z.object({
      '@type': z.literal('Action'),
      ...ActionProperties,
    }),

    z.object({
      '@type': z.literal('UpdateAction'),
      ...UpdateActionProperties,
    }),

    z.object({
      '@type': z.literal('PlanAction'),
      ...PlanActionProperties,
    }),

    z.object({
      '@type': z.literal('DeleteAction'),
      ...DeleteActionProperties,
    }),

    z.object({
      '@type': z.literal('CompleteAction'),
      ...CompleteActionProperties,
    }),

    z.object({
      '@type': z.literal('CancelAction'),
      ...CancelActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
