'use strict';

/**
 * Accounts, the entries against them, statements and cards.
 *
 * Every handler scopes its reads to req.bankUser.id before anything else. A
 * customer asking for someone else's account id gets a 404, not a 403: there
 * is no reason to confirm that the id exists.
 */

const { db } = require('../../bank/db');
const ledger = require('../../bank/ledger');
const accountsLib = require('../../bank/accounts');
const alerts = require('../../bank/alerts');
const audit = require('../../bank/audit');
const contact = require('../../bank/contact');
const ids = require('../../bank/ids');
const { asyncHandler, fail, page, csv, money } = require('../../bank/http');
const { CATEGORIES, TRANSACTION_METHODS, ACCOUNT_TYPES, BANK } = require('../../bank/constants');

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

const detail = asyncHandler(async (req, res) => {
  const account = await ownedAccount(req.bankUser, req.params.id);
  const [recent, cards] = await Promise.all([
    db.transactions.find({ account_id: account.id }, { order: 'date.desc', limit: 10 }),
    db.cards.find({ account_id: account.id }),
  ]);
  res.json({
    account: accountsLib.publicAccount(account),
    recent: recent.map((t) => publicTransaction(t, account)),
    cards: cards.map(accountsLib.publicCard),
    details: {
      routingNumber: account.routing_number,
      accountNumber: account.account_number,
      swift: account.swift,
      bankName: BANK.name,
      // Empty until an operator sets it. A wire needs a real beneficiary bank
      // address, so an invented one here is worse than none: the customer
      // would quote it to a sending bank.
      bankAddress: contact.addressLine(),
      wireInstructions: `Beneficiary: ${req.bankUser.first_name} ${req.bankUser.last_name} | Account ${account.account_number} | ABA ${account.routing_number} | SWIFT ${account.swift}`,
    },
  });
});

/** Give an account a name the customer recognises. */
const rename = asyncHandler(async (req, res) => {
  const account = await ownedAccount(req.bankUser, req.params.id);
  const nickname = String(req.body.nickname || '').trim().slice(0, 40);
  await db.accounts.update(account.id, { nickname });
  await audit.log({
    action: 'account.renamed', category: 'account', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Renamed account ${ids.maskAccount(account.account_number)} to "${nickname}"`,
  });
  res.json({ account: accountsLib.publicAccount({ ...account, nickname }) });
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
    dispute: (await db.disputes.find({ transaction_id: tx.id }))[0] || null,
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
  res.setHeader('Content-Disposition', `attachment; filename="rockfield-transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(body);
});

/* ----------------------------------------------------------- statements --- */

const statements = asyncHandler(async (req, res) => {
  const account = await ownedAccount(req.bankUser, req.params.id);
  const periods = ledger.recentPeriods(12);
  const out = [];
  for (const period of periods) {
    if (period.end < new Date(account.opened_at)) continue;
    const statement = await ledger.statement(account, period.start, period.end);
    out.push({
      id: statement.id,
      label: period.label,
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      opening: statement.opening,
      closing: statement.closing,
      credits: statement.credits,
      debits: statement.debits,
      entries: statement.transactions.length,
    });
  }
  res.json({ account: accountsLib.publicAccount(account), statements: out });
});

const statementDetail = asyncHandler(async (req, res) => {
  const account = await ownedAccount(req.bankUser, req.params.id);
  const [year, month] = String(req.params.period || '').split('-').map(Number);
  if (!year || !month) throw fail(400, 'Ask for a statement as YYYY-MM.');
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const statement = await ledger.statement(account, start, end);

  await audit.log({
    action: 'statement.viewed', category: 'account', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Opened the ${start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} statement`,
  });

  res.json({
    statement: {
      ...statement,
      transactions: statement.transactions.map((t) => publicTransaction(t, account)),
    },
    account: accountsLib.publicAccount(account),
    customer: {
      name: `${req.bankUser.first_name} ${req.bankUser.last_name}`,
      addressLines: [
        req.bankUser.address_line1,
        req.bankUser.address_line2,
        [req.bankUser.city, req.bankUser.state, req.bankUser.postal_code].filter(Boolean).join(', '),
      ].filter(Boolean),
    },
    // The institution, plus the contact details an operator has set. A
    // statement is the one place a postal address really matters, so it is
    // sent as its own line and the renderer leaves it out when it is blank.
    bank: { ...BANK, ...contact.current() },
  });
});

/* --------------------------------------------------------------- cards --- */

const cards = asyncHandler(async (req, res) => {
  const rows = await db.cards.find({ user_id: req.bankUser.id }, { order: 'created_at.desc' });
  const accounts = await db.accounts.find({ user_id: req.bankUser.id });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  res.json({
    cards: rows.map((c) => ({
      ...accountsLib.publicCard(c),
      accountName: byId.get(c.account_id) ? (byId.get(c.account_id).nickname || byId.get(c.account_id).name) : '',
      accountLast4: byId.get(c.account_id) ? String(byId.get(c.account_id).account_number).slice(-4) : '',
    })),
  });
});

/** Freeze, unfreeze, or report a card lost or stolen. */
const updateCard = asyncHandler(async (req, res) => {
  const card = await db.cards.findById(req.params.id);
  if (!card || card.user_id !== req.bankUser.id) throw fail(404, 'Card not found.');

  const patch = {};
  const action = String(req.body.action || '').trim();

  if (action === 'freeze') patch.status = 'frozen';
  else if (action === 'unfreeze') patch.status = 'active';
  else if (action === 'report_lost') patch.status = 'lost';
  else if (action === 'report_stolen') patch.status = 'stolen';
  else if (action === 'limits') {
    if (req.body.dailyPurchaseLimit != null) patch.daily_purchase_limit = Math.max(0, Math.round(Number(req.body.dailyPurchaseLimit) * 100));
    if (req.body.dailyAtmLimit != null) patch.daily_atm_limit = Math.max(0, Math.round(Number(req.body.dailyAtmLimit) * 100));
  } else if (action === 'controls') {
    if (req.body.contactless != null) patch.contactless = Boolean(req.body.contactless);
    if (req.body.internationalAllowed != null) patch.international_allowed = Boolean(req.body.internationalAllowed);
    if (req.body.onlineAllowed != null) patch.online_allowed = Boolean(req.body.onlineAllowed);
  } else {
    throw fail(400, 'That card action is not available.');
  }

  await db.cards.update(card.id, patch);
  const updated = await db.cards.findById(card.id);

  const wording = {
    freeze: 'frozen', unfreeze: 'unfrozen', report_lost: 'reported lost',
    report_stolen: 'reported stolen', limits: 'limits updated', controls: 'controls updated',
  }[action];
  await audit.log({
    action: `card.${action}`, category: 'security', userId: req.bankUser.id, req,
    severity: ['report_lost', 'report_stolen'].includes(action) ? 'warning' : 'info',
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Card ending ${card.last4} ${wording}`,
  });
  await alerts.notifyUser(req.bankUser, 'card_activity', {
    subject: `Your card ending ${card.last4} was ${wording}`,
    heading: `Card ${wording}`,
    intro: `Your ${card.brand} ${card.kind} card ending ${card.last4} was ${wording}.`,
    rows: [
      { label: 'Card', value: `${card.brand.toUpperCase()} •••• ${card.last4}` },
      { label: 'When', value: new Date().toLocaleString('en-US') },
      ...(action === 'limits' ? [
        { label: 'Daily purchases', value: money(updated.daily_purchase_limit) },
        { label: 'Daily ATM', value: money(updated.daily_atm_limit) },
      ] : []),
    ],
    footNote: ['report_lost', 'report_stolen'].includes(action)
      ? 'A replacement is on its way and will arrive in 5 to 7 business days.'
      : undefined,
  });

  // A lost or stolen card is replaced straight away, as it would be on a call.
  let replacement = null;
  if (['report_lost', 'report_stolen'].includes(action)) {
    const account = await db.accounts.findById(card.account_id);
    replacement = await accountsLib.issueCard(req.bankUser, account, {
      brand: card.brand, kind: card.kind, replacedCardId: card.id, nameOnCard: card.name_on_card,
    });
  }

  res.json({ card: accountsLib.publicCard(updated), replacement: replacement ? accountsLib.publicCard(replacement) : null });
});

/* ------------------------------------------------------------ overview --- */

/** Everything the dashboard needs, in one round trip. */
const overview = asyncHandler(async (req, res) => {
  const user = req.bankUser;
  const [accounts, allTx, transfers, cardRows, payees, alertRows, messages] = await Promise.all([
    db.accounts.find({ user_id: user.id }, { order: 'created_at.asc' }),
    db.transactions.find({ user_id: user.id }, { order: 'date.desc', limit: 400 }),
    db.transfers.find({ user_id: user.id }, { order: 'created_at.desc', limit: 20 }),
    db.cards.find({ user_id: user.id }),
    db.payees.find({ user_id: user.id }),
    db.alerts.find({ user_id: user.id }, { order: 'created_at.desc', limit: 8 }),
    db.messages.find({ user_id: user.id, from_side: 'bank', read_at: null }),
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const deposits = accounts.filter((a) => (ACCOUNT_TYPES[a.type] || {}).sign !== -1);
  const credit = accounts.filter((a) => (ACCOUNT_TYPES[a.type] || {}).sign === -1);
  const totalDeposits = deposits.reduce((s, a) => s + Number(a.balance || 0), 0);
  const totalOwed = credit.reduce((s, a) => s + Number(a.balance || 0), 0);

  // Last 30 days, by category, for the spending ring.
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const recentSpend = allTx.filter((t) => t.direction === 'debit' && t.date >= since && t.status !== 'failed' && t.category !== 'Transfers');
  const byCategory = {};
  recentSpend.forEach((t) => { byCategory[t.category] = (byCategory[t.category] || 0) + Number(t.amount); });
  const spending = Object.entries(byCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  // Six months of in and out, for the bar chart.
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - i);
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59)).toISOString();
    const inPeriod = allTx.filter((t) => t.date >= start && t.date <= end && t.status === 'posted');
    months.push({
      label: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      in: inPeriod.filter((t) => t.direction === 'credit').reduce((s, t) => s + Number(t.amount), 0),
      out: inPeriod.filter((t) => t.direction === 'debit').reduce((s, t) => s + Number(t.amount), 0),
    });
  }

  const upcoming = payees
    .filter((p) => p.autopay && p.due_day)
    .map((p) => {
      const now = new Date();
      const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Number(p.due_day)));
      if (due < now) due.setUTCMonth(due.getUTCMonth() + 1);
      return { id: p.id, name: p.name, amount: p.amount, dueDate: due.toISOString(), category: p.category };
    })
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
    .slice(0, 4);

  res.json({
    user: require('../../bank/users').publicUser(user, 'self'),
    totals: {
      deposits: totalDeposits,
      owed: totalOwed,
      net: totalDeposits - totalOwed,
      available: deposits.reduce((s, a) => s + ledger.availableFor(a), 0),
      creditAvailable: credit.reduce((s, a) => s + ledger.availableFor(a), 0),
    },
    accounts: accounts.map(accountsLib.publicAccount),
    cards: cardRows.map(accountsLib.publicCard),
    recent: allTx.slice(0, 12).map((t) => publicTransaction(t, byId.get(t.account_id))),
    pending: allTx.filter((t) => t.status === 'pending').map((t) => publicTransaction(t, byId.get(t.account_id))),
    spending,
    months,
    upcoming,
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
  detail,
  rename,
  transactions,
  transactionDetail,
  exportTransactions,
  statements,
  statementDetail,
  cards,
  updateCard,
  overview,
  publicTransaction,
  ownedAccount,
  filterTransactions,
};
