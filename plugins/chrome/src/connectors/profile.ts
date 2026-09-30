import { readFileSync } from 'node:fs';

/** The Google account a Chrome profile is signed in to. */
export interface ChromeAccount {
  gaiaId: string;
  email?: string;
}

/** One of the sync client ids this profile has had, and the day it was added. */
interface DeviceGuid {
  guid: string;
  /** Days since Jan 1, 1601 UTC, as Chrome stores it. */
  day: number;
}

export interface ChromeProfile {
  account: ChromeAccount | null;
  /** Oldest first. Empty when the profile never set up sync. */
  deviceGuids: DeviceGuid[];
}

const MS_PER_DAY = 86_400_000;
// Days from Jan 1, 1601 to Jan 1, 1970.
const CHROME_EPOCH_OFFSET_DAYS = 134_774;

/**
 * Read the profile's `Preferences` JSON. A missing or unreadable file gives an
 * empty profile: visits are still readable, with no agent or instrument.
 */
export function readChromeProfile(preferencesPath: string): ChromeProfile {
  let prefs: any;
  try {
    prefs = JSON.parse(readFileSync(preferencesPath, 'utf8'));
  } catch {
    return { account: null, deviceGuids: [] };
  }
  return { account: readAccount(prefs), deviceGuids: readDeviceGuids(prefs) };
}

// `account_info` lists every Google account signed in on the web as well, so
// the profile's own account is the one `last_gaia_id` names.
function readAccount(prefs: any): ChromeAccount | null {
  const gaiaId = prefs?.google?.services?.last_gaia_id ?? prefs?.sync?.gaia_id;
  if (typeof gaiaId !== 'string' || gaiaId === '') return null;
  const info = Array.isArray(prefs?.account_info)
    ? prefs.account_info.find((a: any) => a?.gaia === gaiaId)
    : undefined;
  const email = typeof info?.email === 'string' && info.email !== '' ? info.email : undefined;
  return { gaiaId, ...(email && { email }) };
}

// A new sync client id is added when sync is set up again, so the list holds
// this profile's ids over time.
function readDeviceGuids(prefs: any): DeviceGuid[] {
  const entries = prefs?.sync?.local_device_guids_with_timestamp;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e: any) => typeof e?.cache_guid === 'string' && typeof e?.timestamp === 'number')
    .map((e: any) => ({ guid: e.cache_guid, day: e.timestamp }))
    .sort((a, b) => a.day - b.day);
}

/**
 * The sync client id this profile had at a time: the newest one added on or
 * before that day, or the oldest one for visits older than all of them.
 */
export function deviceGuidAt(profile: ChromeProfile, unixMs: number): string | null {
  const { deviceGuids } = profile;
  if (deviceGuids.length === 0) return null;
  const day = Math.floor(unixMs / MS_PER_DAY) + CHROME_EPOCH_OFFSET_DAYS;
  let current = deviceGuids[0];
  for (const entry of deviceGuids) {
    if (entry.day <= day) current = entry;
  }
  return current.guid;
}
