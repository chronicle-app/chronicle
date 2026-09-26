import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod';
import { WhatsappExtractor } from './WhatsappExtractor.js';
import { extractFromIosBackup } from '../iosBackup.js';

/** Default Finder/iTunes backup location on macOS. */
const MOBILE_SYNC_BACKUPS = path.join(
  os.homedir(),
  'Library/Application Support/MobileSync/Backup'
);

/**
 * The `backup` acquisition mode for WhatsApp: read the full message
 * history out of an unencrypted iPhone backup instead of the live macOS database.
 * Selected with `--via backup` (or by passing `--input`, the only way WhatsApp
 * history arrives as an export); `input` is the backup directory.
 *
 * Everything downstream — the query, identity resolution, transformer — is shared
 * with {@link WhatsappExtractor}. This only materializes the backup's
 * `ChatStorage.sqlite` + `ContactsV2.sqlite` (+ the `Message/` media tree) into a
 * working dir and redirects `input`/`mediaDir` there before the base opens the DB.
 */
export class WhatsappBackupExtractor extends WhatsappExtractor {
  static override delivery = 'export' as const;
  static override strategy = 'backup';
  static override description = 'Messages from an iPhone backup';
  static override default = false;

  static override schema = WhatsappExtractor.schema.extend({
    input: z
      .string()
      .describe(
        'Path to an UNENCRYPTED iOS (Finder/iTunes) backup directory (e.g. ~/Library/Application Support/MobileSync/Backup/<UDID>).'
      ),
    iosWorkDir: z
      .string()
      .optional()
      .describe(
        'Where to materialize the files extracted from the backup (defaults to a temp directory).'
      ),
  }) as any;

  override async setup(): Promise<void> {
    const cfg = this.config as any;
    const backupDir = this.resolveBackupDir(cfg.input);
    const workDir = cfg.iosWorkDir || path.join(os.tmpdir(), 'chronicle-whatsapp-ios');
    this.logger.info(`Extracting WhatsApp DB + media from iOS backup at ${backupDir}`);
    const { dbPath, mediaDir } = extractFromIosBackup(backupDir, workDir, {
      log: m => this.logger.info(m),
      skipMedia: cfg.skipMedia,
    });
    // Redirect the shared DB reader at the materialized files; ContactsV2 lands
    // beside the DB where the base extractor looks for it.
    cfg.input = dbPath;
    cfg.mediaDir = mediaDir;
    await super.setup();
  }

  /**
   * The backup directory to read. Without `--input`, fall back to the standard
   * Finder/iTunes location: use the sole backup there, or list them. A given
   * `--input` is never silently replaced by that fallback — a path that isn't a
   * backup is a mistake worth naming, and `--via app-db` is the live database.
   */
  private resolveBackupDir(input: string | undefined): string {
    if (input) {
      if (fs.existsSync(path.join(input, 'Manifest.db'))) return input;
      throw new Error(
        `'${input}' is not an iOS backup directory (no Manifest.db). ` +
          `Pass an unencrypted Finder/iTunes backup, or read the live database with --via app-db.`
      );
    }

    const found = fs.existsSync(MOBILE_SYNC_BACKUPS)
      ? fs
          .readdirSync(MOBILE_SYNC_BACKUPS)
          .map(d => path.join(MOBILE_SYNC_BACKUPS, d))
          .filter(d => fs.existsSync(path.join(d, 'Manifest.db')))
      : [];

    if (found.length === 1) {
      this.logger.info(`Using iPhone backup ${found[0]} (pass --input to choose another)`);
      return found[0];
    }
    if (found.length > 1) {
      throw new Error(
        `Multiple iPhone backups found — pick one with --input <dir>:\n` +
          found.map(f => `  ${f}`).join('\n')
      );
    }
    throw new Error(
      `No iPhone backup found in ${MOBILE_SYNC_BACKUPS}. ` +
        `Pass --input <backup directory> (an unencrypted Finder/iTunes backup, ` +
        `containing Manifest.db).`
    );
  }
}
