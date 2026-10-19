'use strict';

/**
 * End-to-end tests for the investment platform, over HTTP against the real
 * Express app and the file-backed store.
 *
 * What is worth testing here is the money and the doors: that a balance only
 * changes through an entry, that Bitcoin is the only thing that can be bought,
 * that every purchase carries a term and a maturity date, that a withdrawal
 * cannot exceed what is available, that one customer cannot see another's
 * records, that the admin console can register a customer and adjust a
 * balance, and that both are written to the activity log.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hedgestone-test-'));
process.env.DATA_DIR = DATA_DIR;
process.env.BANK_ENCRYPTION_KEY = 'test-key-not-for-production';
process.env.BANK_COOKIE_INSECURE = '1';
process.env.BANK_RATE_LIMIT_MAX = '5000';
process.env.BANK_LOGIN_RATE_LIMIT = '500';
process.env.MARKET_DATA_FIXTURE = '1';
delete process.env.RESEND_API_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

/** A tiny client that keeps cookies and echoes the CSRF token, like a browser. */
function client(base) {
  const jar = new Map();
  let csrf = '';
  return {
    get csrf() { return csrf; },
    async request(method, url, body) {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (jar.size) headers.Cookie = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
      if (csrf && method !== 'GET') headers['X-Hedgestone-CSRF'] = csrf;

      const res = await fetch(base + url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
      (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach((cookie) => {
        const [pair] = cookie.split(';');
        const idx = pair.indexOf('=');
        const key = pair.slice(0, idx).trim();
        const value = decodeURIComponent(pair.slice(idx + 1).trim());
        if (value === '') jar.delete(key); else jar.set(key, value);
        if (key === 'rf_csrf') csrf = value;
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (err) { /* CSV and files are not JSON */ }
      return { status: res.status, body: json, text, headers: res.headers };
    },
    get(url) { return this.request('GET', url); },
    post(url, body) { return this.request('POST', url, body === undefined ? {} : body); },
    patch(url, body) { return this.request('PATCH', url, body); },
    put(url, body) { return this.request('PUT', url, body); },
    del(url) { return this.request('DELETE', url); },
  };
}

const dollars = (cents) => (cents / 100).toFixed(2);

(async () => {
  const app = require(path.join(ROOT, 'src', 'app'));
  const server = await new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let failures = 0;
  const ok = (label) => console.log(`  ok  ${label}`);

  try {
    /* ---- 1. the platform introduces itself, and seeds itself doing it ---- */
    {
      const api = client(base);
      const res = await api.get('/api/bank/config');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.bank.name, 'Hedgestone Finance', 'the built-in name');
      assert.deepStrictEqual(res.body.products.map((p) => p.id), ['investment_cash'], 'one product: the cash balance');
      ok(`config: ${res.body.bank.name}, ${res.body.products.length} product`);
    }

    /* ---- 2. sign-in is two steps when two-step is on ---- */
    const customer = client(base);
    {
      const bad = await customer.post('/api/bank/auth/login', { email: 'demo@hedgestonesfinance.com', password: 'wrong-password' });
      assert.strictEqual(bad.status, 401, 'a wrong password is refused');
      assert.ok(!/unknown|no account/i.test(bad.body.message), 'the message must not confirm the address');

      const start = await customer.post('/api/bank/auth/login', { email: 'demo@hedgestonesfinance.com', password: 'Bedrock#Demo2026' });
      assert.strictEqual(start.status, 200);
      assert.strictEqual(start.body.status, 'verification_required');
      assert.ok(start.body.devCode, 'without a mail provider the code is returned');

      const wrongCode = await customer.post('/api/bank/auth/verify', { email: 'demo@hedgestonesfinance.com', code: '000000' });
      assert.strictEqual(wrongCode.status, 400, 'a wrong code is refused');

      const done = await customer.post('/api/bank/auth/verify', { email: 'demo@hedgestonesfinance.com', code: start.body.devCode });
      assert.strictEqual(done.status, 200, done.text);
      assert.strictEqual(done.body.user.email, 'demo@hedgestonesfinance.com');
      assert.ok(customer.csrf, 'a CSRF token is issued');
      ok('sign-in: password, then an emailed code');
    }

    /* ---- 3. the dashboard adds up ---- */
    let checking;
    {
      const res = await customer.get('/api/bank/overview');
      assert.strictEqual(res.status, 200, res.text);
      const { accounts, totals, recent } = res.body;
      assert.strictEqual(accounts.length, 1, 'the demo customer has one cash balance');
      checking = accounts[0];
      assert.strictEqual(checking.typeLabel, 'Cash balance');
      assert.strictEqual(totals.deposits, checking.balance, 'the headline cash is the cash balance');
      assert.ok(recent.length > 0);
      assert.ok(!('spending' in res.body) && !('cards' in res.body), 'no spending breakdown, no cards');
      ok(`overview: cash $${dollars(checking.balance)}, ${recent.length} recent entries`);
    }

    /* ---- 4. the demo customer's Bitcoin, purchase by purchase ---- */
    {
      const res = await customer.get('/api/bank/invest');
      assert.strictEqual(res.status, 200, res.text);
      const { positions, bitcoin, holdings, terms, defaultTerm } = res.body;
      assert.deepStrictEqual(terms, [3, 6, 12, 24]);
      assert.strictEqual(defaultTerm, 12);
      assert.strictEqual(positions.length, 3, 'three seeded purchases');
      assert.ok(positions[0].matured && !positions[1].matured && !positions[2].matured, 'the oldest has matured, the others have not');
      positions.forEach((p) => {
        assert.ok(p.maturesAt > p.purchasedAt, 'a maturity after the purchase');
        assert.ok(p.progress >= 0 && p.progress <= 1);
        assert.strictEqual(p.value, Math.floor(Number(p.units) * 1e8 * bitcoin.price / 1e8), 'valued at the live price');
      });
      const held = holdings.find((h) => h.symbol === 'BTC');
      const sum = positions.reduce((n, p) => n + Math.round(Number(p.units) * 1e8), 0);
      assert.strictEqual(sum, Math.round(Number(held.units) * 1e8), 'the purchases add up to the holding');
      assert.strictEqual(bitcoin.firstPurchasedAt, positions[0].purchasedAt);
      assert.strictEqual(bitcoin.nextMaturity, positions[1].maturesAt, 'the next maturity is the earliest still to come');
      ok(`portfolio: ${positions.length} purchases, ${held.units} BTC, next maturity ${bitcoin.nextMaturity.slice(0, 10)}`);
    }

    /* ---- 5. you cannot withdraw what you do not have, or pay anyone but yourself ---- */
    {
      const options = await customer.get('/api/bank/transfers/options');
      assert.deepStrictEqual(options.body.types.map((t) => t.id), ['ach', 'wire_domestic', 'wire_international'], 'withdrawals only');
      assert.ok(!('payees' in options.body), 'no bill payees');
      const beneficiary = options.body.beneficiaries[0];

      const res = await customer.post('/api/bank/transfers', {
        type: 'ach', fromAccountId: checking.id, beneficiaryId: beneficiary.id, amount: '90,000.00', pin: '4417',
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /available funds/i);

      const absurd = await customer.post('/api/bank/transfers', {
        type: 'ach', fromAccountId: checking.id, beneficiaryId: beneficiary.id, amount: '9999999.00', pin: '4417',
      });
      assert.strictEqual(absurd.status, 400);
      assert.match(absurd.body.message, /most you can withdraw/i);

      for (const type of ['internal', 'member', 'instant', 'bill_pay']) {
        // eslint-disable-next-line no-await-in-loop
        const refused = await customer.post('/api/bank/transfers', { type, fromAccountId: checking.id, amount: '5.00', memberQuery: 'x@example.com' });
        assert.strictEqual(refused.status, 400, `${type} is refused`);
        assert.strictEqual(refused.body.error, 'withdrawals_only');
      }
      for (const [method, url] of [['get', '/api/bank/cards'], ['get', '/api/bank/payees'], ['get', '/api/bank/deposits'], ['get', '/api/bank/disputes'], ['post', '/api/bank/transfers/member-lookup']]) {
        // eslint-disable-next-line no-await-in-loop
        const gone = await customer[method](url, method === 'post' ? { query: 'someone' } : undefined);
        assert.strictEqual(gone.status, 404, `${url} is gone`);
      }
      ok(`withdrawals only: overdraw refused (${res.body.message}); cards, bill pay, cheques, claims and payments to others are gone`);
    }

    /* ---- 5b. buying Bitcoin with a term, and selling it back ---- */
    {
      const markets_ = require(path.join(ROOT, 'src/bank/markets'));
      markets_._setFixture(null);

      // The ticker's feed is public, and Bitcoin is all it lists.
      const anon = client(base);
      const feed = await anon.get('/api/bank/markets');
      assert.strictEqual(feed.status, 200, feed.text);
      assert.deepStrictEqual(feed.body.assets.map((a) => a.symbol), ['BTC'], 'Bitcoin only');
      assert.ok(feed.body.assets[0].quote.price > 0, 'with a price');
      assert.match(feed.headers.get('cache-control') || '', /s-maxage/, 'the feed is cacheable at the edge');

      // So is the history behind the chart.
      const hist = await anon.get('/api/bank/markets/history?symbol=BTC&days=200');
      assert.strictEqual(hist.status, 200, hist.text);
      assert.ok(hist.body.points.length > 150, 'a point a day');
      assert.ok(hist.body.points.every((p, i, all) => !i || p.t > all[i - 1].t), 'oldest first, one per day');
      assert.strictEqual(hist.body.points[hist.body.points.length - 1].p, 63250, 'ending on the current price');
      assert.match(hist.headers.get('cache-control') || '', /s-maxage/);

      const start = await customer.get('/api/bank/invest');
      const fundFrom = start.body.accounts.find((a) => a.id === checking.id);
      assert.ok(fundFrom && fundFrom.available > 0, 'the cash balance can fund a purchase');
      const balanceOf = async () => (await customer.get('/api/bank/accounts')).body.accounts.find((a) => a.id === checking.id).balance;
      const before = await balanceOf();
      const heldBefore = Number(start.body.holdings.find((h) => h.symbol === 'BTC').units);

      // $632.50 of Bitcoin at the fixture's $63,250.00 is exactly 0.01 BTC, held 6 months.
      const buy = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'BTC', amount: '632.50', quotedPrice: 63250, termMonths: 6 });
      assert.strictEqual(buy.status, 201, buy.text);
      assert.strictEqual(buy.body.trade.units, '0.01', 'units to the satoshi');
      assert.strictEqual(buy.body.trade.price, 6325000, 'booked at the live price, in cents');
      assert.strictEqual(buy.body.trade.termMonths, 6);
      const invest_ = require(path.join(ROOT, 'src/bank/invest'));
      assert.strictEqual(buy.body.trade.maturesAt, invest_.addMonths(buy.body.trade.createdAt, 6), 'matures six months on');
      assert.strictEqual(before - await balanceOf(), 63250, 'exactly $632.50 left the cash balance');

      // Without a term, the default; with one not offered, a refusal.
      const plain = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'BTC', amount: '10.00' });
      assert.strictEqual(plain.status, 201, plain.text);
      assert.strictEqual(plain.body.trade.termMonths, 12, 'the default term');
      const odd = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'BTC', amount: '10.00', termMonths: 5 });
      assert.strictEqual(odd.status, 400, 'a term that is not offered');
      assert.strictEqual(odd.body.error, 'invalid_term');
      assert.strictEqual(invest_.addMonths('2026-01-31T10:00:00.000Z', 1), '2026-02-28T10:00:00.000Z', 'a month on from the 31st is the end of February');

      // The doors.
      for (const sym of ['SPY', 'AAPL', 'XAU']) {
        // eslint-disable-next-line no-await-in-loop
        const retired = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: sym, amount: '10' });
        assert.strictEqual(retired.status, 400, `${sym} can no longer be bought`);
        assert.strictEqual(retired.body.error, 'asset_retired');
      }
      const moved = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'BTC', amount: '100', quotedPrice: 50000 });
      assert.strictEqual(moved.status, 409, 'a price that moved past the tolerance is not booked');
      assert.strictEqual(moved.body.error, 'price_moved');
      const tooMuch = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'BTC', amount: '9000000' });
      assert.strictEqual(tooMuch.status, 400);
      const tiny = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'BTC', amount: '0.50' });
      assert.strictEqual(tiny.status, 400, 'below the minimum');
      const unknown = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'DOGE', amount: '10' });
      assert.strictEqual(unknown.status, 400, 'only listed assets');
      const noCsrf = await fetch(`${base}/api/bank/invest/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.ok([401, 403].includes(noCsrf.status), 'signed out, nothing is bought');

      // The price rises 5%: the newest purchase is worth more than it cost.
      markets_._setFixture({ BTC: 66412.5 });
      const later = await customer.get('/api/bank/invest');
      const newest = later.body.positions.find((p) => p.id === buy.body.trade.id);
      assert.strictEqual(newest.value, 66412, 'valued at the new price');
      assert.strictEqual(newest.gain, 66412 - 63250);
      assert.strictEqual(newest.termMonths, 6);

      // Selling comes off the oldest purchase first, before its maturity if need be.
      const sold = await customer.post('/api/bank/invest/sell', { accountId: checking.id, symbol: 'BTC', units: '0.01', quotedPrice: 66412.5 });
      assert.strictEqual(sold.status, 201, sold.text);
      assert.strictEqual(sold.body.trade.amount, 66412);
      const after = await customer.get('/api/bank/invest');
      assert.strictEqual(after.body.positions.length, 5, 'still five purchases, the oldest a little smaller');
      assert.strictEqual(Math.round((Number(after.body.positions[0].units) - (Number(later.body.positions[0].units) - 0.01)) * 1e8), 0, 'first in, first out');
      const heldAfter = Number(after.body.holdings.find((h) => h.symbol === 'BTC').units);
      assert.strictEqual(Math.round((heldAfter - heldBefore) * 1e8), Math.round(Number(plain.body.trade.units) * 1e8), 'what is held is what was bought less what was sold');
      const oversell = await customer.post('/api/bank/invest/sell', { accountId: checking.id, symbol: 'BTC', units: '500' });
      assert.strictEqual(oversell.status, 400, 'you cannot sell what you do not hold');

      // A holding of an asset no longer offered is still valued and can be sold.
      const db_ = require(path.join(ROOT, 'src/bank/db')).db;
      await db_.holdings.insert({ id: require('crypto').randomUUID(), created_at: new Date().toISOString(), user_id: checking.userId || (await db_.accounts.findById(checking.id)).user_id, symbol: 'SPY', units: '2', cost_basis: 100000 });
      const legacy = (await customer.get('/api/bank/invest')).body.holdings.find((h) => h.symbol === 'SPY');
      assert.ok(legacy && legacy.retired && legacy.value === 2 * 57125, 'priced at the live price, marked retired');
      const sellLegacy = await customer.post('/api/bank/invest/sell', { accountId: checking.id, symbol: 'SPY', all: true });
      assert.strictEqual(sellLegacy.status, 201, sellLegacy.text);
      assert.ok(!(await customer.get('/api/bank/invest')).body.holdings.some((h) => h.symbol === 'SPY'), 'and once sold it is gone');

      // On the ledger as investments.
      const tx = await customer.get('/api/bank/transactions?limit=10');
      assert.ok(tx.body.transactions.some((t) => t.category === 'Investments' && /Bitcoin/.test(t.description)));

      markets_._setFixture(null);
      ok(`invest: 0.01 BTC bought for $632.50 on a 6-month term, sold first-in-first-out at $66,412.50; retired assets refused but sellable`);
    }

    /* ---- 5d. an active session keeps its cookies; an ended one loses them ---- */
    {
      const db_ = require(path.join(ROOT, 'src/bank/db')).db;
      const mine = (await db_.sessions.find({ revoked_at: null })).filter((x) => x.csrf === customer.csrf)[0];
      assert.ok(mine, 'the test session is on record');
      await db_.sessions.update(mine.id, { last_seen_at: new Date(Date.now() - 5 * 60000).toISOString() });
      const slid = await customer.get('/api/bank/auth/session');
      const set = slid.headers.getSetCookie ? slid.headers.getSetCookie() : [];
      assert.ok(set.some((c) => /^rf_session=/.test(c) && /Max-Age=\d+/.test(c)), 'the session cookie is re-issued as the session slides');
      assert.ok(set.some((c) => /^rf_csrf=/.test(c)), 'and the CSRF cookie with it');

      await db_.sessions.update(mine.id, { last_seen_at: new Date(Date.now() - 5 * 60000).toISOString() });
      const feed = await customer.get('/api/bank/markets');
      assert.ok(!(feed.headers.getSetCookie ? feed.headers.getSetCookie() : []).length, 'the CDN-cached price feed never carries a cookie');

      const stale = await fetch(`${base}/api/bank/auth/session`, { headers: { Cookie: 'rf_session=gone; rf_csrf=gone' } });
      const cleared = stale.headers.getSetCookie ? stale.headers.getSetCookie() : [];
      assert.strictEqual((await stale.json()).authenticated, false);
      assert.ok(cleared.some((c) => /^rf_csrf=;/.test(c) && /Max-Age=0/.test(c)), 'cookies from an ended session are cleared');
      ok('sessions: cookies slide while active, are cleared once ended, and never ride on the price feed');
    }

    /* ---- 5c. each price provider is read the way it answers ---- */
    {
      const markets_ = require(path.join(ROOT, 'src/bank/markets'));
      const realFetch = global.fetch;
      const fixtureWas = process.env.MARKET_DATA_FIXTURE;
      delete process.env.MARKET_DATA_FIXTURE;
      const calls = [];
      let geckoDown = false;
      const respond = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
      const day = 86400;
      global.fetch = async (url) => {
        const u = String(url);
        calls.push(new URL(u).host);
        if (u.includes('coingecko.com')) {
          if (geckoDown) return respond('rate limited', 429);
          if (u.includes('/market_chart')) return respond({ prices: [[1760000000000, 60000], [1760000000000 + 3600000, 60500], [1760000000000 + day * 1000, 61000]] });
          return respond({ bitcoin: { usd: 64000, usd_24h_change: 2.5, last_updated_at: 1760000000 } });
        }
        if (u.includes('finance.yahoo.com')) {
          if (u.includes('range=') && !u.includes('range=1d')) {
            return respond({ chart: { result: [{ timestamp: [1760000000, 1760000000 + day, 1760000000 + 2 * day], indicators: { quote: [{ close: [59000, null, 59500] }] } }] } });
          }
          return respond({ chart: { result: [{ meta: { regularMarketPrice: 63800, chartPreviousClose: 63000, regularMarketTime: 1760000000 } }] } });
        }
        if (u.includes('coinbase.com')) {
          if (u.includes('/candles')) return respond([[1760000000 + day, 1, 2, 3, 62000, 9], [1760000000, 1, 2, 3, 61500, 9]]);
          return respond({ data: { amount: '63900.00' } });
        }
        return respond('not found', 404);
      };
      try {
        markets_._setFixture(null);
        let list = await markets_.list();
        assert.strictEqual(list[0].quote.price, 64000);
        assert.strictEqual(list[0].quote.source, 'CoinGecko');
        assert.strictEqual(list[0].quote.changePct, 2.5);

        geckoDown = true;
        markets_._setFixture(null);
        list = await markets_.list();
        assert.strictEqual(list[0].quote.price, 63900, 'when CoinGecko refuses, Coinbase answers');
        assert.strictEqual(list[0].quote.source, 'Coinbase');

        // History: CoinGecko's hourly points fold to one a day; Yahoo skips gaps.
        geckoDown = false;
        markets_._setFixture(null);
        let h = await markets_.history('BTC', 30);
        assert.deepStrictEqual(h.points.map((p) => p.p), [60500, 61000], 'the last price of each day');
        assert.strictEqual(h.source, 'CoinGecko');
        geckoDown = true;
        markets_._setFixture(null);
        h = await markets_.history('BTC', 30);
        assert.deepStrictEqual(h.points.map((p) => p.p), [59000, 59500], 'Yahoo, with the missing close left out');
        assert.strictEqual(h.source, 'Yahoo Finance');
        const cb = await markets_._history.historyFromCoinbase(markets_.BY_SYMBOL.get('BTC'), 30);
        assert.deepStrictEqual(cb.map((p) => p.p), [61500, 62000], 'Coinbase candles, newest first, turned oldest first');
        ok('prices: CoinGecko, Coinbase and Yahoo parsed for the price and its history; each takes over when the one before refuses');
      } finally {
        global.fetch = realFetch;
        if (fixtureWas) process.env.MARKET_DATA_FIXTURE = fixtureWas;
        markets_._setFixture(null);
      }
    }

    /* ---- 6. an outside transfer needs a code, then waits for review ---- */
    let heldTransferId;
    {
      const options = await customer.get('/api/bank/transfers/options');
      assert.strictEqual(options.status, 200);
      const beneficiary = options.body.beneficiaries.find((b) => b.type === 'domestic_ach');
      assert.ok(beneficiary, 'the demo customer has a saved withdrawal account');

      const availableBefore = options.body.accounts.find((a) => a.id === checking.id).availableBalance;

      const res = await customer.post('/api/bank/transfers', {
        type: 'ach', fromAccountId: checking.id, beneficiaryId: beneficiary.id,
        amount: '400.00', memo: 'Rent share', pin: '4417',
      });
      assert.strictEqual(res.status, 201, res.text);
      assert.strictEqual(res.body.next, 'verify');
      const code = res.body.verification.devCode;
      assert.ok(code, 'a verification code was issued');
      heldTransferId = res.body.transfer.id;

      const verified = await customer.post(`/api/bank/transfers/${heldTransferId}/verify`, { code });
      assert.strictEqual(verified.status, 200, verified.text);
      assert.strictEqual(verified.body.next, 'review', 'it goes to the review queue');
      assert.strictEqual(verified.body.transfer.status, 'pending_review');

      const accountsNow = await customer.get('/api/bank/accounts');
      const availableAfter = accountsNow.body.accounts.find((a) => a.id === checking.id).availableBalance;
      assert.strictEqual(availableBefore - availableAfter, 40000, 'the funds are held while it waits');
      ok('withdrawal: verified by code, funds held, queued for review');
    }

    /* ---- 7. the wrong PIN stops a transfer ---- */
    {
      const options = await customer.get('/api/bank/transfers/options');
      const beneficiary = options.body.beneficiaries[0];
      const res = await customer.post('/api/bank/transfers', {
        type: 'ach', fromAccountId: checking.id, beneficiaryId: beneficiary.id, amount: '10.00', pin: '0000',
      });
      assert.strictEqual(res.status, 403);
      assert.match(res.body.message, /PIN/i);
      ok('a wrong withdrawal PIN is refused');
    }

    /* ---- 8. a recipient needs a routing number that passes the checksum ---- */
    {
      const bad = await customer.post('/api/bank/beneficiaries', {
        name: 'Test Person', accountNumber: '1234567890', routingNumber: '123456789', bankName: 'Nowhere Bank',
      });
      assert.strictEqual(bad.status, 400);
      assert.match(bad.body.message, /routing/i);

      const good = await customer.post('/api/bank/beneficiaries', {
        nickname: 'Contractor', name: 'Ridge Builders LLC', accountNumber: '778811224466',
        routingNumber: '021000021', bankName: 'Hudson Savings', accountType: 'checking', type: 'domestic_ach',
      });
      assert.strictEqual(good.status, 201, good.text);
      assert.strictEqual(good.body.beneficiary.accountLast4, '4466');
      ok('withdrawal accounts: ABA checksum enforced, valid one saved');
    }

    /* ---- 10. a photo upload becomes the avatar ---- */
    {
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const res = await customer.post('/api/bank/me/documents', { kind: 'avatar', filename: 'me.png', file: png });
      assert.strictEqual(res.status, 201, res.text);
      const me = await customer.get('/api/bank/me');
      assert.ok(me.body.user.photoUrl.includes('/documents/'), 'the profile carries the photo');
      const file = await customer.get(me.body.user.photoUrl);
      assert.strictEqual(file.status, 200);
      assert.match(file.headers.get('content-type'), /image\/png/);
      ok('photo upload: stored, linked to the profile and served back');
    }

    /* ---- 11. CSV export ---- */
    {
      const csvRes = await customer.get('/api/bank/transactions/export?limit=50');
      assert.strictEqual(csvRes.status, 200);
      assert.match(csvRes.headers.get('content-type'), /text\/csv/);
      assert.match(csvRes.text.split('\n')[0], /^Date,Account,Description/);
      const statements = await customer.get(`/api/bank/accounts/${checking.id}/statements`);
      assert.strictEqual(statements.status, 404, 'statements are gone');
      ok('CSV export works; statements are gone');
    }

    /* ---- 12. another customer's account is simply not there ---- */
    {
      const admin = client(base);
      const signIn = await admin.post('/api/bank/auth/login', { email: 'admin@hedgestonesfinance.com', password: 'Hedgestone#Admin2026' });
      assert.strictEqual(signIn.status, 200, signIn.text);
      const list = await admin.get('/api/bank/admin/customers?q=mara');
      const other = list.body.customers[0];
      const otherDetail = await admin.get(`/api/bank/admin/customers/${other.id}`);
      const otherAccountId = otherDetail.body.accounts[0].id;

      const attempt = await customer.get(`/api/bank/transactions?accountId=${otherAccountId}`);
      assert.strictEqual(attempt.status, 404, 'not 403: the id is not confirmed to exist');
      const attemptAdmin = await customer.get('/api/bank/admin/customers');
      assert.strictEqual(attemptAdmin.status, 403, 'a customer is not staff');
      ok('isolation: another customer’s account is a 404, the console is a 403');
    }

    /* ---- 13. the console registers a customer, with accounts and a balance ---- */
    const admin = client(base);
    let newCustomerId;
    let newAccountId;
    {
      const signIn = await admin.post('/api/bank/auth/login', { email: 'admin@hedgestonesfinance.com', password: 'Hedgestone#Admin2026' });
      assert.strictEqual(signIn.body.user.role, 'admin');

      const res = await admin.post('/api/bank/admin/customers', {
        email: 'newcustomer@example.com',
        firstName: 'Dana', lastName: 'Whitfield',
        dateOfBirth: '1991-06-08', ssn: '223456789',
        phone: '(614) 555-0133', addressLine1: '77 Quarry Lane', city: 'Columbus', state: 'OH', postalCode: '43201',
        employmentStatus: 'Employed', occupation: 'Nurse', annualIncome: '84000',
        openingBalance: '3500.00',
      });
      assert.strictEqual(res.status, 201, res.text);
      assert.ok(res.body.temporaryPassword, 'a temporary password is issued');
      assert.strictEqual(res.body.accounts.length, 1, 'one cash balance');
      assert.strictEqual(res.body.accounts[0].name, 'Cash balance');
      assert.strictEqual(res.body.accounts[0].balance, 350000, 'the opening balance posted');
      assert.strictEqual(res.body.customer.ssnMasked.slice(-4), '6789', 'the SSN is stored masked');
      const db_ = require(path.join(ROOT, 'src/bank/db')).db;
      assert.strictEqual((await db_.cards.find({ user_id: res.body.customer.id })).length, 0, 'and no card');
      newCustomerId = res.body.customer.id;
      newAccountId = res.body.accounts[0].id;
      ok(`console: registered ${res.body.customer.fullName} with a cash balance of $3,500.00 and no card`);
    }

    /* ---- 14. adding a balance writes an entry, not just a number ---- */
    {
      const before = await admin.get(`/api/bank/admin/customers/${newCustomerId}`);
      const balanceBefore = before.body.accounts.find((a) => a.id === newAccountId).balance;

      const res = await admin.post(`/api/bank/admin/accounts/${newAccountId}/adjust`, {
        amount: '2,400.00', direction: 'credit', description: 'DEPOSIT RECEIVED',
        method: 'adjustment', category: 'Deposits', note: 'Cleared by ops',
      });
      assert.strictEqual(res.status, 201, res.text);
      assert.strictEqual(res.body.account.balance - balanceBefore, 240000);
      assert.strictEqual(res.body.transaction.description, 'DEPOSIT RECEIVED');

      const debit = await admin.post(`/api/bank/admin/accounts/${newAccountId}/adjust`, {
        amount: '150.00', direction: 'debit', description: 'SERVICE CHARGE', method: 'fee', category: 'Fees & Interest',
      });
      assert.strictEqual(debit.body.account.balance, balanceBefore + 240000 - 15000);
      ok('console: credited $2,400.00 and debited $150.00, each as a dated entry');
    }

    /* ---- 15. the queue: approve one transfer, return another ---- */
    {
      const queue = await admin.get('/api/bank/admin/transfers?status=pending_review');
      assert.ok(queue.body.transfers.length >= 1, 'the held transfer is in the queue');
      assert.ok(queue.body.transfers[0].customer, 'the queue names the customer');

      const approved = await admin.post(`/api/bank/admin/transfers/${heldTransferId}/approve`, { note: 'Verified by phone' });
      assert.strictEqual(approved.status, 200, approved.text);
      assert.strictEqual(approved.body.transfer.status, 'completed');
      assert.ok(approved.body.transfer.traceNumber, 'a completed standard withdrawal carries a trace reference');

      // And a second one, returned with a reason the customer will see.
      const options = await customer.get('/api/bank/transfers/options');
      const beneficiary = options.body.beneficiaries[0];
      const submitted = await customer.post('/api/bank/transfers', {
        type: 'wire_domestic', fromAccountId: checking.id, beneficiaryId: beneficiary.id, amount: '900.00', pin: '4417',
      });
      const verified = await customer.post(`/api/bank/transfers/${submitted.body.transfer.id}/verify`, {
        code: submitted.body.verification.devCode,
      });
      assert.strictEqual(verified.body.transfer.status, 'pending_review');

      const availableHeld = (await customer.get('/api/bank/accounts')).body.accounts.find((a) => a.id === checking.id).availableBalance;
      const rejected = await admin.post(`/api/bank/admin/transfers/${submitted.body.transfer.id}/reject`, {
        reasonCode: 'beneficiary_unverified', note: 'The receiving bank could not confirm the account name.',
      });
      assert.strictEqual(rejected.body.transfer.status, 'rejected');
      const availableBack = (await customer.get('/api/bank/accounts')).body.accounts.find((a) => a.id === checking.id).availableBalance;
      assert.strictEqual(availableBack - availableHeld, 92500, 'the held funds and the same-day fee come back');
      ok('queue: one released with a trace number, one returned and the hold released');
    }

    /* ---- 16. the customer is told, in the app and by email ---- */
    {
      const res = await customer.get('/api/bank/alerts');
      assert.ok(res.body.alerts.length >= 3, 'alerts were raised');
      const rejection = res.body.alerts.find((a) => a.type === 'transfer_rejected');
      assert.ok(rejection, 'the returned withdrawal raised an alert');
      assert.match(rejection.body, /could not confirm the account name/i, 'the reason reaches the customer');
      assert.strictEqual(rejection.status, 'not_configured', 'without Resend it is stored, not sent');
      ok(`alerts: ${res.body.alerts.length} raised, the rejection carries the reason`);
    }

    /* ---- 17. everything is in the activity log, with a name against it ---- */
    {
      const res = await admin.get('/api/bank/admin/activity?limit=200');
      const actions = res.body.activity.map((a) => a.action);
      ['auth.login', 'transfer.submitted', 'transfer.completed', 'transfer.rejected',
        'admin.customer_created', 'admin.balance_adjusted', 'document.uploaded'].forEach((action) => {
        assert.ok(actions.includes(action), `the log records ${action}`);
      });
      const adjust = res.body.activity.find((a) => a.action === 'admin.balance_adjusted');
      assert.strictEqual(adjust.actorEmail, 'admin@hedgestonesfinance.com', 'the log names who did it');
      assert.ok(adjust.ip !== undefined && adjust.device, 'with where they did it from');
      ok(`activity log: ${res.body.total} rows, staff actions attributed`);
    }

    /* ---- 18. the console can suspend, and suspension bites ---- */
    {
      await admin.post(`/api/bank/admin/customers/${newCustomerId}/status`, { status: 'suspended', reason: 'Fraud review' });
      const target = client(base);
      const attempt = await target.post('/api/bank/auth/login', { email: 'newcustomer@example.com', password: 'whatever' });
      assert.ok([401, 403].includes(attempt.status), 'a suspended customer cannot get in');
      await admin.post(`/api/bank/admin/customers/${newCustomerId}/status`, { status: 'active' });
      ok('console: suspend and restore');
    }

    /* ---- 18c. staff back-posting: trades and entries booked after the fact ---- */
    {
      const found = await admin.get('/api/bank/admin/customers?q=demo%40hedgestonesfinance.com&limit=5');
      const jordan = found.body.customers[0];
      assert.ok(jordan, 'the demo customer is found');
      const acctOf = async () => (await admin.get(`/api/bank/admin/customers/${jordan.id}`)).body.accounts.find((a) => a.id === checking.id);
      const holdingOf = async (sym) => ((await admin.get(`/api/bank/admin/customers/${jordan.id}/investments`)).body.holdings.find((h) => h.symbol === sym) || { units: '0' });
      // A running balance that adds up: each posted entry's balance_after,
      // in value-date order, ends at the account balance.
      const chainHolds = async () => {
        const rows = (await admin.get(`/api/bank/admin/customers/${jordan.id}`)).body.transactions
          .filter((t) => t.accountId === checking.id && ['posted', 'reversed'].includes(t.status));
        const latest = rows.slice().sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))[0];
        return latest && latest.balanceAfter === (await acctOf()).balance;
      };

      const before = (await acctOf()).balance;
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
      const booked = await admin.post('/api/bank/admin/trades', {
        customerId: jordan.id, side: 'buy', accountId: checking.id, symbol: 'BTC',
        amount: '1000.00', price: '50000.00', date: twoDaysAgo, note: 'Instruction taken by phone', termMonths: 9,
      });
      assert.strictEqual(booked.status, 201, booked.text);
      assert.strictEqual(booked.body.trade.units, '0.02', 'exactly 0.02 BTC at the agreed $50,000.00');
      assert.strictEqual(booked.body.trade.price, 5000000);
      assert.strictEqual(booked.body.trade.createdAt, twoDaysAgo, 'booked at the agreed time');
      assert.strictEqual(booked.body.trade.termMonths, 9, 'staff may book any whole number of months');
      assert.strictEqual(booked.body.trade.source, 'Entered by staff');
      assert.strictEqual(before - (await acctOf()).balance, 100000, '$1,000.00 left checking');
      assert.ok(await chainHolds(), 'running balances restated around the back-dated entry');

      const asCustomer = await customer.post('/api/bank/admin/trades', { customerId: jordan.id, side: 'buy', accountId: checking.id, symbol: 'BTC', amount: '5' });
      assert.strictEqual(asCustomer.status, 403, 'customers cannot back-post');
      const future = await admin.post('/api/bank/admin/trades', { customerId: jordan.id, side: 'buy', accountId: checking.id, symbol: 'BTC', amount: '5', date: new Date(Date.now() + 86400000).toISOString() });
      assert.strictEqual(future.status, 400, 'nothing dated in the future');

      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
      const moved = await admin.patch(`/api/bank/admin/trades/${booked.body.trade.id}`, { date: threeDaysAgo, note: 'Network down; instruction taken by phone' });
      assert.strictEqual(moved.status, 200, moved.text);
      const movedTx = (await admin.get(`/api/bank/admin/customers/${jordan.id}`)).body.transactions.find((t) => t.id === booked.body.trade.transactionId);
      assert.strictEqual(movedTx.date, threeDaysAgo, 'its ledger entry moved with it');
      assert.strictEqual(moved.body.trade.maturesAt, require(path.join(ROOT, 'src/bank/invest')).addMonths(threeDaysAgo, 9), 'and its maturity');
      assert.ok(await chainHolds());
      const reterm = await admin.patch(`/api/bank/admin/trades/${booked.body.trade.id}`, { termMonths: 18 });
      assert.strictEqual(reterm.status, 200, reterm.text);
      assert.strictEqual(reterm.body.trade.termMonths, 18, 'the term can be changed on its own');
      assert.strictEqual(reterm.body.trade.createdAt, threeDaysAgo, 'without moving the purchase');

      const fixAmount = await admin.patch(`/api/bank/admin/transactions/${booked.body.trade.transactionId}`, { amount: '900.00' });
      assert.strictEqual(fixAmount.status, 409, 'a purchase is corrected by reversing, not by editing its amount');

      const btcBefore = Number((await holdingOf('BTC')).units);
      const reversed = await admin.post(`/api/bank/admin/trades/${booked.body.trade.id}/reverse`, { note: 'Booked to the wrong customer' });
      assert.strictEqual(reversed.status, 200, reversed.text);
      assert.strictEqual(reversed.body.trade.status, 'reversed');
      assert.strictEqual(Math.round((btcBefore - Number((await holdingOf('BTC')).units)) * 1e8), 2e6, 'the 0.02 BTC came off the holding');
      assert.strictEqual((await acctOf()).balance, before, 'and the $1,000.00 came back');
      const again = await admin.post(`/api/bank/admin/trades/${booked.body.trade.id}/reverse`, {});
      assert.strictEqual(again.status, 409, 'a trade reverses once');

      // The console's ordinary Reverse on a purchase's entry undoes the whole trade.
      const second = await admin.post('/api/bank/admin/trades', { customerId: jordan.id, side: 'buy', accountId: checking.id, symbol: 'BTC', amount: '500.00', price: '50000.00' });
      assert.strictEqual(second.status, 201, second.text);
      const btcMid = Number((await holdingOf('BTC')).units);
      const viaEntry = await admin.post(`/api/bank/admin/transactions/${second.body.trade.transactionId}/settle`, { action: 'reverse', note: 'Duplicate' });
      assert.strictEqual(viaEntry.status, 200, viaEntry.text);
      assert.strictEqual(Math.round((btcMid - Number((await holdingOf('BTC')).units)) * 1e8), 1e6, 'units and cash both undone');

      // An ordinary entry: back-dated with a time, then its amount corrected.
      const yesterday = new Date(Date.now() - 86400000);
      yesterday.setUTCHours(14, 35, 0, 0);
      const walkIn = await admin.post(`/api/bank/admin/accounts/${checking.id}/adjust`, {
        direction: 'credit', amount: '100.00', description: 'DEPOSIT RECEIVED', date: yesterday.toISOString(), notify: false,
      });
      assert.strictEqual(walkIn.status, 201, walkIn.text);
      assert.strictEqual(walkIn.body.transaction.date, yesterday.toISOString(), 'dated to the minute');
      const balWalkIn = (await acctOf()).balance;
      const amended = await admin.patch(`/api/bank/admin/transactions/${walkIn.body.transaction.id}`, { amount: '125.00', description: 'DEPOSIT RECEIVED (corrected)' });
      assert.strictEqual(amended.status, 200, amended.text);
      assert.strictEqual(amended.body.transaction.amount, 12500);
      assert.strictEqual((await acctOf()).balance - balWalkIn, 2500, 'the balance moved by the difference');
      assert.ok(await chainHolds(), 'and the running balances still add up');
      const audit = (await admin.get('/api/bank/admin/activity?limit=40')).body.activity.map((a) => a.action);
      ['admin.trade_reversed', 'admin.trade_retimed', 'admin.transaction_updated', 'invest.buy'].forEach((a) => assert.ok(audit.includes(a), `${a} is in the activity log`));
      ok('back-posting: staff booked 0.02 BTC at $50,000 two days back on a 9-month term, moved it, re-termed it, reversed it; a deposit dated and corrected');
    }

    /* ---- 18b. the console's setup checklist and investments views ---- */
    {
      const setupRes = await admin.get('/api/bank/admin/setup');
      assert.strictEqual(setupRes.status, 200, setupRes.text);
      const ids = setupRes.body.items.map((i) => i.id);
      ['supabase', '0003_bank.sql', '0005_bank_invest.sql', '0007_invest_term.sql', 'encryption', 'resend', 'prices', 'history'].forEach((id) => assert.ok(ids.includes(id), `checks ${id}`));
      const db = setupRes.body.items.find((i) => i.id === 'supabase');
      assert.strictEqual(db.status, 'todo', 'running on files, the database is a to-do');
      assert.ok(db.fix && /SUPABASE_URL/.test(db.fix), 'and says how to fix it');
      assert.ok(setupRes.body.items.every((i) => ['done', 'todo', 'blocked', 'optional'].includes(i.status)));
      assert.ok(!JSON.stringify(setupRes.body).includes('test-key-not-for-production'), 'no secret values, only names');
      const asCustomer = await customer.get('/api/bank/admin/setup');
      assert.strictEqual(asCustomer.status, 403, 'customers cannot see it');

      const inv = await admin.get('/api/bank/admin/investments');
      assert.strictEqual(inv.status, 200, inv.text);
      assert.ok(inv.body.holdings.length >= 1, 'the demo customer\'s Bitcoin is listed');
      assert.ok(inv.body.holdings.every((h) => h.customer && h.customer.fullName), 'with who holds it');
      assert.ok(inv.body.totals.value > 0 && inv.body.trades.length >= 4);
      const holder = inv.body.holdings[0].customer.id;
      const one = await admin.get(`/api/bank/admin/customers/${holder}/investments`);
      assert.strictEqual(one.status, 200, one.text);
      assert.ok(one.body.holdings.length >= 1);
      assert.ok(one.body.positions.length >= 1 && one.body.positions[0].maturesAt, 'with each purchase and its maturity');
      ok(`console: setup checklist of ${ids.length} items, ${inv.body.holdings.length} holding(s) worth $${dollars(inv.body.totals.value)} across customers`);
    }

    /* ---- 19. settings an operator changes take effect ---- */
    {
      const res = await admin.put('/api/bank/admin/settings', {
        announcement: 'Scheduled maintenance on Sunday 02:00-04:00 ET.',
        fees: { wireDomestic: 3000 },
      });
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.body.settings.fees.wireDomestic, 3000);
      const options = await customer.get('/api/bank/transfers/options');
      const wire = options.body.types.find((t) => t.id === 'wire_domestic');
      assert.strictEqual(wire.fee, 3000, 'the customer sees the new fee');
      const config = await client(base).get('/api/bank/config');
      assert.match(config.body.announcement, /maintenance/i);
      ok('settings: a fee change reaches the withdrawal form and the banner reaches the public page');
    }

    /* ---- 19a. the terms on offer are set at the console ---- */
    {
      const bad = await admin.put('/api/bank/admin/settings', { investmentTerms: '3, six' });
      assert.strictEqual(bad.status, 400, 'terms are whole months');
      const outside = await admin.put('/api/bank/admin/settings', { investmentTerms: '6, 12', investmentTermMonths: 24 });
      assert.strictEqual(outside.status, 400, 'the default has to be one of them');
      const res = await admin.put('/api/bank/admin/settings', { investmentTerms: '18, 6, 6, 36', investmentTermMonths: 18 });
      assert.strictEqual(res.status, 200, res.text);
      assert.deepStrictEqual(res.body.settings.investmentTerms, [6, 18, 36], 'sorted, without repeats');
      const inv = await customer.get('/api/bank/invest');
      assert.deepStrictEqual(inv.body.terms, [6, 18, 36]);
      assert.strictEqual(inv.body.defaultTerm, 18);
      await admin.put('/api/bank/admin/settings', { investmentTerms: [3, 6, 12, 24], investmentTermMonths: 12 });
      ok('settings: the terms offered and the default term are set at the console');
    }

    /* ---- 19b. the platform's name, set at the console, reaches every page and email ---- */
    {
      const res = await admin.put('/api/bank/admin/settings', { bankName: 'Hedge' });
      assert.strictEqual(res.status, 200, res.text);
      const site = await client(base).get('/api/site');
      assert.strictEqual(site.body.name, 'Hedge', 'the public pages are told the new name');
      assert.strictEqual(site.headers.get('cache-control'), 'no-cache', 'and are not left holding the old one');
      const session = await customer.get('/api/bank/auth/session');
      assert.strictEqual(session.body.bankName, 'Hedge', 'so are the signed-in pages');

      // An email written with the built-in name goes out under the new one.
      const alerts_ = require(ROOT + '/src/bank/alerts');
      const users_ = require(ROOT + '/src/bank/users');
      const { BANK: B } = require(ROOT + '/src/bank/constants');
      const raised = await alerts_.notifyUser(await users_.findByEmail('demo@hedgestonesfinance.com'), 'profile_changed', {
        force: true, subject: `Your ${B.name} profile was updated`, heading: 'Your details changed', intro: `${B.name} updated your profile.`,
      });
      assert.strictEqual(raised.subject, 'Your Hedge profile was updated');
      assert.ok(raised.body_html.includes('Hedge updated your profile') && !raised.body_html.includes('Hedgestone'), 'every line of the email');

      // The seeded name we used to ship is not a choice anybody made.
      await admin.put('/api/bank/admin/settings', { bankName: 'Hedgestone Global Bank' });
      assert.strictEqual((await client(base).get('/api/site')).body.name, 'Hedgestone Finance', 'the retired default gives way');
      await admin.put('/api/bank/admin/settings', { bankName: '' });
      const back = await client(base).get('/api/site');
      assert.strictEqual(back.body.name, 'Hedgestone Finance', 'a blank name falls back to the built one');
      ok('settings: a new name reaches the public site, the signed-in pages and every email; a blank or retired one restores the default');
    }

    /* ---- 20. CSRF and sign-out ---- */
    {
      const res = await fetch(`${base}/api/bank/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Cookie: `rf_session=nonsense` },
        body: JSON.stringify({ phone: '(000) 000-0000' }),
      });
      assert.strictEqual(res.status, 401, 'no session, no change');

      await customer.post('/api/bank/auth/logout');
      const after = await customer.get('/api/bank/auth/session');
      assert.strictEqual(after.body.authenticated, false, 'the session is gone');
      ok('sign-out clears the session');
    }

    /* ---- 21. a deployment never hands a one-time code back ---- */
    {
      const api = client(base);
      const onLaptop = await api.post('/api/bank/auth/forgot', { email: 'demo@hedgestonesfinance.com' });
      assert.ok(onLaptop.body.devCode, 'without mail configured, local development can still sign in');

      // The same request from something that looks deployed must not answer
      // with the code: /auth/forgot takes an address from anybody, and
      // /auth/reset takes that code, so together they would be a takeover.
      process.env.VERCEL = '1';
      const deployed = await api.post('/api/bank/auth/forgot', { email: 'demo@hedgestonesfinance.com' });
      delete process.env.VERCEL;
      assert.strictEqual(deployed.status, 200, 'the endpoint still answers the same way');
      assert.strictEqual(deployed.body.devCode, undefined, 'but the code is withheld');
      assert.strictEqual(deployed.body.status, 'sent', 'and it says nothing about whether the address exists');

      const config = require(ROOT + '/src/utils/config');
      process.env.RESEND_API_KEY = 'test-key';
      assert.strictEqual(config.showDevCodes(), false, 'configured mail withholds them too');
      delete process.env.RESEND_API_KEY;
      ok('one-time codes are returned to a laptop and withheld from a deployment');
    }

    /* ---- 22. a credit tells the customer twice, and by text ---- */
    {
      // Money arriving raises two alerts, not one: it has landed, then what
      // can actually be spent. Those are different numbers whenever any part
      // of the balance is on hold or the account carries an overdraft line.
      const http_ = require('http');
      const texts = [];
      const pingram = http_.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          texts.push({ auth: req.headers.authorization, ...JSON.parse(body) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"id":"msg_test"}');
        });
      });
      await new Promise((r) => pingram.listen(0, '127.0.0.1', r));
      process.env.PINGRAM_API_KEY = 'pingram_sk_test';
      process.env.PINGRAM_SMS_URL = `http://127.0.0.1:${pingram.address().port}/sms`;

      const db_ = require(ROOT + '/src/bank/db').db;
      const ledger_ = require(ROOT + '/src/bank/ledger');
      const alerts_ = require(ROOT + '/src/bank/alerts');
      const users_ = require(ROOT + '/src/bank/users');

      const who = await users_.findByEmail('demo@hedgestonesfinance.com');
      const acct = (await db_.accounts.find({ user_id: who.id })).find((a) => a.type === 'checking');
      const before = (await db_.alerts.find({ user_id: who.id })).length;

      const posted = await ledger_.post({
        accountId: acct.id, direction: 'credit', amount: 250000,
        description: 'DEPOSIT RECEIVED - TEST', method: 'adjustment', status: 'posted', createdBy: 'admin',
      });
      const raised = await alerts_.creditPosted(who, {
        account: posted.account, transaction: posted.transaction, amount: 250000,
        balance: posted.account.balance, available: ledger_.availableFor(posted.account),
      });

      pingram.close();
      delete process.env.PINGRAM_API_KEY;
      delete process.env.PINGRAM_SMS_URL;

      assert.strictEqual(raised.length, 2, 'two alerts, not one');
      assert.strictEqual(raised[0].type, 'deposit_posted');
      assert.strictEqual(raised[1].type, 'balance_available');
      const after = (await db_.alerts.find({ user_id: who.id })).length;
      assert.strictEqual(after, before + 2, 'both are stored, so they show in the app with no provider');

      assert.strictEqual(texts.length, 2, 'and both go out as texts');
      assert.strictEqual(texts[0].auth, 'Bearer pingram_sk_test');
      assert.match(texts[0].to.number, /^\+1\d{10}$/, 'the number is normalised to E.164');
      assert.match(texts[0].sms.message, /credited/i);
      assert.match(texts[0].sms.message, /Current balance/i);
      assert.match(texts[1].sms.message, /Available to invest or withdraw/i);

      // The available figure is larger than the balance here, because this
      // account has an overdraft line. The message has to say so, or it reads
      // as the bank inventing money.
      const held = Number(posted.account.hold_amount || 0);
      if (held > 0) assert.match(texts[1].sms.message, /on hold/i, 'a hold is named');
      if (Number(posted.account.overdraft_limit || 0) > 0) {
        assert.match(texts[1].sms.message, /overdraft/i, 'the overdraft line is named');
      }
      ok(`a credit raises two alerts and two texts: "${texts[1].sms.message.slice(0, 64)}..."`);
    }

    /* ---- 23. an alert still records the email on a database missing 0004 -- */
    {
      // sms_status and sms_error arrived with the text channel. PostgREST
      // rejects the whole PATCH when one column is missing, so on a database
      // still on 0003 the update threw, the catch marked the alert failed,
      // and an email that had been delivered was recorded as a failure - the
      // row lying about the one thing it exists to record.
      const db_ = require(ROOT + '/src/bank/db').db;
      const alerts_ = require(ROOT + '/src/bank/alerts');
      const users_ = require(ROOT + '/src/bank/users');
      const who = await users_.findByEmail('demo@hedgestonesfinance.com');

      const real = db_.alerts.update;
      let refusals = 0;
      db_.alerts.update = async (id, patch) => {
        if ('sms_status' in patch || 'sms_error' in patch) {
          refusals += 1;
          const err = new Error(
            'supabase update bank_alerts failed: 400 {"code":"PGRST204","message":'
            + '"Could not find the \'sms_status\' column of \'bank_alerts\' in the schema cache"}'
          );
          throw err;
        }
        return real.call(db_.alerts, id, patch);
      };

      let raised;
      try {
        raised = await alerts_.notifyUser(who, 'deposit_posted', {
          force: true,
          subject: 'Money in - $10.00',
          intro: 'A test credit.',
          sms: 'A test credit.',
        });
      } finally {
        db_.alerts.update = real;
      }

      assert.ok(refusals > 0, 'the stand-in refused the write the way PostgREST does');
      assert.notStrictEqual(raised.status, 'failed', 'a refused text column must not fail the email');
      const stored = await db_.alerts.findById(raised.id);
      assert.ok(stored, 'the alert is still on record');
      assert.notStrictEqual(stored.status, 'failed', 'and reads as it actually went');
      ok(`a database without 0004 still records the email: status "${stored.status}"`);
    }

    /* ---- 24. a purchase still books on a database missing 0007 ---- */
    {
      // term_months and matures_at arrived with 0007. PostgREST refuses a row
      // that names a column it does not have, so the purchase is written
      // without them and its maturity is worked out from the default term.
      const db_ = require(ROOT + '/src/bank/db').db;
      const invest_ = require(ROOT + '/src/bank/invest');
      const users_ = require(ROOT + '/src/bank/users');
      const who = await users_.findByEmail('demo@hedgestonesfinance.com');
      const cash = (await db_.accounts.find({ user_id: who.id })).find((a) => a.type === 'checking');
      const real = db_.trades.insert;
      let refusals = 0;
      db_.trades.insert = async (row) => {
        if ('term_months' in row || 'matures_at' in row) {
          refusals += 1;
          throw new Error('supabase insert bank_trades failed: 400 {"code":"PGRST204","message":"Could not find the \'matures_at\' column of \'bank_trades\' in the schema cache"}');
        }
        return real.call(db_.trades, row);
      };
      let result;
      try {
        result = await invest_.convert(who, { accountId: cash.id, symbol: 'BTC', amount: 1000, termMonths: 24 }, null, { silent: true });
      } finally {
        db_.trades.insert = real;
      }
      assert.ok(refusals > 0, 'the stand-in refused the columns the way PostgREST does');
      const stored = await db_.trades.findById(result.trade.id);
      assert.ok(stored && !('matures_at' in stored), 'the purchase is on record without them');
      assert.strictEqual(result.trade.termMonths, 12, 'read back on the default term');
      assert.strictEqual(result.trade.maturesAt, invest_.addMonths(stored.created_at, 12));
      ok('a database without 0007 still books the purchase, on the default term');
    }

    console.log('\n  all platform tests passed');
  } catch (err) {
    failures += 1;
    console.error('\n  FAILED:', err && err.message);
    console.error(err && err.stack);
  } finally {
    server.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    process.exit(failures ? 1 : 0);
  }
})();
