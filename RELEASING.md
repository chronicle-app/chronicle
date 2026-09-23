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

Releases are driven by [Changesets](https://github.com/changesets/changesets). A pull
request that should ship adds a changeset with `npx changeset`: choose the bump and
write the changelog entry. All `@chronicle.app` packages form one fixed group, so
they share a version, and the strongest pending bump applies to every package.

`npm run release:version` applies pending changesets: it bumps every package,
writes changelogs, then carries the shared version to the root package, exact
internal dependencies, and the lockfile. `npm run versions:check` checks alignment
as part of quality checks.

The vocabulary has an independent stable semantic version in the ontology's
`owl:versionInfo`. Change it only when the vocabulary contract changes, then run
`npm run schema:generate`. The schema package exports the generated
`SCHEMA_VERSION` for future extraction or assertion-log metadata. Package versions
identify software; vocabulary versions identify data contracts.

Use patch releases for compatible fixes, minor releases for compatible features,
and major releases for breaking public APIs, including generated types or
validators, even during 0.x. A vocabulary version bump does not replace a required
software version bump.

Review vocabulary changes against the last published snapshot and explicitly
choose the appropriate schema bump; automation cannot infer semantic compatibility.
Each release has one immutable `v<package-version>` tag and GitHub release, whose
notes record both the software version and vocabulary version.

## Publishing

The **Release** workflow runs on every push to `main`:

- With pending changesets, it opens or updates a **Version Packages** pull request
  that runs `npm run release:version`. Merging that pull request approves the release.
- With versions not yet on npm, it runs `npm run quality` and
  `npm run packages:check`, packs the tarballs, and publishes them through npm
  trusted publishing, with no stored npm token. It then creates the
  `v<package-version>` tag and GitHub release with `scripts/tag-release.js`.

Only the publish job can publish to npm or write releases; the version and pack
jobs cannot. Each package's trusted publisher on npmjs.com names this repository
and `release.yml`. Pull requests opened with the workflow token do not trigger
other workflows, so CI does not run on the Version Packages pull request itself.

To publish from a local checkout instead, such as before trusted publishers exist,
authenticate with npm and run `npm run release` from a clean `main`. It runs the
same checks, publishes every version not already on the registry, and creates the
release with `gh`. npm asks for two-factor authentication. Rerun it to continue
after an interrupted publish.

After publishing, verify the released versions by installing them in an isolated
consumer, for example `npx @chronicle.app/cli@latest sources` in an empty directory.

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
   `artifacts/schema/releases/<version>/chronicle.ttl`.
2. Publishing creates the `v<package-version>` tag and GitHub release on the
   release commit. Never move or reuse a release tag. For example,
   `git show v0.1.0:core/schema/chronicle.ttl` retrieves that release's
   ontology once the tag exists.
3. Record the package version and vocabulary version together in the release notes.
   The Git tag identifies the software release; the snapshot path uses the vocabulary version.
4. After publishing, the release workflow deploys https://schema.chronicle.app
   through [schema-site.yml](.github/workflows/schema-site.yml). The deployment
   serves the snapshot at
   `https://schema.chronicle.app/releases/<version>/chronicle.ttl`, with matching
   documentation built from the first release of that vocabulary version under
   the same path. Every deployment rebuilds all release paths from their tags,
   and fails if a snapshot differs from the published copy. `/chronicle.ttl` and
   the unversioned term pages come from the latest release tag. To redeploy,
   run the Schema site workflow by hand.

The preparation workflow creates artifacts only; it does not create tags,
publish npm packages, or deploy the website.

The snapshot is the ontology alone, so an unchanged vocabulary produces
identical snapshots across software releases. The documentation site also
carries guides and examples, which change between vocabulary versions; build it
with `npm run schema:docs:build`. Preparation refuses to
overwrite differing local snapshots at an existing version. The deployment
compares its snapshots with the published ones, since a fresh checkout cannot
detect changes to artifacts stored elsewhere. Never overwrite a published
snapshot.

The deployment needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
repository secrets. For the first deployment, when nothing is published yet,
run the Schema site workflow by hand with the published-snapshot check skipped.
