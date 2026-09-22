# @chronicle.app/eslint-config

Shared ESLint 8 rules for Chronicle JavaScript and TypeScript. Install ESLint 8, TypeScript 5,
and Prettier 3 in the consumer, then extend this package:

```json
{ "extends": "@chronicle.app/eslint-config" }
```

The config is CommonJS and includes the TypeScript parser/plugins. Build output,
coverage, and verbatim fixtures are ignored. `prettier.js` preserves the existing
oclif formatting preset entry point; Chronicle's formatting preferences live in
`@chronicle.app/prettier-config`.

MIT. See [LICENSE](LICENSE).
