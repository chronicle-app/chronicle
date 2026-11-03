// @chronicle.app/persistence/node — the Node-only surface.
//
// Everything here reaches a Node built-in (`node:sqlite`, the file system),
// so it is deliberately kept OUT of the portable `.` entry (which must run on
// Hermes/Expo with zero `node:*` value imports). Node hosts — the CLI, the
// server, tests — import store-opening and the local blob store from here.

export { openDatabase, opsPathFor } from './db/open.js';
export type { OpenOptions } from './db/open.js';
export { LocalBlobStore } from './blob/LocalBlobStore.js';
