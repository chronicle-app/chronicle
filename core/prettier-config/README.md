# @chronicle.app/prettier-config

Chronicle's shared Prettier 3 configuration: single quotes, semicolons, two-space
indentation, ES5 trailing commas, and a 100-column print width.

Set `"prettier": "@chronicle.app/prettier-config"` in your package.json, or use this
in `prettier.config.cjs`:

```js
module.exports = require('@chronicle.app/prettier-config');
```

MIT. See [LICENSE](LICENSE).
