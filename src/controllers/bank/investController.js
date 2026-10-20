'use strict';

/**
 * Live prices for the ticker, the price history behind the dashboard chart,
 * the customer's vault, and the staff tools for booking into it.
 */

const invest = require('../../bank/invest');
const markets = require('../../bank/markets');
const settings = require('../../bank/settings');
const { VAULT } = require('../../bank/constants');
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

/**
 * Public: daily Bitcoin prices for the last `days` days, for the chart of an
 * investment since the day it was bought. The same for everybody, so the CDN
 * holds it for as long as the server does.
 */
const history = asyncHandler(async (req, res) => {
  const data = await markets.history(req.query.symbol || 'BTC', Number(req.query.days) || 365);
  // A chart is a few hundred pixels wide: a series of years goes out as about
  // a thousand points, always keeping the most recent, which is today.
  let { points } = data;
  if (points.length > 1100) {
    const step = Math.ceil(points.length / 1000);
    points = points.filter((p, i) => i % step === 0 || i === points.length - 1);
  }
  res.removeHeader('Set-Cookie');
  res.set('Cache-Control', points.length ? 'public, max-age=600, s-maxage=1800, stale-while-revalidate=3600' : 'no-store');
  res.json({ ...data, points });
});

/** The vault screen and the dashboard: what it is worth, everything in it, and when each part matures. */
const portfolio = asyncHandler(async (req, res) => {
  const [data, cfg] = await Promise.all([invest.portfolio(req.bankUser.id), settings.get()]);
  res.set('Cache-Control', 'no-store');
  res.json({
    ...data,
    minimum: invest.MIN_BUY,
    terms: { min: invest.TERM_YEARS.min, max: invest.TERM_YEARS.max, default: invest.defaultTermYears(cfg) },
    earliest: VAULT.earliest,
  });
});

module.exports = { quotes, history, portfolio };

/* ---------------------------------------------------------------- staff --- */

const { db } = require('../../bank/db');
const usersLib = require('../../bank/users');

/**
 * GET /api/bank/admin/investments - every customer's Bitcoin, valued at the
 * latest price, with the most recent trades and who made them. Anyone still
 * holding an asset no longer offered is converted to Bitcoin first; those
 * that cannot be converted yet, for want of a live price, are counted in
 * `converting`.
 */
const staffOverview = asyncHandler(async (req, res) => {
  let sweep = { pending: [] };
  try {
    sweep = await invest.convertAllLegacy({ staff: req.bankUser, req });
  } catch (err) {
    console.warn(`[hedgestone] converting holdings to Bitcoin failed: ${err.message}`);
    sweep = { pending: [{ reason: err.message }] };
  }
  const [rows, assets, trades] = await Promise.all([
    db.holdings.find({ symbol: 'BTC' }),
    markets.list(),
    db.trades.find({ symbol: 'BTC' }, { order: 'created_at.desc', limit: 50 }),
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
    converting: sweep.pending.length,
  });
});

/** Holdings for one customer, for the customer sheet. */
const staffCustomerHoldings = asyncHandler(async (req, res) => {
  const data = await invest.portfolio(req.params.id);
  res.set('Cache-Control', 'no-store');
  res.json({ holdings: data.holdings, totals: data.totals, trades: data.trades, positions: data.positions, bitcoin: data.bitcoin, converting: data.converting });
});

module.exports.staffOverview = staffOverview;
module.exports.staffCustomerHoldings = staffCustomerHoldings;

/**
 * POST /api/bank/admin/trades - add to a customer's vault directly: cash they
 * paid the OTC partner (`amount`, dollars) or Bitcoin they sent (`units`),
 * dated when it happened and priced at Bitcoin's price that day.
 */
const staffBook = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const customer = await db.users.findById(b.customerId);
  if (!customer) throw Object.assign(new Error('Customer not found.'), { status: 404 });
  const result = await invest.addToVault(customer, {
    kind: b.kind === 'bitcoin' ? 'bitcoin' : 'cash',
    amount: b.amount != null && b.amount !== '' ? toCents(b.amount) : undefined,
    units: b.units,
    at: b.date || null,
    termYears: b.termYears,
    note: String(b.note || '').slice(0, 300) || null,
  }, req, { staff: req.bankUser });
  res.status(201).json(result);
});

/** PATCH /api/bank/admin/trades/:id - move something to when it really happened (repriced), or change its term. */
const staffRetime = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const trade = await invest.retimeTrade(req.params.id, b.date, req.bankUser, String(b.note || '').slice(0, 300), req, { termYears: b.termYears });
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
