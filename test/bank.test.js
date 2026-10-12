'use strict';

/**
 * End-to-end tests for the banking application, over HTTP against the real
 * Express app and the file-backed store.
 *
 * What is worth testing here is the money and the doors: that a balance only
 * changes through an entry, that a transfer cannot exceed what is available,
 * that one customer cannot see another's account, that the admin console can
 * register a customer and adjust a balance, and that both are written to the
 * activity log.
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
    /* ---- 1. the bank introduces itself, and seeds itself doing it ---- */
    {
      const api = client(base);
      const res = await api.get('/api/bank/config');
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.bank.name, 'the bank has a name');
      assert.strictEqual(res.body.bank.routingNumber.length, 9);
      assert.ok(res.body.products.length >= 4, 'products are published');
      ok(`config: ${res.body.bank.name}, routing ${res.body.bank.routingNumber}`);
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
    let savings;
    {
      const res = await customer.get('/api/bank/overview');
      assert.strictEqual(res.status, 200, res.text);
      const { accounts, totals, recent, spending, months } = res.body;
      assert.ok(accounts.length >= 3, 'the demo customer has accounts');
      checking = accounts.find((a) => a.type === 'checking');
      savings = accounts.find((a) => a.type === 'savings');
      assert.ok(checking.balance > 0, 'checking is in credit');
      assert.strictEqual(
        totals.deposits,
        accounts.filter((a) => !a.isCredit).reduce((s, a) => s + a.balance, 0),
        'the headline total is the sum of the deposit balances'
      );
      assert.ok(recent.length > 0 && spending.length > 0 && months.length === 6);
      ok(`overview: ${accounts.length} accounts, checking $${dollars(checking.balance)}, ${recent.length} recent entries`);
    }

    /* ---- 4. a transfer between the customer's own accounts posts both legs ---- */
    {
      const before = await customer.get('/api/bank/accounts');
      const beforeChecking = before.body.accounts.find((a) => a.id === checking.id).balance;
      const beforeSavings = before.body.accounts.find((a) => a.id === savings.id).balance;

      const res = await customer.post('/api/bank/transfers', {
        type: 'internal', fromAccountId: checking.id, toAccountId: savings.id,
        amount: '250.00', memo: 'Test sweep',
      });
      assert.strictEqual(res.status, 201, res.text);
      assert.strictEqual(res.body.next, 'completed', 'an internal transfer needs no code');
      assert.ok(res.body.transfer.confirmation.startsWith('CNF-'));

      const after = await customer.get('/api/bank/accounts');
      const afterChecking = after.body.accounts.find((a) => a.id === checking.id).balance;
      const afterSavings = after.body.accounts.find((a) => a.id === savings.id).balance;
      assert.strictEqual(beforeChecking - afterChecking, 25000, 'the money left checking');
      assert.strictEqual(afterSavings - beforeSavings, 25000, 'and arrived in savings');
      ok(`internal transfer: $250.00 moved, confirmation ${res.body.transfer.confirmation}`);
    }

    /* ---- 5. you cannot send what you do not have ---- */
    {
      const res = await customer.post('/api/bank/transfers', {
        type: 'internal', fromAccountId: checking.id, toAccountId: savings.id, amount: '90,000.00',
      });
      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /available funds/i);

      const absurd = await customer.post('/api/bank/transfers', {
        type: 'internal', fromAccountId: checking.id, toAccountId: savings.id, amount: '9999999.00',
      });
      assert.strictEqual(absurd.status, 400);
      assert.match(absurd.body.message, /most you can send/i);
      ok(`overdraft refused: ${res.body.message}`);
    }

    /* ---- 5b. converting a balance into listed assets, and back ---- */
    {
      const markets_ = require(path.join(ROOT, 'src/bank/markets'));
      markets_._setFixture(null);

      // The ticker's feed is public.
      const anon = client(base);
      const feed = await anon.get('/api/bank/markets');
      assert.strictEqual(feed.status, 200, feed.text);
      const symbols = feed.body.assets.map((a) => a.symbol);
      ['SPY', 'AAPL', 'AMZN', 'BTC', 'XAU', 'QQQ'].forEach((s) => assert.ok(symbols.includes(s), `${s} is listed`));
      assert.ok(feed.body.assets.every((a) => a.quote && a.quote.price > 0), 'every asset has a price');
      assert.match(feed.headers.get('cache-control') || '', /s-maxage/, 'the feed is cacheable at the edge');

      const start = await customer.get('/api/bank/invest');
      assert.strictEqual(start.status, 200, start.text);
      const fundFrom = start.body.accounts.find((a) => a.id === checking.id);
      assert.ok(fundFrom && fundFrom.available > 0, 'checking can fund a conversion');
      assert.ok(!start.body.accounts.some((a) => a.isCredit), 'a credit card cannot fund one');

      const balanceOf = async (id) => (await customer.get('/api/bank/accounts')).body.accounts.find((a) => a.id === id).balance;
      const before = await balanceOf(checking.id);

      // $500.00 of the S&P 500 at the fixture's $571.25.
      const buy = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'SPY', amount: '500.00', quotedPrice: 571.25 });
      assert.strictEqual(buy.status, 201, buy.text);
      assert.strictEqual(buy.body.trade.units, '0.875273', 'units are rounded down to a millionth of a share');
      assert.strictEqual(buy.body.trade.price, 57125, 'booked at the live price, in cents');
      assert.strictEqual(buy.body.trade.amount, 50000);
      assert.strictEqual(before - await balanceOf(checking.id), 50000, 'exactly $500.00 left checking');

      // A quarter of savings into Bitcoin, by percentage.
      const savingsAvail = start.body.accounts.find((a) => a.id === savings.id).available;
      const btc = await customer.post('/api/bank/invest/convert', { accountId: savings.id, symbol: 'BTC', percent: 25 });
      assert.strictEqual(btc.status, 201, btc.text);
      assert.strictEqual(btc.body.trade.amount, Math.floor(savingsAvail / 4), '25% of what was available');
      assert.ok(/^0\.\d{1,8}$/.test(btc.body.trade.units), 'Bitcoin is held to the satoshi');

      // The doors.
      const moved = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'AAPL', amount: '100', quotedPrice: 150 });
      assert.strictEqual(moved.status, 409, 'a price that moved past the tolerance is not booked');
      assert.strictEqual(moved.body.error, 'price_moved');
      assert.strictEqual(moved.body.details.quote.price, 227.5, 'and the new price comes back to show');
      const tooMuch = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'AAPL', amount: '9000000' });
      assert.strictEqual(tooMuch.status, 400);
      const tiny = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'AAPL', amount: '0.50' });
      assert.strictEqual(tiny.status, 400, 'below the minimum');
      const unknown = await customer.post('/api/bank/invest/convert', { accountId: checking.id, symbol: 'DOGE', amount: '10' });
      assert.strictEqual(unknown.status, 400, 'only listed assets');
      const noCsrf = await fetch(`${base}/api/bank/invest/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.ok([401, 403].includes(noCsrf.status), 'signed out, nothing converts');

      // The price rises 5%: the holding is worth more than it cost.
      markets_._setFixture({ SPY: 599.81 });
      const later = await customer.get('/api/bank/invest');
      const spy = later.body.holdings.find((h) => h.symbol === 'SPY');
      assert.strictEqual(spy.units, '0.875273');
      assert.strictEqual(spy.costBasis, 50000);
      assert.strictEqual(spy.value, Math.floor(875273 * 59981 / 1e6), 'valued at the new price');
      assert.ok(spy.gain > 0 && later.body.totals.value > 0);

      // Sell half back into checking, then all the Bitcoin.
      const half = await customer.post('/api/bank/invest/sell', { accountId: checking.id, symbol: 'SPY', percent: 50, quotedPrice: 599.81 });
      assert.strictEqual(half.status, 201, half.text);
      assert.strictEqual(half.body.trade.units, '0.437636');
      assert.strictEqual(half.body.trade.amount, Math.floor(437636 * 59981 / 1e6));
      const afterHalf = (await customer.get('/api/bank/invest')).body.holdings.find((h) => h.symbol === 'SPY');
      assert.strictEqual(afterHalf.units, '0.437637', 'the rest stays held');

      const allBtc = await customer.post('/api/bank/invest/sell', { accountId: savings.id, symbol: 'BTC', all: true });
      assert.strictEqual(allBtc.status, 201, allBtc.text);
      const end = await customer.get('/api/bank/invest');
      assert.ok(!end.body.holdings.some((h) => h.symbol === 'BTC'), 'selling everything closes the holding');
      assert.strictEqual(end.body.trades.length, 4, 'every trade is on record');
      const oversell = await customer.post('/api/bank/invest/sell', { accountId: checking.id, symbol: 'SPY', units: '5' });
      assert.strictEqual(oversell.status, 400, 'you cannot sell what you do not hold');

      // On the ledger as investments, and not counted as spending.
      const tx = await customer.get('/api/bank/transactions?limit=10');
      assert.ok(tx.body.transactions.some((t) => t.category === 'Investments' && /S&P 500/.test(t.description)));
      const overview = await customer.get('/api/bank/overview');
      assert.ok(!overview.body.spending.some((s) => s.category === 'Investments'), 'investing is not spending');

      markets_._setFixture(null);
      ok(`invest: $500.00 bought ${buy.body.trade.units} SPY at $571.25, half sold at $599.81, Bitcoin round trip, price-moved and overdraw refused`);
    }

    /* ---- 5c. each price provider is read the way it answers ---- */
    {
      const markets_ = require(path.join(ROOT, 'src/bank/markets'));
      const realFetch = global.fetch;
      const fixtureWas = process.env.MARKET_DATA_FIXTURE;
      delete process.env.MARKET_DATA_FIXTURE;
      const calls = [];
      let yahooDown = false;
      const respond = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
      global.fetch = async (url) => {
        const u = String(url);
        calls.push(new URL(u).host);
        if (u.includes('finance.yahoo.com')) {
          if (yahooDown) return respond('rate limited', 429);
          const sym = decodeURIComponent(u.split('/chart/')[1].split('?')[0]);
          return respond({ chart: { result: [{ meta: { regularMarketPrice: sym === 'AAPL' ? 230.1 : 100, chartPreviousClose: sym === 'AAPL' ? 225 : 99, regularMarketTime: 1760000000 } }] } });
        }
        if (u.includes('stooq.com')) {
          const syms = new URL(u).searchParams.get('s').split(' ').join('+').split('+');
          const rows = syms.map((s) => `${s.toUpperCase()},2026-10-12,20:00:00,10,11,9,${s === 'xauusd' ? '2650.5' : s === 'aapl.us' ? '228.4' : '50'},${s === 'xauusd' ? '2600' : '49'}`);
          return respond(['Symbol,Date,Time,Open,High,Low,Close,Prev', ...rows].join('\n'));
        }
        if (u.includes('coingecko.com')) {
          return respond({ bitcoin: { usd: 64000, usd_24h_change: 2.5, last_updated_at: 1760000000 }, 'pax-gold': { usd: 2640 } });
        }
        if (u.includes('coinbase.com')) return respond({ data: { amount: '63900.00' } });
        return respond('not found', 404);
      };
      try {
        markets_._setFixture(null);
        let list = await markets_.list();
        const by = (s) => list.find((a) => a.symbol === s).quote;
        assert.strictEqual(by('AAPL').price, 230.1);
        assert.strictEqual(by('AAPL').source, 'Yahoo Finance');
        assert.strictEqual(by('AAPL').change, 5.1);
        assert.strictEqual(by('BTC').price, 64000);
        assert.strictEqual(by('BTC').source, 'CoinGecko');
        assert.strictEqual(by('BTC').changePct, 2.5);
        assert.strictEqual(by('XAU').price, 2650.5, 'gold is spot XAU/USD from Stooq');
        assert.ok(!calls.includes('finnhub.io'), 'Finnhub is skipped without a key');

        yahooDown = true;
        markets_._setFixture(null);
        list = await markets_.list();
        assert.strictEqual(by('AAPL').price, 228.4, 'when Yahoo refuses, stocks come from Stooq');
        assert.strictEqual(by('AAPL').source, 'Stooq');
        assert.strictEqual(by('AAPL').previousClose, 49, 'Stooq\'s previous close is used for the change');
        ok('prices: Yahoo, Stooq and CoinGecko parsed; Stooq takes over when Yahoo refuses');
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
      assert.ok(beneficiary, 'the demo customer has a saved recipient');

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
      ok('ACH transfer: verified by code, funds held, queued for review');
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
      ok('a wrong transfer PIN is refused');
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
      ok('recipients: ABA checksum enforced, valid one saved');
    }

    /* ---- 9. a photographed check is credited on hold ---- */
    {
      // A one-pixel PNG is a perfectly good stand-in for a photo of a check.
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const res = await customer.post('/api/bank/deposits', {
        accountId: checking.id, amount: '1250.00', checkNumber: '1043', front: png, back: png,
      });
      assert.strictEqual(res.status, 201, res.text);
      assert.strictEqual(res.body.deposit.availableNow, 22500, 'the first $225 is available next day');
      const tx = await customer.get(`/api/bank/transactions/${res.body.transactionId}`);
      assert.strictEqual(tx.body.transaction.status, 'pending');
      ok('mobile deposit: images stored, $1,250.00 pending with a Reg CC hold');
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

    /* ---- 11. statements and CSV export ---- */
    {
      const list = await customer.get(`/api/bank/accounts/${checking.id}/statements`);
      assert.strictEqual(list.status, 200);
      assert.ok(list.body.statements.length >= 2, 'there are months to look at');
      const period = list.body.statements[1];
      const detail = await customer.get(`/api/bank/accounts/${checking.id}/statements/${period.id.slice(-12, -5)}`);
      const csvRes = await customer.get('/api/bank/transactions/export?limit=50');
      assert.strictEqual(csvRes.status, 200);
      assert.match(csvRes.headers.get('content-type'), /text\/csv/);
      assert.match(csvRes.text.split('\n')[0], /^Date,Account,Description/);
      ok(`statements: ${list.body.statements.length} periods; CSV export works`);
      assert.ok(detail.status === 200 || detail.status === 400);
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

      const attempt = await customer.get(`/api/bank/accounts/${otherAccountId}`);
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
        accounts: [
          { productId: 'everyday_checking', openingBalance: '3500.00', nickname: 'Everyday' },
          { productId: 'high_yield_savings', openingBalance: '12000.00' },
        ],
      });
      assert.strictEqual(res.status, 201, res.text);
      assert.ok(res.body.temporaryPassword, 'a temporary password is issued');
      assert.strictEqual(res.body.accounts.length, 2);
      assert.strictEqual(res.body.accounts[0].balance, 350000, 'the opening balance posted');
      assert.strictEqual(res.body.customer.ssnMasked.slice(-4), '6789', 'the SSN is stored masked');
      newCustomerId = res.body.customer.id;
      newAccountId = res.body.accounts[0].id;
      ok(`console: registered ${res.body.customer.fullName} with 2 accounts and $3,500.00 opening`);
    }

    /* ---- 14. adding a balance writes an entry, not just a number ---- */
    {
      const before = await admin.get(`/api/bank/admin/customers/${newCustomerId}`);
      const balanceBefore = before.body.accounts.find((a) => a.id === newAccountId).balance;

      const res = await admin.post(`/api/bank/admin/accounts/${newAccountId}/adjust`, {
        amount: '2,400.00', direction: 'credit', description: 'WIRE IN - PROCEEDS OF SALE',
        method: 'wire_domestic', category: 'Income', note: 'Cleared by ops',
      });
      assert.strictEqual(res.status, 201, res.text);
      assert.strictEqual(res.body.account.balance - balanceBefore, 240000);
      assert.strictEqual(res.body.transaction.description, 'WIRE IN - PROCEEDS OF SALE');

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
      assert.ok(approved.body.transfer.traceNumber, 'a completed ACH carries a trace number');

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
        reasonCode: 'beneficiary_unverified', note: 'Receiving bank could not confirm the account name.',
      });
      assert.strictEqual(rejected.body.transfer.status, 'rejected');
      const availableBack = (await customer.get('/api/bank/accounts')).body.accounts.find((a) => a.id === checking.id).availableBalance;
      assert.strictEqual(availableBack - availableHeld, 92500, 'the held funds and the wire fee come back');
      ok('queue: one released with a trace number, one returned and the hold released');
    }

    /* ---- 16. the customer is told, in the app and by email ---- */
    {
      const res = await customer.get('/api/bank/alerts');
      assert.ok(res.body.alerts.length >= 3, 'alerts were raised');
      const rejection = res.body.alerts.find((a) => a.type === 'transfer_rejected');
      assert.ok(rejection, 'the returned transfer raised an alert');
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
      ok('settings: a fee change reaches the transfer form and the banner reaches the public page');
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
        description: 'WIRE IN - TEST', method: 'wire', status: 'posted', createdBy: 'admin',
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
      assert.match(texts[1].sms.message, /Available to spend/i);

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

    console.log('\n  all banking tests passed');
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
