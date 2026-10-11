// Where the site's data lives. Pages are bundled by Vite, so they cannot find
// files relative to their own modules; the build passes these in instead.
import { fileURLToPath } from 'node:url';

export const SITE_DIRECTORY = fileURLToPath(new URL('../', import.meta.url));

export const DATA_DIRECTORIES = {
  // Read by path rather than through the installed package, so a release tag's
  // site is rebuilt from that tag's vocabulary.
  schema: fileURLToPath(new URL('../../../core/schema/', import.meta.url)),
  guides: fileURLToPath(new URL('../guides/', import.meta.url)),
  // Comparisons with other vocabularies, one for each alignment in the schema.
  vocabularies: fileURLToPath(new URL('../vocabularies/', import.meta.url)),
};

/** Vite `define` entries that hand the data directories to the pages. */
export const defineDirectories = ({ schema, guides, vocabularies } = DATA_DIRECTORIES) => ({
  __SCHEMA_DIRECTORY__: JSON.stringify(schema),
  __GUIDES_DIRECTORY__: JSON.stringify(guides),
  __VOCABULARIES_DIRECTORY__: JSON.stringify(vocabularies),
});
