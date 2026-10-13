import { ChronicleTransformer, Record, reference } from '@chronicle.app/etl';
import {
  ActionAndChildren,
  FinancialAccount,
  Location,
  MonetaryAmount,
  Organization,
  PayAction,
  PaymentCard,
  Person,
  Posting,
  Transaction,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import type { Card, WalletTransaction } from './AppleWalletExtractor.js';

const SOURCE = 'apple-wallet';

/**
 *   PayAction  agent: you   instrument: PaymentCard   location?
 *     PaymentCard  issuedBy: Organization (the issuer)   holder: you, by key
 *       account: FinancialAccount (the card, as far as Wallet knows)
 *     result: Transaction  amount: MonetaryAmount   recipient: Organization (the merchant)
 *       posting: Posting  amount: MonetaryAmount (negative)   account: the card's account, by key
 *
 * A node that appears again carries only its identity (`reference`), and the
 * fold merges it with the full node by its key.
 */
export default class AppleWalletTransformer extends ChronicleTransformer {
  static override source = SOURCE;

  async transform(record: Record): Promise<ActionAndChildren[]> {
    if (record.extraction.recordType !== 'transactions') return [];
    const transaction = record.data as WalletTransaction;
    // Without an iCloud account the payer can't be identified, so omit them.
    const payer = await buildICloudPersonSchema(record.context.account);
    const card = buildCard(transaction.card, payer);
    const location = locationOf(transaction);

    const action: PayAction = {
      '@type': 'PayAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: transaction.identifier,
      timestamp: new Date(transaction.date),
      ...(payer && { agent: payer }),
      ...(card && { instrument: [card] }),
      result: buildTransaction(transaction, card?.account ?? null),
      ...(location && { location }),
    };
    return [action];
  }
}

/**
 * The money that moved, keyed like the action, with the merchant as its
 * recipient and the card account's side as its one posting.
 */
function buildTransaction(
  transaction: WalletTransaction,
  account: FinancialAccount | null
): Transaction {
  const merchant = buildMerchant(transaction);
  const posting =
    account && transaction.amount !== null ? buildPosting(transaction, account) : null;
  return {
    '@type': 'Transaction',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: transaction.identifier,
    ...(transaction.amount !== null && {
      amount: money(transaction.amount, transaction.currencyCode),
    }),
    ...(merchant && { recipient: [merchant] }),
    ...(posting && { posting: [posting] }),
  };
}

/**
 * The card account's side of the purchase, keyed by the transaction and the
 * account. A purchase is negative on the account that paid, whichever kind
 * it is: it adds to what a credit card owes, and takes from what a debit
 * card holds.
 */
function buildPosting(transaction: WalletTransaction, account: FinancialAccount): Posting {
  const amount = transaction.amount!;
  return {
    '@type': 'Posting',
    '@key': ['@type', 'source', 'sourceId', 'account.sourceId'],
    source: SOURCE,
    sourceId: transaction.identifier,
    amount: money(amount === 0 ? 0 : -amount, transaction.currencyCode),
    account: reference(account),
  };
}

/** A sum of money, with its currency when Wallet gives one. */
function money(value: number, currency: string | null): MonetaryAmount {
  return { '@type': 'MonetaryAmount', value, ...(currency && { currency }) };
}

/**
 * The merchant, keyed by its name: the issuer sends no merchant ID. The name
 * is the cleaned one when the issuer gives it, else the raw one.
 */
function buildMerchant(transaction: WalletTransaction): Organization | null {
  const name = transaction.merchantName?.trim() || transaction.merchantRawName?.trim();
  return name ? organization(name) : null;
}

/**
 * The card as issued, keyed by the card network's identifier for it, which is
 * the same on every device the card is added to, or by the pass's own ID when
 * the network gives none. A card reissued with a new number is a new card.
 * Its last digits are another name Wallet shows it by.
 */
function buildCard(card: Card | null, holder: Person | null): PaymentCard | null {
  if (!card) return null;
  const issuer = card.organizationName?.trim();
  const sourceId = card.accountIdentifier ?? card.uniqueId;
  return {
    '@type': 'PaymentCard',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId,
    ...(card.description && { name: card.description }),
    ...(card.accountSuffix && { alternateName: [card.accountSuffix] }),
    ...(card.paymentType && { category: [card.paymentType.toLowerCase()] }),
    ...(issuer && { issuedBy: organization(issuer) }),
    ...(holder && { holder: [reference(holder)] }),
    account: buildAccount(card, sourceId, holder),
  };
}

// A credit card owes, so its account is a liability. A debit or prepaid card
// holds, so its account is an asset.
const ACCOUNT_TYPES: { [paymentType: string]: string } = {
  credit: 'liability',
  debit: 'asset',
  prepaid: 'asset',
};

/**
 * The account the card draws on, as far as Wallet can tell: the card itself.
 * Wallet has no account number, so the account is keyed like the card and
 * named as the card is, and a card reissued with a new number splits it until
 * a ledger names the account.
 */
function buildAccount(card: Card, sourceId: string, holder: Person | null): FinancialAccount {
  const issuer = card.organizationName?.trim();
  const accountType = card.paymentType && ACCOUNT_TYPES[card.paymentType.toLowerCase()];
  return {
    '@type': 'FinancialAccount',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId,
    ...(card.description && { name: card.description }),
    ...(card.accountSuffix && { alternateName: [card.accountSuffix] }),
    ...(accountType && { accountType }),
    ...(issuer && { provider: organization(issuer) }),
    ...(holder && { holder: [reference(holder)] }),
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
function locationOf(transaction: WalletTransaction): Location | null {
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
