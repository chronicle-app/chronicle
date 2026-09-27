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
  '@asserts'?: string[];
  '@assertedAt'?: Date | string;
}

export type BaseAndChildren = Base | ActionAndChildren | EntityAndChildren;

const BaseProperties = {
  source: z.lazy(() => z.string()).optional(),
  sourceId: z.lazy(() => z.string()).optional(),
  '@key': z
    .array(z.union([z.string(), z.object({ key: z.string(), value: z.string() })]))
    .optional(),
  '@id': z.string().optional(),
  '@asserts': z.array(z.string()).optional(),
  '@assertedAt': z.union([z.coerce.date(), z.string()]).optional(),
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
  endTime?: Date | string;
  instrument?: EntityAndChildren;
  location?: LocationAndChildren | PlaceAndChildren;
  object?: EntityAndChildren;
  result?: EntityAndChildren;
  startTime?: Date | string;
  target?: EntityAndChildren;
  timestamp?: Date | string;
}

export type ActionAndChildren =
  | Action
  | AssessActionAndChildren
  | CancelActionAndChildren
  | CompleteActionAndChildren
  | ConsumeActionAndChildren
  | CreateActionAndChildren
  | DeleteActionAndChildren
  | ExecuteActionAndChildren
  | ExperienceActionAndChildren
  | FindActionAndChildren
  | InteractActionAndChildren
  | MessageActionAndChildren
  | OrganizeActionAndChildren
  | PlanActionAndChildren
  | TravelActionAndChildren
  | UpdateActionAndChildren
  | VisitActionAndChildren;

const ActionProperties = {
  ...BaseProperties,
  agent: z.lazy(() => AgentAndChildrenSchema).optional(),
  endTime: z.lazy(() => z.union([z.date(), z.string()])).optional(),
  instrument: z.lazy(() => EntityAndChildrenSchema).optional(),
  location: z.lazy(() => z.union([LocationAndChildrenSchema, PlaceAndChildrenSchema])).optional(),
  object: z.lazy(() => EntityAndChildrenSchema).optional(),
  result: z.lazy(() => EntityAndChildrenSchema).optional(),
  startTime: z.lazy(() => z.union([z.date(), z.string()])).optional(),
  target: z.lazy(() => EntityAndChildrenSchema).optional(),
  timestamp: z.lazy(() => z.union([z.date(), z.string()])).optional(),
};

export const ActionSchema: z.ZodType<Action> = z
  .object({
    '@type': z.literal('Action'),
    ...ActionProperties,
  })
  .superRefine(requireNodeIdentity);

// UpdateAction, child of https://schema.chronicle.app/Action
export interface UpdateAction extends Omit<Action, '@type'> {
  '@type': 'UpdateAction';
}

export type UpdateActionAndChildren = UpdateAction | AddActionAndChildren;

const UpdateActionProperties = {
  ...ActionProperties,
};

export const UpdateActionSchema: z.ZodType<UpdateAction> = z
  .object({
    '@type': z.literal('UpdateAction'),
    ...UpdateActionProperties,
  })
  .superRefine(requireNodeIdentity);

// AddAction, child of https://schema.chronicle.app/UpdateAction
export interface AddAction extends Omit<UpdateAction, '@type'> {
  '@type': 'AddAction';
}

export type AddActionAndChildren = AddAction;

const AddActionProperties = {
  ...UpdateActionProperties,
};

export const AddActionSchema: z.ZodType<AddAction> = z
  .object({
    '@type': z.literal('AddAction'),
    ...AddActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Entity, child of https://schema.chronicle.app/Base
export interface Entity extends Omit<Base, '@type'> {
  '@type': 'Entity';
  about?: EntityAndChildren[];
  body?: string;
  category?: string[];
  contains?: MediaObjectAndChildren[];
  description?: string;
  emblem?: ImageObjectAndChildren;
  handle?: string;
  inRealm?: RealmAndChildren;
  isPartOf?: EntityAndChildren[];
  location?: LocationAndChildren | PlaceAndChildren;
  name?: string;
  notes?: string;
  references?: EntityAndChildren[];
  sameAs?: (EntityAndChildren | string)[];
  tags?: string[];
  url?: string;
}

export type EntityAndChildren =
  | Entity
  | AgentAndChildren
  | CommandAndChildren
  | CreativeWorkAndChildren
  | EventAndChildren
  | IntangibleAndChildren
  | JourneyAndChildren
  | MealAndChildren
  | PhysicalObjectAndChildren
  | PlaceAndChildren
  | RealmAndChildren
  | SessionAndChildren
  | TagAndChildren
  | TaskAndChildren;

const EntityProperties = {
  ...BaseProperties,
  about: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  body: z.lazy(() => z.string()).optional(),
  category: z.lazy(() => z.array(z.string())).optional(),
  contains: z.lazy(() => z.array(MediaObjectAndChildrenSchema)).optional(),
  description: z.lazy(() => z.string()).optional(),
  emblem: z.lazy(() => ImageObjectAndChildrenSchema).optional(),
  handle: z.lazy(() => z.string()).optional(),
  inRealm: z.lazy(() => RealmAndChildrenSchema).optional(),
  isPartOf: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  location: z.lazy(() => z.union([LocationAndChildrenSchema, PlaceAndChildrenSchema])).optional(),
  name: z.lazy(() => z.string()).optional(),
  notes: z.lazy(() => z.string()).optional(),
  references: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  sameAs: z.lazy(() => z.array(z.union([EntityAndChildrenSchema, z.string()]))).optional(),
  tags: z.lazy(() => z.array(z.string())).optional(),
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

export type AgentAndChildren =
  Agent | OrganizationAndChildren | PersonAndChildren | SoftwareAgentAndChildren;

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

// CreateAction, child of https://schema.chronicle.app/Action
export interface CreateAction extends Omit<Action, '@type'> {
  '@type': 'CreateAction';
}

export type CreateActionAndChildren =
  CreateAction | AnnotateActionAndChildren | PublishActionAndChildren | QuoteActionAndChildren;

const CreateActionProperties = {
  ...ActionProperties,
};

export const CreateActionSchema: z.ZodType<CreateAction> = z
  .object({
    '@type': z.literal('CreateAction'),
    ...CreateActionProperties,
  })
  .superRefine(requireNodeIdentity);

// AnnotateAction, child of https://schema.chronicle.app/CreateAction
export interface AnnotateAction extends Omit<CreateAction, '@type'> {
  '@type': 'AnnotateAction';
}

export type AnnotateActionAndChildren = AnnotateAction;

const AnnotateActionProperties = {
  ...CreateActionProperties,
};

export const AnnotateActionSchema: z.ZodType<AnnotateAction> = z
  .object({
    '@type': z.literal('AnnotateAction'),
    ...AnnotateActionProperties,
  })
  .superRefine(requireNodeIdentity);

// CreativeWork, child of https://schema.chronicle.app/Entity
export interface CreativeWork extends Omit<Entity, '@type'> {
  '@type': 'CreativeWork';
  author?: AgentAndChildren[];
  creator?: AgentAndChildren[];
  datePublished?: Date | string;
  genre?: string[];
  publisher?: OrganizationAndChildren[];
  references?: EntityAndChildren[];
  sourceFormat?: string;
  visibility?: string;
}

export type CreativeWorkAndChildren =
  | CreativeWork
  | ArticleAndChildren
  | BookAndChildren
  | ChannelAndChildren
  | CollectionAndChildren
  | MediaObjectAndChildren
  | MessageAndChildren
  | MusicAlbumAndChildren
  | MusicRecordingAndChildren
  | PodcastEpisodeAndChildren
  | PostAndChildren
  | QueryAndChildren
  | QuotationAndChildren
  | ResponseAndChildren
  | SoftwareApplicationAndChildren;

const CreativeWorkProperties = {
  ...EntityProperties,
  author: z.lazy(() => z.array(AgentAndChildrenSchema)).optional(),
  creator: z.lazy(() => z.array(AgentAndChildrenSchema)).optional(),
  datePublished: z.lazy(() => z.union([z.date(), z.string()])).optional(),
  genre: z.lazy(() => z.array(z.string())).optional(),
  publisher: z.lazy(() => z.array(OrganizationAndChildrenSchema)).optional(),
  references: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  sourceFormat: z.lazy(() => z.string()).optional(),
  visibility: z.lazy(() => z.string()).optional(),
};

export const CreativeWorkSchema: z.ZodType<CreativeWork> = z
  .object({
    '@type': z.literal('CreativeWork'),
    ...CreativeWorkProperties,
  })
  .superRefine(requireNodeIdentity);

// Article, child of https://schema.chronicle.app/CreativeWork
export interface Article extends Omit<CreativeWork, '@type'> {
  '@type': 'Article';
}

export type ArticleAndChildren = Article;

const ArticleProperties = {
  ...CreativeWorkProperties,
};

export const ArticleSchema: z.ZodType<Article> = z
  .object({
    '@type': z.literal('Article'),
    ...ArticleProperties,
  })
  .superRefine(requireNodeIdentity);

// AssessAction, child of https://schema.chronicle.app/Action
export interface AssessAction extends Omit<Action, '@type'> {
  '@type': 'AssessAction';
}

export type AssessActionAndChildren =
  AssessAction | ReactActionAndChildren | RespondActionAndChildren;

const AssessActionProperties = {
  ...ActionProperties,
};

export const AssessActionSchema: z.ZodType<AssessAction> = z
  .object({
    '@type': z.literal('AssessAction'),
    ...AssessActionProperties,
  })
  .superRefine(requireNodeIdentity);

// MediaObject, child of https://schema.chronicle.app/CreativeWork
export interface MediaObject extends Omit<CreativeWork, '@type'> {
  '@type': 'MediaObject';
  contentPath?: string;
  mimeType?: string;
  snapshotOf?: EntityAndChildren[];
}

export type MediaObjectAndChildren =
  | MediaObject
  | AudioObjectAndChildren
  | DocumentObjectAndChildren
  | ImageObjectAndChildren
  | VideoObjectAndChildren;

const MediaObjectProperties = {
  ...CreativeWorkProperties,
  contentPath: z.lazy(() => z.string()).optional(),
  mimeType: z.lazy(() => z.string()).optional(),
  snapshotOf: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
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
  artist?: MusicGroupAndChildren[];
  duration?: string;
  genre?: string[];
}

export type AudioObjectAndChildren = AudioObject;

const AudioObjectProperties = {
  ...MediaObjectProperties,
  artist: z.lazy(() => z.array(MusicGroupAndChildrenSchema)).optional(),
  duration: z.lazy(() => z.string()).optional(),
  genre: z.lazy(() => z.array(z.string())).optional(),
};

export const AudioObjectSchema: z.ZodType<AudioObject> = z
  .object({
    '@type': z.literal('AudioObject'),
    ...AudioObjectProperties,
  })
  .superRefine(requireNodeIdentity);

// Book, child of https://schema.chronicle.app/CreativeWork
export interface Book extends Omit<CreativeWork, '@type'> {
  '@type': 'Book';
  pageCount?: number;
}

export type BookAndChildren = Book;

const BookProperties = {
  ...CreativeWorkProperties,
  pageCount: z.lazy(() => z.number()).optional(),
};

export const BookSchema: z.ZodType<Book> = z
  .object({
    '@type': z.literal('Book'),
    ...BookProperties,
  })
  .superRefine(requireNodeIdentity);

// OrganizeAction, child of https://schema.chronicle.app/Action
export interface OrganizeAction extends Omit<Action, '@type'> {
  '@type': 'OrganizeAction';
}

export type OrganizeActionAndChildren = OrganizeAction | BookmarkActionAndChildren;

const OrganizeActionProperties = {
  ...ActionProperties,
};

export const OrganizeActionSchema: z.ZodType<OrganizeAction> = z
  .object({
    '@type': z.literal('OrganizeAction'),
    ...OrganizeActionProperties,
  })
  .superRefine(requireNodeIdentity);

// BookmarkAction, child of https://schema.chronicle.app/OrganizeAction
export interface BookmarkAction extends Omit<OrganizeAction, '@type'> {
  '@type': 'BookmarkAction';
}

export type BookmarkActionAndChildren = BookmarkAction;

const BookmarkActionProperties = {
  ...OrganizeActionProperties,
};

export const BookmarkActionSchema: z.ZodType<BookmarkAction> = z
  .object({
    '@type': z.literal('BookmarkAction'),
    ...BookmarkActionProperties,
  })
  .superRefine(requireNodeIdentity);

// InteractAction, child of https://schema.chronicle.app/Action
export interface InteractAction extends Omit<Action, '@type'> {
  '@type': 'InteractAction';
}

export type InteractActionAndChildren =
  InteractAction | CommunicateActionAndChildren | FollowActionAndChildren;

const InteractActionProperties = {
  ...ActionProperties,
};

export const InteractActionSchema: z.ZodType<InteractAction> = z
  .object({
    '@type': z.literal('InteractAction'),
    ...InteractActionProperties,
  })
  .superRefine(requireNodeIdentity);

// CommunicateAction, child of https://schema.chronicle.app/InteractAction
export interface CommunicateAction extends Omit<InteractAction, '@type'> {
  '@type': 'CommunicateAction';
}

export type CommunicateActionAndChildren =
  CommunicateAction | CallActionAndChildren | CheckInActionAndChildren;

const CommunicateActionProperties = {
  ...InteractActionProperties,
};

export const CommunicateActionSchema: z.ZodType<CommunicateAction> = z
  .object({
    '@type': z.literal('CommunicateAction'),
    ...CommunicateActionProperties,
  })
  .superRefine(requireNodeIdentity);

// CallAction, child of https://schema.chronicle.app/CommunicateAction
export interface CallAction extends Omit<CommunicateAction, '@type'> {
  '@type': 'CallAction';
}

export type CallActionAndChildren = CallAction;

const CallActionProperties = {
  ...CommunicateActionProperties,
};

export const CallActionSchema: z.ZodType<CallAction> = z
  .object({
    '@type': z.literal('CallAction'),
    ...CallActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Session, child of https://schema.chronicle.app/Entity
export interface Session extends Omit<Entity, '@type'> {
  '@type': 'Session';
  notes?: string;
  references?: EntityAndChildren[];
  subject?: EntityAndChildren[];
  workingDirectory?: DirectoryAndChildren;
}

export type SessionAndChildren =
  | Session
  | CallSessionAndChildren
  | DeviceSessionAndChildren
  | EnrollmentAndChildren
  | MembershipAndChildren
  | RelationshipAndChildren
  | TenureAndChildren;

const SessionProperties = {
  ...EntityProperties,
  notes: z.lazy(() => z.string()).optional(),
  references: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  subject: z.lazy(() => z.array(EntityAndChildrenSchema)).optional(),
  workingDirectory: z.lazy(() => DirectoryAndChildrenSchema).optional(),
};

export const SessionSchema: z.ZodType<Session> = z
  .object({
    '@type': z.literal('Session'),
    ...SessionProperties,
  })
  .superRefine(requireNodeIdentity);

// CallSession, child of https://schema.chronicle.app/Session
export interface CallSession extends Omit<Session, '@type'> {
  '@type': 'CallSession';
  recipient?: AgentAndChildren[];
}

export type CallSessionAndChildren = CallSession;

const CallSessionProperties = {
  ...SessionProperties,
  recipient: z.lazy(() => z.array(AgentAndChildrenSchema)).optional(),
};

export const CallSessionSchema: z.ZodType<CallSession> = z
  .object({
    '@type': z.literal('CallSession'),
    ...CallSessionProperties,
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

// Intangible, child of https://schema.chronicle.app/Entity
export interface Intangible extends Omit<Entity, '@type'> {
  '@type': 'Intangible';
}

export type IntangibleAndChildren = Intangible | DefinedTermAndChildren | SelectorAndChildren;

const IntangibleProperties = {
  ...EntityProperties,
};

export const IntangibleSchema: z.ZodType<Intangible> = z
  .object({
    '@type': z.literal('Intangible'),
    ...IntangibleProperties,
  })
  .superRefine(requireNodeIdentity);

// DefinedTerm, child of https://schema.chronicle.app/Intangible
export interface DefinedTerm extends Omit<Intangible, '@type'> {
  '@type': 'DefinedTerm';
}

export type DefinedTermAndChildren = DefinedTerm | CategoryAndChildren;

const DefinedTermProperties = {
  ...IntangibleProperties,
};

export const DefinedTermSchema: z.ZodType<DefinedTerm> = z
  .object({
    '@type': z.literal('DefinedTerm'),
    ...DefinedTermProperties,
  })
  .superRefine(requireNodeIdentity);

// Category, child of https://schema.chronicle.app/DefinedTerm
export interface Category extends Omit<DefinedTerm, '@type'> {
  '@type': 'Category';
  color?: string;
}

export type CategoryAndChildren = Category;

const CategoryProperties = {
  ...DefinedTermProperties,
  color: z.lazy(() => z.string()).optional(),
};

export const CategorySchema: z.ZodType<Category> = z
  .object({
    '@type': z.literal('Category'),
    ...CategoryProperties,
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

// CheckInAction, child of https://schema.chronicle.app/CommunicateAction
export interface CheckInAction extends Omit<CommunicateAction, '@type'> {
  '@type': 'CheckInAction';
}

export type CheckInActionAndChildren = CheckInAction;

const CheckInActionProperties = {
  ...CommunicateActionProperties,
};

export const CheckInActionSchema: z.ZodType<CheckInAction> = z
  .object({
    '@type': z.literal('CheckInAction'),
    ...CheckInActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Collection, child of https://schema.chronicle.app/CreativeWork
export interface Collection extends Omit<CreativeWork, '@type'> {
  '@type': 'Collection';
}

export type CollectionAndChildren =
  Collection | DirectoryAndChildren | ProjectAndChildren | ThreadAndChildren;

const CollectionProperties = {
  ...CreativeWorkProperties,
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

// Response, child of https://schema.chronicle.app/CreativeWork
export interface Response extends Omit<CreativeWork, '@type'> {
  '@type': 'Response';
}

export type ResponseAndChildren = Response | CommentAndChildren;

const ResponseProperties = {
  ...CreativeWorkProperties,
};

export const ResponseSchema: z.ZodType<Response> = z
  .object({
    '@type': z.literal('Response'),
    ...ResponseProperties,
  })
  .superRefine(requireNodeIdentity);

// Comment, child of https://schema.chronicle.app/Response
export interface Comment extends Omit<Response, '@type'> {
  '@type': 'Comment';
}

export type CommentAndChildren = Comment;

const CommentProperties = {
  ...ResponseProperties,
};

export const CommentSchema: z.ZodType<Comment> = z
  .object({
    '@type': z.literal('Comment'),
    ...CommentProperties,
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

export type ConsumeActionAndChildren =
  | ConsumeAction
  | DrankActionAndChildren
  | EatActionAndChildren
  | ListenActionAndChildren
  | ReadActionAndChildren
  | ViewActionAndChildren
  | WatchActionAndChildren;

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

// PhysicalObject, child of https://schema.chronicle.app/Entity
export interface PhysicalObject extends Omit<Entity, '@type'> {
  '@type': 'PhysicalObject';
  model?: string;
}

export type PhysicalObjectAndChildren = PhysicalObject | DeviceAndChildren;

const PhysicalObjectProperties = {
  ...EntityProperties,
  model: z.lazy(() => z.string()).optional(),
};

export const PhysicalObjectSchema: z.ZodType<PhysicalObject> = z
  .object({
    '@type': z.literal('PhysicalObject'),
    ...PhysicalObjectProperties,
  })
  .superRefine(requireNodeIdentity);

// Device, child of https://schema.chronicle.app/PhysicalObject
export interface Device extends Omit<PhysicalObject, '@type'> {
  '@type': 'Device';
}

export type DeviceAndChildren = Device;

const DeviceProperties = {
  ...PhysicalObjectProperties,
};

export const DeviceSchema: z.ZodType<Device> = z
  .object({
    '@type': z.literal('Device'),
    ...DeviceProperties,
  })
  .superRefine(requireNodeIdentity);

// DeviceSession, child of https://schema.chronicle.app/Session
export interface DeviceSession extends Omit<Session, '@type'> {
  '@type': 'DeviceSession';
}

export type DeviceSessionAndChildren = DeviceSession;

const DeviceSessionProperties = {
  ...SessionProperties,
};

export const DeviceSessionSchema: z.ZodType<DeviceSession> = z
  .object({
    '@type': z.literal('DeviceSession'),
    ...DeviceSessionProperties,
  })
  .superRefine(requireNodeIdentity);

// Directory, child of https://schema.chronicle.app/Collection
export interface Directory extends Omit<Collection, '@type'> {
  '@type': 'Directory';
}

export type DirectoryAndChildren = Directory;

const DirectoryProperties = {
  ...CollectionProperties,
};

export const DirectorySchema: z.ZodType<Directory> = z
  .object({
    '@type': z.literal('Directory'),
    ...DirectoryProperties,
  })
  .superRefine(requireNodeIdentity);

// DocumentObject, child of https://schema.chronicle.app/MediaObject
export interface DocumentObject extends Omit<MediaObject, '@type'> {
  '@type': 'DocumentObject';
  pageCount?: number;
}

export type DocumentObjectAndChildren = DocumentObject;

const DocumentObjectProperties = {
  ...MediaObjectProperties,
  pageCount: z.lazy(() => z.number()).optional(),
};

export const DocumentObjectSchema: z.ZodType<DocumentObject> = z
  .object({
    '@type': z.literal('DocumentObject'),
    ...DocumentObjectProperties,
  })
  .superRefine(requireNodeIdentity);

// DrankAction, child of https://schema.chronicle.app/ConsumeAction
export interface DrankAction extends Omit<ConsumeAction, '@type'> {
  '@type': 'DrankAction';
}

export type DrankActionAndChildren = DrankAction;

const DrankActionProperties = {
  ...ConsumeActionProperties,
};

export const DrankActionSchema: z.ZodType<DrankAction> = z
  .object({
    '@type': z.literal('DrankAction'),
    ...DrankActionProperties,
  })
  .superRefine(requireNodeIdentity);

// EatAction, child of https://schema.chronicle.app/ConsumeAction
export interface EatAction extends Omit<ConsumeAction, '@type'> {
  '@type': 'EatAction';
}

export type EatActionAndChildren = EatAction;

const EatActionProperties = {
  ...ConsumeActionProperties,
};

export const EatActionSchema: z.ZodType<EatAction> = z
  .object({
    '@type': z.literal('EatAction'),
    ...EatActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Enrollment, child of https://schema.chronicle.app/Session
export interface Enrollment extends Omit<Session, '@type'> {
  '@type': 'Enrollment';
  degree?: string;
}

export type EnrollmentAndChildren = Enrollment;

const EnrollmentProperties = {
  ...SessionProperties,
  degree: z.lazy(() => z.string()).optional(),
};

export const EnrollmentSchema: z.ZodType<Enrollment> = z
  .object({
    '@type': z.literal('Enrollment'),
    ...EnrollmentProperties,
  })
  .superRefine(requireNodeIdentity);

// Selector, child of https://schema.chronicle.app/Intangible
export interface Selector extends Omit<Intangible, '@type'> {
  '@type': 'Selector';
  selectorLabel?: string;
  selectorValue?: string;
}

export type SelectorAndChildren = Selector | EpubCfiSelectorAndChildren | PageSelectorAndChildren;

const SelectorProperties = {
  ...IntangibleProperties,
  selectorLabel: z.lazy(() => z.string()).optional(),
  selectorValue: z.lazy(() => z.string()).optional(),
};

export const SelectorSchema: z.ZodType<Selector> = z
  .object({
    '@type': z.literal('Selector'),
    ...SelectorProperties,
  })
  .superRefine(requireNodeIdentity);

// EpubCfiSelector, child of https://schema.chronicle.app/Selector
export interface EpubCfiSelector extends Omit<Selector, '@type'> {
  '@type': 'EpubCfiSelector';
}

export type EpubCfiSelectorAndChildren = EpubCfiSelector;

const EpubCfiSelectorProperties = {
  ...SelectorProperties,
};

export const EpubCfiSelectorSchema: z.ZodType<EpubCfiSelector> = z
  .object({
    '@type': z.literal('EpubCfiSelector'),
    ...EpubCfiSelectorProperties,
  })
  .superRefine(requireNodeIdentity);

// Event, child of https://schema.chronicle.app/Entity
export interface Event extends Omit<Entity, '@type'> {
  '@type': 'Event';
  endTime?: Date | string;
  location?: LocationAndChildren | PlaceAndChildren;
  startTime?: Date | string;
}

export type EventAndChildren = Event;

const EventProperties = {
  ...EntityProperties,
  endTime: z.lazy(() => z.union([z.date(), z.string()])).optional(),
  location: z.lazy(() => z.union([LocationAndChildrenSchema, PlaceAndChildrenSchema])).optional(),
  startTime: z.lazy(() => z.union([z.date(), z.string()])).optional(),
};

export const EventSchema: z.ZodType<Event> = z
  .object({
    '@type': z.literal('Event'),
    ...EventProperties,
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

// ExperienceAction, child of https://schema.chronicle.app/Action
export interface ExperienceAction extends Omit<Action, '@type'> {
  '@type': 'ExperienceAction';
}

export type ExperienceActionAndChildren =
  ExperienceAction | JoinActionAndChildren | LeaveActionAndChildren;

const ExperienceActionProperties = {
  ...ActionProperties,
};

export const ExperienceActionSchema: z.ZodType<ExperienceAction> = z
  .object({
    '@type': z.literal('ExperienceAction'),
    ...ExperienceActionProperties,
  })
  .superRefine(requireNodeIdentity);

// FindAction, child of https://schema.chronicle.app/Action
export interface FindAction extends Omit<Action, '@type'> {
  '@type': 'FindAction';
}

export type FindActionAndChildren = FindAction;

const FindActionProperties = {
  ...ActionProperties,
};

export const FindActionSchema: z.ZodType<FindAction> = z
  .object({
    '@type': z.literal('FindAction'),
    ...FindActionProperties,
  })
  .superRefine(requireNodeIdentity);

// FollowAction, child of https://schema.chronicle.app/InteractAction
export interface FollowAction extends Omit<InteractAction, '@type'> {
  '@type': 'FollowAction';
}

export type FollowActionAndChildren = FollowAction;

const FollowActionProperties = {
  ...InteractActionProperties,
};

export const FollowActionSchema: z.ZodType<FollowAction> = z
  .object({
    '@type': z.literal('FollowAction'),
    ...FollowActionProperties,
  })
  .superRefine(requireNodeIdentity);

// ImageObject, child of https://schema.chronicle.app/MediaObject
export interface ImageObject extends Omit<MediaObject, '@type'> {
  '@type': 'ImageObject';
  caption?: string;
  height?: number;
  width?: number;
}

export type ImageObjectAndChildren = ImageObject;

const ImageObjectProperties = {
  ...MediaObjectProperties,
  caption: z.lazy(() => z.string()).optional(),
  height: z.lazy(() => z.number()).optional(),
  width: z.lazy(() => z.number()).optional(),
};

export const ImageObjectSchema: z.ZodType<ImageObject> = z
  .object({
    '@type': z.literal('ImageObject'),
    ...ImageObjectProperties,
  })
  .superRefine(requireNodeIdentity);

// StructuredValue, child of
export interface StructuredValue {
  '@type': 'StructuredValue';
}

export type StructuredValueAndChildren =
  StructuredValue | IntervalAndChildren | LocationAndChildren;

const StructuredValueProperties = {};

export const StructuredValueSchema: z.ZodType<StructuredValue> = z.object({
  '@type': z.literal('StructuredValue'),
  ...StructuredValueProperties,
});

// Interval, child of https://schema.chronicle.app/StructuredValue
export interface Interval extends Omit<StructuredValue, '@type'> {
  '@type': 'Interval';
  endTime?: Date | string;
  startTime?: Date | string;
}

export type IntervalAndChildren = Interval;

const IntervalProperties = {
  ...StructuredValueProperties,
  endTime: z.lazy(() => z.union([z.date(), z.string()])).optional(),
  startTime: z.lazy(() => z.union([z.date(), z.string()])).optional(),
};

export const IntervalSchema: z.ZodType<Interval> = z.object({
  '@type': z.literal('Interval'),
  ...IntervalProperties,
});

// JoinAction, child of https://schema.chronicle.app/ExperienceAction
export interface JoinAction extends Omit<ExperienceAction, '@type'> {
  '@type': 'JoinAction';
}

export type JoinActionAndChildren = JoinAction;

const JoinActionProperties = {
  ...ExperienceActionProperties,
};

export const JoinActionSchema: z.ZodType<JoinAction> = z
  .object({
    '@type': z.literal('JoinAction'),
    ...JoinActionProperties,
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

// LeaveAction, child of https://schema.chronicle.app/ExperienceAction
export interface LeaveAction extends Omit<ExperienceAction, '@type'> {
  '@type': 'LeaveAction';
}

export type LeaveActionAndChildren = LeaveAction;

const LeaveActionProperties = {
  ...ExperienceActionProperties,
};

export const LeaveActionSchema: z.ZodType<LeaveAction> = z
  .object({
    '@type': z.literal('LeaveAction'),
    ...LeaveActionProperties,
  })
  .superRefine(requireNodeIdentity);

// ReactAction, child of https://schema.chronicle.app/AssessAction
export interface ReactAction extends Omit<AssessAction, '@type'> {
  '@type': 'ReactAction';
}

export type ReactActionAndChildren = ReactAction | LikeActionAndChildren;

const ReactActionProperties = {
  ...AssessActionProperties,
};

export const ReactActionSchema: z.ZodType<ReactAction> = z
  .object({
    '@type': z.literal('ReactAction'),
    ...ReactActionProperties,
  })
  .superRefine(requireNodeIdentity);

// LikeAction, child of https://schema.chronicle.app/ReactAction
export interface LikeAction extends Omit<ReactAction, '@type'> {
  '@type': 'LikeAction';
}

export type LikeActionAndChildren = LikeAction;

const LikeActionProperties = {
  ...ReactActionProperties,
};

export const LikeActionSchema: z.ZodType<LikeAction> = z
  .object({
    '@type': z.literal('LikeAction'),
    ...LikeActionProperties,
  })
  .superRefine(requireNodeIdentity);

// ListenAction, child of https://schema.chronicle.app/ConsumeAction
export interface ListenAction extends Omit<ConsumeAction, '@type'> {
  '@type': 'ListenAction';
}

export type ListenActionAndChildren = ListenAction;

const ListenActionProperties = {
  ...ConsumeActionProperties,
};

export const ListenActionSchema: z.ZodType<ListenAction> = z
  .object({
    '@type': z.literal('ListenAction'),
    ...ListenActionProperties,
  })
  .superRefine(requireNodeIdentity);

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

// Meal, child of https://schema.chronicle.app/Entity
export interface Meal extends Omit<Entity, '@type'> {
  '@type': 'Meal';
}

export type MealAndChildren = Meal;

const MealProperties = {
  ...EntityProperties,
};

export const MealSchema: z.ZodType<Meal> = z
  .object({
    '@type': z.literal('Meal'),
    ...MealProperties,
  })
  .superRefine(requireNodeIdentity);

// Membership, child of https://schema.chronicle.app/Session
export interface Membership extends Omit<Session, '@type'> {
  '@type': 'Membership';
  role?: string;
}

export type MembershipAndChildren = Membership;

const MembershipProperties = {
  ...SessionProperties,
  role: z.lazy(() => z.string()).optional(),
};

export const MembershipSchema: z.ZodType<Membership> = z
  .object({
    '@type': z.literal('Membership'),
    ...MembershipProperties,
  })
  .superRefine(requireNodeIdentity);

// Message, child of https://schema.chronicle.app/CreativeWork
export interface Message extends Omit<CreativeWork, '@type'> {
  '@type': 'Message';
  author?: AgentAndChildren[];
  contains?: MediaObjectAndChildren[];
  inReplyTo?: MessageAndChildren[];
  recipient?: AgentAndChildren[];
}

export type MessageAndChildren = Message;

const MessageProperties = {
  ...CreativeWorkProperties,
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

// MusicAlbum, child of https://schema.chronicle.app/CreativeWork
export interface MusicAlbum extends Omit<CreativeWork, '@type'> {
  '@type': 'MusicAlbum';
  artist?: MusicGroupAndChildren[];
}

export type MusicAlbumAndChildren = MusicAlbum;

const MusicAlbumProperties = {
  ...CreativeWorkProperties,
  artist: z.lazy(() => z.array(MusicGroupAndChildrenSchema)).optional(),
};

export const MusicAlbumSchema: z.ZodType<MusicAlbum> = z
  .object({
    '@type': z.literal('MusicAlbum'),
    ...MusicAlbumProperties,
  })
  .superRefine(requireNodeIdentity);

// Organization, child of https://schema.chronicle.app/Agent
export interface Organization extends Omit<Agent, '@type'> {
  '@type': 'Organization';
  member?: (AgentAndChildren | PersonAndChildren)[];
}

export type OrganizationAndChildren = Organization | PerformingGroupAndChildren;

const OrganizationProperties = {
  ...AgentProperties,
  member: z
    .lazy(() => z.array(z.union([AgentAndChildrenSchema, PersonAndChildrenSchema])))
    .optional(),
};

export const OrganizationSchema: z.ZodType<Organization> = z
  .object({
    '@type': z.literal('Organization'),
    ...OrganizationProperties,
  })
  .superRefine(requireNodeIdentity);

// PerformingGroup, child of https://schema.chronicle.app/Organization
export interface PerformingGroup extends Omit<Organization, '@type'> {
  '@type': 'PerformingGroup';
}

export type PerformingGroupAndChildren = PerformingGroup | MusicGroupAndChildren;

const PerformingGroupProperties = {
  ...OrganizationProperties,
};

export const PerformingGroupSchema: z.ZodType<PerformingGroup> = z
  .object({
    '@type': z.literal('PerformingGroup'),
    ...PerformingGroupProperties,
  })
  .superRefine(requireNodeIdentity);

// MusicGroup, child of https://schema.chronicle.app/PerformingGroup
export interface MusicGroup extends Omit<PerformingGroup, '@type'> {
  '@type': 'MusicGroup';
}

export type MusicGroupAndChildren = MusicGroup;

const MusicGroupProperties = {
  ...PerformingGroupProperties,
};

export const MusicGroupSchema: z.ZodType<MusicGroup> = z
  .object({
    '@type': z.literal('MusicGroup'),
    ...MusicGroupProperties,
  })
  .superRefine(requireNodeIdentity);

// MusicRecording, child of https://schema.chronicle.app/CreativeWork
export interface MusicRecording extends Omit<CreativeWork, '@type'> {
  '@type': 'MusicRecording';
  artist?: MusicGroupAndChildren[];
  duration?: string;
  inAlbum?: MusicAlbumAndChildren;
}

export type MusicRecordingAndChildren = MusicRecording;

const MusicRecordingProperties = {
  ...CreativeWorkProperties,
  artist: z.lazy(() => z.array(MusicGroupAndChildrenSchema)).optional(),
  duration: z.lazy(() => z.string()).optional(),
  inAlbum: z.lazy(() => MusicAlbumAndChildrenSchema).optional(),
};

export const MusicRecordingSchema: z.ZodType<MusicRecording> = z
  .object({
    '@type': z.literal('MusicRecording'),
    ...MusicRecordingProperties,
  })
  .superRefine(requireNodeIdentity);

// PageSelector, child of https://schema.chronicle.app/Selector
export interface PageSelector extends Omit<Selector, '@type'> {
  '@type': 'PageSelector';
}

export type PageSelectorAndChildren = PageSelector;

const PageSelectorProperties = {
  ...SelectorProperties,
};

export const PageSelectorSchema: z.ZodType<PageSelector> = z
  .object({
    '@type': z.literal('PageSelector'),
    ...PageSelectorProperties,
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

// PodcastEpisode, child of https://schema.chronicle.app/CreativeWork
export interface PodcastEpisode extends Omit<CreativeWork, '@type'> {
  '@type': 'PodcastEpisode';
  duration?: string;
}

export type PodcastEpisodeAndChildren = PodcastEpisode;

const PodcastEpisodeProperties = {
  ...CreativeWorkProperties,
  duration: z.lazy(() => z.string()).optional(),
};

export const PodcastEpisodeSchema: z.ZodType<PodcastEpisode> = z
  .object({
    '@type': z.literal('PodcastEpisode'),
    ...PodcastEpisodeProperties,
  })
  .superRefine(requireNodeIdentity);

// Post, child of https://schema.chronicle.app/CreativeWork
export interface Post extends Omit<CreativeWork, '@type'> {
  '@type': 'Post';
}

export type PostAndChildren = Post;

const PostProperties = {
  ...CreativeWorkProperties,
};

export const PostSchema: z.ZodType<Post> = z
  .object({
    '@type': z.literal('Post'),
    ...PostProperties,
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

// PublishAction, child of https://schema.chronicle.app/CreateAction
export interface PublishAction extends Omit<CreateAction, '@type'> {
  '@type': 'PublishAction';
}

export type PublishActionAndChildren = PublishAction;

const PublishActionProperties = {
  ...CreateActionProperties,
};

export const PublishActionSchema: z.ZodType<PublishAction> = z
  .object({
    '@type': z.literal('PublishAction'),
    ...PublishActionProperties,
  })
  .superRefine(requireNodeIdentity);

// Query, child of https://schema.chronicle.app/CreativeWork
export interface Query extends Omit<CreativeWork, '@type'> {
  '@type': 'Query';
}

export type QueryAndChildren = Query;

const QueryProperties = {
  ...CreativeWorkProperties,
};

export const QuerySchema: z.ZodType<Query> = z
  .object({
    '@type': z.literal('Query'),
    ...QueryProperties,
  })
  .superRefine(requireNodeIdentity);

// Quotation, child of https://schema.chronicle.app/CreativeWork
export interface Quotation extends Omit<CreativeWork, '@type'> {
  '@type': 'Quotation';
  annotationStyle?: string;
  color?: string;
  selector?: SelectorAndChildren[];
}

export type QuotationAndChildren = Quotation;

const QuotationProperties = {
  ...CreativeWorkProperties,
  annotationStyle: z.lazy(() => z.string()).optional(),
  color: z.lazy(() => z.string()).optional(),
  selector: z.lazy(() => z.array(SelectorAndChildrenSchema)).optional(),
};

export const QuotationSchema: z.ZodType<Quotation> = z
  .object({
    '@type': z.literal('Quotation'),
    ...QuotationProperties,
  })
  .superRefine(requireNodeIdentity);

// QuoteAction, child of https://schema.chronicle.app/CreateAction
export interface QuoteAction extends Omit<CreateAction, '@type'> {
  '@type': 'QuoteAction';
}

export type QuoteActionAndChildren = QuoteAction;

const QuoteActionProperties = {
  ...CreateActionProperties,
};

export const QuoteActionSchema: z.ZodType<QuoteAction> = z
  .object({
    '@type': z.literal('QuoteAction'),
    ...QuoteActionProperties,
  })
  .superRefine(requireNodeIdentity);

// ReadAction, child of https://schema.chronicle.app/ConsumeAction
export interface ReadAction extends Omit<ConsumeAction, '@type'> {
  '@type': 'ReadAction';
}

export type ReadActionAndChildren = ReadAction;

const ReadActionProperties = {
  ...ConsumeActionProperties,
};

export const ReadActionSchema: z.ZodType<ReadAction> = z
  .object({
    '@type': z.literal('ReadAction'),
    ...ReadActionProperties,
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

// Relationship, child of https://schema.chronicle.app/Session
export interface Relationship extends Omit<Session, '@type'> {
  '@type': 'Relationship';
  role?: string;
}

export type RelationshipAndChildren = Relationship;

const RelationshipProperties = {
  ...SessionProperties,
  role: z.lazy(() => z.string()).optional(),
};

export const RelationshipSchema: z.ZodType<Relationship> = z
  .object({
    '@type': z.literal('Relationship'),
    ...RelationshipProperties,
  })
  .superRefine(requireNodeIdentity);

// RespondAction, child of https://schema.chronicle.app/AssessAction
export interface RespondAction extends Omit<AssessAction, '@type'> {
  '@type': 'RespondAction';
}

export type RespondActionAndChildren = RespondAction;

const RespondActionProperties = {
  ...AssessActionProperties,
};

export const RespondActionSchema: z.ZodType<RespondAction> = z
  .object({
    '@type': z.literal('RespondAction'),
    ...RespondActionProperties,
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

// SoftwareApplication, child of https://schema.chronicle.app/CreativeWork
export interface SoftwareApplication extends Omit<CreativeWork, '@type'> {
  '@type': 'SoftwareApplication';
}

export type SoftwareApplicationAndChildren = SoftwareApplication;

const SoftwareApplicationProperties = {
  ...CreativeWorkProperties,
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
  color?: string;
}

export type TagAndChildren = Tag;

const TagProperties = {
  ...EntityProperties,
  color: z.lazy(() => z.string()).optional(),
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

// Tenure, child of https://schema.chronicle.app/Session
export interface Tenure extends Omit<Session, '@type'> {
  '@type': 'Tenure';
  role?: string;
}

export type TenureAndChildren = Tenure;

const TenureProperties = {
  ...SessionProperties,
  role: z.lazy(() => z.string()).optional(),
};

export const TenureSchema: z.ZodType<Tenure> = z
  .object({
    '@type': z.literal('Tenure'),
    ...TenureProperties,
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
  duration?: string;
  height?: number;
  width?: number;
}

export type VideoObjectAndChildren = VideoObject;

const VideoObjectProperties = {
  ...MediaObjectProperties,
  duration: z.lazy(() => z.string()).optional(),
  height: z.lazy(() => z.number()).optional(),
  width: z.lazy(() => z.number()).optional(),
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

// WatchAction, child of https://schema.chronicle.app/ConsumeAction
export interface WatchAction extends Omit<ConsumeAction, '@type'> {
  '@type': 'WatchAction';
}

export type WatchActionAndChildren = WatchAction;

const WatchActionProperties = {
  ...ConsumeActionProperties,
};

export const WatchActionSchema: z.ZodType<WatchAction> = z
  .object({
    '@type': z.literal('WatchAction'),
    ...WatchActionProperties,
  })
  .superRefine(requireNodeIdentity);

export const WatchActionAndChildrenSchema = WatchActionSchema;

export const VisitActionAndChildrenSchema = VisitActionSchema;

export const ViewActionAndChildrenSchema = ViewActionSchema;

export const VideoObjectAndChildrenSchema = VideoObjectSchema;

export const VenueAndChildrenSchema = VenueSchema;

export const TravelActionAndChildrenSchema = TravelActionSchema;

export const ThreadAndChildrenSchema = ThreadSchema;

export const TenureAndChildrenSchema = TenureSchema;

export const TaskAndChildrenSchema = TaskSchema;

export const TagAndChildrenSchema = TagSchema;

export const SoftwareApplicationAndChildrenSchema = SoftwareApplicationSchema;

export const SoftwareAgentAndChildrenSchema = SoftwareAgentSchema;

export const RespondActionAndChildrenSchema = RespondActionSchema;

export const RelationshipAndChildrenSchema = RelationshipSchema;

export const RealmAndChildrenSchema = RealmSchema;

export const ReadActionAndChildrenSchema = ReadActionSchema;

export const QuoteActionAndChildrenSchema = QuoteActionSchema;

export const QuotationAndChildrenSchema = QuotationSchema;

export const QueryAndChildrenSchema = QuerySchema;

export const PublishActionAndChildrenSchema = PublishActionSchema;

export const ProjectAndChildrenSchema = ProjectSchema;

export const PostAndChildrenSchema = PostSchema;

export const PodcastEpisodeAndChildrenSchema = PodcastEpisodeSchema;

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

export const PageSelectorAndChildrenSchema = PageSelectorSchema;

export const MusicRecordingAndChildrenSchema = MusicRecordingSchema;

export const MusicGroupAndChildrenSchema = MusicGroupSchema;

export const PerformingGroupAndChildrenSchema: z.ZodType<PerformingGroupAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('PerformingGroup'),
      ...PerformingGroupProperties,
    }),

    z.object({
      '@type': z.literal('MusicGroup'),
      ...MusicGroupProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const OrganizationAndChildrenSchema: z.ZodType<OrganizationAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Organization'),
      ...OrganizationProperties,
    }),

    z.object({
      '@type': z.literal('PerformingGroup'),
      ...PerformingGroupProperties,
    }),

    z.object({
      '@type': z.literal('MusicGroup'),
      ...MusicGroupProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const MusicAlbumAndChildrenSchema = MusicAlbumSchema;

export const MessageActionAndChildrenSchema = MessageActionSchema;

export const MessageAndChildrenSchema = MessageSchema;

export const MembershipAndChildrenSchema = MembershipSchema;

export const MealAndChildrenSchema = MealSchema;

export const LocationAndChildrenSchema = LocationSchema;

export const ListenActionAndChildrenSchema = ListenActionSchema;

export const LikeActionAndChildrenSchema = LikeActionSchema;

export const ReactActionAndChildrenSchema: z.ZodType<ReactActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('ReactAction'),
      ...ReactActionProperties,
    }),

    z.object({
      '@type': z.literal('LikeAction'),
      ...LikeActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const LeaveActionAndChildrenSchema = LeaveActionSchema;

export const JourneyAndChildrenSchema = JourneySchema;

export const JoinActionAndChildrenSchema = JoinActionSchema;

export const IntervalAndChildrenSchema = IntervalSchema;

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

    z.object({
      '@type': z.literal('Interval'),
      ...IntervalProperties,
    }),
  ]);
export const ImageObjectAndChildrenSchema = ImageObjectSchema;

export const FollowActionAndChildrenSchema = FollowActionSchema;

export const FindActionAndChildrenSchema = FindActionSchema;

export const ExperienceActionAndChildrenSchema: z.ZodType<ExperienceActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('ExperienceAction'),
      ...ExperienceActionProperties,
    }),

    z.object({
      '@type': z.literal('LeaveAction'),
      ...LeaveActionProperties,
    }),

    z.object({
      '@type': z.literal('JoinAction'),
      ...JoinActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const ExecuteActionAndChildrenSchema = ExecuteActionSchema;

export const EventAndChildrenSchema = EventSchema;

export const EpubCfiSelectorAndChildrenSchema = EpubCfiSelectorSchema;

export const SelectorAndChildrenSchema: z.ZodType<SelectorAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Selector'),
      ...SelectorProperties,
    }),

    z.object({
      '@type': z.literal('PageSelector'),
      ...PageSelectorProperties,
    }),

    z.object({
      '@type': z.literal('EpubCfiSelector'),
      ...EpubCfiSelectorProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const EnrollmentAndChildrenSchema = EnrollmentSchema;

export const EatActionAndChildrenSchema = EatActionSchema;

export const DrankActionAndChildrenSchema = DrankActionSchema;

export const DocumentObjectAndChildrenSchema = DocumentObjectSchema;

export const DirectoryAndChildrenSchema = DirectorySchema;

export const DeviceSessionAndChildrenSchema = DeviceSessionSchema;

export const DeviceAndChildrenSchema = DeviceSchema;

export const PhysicalObjectAndChildrenSchema: z.ZodType<PhysicalObjectAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('PhysicalObject'),
      ...PhysicalObjectProperties,
    }),

    z.object({
      '@type': z.literal('Device'),
      ...DeviceProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const DeleteActionAndChildrenSchema = DeleteActionSchema;

export const ConsumeActionAndChildrenSchema: z.ZodType<ConsumeActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('ConsumeAction'),
      ...ConsumeActionProperties,
    }),

    z.object({
      '@type': z.literal('WatchAction'),
      ...WatchActionProperties,
    }),

    z.object({
      '@type': z.literal('ViewAction'),
      ...ViewActionProperties,
    }),

    z.object({
      '@type': z.literal('ReadAction'),
      ...ReadActionProperties,
    }),

    z.object({
      '@type': z.literal('ListenAction'),
      ...ListenActionProperties,
    }),

    z.object({
      '@type': z.literal('EatAction'),
      ...EatActionProperties,
    }),

    z.object({
      '@type': z.literal('DrankAction'),
      ...DrankActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const CompleteActionAndChildrenSchema = CompleteActionSchema;

export const CommentAndChildrenSchema = CommentSchema;

export const ResponseAndChildrenSchema: z.ZodType<ResponseAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Response'),
      ...ResponseProperties,
    }),

    z.object({
      '@type': z.literal('Comment'),
      ...CommentProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
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

    z.object({
      '@type': z.literal('Directory'),
      ...DirectoryProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const CheckInActionAndChildrenSchema = CheckInActionSchema;

export const ChannelAndChildrenSchema = ChannelSchema;

export const CategoryAndChildrenSchema = CategorySchema;

export const DefinedTermAndChildrenSchema: z.ZodType<DefinedTermAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('DefinedTerm'),
      ...DefinedTermProperties,
    }),

    z.object({
      '@type': z.literal('Category'),
      ...CategoryProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const IntangibleAndChildrenSchema: z.ZodType<IntangibleAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Intangible'),
      ...IntangibleProperties,
    }),

    z.object({
      '@type': z.literal('Selector'),
      ...SelectorProperties,
    }),

    z.object({
      '@type': z.literal('PageSelector'),
      ...PageSelectorProperties,
    }),

    z.object({
      '@type': z.literal('EpubCfiSelector'),
      ...EpubCfiSelectorProperties,
    }),

    z.object({
      '@type': z.literal('DefinedTerm'),
      ...DefinedTermProperties,
    }),

    z.object({
      '@type': z.literal('Category'),
      ...CategoryProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const CancelActionAndChildrenSchema = CancelActionSchema;

export const CallSessionAndChildrenSchema = CallSessionSchema;

export const SessionAndChildrenSchema: z.ZodType<SessionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('Session'),
      ...SessionProperties,
    }),

    z.object({
      '@type': z.literal('Tenure'),
      ...TenureProperties,
    }),

    z.object({
      '@type': z.literal('Relationship'),
      ...RelationshipProperties,
    }),

    z.object({
      '@type': z.literal('Membership'),
      ...MembershipProperties,
    }),

    z.object({
      '@type': z.literal('Enrollment'),
      ...EnrollmentProperties,
    }),

    z.object({
      '@type': z.literal('DeviceSession'),
      ...DeviceSessionProperties,
    }),

    z.object({
      '@type': z.literal('CallSession'),
      ...CallSessionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const CallActionAndChildrenSchema = CallActionSchema;

export const CommunicateActionAndChildrenSchema: z.ZodType<CommunicateActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('CommunicateAction'),
      ...CommunicateActionProperties,
    }),

    z.object({
      '@type': z.literal('CheckInAction'),
      ...CheckInActionProperties,
    }),

    z.object({
      '@type': z.literal('CallAction'),
      ...CallActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const InteractActionAndChildrenSchema: z.ZodType<InteractActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('InteractAction'),
      ...InteractActionProperties,
    }),

    z.object({
      '@type': z.literal('FollowAction'),
      ...FollowActionProperties,
    }),

    z.object({
      '@type': z.literal('CommunicateAction'),
      ...CommunicateActionProperties,
    }),

    z.object({
      '@type': z.literal('CheckInAction'),
      ...CheckInActionProperties,
    }),

    z.object({
      '@type': z.literal('CallAction'),
      ...CallActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const BookmarkActionAndChildrenSchema = BookmarkActionSchema;

export const OrganizeActionAndChildrenSchema: z.ZodType<OrganizeActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('OrganizeAction'),
      ...OrganizeActionProperties,
    }),

    z.object({
      '@type': z.literal('BookmarkAction'),
      ...BookmarkActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const BookAndChildrenSchema = BookSchema;

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
export const AssessActionAndChildrenSchema: z.ZodType<AssessActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('AssessAction'),
      ...AssessActionProperties,
    }),

    z.object({
      '@type': z.literal('RespondAction'),
      ...RespondActionProperties,
    }),

    z.object({
      '@type': z.literal('ReactAction'),
      ...ReactActionProperties,
    }),

    z.object({
      '@type': z.literal('LikeAction'),
      ...LikeActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const ArticleAndChildrenSchema = ArticleSchema;

export const CreativeWorkAndChildrenSchema: z.ZodType<CreativeWorkAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('CreativeWork'),
      ...CreativeWorkProperties,
    }),

    z.object({
      '@type': z.literal('SoftwareApplication'),
      ...SoftwareApplicationProperties,
    }),

    z.object({
      '@type': z.literal('Quotation'),
      ...QuotationProperties,
    }),

    z.object({
      '@type': z.literal('Query'),
      ...QueryProperties,
    }),

    z.object({
      '@type': z.literal('Post'),
      ...PostProperties,
    }),

    z.object({
      '@type': z.literal('PodcastEpisode'),
      ...PodcastEpisodeProperties,
    }),

    z.object({
      '@type': z.literal('MusicRecording'),
      ...MusicRecordingProperties,
    }),

    z.object({
      '@type': z.literal('MusicAlbum'),
      ...MusicAlbumProperties,
    }),

    z.object({
      '@type': z.literal('Message'),
      ...MessageProperties,
    }),

    z.object({
      '@type': z.literal('Response'),
      ...ResponseProperties,
    }),

    z.object({
      '@type': z.literal('Comment'),
      ...CommentProperties,
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
      '@type': z.literal('Directory'),
      ...DirectoryProperties,
    }),

    z.object({
      '@type': z.literal('Channel'),
      ...ChannelProperties,
    }),

    z.object({
      '@type': z.literal('Book'),
      ...BookProperties,
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
      '@type': z.literal('Article'),
      ...ArticleProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const AnnotateActionAndChildrenSchema = AnnotateActionSchema;

export const CreateActionAndChildrenSchema: z.ZodType<CreateActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('CreateAction'),
      ...CreateActionProperties,
    }),

    z.object({
      '@type': z.literal('QuoteAction'),
      ...QuoteActionProperties,
    }),

    z.object({
      '@type': z.literal('PublishAction'),
      ...PublishActionProperties,
    }),

    z.object({
      '@type': z.literal('AnnotateAction'),
      ...AnnotateActionProperties,
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

    z.object({
      '@type': z.literal('Organization'),
      ...OrganizationProperties,
    }),

    z.object({
      '@type': z.literal('PerformingGroup'),
      ...PerformingGroupProperties,
    }),

    z.object({
      '@type': z.literal('MusicGroup'),
      ...MusicGroupProperties,
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
      '@type': z.literal('Meal'),
      ...MealProperties,
    }),

    z.object({
      '@type': z.literal('Journey'),
      ...JourneyProperties,
    }),

    z.object({
      '@type': z.literal('Event'),
      ...EventProperties,
    }),

    z.object({
      '@type': z.literal('PhysicalObject'),
      ...PhysicalObjectProperties,
    }),

    z.object({
      '@type': z.literal('Device'),
      ...DeviceProperties,
    }),

    z.object({
      '@type': z.literal('Command'),
      ...CommandProperties,
    }),

    z.object({
      '@type': z.literal('Intangible'),
      ...IntangibleProperties,
    }),

    z.object({
      '@type': z.literal('Selector'),
      ...SelectorProperties,
    }),

    z.object({
      '@type': z.literal('PageSelector'),
      ...PageSelectorProperties,
    }),

    z.object({
      '@type': z.literal('EpubCfiSelector'),
      ...EpubCfiSelectorProperties,
    }),

    z.object({
      '@type': z.literal('DefinedTerm'),
      ...DefinedTermProperties,
    }),

    z.object({
      '@type': z.literal('Category'),
      ...CategoryProperties,
    }),

    z.object({
      '@type': z.literal('Session'),
      ...SessionProperties,
    }),

    z.object({
      '@type': z.literal('Tenure'),
      ...TenureProperties,
    }),

    z.object({
      '@type': z.literal('Relationship'),
      ...RelationshipProperties,
    }),

    z.object({
      '@type': z.literal('Membership'),
      ...MembershipProperties,
    }),

    z.object({
      '@type': z.literal('Enrollment'),
      ...EnrollmentProperties,
    }),

    z.object({
      '@type': z.literal('DeviceSession'),
      ...DeviceSessionProperties,
    }),

    z.object({
      '@type': z.literal('CallSession'),
      ...CallSessionProperties,
    }),

    z.object({
      '@type': z.literal('CreativeWork'),
      ...CreativeWorkProperties,
    }),

    z.object({
      '@type': z.literal('SoftwareApplication'),
      ...SoftwareApplicationProperties,
    }),

    z.object({
      '@type': z.literal('Quotation'),
      ...QuotationProperties,
    }),

    z.object({
      '@type': z.literal('Query'),
      ...QueryProperties,
    }),

    z.object({
      '@type': z.literal('Post'),
      ...PostProperties,
    }),

    z.object({
      '@type': z.literal('PodcastEpisode'),
      ...PodcastEpisodeProperties,
    }),

    z.object({
      '@type': z.literal('MusicRecording'),
      ...MusicRecordingProperties,
    }),

    z.object({
      '@type': z.literal('MusicAlbum'),
      ...MusicAlbumProperties,
    }),

    z.object({
      '@type': z.literal('Message'),
      ...MessageProperties,
    }),

    z.object({
      '@type': z.literal('Response'),
      ...ResponseProperties,
    }),

    z.object({
      '@type': z.literal('Comment'),
      ...CommentProperties,
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
      '@type': z.literal('Directory'),
      ...DirectoryProperties,
    }),

    z.object({
      '@type': z.literal('Channel'),
      ...ChannelProperties,
    }),

    z.object({
      '@type': z.literal('Book'),
      ...BookProperties,
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
      '@type': z.literal('Article'),
      ...ArticleProperties,
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
      '@type': z.literal('Organization'),
      ...OrganizationProperties,
    }),

    z.object({
      '@type': z.literal('PerformingGroup'),
      ...PerformingGroupProperties,
    }),

    z.object({
      '@type': z.literal('MusicGroup'),
      ...MusicGroupProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
export const AddActionAndChildrenSchema = AddActionSchema;

export const UpdateActionAndChildrenSchema: z.ZodType<UpdateActionAndChildren> = z
  .discriminatedUnion('@type', [
    z.object({
      '@type': z.literal('UpdateAction'),
      ...UpdateActionProperties,
    }),

    z.object({
      '@type': z.literal('AddAction'),
      ...AddActionProperties,
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
      '@type': z.literal('FindAction'),
      ...FindActionProperties,
    }),

    z.object({
      '@type': z.literal('ExperienceAction'),
      ...ExperienceActionProperties,
    }),

    z.object({
      '@type': z.literal('LeaveAction'),
      ...LeaveActionProperties,
    }),

    z.object({
      '@type': z.literal('JoinAction'),
      ...JoinActionProperties,
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
      '@type': z.literal('WatchAction'),
      ...WatchActionProperties,
    }),

    z.object({
      '@type': z.literal('ViewAction'),
      ...ViewActionProperties,
    }),

    z.object({
      '@type': z.literal('ReadAction'),
      ...ReadActionProperties,
    }),

    z.object({
      '@type': z.literal('ListenAction'),
      ...ListenActionProperties,
    }),

    z.object({
      '@type': z.literal('EatAction'),
      ...EatActionProperties,
    }),

    z.object({
      '@type': z.literal('DrankAction'),
      ...DrankActionProperties,
    }),

    z.object({
      '@type': z.literal('CompleteAction'),
      ...CompleteActionProperties,
    }),

    z.object({
      '@type': z.literal('CancelAction'),
      ...CancelActionProperties,
    }),

    z.object({
      '@type': z.literal('InteractAction'),
      ...InteractActionProperties,
    }),

    z.object({
      '@type': z.literal('FollowAction'),
      ...FollowActionProperties,
    }),

    z.object({
      '@type': z.literal('CommunicateAction'),
      ...CommunicateActionProperties,
    }),

    z.object({
      '@type': z.literal('CheckInAction'),
      ...CheckInActionProperties,
    }),

    z.object({
      '@type': z.literal('CallAction'),
      ...CallActionProperties,
    }),

    z.object({
      '@type': z.literal('OrganizeAction'),
      ...OrganizeActionProperties,
    }),

    z.object({
      '@type': z.literal('BookmarkAction'),
      ...BookmarkActionProperties,
    }),

    z.object({
      '@type': z.literal('AssessAction'),
      ...AssessActionProperties,
    }),

    z.object({
      '@type': z.literal('RespondAction'),
      ...RespondActionProperties,
    }),

    z.object({
      '@type': z.literal('ReactAction'),
      ...ReactActionProperties,
    }),

    z.object({
      '@type': z.literal('LikeAction'),
      ...LikeActionProperties,
    }),

    z.object({
      '@type': z.literal('CreateAction'),
      ...CreateActionProperties,
    }),

    z.object({
      '@type': z.literal('QuoteAction'),
      ...QuoteActionProperties,
    }),

    z.object({
      '@type': z.literal('PublishAction'),
      ...PublishActionProperties,
    }),

    z.object({
      '@type': z.literal('AnnotateAction'),
      ...AnnotateActionProperties,
    }),

    z.object({
      '@type': z.literal('UpdateAction'),
      ...UpdateActionProperties,
    }),

    z.object({
      '@type': z.literal('AddAction'),
      ...AddActionProperties,
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
      '@type': z.literal('Meal'),
      ...MealProperties,
    }),

    z.object({
      '@type': z.literal('Journey'),
      ...JourneyProperties,
    }),

    z.object({
      '@type': z.literal('Event'),
      ...EventProperties,
    }),

    z.object({
      '@type': z.literal('PhysicalObject'),
      ...PhysicalObjectProperties,
    }),

    z.object({
      '@type': z.literal('Device'),
      ...DeviceProperties,
    }),

    z.object({
      '@type': z.literal('Command'),
      ...CommandProperties,
    }),

    z.object({
      '@type': z.literal('Intangible'),
      ...IntangibleProperties,
    }),

    z.object({
      '@type': z.literal('Selector'),
      ...SelectorProperties,
    }),

    z.object({
      '@type': z.literal('PageSelector'),
      ...PageSelectorProperties,
    }),

    z.object({
      '@type': z.literal('EpubCfiSelector'),
      ...EpubCfiSelectorProperties,
    }),

    z.object({
      '@type': z.literal('DefinedTerm'),
      ...DefinedTermProperties,
    }),

    z.object({
      '@type': z.literal('Category'),
      ...CategoryProperties,
    }),

    z.object({
      '@type': z.literal('Session'),
      ...SessionProperties,
    }),

    z.object({
      '@type': z.literal('Tenure'),
      ...TenureProperties,
    }),

    z.object({
      '@type': z.literal('Relationship'),
      ...RelationshipProperties,
    }),

    z.object({
      '@type': z.literal('Membership'),
      ...MembershipProperties,
    }),

    z.object({
      '@type': z.literal('Enrollment'),
      ...EnrollmentProperties,
    }),

    z.object({
      '@type': z.literal('DeviceSession'),
      ...DeviceSessionProperties,
    }),

    z.object({
      '@type': z.literal('CallSession'),
      ...CallSessionProperties,
    }),

    z.object({
      '@type': z.literal('CreativeWork'),
      ...CreativeWorkProperties,
    }),

    z.object({
      '@type': z.literal('SoftwareApplication'),
      ...SoftwareApplicationProperties,
    }),

    z.object({
      '@type': z.literal('Quotation'),
      ...QuotationProperties,
    }),

    z.object({
      '@type': z.literal('Query'),
      ...QueryProperties,
    }),

    z.object({
      '@type': z.literal('Post'),
      ...PostProperties,
    }),

    z.object({
      '@type': z.literal('PodcastEpisode'),
      ...PodcastEpisodeProperties,
    }),

    z.object({
      '@type': z.literal('MusicRecording'),
      ...MusicRecordingProperties,
    }),

    z.object({
      '@type': z.literal('MusicAlbum'),
      ...MusicAlbumProperties,
    }),

    z.object({
      '@type': z.literal('Message'),
      ...MessageProperties,
    }),

    z.object({
      '@type': z.literal('Response'),
      ...ResponseProperties,
    }),

    z.object({
      '@type': z.literal('Comment'),
      ...CommentProperties,
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
      '@type': z.literal('Directory'),
      ...DirectoryProperties,
    }),

    z.object({
      '@type': z.literal('Channel'),
      ...ChannelProperties,
    }),

    z.object({
      '@type': z.literal('Book'),
      ...BookProperties,
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
      '@type': z.literal('Article'),
      ...ArticleProperties,
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
      '@type': z.literal('Organization'),
      ...OrganizationProperties,
    }),

    z.object({
      '@type': z.literal('PerformingGroup'),
      ...PerformingGroupProperties,
    }),

    z.object({
      '@type': z.literal('MusicGroup'),
      ...MusicGroupProperties,
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
      '@type': z.literal('FindAction'),
      ...FindActionProperties,
    }),

    z.object({
      '@type': z.literal('ExperienceAction'),
      ...ExperienceActionProperties,
    }),

    z.object({
      '@type': z.literal('LeaveAction'),
      ...LeaveActionProperties,
    }),

    z.object({
      '@type': z.literal('JoinAction'),
      ...JoinActionProperties,
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
      '@type': z.literal('WatchAction'),
      ...WatchActionProperties,
    }),

    z.object({
      '@type': z.literal('ViewAction'),
      ...ViewActionProperties,
    }),

    z.object({
      '@type': z.literal('ReadAction'),
      ...ReadActionProperties,
    }),

    z.object({
      '@type': z.literal('ListenAction'),
      ...ListenActionProperties,
    }),

    z.object({
      '@type': z.literal('EatAction'),
      ...EatActionProperties,
    }),

    z.object({
      '@type': z.literal('DrankAction'),
      ...DrankActionProperties,
    }),

    z.object({
      '@type': z.literal('CompleteAction'),
      ...CompleteActionProperties,
    }),

    z.object({
      '@type': z.literal('CancelAction'),
      ...CancelActionProperties,
    }),

    z.object({
      '@type': z.literal('InteractAction'),
      ...InteractActionProperties,
    }),

    z.object({
      '@type': z.literal('FollowAction'),
      ...FollowActionProperties,
    }),

    z.object({
      '@type': z.literal('CommunicateAction'),
      ...CommunicateActionProperties,
    }),

    z.object({
      '@type': z.literal('CheckInAction'),
      ...CheckInActionProperties,
    }),

    z.object({
      '@type': z.literal('CallAction'),
      ...CallActionProperties,
    }),

    z.object({
      '@type': z.literal('OrganizeAction'),
      ...OrganizeActionProperties,
    }),

    z.object({
      '@type': z.literal('BookmarkAction'),
      ...BookmarkActionProperties,
    }),

    z.object({
      '@type': z.literal('AssessAction'),
      ...AssessActionProperties,
    }),

    z.object({
      '@type': z.literal('RespondAction'),
      ...RespondActionProperties,
    }),

    z.object({
      '@type': z.literal('ReactAction'),
      ...ReactActionProperties,
    }),

    z.object({
      '@type': z.literal('LikeAction'),
      ...LikeActionProperties,
    }),

    z.object({
      '@type': z.literal('CreateAction'),
      ...CreateActionProperties,
    }),

    z.object({
      '@type': z.literal('QuoteAction'),
      ...QuoteActionProperties,
    }),

    z.object({
      '@type': z.literal('PublishAction'),
      ...PublishActionProperties,
    }),

    z.object({
      '@type': z.literal('AnnotateAction'),
      ...AnnotateActionProperties,
    }),

    z.object({
      '@type': z.literal('UpdateAction'),
      ...UpdateActionProperties,
    }),

    z.object({
      '@type': z.literal('AddAction'),
      ...AddActionProperties,
    }),
  ])
  .superRefine(requireNodeIdentity);
