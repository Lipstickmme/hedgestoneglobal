'use strict';

/**
 * End-to-end tests for the Bitcoin vault, over HTTP against the real Express
 * app and the file-backed store.
 *
 * What is worth testing here is the money and the doors: that Bitcoin only
 * enters a vault when staff confirm it, priced on the day it happened and
 * never before 2011; that every investment carries a term of 10 to 100 years
 * and a maturity date; that only matured Bitcoin can be sent, after a code
 * and a person; that cash and other assets left from before the vault become
 * Bitcoin; that one customer cannot see another's records; and that all of
 * it is written to the activity log.
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

    /* ---- 3. the dashboard's own call: who, open requests, alerts ---- */
    {
      const res = await customer.get('/api/bank/overview');
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.body.user.email, 'demo@hedgestonesfinance.com');
      assert.strictEqual(res.body.openRequests, 1, 'the seeded payment waits for staff');
      assert.strictEqual(res.body.requests[0].kind, 'cash_in');
      assert.ok(!('accounts' in res.body) && !('totals' in res.body) && !('transfers' in res.body), 'no cash, no withdrawals');
      ok(`overview: ${res.body.requests.length} request(s), ${res.body.alerts.length} alert(s)`);
    }

    /* ---- 4. the demo vault, investment by investment ---- */
    const markets_ = require(path.join(ROOT, 'src/bank/markets'));
    const invest_ = require(path.join(ROOT, 'src/bank/invest'));
    const db_ = require(path.join(ROOT, 'src/bank/db')).db;
    const cents = (dollars_) => Math.round(dollars_ * 100);
    const sats = (u) => BigInt(Math.round(Number(u) * 1e8));
    const unitsFor = (amount, pc) => (BigInt(amount) * 100000000n) / BigInt(pc);
    const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
    let demoId;
    {
      const res = await customer.get('/api/bank/invest');
      assert.strictEqual(res.status, 200, res.text);
      const { positions, bitcoin, holdings, terms, earliest } = res.body;
      assert.deepStrictEqual(terms, { min: 10, max: 100, default: 10 }, 'terms of 10 to 100 years');
      assert.strictEqual(earliest, '2011-01-01');
      assert.strictEqual(positions.length, 4, 'four seeded investments');
      assert.deepStrictEqual(positions.map((p) => p.kind), ['cash', 'bitcoin', 'cash', 'cash']);
      assert.ok(positions[0].matured && positions.slice(1).every((p) => !p.matured), 'the 2015 one has matured, the rest have not');
      assert.strictEqual(positions[0].purchasedAt.slice(0, 10), '2015-01-14');
      const then = (await markets_.priceAt('BTC', positions[0].purchasedAt)).quote.price;
      assert.strictEqual(positions[0].price, cents(then), 'priced at Bitcoin\'s close on that day');
      assert.strictEqual(sats(positions[0].units), unitsFor(150000, cents(then)), 'and the $1,500 bought what it would have then');
      positions.forEach((p) => {
        assert.ok(p.maturesAt > p.purchasedAt);
        assert.strictEqual(p.termMonths % 12, 0, 'whole years');
        assert.strictEqual(p.value, Math.floor(Number(p.units) * 1e8 * bitcoin.price / 1e8), 'valued at the live price');
      });
      const held = holdings.find((h) => h.symbol === 'BTC');
      assert.strictEqual(positions.reduce((n, p) => n + sats(p.units), 0n), sats(held.units), 'the investments add up to the vault');
      assert.strictEqual(bitcoin.ready, positions[0].units, 'what has matured is ready to send');
      assert.strictEqual(bitcoin.nextMaturity, positions.filter((p) => !p.matured).map((p) => p.maturesAt).sort()[0]);
      demoId = (await db_.users.findOne({ email: 'demo@hedgestonesfinance.com' })).id;
      ok(`vault: ${positions.length} investments, ${held.units} BTC, ${bitcoin.ready} BTC matured, next maturity ${bitcoin.nextMaturity.slice(0, 10)}`);
    }

    /* ---- 5. the banking doors are gone ---- */
    {
      for (const [method, url] of [
        ['get', '/api/bank/accounts'], ['get', '/api/bank/transactions'], ['get', '/api/bank/transfers'], ['post', '/api/bank/transfers'],
        ['get', '/api/bank/beneficiaries'], ['post', '/api/bank/invest/convert'], ['post', '/api/bank/invest/sell'],
        ['get', '/api/bank/cards'], ['get', '/api/bank/payees'], ['get', '/api/bank/deposits'], ['get', '/api/bank/disputes'],
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const gone = await customer[method](url, method === 'post' ? {} : undefined);
        assert.strictEqual(gone.status, 404, `${method.toUpperCase()} ${url} is gone`);
      }
      ok('no cash, no buying or selling, no withdrawals, cards or payees: those addresses are gone');
    }

    /* ---- 5a. prices: Bitcoin only, a history back to 2011, a price for any day ---- */
    {
      markets_._setFixture(null);
      const anon = client(base);
      const feed = await anon.get('/api/bank/markets');
      assert.deepStrictEqual(feed.body.assets.map((a) => a.symbol), ['BTC'], 'Bitcoin only');
      assert.match(feed.headers.get('cache-control') || '', /s-maxage/, 'the feed is cacheable at the edge');

      const hist = await anon.get('/api/bank/markets/history?symbol=BTC&days=200');
      assert.strictEqual(hist.status, 200, hist.text);
      assert.ok(hist.body.points.length > 150, 'a point a day');
      assert.ok(hist.body.points.every((p, i, all) => !i || p.t > all[i - 1].t), 'oldest first, one per day');
      assert.strictEqual(hist.body.points[hist.body.points.length - 1].p, 63250, 'ending on the current price');
      const long = await anon.get('/api/bank/markets/history?symbol=BTC&days=9000');
      assert.ok(long.body.points.length <= 1100, 'years of history go out thinned for a chart');
      assert.ok(long.body.points[0].t >= '2011-01-01' && long.body.points[0].t <= '2011-01-31', 'and reach back to 2011, no further');
      assert.strictEqual(long.body.points[long.body.points.length - 1].p, 63250, 'still ending today');

      const day = await markets_.priceAt('BTC', '2013-06-01T10:00:00Z');
      assert.ok(day.quote.price > 0 && /close on 2013-06-01/.test(day.quote.source), 'a past day is priced at its close');
      await assert.rejects(markets_.priceAt('BTC', '2010-12-31T12:00:00Z'), (e) => e.code === 'before_earliest');
      await assert.rejects(markets_.priceAt('BTC', new Date(Date.now() + 2 * 86400000)), (e) => e.code === 'future_date');
      assert.strictEqual((await markets_.priceAt('BTC', new Date())).quote.price, 63250, 'today is the live price');
      assert.strictEqual(invest_.addMonths('2026-01-31T10:00:00.000Z', 1), '2026-02-28T10:00:00.000Z', 'a month on from the 31st is the end of February');
      ok('prices: Bitcoin only, daily history back to 2011, and a price for any day since');
    }

    /* ---- 5b. receive: nothing until staff set the vault up, then cash or Bitcoin, confirmed by staff ---- */
    const admin = client(base);
    assert.strictEqual((await admin.post('/api/bank/auth/login', { email: 'admin@hedgestonesfinance.com', password: 'Hedgestone#Admin2026' })).body.user.role, 'admin');
    {
      const closed = await customer.get('/api/bank/vault');
      assert.strictEqual(closed.body.address, null, 'no vault address until staff set one');
      assert.strictEqual(closed.body.otc, null, 'no OTC partner either');
      const noCash = await customer.post('/api/bank/vault/receive', { kind: 'cash', amount: '100', occurredAt: '2020-01-01', termYears: 10 });
      assert.strictEqual(noCash.status, 409);
      assert.strictEqual(noCash.body.error, 'otc_unavailable');
      const noBtc = await customer.post('/api/bank/vault/receive', { kind: 'bitcoin', units: '0.1', occurredAt: '2020-01-01', termYears: 10 });
      assert.strictEqual(noBtc.body.error, 'no_vault_address');

      const badAddress = await admin.put('/api/bank/admin/settings', { vaultAddresses: 'not-an-address' });
      assert.strictEqual(badAddress.status, 400, 'only Bitcoin addresses');
      const set = await admin.put('/api/bank/admin/settings', {
        vaultAddresses: `${ADDRESS} Main vault`,
        otc: { name: 'Northgate OTC Desk', bankName: 'Example Trust', accountName: 'Northgate OTC LLC', accountNumber: '000123456789', routingNumber: '021000021', swift: 'EXAMUS33' },
      });
      assert.strictEqual(set.status, 200, set.text);

      const open = await customer.get('/api/bank/vault');
      assert.deepStrictEqual(open.body.address, { address: ADDRESS, label: 'Main vault' }, 'the vault address, with its label');
      assert.strictEqual(open.body.otc.accountNumber, '000123456789', 'and where to pay');
      assert.match(open.body.paymentReference, /^HG\d+$/, 'with the customer number to quote');

      const base_ = { kind: 'cash', amount: '1,250.00', occurredAt: '2016-03-01', termYears: 25 };
      for (const [patch, code] of [
        [{ termYears: 9 }, 'invalid_term'], [{ termYears: 101 }, 'invalid_term'], [{ termYears: 12.5 }, 'invalid_term'],
        [{ occurredAt: '2010-12-31' }, 'before_earliest'], [{ occurredAt: new Date(Date.now() + 3 * 86400000).toISOString() }, 'future_date'],
        [{ amount: '0.50' }, 'below_minimum'],
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const refused = await customer.post('/api/bank/vault/receive', { ...base_, ...patch });
        assert.strictEqual(refused.status, 400, `${JSON.stringify(patch)} is refused`);
        assert.strictEqual(refused.body.error, code);
      }
      const paid = await customer.post('/api/bank/vault/receive', base_);
      assert.strictEqual(paid.status, 201, paid.text);
      assert.strictEqual(paid.body.request.status, 'pending');
      assert.strictEqual(paid.body.request.amount, 125000);
      assert.strictEqual(paid.body.request.termYears, 25);
      assert.match(paid.body.request.reference, /^OTC-/);

      const badTx = await customer.post('/api/bank/vault/receive', { kind: 'bitcoin', units: '0.3', occurredAt: '2020-05-05', termYears: 10, txid: 'abc' });
      assert.strictEqual(badTx.body.error, 'invalid_txid');
      const sent = await customer.post('/api/bank/vault/receive', { kind: 'bitcoin', units: '0.3', occurredAt: '2020-05-05', termYears: 10 });
      assert.strictEqual(sent.status, 201, sent.text);
      assert.strictEqual(sent.body.request.address, ADDRESS);
      const cancelled = await customer.post(`/api/bank/vault/requests/${sent.body.request.id}/cancel`);
      assert.strictEqual(cancelled.body.request.status, 'cancelled', 'a customer can take a request back');

      const queue = await admin.get('/api/bank/admin/vault/requests');
      assert.ok(queue.body.requests.some((r) => r.id === paid.body.request.id && r.customer.email === 'demo@hedgestonesfinance.com'), 'staff see it, with who asked');
      assert.ok(!queue.body.requests.some((r) => r.id === sent.body.request.id), 'and not the cancelled one');

      // Staff check it against what arrived: $1,300, not $1,250.
      const before = await db_.holdings.findOne({ user_id: demoId, symbol: 'BTC' });
      const done = await admin.post(`/api/bank/admin/vault/requests/${paid.body.request.id}/confirm`, { amount: '1,300.00', note: 'Confirmed by the OTC partner' });
      assert.strictEqual(done.status, 200, done.text);
      const pc = cents((await markets_.priceAt('BTC', '2016-03-01')).quote.price);
      assert.strictEqual(done.body.trade.price, pc, 'booked at the close on the day it was paid');
      assert.strictEqual(sats(done.body.trade.units), unitsFor(130000, pc), 'the amount that arrived, at that price');
      assert.strictEqual(done.body.trade.createdAt.slice(0, 10), '2016-03-01', 'dated when it was paid');
      assert.strictEqual(done.body.trade.termMonths, 300);
      assert.strictEqual(done.body.trade.maturesAt.slice(0, 10), '2041-03-01', 'maturing 25 years on');
      assert.strictEqual(done.body.trade.reference, paid.body.request.reference, 'under the reference the customer was given');
      assert.strictEqual(done.body.request.status, 'completed');
      const after = await db_.holdings.findOne({ user_id: demoId, symbol: 'BTC' });
      assert.strictEqual(sats(after.units) - sats(before.units), unitsFor(130000, pc));
      assert.strictEqual(Number(after.cost_basis) - Number(before.cost_basis), 130000);
      const twice = await admin.post(`/api/bank/admin/vault/requests/${paid.body.request.id}/confirm`, {});
      assert.strictEqual(twice.status, 409, 'a request is confirmed once');

      // And the seeded one, as it came.
      const seeded = queue.body.requests.find((r) => r.note === 'Paid from my bank yesterday');
      assert.strictEqual((await admin.post(`/api/bank/admin/vault/requests/${seeded.id}/confirm`, {})).status, 200);
      const told = (await customer.get('/api/bank/alerts')).body.alerts.filter((a) => /added to your vault/.test(a.subject || ''));
      assert.ok(told.length >= 2, 'the customer is told each time');
      ok(`receive: closed until set up; refused before 2011, in the future, or outside 10 to 100 years; $1,300 paid on 2016-03-01 booked as ${done.body.trade.units} BTC at $${dollars(pc)}`);
    }

    /* ---- 5c. send: matured Bitcoin only, a PIN and a code, then a person ---- */
    {
      const v = await customer.get('/api/bank/vault');
      const ready = sats(v.body.ready);
      const firstLot = (await customer.get('/api/bank/invest')).body.positions[0];
      assert.strictEqual(ready, sats(firstLot.units), 'only the matured 2015 investment is ready');

      const tooMuch = await customer.post('/api/bank/vault/send', { units: (Number(ready + 1n) / 1e8).toFixed(8), address: ADDRESS, pin: '4417' });
      assert.strictEqual(tooMuch.status, 409);
      assert.strictEqual(tooMuch.body.error, 'not_matured', 'nothing beyond what has matured');
      assert.strictEqual((await customer.post('/api/bank/vault/send', { units: '0.5', address: 'bc1-not-real', pin: '4417' })).body.error, 'invalid_address');
      assert.strictEqual((await customer.post('/api/bank/vault/send', { units: '0.5', address: ADDRESS, pin: '0000' })).status, 403, 'the PIN is checked');

      const asked = await customer.post('/api/bank/vault/send', { units: '0.5', address: ADDRESS, pin: '4417' });
      assert.strictEqual(asked.status, 201, asked.text);
      assert.strictEqual(asked.body.next, 'verify');
      assert.ok(asked.body.otp.devCode, 'a code is emailed (and shown, with no mail provider)');
      assert.strictEqual(sats((await customer.get('/api/bank/vault')).body.ready), ready - 50000000n, 'what is asked for is not ready twice');
      const early = await admin.post(`/api/bank/admin/vault/requests/${asked.body.request.id}/confirm`, { txid: 'a'.repeat(64) });
      assert.strictEqual(early.status, 409, 'staff cannot send before the customer has confirmed');
      assert.strictEqual((await customer.post(`/api/bank/vault/requests/${asked.body.request.id}/verify`, { code: '000000' })).status, 400);
      const verified = await customer.post(`/api/bank/vault/requests/${asked.body.request.id}/verify`, { code: asked.body.otp.devCode });
      assert.strictEqual(verified.body.request.status, 'pending', 'then it waits for staff');

      const before = await customer.get('/api/bank/invest');
      const sentOut = await admin.post(`/api/bank/admin/vault/requests/${asked.body.request.id}/confirm`, { txid: 'b'.repeat(64) });
      assert.strictEqual(sentOut.status, 200, sentOut.text);
      assert.strictEqual(sentOut.body.trade.kind, 'sent');
      assert.strictEqual(sentOut.body.request.txid, 'b'.repeat(64), 'with the transaction staff made');
      const after = await customer.get('/api/bank/invest');
      assert.strictEqual(sats(before.body.bitcoin.units) - sats(after.body.bitcoin.units), 50000000n, '0.5 BTC left the vault');
      assert.strictEqual(sats(before.body.positions[0].units) - sats(after.body.positions[0].units), 50000000n, 'from the matured investment');
      before.body.positions.slice(1).forEach((p) => {
        const same = after.body.positions.find((q) => q.id === p.id);
        assert.strictEqual(same.units, p.units, 'the others untouched');
      });
      const costOut = before.body.positions[0].cost - after.body.positions[0].cost;
      assert.strictEqual(before.body.bitcoin.cost - after.body.bitcoin.cost, costOut, 'invested falls by what that part cost');

      const again = await customer.post('/api/bank/vault/send', { units: '0.1', address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', pin: '4417' });
      await customer.post(`/api/bank/vault/requests/${again.body.request.id}/verify`, { code: again.body.otp.devCode });
      assert.strictEqual((await admin.post(`/api/bank/admin/vault/requests/${again.body.request.id}/reject`, {})).status, 400, 'a rejection says why');
      const rejected = await admin.post(`/api/bank/admin/vault/requests/${again.body.request.id}/reject`, { reason: 'We could not confirm that address belongs to you.' });
      assert.strictEqual(rejected.body.request.status, 'rejected');
      assert.strictEqual((await customer.get('/api/bank/vault')).body.ready, after.body.bitcoin.ready, 'nothing left, and it is ready again');
      const why = (await customer.get('/api/bank/alerts')).body.alerts.find((a) => a.type === 'vault_request' && a.subject === `About your request ${again.body.request.reference}`);
      assert.ok(why, 'the customer is told why');

      const mara = client(base);
      const maraUser = await db_.users.findOne({ email: 'mara.velez@example.com' });
      const security_ = require(path.join(ROOT, 'src/bank/security'));
      await db_.users.update(maraUser.id, { password_hash: await security_.hashSecret('Mara#Test20261'), must_change_password: false, two_factor_enabled: false });
      assert.strictEqual((await mara.post('/api/bank/auth/login', { email: 'mara.velez@example.com', password: 'Mara#Test20261' })).status, 200);
      assert.strictEqual((await mara.post('/api/bank/vault/send', { units: '0.01', address: ADDRESS })).body.error, 'not_matured', 'an empty vault sends nothing');
      assert.strictEqual((await mara.post(`/api/bank/vault/requests/${again.body.request.id}/cancel`)).status, 404, 'nor touches anyone else\'s request');
      ok('send: matured only, PIN and code, staff send it with a transaction ID; it comes off the matured investment; a rejection gives it back with a reason');
    }

    /* ---- 5e. staff back-dating: priced on the day, never before 2011, repriced when moved ---- */
    {
      const holding = async () => db_.holdings.findOne({ user_id: demoId, symbol: 'BTC' });
      const readyNow = async () => sats((await customer.get('/api/bank/vault')).body.ready);
      for (const [body, code] of [
        [{ date: '2010-06-01' }, 'before_earliest'], [{ date: new Date(Date.now() + 86400000).toISOString() }, 'future_date'],
        [{ termYears: 5 }, 'invalid_term'],
      ]) {
        // eslint-disable-next-line no-await-in-loop
        const refused = await admin.post('/api/bank/admin/trades', { customerId: demoId, kind: 'cash', amount: '1000', date: '2013-04-01', termYears: 12, ...body });
        assert.strictEqual(refused.status, 400, JSON.stringify(body));
        assert.strictEqual(refused.body.error, code);
      }
      assert.strictEqual((await customer.post('/api/bank/admin/trades', { customerId: demoId, kind: 'cash', amount: '5' })).status, 403, 'customers cannot book');

      const readyBefore = await readyNow();
      const h0 = await holding();
      const booked = await admin.post('/api/bank/admin/trades', { customerId: demoId, kind: 'cash', amount: '1,000.00', date: '2013-04-01T12:00:00Z', termYears: 12, note: 'Paid by wire in 2013' });
      assert.strictEqual(booked.status, 201, booked.text);
      const p2013 = cents((await markets_.priceAt('BTC', '2013-04-01')).quote.price);
      assert.strictEqual(booked.body.trade.price, p2013, 'at the 2013 price, not today\'s');
      assert.strictEqual(sats(booked.body.trade.units), unitsFor(100000, p2013));
      assert.strictEqual(booked.body.trade.maturesAt.slice(0, 10), '2025-04-01');
      assert.strictEqual(await readyNow(), readyBefore + sats(booked.body.trade.units), 'it matured in 2025, so it is ready to send');
      const pos = (await customer.get('/api/bank/invest')).body.positions.find((p) => p.id === booked.body.trade.id);
      assert.strictEqual(pos.gain, pos.value - 100000, 'its growth is from the 2013 price to today\'s');

      const btc = await admin.post('/api/bank/admin/trades', { customerId: demoId, kind: 'bitcoin', units: '0.1', date: '2018-01-01T12:00:00Z', termYears: 10 });
      const p2018 = cents((await markets_.priceAt('BTC', '2018-01-01')).quote.price);
      assert.strictEqual(btc.body.trade.amount, Math.floor(0.1 * p2018), 'Bitcoin received is valued on the day it arrived');

      // Moved to 2017: what was paid stays, and buys what it would have then.
      const moved = await admin.patch(`/api/bank/admin/trades/${booked.body.trade.id}`, { date: '2017-01-01T12:00:00Z', note: 'Payment date confirmed' });
      assert.strictEqual(moved.status, 200, moved.text);
      const p2017 = cents((await markets_.priceAt('BTC', '2017-01-01')).quote.price);
      assert.strictEqual(moved.body.trade.price, p2017, 'repriced at the new day');
      assert.strictEqual(sats(moved.body.trade.units), unitsFor(100000, p2017));
      assert.strictEqual(moved.body.trade.amount, 100000, 'what was paid does not change');
      assert.strictEqual(moved.body.trade.maturesAt.slice(0, 10), '2029-01-01', 'the maturity moves with it');
      const h1 = await holding();
      assert.strictEqual(sats(h1.units) - sats(h0.units), unitsFor(100000, p2017) + sats('0.1'), 'the vault holds the repriced amount');
      assert.strictEqual(await readyNow(), readyBefore, 'and it has not matured any more');
      const reterm = await admin.patch(`/api/bank/admin/trades/${booked.body.trade.id}`, { termYears: 30 });
      assert.strictEqual(reterm.body.trade.maturesAt.slice(0, 10), '2047-01-01', 'the term can change on its own');
      assert.strictEqual((await admin.patch(`/api/bank/admin/trades/${booked.body.trade.id}`, { date: '2010-01-01' })).body.error, 'before_earliest');

      const reversed = await admin.post(`/api/bank/admin/trades/${btc.body.trade.id}/reverse`, { note: 'Booked twice' });
      assert.strictEqual(reversed.body.trade.status, 'reversed');
      assert.strictEqual(sats((await holding()).units), sats(h1.units) - sats('0.1'), 'the 0.1 BTC came off');
      assert.strictEqual((await admin.post(`/api/bank/admin/trades/${btc.body.trade.id}/reverse`, {})).status, 409, 'once');
      const audit = (await admin.get('/api/bank/admin/activity?limit=60')).body.activity.map((a) => a.action);
      ['admin.trade_reversed', 'admin.trade_retimed', 'vault.cash_received', 'vault.bitcoin_received'].forEach((a) => assert.ok(audit.includes(a), `${a} is in the activity log`));
      ok(`back-dating: $1,000 in 2013 at $${dollars(p2013)} matured in 2025; moved to 2017 it is repriced at $${dollars(p2017)} and matures in 2029; nothing before 2011`);
    }

    /* ---- 5f. what customers had before the vault becomes Bitcoin ---- */
    {
      const uuid = () => require('crypto').randomUUID();
      const stamp = new Date().toISOString();
      const accountsLib = require(path.join(ROOT, 'src/bank/accounts'));
      const ledger_ = require(path.join(ROOT, 'src/bank/ledger'));
      markets_._setFixture({ BTC: 66412.5 });

      // A cash balance from before the vault.
      const user = await db_.users.findById(demoId);
      const cash = await accountsLib.openAccount(user, { productId: 'investment_cash', openingBalance: 250000, createdBy: 'system' });
      await db_.holdings.insert({ id: uuid(), created_at: stamp, user_id: demoId, symbol: 'SPY', units: '2', cost_basis: 100000 });
      await db_.holdings.insert({ id: uuid(), created_at: stamp, user_id: demoId, symbol: 'AAPL', units: '1.5', cost_basis: 30000 });
      const btcBefore = await db_.holdings.findOne({ user_id: demoId, symbol: 'BTC' });
      const tradesBefore = (await db_.trades.find({ user_id: demoId })).length;

      const converted = await customer.get('/api/bank/invest');
      assert.strictEqual(converted.status, 200, converted.text);
      assert.ok(!/SPY|AAPL|Apple|S&P/.test(JSON.stringify(converted.body)), 'no other asset appears anywhere');
      assert.deepStrictEqual(converted.body.holdings.map((h) => h.symbol), ['BTC']);
      assert.strictEqual(converted.body.converting, false);
      const expected = unitsFor(2 * 57125, 6641250) + unitsFor(Math.floor(1.5 * 22750), 6641250) + unitsFor(250000, 6641250);
      const btcAfter = await db_.holdings.findOne({ user_id: demoId, symbol: 'BTC' });
      assert.strictEqual(sats(btcAfter.units) - sats(btcBefore.units), expected, 'the assets and the cash all bought Bitcoin at the live price');
      assert.strictEqual(Number(btcAfter.cost_basis) - Number(btcBefore.cost_basis), 130000 + 250000, 'what went in carries over');
      assert.strictEqual(ledger_.availableFor(await db_.accounts.findById(cash.id)), 0, 'the cash is spent');

      const conversions = (await db_.trades.find({ user_id: demoId })).filter((t) => /^CNV-/.test(t.reference || ''));
      assert.strictEqual(conversions.length, 5, 'a sale of each old holding, a purchase for each, and the cash');
      assert.ok(conversions.filter((t) => t.symbol === 'BTC').every((t) => t.side === 'buy' && Number(t.term_months) === 120), 'each on the default 10-year term');
      const alerts = (await customer.get('/api/bank/alerts')).body.alerts.map((a) => a.subject);
      assert.ok(alerts.includes('Your investments are now in Bitcoin') && alerts.includes('Your cash is now in Bitcoin'), 'the customer is told');
      await customer.get('/api/bank/invest');
      assert.strictEqual((await db_.trades.find({ user_id: demoId })).length, tradesBefore + 5, 'converting twice books nothing more');

      const cashTrade = conversions.find((t) => t.transaction_id);
      const plain = conversions.find((t) => t.symbol === 'BTC' && !t.transaction_id);
      assert.strictEqual((await admin.post(`/api/bank/admin/trades/${plain.id}/reverse`, {})).body.error, 'conversion_final', 'a conversion cannot be reversed');
      assert.strictEqual((await admin.post(`/api/bank/admin/trades/${cashTrade.id}/reverse`, {})).body.error, 'conversion_final');

      // Without a price for the old asset nothing converts and nothing shows.
      markets_._setFixture({ BTC: 66412.5, XAU: 0 });
      await db_.holdings.insert({ id: uuid(), created_at: stamp, user_id: demoId, symbol: 'XAU', units: '0.5', cost_basis: 120000 });
      const waiting = await customer.get('/api/bank/invest');
      assert.strictEqual(waiting.body.converting, true);
      assert.ok(!/XAU|Gold/.test(JSON.stringify(waiting.body)), 'without naming it');
      const desk = await admin.get('/api/bank/admin/investments');
      assert.strictEqual(desk.body.converting, 1, 'staff see one waiting');
      assert.ok(desk.body.holdings.every((h) => h.symbol === 'BTC') && desk.body.trades.every((t) => t.symbol === 'BTC'));
      markets_._setFixture({ BTC: 66412.5 });
      assert.strictEqual((await admin.get('/api/bank/admin/investments')).body.converting, 0, 'with a price, the staff screen converts it');
      markets_._setFixture(null);
      ok('conversion: other assets and cash become Bitcoin at the live price, invested carries over, final, and never shown');
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

    /* ---- 5g. each price provider is read the way it answers ---- */
    {
      const realFetch = global.fetch;
      const fixtureWas = process.env.MARKET_DATA_FIXTURE;
      delete process.env.MARKET_DATA_FIXTURE;
      const calls = [];
      let geckoDown = false;
      const respond = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
      const day = 86400;
      // A few days ago at midnight UTC, so every sample falls inside the window asked for.
      const T = Math.floor(Date.now() / 1000 / day) * day - 5 * day;
      global.fetch = async (url) => {
        const u = String(url);
        calls.push(new URL(u).host);
        if (u.includes('coingecko.com')) {
          if (geckoDown) return respond('rate limited', 429);
          if (u.includes('/market_chart')) return respond({ prices: [[T * 1000, 60000], [T * 1000 + 3600000, 60500], [T * 1000 + day * 1000, 61000]] });
          return respond({ bitcoin: { usd: 64000, usd_24h_change: 2.5, last_updated_at: T } });
        }
        if (u.includes('finance.yahoo.com')) {
          if (u.includes('range=') && !u.includes('range=1d')) {
            return respond({ chart: { result: [{ timestamp: [T, T + day, T + 2 * day], indicators: { quote: [{ close: [59000, null, 59500] }] } }] } });
          }
          return respond({ chart: { result: [{ meta: { regularMarketPrice: 63800, chartPreviousClose: 63000, regularMarketTime: T } }] } });
        }
        if (u.includes('coinbase.com')) {
          if (u.includes('/candles')) return respond([[T + day, 1, 2, 3, 62000, 9], [T, 1, 2, 3, 61500, 9]]);
          return respond({ data: { amount: '63900.00' } });
        }
        if (u.includes('blockchain.info')) return respond({ status: 'ok', values: [{ x: 1293840000, y: 0.3 }, { x: 1293840000 + day, y: 0.31 }, { x: 1293840000 + 2 * day, y: 0 }] });
        if (u.includes('cryptocompare.com')) return respond({ Response: 'Success', Data: { Data: [{ time: 1293840000, close: 0.3 }, { time: 1293840000 + day, close: 0.32 }] } });
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
        const bc = await markets_._history.historyFromBlockchain(markets_.BY_SYMBOL.get('BTC'), 6000);
        assert.deepStrictEqual(bc.map((p) => [p.t, p.p]), [['2011-01-01', 0.3], ['2011-01-02', 0.31]], 'Blockchain.com, with its zero days dropped');
        const cc = await markets_._history.historyFromCryptoCompare(markets_.BY_SYMBOL.get('BTC'), 6000);
        assert.deepStrictEqual(cc.map((p) => p.p), [0.3, 0.32], 'CryptoCompare daily closes');
        ok('prices: CoinGecko, Coinbase, Yahoo, Blockchain.com and CryptoCompare parsed; each takes over when the one before refuses');
      } finally {
        global.fetch = realFetch;
        if (fixtureWas) process.env.MARKET_DATA_FIXTURE = fixtureWas;
        markets_._setFixture(null);
      }
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

    /* ---- 11. the vault's history, and as a file ---- */
    {
      const all = await customer.get('/api/bank/vault/history');
      assert.strictEqual(all.status, 200, all.text);
      const kinds = new Set(all.body.movements.map((t) => t.kind));
      ['cash', 'bitcoin', 'sent', 'converted'].forEach((k) => assert.ok(kinds.has(k), `history shows ${k}`));
      assert.ok(all.body.movements.every((t) => t.symbol === 'BTC'), 'Bitcoin only');
      const out = await customer.get('/api/bank/vault/history?kind=out');
      assert.ok(out.body.movements.length && out.body.movements.every((t) => t.side !== 'buy'), 'filtered to what left');
      const ranged = await customer.get('/api/bank/vault/history?from=2015-01-01&to=2015-12-31');
      assert.ok(ranged.body.movements.length >= 1 && ranged.body.movements.every((t) => t.createdAt.startsWith('2015')), 'and by date');
      const csvRes = await customer.get('/api/bank/vault/history/export');
      assert.match(csvRes.headers.get('content-type'), /text\/csv/);
      assert.match(csvRes.text.split('\n')[0], /^Date,What,Bitcoin/);
      ok(`history: ${all.body.movements.length} movements, filterable, downloadable as CSV`);
    }

    /* ---- 12. another customer's vault is simply not there ---- */
    {
      const attempt = await customer.get('/api/bank/admin/customers');
      assert.strictEqual(attempt.status, 403, 'a customer is not staff');
      const other = await db_.users.findOne({ email: 'mara.velez@example.com' });
      const theirs = await db_.vaultRequests.insert({ id: require('crypto').randomUUID(), created_at: new Date().toISOString(), user_id: other.id, kind: 'cash_in', status: 'pending', amount: 5000, occurred_at: new Date().toISOString(), term_months: 120, reference: 'OTC-TEST1-TEST1' });
      assert.strictEqual((await customer.post(`/api/bank/vault/requests/${theirs.id}/cancel`)).status, 404, 'not 403: the id is not confirmed to exist');
      ok('isolation: another customer\'s request is a 404, the console is a 403');
    }

    /* ---- 13. the console registers a customer, with what they have already paid ---- */
    let newCustomerId;
    {
      const res = await admin.post('/api/bank/admin/customers', {
        email: 'newcustomer@example.com',
        firstName: 'Dana', lastName: 'Whitfield',
        dateOfBirth: '1991-06-08', ssn: '223456789',
        phone: '(614) 555-0133', addressLine1: '77 Quarry Lane', city: 'Columbus', state: 'OH', postalCode: '43201',
        employmentStatus: 'Employed', occupation: 'Nurse', annualIncome: '84000',
        firstAmount: '3,500.00', firstDate: '2015-06-01', firstTermYears: 12,
      });
      assert.strictEqual(res.status, 201, res.text);
      assert.ok(res.body.temporaryPassword, 'a temporary password is issued');
      assert.strictEqual(res.body.customer.ssnMasked.slice(-4), '6789', 'the SSN is stored masked');
      const p2015 = cents((await markets_.priceAt('BTC', '2015-06-01')).quote.price);
      assert.strictEqual(res.body.vault.price, p2015, 'what they paid is booked at that day\'s price');
      assert.strictEqual(sats(res.body.vault.units), unitsFor(350000, p2015));
      assert.strictEqual(res.body.vault.maturesAt.slice(0, 10), '2027-06-01');
      assert.strictEqual((await db_.accounts.find({ user_id: res.body.customer.id })).length, 0, 'no cash balance is opened');
      assert.strictEqual((await db_.cards.find({ user_id: res.body.customer.id })).length, 0, 'and no card');
      newCustomerId = res.body.customer.id;
      const list = await admin.get('/api/bank/admin/customers?q=whitfield');
      assert.strictEqual(list.body.customers[0].btcUnits, res.body.vault.units, 'the customer list shows their Bitcoin');
      ok(`console: registered ${res.body.customer.fullName} with ${res.body.vault.units} BTC from 2015 and no cash balance or card`);
    }

    /* ---- 16. the customer is told, in the app and by email ---- */
    {
      const res = await customer.get('/api/bank/alerts');
      const rejection = res.body.alerts.find((a) => a.type === 'vault_request' && /^About your request SND-/.test(a.subject));
      assert.ok(rejection, 'the rejected send raised an alert');
      assert.match(rejection.body, /could not confirm that address/i, 'the reason reaches the customer');
      assert.strictEqual(rejection.status, 'not_configured', 'without Resend it is stored, not sent');
      ok(`alerts: ${res.body.alerts.length} raised, the rejection carries the reason`);
    }

    /* ---- 17. everything is in the activity log, with a name against it ---- */
    {
      const res = await admin.get('/api/bank/admin/activity?limit=300');
      const actions = res.body.activity.map((a) => a.action);
      ['auth.login', 'vault.cash_in_requested', 'vault.btc_in_requested', 'vault.request_cancelled', 'vault.cash_received', 'vault.send_requested',
        'vault.sent', 'vault.request_rejected', 'admin.customer_created', 'invest.converted', 'invest.cash_converted', 'document.uploaded'].forEach((action) => {
        assert.ok(actions.includes(action), `the log records ${action}`);
      });
      const sent = res.body.activity.find((a) => a.action === 'vault.sent');
      assert.strictEqual(sent.actorEmail, 'admin@hedgestonesfinance.com', 'the log names who sent it');
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

    /* ---- 18b. the console's setup checklist and investments views ---- */
    {
      const setupRes = await admin.get('/api/bank/admin/setup');
      assert.strictEqual(setupRes.status, 200, setupRes.text);
      const ids = setupRes.body.items.map((i) => i.id);
      ['supabase', '0003_bank.sql', '0005_bank_invest.sql', '0007_invest_term.sql', '0008_vault.sql', 'encryption', 'resend', 'prices', 'history'].forEach((id) => assert.ok(ids.includes(id), `checks ${id}`));
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
        fees: { vaultSend: 1500 },
      });
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.body.settings.fees.vaultSend, 1500);
      assert.strictEqual(res.body.settings.fees.wireDomestic, 2500, 'the other stored fees are left alone');
      assert.strictEqual((await customer.get('/api/bank/vault')).body.sendFee, 1500, 'the customer sees the fee to send');
      assert.strictEqual((await admin.put('/api/bank/admin/settings', { fees: { vaultSend: -1 } })).status, 400);
      const config = await client(base).get('/api/bank/config');
      assert.match(config.body.announcement, /maintenance/i);
      ok('settings: the fee to send reaches the Send page and the banner reaches the public page');
    }

    /* ---- 19a. the default term is set at the console, within 10 to 100 years ---- */
    {
      for (const years of [9, 101, 12.5, 'ten']) {
        // eslint-disable-next-line no-await-in-loop
        assert.strictEqual((await admin.put('/api/bank/admin/settings', { investmentTermYears: years })).status, 400, `${years} is refused`);
      }
      const res = await admin.put('/api/bank/admin/settings', { investmentTermYears: 25 });
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual((await customer.get('/api/bank/invest')).body.terms.default, 25);
      assert.strictEqual((await customer.get('/api/bank/vault')).body.terms.default, 25);
      await admin.put('/api/bank/admin/settings', { investmentTermYears: 10 });
      ok('settings: the default term is a whole number of years from 10 to 100');
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

    /* ---- 22. a vault alert goes out by text as well as email ---- */
    {
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
      let booked;
      try {
        booked = await admin.post('/api/bank/admin/trades', { customerId: demoId, kind: 'cash', amount: '250.00', termYears: 10 });
      } finally {
        pingram.close();
        delete process.env.PINGRAM_API_KEY;
        delete process.env.PINGRAM_SMS_URL;
      }
      assert.strictEqual(booked.status, 201, booked.text);
      assert.strictEqual(texts.length, 1, 'the alert goes out as a text');
      assert.strictEqual(texts[0].auth, 'Bearer pingram_sk_test');
      assert.match(texts[0].to.number, /^\+1\d{10}$/, 'the number is normalised to E.164');
      assert.match(texts[0].sms.message, /BTC/);
      ok(`a vault alert is texted too: "${texts[0].sms.message.slice(0, 64)}..."`);
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

    /* ---- 24. Bitcoin still books into a vault on a database missing 0007 ---- */
    {
      // term_months and matures_at arrived with 0007. PostgREST refuses a row
      // that names a column it does not have, so the trade is written without
      // them and its maturity is worked out from the default term.
      const users_ = require(ROOT + '/src/bank/users');
      const who = await users_.findByEmail('demo@hedgestonesfinance.com');
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
        result = await invest_.addToVault(who, { kind: 'cash', amount: 1000, termYears: 40 }, null, { silent: true });
      } finally {
        db_.trades.insert = real;
      }
      assert.ok(refusals > 0, 'the stand-in refused the columns the way PostgREST does');
      const stored = await db_.trades.findById(result.trade.id);
      assert.ok(stored && !('matures_at' in stored), 'the investment is on record without them');
      assert.strictEqual(result.trade.termMonths, 120, 'read back on the default term');
      assert.strictEqual(result.trade.maturesAt, invest_.addMonths(stored.created_at, 120));
      ok('a database without 0007 still books into the vault, on the default term');
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
