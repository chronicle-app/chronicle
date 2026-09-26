/** Local macOS iCloud account discovery. */
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { selfAgent } from '@chronicle.app/etl';
import type { Person } from '@chronicle.app/schema';

export interface ICloudAccount {
  accountID: string;
  displayName: string;
  email: string;
  dsid?: string;
  firstName?: string;
  lastName?: string;
  uuid?: string;
  alternateDSID?: string;
  isLoggedIn?: boolean;
}
export interface AccountLookupOptions {
  homeDir?: string;
  platform?: string;
  run?: (command: string, args: string[], input?: string | Uint8Array) => string;
}

export function parseICloudAccounts(value: unknown): ICloudAccount[] {
  const rows = Array.isArray(value) ? value : (value as { Accounts?: unknown })?.Accounts;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => typeof row?.AccountID === 'string')
    .map(row => ({
      accountID: row.AccountID,
      email: row.AccountID,
      displayName: typeof row.DisplayName === 'string' ? row.DisplayName : '',
      dsid: row.AccountDSID === undefined ? undefined : String(row.AccountDSID),
      firstName: row.firstName,
      lastName: row.lastName,
      uuid: row.AccountUUID,
      alternateDSID: row.AccountAlternateDSID,
      isLoggedIn: row.LoggedIn === true || row.LoggedIn === 1 || row.LoggedIn === '1',
    }));
}

function runner(options: AccountLookupOptions): NonNullable<AccountLookupOptions['run']> {
  return (
    options.run ??
    ((command, args, input) =>
      execFileSync(command, args, {
        encoding: 'utf8',
        input,
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }))
  );
}

export function getICloudAccountsFromDefaults(options: AccountLookupOptions = {}): ICloudAccount[] {
  if ((options.platform ?? process.platform) !== 'darwin') return [];
  const run = runner(options);
  try {
    const file = join(options.homeDir ?? homedir(), 'Library/Preferences/MobileMeAccounts.plist');
    const accounts = parseICloudAccounts(
      JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file]))
    );
    if (accounts.length > 0) return accounts;
  } catch {
    /* Try defaults when the plist is absent or inaccessible. */
  }
  try {
    const defaults = run('/usr/bin/defaults', ['read', 'MobileMeAccounts', 'Accounts']);
    return parseICloudAccounts(
      JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '--', '-'], defaults))
    );
  } catch {
    return [];
  }
}

export const getICloudAccountsFromPlist = getICloudAccountsFromDefaults;

/**
 * The first string in an NSKeyedArchiver plist, which is how the Accounts
 * database stores each account property. `plutil` can't convert these to
 * JSON, so read the XML form.
 */
function unarchiveString(
  run: NonNullable<AccountLookupOptions['run']>,
  value: Uint8Array
): string | undefined {
  const xml = run('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '--', '-'], value);
  const objects = /<key>\$objects<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? '';
  for (const [, text] of objects.matchAll(/<string>([^<]*)<\/string>/g)) {
    if (text !== '$null') {
      return text
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');
    }
  }
  return undefined;
}

/**
 * Apple Accounts from the system Accounts database
 * (`~/Library/Accounts/Accounts4.sqlite`). Newer macOS versions leave
 * MobileMeAccounts.plist empty; the signed-in Apple Account is kept here, with
 * its DSID as the `personID` property.
 */
export function getICloudAccountsFromAccountsDb(
  options: AccountLookupOptions = {}
): ICloudAccount[] {
  if ((options.platform ?? process.platform) !== 'darwin') return [];
  const run = runner(options);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(options.homeDir ?? homedir(), 'Library/Accounts/Accounts4.sqlite'), {
      readOnly: true,
    });
    const accounts = db
      .prepare(
        `SELECT account.Z_PK AS id, account.ZUSERNAME AS username, account.ZACTIVE AS active
         FROM ZACCOUNT account JOIN ZACCOUNTTYPE type ON account.ZACCOUNTTYPE = type.Z_PK
         WHERE type.ZIDENTIFIER = 'com.apple.account.AppleAccount' AND account.ZUSERNAME IS NOT NULL
         ORDER BY account.Z_PK`
      )
      .all() as Array<{ id: number; username: string; active: number | null }>;
    const properties = db.prepare(
      `SELECT ZKEY AS key, ZVALUE AS value FROM ZACCOUNTPROPERTY
       WHERE ZOWNER = ? AND ZKEY IN ('personID', 'altDSID', 'firstName', 'lastName', 'ACPropertyFullName')`
    );
    return accounts.map(account => {
      const values: { [key: string]: string | undefined } = {};
      for (const { key, value } of properties.all(account.id) as Array<{
        key: string;
        value: Uint8Array | null;
      }>) {
        if (value) values[key] = unarchiveString(run, value);
      }
      return {
        accountID: account.username,
        email: account.username,
        displayName: values.ACPropertyFullName ?? '',
        dsid: values.personID,
        firstName: values.firstName,
        lastName: values.lastName,
        alternateDSID: values.altDSID,
        isLoggedIn: account.active === 1,
      };
    });
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/** Accounts from the preferences, or from the Accounts database when those have none. */
function readAccounts(options: AccountLookupOptions): ICloudAccount[] {
  const accounts = getICloudAccountsFromDefaults(options);
  return accounts.length > 0 ? accounts : getICloudAccountsFromAccountsDb(options);
}

export async function getICloudAccount(
  options: AccountLookupOptions = {}
): Promise<ICloudAccount | null> {
  const accounts = readAccounts(options);
  return accounts.find(account => account.isLoggedIn) ?? accounts[0] ?? null;
}

export function getCurrentICloudUser(options: AccountLookupOptions = {}): string | null {
  const accounts = readAccounts(options);
  return (accounts.find(account => account.isLoggedIn) ?? accounts[0])?.accountID ?? null;
}

/**
 * Build the iCloud account owner as a self `Person` tagged `sameAs: ['@me']`,
 * keyed by the account's DSID (or email) with the email as `handle`. Pass an
 * account, or omit it to look one up with `getICloudAccount(options)`.
 *
 * Returns null when `account` is null or no account can be read (not macOS, no
 * Apple Account signed in, or unreadable account data). Without an iCloud
 * identifier there is nothing to key the owner on, so callers omit them.
 */
export async function buildICloudPersonSchema(
  account?: ICloudAccount | null,
  options: AccountLookupOptions = {}
): Promise<Person | null> {
  const resolved = account === undefined ? await getICloudAccount(options) : account;
  if (!resolved) return null;
  return selfAgent({
    source: 'icloud',
    sourceId: resolved.dsid || resolved.email,
    handle: resolved.email,
  });
}
