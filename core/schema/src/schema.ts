export const SCHEMA_VERSION = '0.1.0' as const;
// Generated from chronicle.ttl. Do not edit; run npm run schema:generate.
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
  endTime?: Date;
  instrument?: EntityAndChildren;
  location?: LocationAndChildren | PlaceAndChildren;
  object?: EntityAndChildren;
  result?: EntityAndChildren;
  startTime?: Date;
  timestamp?: Date;
}

export type ActionAndChildren =
  | Action
  | CancelActionAndChildren
  | CompleteActionAndChildren
  | ConsumeActionAndChildren
  | DeleteActionAndChildren
  | ExecuteActionAndChildren
  | MessageActionAndChildren
  | PlanActionAndChildren
  | TravelActionAndChildren
  | UpdateActionAndChildren
  | VisitActionAndChildren;

const ActionProperties = {
  ...BaseProperties,
  agent: z.lazy(() => AgentAndChildrenSchema).optional(),
  endTime: z.lazy(() => z.coerce.date()).optional(),
  instrument: z.lazy(() => EntityAndChildrenSchema).optional(),
  location: z.lazy(() => z.union([LocationAndChildrenSchema, PlaceAndChildrenSchema])).optional(),
  object: z.lazy(() => EntityAndChildrenSchema).optional(),
  result: z.lazy(() => EntityAndChildrenSchema).optional(),
  startTime: z.lazy(() => z.coerce.date()).optional(),
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
  body?: string;
  category?: string[];
  description?: string;
  handle?: string;
  inRealm?: RealmAndChildren;
  isPartOf?: EntityAndChildren[];
  location?: LocationAndChildren | PlaceAndChildren;
  name?: string;
  sameAs?: (EntityAndChildren | string)[];
  url?: string;
}

export type EntityAndChildren =
  | Entity
  | AgentAndChildren
  | CollectionAndChildren
  | CommandAndChildren
  | CreativeWorkAndChildren
  | JourneyAndChildren
  | MediaObjectAndChildren
  | MessageAndChildren
  | PlaceAndChildren
  | RealmAndChildren
  | SoftwareApplicationAndChildren
  | TagAndChildren
  | TaskAndChildren;

const EntityProperties = {
  ...BaseProperties,
  about: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  body: z.lazy(() => z.string()).optional(),
  category: z.lazy(() => z.array(z.string())).optional(),
  description: z.lazy(() => z.string()).optional(),
  handle: z.lazy(() => z.string()).optional(),
  inRealm: z.lazy(() => RealmAndChildrenSchema).optional(),
  isPartOf: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  location: z.lazy(() => z.union([LocationAndChildrenSchema, PlaceAndChildrenSchema])).optional(),
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
  memberOf?: EntityAndChildren[];
}

export type AgentAndChildren = Agent | PersonAndChildren | SoftwareAgentAndChildren;

const AgentProperties = {
  ...EntityProperties,
  memberOf: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
};

export const AgentSchema: z.ZodType<Agent> = z
  .object({
    '@type': z.literal('Agent'),
    ...AgentProperties,
  })
  .superRefine(requireNodeIdentity);

// MediaObject, child of https://schema.chronicle.app/Entity
export interface MediaObject extends Omit<Entity, '@type'> {
  '@type': 'MediaObject';
  contentPath?: string;
  mimeType?: string;
}

export type MediaObjectAndChildren =
  | MediaObject
  | AudioObjectAndChildren
  | DocumentObjectAndChildren
  | ImageObjectAndChildren
  | VideoObjectAndChildren;

const MediaObjectProperties = {
  ...EntityProperties,
  contentPath: z.lazy(() => z.string()).optional(),
  mimeType: z.lazy(() => z.string()).optional(),
};

export const MediaObjectSchema: z.ZodType<MediaObject> = z
  .object({
    '@type': z.literal('MediaObject'),
    ...MediaObjectProperties,
  })
  .superRefine(requireNodeIdentity);

// AudioObject, child of https://schema.chronicle.app/MediaObject
export interface AudioObject extends Omit<MediaObject, '@type'> {
  '@type': 'AudioObject';
}

export type AudioObjectAndChildren = AudioObject;

const AudioObjectProperties = {
  ...MediaObjectProperties,
};

export const AudioObjectSchema: z.ZodType<AudioObject> = z
  .object({
    '@type': z.literal('AudioObject'),
    ...AudioObjectProperties,
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

// CreativeWork, child of https://schema.chronicle.app/Entity
export interface CreativeWork extends Omit<Entity, '@type'> {
  '@type': 'CreativeWork';
}

export type CreativeWorkAndChildren = CreativeWork | ChannelAndChildren;

const CreativeWorkProperties = {
  ...EntityProperties,
};

export const CreativeWorkSchema: z.ZodType<CreativeWork> = z
  .object({
    '@type': z.literal('CreativeWork'),
    ...CreativeWorkProperties,
  })
  .superRefine(requireNodeIdentity);

// Channel, child of https://schema.chronicle.app/CreativeWork
export interface Channel extends Omit<CreativeWork, '@type'> {
  '@type': 'Channel';
  member?: (AgentAndChildren | PersonAndChildren)[];
}

export type ChannelAndChildren = Channel;

const ChannelProperties = {
  ...CreativeWorkProperties,
  member: z
    .lazy(() => z.array(z.union([AgentAndChildrenSchema, PersonAndChildrenSchema])))
    .optional(),
};

export const ChannelSchema: z.ZodType<Channel> = z
  .object({
    '@type': z.literal('Channel'),
    ...ChannelProperties,
  })
  .superRefine(requireNodeIdentity);

// Collection, child of https://schema.chronicle.app/Entity
export interface Collection extends Omit<Entity, '@type'> {
  '@type': 'Collection';
}

export type CollectionAndChildren = Collection | ProjectAndChildren | ThreadAndChildren;

const CollectionProperties = {
  ...EntityProperties,
};

export const CollectionSchema: z.ZodType<Collection> = z
  .object({
    '@type': z.literal('Collection'),
    ...CollectionProperties,
  })
  .superRefine(requireNodeIdentity);

// Command, child of https://schema.chronicle.app/Entity
export interface Command extends Omit<Entity, '@type'> {
  '@type': 'Command';
}

export type CommandAndChildren = Command;

const CommandProperties = {
  ...EntityProperties,
};

export const CommandSchema: z.ZodType<Command> = z
  .object({
    '@type': z.literal('Command'),
    ...CommandProperties,
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

// ConsumeAction, child of https://schema.chronicle.app/Action
export interface ConsumeAction extends Omit<Action, '@type'> {
  '@type': 'ConsumeAction';
}

export type ConsumeActionAndChildren = ConsumeAction | ViewActionAndChildren;

const ConsumeActionProperties = {
  ...ActionProperties,
};

export const ConsumeActionSchema: z.ZodType<ConsumeAction> = z
  .object({
    '@type': z.literal('ConsumeAction'),
    ...ConsumeActionProperties,
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

// DocumentObject, child of https://schema.chronicle.app/MediaObject
export interface DocumentObject extends Omit<MediaObject, '@type'> {
  '@type': 'DocumentObject';
}

export type DocumentObjectAndChildren = DocumentObject;

const DocumentObjectProperties = {
  ...MediaObjectProperties,
};

export const DocumentObjectSchema: z.ZodType<DocumentObject> = z
  .object({
    '@type': z.literal('DocumentObject'),
    ...DocumentObjectProperties,
  })
  .superRefine(requireNodeIdentity);

// ExecuteAction, child of https://schema.chronicle.app/Action
export interface ExecuteAction extends Omit<Action, '@type'> {
  '@type': 'ExecuteAction';
}

export type ExecuteActionAndChildren = ExecuteAction;

const ExecuteActionProperties = {
  ...ActionProperties,
};

export const ExecuteActionSchema: z.ZodType<ExecuteAction> = z
  .object({
    '@type': z.literal('ExecuteAction'),
    ...ExecuteActionProperties,
  })
  .superRefine(requireNodeIdentity);

// ImageObject, child of https://schema.chronicle.app/MediaObject
export interface ImageObject extends Omit<MediaObject, '@type'> {
  '@type': 'ImageObject';
}

export type ImageObjectAndChildren = ImageObject;

const ImageObjectProperties = {
  ...MediaObjectProperties,
};

export const ImageObjectSchema: z.ZodType<ImageObject> = z
  .object({
    '@type': z.literal('ImageObject'),
    ...ImageObjectProperties,
  })
  .superRefine(requireNodeIdentity);

// Journey, child of https://schema.chronicle.app/Entity
export interface Journey extends Omit<Entity, '@type'> {
  '@type': 'Journey';
  distance?: number;
  path?: string;
  travelMode?: string;
}

export type JourneyAndChildren = Journey;

const JourneyProperties = {
  ...EntityProperties,
  distance: z.lazy(() => z.number()).optional(),
  path: z.lazy(() => z.string()).optional(),
  travelMode: z.lazy(() => z.string()).optional(),
};

export const JourneySchema: z.ZodType<Journey> = z
  .object({
    '@type': z.literal('Journey'),
    ...JourneyProperties,
  })
  .superRefine(requireNodeIdentity);

// StructuredValue, child of
export interface StructuredValue {
  '@type': 'StructuredValue';
}

export type StructuredValueAndChildren = StructuredValue | LocationAndChildren;

const StructuredValueProperties = {};

export const StructuredValueSchema: z.ZodType<StructuredValue> = z.object({
  '@type': z.literal('StructuredValue'),
  ...StructuredValueProperties,
});

// Location, child of https://schema.chronicle.app/StructuredValue
export interface Location extends Omit<StructuredValue, '@type'> {
  '@type': 'Location';
  address?: string;
  latitude?: number;
  longitude?: number;
}

export type LocationAndChildren = Location;

const LocationProperties = {
  ...StructuredValueProperties,
  address: z.lazy(() => z.string()).optional(),
  latitude: z.lazy(() => z.number()).optional(),
  longitude: z.lazy(() => z.number()).optional(),
};

export const LocationSchema: z.ZodType<Location> = z.object({
  '@type': z.literal('Location'),
  ...LocationProperties,
});

// Message, child of https://schema.chronicle.app/Entity
export interface Message extends Omit<Entity, '@type'> {
  '@type': 'Message';
  author?: AgentAndChildren[];
  contains?: MediaObjectAndChildren[];
  inReplyTo?: MessageAndChildren[];
  recipient?: AgentAndChildren[];
}

export type MessageAndChildren = Message;

const MessageProperties = {
  ...EntityProperties,
  author: z.lazy(() => z.array(AgentAndChildrenSchema)).optional(),
  contains: z.lazy(() => z.array(MediaObjectAndChildrenSchema)).optional(),
  inReplyTo: z.lazy(() => z.array(MessageAndChildrenSchema)).optional(),
  recipient: z.lazy(() => z.array(AgentAndChildrenSchema)).optional(),
};

export const MessageSchema: z.ZodType<Message> = z
  .object({
    '@type': z.literal('Message'),
    ...MessageProperties,
  })
  .superRefine(requireNodeIdentity);

// MessageAction, child of https://schema.chronicle.app/Action
export interface MessageAction extends Omit<Action, '@type'> {
  '@type': 'MessageAction';
}

export type MessageActionAndChildren = MessageAction;

const MessageActionProperties = {
  ...ActionProperties,
};

export const MessageActionSchema: z.ZodType<MessageAction> = z
  .object({
    '@type': z.literal('MessageAction'),
    ...MessageActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Person, child of https://schema.chronicle.app/Agent
export interface Person extends Omit<Agent, '@type'> {
  '@type': 'Person';
}

export type PersonAndChildren = Person;

const PersonProperties = {
  ...AgentProperties,
};

export const PersonSchema: z.ZodType<Person> = z
  .object({
    '@type': z.literal('Person'),
    ...PersonProperties,
  })
  .superRefine(requireNodeIdentity);

// Place, child of https://schema.chronicle.app/Entity
export interface Place extends Omit<Entity, '@type'> {
  '@type': 'Place';
}

export type PlaceAndChildren = Place | VenueAndChildren;

const PlaceProperties = {
  ...EntityProperties,
};

export const PlaceSchema: z.ZodType<Place> = z
  .object({
    '@type': z.literal('Place'),
    ...PlaceProperties,
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

// Realm, child of https://schema.chronicle.app/Entity
export interface Realm extends Omit<Entity, '@type'> {
  '@type': 'Realm';
}

export type RealmAndChildren = Realm;

const RealmProperties = {
  ...EntityProperties,
};

export const RealmSchema: z.ZodType<Realm> = z
  .object({
    '@type': z.literal('Realm'),
    ...RealmProperties,
  })
  .superRefine(requireNodeIdentity);

// SoftwareAgent, child of https://schema.chronicle.app/Agent
export interface SoftwareAgent extends Omit<Agent, '@type'> {
  '@type': 'SoftwareAgent';
}

export type SoftwareAgentAndChildren = SoftwareAgent;

const SoftwareAgentProperties = {
  ...AgentProperties,
};

export const SoftwareAgentSchema: z.ZodType<SoftwareAgent> = z
  .object({
    '@type': z.literal('SoftwareAgent'),
    ...SoftwareAgentProperties,
  })
  .superRefine(requireNodeIdentity);

// SoftwareApplication, child of https://schema.chronicle.app/Entity
export interface SoftwareApplication extends Omit<Entity, '@type'> {
  '@type': 'SoftwareApplication';
}

export type SoftwareApplicationAndChildren = SoftwareApplication;

const SoftwareApplicationProperties = {
  ...EntityProperties,
};

export const SoftwareApplicationSchema: z.ZodType<SoftwareApplication> = z
  .object({
    '@type': z.literal('SoftwareApplication'),
    ...SoftwareApplicationProperties,
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

// Thread, child of https://schema.chronicle.app/Collection
export interface Thread extends Omit<Collection, '@type'> {
  '@type': 'Thread';
}

export type ThreadAndChildren = Thread;

const ThreadProperties = {
  ...CollectionProperties,
};

export const ThreadSchema: z.ZodType<Thread> = z
  .object({
    '@type': z.literal('Thread'),
    ...ThreadProperties,
  })
  .superRefine(requireNodeIdentity);

// TravelAction, child of https://schema.chronicle.app/Action
export interface TravelAction extends Omit<Action, '@type'> {
  '@type': 'TravelAction';
}

export type TravelActionAndChildren = TravelAction;

const TravelActionProperties = {
  ...ActionProperties,
};

export const TravelActionSchema: z.ZodType<TravelAction> = z
  .object({
    '@type': z.literal('TravelAction'),
    ...TravelActionProperties,
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

// Venue, child of https://schema.chronicle.app/Place
export interface Venue extends Omit<Place, '@type'> {
  '@type': 'Venue';
}

export type VenueAndChildren = Venue;

const VenueProperties = {
  ...PlaceProperties,
};

export const VenueSchema: z.ZodType<Venue> = z
  .object({
    '@type': z.literal('Venue'),
    ...VenueProperties,
  })
  .superRefine(requireNodeIdentity);

// VideoObject, child of https://schema.chronicle.app/MediaObject
export interface VideoObject extends Omit<MediaObject, '@type'> {
  '@type': 'VideoObject';
}

export type VideoObjectAndChildren = VideoObject;

const VideoObjectProperties = {
  ...MediaObjectProperties,
};

export const VideoObjectSchema: z.ZodType<VideoObject> = z
  .object({
    '@type': z.literal('VideoObject'),
    ...VideoObjectProperties,
  })
  .superRefine(requireNodeIdentity);

// ViewAction, child of https://schema.chronicle.app/ConsumeAction
export interface ViewAction extends Omit<ConsumeAction, '@type'> {
  '@type': 'ViewAction';
}

export type ViewActionAndChildren = ViewAction;

const ViewActionProperties = {
  ...ConsumeActionProperties,
};

export const ViewActionSchema: z.ZodType<ViewAction> = z
  .object({
    '@type': z.literal('ViewAction'),
    ...ViewActionProperties,
  })
  .superRefine(requireNodeIdentity);

// VisitAction, child of https://schema.chronicle.app/Action
export interface VisitAction extends Omit<Action, '@type'> {
  '@type': 'VisitAction';
}

export type VisitActionAndChildren = VisitAction;

const VisitActionProperties = {
  ...ActionProperties,
};

export const VisitActionSchema: z.ZodType<VisitAction> = z
  .object({
    '@type': z.literal('VisitAction'),
    ...VisitActionProperties,
  })
  .superRefine(requireNodeIdentity);

export const VisitActionAndChildrenSchema = VisitActionSchema;

export const ViewActionAndChildrenSchema = ViewActionSchema;

export const VideoObjectAndChildrenSchema = VideoObjectSchema;

export const VenueAndChildrenSchema = VenueSchema;

export const UpdateActionAndChildrenSchema = UpdateActionSchema;

export const TravelActionAndChildrenSchema = TravelActionSchema;

export const ThreadAndChildrenSchema = ThreadSchema;

export const TaskAndChildrenSchema = TaskSchema;

export const TagAndChildrenSchema = TagSchema;

export const SoftwareApplicationAndChildrenSchema = SoftwareApplicationSchema;

export const SoftwareAgentAndChildrenSchema = SoftwareAgentSchema;

export const RealmAndChildrenSchema = RealmSchema;

export const ProjectAndChildrenSchema = ProjectSchema;

export const PlanActionAndChildrenSchema = PlanActionSchema;

export const PlaceAndChildrenSchema: z.ZodType<PlaceAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Place'),
      ...PlaceProperties,
    }),

    z.object({
      '@type': z.literal('Venue'),
      ...VenueProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const PersonAndChildrenSchema = PersonSchema;

export const MessageActionAndChildrenSchema = MessageActionSchema;

export const MessageAndChildrenSchema = MessageSchema;

export const LocationAndChildrenSchema = LocationSchema;

export const StructuredValueAndChildrenSchema: z.ZodType<StructuredValueAndChildren> =
  z.discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('StructuredValue'),
      ...StructuredValueProperties,
    }),

    z.object({
      '@type': z.literal('Location'),
      ...LocationProperties,
    }),
  ]);
export const JourneyAndChildrenSchema = JourneySchema;

export const ImageObjectAndChildrenSchema = ImageObjectSchema;

export const ExecuteActionAndChildrenSchema = ExecuteActionSchema;

export const DocumentObjectAndChildrenSchema = DocumentObjectSchema;

export const DeleteActionAndChildrenSchema = DeleteActionSchema;

export const ConsumeActionAndChildrenSchema: z.ZodType<ConsumeActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('ConsumeAction'),
      ...ConsumeActionProperties,
    }),

    z.object({
      '@type': z.literal('ViewAction'),
      ...ViewActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const CompleteActionAndChildrenSchema = CompleteActionSchema;

export const CommandAndChildrenSchema = CommandSchema;

export const CollectionAndChildrenSchema: z.ZodType<CollectionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Collection'),
      ...CollectionProperties,
    }),

    z.object({
      '@type': z.literal('Thread'),
      ...ThreadProperties,
    }),

    z.object({
      '@type': z.literal('Project'),
      ...ProjectProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const ChannelAndChildrenSchema = ChannelSchema;

export const CreativeWorkAndChildrenSchema: z.ZodType<CreativeWorkAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('CreativeWork'),
      ...CreativeWorkProperties,
    }),

    z.object({
      '@type': z.literal('Channel'),
      ...ChannelProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const CancelActionAndChildrenSchema = CancelActionSchema;

export const AudioObjectAndChildrenSchema = AudioObjectSchema;

export const MediaObjectAndChildrenSchema: z.ZodType<MediaObjectAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('MediaObject'),
      ...MediaObjectProperties,
    }),

    z.object({
      '@type': z.literal('VideoObject'),
      ...VideoObjectProperties,
    }),

    z.object({
      '@type': z.literal('ImageObject'),
      ...ImageObjectProperties,
    }),

    z.object({
      '@type': z.literal('DocumentObject'),
      ...DocumentObjectProperties,
    }),

    z.object({
      '@type': z.literal('AudioObject'),
      ...AudioObjectProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const AgentAndChildrenSchema: z.ZodType<AgentAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Agent'),
      ...AgentProperties,
    }),

    z.object({
      '@type': z.literal('SoftwareAgent'),
      ...SoftwareAgentProperties,
    }),

    z.object({
      '@type': z.literal('Person'),
      ...PersonProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
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
      '@type': z.literal('SoftwareApplication'),
      ...SoftwareApplicationProperties,
    }),

    z.object({
      '@type': z.literal('Realm'),
      ...RealmProperties,
    }),

    z.object({
      '@type': z.literal('Place'),
      ...PlaceProperties,
    }),

    z.object({
      '@type': z.literal('Venue'),
      ...VenueProperties,
    }),

    z.object({
      '@type': z.literal('Message'),
      ...MessageProperties,
    }),

    z.object({
      '@type': z.literal('Journey'),
      ...JourneyProperties,
    }),

    z.object({
      '@type': z.literal('Command'),
      ...CommandProperties,
    }),

    z.object({
      '@type': z.literal('Collection'),
      ...CollectionProperties,
    }),

    z.object({
      '@type': z.literal('Thread'),
      ...ThreadProperties,
    }),

    z.object({
      '@type': z.literal('Project'),
      ...ProjectProperties,
    }),

    z.object({
      '@type': z.literal('CreativeWork'),
      ...CreativeWorkProperties,
    }),

    z.object({
      '@type': z.literal('Channel'),
      ...ChannelProperties,
    }),

    z.object({
      '@type': z.literal('MediaObject'),
      ...MediaObjectProperties,
    }),

    z.object({
      '@type': z.literal('VideoObject'),
      ...VideoObjectProperties,
    }),

    z.object({
      '@type': z.literal('ImageObject'),
      ...ImageObjectProperties,
    }),

    z.object({
      '@type': z.literal('DocumentObject'),
      ...DocumentObjectProperties,
    }),

    z.object({
      '@type': z.literal('AudioObject'),
      ...AudioObjectProperties,
    }),

    z.object({
      '@type': z.literal('Agent'),
      ...AgentProperties,
    }),

    z.object({
      '@type': z.literal('SoftwareAgent'),
      ...SoftwareAgentProperties,
    }),

    z.object({
      '@type': z.literal('Person'),
      ...PersonProperties,
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
      '@type': z.literal('VisitAction'),
      ...VisitActionProperties,
    }),

    z.object({
      '@type': z.literal('UpdateAction'),
      ...UpdateActionProperties,
    }),

    z.object({
      '@type': z.literal('TravelAction'),
      ...TravelActionProperties,
    }),

    z.object({
      '@type': z.literal('PlanAction'),
      ...PlanActionProperties,
    }),

    z.object({
      '@type': z.literal('MessageAction'),
      ...MessageActionProperties,
    }),

    z.object({
      '@type': z.literal('ExecuteAction'),
      ...ExecuteActionProperties,
    }),

    z.object({
      '@type': z.literal('DeleteAction'),
      ...DeleteActionProperties,
    }),

    z.object({
      '@type': z.literal('ConsumeAction'),
      ...ConsumeActionProperties,
    }),

    z.object({
      '@type': z.literal('ViewAction'),
      ...ViewActionProperties,
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
      '@type': z.literal('SoftwareApplication'),
      ...SoftwareApplicationProperties,
    }),

    z.object({
      '@type': z.literal('Realm'),
      ...RealmProperties,
    }),

    z.object({
      '@type': z.literal('Place'),
      ...PlaceProperties,
    }),

    z.object({
      '@type': z.literal('Venue'),
      ...VenueProperties,
    }),

    z.object({
      '@type': z.literal('Message'),
      ...MessageProperties,
    }),

    z.object({
      '@type': z.literal('Journey'),
      ...JourneyProperties,
    }),

    z.object({
      '@type': z.literal('Command'),
      ...CommandProperties,
    }),

    z.object({
      '@type': z.literal('Collection'),
      ...CollectionProperties,
    }),

    z.object({
      '@type': z.literal('Thread'),
      ...ThreadProperties,
    }),

    z.object({
      '@type': z.literal('Project'),
      ...ProjectProperties,
    }),

    z.object({
      '@type': z.literal('CreativeWork'),
      ...CreativeWorkProperties,
    }),

    z.object({
      '@type': z.literal('Channel'),
      ...ChannelProperties,
    }),

    z.object({
      '@type': z.literal('MediaObject'),
      ...MediaObjectProperties,
    }),

    z.object({
      '@type': z.literal('VideoObject'),
      ...VideoObjectProperties,
    }),

    z.object({
      '@type': z.literal('ImageObject'),
      ...ImageObjectProperties,
    }),

    z.object({
      '@type': z.literal('DocumentObject'),
      ...DocumentObjectProperties,
    }),

    z.object({
      '@type': z.literal('AudioObject'),
      ...AudioObjectProperties,
    }),

    z.object({
      '@type': z.literal('Agent'),
      ...AgentProperties,
    }),

    z.object({
      '@type': z.literal('SoftwareAgent'),
      ...SoftwareAgentProperties,
    }),

    z.object({
      '@type': z.literal('Person'),
      ...PersonProperties,
    }),

    z.object({
      '@type': z.literal('Action'),
      ...ActionProperties,
    }),

    z.object({
      '@type': z.literal('VisitAction'),
      ...VisitActionProperties,
    }),

    z.object({
      '@type': z.literal('UpdateAction'),
      ...UpdateActionProperties,
    }),

    z.object({
      '@type': z.literal('TravelAction'),
      ...TravelActionProperties,
    }),

    z.object({
      '@type': z.literal('PlanAction'),
      ...PlanActionProperties,
    }),

    z.object({
      '@type': z.literal('MessageAction'),
      ...MessageActionProperties,
    }),

    z.object({
      '@type': z.literal('ExecuteAction'),
      ...ExecuteActionProperties,
    }),

    z.object({
      '@type': z.literal('DeleteAction'),
      ...DeleteActionProperties,
    }),

    z.object({
      '@type': z.literal('ConsumeAction'),
      ...ConsumeActionProperties,
    }),

    z.object({
      '@type': z.literal('ViewAction'),
      ...ViewActionProperties,
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
