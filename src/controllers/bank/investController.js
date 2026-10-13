'use strict';

/**
 * Live prices for the ticker, and converting a balance into listed assets.
 */

const invest = require('../../bank/invest');
const markets = require('../../bank/markets');
const accountsLib = require('../../bank/accounts');
const ledger = require('../../bank/ledger');
const { ACCOUNT_TYPES } = require('../../bank/constants');
const { asyncHandler, toCents } = require('../../bank/http');

/**
 * Public: every listed asset with its latest price. The ticker under the nav
 * reads this on every page, so the CDN is allowed to hold it briefly - one
 * request to the providers serves everybody for the next half minute.
 */
const quotes = asyncHandler(async (req, res) => {
  const assets = await markets.list();
  // Shared by everybody through the CDN, so it must never carry anybody's
  // cookies - including a session the middleware has just slid forward.
  res.removeHeader('Set-Cookie');
  res.set('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
  res.json({ assets, updatedAt: new Date().toISOString() });
});

/** The invest screen: prices, holdings, recent trades and where money can come from. */
const portfolio = asyncHandler(async (req, res) => {
  const [data, accounts] = await Promise.all([
    invest.portfolio(req.bankUser.id),
    accountsLib.spendableAccounts(req.bankUser.id),
  ]);
  const funding = accounts.filter((a) => (ACCOUNT_TYPES[a.type] || {}).sign !== -1);
  res.set('Cache-Control', 'no-store');
  res.json({
    ...data,
    accounts: funding.map((a) => ({ ...accountsLib.publicAccount(a), available: ledger.availableFor(a) })),
    minimum: invest.MIN_BUY,
    priceTolerance: invest.PRICE_TOLERANCE,
  });
});

const convert = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const result = await invest.convert(req.bankUser, {
    accountId: b.accountId,
    symbol: b.symbol,
    amount: b.amount != null && b.amount !== '' ? toCents(b.amount) : undefined,
    percent: b.percent,
    all: b.all === true || b.all === 'true',
    quotedPrice: b.quotedPrice,
  }, req);
  res.status(201).json(result);
});

const sell = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const result = await invest.sell(req.bankUser, {
    accountId: b.accountId,
    symbol: b.symbol,
    units: b.units,
    percent: b.percent,
    all: b.all === true || b.all === 'true',
    quotedPrice: b.quotedPrice,
  }, req);
  res.status(201).json(result);
});

module.exports = { quotes, portfolio, convert, sell };

/* ---------------------------------------------------------------- staff --- */

const { db } = require('../../bank/db');
const usersLib = require('../../bank/users');

/**
 * GET /api/bank/admin/investments - every holding in the bank, valued at the
 * latest prices, with the most recent trades and who made them.
 */
const staffOverview = asyncHandler(async (req, res) => {
  const [rows, assets, trades] = await Promise.all([
    db.holdings.find({}),
    markets.list(),
    db.trades.find({}, { order: 'created_at.desc', limit: 50 }),
  ]);
  const bySymbol = new Map(assets.map((a) => [a.symbol, a]));
  const people = await db.users.findByIds([...rows.map((r) => r.user_id), ...trades.map((t) => t.user_id)]);
  const who = (id) => {
    const u = people.get(id);
    return u ? { id: u.id, fullName: usersLib.publicUser(u, 'admin').fullName, email: u.email } : { id, fullName: 'Unknown', email: '' };
  };

  const holdings = rows.map((h) => {
    const asset = bySymbol.get(h.symbol);
    const units = Number(h.units);
    const value = asset && asset.quote ? Math.floor(units * asset.quote.price * 100) : null;
    const cost = Number(h.cost_basis || 0);
    return {
      customer: who(h.user_id), symbol: h.symbol, name: asset ? asset.name : h.symbol,
      units: h.units, cost, value, gain: value == null ? null : value - cost, updatedAt: h.updated_at || h.created_at,
    };
  }).sort((a, b) => (b.value || 0) - (a.value || 0));

  const bySym = {};
  holdings.forEach((h) => {
    bySym[h.symbol] = bySym[h.symbol] || { symbol: h.symbol, name: h.name, holders: 0, value: 0 };
    bySym[h.symbol].holders += 1;
    bySym[h.symbol].value += h.value || 0;
  });

  const since = new Date(Date.now() - 86400000).toISOString();
  res.set('Cache-Control', 'no-store');
  res.json({
    totals: {
      value: holdings.reduce((s, h) => s + (h.value || 0), 0),
      cost: holdings.reduce((s, h) => s + h.cost, 0),
      investors: new Set(rows.map((r) => r.user_id)).size,
      trades24h: trades.filter((t) => t.created_at >= since).length,
    },
    byAsset: Object.values(bySym).sort((a, b) => b.value - a.value),
    holdings,
    trades: trades.map((t) => ({ ...invest.publicTrade(t), customer: who(t.user_id) })),
    assets,
  });
});

/** Holdings for one customer, for the customer sheet. */
const staffCustomerHoldings = asyncHandler(async (req, res) => {
  const data = await invest.portfolio(req.params.id);
  res.set('Cache-Control', 'no-store');
  res.json({ holdings: data.holdings, totals: data.totals, trades: data.trades });
});

module.exports.staffOverview = staffOverview;
module.exports.staffCustomerHoldings = staffCustomerHoldings;

/**
 * POST /api/bank/admin/trades - book a conversion or sale for a customer,
 * optionally at an agreed price and an earlier time.
 */
const staffBook = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const customer = await db.users.findById(b.customerId);
  if (!customer) throw Object.assign(new Error('Customer not found.'), { status: 404 });
  let at = null;
  if (b.date) {
    const when = new Date(b.date);
    if (Number.isNaN(when.getTime())) throw Object.assign(new Error('Enter a valid date and time.'), { status: 400 });
    if (when.getTime() > Date.now() + 60000) throw Object.assign(new Error('A trade cannot be dated in the future.'), { status: 400 });
    at = when.toISOString();
  }
  const opts = { staff: req.bankUser, price: b.price ? Number(String(b.price).replace(/[^0-9.]/g, '')) : null, at, note: String(b.note || '').slice(0, 300) };
  const all = b.all === true || b.all === 'true';
  const result = b.side === 'sell'
    ? await invest.sell(customer, { accountId: b.accountId, symbol: b.symbol, units: b.units, percent: b.percent, all }, req, opts)
    : await invest.convert(customer, { accountId: b.accountId, symbol: b.symbol, amount: b.amount != null && b.amount !== '' ? toCents(b.amount) : undefined, percent: b.percent, all }, req, opts);
  res.status(201).json(result);
});

/** PATCH /api/bank/admin/trades/:id - move a trade to when it really happened. */
const staffRetime = asyncHandler(async (req, res) => {
  const trade = await invest.retimeTrade(req.params.id, (req.body || {}).date, req.bankUser, String((req.body || {}).note || '').slice(0, 300), req);
  res.json({ trade });
});

/** POST /api/bank/admin/trades/:id/reverse - undo a trade, units and cash. */
const staffReverse = asyncHandler(async (req, res) => {
  const trade = await invest.reverseTrade(req.params.id, req.bankUser, String((req.body || {}).note || '').slice(0, 300), req);
  res.json({ trade });
});

module.exports.staffBook = staffBook;
module.exports.staffRetime = staffRetime;
module.exports.staffReverse = staffReverse;
