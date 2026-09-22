import { hostname, userInfo } from 'node:os';
import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { ActionAndChildren, Command, ExecuteAction, Person, Realm } from '@chronicle.app/schema';

export default class ShellHistoryTransformer extends ChronicleTransformer {
  override async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'commands') {
      actions.push(...(await this.buildCommandActions(record)));
    }

    return actions;
  }

  private async buildCommandActions(record: Record): Promise<ActionAndChildren[]> {
    // The timestamp is part of the key, so it must be stable across
    // re-extractions — pass through what the extractor asserted, never stamp
    // one here (a transform-time clock would mint a new CID every run). A
    // record without a parseable timestamp is dropped rather than fabricated.
    const timestamp = new Date(record.data.timestamp ?? Number.NaN);
    if (Number.isNaN(timestamp.getTime())) return [];

    const executeAction: ExecuteAction & ActionAndChildren = {
      '@type': 'ExecuteAction',
      timestamp,
      '@key': [
        '@type',
        'source',
        'timestamp',
        'object.body',
        'agent.handle',
        'agent.memberOf[*].handle',
      ],
      source: 'shell',
      agent: await this.buildUser(),
      object: this.buildCommand(record.data),
    };

    return [executeAction];
  }

  private async buildUser(): Promise<Person> {
    // The user account, keyed by its username within the realm (the host) it
    // belongs to — reached by traversing `memberOf` to the realm's handle, so
    // the key is (username, machine) without a denormalized namespace scalar.
    // `sameAs: ['@me']` still merges it onto the account owner. Only the stable
    // machine name (from SystemInfo) is kept — not the full hostname, which
    // flips with Tailscale/Bonjour and would thrash a re-observed `name`.
    // The logical machine as a name-keyed :Realm — folds with the same host seen
    // by other sources (e.g. Timing, where it also carries the hardware Device
    // that links to it via inRealm).
    const realm: Realm = {
      '@type': 'Realm',
      '@key': ['@type', 'source', 'handle'],
      source: 'hostname',
      handle: (this.config.hostname ?? hostname()).trim().split('.')[0].toLowerCase(),
    };

    return {
      '@type': 'Person',
      '@key': ['@type', 'source', 'handle', 'memberOf[*].handle'],
      source: 'shell',
      handle: this.config.username ?? userInfo().username,
      memberOf: [realm],
      sameAs: ['@me'],
    };
  }

  private buildCommand(data: any): Command {
    return {
      '@type': 'Command',
      '@key': ['@type', 'source', 'body', 'action.timestamp'],
      source: 'shell',
      body: data.command,
    };
  }
}
