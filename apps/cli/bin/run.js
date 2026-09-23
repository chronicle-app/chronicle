#!/usr/bin/env node
import { readFileSync } from 'node:fs';

// Fail clearly on an unsupported Node.js before loading anything that needs a newer one.
const { engines } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const minimum = engines.node.replace(/^>=\s*/, '');
const [current, required] = [process.versions.node, minimum].map(v => v.split('.').map(Number));
const index = required.findIndex((part, i) => current[i] !== part);
if (index !== -1 && current[index] < required[index]) {
  console.error(`Chronicle needs Node.js ${minimum} or newer; this is ${process.versions.node}.`);
  process.exit(1);
}

const { execute } = await import('@oclif/core');
await execute({ dir: import.meta.url });
