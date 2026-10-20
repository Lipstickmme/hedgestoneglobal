'use strict';

/**
 * Live market prices, and the price history behind the dashboard's chart.
 *
 * Bitcoin is the only asset on offer. The assets the platform used to offer
 * are kept as RETIRED: nobody can buy them, but a customer who bought one
 * before keeps it, valued at the live price and sellable back to cash, and
 * they are only priced when somebody asks for them (list({ withRetired })).
 *
 * Prices come from free public sources, tried in order until one answers:
 *
 *   Bitcoin           CoinGecko, Coinbase, Yahoo Finance
 *   stocks and ETFs   Finnhub (when FINNHUB_API_KEY is set), Yahoo Finance, Stooq
 *   gold              Stooq spot XAU/USD, Yahoo gold futures, CoinGecko PAX Gold
 *
 * Daily history (history()) comes from CoinGecko, Yahoo Finance, Coinbase,
 * Blockchain.com or CryptoCompare, whichever answers first with enough of it,
 * and is held in memory for HISTORY_CACHE_MS. It reaches back to EARLIEST, the
 * first day a purchase may be dated, and priceAt() reads a day's close from it
 * so that a purchase booked after the fact is booked at that day's price.
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
// A price this recent is shown at once while a newer one is fetched. On a
// quiet site the last price is often a few minutes old, and waiting for the
// providers then held every page up by seconds; trades never use it.
const SHOW_STALE_MS = Number(process.env.MARKET_SHOW_STALE_SECONDS || 900) * 1000;
const UA = 'Mozilla/5.0 (compatible; HedgestoneFinance/1.0)';

/**
 * What can be bought. `decimals` is how finely a holding is divided: Bitcoin
 * to a satoshi, shares to a millionth.
 */
const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', detail: 'Bitcoin, priced in US dollars', kind: 'Crypto', unit: 'BTC', decimals: 8, coingecko: 'bitcoin', coinbase: 'BTC-USD', yahoo: 'BTC-USD' },
];

/** What can no longer be bought, only held and sold. See the note at the top. */
const RETIRED = [
  { symbol: 'SPY', name: 'S&P 500', detail: 'SPDR S&P 500 ETF Trust', kind: 'ETF', unit: 'share', decimals: 6, finnhub: 'SPY', yahoo: 'SPY', stooq: 'spy.us' },
  { symbol: 'QQQ', name: 'Nasdaq-100', detail: 'Invesco QQQ Trust', kind: 'ETF', unit: 'share', decimals: 6, finnhub: 'QQQ', yahoo: 'QQQ', stooq: 'qqq.us' },
  { symbol: 'AAPL', name: 'Apple', detail: 'Apple Inc.', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'AAPL', yahoo: 'AAPL', stooq: 'aapl.us' },
  { symbol: 'AMZN', name: 'Amazon', detail: 'Amazon.com, Inc.', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'AMZN', yahoo: 'AMZN', stooq: 'amzn.us' },
  { symbol: 'MSFT', name: 'Microsoft', detail: 'Microsoft Corporation', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'MSFT', yahoo: 'MSFT', stooq: 'msft.us' },
  { symbol: 'NVDA', name: 'NVIDIA', detail: 'NVIDIA Corporation', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'NVDA', yahoo: 'NVDA', stooq: 'nvda.us' },
  { symbol: 'GOOGL', name: 'Alphabet', detail: 'Alphabet Inc. Class A', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'GOOGL', yahoo: 'GOOGL', stooq: 'googl.us' },
  { symbol: 'TSLA', name: 'Tesla', detail: 'Tesla, Inc.', kind: 'Stock', unit: 'share', decimals: 6, finnhub: 'TSLA', yahoo: 'TSLA', stooq: 'tsla.us' },
  { symbol: 'XAU', name: 'Gold', detail: 'Gold, per troy ounce', kind: 'Commodity', unit: 'oz', decimals: 6, stooq: 'xauusd', yahoo: 'GC=F', coingecko: 'pax-gold' },
].map((a) => ({ ...a, retired: true }));

const ALL = [...ASSETS, ...RETIRED];
const BY_SYMBOL = new Map(ALL.map((a) => [a.symbol, a]));

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

// Stored prices are for a cold instance's first read; once read, memory is
// the source, and a test that resets the fixture does not get them back.
let storedLoaded = false;

async function loadStored() {
  if (storedLoaded) return;
  storedLoaded = true;
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

/** Ask the providers for every asset in `pool` whose cached price is older than maxAge. */
async function refresh(maxAge, pool = ASSETS) {
  const force = forceRefresh;
  forceRefresh = false;
  if (!memory.size && !force) await loadStored();
  const due = pool.filter((a) => force || age(memory.get(a.symbol)) > maxAge);
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
const lastAttempt = new Map(); // pool -> when it was last asked for
let forceRefresh = false;

async function ensureFresh(maxAge = CACHE_MS, pool = ASSETS) {
  if (inflight) await inflight;
  const due = !memory.size || forceRefresh || pool.some((a) => age(memory.get(a.symbol)) > maxAge);
  if (!due) return;
  if (!forceRefresh && memory.size && Date.now() - (lastAttempt.get(pool) || 0) < RETRY_MS) return;
  lastAttempt.set(pool, Date.now());
  inflight = refresh(maxAge, pool).finally(() => { inflight = null; });
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
    retired: Boolean(asset.retired),
    quote: q ? { ...q, stale: age(q) > TRADE_MAX_AGE_MS, ageSeconds: Math.round(age(q) / 1000) } : null,
  };
}

/**
 * Every asset on offer with its latest price; with `withRetired`, the retired
 * ones too, for valuing what somebody already holds. Never throws for want of
 * a price.
 */
async function list({ withRetired = false } = {}) {
  const pool = withRetired ? ALL : ASSETS;
  // A cold instance starts from the prices the last one stored.
  if (!memory.size) await loadStored();
  // A forced refresh, and the fixture's prices, which cost nothing to fetch,
  // are always waited for.
  const mustWait = forceRefresh || fixtureMode();
  const refreshing = ensureFresh(CACHE_MS, pool).catch((err) => {
    console.warn(`[hedgestone] market refresh failed: ${err.message}`);
  });
  // A price from the last few minutes is good enough to show while a newer
  // one is fetched: the page answers now, and the next one gets the new
  // price. Only a page with nothing recent waits, and not for long. Trades
  // never take this path; tradeQuote() insists on a fresh price.
  const recent = pool.every((a) => age(memory.get(a.symbol)) <= SHOW_STALE_MS);
  if (mustWait || !recent) {
    let timer;
    await Promise.race([refreshing, new Promise((resolve) => { timer = setTimeout(resolve, LIST_BUDGET_MS); })]);
    clearTimeout(timer);
  }
  return pool.map(publicAsset);
}

/**
 * The price a trade will be booked at, or a 503 when there is no price fresh
 * enough to trade on.
 */
async function tradeQuote(symbol) {
  const asset = BY_SYMBOL.get(String(symbol || '').toUpperCase());
  if (!asset) throw Object.assign(new Error('That asset is not available.'), { status: 400, code: 'unknown_asset' });
  await ensureFresh(Math.min(CACHE_MS, TRADE_MAX_AGE_MS), asset.retired ? ALL : ASSETS);
  const q = memory.get(asset.symbol);
  if (!q || age(q) > TRADE_MAX_AGE_MS) {
    throw Object.assign(
      new Error(`We cannot get a live price for ${asset.name} right now, so it cannot be bought or sold. Try again in a minute.`),
      { status: 503, code: 'price_unavailable', expose: true }
    );
  }
  return { asset, quote: q };
}

/* ------------------------------------------------------------- history --- */

/*
 * Daily closing prices, for the chart of an investment since the day it was
 * bought. One call answers for everybody: the series is the same whoever asks,
 * so it is held in memory for HISTORY_CACHE_MS and shared at the edge. It is
 * also written to bank_settings (row "history:BTC:365"), so a cold serverless
 * instance reads one row instead of asking the providers for years of prices;
 * a stored series younger than HISTORY_STORE_MS is used as it is.
 */
const HISTORY_CACHE_MS = Number(process.env.MARKET_HISTORY_CACHE_MINUTES || 30) * 60 * 1000;
const HISTORY_STORE_MS = Number(process.env.MARKET_HISTORY_STORE_HOURS || 6) * 3600 * 1000;
const historyMemory = new Map(); // "BTC:365" -> { at, points, source }
const historyStoreRead = new Set(); // keys whose stored copy this instance has already read

async function storedHistory(key) {
  // Once per instance, like the stored quotes: after that, memory is the source.
  if (historyStoreRead.has(key)) return null;
  historyStoreRead.add(key);
  try {
    const row = await db.settings.findById(`history:${key}`);
    const v = row && row.values;
    if (!v || !Array.isArray(v.points) || v.points.length < 2) return null;
    return { at: new Date(v.at).getTime() || 0, points: v.points, source: v.source || '' };
  } catch (err) {
    console.warn(`[hedgestone] could not read the stored ${key} history: ${err.message}`);
    return null;
  }
}

async function storeHistory(key, entry) {
  const row = { values: { at: new Date(entry.at).toISOString(), points: entry.points, source: entry.source }, updated_at: new Date().toISOString() };
  try {
    const id = `history:${key}`;
    if (await db.settings.findById(id)) await db.settings.update(id, row);
    else await db.settings.insert({ id, ...row });
  } catch (err) {
    // A convenience, like the stored quotes. Never let it fail a chart.
    console.warn(`[hedgestone] could not store the ${key} history: ${err.message}`);
  }
}

/*
 * The earliest day a purchase may be dated. Bitcoin itself began in January
 * 2009, but there was no market price until the middle of 2010 and very
 * little trading for months after; from 2011 there is a daily price to book
 * against.
 */
const EARLIEST = require('./constants').VAULT.earliest;
const DAY_MS = 86400000;
const daysSince = (iso) => Math.ceil((Date.now() - new Date(`${iso}T00:00:00.000Z`).getTime()) / DAY_MS) + 1;
const maxDays = () => daysSince(EARLIEST);

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** [[ms, price], ...] in any order -> one point a day, oldest first. */
function dailyPoints(pairs) {
  const byDay = new Map();
  pairs.forEach(([ms, price]) => {
    const p = Number(price);
    if (!Number.isFinite(ms) || !positive(p)) return;
    byDay.set(dayOf(ms), Math.round(p * 100) / 100); // the latest in a day wins
  });
  return Array.from(byDay.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([t, p]) => ({ t, p }));
}

/** CoinGecko: no key, up to a year of daily prices on the public API. */
async function historyFromCoinGecko(asset, days) {
  if (!asset.coingecko || days > 365) return null;
  const j = await getJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(asset.coingecko)}/market_chart?vs_currency=usd&days=${days}&interval=daily`);
  return j && Array.isArray(j.prices) ? dailyPoints(j.prices.map(([ms, p]) => [Number(ms), p])) : null;
}

/** Yahoo Finance: no key, any range, one request. Bitcoin from September 2014. */
async function historyFromYahoo(asset, days) {
  if (!asset.yahoo) return null;
  const range = [[30, '1mo'], [90, '3mo'], [180, '6mo'], [365, '1y'], [730, '2y'], [1825, '5y'], [3650, '10y']].find(([d]) => days <= d) || [0, 'max'];
  const j = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(asset.yahoo)}?range=${range[1]}&interval=1d`);
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  const closes = r && r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close;
  if (!r || !Array.isArray(r.timestamp) || !Array.isArray(closes)) return null;
  return dailyPoints(r.timestamp.map((ts, i) => [ts * 1000, closes[i]]));
}

/** Blockchain.com: no key, one request, a daily price back to 2010. Bitcoin only. */
async function historyFromBlockchain(asset, days) {
  if (asset.symbol !== 'BTC') return null;
  const span = days <= 365 ? '1year' : days <= 1825 ? '5years' : 'all';
  const j = await getJson(`https://api.blockchain.info/charts/market-price?timespan=${span}&format=json&sampled=false&cors=true`);
  const values = j && Array.isArray(j.values) ? j.values : null;
  return values ? dailyPoints(values.map((v) => [Number(v.x) * 1000, v.y])) : null;
}

/** CryptoCompare: no key for light use, every daily close since 2010 in one request. */
async function historyFromCryptoCompare(asset, days) {
  if (asset.symbol !== 'BTC') return null;
  const j = await getJson(`https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&${days > 2000 ? 'allData=true' : `limit=${days}`}`);
  const rows = j && j.Data && Array.isArray(j.Data.Data) ? j.Data.Data : null;
  return rows ? dailyPoints(rows.map((r) => [Number(r.time) * 1000, r.close])) : null;
}

/** Coinbase Exchange: no key, 300 daily candles a request, newest first. From July 2015. */
async function historyFromCoinbase(asset, days) {
  if (!asset.coinbase) return null;
  const pairs = [];
  let end = Date.now();
  const start = end - days * 86400000;
  for (let page = 0; page < 25 && end > start; page += 1) {
    const from = Math.max(start, end - 299 * 86400000);
    // eslint-disable-next-line no-await-in-loop
    const rows = await getJson(`https://api.exchange.coinbase.com/products/${encodeURIComponent(asset.coinbase)}/candles?granularity=86400&start=${new Date(from).toISOString()}&end=${new Date(end).toISOString()}`);
    if (!Array.isArray(rows) || !rows.length) break;
    rows.forEach((c) => pairs.push([Number(c[0]) * 1000, c[4]]));
    end = from - 86400000;
  }
  return pairs.length ? dailyPoints(pairs) : null;
}

/*
 * The fixture's history: a fixed, smooth walk that ends on the fixture price,
 * so a chart drawn offline or in the tests has a shape. Labelled as demo
 * prices like every other fixture quote.
 */
function historyFromFixture(asset, days) {
  const end = { ...FIXTURE, ...(fixtureOverride || {}) }[asset.symbol];
  if (!positive(end)) return null;
  const wave = (i) => -0.0011 * i + 0.07 * Math.sin(i / 11) + 0.04 * Math.sin(i / 29 + 1.3) + 0.015 * Math.sin(i / 3.1);
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const pairs = [];
  for (let i = days; i >= 0; i -= 1) pairs.push([today - i * 86400000, end * Math.exp(wave(i) - wave(0))]);
  return dailyPoints(pairs);
}

/**
 * Daily prices for the last `days` days, oldest first, as [{ t: 'YYYY-MM-DD',
 * p: dollars }]. Answers { symbol, points, source }; points is empty when no
 * provider could be reached, and the chart says so rather than drawing a line
 * it does not have.
 *
 * A provider's answer is taken only if it reaches back far enough: Yahoo has
 * Bitcoin from 2014 and Coinbase from 2015, so a series from 2012 comes from
 * one of the providers that go further. When none does, the longest answer
 * is used.
 */
async function history(symbol, days = 365) {
  const asset = BY_SYMBOL.get(String(symbol || '').toUpperCase());
  if (!asset) throw Object.assign(new Error('That asset is not available.'), { status: 400, code: 'unknown_asset' });
  // Bucketed, so a purchase made yesterday and one made last week share a cache entry.
  const longest = maxDays();
  const wanted = Math.min(longest, Math.max(30, Number(days) || 365));
  const bucket = [30, 90, 180, 365, 730, 1825, 3650, longest].find((d) => wanted <= d) || longest;
  const key = `${asset.symbol}:${bucket}`;
  let cached = historyMemory.get(key);
  if (cached && Date.now() - cached.at < HISTORY_CACHE_MS) return { symbol: asset.symbol, points: cached.points, source: cached.source };
  if (!cached && !fixtureMode()) {
    cached = await storedHistory(key);
    if (cached) {
      historyMemory.set(key, cached);
      if (Date.now() - cached.at < HISTORY_STORE_MS) return { symbol: asset.symbol, points: cached.points, source: cached.source };
    }
  }

  let points = null;
  let source = '';
  if (fixtureMode()) {
    points = historyFromFixture(asset, bucket);
    source = 'Demo prices (fixture)';
  } else {
    const reaches = dayOf(Date.now() - (bucket - 8) * DAY_MS);
    const from = dayOf(Date.now() - (bucket - 1) * DAY_MS);
    const recent = dayOf(Date.now() - 7 * DAY_MS);
    const chain = bucket <= 365
      ? [['CoinGecko', historyFromCoinGecko], ['Yahoo Finance', historyFromYahoo], ['Coinbase', historyFromCoinbase], ['Blockchain.com', historyFromBlockchain], ['CryptoCompare', historyFromCryptoCompare]]
      : [['Yahoo Finance', historyFromYahoo], ['Blockchain.com', historyFromBlockchain], ['CryptoCompare', historyFromCryptoCompare], ['Coinbase', historyFromCoinbase]];
    let best = null;
    for (const [name, provider] of chain) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const all = await provider(asset, bucket);
        // A series that stopped a week ago is no use for today's chart, and
        // only the days inside the window count towards how far it reaches.
        if (!all || all.length < 2 || all[all.length - 1].t < recent) continue;
        const got = all.filter((p) => p.t >= from && p.t >= EARLIEST);
        if (got.length < 2) continue;
        if (!best || got[0].t < best.points[0].t) best = { points: got, source: name };
        if (got[0].t <= reaches) break;
      } catch (err) {
        console.warn(`[hedgestone] ${name} history failed: ${err.message}`);
      }
    }
    if (best) ({ points, source } = best);
  }
  if (points && points.length > 1) {
    const from = dayOf(Date.now() - (bucket - 1) * DAY_MS);
    points = points.filter((p) => p.t >= from && p.t >= EARLIEST);
    const entry = { at: Date.now(), points, source };
    historyMemory.set(key, entry);
    if (!fixtureMode()) await storeHistory(key, entry);
    return { symbol: asset.symbol, points, source };
  }
  // Nothing new: an old series is better than none, and is labelled with its source.
  if (cached) return { symbol: asset.symbol, points: cached.points, source: cached.source };
  return { symbol: asset.symbol, points: [], source: '' };
}

/**
 * The price a purchase dated `when` is booked at: the live price for today,
 * otherwise that day's closing price. Refuses a day before EARLIEST or in the
 * future, and a day the providers have no price for.
 *
 * @returns {Promise<{ asset, quote: { symbol, price, source, asOf } }>}
 */
async function priceAt(symbol, when) {
  const asset = BY_SYMBOL.get(String(symbol || 'BTC').toUpperCase());
  if (!asset) throw Object.assign(new Error('That asset is not available.'), { status: 400, code: 'unknown_asset' });
  const at = new Date(when || Date.now());
  if (Number.isNaN(at.getTime())) throw Object.assign(new Error('Enter a valid date.'), { status: 400, code: 'invalid_date' });
  if (at.getTime() > Date.now() + 60000) throw Object.assign(new Error('A date in the future cannot be used.'), { status: 400, code: 'future_date' });
  const day = dayOf(at.getTime());
  if (day < EARLIEST) {
    throw Object.assign(new Error(`The earliest date that can be used is ${new Date(`${EARLIEST}T00:00:00Z`).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })}.`), { status: 400, code: 'before_earliest' });
  }
  if (day === dayOf(Date.now())) return tradeQuote(asset.symbol);

  const { points, source } = await history(asset.symbol, daysSince(day) + 1);
  let hit = null;
  for (const p of points) {
    if (p.t > day) break;
    hit = p;
  }
  if (!hit || (new Date(`${day}T00:00:00Z`) - new Date(`${hit.t}T00:00:00Z`)) > 7 * DAY_MS) {
    throw Object.assign(new Error(`We cannot get ${asset.name}'s price for ${day} right now. Try again in a minute.`), { status: 503, code: 'price_unavailable', expose: true });
  }
  return { asset, quote: { symbol: asset.symbol, price: hit.p, source: `${source}, close on ${hit.t}`, asOf: `${hit.t}T23:59:59.000Z` } };
}

/** Tests: set fixture prices and drop the cache so the next read sees them. */
function _setFixture(prices) {
  fixtureOverride = prices ? { ...prices } : null;
  memory.clear();
  historyMemory.clear();
  forceRefresh = true;
}

module.exports = {
  ASSETS, RETIRED, BY_SYMBOL, EARLIEST, list, tradeQuote, history, priceAt, TRADE_MAX_AGE_MS, _setFixture,
  _history: { dailyPoints, historyFromCoinGecko, historyFromYahoo, historyFromCoinbase, historyFromBlockchain, historyFromCryptoCompare },
};
