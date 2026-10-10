import { readFile } from 'node:fs/promises';
import { alignmentFile, vocabularies } from '../../lib/site.js';

export function getStaticPaths() {
  return vocabularies.map(vocabulary => ({ params: { id: vocabulary.id } }));
}

export async function GET({ params }) {
  return new Response(await readFile(alignmentFile(params.id)), {
    headers: { 'content-type': 'text/turtle' },
  });
}
