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

// Node strips TypeScript by default from 22.18; 22.13 to 22.17 need a flag. When a
// TypeScript plugin may run, relaunch once with it.
if (!process.features.typescript && !process.env.CHRONICLE_TYPESCRIPT_RELAUNCH) {
  const args = process.argv.slice(2);
  // `plugins add` may load a folder whose package.json points at a .ts entry.
  let mayRunTypeScript =
    args.some(arg => /\.[cm]?ts$/.test(arg)) ||
    (args[0] === 'plugins' && (args[1] === 'new' || args[1] === 'add'));
  if (!mayRunTypeScript) {
    // Plugins added with `chronicle plugins add` may be TypeScript.
    const { chronicleConfigDir } = await import('@chronicle.app/auth');
    const { join } = await import('node:path');
    try {
      const config = JSON.parse(readFileSync(join(chronicleConfigDir(), 'config.json'), 'utf8'));
      mayRunTypeScript = (config.plugins ?? []).length > 0;
    } catch {
      // No config yet.
    }
  }
  if (mayRunTypeScript) {
    const { spawnSync } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const { status, signal } = spawnSync(
      process.execPath,
      [
        ...process.execArgv,
        '--experimental-strip-types',
        '--disable-warning=ExperimentalWarning',
        fileURLToPath(import.meta.url),
        ...args,
      ],
      { stdio: 'inherit', env: { ...process.env, CHRONICLE_TYPESCRIPT_RELAUNCH: '1' } }
    );
    if (signal) process.kill(process.pid, signal);
    process.exit(status ?? 1);
  }
}

const { execute } = await import('@oclif/core');
await execute({ dir: import.meta.url });
