/**
 * @chronicle.app/apple
 *
 * Apple data for Chronicle plugins on macOS: the Apple Account signed in,
 * AddressBook contact resolution, and binary property lists.
 */

// Account utilities and types
export {
  getICloudAccount,
  getICloudAccountsFromDefaults,
  getICloudAccountsFromAccountsDb,
  getICloudAccountsFromPlist,
  getCurrentICloudUser,
  buildICloudPersonSchema,
  type ICloudAccount,
} from './account.js';

// AddressBook utilities and types
export {
  lookupContact,
  lookupContactByEmail,
  lookupContactByPhone,
  lookupContactByName,
  getAllContactsWithEmails,
  type Contact,
} from './addressbook.js';

export { ContactCache } from './addressbook.js';
export { parseICloudAccounts, type AccountLookupOptions } from './account.js';

// Binary property lists
export { parseBinaryPlist, Uid, type PlistValue } from './plist.js';
