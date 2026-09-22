import { CsvExtractor, configForIo, ioFlags } from '@chronicle.app/etl';

import ExtractCommand from '../../ExtractCommand.js';

export default class CsvExtractCommand extends ExtractCommand<typeof CsvExtractCommand> {
  static extractors = CsvExtractor;

  static override flags = {
    ...ExtractCommand.baseFlags,
    ...ioFlags,
  };

  protected buildExtractorConfig() {
    const ioConfig = configForIo(this.flags as any);
    return { ...(this.flags as any), ...ioConfig };
  }
}
