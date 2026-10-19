'use strict';

/**
 * Cash balances, the entries against them, and the dashboard's overview.
 *
 * Every handler scopes its reads to req.bankUser.id before anything else. A
 * customer asking for someone else's account id gets a 404, not a 403: there
 * is no reason to confirm that the id exists.
 */

const { db } = require('../../bank/db');
const ledger = require('../../bank/ledger');
const accountsLib = require('../../bank/accounts');
const audit = require('../../bank/audit');
const ids = require('../../bank/ids');
const { asyncHandler, fail, page, csv } = require('../../bank/http');
const { CATEGORIES, TRANSACTION_METHODS, ACCOUNT_TYPES } = require('../../bank/constants');

/** Find an account this customer owns, or refuse to admit it exists. */
async function ownedAccount(user, accountId) {
  const account = await db.accounts.findById(accountId);
  if (!account || account.user_id !== user.id) throw fail(404, 'Account not found.');
  return account;
}

/** The shape of a transaction that goes to the browser. */
function publicTransaction(tx, account) {
  return {
    id: tx.id,
    accountId: tx.account_id,
    accountName: account ? (account.nickname || account.name) : '',
    accountLast4: account ? String(account.account_number).slice(-4) : '',
    date: tx.date,
    postedAt: tx.posted_at,
    createdAt: tx.created_at,
    direction: tx.direction,
    amount: tx.amount,
    signedAmount: tx.direction === 'credit' ? tx.amount : -tx.amount,
    currency: tx.currency,
    description: tx.description,
    merchant: tx.merchant,
    category: tx.category,
    method: tx.method,
    methodLabel: (TRANSACTION_METHODS[tx.method] || {}).label || tx.method,
    status: tx.status,
    balanceAfter: tx.balance_after,
    reference: tx.reference,
    traceNumber: tx.trace_number,
    checkNumber: tx.check_number,
    memo: tx.memo,
    location: tx.location,
    counterparty: tx.counterparty,
    transferId: tx.transfer_id,
    createdBy: tx.created_by,
    adminNote: tx.admin_note,
  };
}

/** Apply the filter panel to a list of entries. */
function filterTransactions(rows, query = {}) {
  const q = String(query.q || '').trim().toLowerCase();
  return rows.filter((tx) => {
    if (query.accountId && tx.account_id !== query.accountId) return false;
    if (query.direction && tx.direction !== query.direction) return false;
    if (query.status && tx.status !== query.status) return false;
    if (query.category && tx.category !== query.category) return false;
    if (query.method && tx.method !== query.method) return false;
    if (query.from && tx.date < new Date(query.from).toISOString()) return false;
    if (query.to && tx.date > new Date(`${query.to}T23:59:59.999Z`).toISOString()) return false;
    if (query.min && Number(tx.amount) < Math.round(Number(query.min) * 100)) return false;
    if (query.max && Number(tx.amount) > Math.round(Number(query.max) * 100)) return false;
    if (q) {
      const haystack = `${tx.description} ${tx.merchant} ${tx.category} ${tx.memo} ${tx.reference}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------ accounts --- */

const list = asyncHandler(async (req, res) => {
  const rows = await db.accounts.find({ user_id: req.bankUser.id }, { order: 'created_at.asc' });
  res.json({ accounts: rows.map(accountsLib.publicAccount) });
});

/* -------------------------------------------------------- transactions --- */

const transactions = asyncHandler(async (req, res) => {
  const { limit, offset } = page(req.query);
  const accounts = await db.accounts.find({ user_id: req.bankUser.id });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  if (req.query.accountId && !byId.has(req.query.accountId)) throw fail(404, 'Account not found.');

  const all = await db.transactions.find({ user_id: req.bankUser.id }, { order: 'date.desc' });
  const filtered = filterTransactions(all, req.query);
  const slice = filtered.slice(offset, offset + limit);

  res.json({
    transactions: slice.map((t) => publicTransaction(t, byId.get(t.account_id))),
    total: filtered.length,
    limit,
    offset,
    filters: {
      categories: CATEGORIES,
      methods: Object.entries(TRANSACTION_METHODS).map(([id, m]) => ({ id, label: m.label })),
      accounts: accounts.map((a) => ({ id: a.id, label: `${a.nickname || a.name} ${ids.maskAccount(a.account_number)}` })),
    },
  });
});

const transactionDetail = asyncHandler(async (req, res) => {
  const tx = await db.transactions.findById(req.params.id);
  if (!tx || tx.user_id !== req.bankUser.id) throw fail(404, 'Transaction not found.');
  const account = await db.accounts.findById(tx.account_id);
  const transfer = tx.transfer_id ? await db.transfers.findById(tx.transfer_id) : null;
  res.json({
    transaction: publicTransaction(tx, account),
    transfer: transfer ? require('../../bank/transfers').publicTransfer(transfer) : null,
  });
});

/** The same list, as a file the customer can open in a spreadsheet. */
const exportTransactions = asyncHandler(async (req, res) => {
  const accounts = await db.accounts.find({ user_id: req.bankUser.id });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const all = await db.transactions.find({ user_id: req.bankUser.id }, { order: 'date.desc' });
  const rows = filterTransactions(all, req.query);

  const body = csv(rows, [
    { label: 'Date', value: (r) => String(r.date).slice(0, 10) },
    { label: 'Account', value: (r) => { const a = byId.get(r.account_id); return a ? `${a.nickname || a.name} ${String(a.account_number).slice(-4)}` : ''; } },
    { label: 'Description', value: 'description' },
    { label: 'Category', value: 'category' },
    { label: 'Method', value: (r) => (TRANSACTION_METHODS[r.method] || {}).label || r.method },
    { label: 'Status', value: 'status' },
    { label: 'Debit', value: (r) => (r.direction === 'debit' ? (r.amount / 100).toFixed(2) : '') },
    { label: 'Credit', value: (r) => (r.direction === 'credit' ? (r.amount / 100).toFixed(2) : '') },
    { label: 'Balance', value: (r) => (r.balance_after == null ? '' : (r.balance_after / 100).toFixed(2)) },
    { label: 'Reference', value: 'reference' },
  ]);

  await audit.log({
    action: 'account.exported', category: 'account', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Exported ${rows.length} transactions to CSV`,
  });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(body);
});

/* ------------------------------------------------------------ overview --- */

/**
 * The cash side of the dashboard, in one round trip: what is in the cash
 * balance, what is available to invest or withdraw, recent entries and
 * withdrawals. The Bitcoin side comes from /invest.
 */
const overview = asyncHandler(async (req, res) => {
  const user = req.bankUser;
  const [accounts, allTx, transfers, alertRows, messages] = await Promise.all([
    db.accounts.find({ user_id: user.id }, { order: 'created_at.asc' }),
    db.transactions.find({ user_id: user.id }, { order: 'date.desc', limit: 50 }),
    db.transfers.find({ user_id: user.id }, { order: 'created_at.desc', limit: 20 }),
    db.alerts.find({ user_id: user.id }, { order: 'created_at.desc', limit: 8 }),
    db.messages.find({ user_id: user.id, from_side: 'bank', read_at: null }),
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cash = accounts.filter((a) => (ACCOUNT_TYPES[a.type] || {}).sign !== -1 && a.status !== 'closed');

  res.json({
    user: require('../../bank/users').publicUser(user, 'self'),
    totals: {
      deposits: cash.reduce((s, a) => s + Number(a.balance || 0), 0),
      available: cash.reduce((s, a) => s + ledger.availableFor(a), 0),
    },
    accounts: cash.map(accountsLib.publicAccount),
    recent: allTx.slice(0, 10).map((t) => publicTransaction(t, byId.get(t.account_id))),
    pending: allTx.filter((t) => t.status === 'pending').map((t) => publicTransaction(t, byId.get(t.account_id))),
    transfers: transfers.slice(0, 6).map(require('../../bank/transfers').publicTransfer),
    alerts: alertRows.map((a) => ({
      id: a.id, type: a.type, subject: a.subject, preview: a.preview,
      createdAt: a.created_at, readAt: a.read_at, severity: a.severity, status: a.status,
    })),
    unreadMessages: messages.length,
  });
});

module.exports = {
  list,
  transactions,
  transactionDetail,
  exportTransactions,
  overview,
  publicTransaction,
  ownedAccount,
  filterTransactions,
};
