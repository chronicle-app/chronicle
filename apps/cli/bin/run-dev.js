#!/usr/bin/env node

// `cdev`: the same built CLI as `chronicle`, but on the dev data
// profile ("Chronicle Dev" data dir) so it can never touch the production
// store. Override with CHRONICLE_PROFILE=prod.
process.env.CHRONICLE_PROFILE ??= 'dev';

await import('./run.js');
