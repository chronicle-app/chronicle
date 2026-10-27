/**
 * @chronicle.app/apple
 *
 * Apple data for Chronicle plugins on macOS: the Apple Account signed in,
 * AddressBook contact resolution, binary property lists, and Messages'
 * group chats.
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

// Messages' group chats
export { GROUP_CHAT_STYLE, groupChatChannel, type GroupChatIds } from './messages.js';

// Binary property lists
export { parseBinaryPlist, Uid, type PlistValue } from './plist.js';
