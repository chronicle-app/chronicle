import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The shared app-group container that holds WhatsApp's `ChatStorage.sqlite` and
 * its `Message/` media tree in an iOS backup. `ChatStorage.sqlite`'s fileID is
 * therefore `SHA1("<this>-ChatStorage.sqlite")` =
 * `7c7fba66680ef796b916b067077cc246adacf01d` (the well-known constant), but we
 * resolve it through Manifest.db rather than hardcoding so we can enumerate the
 * media tree's dynamic paths in the same pass.
 */
const WHATSAPP_DOMAIN = 'AppDomainGroup-group.net.whatsapp.WhatsApp.shared';

/** Manifest.db `Files.flags`: 1 = regular file, 2 = directory (symlinks etc. are skipped). */
const FLAG_FILE = 1;

export interface IosBackupSources {
  /** Materialized ChatStorage.sqlite — feed to WhatsappExtractor `input`. */
  dbPath: string;
  /** Materialized `Message/` media root — feed to WhatsappExtractor `mediaDir`. */
  mediaDir: string;
}

interface ManifestRow {
  fileID: string;
  relativePath: string;
  flags: number;
}

export interface ExtractFromIosBackupOptions {
  /** Optional progress sink (e.g. extractor logger). */
  log?: (message: string) => void;
  /** Skip the Message/ media tree (materialize only the DBs) — much faster, for testing. */
  skipMedia?: boolean;
}

/**
 * Materialize WhatsApp's `ChatStorage.sqlite`, its `Message/` media tree, and
 * `ContactsV2.sqlite` (the LID→phone map) out of an UNENCRYPTED iOS (Finder/iTunes)
 * backup into `workDir`, returning the paths to point {@link WhatsappExtractor}
 * (`input` + `mediaDir`) at; the extractor finds `ContactsV2.sqlite` beside the DB.
 * The backed-up files are the *same schema* the live-DB extractor already reads —
 * this only relocates the bytes.
 *
 * Mirrors Whatsapp-Chat-Exporter's iOS-backup addressing without depending on it:
 * every backed-up file lives at `<backupDir>/<fileID[:2]>/<fileID>`, where
 * `fileID = SHA1("<domain>-<relativePath>")`, and `Manifest.db`'s `Files` table maps
 * `(domain, relativePath) → fileID`.
 *
 * The SQLite DB (plus any `-wal`/`-shm`) is **copied**: it is opened in WAL mode and
 * checkpointed, which mutates the file, and the backup must stay pristine. Media files
 * are only ever read, so they are **hard-linked** (instant, no extra disk) with a copy
 * fallback when the working dir is on a different filesystem.
 *
 * Encrypted backups are out of scope: `Manifest.db` is itself encrypted and won't open
 * as SQLite, which is reported with the decrypt-first route.
 */
export function extractFromIosBackup(
  backupDir: string,
  workDir: string,
  opts: ExtractFromIosBackupOptions = {}
): IosBackupSources {
  const log = opts.log ?? (() => {});

  const manifestPath = path.join(backupDir, 'Manifest.db');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `No Manifest.db in ${backupDir} — is this an iOS backup directory? ` +
        `(Expected e.g. ~/Library/Application Support/MobileSync/Backup/<UDID>.) ` +
        `If a backup is still running, wait for it to finish: Manifest.db is written last.`
    );
  }

  // An encrypted Manifest.db can surface SQLITE_NOTADB from the open or from the
  // first query — both share one catch that reports the decrypt-first route.
  // The Message/ media tree is the bulk of the work; skip it when only the DBs are wanted.
  const mediaClause = opts.skipMedia
    ? ''
    : `OR relativePath = 'Message' OR relativePath LIKE 'Message/%'`;

  let rows: ManifestRow[];
  let manifest: DatabaseSync | undefined;
  try {
    manifest = new DatabaseSync(manifestPath, { readOnly: true });
    rows = manifest
      .prepare(
        `SELECT fileID, relativePath, flags FROM Files
         WHERE domain = ?
           AND ( relativePath = 'ChatStorage.sqlite'
              OR relativePath LIKE 'ChatStorage.sqlite-%'
              OR relativePath = 'ContactsV2.sqlite'
              ${mediaClause} )`
      )
      .all(WHATSAPP_DOMAIN) as unknown as ManifestRow[];
  } catch (error) {
    throw new Error(
      `Could not read ${manifestPath} as SQLite — the backup is most likely ENCRYPTED, ` +
        `which is out of scope. Decrypt it first (e.g. with iphone_backup_decrypt and the ` +
        `backup password), then point this at the decrypted copy. (${(error as Error).message})`
    );
  } finally {
    manifest?.close();
  }

  if (!rows.some(r => r.relativePath === 'ChatStorage.sqlite')) {
    throw new Error(
      `Backup has no WhatsApp ChatStorage.sqlite (domain ${WHATSAPP_DOMAIN}). ` +
        `Was WhatsApp installed on the backed-up device, and is this the right backup?`
    );
  }

  fs.mkdirSync(workDir, { recursive: true });
  // Ensure the media root exists even on a media-less account.
  fs.mkdirSync(path.join(workDir, 'Message'), { recursive: true });

  let linked = 0;
  let copied = 0;
  let missing = 0;

  for (const row of rows) {
    if (row.flags !== FLAG_FILE) continue; // directories are recreated lazily below; skip symlinks

    const src = path.join(backupDir, row.fileID.slice(0, 2), row.fileID);
    if (!fs.existsSync(src)) {
      missing++;
      continue;
    }

    const dest = path.join(workDir, row.relativePath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { force: true });

    // The SQLite DBs are opened (and may be checkpointed) by the extractor, so they
    // must be copied; media is read-only and hard-links for free, falling back to a
    // copy across filesystems.
    const isDb =
      row.relativePath.startsWith('ChatStorage.sqlite') || row.relativePath === 'ContactsV2.sqlite';
    if (isDb) {
      fs.copyFileSync(src, dest);
      copied++;
    } else {
      try {
        fs.linkSync(src, dest);
        linked++;
      } catch {
        fs.copyFileSync(src, dest);
        copied++;
      }
    }
  }

  log(
    `iOS backup: materialized WhatsApp files into ${workDir} ` +
      `(${linked} linked, ${copied} copied` +
      (missing ? `, ${missing} listed in Manifest.db but absent from backup` : '') +
      `)`
  );

  return {
    dbPath: path.join(workDir, 'ChatStorage.sqlite'),
    mediaDir: path.join(workDir, 'Message'),
  };
}
