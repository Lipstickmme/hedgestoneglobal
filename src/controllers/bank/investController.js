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
