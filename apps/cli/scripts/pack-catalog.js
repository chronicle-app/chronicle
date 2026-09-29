// Runs on prepack: writes the catalog the CLI ships with, each plugin's
// manifest embedded so uninstalled sources can be listed and installed.
import { writeFileSync } from 'node:fs';
import { loadCatalog } from '../dist/plugins/catalog.js';

writeFileSync('catalog.json', `${JSON.stringify({ plugins: await loadCatalog() })}\n`);
