# @chronicle.app/timing-app

Chronicle plugin that extracts app/screen usage, manually-logged time entries,
and relayed phone/FaceTime call history from
[Timing.app](https://timingapp.com)'s local SQLite database.

## Source

`~/Library/Application Support/info.eurocomp.Timing2/SQLite.db` (opened read-only).
Timestamps are Unix epoch seconds.

Timing is partly a relay: Mac `AppActivity`/`TaskActivity`/`Project` are native,
while iOS app usage rides in `AppActivity` via Apple Screen Time, and Apple Call
History rides in `Event`.

## Extraction types

Bare `chronicle extract timing-app` runs the default extractor — a
reverse-chronological merge of the three focused streams below (so `--limit 1`
is the single most-recent record across all of them). Each stream is also
selectable on its own:

| `--type`         | Table                          | Emits                             |
| ---------------- | ------------------------------ | --------------------------------- |
| (none, default)  | all three, merged newest-first | —                                 |
| `app-activities` | `AppActivity`                  | `ExecuteAction` + `DeviceSession` |
| `time-entries`   | `TaskActivity`                 | `ExperienceAction` + `Session`    |
| `calls`          | `Event` (call relay)           | `CallAction` + `CallSession`      |

## Mapping

- **App usage → `ExecuteAction` + `DeviceSession`.** The action carries the
  measured span (`startTime`/`endTime`), `agent: @me`, `object`: the
  `SoftwareApplication`, `instrument`: the `Device`, `result`: the `DeviceSession`.
  The session carries `isPartOf` → Project and, for the on-screen resource, a
  URL-keyed web `Entity` or a realm-scoped filesystem entry as its `subject`.
  A filesystem entry is keyed by path within the machine's name-keyed `:Realm`
  (`source: hostname`, via `inRealm`) — not globally, since a path isn't unique.
  A trailing-slash path is a `:Directory` and lands on `workingDirectory` (the
  terminal CWD / Finder folder the block happened in); any other path IS the
  media object living there, typed by extension as far as a path-only source can
  tell (`ImageObject`/`AudioObject`/`VideoObject`/`DocumentObject`, else a plain
  `MediaObject` a byte-reader may refine later). The window title, when it adds
  anything beyond the subject's name, holds the session's `name`.
- **Time entry → `ExperienceAction` + `Session`.** A manually-logged block of
  real time (Timing's "time entries"; each belongs to a project). The action
  carries the real occurrence (`startTime`/`endTime`, not `scheduledTime`); the
  lean `Session` object carries `isPartOf` → Project, `name` (title), and `description` (notes).
- **Project ancestry** is nested via `isPartOf` on the session (leaf → parent →
  …), not emitted as standalone records.
- **Call relay (`--type calls`).** Timing relays Apple Call History; this plugin
  reads that DB. It emits `CallAction`/`CallSession` under `source: apple-phone`
  - the shared call UUID, so it folds with the `call-history` plugin's richer
    Apple records — supplying the long tail Apple prunes. Direction is lost and
    named contacts carry no number, so these are thin (a name, no participant).

## Identity

- App: bundle id (`source: apple-bundle-id`) where present, else `timing-app` +
  executable/title. Never keyed on the local `Application.id`.
- Device: `timing-app` + `Device.globalID`, with the hardware MAC linked via
  `sameAs` (`source: mac-address`) on Macs.
- `@me`: Timing has no account of its own, so the self node is just the `@me` tag
  sourced to `timing-app` (no assumed name); the token merges it with the
  subject's named identities from other sources.

## Usage

```bash
# Default merge, recent window (~90 days), newest-first
chronicle extract timing-app

# Full history
chronicle extract timing-app --all --limit 0

# A single focused stream
chronicle extract timing-app --type app-activities
chronicle extract timing-app --type time-entries
chronicle extract timing-app --type calls

# Another copy of the database
chronicle extract timing-app --input /path/to/SQLite.db
```

Tests use a synthetic Timing `SQLite.db` and a synthetic AddressBook under a
temporary `HOME`, so they never read the host's Timing data or contacts.
