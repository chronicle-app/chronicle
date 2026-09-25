import { readFile } from 'node:fs/promises';
import { ONTOLOGY_FILE } from '../lib/site.js';

export async function GET() {
  return new Response(await readFile(ONTOLOGY_FILE), {
    headers: { 'content-type': 'text/turtle' },
  });
}
