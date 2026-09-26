// Export extractors for plugin scanning
export { WhatsappExtractor } from './connectors/WhatsappExtractor.js';
export { WhatsappBackupExtractor } from './connectors/WhatsappBackupExtractor.js';
export { default as WhatsappTransformer } from './connectors/WhatsappTransformer.js';
export { parseJid, isConversationJid } from './jid.js';
export { extractFromIosBackup } from './iosBackup.js';
export type { IosBackupSources, ExtractFromIosBackupOptions } from './iosBackup.js';
