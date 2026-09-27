import { ChronicleTransformer, Record, selfAgent } from '@chronicle.app/etl';
import {
  BaseAndChildren,
  BookmarkAction,
  CompleteAction,
  CreativeWork,
  DefinedTerm,
  Enrollment,
  FollowAction,
  JoinAction,
  LeaveAction,
  Message,
  MessageAction,
  Organization,
  Person,
  RespondAction,
  Tenure,
  Thread,
  UpdateAction,
  WatchAction,
} from '@chronicle.app/schema';
import type { LinkedInAccount } from './archive/LinkedInArchiveExtractor.js';
import type { MessageParty } from './archive/LinkedInArchiveMessagesExtractor.js';
import { profileUrl } from './fields.js';

const SOURCE = 'linkedin';

/**
 * The one transformer for every file in the export.
 *
 * Two decisions run through all of it:
 *
 * **People key on the vanity slug.** LinkedIn never puts a member's numeric id
 * in an export, so `/in/<slug>` is the only identifier there is. It is
 * user-changeable, which makes it an imperfect key — but it is a real one, and
 * the alternative is keying strangers on their display name. Each person also
 * carries their profile URL, which mints the portable url-namespace identity
 * that merges them with the same page seen from anywhere else.
 *
 * **Only what LinkedIn wrote gets written.** Where the export has no id, the
 * key is built from the natural fields LinkedIn did provide (an organization's
 * name, a conversation's id, a skill's name) — never from a value invented
 * here.
 */
export default class LinkedInTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<BaseAndChildren[]> {
    switch (record.extraction.recordType) {
      case 'profile': {
        return this.buildProfile(record);
      }
      case 'positions': {
        return this.buildPosition(record);
      }
      case 'education': {
        return this.buildEducation(record);
      }
      case 'connections': {
        return this.buildConnection(record);
      }
      case 'endorsements': {
        return this.buildEndorsement(record);
      }
      case 'follows': {
        return this.buildFollow(record);
      }
      case 'messages': {
        return this.buildMessage(record);
      }
      case 'learning': {
        return this.buildLearning(record);
      }
      default: {
        return [];
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The profile
  // ---------------------------------------------------------------------------

  /**
   * Your own profile, carried by the `UpdateAction` that sighted it.
   *
   * The store takes actions, not loose entities, so a standing fact needs an
   * occurrence to arrive on — the same carrier the Obsidian plugin uses for a
   * note's subject. Its timestamp is when LinkedIn compiled the export, which
   * is genuinely when the profile read this way, so a second import of the same
   * directory restates the identical sighting rather than adding a new one.
   *
   * Everything here also rides every other record as the acting agent, so this
   * matters most for the export that has nothing else in it.
   */
  private buildProfile(record: Record): BaseAndChildren[] {
    const sightedAt = record.extraction.assertedAt;
    const update: UpdateAction = {
      '@type': 'UpdateAction',
      '@key': ['@type', 'source', 'object.handle', 'timestamp'],
      source: SOURCE,
      agent: this.self(record),
      object: this.self(record),
      ...(sightedAt && { timestamp: sightedAt }),
    };
    return [update];
  }

  // ---------------------------------------------------------------------------
  // Work and school — a bounded span, told as its two boundaries
  // ---------------------------------------------------------------------------

  /**
   * A job as a `JoinAction`/`LeaveAction` pair over the employer, carrying a
   * `Tenure` as their shared result. The pair is what the fold turns into a
   * `memberOf` run across the span; the employer is the boundary's object,
   * never a property on the tenure.
   *
   * The boundaries key on the tenure and the employer, never on the date. A
   * position whose start month you fix in a later export then revises the run
   * you already have, instead of appearing beside it as a second job.
   */
  private buildPosition(record: Record): BaseAndChildren[] {
    const data = record.data as {
      company?: string;
      title?: string;
      description?: string;
      startedOn?: string;
      finishedOn?: string;
    };
    if (!data.company || !data.startedOn) return [];

    const employer = this.organization(data.company);
    const tenure: Tenure = {
      '@type': 'Tenure',
      '@key': ['@type', 'source', 'role', 'action.object.name'],
      source: SOURCE,
      ...(data.title && { role: data.title }),
      ...(data.description && { description: data.description }),
    };

    return this.episode('JoinAction', 'LeaveAction', record, employer, tenure, data);
  }

  /** Schooling, in the same shape as a job: two boundaries around an `Enrollment`. */
  private buildEducation(record: Record): BaseAndChildren[] {
    const data = record.data as {
      school?: string;
      degree?: string;
      notes?: string;
      activities?: string;
      startedOn?: string;
      finishedOn?: string;
    };
    if (!data.school || !data.startedOn) return [];

    const school = this.organization(data.school);
    const description = [data.notes, data.activities].filter(Boolean).join('\n\n');
    const enrollment: Enrollment = {
      '@type': 'Enrollment',
      '@key': ['@type', 'source', 'degree', 'action.object.name'],
      source: SOURCE,
      ...(data.degree && { degree: data.degree }),
      ...(description && { description }),
    };

    return this.episode('JoinAction', 'LeaveAction', record, school, enrollment, data);
  }

  /** The opener, plus the closer when the span has actually ended. */
  private episode(
    opener: 'JoinAction',
    closer: 'LeaveAction',
    record: Record,
    object: Organization,
    result: Tenure | Enrollment,
    dates: { startedOn?: string; finishedOn?: string }
  ): BaseAndChildren[] {
    const agent = this.self(record);
    const boundary = (type: string, timestamp: string) =>
      ({
        '@type': type,
        '@key': ['@type', 'source', 'result.role', 'result.degree', 'object.name'],
        source: SOURCE,
        agent,
        object,
        timestamp,
        result,
      }) as unknown as JoinAction | LeaveAction;

    const actions: BaseAndChildren[] = [boundary(opener, dates.startedOn!)];
    if (dates.finishedOn) actions.push(boundary(closer, dates.finishedOn));
    return actions;
  }

  // ---------------------------------------------------------------------------
  // The network
  // ---------------------------------------------------------------------------

  /**
   * A connection, as a dated `FollowAction` onto the other person.
   *
   * **This is the closest verb the ontology has, and it is not an exact fit.**
   * A LinkedIn connection is mutual and consented; a follow is neither. What
   * makes it defensible is that connecting on LinkedIn *does* create a follow,
   * in both directions — so the edge recorded here is real, just not the whole
   * of what happened. Only your side is written: this is your archive, and
   * inventing the reciprocal edge would double every connection on the timeline
   * to say something the row never said.
   */
  private buildConnection(record: Record): BaseAndChildren[] {
    const data = record.data as {
      handle?: string;
      name?: string;
      url?: string;
      email?: string;
      company?: string;
      position?: string;
      connectedOn?: string;
    };

    const person = this.person({
      handle: data.handle,
      name: data.name,
      email: data.email,
      // LinkedIn's own one-line descriptor of them — the title it prints under
      // their name. Their current job, sighted now, not a dated appointment.
      description: data.position,
      company: data.company,
    });
    if (!person) return [];

    const follow: FollowAction = {
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.handle', 'object.name'],
      source: SOURCE,
      agent: this.self(record),
      object: person,
      ...(data.connectedOn && { timestamp: data.connectedOn }),
    };
    return [follow];
  }

  /**
   * Following an organization — the one place `FollowAction` means exactly what
   * it says. LinkedIn files topic pages ("Scrum", "Web Development") in the
   * same list as real employers and gives none of them an id, so the name is
   * both the label and the key.
   */
  private buildFollow(record: Record): BaseAndChildren[] {
    const data = record.data as { organization?: string; followedAt?: string };
    if (!data.organization) return [];

    const follow: FollowAction = {
      '@type': 'FollowAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.name'],
      source: SOURCE,
      agent: this.self(record),
      object: this.organization(data.organization),
      ...(data.followedAt && { timestamp: data.followedAt }),
    };
    return [follow];
  }

  /**
   * An endorsement: one person vouching that another has a skill.
   *
   * `RespondAction` is the schema's verb for a reaction that carries a payload
   * — the endorsement's payload being *which* skill — so the skill rides the
   * result `Response` as its body and its `about`, and the action itself points
   * at the person. A plain `LikeAction` would lose the skill, which is the only
   * interesting part.
   *
   * The response keys through `action.*` onto both parties. Without that, one
   * endorser vouching for the same skill for two different people would collapse
   * into a single response shared by both endorsements.
   */
  private buildEndorsement(record: Record): BaseAndChildren[] {
    const data = record.data as {
      direction?: 'given' | 'received';
      skill?: string;
      otherHandle?: string;
      otherName?: string;
      endorsedAt?: string;
    };
    if (!data.skill) return [];

    const other = this.person({
      handle: data.otherHandle,
      name: data.otherName,
    });
    if (!other) return [];

    const self = this.self(record);
    const endorser = data.direction === 'given' ? self : other;
    const endorsee = data.direction === 'given' ? other : self;

    const skill: DefinedTerm = {
      '@type': 'DefinedTerm',
      '@key': ['@type', 'source', 'name'],
      source: SOURCE,
      name: data.skill,
    };

    const endorsement: RespondAction = {
      '@type': 'RespondAction',
      '@key': ['@type', 'source', 'agent.handle', 'object.handle', 'result.body'],
      source: SOURCE,
      agent: endorser,
      object: endorsee,
      ...(data.endorsedAt && { timestamp: data.endorsedAt }),
      result: {
        '@type': 'Response',
        '@key': ['@type', 'source', 'action.agent.handle', 'action.object.handle', 'body'],
        source: SOURCE,
        body: data.skill,
        author: [endorser],
        about: [skill],
      },
    };
    return [endorsement];
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /**
   * One message, in the conversation LinkedIn assigned it to.
   *
   * The `Thread` is the only thing in the whole export with a first-class id, so
   * it keys on that id and the messages hang off it with `isPartOf`.
   *
   * **Individual messages have no id.** LinkedIn ships the conversation, the
   * moment, the sender, and the text — nothing more — so the message keys on
   * that natural tuple and the action keys on the same. The cost is visible and
   * accepted: two messages with identical text from one person in one thread
   * resolve to a single `Message`, though their sends stay two distinct
   * `MessageAction`s at their own timestamps.
   */
  private buildMessage(record: Record): BaseAndChildren[] {
    const data = record.data as {
      conversationId?: string;
      conversationTitle?: string;
      sender?: MessageParty;
      recipients?: MessageParty[];
      subject?: string;
      content?: string;
      sentAt?: string;
    };
    if (!data.conversationId || !data.sentAt) return [];

    const thread: Thread = {
      '@type': 'Thread',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: data.conversationId,
      ...(data.conversationTitle && { name: data.conversationTitle }),
    };

    const sender = this.party(data.sender, record);
    const recipients = (data.recipients ?? []).flatMap(party => this.party(party, record) ?? []);

    const message: Message = {
      '@type': 'Message',
      '@key': ['@type', 'source', 'isPartOf[*].sourceId', 'author[*].handle', 'name', 'body'],
      source: SOURCE,
      isPartOf: [thread],
      ...(data.subject && { name: data.subject }),
      ...(data.content && { body: data.content }),
      ...(sender && { author: [sender] }),
      ...(recipients.length > 0 && { recipient: recipients }),
    };

    const sent: MessageAction = {
      '@type': 'MessageAction',
      '@key': [
        '@type',
        'source',
        'timestamp',
        'object.isPartOf[*].sourceId',
        'agent.handle',
        'agent.name',
      ],
      source: SOURCE,
      timestamp: data.sentAt,
      ...(sender && { agent: sender }),
      object: message,
    };
    return [sent];
  }

  // ---------------------------------------------------------------------------
  // LinkedIn Learning
  // ---------------------------------------------------------------------------

  /**
   * A course, and whichever of the three things the row records about it: you
   * watched it, you finished it, you saved it. LinkedIn gives courses no id, so
   * the title is the key — it is what the export identifies them by.
   *
   * The saved flag has no date of its own. The bookmark is emitted undated
   * rather than borrowed from the watch, which happened at a different moment.
   */
  private buildLearning(record: Record): BaseAndChildren[] {
    const data = record.data as {
      title?: string;
      description?: string;
      contentType?: string;
      watchedAt?: string;
      completedAt?: string;
      saved?: boolean;
    };
    if (!data.title) return [];

    const agent = this.self(record);
    const course: CreativeWork = {
      '@type': 'CreativeWork',
      '@key': ['@type', 'source', 'name'],
      source: SOURCE,
      name: data.title,
      ...(data.description && { description: data.description }),
      ...(data.contentType && { sourceFormat: data.contentType.toLowerCase() }),
    };

    const actions: BaseAndChildren[] = [];
    if (data.watchedAt) {
      actions.push({
        '@type': 'WatchAction',
        '@key': ['@type', 'source', 'object.name', 'timestamp'],
        source: SOURCE,
        agent,
        object: course,
        timestamp: data.watchedAt,
      } as WatchAction);
    }
    if (data.completedAt) {
      actions.push({
        '@type': 'CompleteAction',
        '@key': ['@type', 'source', 'object.name', 'timestamp'],
        source: SOURCE,
        agent,
        object: course,
        timestamp: data.completedAt,
      } as CompleteAction);
    }
    if (data.saved) {
      // The export says the course is saved, not when it was saved, so the
      // bookmark carries no occurrence. It still needs a sighting: an
      // occurrence-less claim is otherwise timeless, which the inbox drain
      // refuses rather than stamping drain-time. The sighting is the export's
      // own compile time, so a re-import restates it instead of re-sighting it.
      const sightedAt = record.extraction.assertedAt;
      actions.push({
        '@type': 'BookmarkAction',
        '@key': ['@type', 'source', 'object.name'],
        source: SOURCE,
        agent,
        object: course,
        ...(sightedAt && { '@assertedAt': sightedAt }),
      } as BookmarkAction);
    }
    return actions;
  }

  // ---------------------------------------------------------------------------
  // Shared nodes
  // ---------------------------------------------------------------------------

  /**
   * The account owner.
   *
   * The handle comes from the export when it names one — see the extractor's
   * note on reading it off an outgoing invitation — and otherwise the self falls
   * back to `selfAgent`'s per-source singleton. Either way `@me` merges it onto
   * the one person, and the primary email rides as a `sameAs` in the `email`
   * namespace, where the mail and messaging plugins already key their people. A
   * shared email is evidence of one person; a shared display name is not.
   */
  private self(record: Record): Person {
    const account = (record.context?.accountInfo ?? {}) as LinkedInAccount;

    const sameAs = account.email
      ? [
          {
            '@type': 'Person' as const,
            '@key': ['@type', 'source', 'handle'],
            source: 'email',
            handle: account.email,
            ...(account.name && { name: account.name }),
          },
        ]
      : [];

    return {
      ...selfAgent({
        source: SOURCE,
        handle: account.handle,
        name: account.name,
        sameAs,
      }),
      ...(account.handle && { url: profileUrl(account.handle) }),
      ...(account.headline && { description: account.headline }),
    } as Person;
  }

  /**
   * Another member. Returns nothing when LinkedIn identified them neither by
   * slug nor by name — a row about nobody in particular is not a person.
   *
   * With a slug, the key is that slug and the profile URL comes along, which
   * also mints the url-namespace identity every other source can meet them at.
   * Without one, the display name is all that is left; it is a weak key and two
   * namesakes will merge, but dropping the row entirely would lose a real
   * relationship over a missing field.
   */
  private person(fields: {
    handle?: string;
    name?: string;
    email?: string;
    description?: string;
    company?: string;
  }): Person | undefined {
    if (!fields.handle && !fields.name) return undefined;

    const sameAs = fields.email
      ? [
          {
            '@type': 'Person',
            '@key': ['@type', 'source', 'handle'],
            source: 'email',
            handle: fields.email,
            ...(fields.name && { name: fields.name }),
          },
        ]
      : undefined;

    return {
      '@type': 'Person',
      '@key': fields.handle ? ['@type', 'source', 'handle'] : ['@type', 'source', 'name'],
      source: SOURCE,
      ...(fields.handle && {
        handle: fields.handle,
        url: profileUrl(fields.handle),
      }),
      ...(fields.name && { name: fields.name }),
      ...(fields.description && { description: fields.description }),
      ...(fields.company && { memberOf: [this.organization(fields.company)] }),
      ...(sameAs && { sameAs }),
    } as Person;
  }

  /**
   * A message party, which is a person LinkedIn may have declined to name.
   *
   * You are a party to every message in your own export, so a party whose slug
   * is your own resolves to the self node rather than to a stranger who happens
   * to share your key. Both spellings key identically and would merge anyway;
   * this way the `@me` edge is on the node from the start, so messages alone
   * are enough to place you even if the profile record never runs.
   */
  private party(party: MessageParty | undefined, record: Record): Person | undefined {
    if (!party) return undefined;
    const account = (record.context?.accountInfo ?? {}) as LinkedInAccount;
    if (party.handle && party.handle === account.handle) return this.self(record);
    return this.person({ handle: party.handle, name: party.name });
  }

  /**
   * An organization, keyed on its name. LinkedIn puts no company id anywhere in
   * an export — not in the positions, not in the follows — so the name is the
   * only identifier available, and two different companies sharing a name will
   * merge. Recorded here rather than worked around: the alternative is a
   * fabricated id, which would be worse and less honest.
   */
  private organization(name: string): Organization {
    return {
      '@type': 'Organization',
      '@key': ['@type', 'source', 'name'],
      source: SOURCE,
      name,
    };
  }
}
