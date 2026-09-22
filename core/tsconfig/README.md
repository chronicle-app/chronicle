# @chronicle.app/tsconfig

Shared TypeScript settings for Chronicle. Requires Node.js 22.13+.

Extend `@chronicle.app/tsconfig/lib.json` for emitted NodeNext libraries, `app.json`
for application checking, or `test.json` for test checking. `base.json` supplies strict
ES2022 defaults. Set `rootDir`, `outDir`, `include`, and `exclude` in the consuming
project: paths in an installed config otherwise resolve inside `node_modules`.
Libraries emit declarations and JavaScript; app/test configs use `noEmit` and do not
require Jest. Install TypeScript and `@types/node` in the consumer.

```json
{
  "extends": "@chronicle.app/tsconfig/lib.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*.ts"]
}
```

MIT. See [LICENSE](LICENSE).
