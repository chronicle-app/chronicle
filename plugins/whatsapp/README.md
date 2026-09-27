# @chronicle.app/whatsapp

Chronicle plugin that imports message history from the local WhatsApp database on
macOS (`ChatStorage.sqlite`), the same way the iMessage plugin reads `chat.db`.

## What it reads

Default database:

```
~/Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite
```

Requires **Full Disk Access** for the process reading it (no auth/keys needed —
the on-device database is unencrypted). The companion-device database holds the
window of history that synced to this Mac (see "Coverage" below), with rich
metadata: JIDs, message ids, direction, and group membership.

Each WhatsApp message becomes a `MessageAction` → `Message`. Every identity is
keyed in the **`whatsapp`** namespace on its raw JID — a genuine WhatsApp-issued id,
never synthesized — and the portable phone number rides along as a `sameAs` edge
rather than being the primary key:

- **Individuals** (`<number>@s.whatsapp.net`) → a `Person` (`source: 'whatsapp'`,
  `handle` = the JID) with a `sameAs` edge to `{source: 'phone', handle: <E.164>}`.
  Through the sameAs fold this **merges with the same number seen
  via iMessage/contacts** — without coercing the WhatsApp id into another namespace.
- **LIDs** (`@lid`, WhatsApp's privacy ids, common in communities/large groups) →
  a `Person` keyed on the LID JID. When WhatsApp's own address book
  (`ContactsV2.sqlite`, `ZWAADDRESSBOOKCONTACT.ZLID` ↔ `ZWHATSAPPID`) knows the
  number, it becomes the same `sameAs` phone edge — so a person's LID and phone-JID
  identities **converge on one phone hub**. A LID for a non-contact has no phone
  edge and stays a bare `whatsapp` `Person`.
- **Groups** (`@g.us`) → an `Agent` keyed on the raw WhatsApp JID, no phone.

Names resolve from the macOS AddressBook (by the resolved phone), then the WhatsApp
display name.

**You** (the account owner) are keyed the same way as everyone else — a `whatsapp`
`Person` with a phone `sameAs`. Your own JID is not stored in the database, but a
WhatsApp account _is_ its phone-number JID (`<number>@s.whatsapp.net`), so it is
reconstructed from your number: `selfNumber` if set, otherwise the phone on your
macOS "me" contact card (the same number iMessage uses), falling back to your iCloud
identity only if no number can be determined.

A **quoted reply** carries an `inReplyTo` edge to the message it quotes, keyed on
that message's stanza id so it folds onto the real parent `Message` node (or a stub
that resolves when the parent is imported). The quoted stanza id comes from the
message's media-item metadata blob (`ZWAMEDIAITEM.ZMETADATA` — a protobuf whose
field 5 is the quoted stanza id, decoded in `replyTarget.ts`), since WhatsApp sets
the structured `ZWAMESSAGE.ZPARENTMESSAGE` link for only a handful of replies; that
link is used as a fallback.

Every photo/video/voice-note/document message gets an attachment object
(`ImageObject`/`VideoObject`/`AudioObject`/`DocumentObject`, chosen by message
type). When the file is on disk it carries `contentPath` (bytes captured at
ingest); otherwise it's a **placeholder** with no bytes — WhatsApp Desktop keeps
only ~4% of media locally, so most are placeholders. Captions (stored in
`ZWAMEDIAITEM.ZTITLE`, never `ZTEXT`) become the message body.

Each attachment is keyed by its owning message's id (`@key:
['@type','source','sourceId']`, `sourceId` = the message stanza id). A message has
exactly one attachment, and the stanza id is identical on this companion DB and on
a future iPhone-backup DB — so a placeholder and the real file **collapse to one
node** when the backup is ingested, the file simply adding `contentPath`. (The
`ZVCARDNAME` content hash would dedupe identical media across chats, but it is
absent on ~86% of fileless media, so it can't serve as the merge key.)

System/notification rows (group events, "security code changed", E2E notices) and
status/broadcast threads are filtered out.

## Coverage caveat

macOS WhatsApp is a **linked companion device**: it only contains history from
around when this Mac was linked, not the full account history, and ~96% of its
media has no local file. For the full history with its media, use an iPhone backup
(below) — the iPhone is the primary device and its `ChatStorage.sqlite` has the
same schema this extractor already reads.

## Acquisition modes

The plugin offers two ways to pull the same messages, selected with `--via`:

- **`app-db`** (default) — the live macOS `ChatStorage.sqlite`.
- **`backup`** — an **unencrypted** iPhone backup (full history). `--input` is the
  backup directory:

  ```sh
  chronicle extract whatsapp --via backup \
    --input "~/Library/Application Support/MobileSync/Backup/<UDID>" \
    --self-number "+1…"
  ```

  Add `--skip-media` to skip the media tree (much faster, for testing).

The `backup` mode (`WhatsappBackupExtractor`) pulls WhatsApp's full-history
`ChatStorage.sqlite`, `ContactsV2.sqlite` (the LID→phone map), and `Message/` media
tree out of the backup. The backup addresses files by
`fileID = SHA1("<domain>-<relativePath>")` stored at `<backup>/<fileID[:2]>/<fileID>`,
mapped by `Manifest.db`; `extractFromIosBackup` reads that manifest, copies the DBs
(checkpointed on open, so the backup stays pristine) and hard-links the media into a
working dir, then runs the same flow as the `app-db` mode.

Because attachments are keyed by their owning message's stanza id (identical across
the companion and backup DBs), a fileless placeholder from the macOS DB and the
backup's real file **collapse to one node**, the backup simply adding `contentPath`.

**Encrypted backups are out of scope** for now: `Manifest.db` is itself encrypted
and won't open, so the extractor reports the situation. Decrypt the backup first
(e.g. with [`iphone_backup_decrypt`](https://pypi.org/project/iphone-backup-decrypt/)
and the backup password), then run the `backup` mode against the decrypted copy.

## Usage

```ts
import {
  WhatsappExtractor, // app-db mode: input = a ChatStorage.sqlite
  WhatsappBackupExtractor, // backup mode: input = an iPhone backup directory
} from '@chronicle.app/whatsapp';

const live = new WhatsappExtractor({ input: '/path/to/ChatStorage.sqlite' });
const backup = new WhatsappBackupExtractor({ input: '/path/to/Backup/<UDID>' });
```

Shared options: `mediaDir` (defaults to the `Message/` folder beside the database),
`includeContactNames`, `selfNumber` (your WhatsApp number in E.164, e.g.
`+14165551234`), `contactsDb`, `skipMedia`, plus the standard `since` / `until` /
`limit`. The `backup` mode adds `iosWorkDir` (where to materialize the backup).

Tests use synthetic `ChatStorage.sqlite`, `ContactsV2.sqlite`, and iPhone-backup
fixtures with `selfNumber` set and `includeContactNames: false`, so they never read
the host's WhatsApp data, contacts, or iCloud account.
