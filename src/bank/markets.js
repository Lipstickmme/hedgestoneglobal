'use strict';

/**
 * Live market prices for the assets a customer can convert their balance into.
 *
 * The catalogue is deliberately short - a broad index, a tech index, a handful
 * of the largest US companies, Bitcoin and gold - because every asset here is
 * one the bank prices, values and books against, and a price it cannot get is
 * an asset nobody can buy or sell.
 *
 * Prices come from free public sources, tried in order until one answers:
 *
 *   stocks and ETFs   Finnhub (when FINNHUB_API_KEY is set), Yahoo Finance, Stooq
 *   Bitcoin           CoinGecko, Coinbase, Yahoo Finance
 *   gold              Stooq spot XAU/USD, Yahoo gold futures, CoinGecko PAX Gold
 *
 * Every answer is cached in memory for CACHE_MS, so a page of visitors costs
 * one round of provider calls rather than one each, and written back to
 * bank_market_quotes so a cold serverless instance - or an outage at every
 * provider at once - still has the last price it saw, labelled with its age.
 *
 * A trade never uses a price older than TRADE_MAX_AGE_MS. The ticker will show
 * a stale last price with its timestamp; the convert button will refuse it.
 *
 * MARKET_DATA_FIXTURE=1 swaps the providers for fixed prices. That is for the
 * tests and for running offline, and every quote it returns says so in its
 * `source`, which the page prints.
 */

const { db } = require('./db');

const CACHE_MS = Number(process.env.MARKET_CACHE_SECONDS || 30) * 1000;
const TRADE_MAX_AGE_MS = Number(process.env.MARKET_TRADE_MAX_AGE_SECONDS || 120) * 1000;
const PROVIDER_TIMEOUT_MS = 3000;
// The ticker answers within this, from the cache if the providers are slow;
// the refresh carries on and the next request gets its result.
const LIST_BUDGET_MS = 3500;
const UA = 'Mozilla/5.0 (compatible; HedgestoneGlobalBank/1.0)';

/**
 * What can be held. `decimals` is how finely a holding is divided: shares to
 * a millionth, Bitcoin to a satoshi.
 */
const ASSETS = [
  { symbol: 'SPY', name: 'S&P 500', detail: 'SPDR S&P 500 ETF Trust', kind: 'ETF', unit: 'share', decimals: 6, finnhub: 'SPY', yahoo: 'SPY', stooq: 'spy.us' },
  { symbol: 'QQQ', name: 'Nasdaq-100', detail: 'Invesco QQQ Trust', kind: 'ETF', unit: 'share', decimals: 6, finnhub: 'QQQ', yahoo: 'QQQ', stooq: 'qqq.us' },
  { symbol: 'AAPL', name: 'Apple', detail: 'Apple Inc.', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'AAPL', yahoo: 'AAPL', stooq: 'aapl.us' },
  { symbol: 'AMZN', name: 'Amazon', detail: 'Amazon.com, Inc.', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'AMZN', yahoo: 'AMZN', stooq: 'amzn.us' },
  { symbol: 'MSFT', name: 'Microsoft', detail: 'Microsoft Corporation', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'MSFT', yahoo: 'MSFT', stooq: 'msft.us' },
  { symbol: 'NVDA', name: 'NVIDIA', detail: 'NVIDIA Corporation', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'NVDA', yahoo: 'NVDA', stooq: 'nvda.us' },
  { symbol: 'GOOGL', name: 'Alphabet', detail: 'Alphabet Inc. Class A', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'GOOGL', yahoo: 'GOOGL', stooq: 'googl.us' },
  { symbol: 'TSLA', name: 'Tesla', detail: 'Tesla, Inc.', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'TSLA', yahoo: 'TSLA', stooq: 'tsla.us' },
  { symbol: 'BTC', name: 'Bitcoin', detail: 'Bitcoin, priced in US dollars', kind: 'Crypto', unit: 'BTC', decimals: 8, coingecko: 'bitcoin', coinbase: 'BTC-USD', yahoo: 'BTC-USD' },
  { symbol: 'XAU', name: 'Gold', detail: 'Gold, per troy ounce', kind: 'Commodity', unit: 'oz', decimals: 6, stooq: 'xauusd', yahoo: 'GC=F', coingecko: 'pax-gold' },
];
const BY_SYMBOL = new Map(ASSETS.map((a) => [a.symbol, a]));

/** Prices for MARKET_DATA_FIXTURE: recent ballpark levels, not live. */
const FIXTURE = {
  SPY: 571.25, QQQ: 489.6, AAPL: 227.5, AMZN: 186.4, MSFT: 416.3,
  NVDA: 131.6, GOOGL: 163.2, TSLA: 249.8, BTC: 63250.0, XAU: 2655.4,
};
let fixtureOverride = null;

const fixtureMode = () => /^(1|true|yes|on)$/i.test(String(process.env.MARKET_DATA_FIXTURE || ''));

/* ------------------------------------------------------------- helpers --- */

async function getJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
  return res.text();
}

const positive = (n) => Number.isFinite(n) && n > 0;

function quote(symbol, price, previousClose, source, asOf) {
  const p = Number(price);
  const prev = positive(Number(previousClose)) ? Number(previousClose) : null;
  const change = prev ? p - prev : null;
  return {
    symbol,
    price: Math.round(p * 100) / 100,
    previousClose: prev,
    change: change == null ? null : Math.round(change * 100) / 100,
    changePct: change == null ? null : Math.round((change / prev) * 10000) / 100,
    source,
    asOf: asOf || new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
  };
}

/* ----------------------------------------------------------- providers --- */

/** Finnhub: real-time US quotes on the free tier. Needs FINNHUB_API_KEY. */
async function fromFinnhub(assets) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return {};
  const out = {};
  await Promise.all(assets.filter((a) => a.finnhub).map(async (a) => {
    const j = await getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(a.finnhub)}&token=${encodeURIComponent(key)}`);
    // An unknown symbol answers 200 with every field zero.
    if (positive(j.c)) out[a.symbol] = quote(a.symbol, j.c, j.pc, 'Finnhub', j.t ? new Date(j.t * 1000).toISOString() : null);
  }).map((p) => p.catch(() => {})));
  return out;
}

/** Yahoo Finance chart endpoint: no key, one symbol per request. */
async function fromYahoo(assets) {
  const out = {};
  await Promise.all(assets.filter((a) => a.yahoo).map(async (a) => {
    const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(a.yahoo)}?range=1d&interval=1d`);
    const meta = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
    if (meta && positive(meta.regularMarketPrice)) {
      out[a.symbol] = quote(
        a.symbol,
        meta.regularMarketPrice,
        meta.chartPreviousClose || meta.previousClose,
        'Yahoo Finance',
        meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null
      );
    }
  }).map((p) => p.catch(() => {})));
  return out;
}

/** Stooq: no key, every symbol in one CSV request. Delayed, but dependable. */
async function fromStooq(assets) {
  const wanted = assets.filter((a) => a.stooq);
  if (!wanted.length) return {};
  const csv = await getText(`https://stooq.com/q/l/?s=${wanted.map((a) => a.stooq).join('+')}&f=sd2t2ohlcp&h&e=csv`);
  const [head, ...lines] = csv.trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim().toLowerCase());
  const at = (row, name) => row[cols.indexOf(name)];
  const out = {};
  lines.forEach((line) => {
    const row = line.split(',');
    const asset = wanted.find((a) => a.stooq === String(at(row, 'symbol') || '').toLowerCase());
    const close = Number(at(row, 'close'));
    if (!asset || !positive(close)) return;
    const prev = Number(at(row, 'prev')) || Number(at(row, 'open'));
    const when = at(row, 'date') && at(row, 'time') ? new Date(`${at(row, 'date')}T${at(row, 'time')}Z`) : null;
    out[asset.symbol] = quote(asset.symbol, close, prev, 'Stooq', when && !Number.isNaN(when.getTime()) ? when.toISOString() : null);
  });
  return out;
}

/** CoinGecko: no key, both coins in one request, with a 24-hour change. */
async function fromCoinGecko(assets) {
  const wanted = assets.filter((a) => a.coingecko);
  if (!wanted.length) return {};
  const j = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${wanted.map((a) => a.coingecko).join(',')}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`);
  const out = {};
  wanted.forEach((a) => {
    const row = j[a.coingecko];
    if (!row || !positive(row.usd)) return;
    const pct = Number(row.usd_24h_change);
    const prev = Number.isFinite(pct) ? row.usd / (1 + pct / 100) : null;
    out[a.symbol] = quote(a.symbol, row.usd, prev, 'CoinGecko', row.last_updated_at ? new Date(row.last_updated_at * 1000).toISOString() : null);
  });
  return out;
}

/** Coinbase spot: no key, no change figure. */
async function fromCoinbase(assets) {
  const out = {};
  await Promise.all(assets.filter((a) => a.coinbase).map(async (a) => {
    const j = await getJson(`https://api.coinbase.com/v2/prices/${a.coinbase}/spot`);
    const amount = Number(j && j.data && j.data.amount);
    if (positive(amount)) out[a.symbol] = quote(a.symbol, amount, null, 'Coinbase');
  }).map((p) => p.catch(() => {})));
  return out;
}

/** Which providers to ask for each kind of asset, best first. */
function chainFor(asset) {
  if (asset.kind === 'Crypto') return [fromCoinGecko, fromCoinbase, fromYahoo];
  if (asset.kind === 'Commodity') return [fromStooq, fromYahoo, fromCoinGecko];
  return [fromFinnhub, fromYahoo, fromStooq];
}

function fromFixture(assets) {
  const out = {};
  const prices = { ...FIXTURE, ...(fixtureOverride || {}) };
  assets.forEach((a) => {
    const p = prices[a.symbol];
    if (positive(p)) out[a.symbol] = quote(a.symbol, p, p / 1.004, 'Demo prices (fixture)');
  });
  return out;
}

/* --------------------------------------------------------------- cache --- */

const memory = new Map(); // symbol -> quote
let inflight = null;

async function persist(quotes) {
  const rows = Object.values(quotes).map((q) => ({
    id: q.symbol,
    symbol: q.symbol,
    price: q.price,
    previous_close: q.previousClose,
    change: q.change,
    change_pct: q.changePct,
    source: q.source,
    as_of: q.asOf,
    fetched_at: q.fetchedAt,
  }));
  for (const row of rows) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const existing = await db.quotes.findById(row.id);
      // eslint-disable-next-line no-await-in-loop
      if (existing) await db.quotes.update(row.id, row); else await db.quotes.insert(row);
    } catch (err) {
      // The cache is a convenience. Never let it fail a price read.
      console.warn(`[hedgestone] could not store the ${row.symbol} quote: ${err.message}`);
      return;
    }
  }
}

function fromRow(row) {
  return {
    symbol: row.symbol,
    price: Number(row.price),
    previousClose: row.previous_close == null ? null : Number(row.previous_close),
    change: row.change == null ? null : Number(row.change),
    changePct: row.change_pct == null ? null : Number(row.change_pct),
    source: row.source,
    asOf: row.as_of,
    fetchedAt: row.fetched_at,
  };
}

async function loadStored() {
  try {
    const rows = await db.quotes.find({});
    rows.forEach((row) => {
      const q = fromRow(row);
      const mine = memory.get(q.symbol);
      if (!mine || String(mine.fetchedAt) < String(q.fetchedAt)) memory.set(q.symbol, q);
    });
  } catch (err) {
    console.warn(`[hedgestone] could not read stored quotes: ${err.message}`);
  }
}

const age = (q) => (q && q.fetchedAt ? Date.now() - new Date(q.fetchedAt).getTime() : Infinity);

/** Ask the providers for every asset whose cached price is older than maxAge. */
async function refresh(maxAge) {
  const force = forceRefresh;
  forceRefresh = false;
  if (!memory.size && !force) await loadStored();
  const due = ASSETS.filter((a) => force || age(memory.get(a.symbol)) > maxAge);
  if (!due.length) return;

  let found = {};
  if (fixtureMode()) {
    found = fromFixture(due);
  } else {
    // Group by provider chain, then walk each chain until every asset in the
    // group has a price or the chain runs out.
    const groups = new Map();
    due.forEach((a) => {
      const chain = chainFor(a);
      const key = chain.map((f) => f.name).join('>');
      if (!groups.has(key)) groups.set(key, { chain, assets: [] });
      groups.get(key).assets.push(a);
    });
    await Promise.all(Array.from(groups.values()).map(async ({ chain, assets }) => {
      let missing = assets;
      for (const provider of chain) {
        if (!missing.length) break;
        try {
          // eslint-disable-next-line no-await-in-loop
          const got = await provider(missing);
          Object.assign(found, got);
          missing = missing.filter((a) => !got[a.symbol]);
        } catch (err) {
          console.warn(`[hedgestone] ${provider.name} prices failed: ${err.message}`);
        }
      }
    }));
  }

  Object.values(found).forEach((q) => memory.set(q.symbol, q));
  if (Object.keys(found).length) await persist(found);
}

/**
 * Bring the cache up to maxAge. One refresh in flight per instance, and when
 * the providers are failing, no more than one attempt every RETRY_MS - a
 * provider outage should not turn every page view into a dozen timed-out
 * requests.
 */
const RETRY_MS = 10_000;
let lastAttempt = 0;
let forceRefresh = false;

async function ensureFresh(maxAge = CACHE_MS) {
  if (inflight) await inflight;
  const due = !memory.size || forceRefresh || ASSETS.some((a) => age(memory.get(a.symbol)) > maxAge);
  if (!due) return;
  if (!forceRefresh && memory.size && Date.now() - lastAttempt < RETRY_MS) return;
  lastAttempt = Date.now();
  inflight = refresh(maxAge).finally(() => { inflight = null; });
  await inflight;
}

/* ----------------------------------------------------------------- api --- */

function publicAsset(asset) {
  const q = memory.get(asset.symbol) || null;
  return {
    symbol: asset.symbol,
    name: asset.name,
    detail: asset.detail,
    kind: asset.kind,
    unit: asset.unit,
    decimals: asset.decimals,
    quote: q ? { ...q, stale: age(q) > TRADE_MAX_AGE_MS, ageSeconds: Math.round(age(q) / 1000) } : null,
  };
}

/** Every asset with its latest price. Never throws for want of a price. */
async function list() {
  const refreshing = ensureFresh(CACHE_MS).catch((err) => {
    console.warn(`[hedgestone] market refresh failed: ${err.message}`);
  });
  let timer;
  await Promise.race([refreshing, new Promise((resolve) => { timer = setTimeout(resolve, LIST_BUDGET_MS); })]);
  clearTimeout(timer);
  // A cold instance that ran out of budget still has the stored prices.
  if (!memory.size) await loadStored();
  return ASSETS.map(publicAsset);
}

/**
 * The price a trade will be booked at, or a 503 when there is no price fresh
 * enough to trade on.
 */
async function tradeQuote(symbol) {
  const asset = BY_SYMBOL.get(String(symbol || '').toUpperCase());
  if (!asset) throw Object.assign(new Error('That asset is not available.'), { status: 400, code: 'unknown_asset' });
  await ensureFresh(Math.min(CACHE_MS, TRADE_MAX_AGE_MS));
  const q = memory.get(asset.symbol);
  if (!q || age(q) > TRADE_MAX_AGE_MS) {
    throw Object.assign(
      new Error(`We cannot get a live price for ${asset.name} right now, so it cannot be bought or sold. Try again in a minute.`),
      { status: 503, code: 'price_unavailable', expose: true }
    );
  }
  return { asset, quote: q };
}

/** Tests: set fixture prices and drop the cache so the next read sees them. */
function _setFixture(prices) {
  fixtureOverride = prices ? { ...prices } : null;
  memory.clear();
  forceRefresh = true;
}

module.exports = { ASSETS, BY_SYMBOL, list, tradeQuote, TRADE_MAX_AGE_MS, _setFixture };
