import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { references } = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
if (!Array.isArray(references)) throw new Error('Expected TypeScript project references.');

// tsc rejects a solution with both empty files and empty references.
if (references.length === 0) {
  console.log('No TypeScript projects yet; nothing to typecheck.');
} else {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
