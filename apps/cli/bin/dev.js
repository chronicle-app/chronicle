#!/usr/bin/env -S node --import tsx --no-warnings

import { execute } from '@oclif/core';

// Dev runs get their own data profile ("Chronicle Dev" data dir) so they never
// write to the installed CLI's store. Override with CHRONICLE_PROFILE=prod.
process.env.CHRONICLE_PROFILE ??= 'dev';

await execute({ development: true, dir: import.meta.url });
