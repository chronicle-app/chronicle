import { build } from '../lib/site.js';

// When and from which commit this copy of the site was built, for scripts that
// check whether the published site is current.
export function GET() {
  return new Response(JSON.stringify(build, null, 2) + '\n', {
    headers: { 'content-type': 'application/json' },
  });
}
