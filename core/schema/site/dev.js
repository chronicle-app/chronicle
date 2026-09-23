// Serves the documentation site and rebuilds it when the ontology, examples,
// guides, or site sources change. Open pages reload after each rebuild.
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUTPUT } from './build.js';

const port = Number(process.env.PORT ?? 4321);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttl': 'text/turtle; charset=utf-8',
};
const reload = `<script>new EventSource('/__reload').onmessage=()=>location.reload()</script>`;
const clients = new Set();

function build() {
  return new Promise(resolve => {
    // A fresh process picks up edits to the site's own modules.
    const child = spawn(process.execPath, [fileURLToPath(new URL('build.js', import.meta.url))], {
      stdio: 'inherit',
    });
    child.on('exit', code => resolve(code === 0));
  });
}

let pending = null;
function rebuild() {
  clearTimeout(pending);
  pending = setTimeout(async () => {
    if (await build()) for (const client of clients) client.write('data: reload\n\n');
  }, 80);
}

await build();
const schemaDirectory = new URL('../', import.meta.url);
for (const path of ['chronicle.ttl', 'examples.ttl', 'guides/', 'site/']) {
  watch(new URL(path, schemaDirectory), { recursive: true }, rebuild);
}

createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/__reload') {
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    clients.add(response);
    request.on('close', () => clients.delete(response));
    return;
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path.endsWith('/')) path += 'index.html';
  try {
    let body = await readFile(join(DEFAULT_OUTPUT, path));
    const type = types[extname(path)] ?? 'application/octet-stream';
    if (type.startsWith('text/html')) body = body.toString().replace('</body>', `${reload}</body>`);
    response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Schema docs at http://localhost:${port}/`);
});
