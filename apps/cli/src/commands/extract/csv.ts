import { CsvExtractor, configForIo, ioFlags } from '@chronicle.app/etl';

import ExtractCommand from '../../ExtractCommand.js';

export default class CsvExtractCommand extends ExtractCommand<typeof CsvExtractCommand> {
  static extractors = CsvExtractor;

  static override summary = 'Extract the rows of a CSV file as records';

  static override description = 'Pass the file with `--input`, or `--input -` to read stdin.';

  static override examples = [
    'chronicle extract csv --input contacts.csv',
    'cat contacts.csv | chronicle extract csv --input -',
  ];

  static override flags = {
    ...ExtractCommand.baseFlags,
    ...ioFlags,
  };

  protected buildExtractorConfig() {
    const ioConfig = configForIo(this.flags as any);
    return { ...(this.flags as any), ...ioConfig };
  }
}
