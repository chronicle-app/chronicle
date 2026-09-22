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

## Versioning

All npm workspaces share the root package version, including the schema package.
Run `npm run release:version -- 0.2.0` with an explicit version to update every
package, exact internal dependencies, and the lockfile. This does not create tags
or publish. `npm run versions:check` checks alignment as part of quality checks.

The vocabulary has an independent stable semantic version in the ontology's
`owl:versionInfo`. Change it only when the vocabulary contract changes, then run
`npm run schema:generate`. The schema package exports the generated
`SCHEMA_VERSION` for future extraction or assertion-log metadata. Package versions
identify software; vocabulary versions identify data contracts.

Use patch releases for compatible fixes, minor releases for compatible features,
and major releases for breaking public APIs, including generated types or
validators. Apply the strongest required bump across all packages, even during
0.x. A vocabulary version bump does not replace a required software version bump.
Unchanged packages still receive the shared version.

Review vocabulary changes against the last published snapshot and explicitly
choose the appropriate schema bump; automation cannot infer semantic compatibility.
Use immutable `v<package-version>` Git tags for software releases. Release notes
must record both the software version and vocabulary version.

## Publishing

Before an explicitly approved release:

1. Authenticate with npm and verify access with `npm whoami` and
   `npm org ls chronicle.app`.
2. Confirm package licensing and version availability with `npm view <package>
versions`. Confirm the version and review every tarball (`tar -tzf <artifact>`).
   If any version changes, update workspace dependency ranges and the lockfile,
   then rerun all checks and prepare fresh artifacts from the reviewed commit.
3. After release approval, publish the reviewed tarballs explicitly with
   `npm publish <artifact.tgz> --access public`. Publish shared configs before
   their consumers. No CI event or tag publishes automatically.
4. Verify the released versions by installing them in an isolated consumer.

## Schema releases

`core/schema/chronicle.ttl` and `@chronicle.app/schema` have distinct versions. The vocabulary version comes from
`owl:versionInfo` in the ontology; the npm package follows the shared software version. Keep a single editable ontology in the current tree;
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
2. Tag the reviewed release commit as `v<package-version>` and push that tag as
   part of the approved release. Never move or reuse a release tag. For example,
   `git show v0.1.0:core/schema/chronicle.ttl` retrieves that release's
   ontology once the tag exists.
3. Publish the reviewed npm tarball. Record its package version and vocabulary version together in the release notes.
   The Git tag identifies the software release; the snapshot path uses the vocabulary version.
4. When schema website hosting is configured, publish the snapshot at
   `https://schema.chronicle.app/releases/<version>/chronicle.ttl` and generate
   matching documentation from that snapshot under the same release path.
   Retain all existing release paths unchanged on every deployment. Update
   `/chronicle.ttl` and unversioned term pages only to the latest released version.

The preparation workflow creates artifacts only; it does not create tags,
publish npm packages, or deploy a website.

Schema HTML describes only the vocabulary version, so an unchanged vocabulary
produces identical snapshots across software releases. Preparation refuses to
overwrite differing local snapshots at an existing version. Before deploying,
compare with the published snapshots too: a fresh checkout cannot detect changes
to artifacts stored elsewhere. Never overwrite a published snapshot.
