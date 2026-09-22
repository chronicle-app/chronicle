/** Local account discovery adapted from the internal macOS iCloud helper. */
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { selfAgent } from '@chronicle.app/etl';

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
  run?: (command: string, args: string[], input?: string) => string;
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

export function getICloudAccountsFromDefaults(options: AccountLookupOptions = {}): ICloudAccount[] {
  if ((options.platform ?? process.platform) !== 'darwin') return [];
  const run =
    options.run ??
    ((command, args, input) =>
      execFileSync(command, args, {
        encoding: 'utf8',
        input,
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      }));
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

export async function getICloudAccount(
  options: AccountLookupOptions = {}
): Promise<ICloudAccount | null> {
  const accounts = getICloudAccountsFromDefaults(options);
  return accounts.find(account => account.isLoggedIn) ?? accounts[0] ?? null;
}

export function getCurrentICloudUser(options: AccountLookupOptions = {}): string | null {
  const accounts = getICloudAccountsFromDefaults(options);
  return (accounts.find(account => account.isLoggedIn) ?? accounts[0])?.accountID ?? null;
}

export async function buildICloudPersonSchema(
  account?: ICloudAccount | null
): Promise<ReturnType<typeof selfAgent>> {
  const resolved = account === undefined ? await getICloudAccount() : account;
  return selfAgent({
    source: 'icloud',
    ...(resolved && {
      sourceId: resolved.dsid || resolved.email,
      handle: resolved.email,
    }),
  });
}
