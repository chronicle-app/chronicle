import { ChronicleTransformer, Record } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  Location,
  Organization,
  PayAction,
  Payment,
  PaymentCard,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import type { Card, Transaction } from './AppleWalletExtractor.js';

const SOURCE = 'apple-wallet';

/**
 *   PayAction  agent: you   instrument: PaymentCard   location?
 *     result: Payment  amount, currency   recipient: Organization (the merchant)
 *       PaymentCard  issuedBy: Organization (the issuer)
 */
export default class AppleWalletTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'transactions') return [];
    const transaction = record.data as Transaction;
    // Without an iCloud account the payer can't be identified, so omit them.
    const payer = await buildICloudPersonSchema(record.context.account);
    const card = buildCard(transaction.card);
    const location = locationOf(transaction);

    const action: PayAction = {
      '@type': 'PayAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: transaction.identifier,
      timestamp: new Date(transaction.date),
      ...(payer && { agent: payer }),
      ...(card && { instrument: [card] }),
      result: buildPayment(transaction),
      ...(location && { location }),
    };
    return [action];
  }
}

/** The money that moved, keyed like the action, with the merchant as its recipient. */
function buildPayment(transaction: Transaction): Payment {
  const merchant = buildMerchant(transaction);
  return {
    '@type': 'Payment',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: transaction.identifier,
    ...(transaction.amount !== null && { amount: transaction.amount }),
    ...(transaction.currencyCode && { currency: transaction.currencyCode }),
    ...(merchant && { recipient: [merchant] }),
  };
}

/**
 * The merchant, keyed by its name: the issuer sends no merchant ID. The name
 * is the cleaned one when the issuer gives it, else the raw one.
 */
function buildMerchant(transaction: Transaction): Organization | null {
  const name = transaction.merchantName?.trim() || transaction.merchantRawName?.trim();
  return name ? organization(name) : null;
}

/**
 * The card as its account, keyed by the card network's identifier for it,
 * which is the same on every device the card is added to, or by the pass's
 * own ID when the network gives none.
 */
function buildCard(card: Card | null): PaymentCard | null {
  if (!card) return null;
  const issuer = card.organizationName?.trim();
  return {
    '@type': 'PaymentCard',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: card.accountIdentifier ?? card.uniqueId,
    ...(card.description && { name: card.description }),
    ...(card.paymentType && { category: [card.paymentType.toLowerCase()] }),
    ...(issuer && { issuedBy: organization(issuer) }),
  };
}

function organization(name: string): Organization {
  return {
    '@type': 'Organization',
    '@key': ['@type', 'source', 'name'],
    source: SOURCE,
    name,
  };
}

/**
 * Where the transaction happened, when Wallet knows: a fix from the device
 * for an Apple Pay transaction made on it, or the locality the issuer sends.
 * A device without a fix records 0, 0, which is no place on Earth.
 */
function locationOf(transaction: Transaction): Location | null {
  const { latitude, longitude, locality, administrativeArea } = transaction;
  const fix =
    latitude !== null &&
    longitude !== null &&
    !(latitude === 0 && longitude === 0) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180;
  const address = [locality, administrativeArea]
    .map(part => part?.trim())
    .filter(Boolean)
    .join(', ');
  if (!fix && !address) return null;
  return {
    '@type': 'Location',
    ...(fix && { latitude, longitude }),
    ...(address && { address }),
  };
}
