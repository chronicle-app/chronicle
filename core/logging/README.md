# @chronicle.app/logging

Shared stderr logger for Chronicle. Node.js 22.13+; ESM with TypeScript declarations.

```js
import { createLogger } from '@chronicle.app/logging';

const logger = createLogger({ prefix: '[extract]', verbose: true });
logger.info('Extracted records', { count: 3 });
logger.debug('Source cursor', { position: 3 });
```

All output goes to stderr so stdout stays available for extracted data. `quiet`
suppresses everything except errors. Debug messages require `verbose`; `level`
filters info/warn output. `verboseInfo` requires verbose and non-quiet mode. Errors
always print. Context can be rendered inline or with `debugMultiline`. A custom
`theme` supplies functions for each level; default colors are disabled for pipes.

`npm run build -w @chronicle.app/logging` builds the package; `npm test -w
@chronicle.app/logging` exercises its public API after a build.

MIT. See [LICENSE](LICENSE).
