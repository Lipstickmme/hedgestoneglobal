'use strict';

/**
 * Opening accounts and issuing the plastic that goes with them.
 *
 * An account number, a card number and a statement cycle all have to be
 * generated together and consistently, so the console, the seeder and the
 * product pages all come through here.
 */

const { db } = require('./db');
const ids = require('./ids');
const ledger = require('./ledger');
const { ACCOUNT_TYPES, PRODUCTS, BANK } = require('./constants');
const settings = require('./settings');

const nowIso = () => new Date().toISOString();

function productById(productId) {
  return PRODUCTS.find((p) => p.id === productId) || null;
}

/**
 * Open a deposit or credit account for a customer.
 *
 * `openingBalance` posts a real opening entry rather than writing a balance
 * straight onto the account, so the first line of the first statement says
 * where the money came from.
 */
async function openAccount(user, input = {}) {
  const cfg = await settings.get();
  const product = productById(input.productId);
  const type = input.type || (product && product.type) || 'checking';
  const meta = ACCOUNT_TYPES[type] || ACCOUNT_TYPES.checking;

  const account = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: user.id,
    type,
    product_id: product ? product.id : null,
    name: input.name || (product && product.name) || meta.label,
    nickname: input.nickname || '',
    account_number: input.accountNumber || ids.accountNumber(type),
    routing_number: cfg.routingNumber || BANK.routingNumber,
    swift: BANK.swift,
    currency: input.currency || 'USD',
    status: input.status || 'active',
    balance: 0,
    opening_balance: 0,
    hold_amount: 0,
    available_balance: 0,
    credit_limit: Number(input.creditLimit || (product && product.creditLimit) || 0),
    overdraft_limit: Number(input.overdraftLimit || (product && product.overdraftLimit) || 0),
    overdraft_protection: input.overdraftProtection !== false,
    interest_rate: Number(input.interestRate ?? (product && (product.apy ?? product.apr)) ?? 0),
    apy: Number(input.apy ?? (product && product.apy) ?? 0),
    apr: Number(input.apr ?? (product && product.apr) ?? 0),
    minimum_balance: Number(input.minimumBalance ?? (product && product.minimumBalance) ?? 0),
    monthly_fee: Number(input.monthlyFee ?? (product && product.monthlyFee) ?? 0),
    term_months: Number(input.termMonths ?? (product && product.termMonths) ?? 0),
    maturity_date: input.maturityDate || null,
    statement_day: Number(input.statementDay || 1),
    opened_at: input.openedAt || nowIso(),
    closed_at: null,
    last_activity_at: nowIso(),
    is_primary: Boolean(input.isPrimary),
    notes: input.notes || '',
  };

  await db.accounts.insert(account);

  const opening = Math.round(Number(input.openingBalance || 0));
  if (opening > 0) {
    await ledger.post({
      accountId: account.id,
      direction: meta.sign === -1 ? 'debit' : 'credit',
      amount: opening,
      description: input.openingDescription || 'Opening deposit',
      method: input.openingMethod || 'adjustment',
      category: 'Income',
      status: 'posted',
      createdBy: input.createdBy || 'admin',
      createdById: input.createdById || null,
      date: input.openingDate || account.opened_at,
      memo: 'Account opened',
    });
  }

  return db.accounts.findById(account.id);
}

/** A debit or credit card attached to an account. */
async function issueCard(user, account, input = {}) {
  const brand = input.brand || 'visa';
  const kind = input.kind || (account.type === 'credit' ? 'credit' : 'debit');
  const number = ids.cardNumber(brand, kind);
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + (input.years || 4));

  const card = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: user.id,
    account_id: account.id,
    brand,
    kind,
    number_encrypted: require('./security').encrypt(number),
    last4: number.slice(-4),
    bin: number.slice(0, 6),
    name_on_card: input.nameOnCard || `${user.first_name} ${user.last_name}`.toUpperCase().trim(),
    exp_month: expires.getUTCMonth() + 1,
    exp_year: expires.getUTCFullYear(),
    cvv_encrypted: require('./security').encrypt(ids.cvv()),
    status: input.status || 'active',
    design: input.design || 'bedrock',
    daily_purchase_limit: Number(input.dailyPurchaseLimit || 750000),
    daily_atm_limit: Number(input.dailyAtmLimit || 100000),
    contactless: input.contactless !== false,
    international_allowed: Boolean(input.internationalAllowed),
    online_allowed: input.onlineAllowed !== false,
    pin_set: true,
    activated_at: input.activated === false ? null : nowIso(),
    replaced_card_id: input.replacedCardId || null,
    notes: input.notes || '',
  };
  await db.cards.insert(card);
  return card;
}

/** What a browser may see about a card. Never the PAN, never the CVV. */
function publicCard(card) {
  if (!card) return null;
  return {
    id: card.id,
    accountId: card.account_id,
    brand: card.brand,
    kind: card.kind,
    last4: card.last4,
    masked: `•••• •••• •••• ${card.last4}`,
    nameOnCard: card.name_on_card,
    expires: `${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)}`,
    status: card.status,
    design: card.design,
    dailyPurchaseLimit: card.daily_purchase_limit,
    dailyAtmLimit: card.daily_atm_limit,
    contactless: card.contactless,
    internationalAllowed: card.international_allowed,
    onlineAllowed: card.online_allowed,
    activatedAt: card.activated_at,
    createdAt: card.created_at,
  };
}

/** What a browser may see about an account. */
function publicAccount(account) {
  if (!account) return null;
  const meta = ACCOUNT_TYPES[account.type] || ACCOUNT_TYPES.checking;
  return {
    id: account.id,
    type: account.type,
    typeLabel: meta.label,
    code: meta.code,
    name: account.name,
    nickname: account.nickname,
    accountNumber: account.account_number,
    accountMask: ids.maskAccount(account.account_number),
    last4: String(account.account_number || '').slice(-4),
    routingNumber: account.routing_number,
    swift: account.swift,
    currency: account.currency,
    status: account.status,
    balance: Number(account.balance || 0),
    availableBalance: ledger.availableFor(account),
    holdAmount: Number(account.hold_amount || 0),
    creditLimit: Number(account.credit_limit || 0),
    overdraftLimit: Number(account.overdraft_limit || 0),
    interestRate: account.interest_rate,
    apy: account.apy,
    apr: account.apr,
    minimumBalance: account.minimum_balance,
    monthlyFee: account.monthly_fee,
    termMonths: account.term_months,
    maturityDate: account.maturity_date,
    statementDay: account.statement_day,
    openedAt: account.opened_at,
    closedAt: account.closed_at,
    lastActivityAt: account.last_activity_at,
    isPrimary: Boolean(account.is_primary),
    isCredit: meta.sign === -1,
  };
}

/** Accounts a customer can move money out of right now. */
async function spendableAccounts(userId) {
  const rows = await db.accounts.find({ user_id: userId, status: 'active' }, { order: 'created_at.asc' });
  return rows.filter((a) => a.type !== 'cd' && a.type !== 'loan' && a.type !== 'mortgage');
}

module.exports = { openAccount, issueCard, publicAccount, publicCard, productById, spendableAccounts };
