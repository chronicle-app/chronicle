# Preparing a release

Packages start at `0.1.0` under `@chronicle.app`. Repository visibility and npm
publication are separate actions; neither is changed by the preparation workflow.
The root workspace is private and is never published.

`npm run quality && npm run packages:check` builds, tests, packs each package, and
installs all tarballs into a temporary consumer outside this monorepo. It checks
the installed configs, TypeScript declarations, and runtime entry points. The
tarballs are saved under `artifacts/npm/`.

The manually dispatched **Prepare npm release** workflow performs the same checks
and uploads those tarballs. It has read-only repository permissions, uses no npm
credentials, and contains no publish step.

## Publication and consumer handoff

Before an explicitly approved release:

1. Authenticate with npm and verify access with `npm whoami` and
   `npm org ls chronicle.app`. Scope ownership/access has not yet been verified
   from this checkout because npm authentication was unavailable during setup.
2. Confirm package licensing and version availability with `npm view <package>
versions`. Confirm the version and review every tarball (`tar -tzf <artifact>`).
   If any version changes, update workspace dependency ranges and the lockfile,
   then rerun all checks and prepare fresh artifacts from the reviewed commit.
3. After release approval, publish the reviewed tarballs explicitly with
   `npm publish <artifact.tgz> --access public`. Publish shared configs before
   their consumers. No CI event or tag publishes automatically.
4. Verify the released versions in an isolated consumer before replacing private
   workspace dependencies with exact npm versions. Remove private source copies
   only after their consumers build and test against those released versions.

Until that handoff, these packages are migration preparation; the private source
copies remain in place. Avoid making independent feature changes to both copies.
The minimal schema is a deliberate staged exception: the private full ontology
remains until its consumers can migrate to the smaller package's evolving vocabulary.

## Schema releases

`core/schema/chronicle.ttl` and `@chronicle.app/schema` use the same version from
`core/schema/package.json`. Keep a single editable ontology in the current tree;
Git tags preserve old versions without copying them into versioned source files.

- Patch: description corrections that do not change meaning.
- Minor: new terms or other compatible additions.
- Major: term removal, changed meanings, or incompatible constraints.

Apply these compatibility rules during `0.x` as well. Term identifiers remain
unversioned and stable; a fundamentally different concept needs a new term.

For an approved schema release:

1. Prepare and validate the package using the checks above. Release preparation
   also saves the packed ontology at
   `artifacts/schema/releases/<version>/chronicle.ttl` and the matching standalone
   HTML reference at `artifacts/schema/releases/<version>/index.html`.
2. Tag the reviewed release commit as `schema-v<version>` and push that tag as
   part of the approved release. Never move or reuse a release tag. For example,
   `git show schema-v0.1.0:core/schema/chronicle.ttl` retrieves that release's
   ontology once the tag exists.
3. Publish the reviewed npm tarball. Its version, the Git tag, and the ontology
   snapshot must all refer to the same release.
4. When schema website hosting is configured, publish the snapshot at
   `https://schema.chronicle.app/releases/<version>/chronicle.ttl` and generate
   matching documentation from that snapshot under the same release path.
   Retain all existing release paths unchanged on every deployment. Update
   `/chronicle.ttl` and unversioned term pages only to the latest released version.

The preparation workflow creates artifacts only; it does not create tags,
publish npm packages, or deploy a website.
