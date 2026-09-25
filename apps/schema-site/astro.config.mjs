import { defineConfig } from 'astro/config';
import { DATA_DIRECTORIES, defineDirectories } from './scripts/directories.js';

// Pages read the schema and guides when they load, outside Vite's module graph,
// so the dev server reloads them itself when those files change.
const reloadOnDataChange = directories => ({
  name: 'schema-site-data',
  configureServer(server) {
    server.watcher.add(directories);
    server.watcher.on('change', file => {
      if (!directories.some(directory => file.startsWith(directory))) return;
      server.moduleGraph.invalidateAll();
      server.ws.send({ type: 'full-reload' });
    });
  },
});

export default defineConfig({
  outDir: './build/site',
  // Pages are written as classes/Message.html, the paths the deploy's term
  // redirects and published links point to.
  build: { format: 'preserve' },
  // Compression drops the space where a line break meets an inline element
  // (`the\n<a>`), which joins words in running text.
  compressHTML: false,
  server: { port: 4321 },
  vite: {
    define: defineDirectories(),
    plugins: [reloadOnDataChange(Object.values(DATA_DIRECTORIES))],
  },
});
