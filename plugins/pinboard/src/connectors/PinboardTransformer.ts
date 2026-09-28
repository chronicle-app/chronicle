import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { ActionAndChildren, Person, Entity, BookmarkAction, Tag } from '@chronicle.app/schema';

const SOURCE = 'pinboard';

// Pinboard returns empty strings for an absent description/extended note. The
// schema treats optional fields as absent-or-undefined, so coalesce to a trimmed
// string or undefined and omit the field when there's nothing to set.
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export default class PinboardTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'bookmarks') {
      actions.push(...this.buildBookmarkActions(record));
    }

    return actions;
  }

  private buildBookmarkActions(record: Record): ActionAndChildren[] {
    const { data } = record;

    const user: Person = this.buildUser(record);
    const tags: Tag[] = this.buildTags(record);
    const webpage: Entity = this.buildWebpage(record, tags);

    const bookmarkAction: BookmarkAction = {
      '@type': 'BookmarkAction',
      // The save itself is a discrete event: keep its true date on the timeline
      // even though the snapshot sights the bookmark's mutable attributes now.
      timestamp: new Date(data.time),
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: data.hash,
      agent: user,
      object: webpage,
    };

    return [bookmarkAction];
  }

  private buildWebpage(record: Record, tags: Tag[]): Entity {
    const { data } = record;
    const webpage: Entity = {
      '@type': 'Entity',
      // Keyed to this source, not the bare `{url}` hub, because of the
      // `@asserts` below: a completeness claim can only speak for its own
      // source. On the shared hub, clearing the note here would also close
      // another source's description for the same url (and their next crawl
      // would close ours) — an invented history of values churning. The merge
      // still happens: the `url` field mints the `{url}` hub regardless of key.
      '@key': ['url', 'source'],
      source: SOURCE,
      url: data.href,
      ...(str(data.description) && { name: str(data.description) }),
      ...(str(data.extended) && { description: str(data.extended) }),
      ...(tags.length > 0 && { about: tags }),
    };

    // `description` and `about` can be cleared on a later snapshot (the note
    // emptied, all tags removed); the `'*'` default only covers predicates still
    // present, so list them explicitly to close the old values on re-read.
    (webpage as Entity & { '@asserts'?: string[] })['@asserts'] = ['description', 'about'];

    return webpage;
  }

  private buildUser(record: Record): Person {
    const username = (record as any).context.username as string;

    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'handle'],
      source: SOURCE,
      handle: username,
      name: username,
      url: `https://pinboard.in/u:${username}/`,
      sameAs: ['@me'],
    };
  }

  private buildTags(record: Record): Tag[] {
    const { data } = record;
    if (!data.tags) return [];

    const tagNames = data.tags.split(' ').filter((tag: string) => tag.length > 0);

    return tagNames.map((tagName: string) => ({
      '@type': 'Tag' as const,
      '@key': ['@type', 'source', 'handle'],
      source: SOURCE,
      handle: tagName,
    }));
  }
}
