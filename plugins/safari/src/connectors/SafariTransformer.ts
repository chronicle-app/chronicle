import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import { ActionAndChildren, Entity, ViewAction } from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';

export default class SafariTransformer extends ChronicleTransformer {
  async transform(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    if (record.extraction.recordType === 'views') {
      actions.push(...(await this.buildViewActions(record)));
    }

    return actions;
  }

  private async buildViewActions(record: Record): Promise<ActionAndChildren[]> {
    const actions: ActionAndChildren[] = [];

    const user = await buildICloudPersonSchema(record.context.account);
    const webpage: Entity = this.buildWebPage(record);

    // Create a ViewAction for the browser visit
    const viewAction: ViewAction = {
      '@type': 'ViewAction',
      timestamp: new Date(record.data.unix_timestamp * 1000),
      '@key': ['@type', 'source', 'timestamp'],
      source: 'safari',
      // Without an iCloud account the viewer can't be identified, so omit them.
      ...(user && { agent: user }),
      object: webpage,
    };

    actions.push(viewAction);

    return actions;
  }

  private buildWebPage(record: Record): Entity {
    return {
      '@type': 'Entity',
      '@key': ['url'],
      url: record.data.url,
      name: record.data.title || record.data.url,
    };
  }
}
