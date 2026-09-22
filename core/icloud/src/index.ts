/**
 * @chronicle.app/icloud
 *
 * iCloud utilities for Chronicle plugins on macOS: account lookup and
 * AddressBook contact resolution.
 */

// Account utilities and types
export {
  getICloudAccount,
  getICloudAccountsFromDefaults,
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
