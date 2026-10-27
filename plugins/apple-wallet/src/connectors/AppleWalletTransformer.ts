import { ChronicleTransformer, Record, reference } from '@chronicle.app/etl';
import {
  FinancialPosting,
  ActionAndChildren,
  Agent,
  FinancialAccount,
  FinancialTransaction,
  Location,
  MonetaryAmount,
  PayAction,
  PaymentCard,
} from '@chronicle.app/schema';
import { buildICloudPersonSchema } from '@chronicle.app/apple';
import type { Card, WalletTransaction } from './AppleWalletExtractor.js';

const SOURCE = 'apple-wallet';

/**
 *   PayAction  agent: you   instrument: PaymentCard   location?
 *     PaymentCard (the product)  inAccount: FinancialAccount (the issuer; by its account id, else the card's)
 *     result: FinancialTransaction  amount: MonetaryAmount   recipient: Agent (the merchant)
 *       hasPart: FinancialPosting  amount: MonetaryAmount (negative)   inAccount: the account, by key
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
    const account = transaction.card ? buildAccount(transaction.card) : null;
    const card = transaction.card && account ? buildCard(transaction.card, account) : null;
    const location = locationOf(transaction);

    const action: PayAction = {
      '@type': 'PayAction',
      // Keyed by the transaction it made, which has Wallet's ID for it.
      '@key': ['@type', 'source', 'result.sourceId'],
      source: SOURCE,
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
 * recipient and the card account's side as its one posting.
 */
function buildTransaction(
  transaction: WalletTransaction,
  account: FinancialAccount | null
): FinancialTransaction {
  const merchant = buildMerchant(transaction);
  const posting =
    account && transaction.amount !== null ? buildPosting(transaction, account) : null;
  return {
    '@type': 'FinancialTransaction',
    '@key': ['@type', 'source', 'sourceId'],
    source: SOURCE,
    sourceId: transaction.identifier,
    ...(transaction.amount !== null && {
      amount: money(transaction.amount, transaction.currencyCode),
    }),
    ...(merchant && { recipient: [merchant] }),
    ...(posting && { hasPart: [posting] }),
  };
}

/**
 * The card account's side of the purchase, keyed by the transaction it's part
 * of (the action's result, which has Wallet's ID) and the account, and given
 * under `hasPart`, the inverse of `isPartOf`. A purchase is
 * negative on the account that paid, whichever kind it is: it adds to what a
 * credit card owes, and takes from what a debit card holds.
 */
function buildPosting(transaction: WalletTransaction, account: FinancialAccount): FinancialPosting {
  const amount = transaction.amount!;
  return {
    '@type': 'FinancialPosting',
    '@key': ['@type', 'source', 'action.result.sourceId', 'inAccount[*].sourceId'],
    source: SOURCE,
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
  return card.cardIdentifier ?? card.uniqueId;
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
 * The account the card draws on, keyed by the issuer's identifier for it when
 * the issuer gives one, which outlives the card number. Otherwise the account
 * is the card as far as Wallet can tell: keyed by the card the payment used
 * (the action's instrument), so it doesn't take the card's ID as its own, and
 * split by a reissue with a new number until a ledger names the account. It is named
 * after the issuer, as a chart of accounts names it, while the card is named
 * after the product. The card number's last digits stay on the card: a reissue
 * changes them while the account continues.
 */
function buildAccount(card: Card): FinancialAccount {
  const issuer = card.organizationName?.trim();
  const financialAccountType = card.paymentType && ACCOUNT_TYPES[card.paymentType.toLowerCase()];
  return {
    '@type': 'FinancialAccount',
    ...(card.issuerAccountIdentifier
      ? { '@key': ['@type', 'source', 'sourceId'], sourceId: card.issuerAccountIdentifier }
      : { '@key': ['@type', 'source', 'action.instrument[*].sourceId'] }),
    source: SOURCE,
    ...(issuer && { name: issuer }),
    ...(financialAccountType && { financialAccountType }),
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
