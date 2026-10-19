'use strict';

/**
 * Opening a customer's cash balance, the account their Bitcoin is bought
 * from and sold back into.
 *
 * The account number and the opening deposit have to be created together and
 * consistently, so the console and the seeder both come through here.
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

module.exports = { openAccount, publicAccount, productById, spendableAccounts };
