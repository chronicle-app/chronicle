import { ChronicleTransformer, Record, reference } from '@chronicle.app/etl';
import {
  AccountEntry,
  ActionAndChildren,
  Agent,
  FinancialAccount,
  FinancialTransaction,
  Location,
  MonetaryAmount,
  Organization,
  PayAction,
  PaymentCard,
  Person,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/icloud';
import type { Card, WalletTransaction } from './AppleWalletExtractor.js';

const SOURCE = 'apple-wallet';

/**
 *   PayAction  agent: you   instrument: PaymentCard   location?
 *     PaymentCard  inAccount: FinancialAccount (the card, as far as Wallet knows)
 *       FinancialAccount  provider: Organization (the issuer)   member: you, by key
 *     result: FinancialTransaction  amount: MonetaryAmount   recipient: Agent (the merchant)
 *       hasPart: AccountEntry  amount: MonetaryAmount (negative)   inAccount: the account, by key
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
    const account = transaction.card ? buildAccount(transaction.card, payer) : null;
    const card = transaction.card && account ? buildCard(transaction.card, account) : null;
    const location = locationOf(transaction);

    const action: PayAction = {
      '@type': 'PayAction',
      '@key': ['@type', 'source', 'sourceId'],
      source: SOURCE,
      sourceId: transaction.identifier,
      timestamp: new Date(transaction.date),
      ...(payer && { agent: payer }),
      ...(card && { instrument: [card] }),
      result: buildTransaction(transaction, account),
      ...(location && { location }),
    };
    return [action];
  }
}

/**
 * The money that moved, keyed like the action, with the merchant as its
 * recipient and the card account's side as its one entry.
 */
function buildTransaction(
  transaction: WalletTransaction,
  account: FinancialAccount | null
): FinancialTransaction {
  const merchant = buildMerchant(transaction);
  const entry = account && transaction.amount !== null ? buildEntry(transaction, account) : null;
  return {
    '@type': 'FinancialTransaction',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: transaction.identifier,
    ...(transaction.amount !== null && {
      amount: money(transaction.amount, transaction.currencyCode),
    }),
    ...(merchant && { recipient: [merchant] }),
    ...(entry && { hasPart: [entry] }),
  };
}

/**
 * The card account's side of the purchase, keyed by the transaction and the
 * account, and given under `hasPart`, the inverse of `isPartOf`. A purchase is
 * negative on the account that paid, whichever kind it is: it adds to what a
 * credit card owes, and takes from what a debit card holds.
 */
function buildEntry(transaction: WalletTransaction, account: FinancialAccount): AccountEntry {
  const amount = transaction.amount!;
  return {
    '@type': 'AccountEntry',
    '@key': ['@type', 'source', 'sourceId', 'inAccount[*].sourceId'],
    source: SOURCE,
    sourceId: transaction.identifier,
    amount: money(amount === 0 ? 0 : -amount, transaction.currencyCode),
    inAccount: [reference(account)],
  };
}

/** A sum of money, with its currency when Wallet gives one. */
function money(value: number, currency: string | null): MonetaryAmount {
  return { '@type': 'MonetaryAmount', value, ...(currency && { currency }) };
}

/**
 * The merchant as the issuer names it. A billing descriptor can name a
 * company, a branch, a processor, or a person, so it is an Agent keyed by its
 * name alone, which a source that knows the kind can refine. The name is the
 * cleaned one when Wallet has it, else the raw one.
 */
function buildMerchant(transaction: WalletTransaction): Agent | null {
  const name = transaction.merchantName?.trim() || transaction.merchantRawName?.trim();
  if (!name) return null;
  return { '@type': 'Agent', '@key': ['source', 'name'], source: SOURCE, name };
}

/** The card network's identifier for the card, or the pass's own ID when the network gives none. */
function cardIdOf(card: Card): string {
  return card.accountIdentifier ?? card.uniqueId;
}

/**
 * The card as issued, keyed by the card network's identifier for it, which is
 * the same on every device the card is added to. A card reissued with a new
 * number is a new card. Its last digits are another name Wallet shows it by.
 */
function buildCard(card: Card, account: FinancialAccount): PaymentCard {
  return {
    '@type': 'PaymentCard',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: cardIdOf(card),
    ...(card.description && { name: card.description }),
    ...(card.accountSuffix && { alternateName: [card.accountSuffix] }),
    ...(card.paymentType && { category: [card.paymentType.toLowerCase()] }),
    inAccount: [account],
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
 * named after the card's product, and a card reissued with a new number splits
 * it until a ledger names the account. The card number's last digits stay on
 * the card: a reissue changes them while the account continues.
 */
function buildAccount(card: Card, holder: Person | null): FinancialAccount {
  const issuer = card.organizationName?.trim();
  const accountType = card.paymentType && ACCOUNT_TYPES[card.paymentType.toLowerCase()];
  return {
    '@type': 'FinancialAccount',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: cardIdOf(card),
    ...(card.description && { name: card.description }),
    ...(accountType && { accountType }),
    ...(issuer && { provider: organization(issuer) }),
    ...(holder && { member: [reference(holder)] }),
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
