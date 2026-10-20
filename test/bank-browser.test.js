'use strict';

/**
 * The Bitcoin vault driven through a real browser.
 *
 * test/bank.test.js proves the API. This proves the part people actually
 * touch: that the dashboard renders the vault and charts it, that a payment
 * told to us on Receive and a send asked for on Send reach the staff console,
 * that staff confirm both there, that the console registers a customer with
 * what they have already paid and adds to a vault by date, and that none of
 * it logs an error on the way.
 *
 * Skips itself, rather than failing, when playwright-core or a browser binary
 * is not present.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let chromium;
try {
  ({ chromium } = require('playwright-core'));
} catch (err) {
  console.log('  skip  playwright-core is not installed (npm i -D playwright-core)');
  process.exit(0);
}

/** The browser Playwright's own download would have placed, or the one here. */
function browserPath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch (err) { return false; }
  });
}

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hedgestone-ui-'));
process.env.DATA_DIR = DATA_DIR;
process.env.BANK_ENCRYPTION_KEY = 'test-key-not-for-production';
process.env.BANK_COOKIE_INSECURE = '1';
process.env.BANK_RATE_LIMIT_MAX = '5000';
process.env.BANK_LOGIN_RATE_LIMIT = '500';
process.env.CHAT_NOTIFY = 'off';
// Fixed prices and a fixed price history, so the seeded vault, the chart and
// everything added here are priced without the network.
process.env.MARKET_DATA_FIXTURE = '1';
delete process.env.RESEND_API_KEY;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Fonts come from Google's CDN, which a sandbox often cannot reach. */
const IGNORE = /fonts\.googleapis|fonts\.gstatic|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_FAILED/;

(async () => {
  const executablePath = browserPath();
  if (!executablePath) {
    console.log('  skip  no Chromium binary found (set CHROME_PATH)');
    process.exit(0);
  }

  const app = require(path.join(ROOT, 'src', 'app'));
  const server = await new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ok = (label) => console.log(`  ok  ${label}`);

  const browser = await chromium.launch({ executablePath });
  const problems = [];
  let failed = false;

  /**
   * Web fonts are fetched from a CDN that a sandbox often cannot reach, and
   * every `networkidle` navigation would then wait for that request to time
   * out. Refusing them up front keeps the suite quick and its failures real.
   */
  async function blockFonts(context) {
    await context.route('**://fonts.googleapis.com/**', (route) => route.abort());
    await context.route('**://fonts.gstatic.com/**', (route) => route.abort());
  }

  /** A page that reports anything the browser complains about. */
  async function newPage(context, tag) {
    await blockFonts(context);
    const page = await context.newPage();
    page.on('pageerror', (e) => problems.push(`[${tag}] page error at ${page.url()}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push(`[${tag}] console at ${page.url()}: ${m.text()}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !IGNORE.test(r.url())) problems.push(`[${tag}] HTTP ${r.status()} ${r.url()}`);
    });
    return page;
  }

  const money = (text) => Number(String(text).replace(/[^0-9.]/g, ''));

  try {
    /* ---- 1. the public site stands up ---- */
    {
      const context = await browser.newContext();
      const page = await newPage(context, 'public');
      for (const route of ['/', '/bitcoin', '/rates', '/security-center', '/support', '/contact', '/careers', '/legal', '/open-account', '/apply']) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        const heading = await page.textContent('h1');
        assert.ok(heading && heading.trim().length, `${route} has a heading`);
      }
      // Old addresses land somewhere useful; the dashboard page is now the home page.
      for (const route of ['/personal', '/business', '/services', '/projects']) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        assert.ok(page.url().endsWith('/bitcoin'), `${route} now goes to /bitcoin`);
      }
      await page.goto(`${base}/digital`, { waitUntil: 'domcontentloaded' });
      assert.strictEqual(new URL(page.url()).pathname, '/', '/digital is the home page now');
      // The home page leads with the vault, in plain words.
      assert.match(await page.textContent('h1'), /Secure your Bitcoin/);
      assert.match(await page.textContent('.hs-home mark.hs-hl'), /vault/);
      const words = await page.evaluate(() => document.body.innerText);
      assert.ok(!/Bitcoin only|\baccounts?\b|withdraw|cash balance|checking|savings/i.test(words), 'no banking words on the home page');
      await page.goto(`${base}/bitcoin`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /\$/.test((document.querySelector('[data-btc-price]') || {}).textContent || ''), null, { timeout: 15000 });
      assert.match(await page.textContent('[data-btc-price]'), /^\$63,250\.00$/, 'the live price is shown');
      ok('the public pages render, each with a heading; old addresses redirect; the home page leads with the vault');

      /* the enquiry form reaches the desk's store */
      await page.goto(`${base}/contact`, { waitUntil: 'domcontentloaded' });
      await page.fill('#contact-form-name', 'Dana Whitfield');
      await page.fill('#contact-form-email', 'dana@example.com');
      await page.fill('#contact-form-message', 'I would like to open a vault. What do I need?');
      await page.click('#contact-form [data-submit]');
      await page.waitForFunction(
        () => /thank|sent|received|got/i.test(document.querySelector('#contact-form [data-form-status]').textContent),
        null,
        { timeout: 15000 }
      );
      ok('the enquiry form submits and confirms');

      /* careers -> apply carries the role over */
      await page.goto(`${base}/careers`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#roles .role .apply', { timeout: 15000 });
      const href = await page.getAttribute('#roles .role .apply', 'href');
      assert.match(href, /^\/apply\?role=/, 'the apply link carries the role');
      await Promise.all([page.waitForURL(/\/apply\?role=/), page.click('#roles .role .apply')]);
      await page.waitForFunction(() => {
        const select = document.getElementById('apply-role');
        return select && select.options.length > 1 && select.value !== '';
      }, null, { timeout: 15000 });
      ok('the careers list links into the application form with the role selected');
      await context.close();
    }

    /* ---- 2. a customer signs in and sees their vault ---- */
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await newPage(context, 'customer');
    {
      await page.goto(`${base}/signin`, { waitUntil: 'domcontentloaded' });
      await page.click('[data-fill="customer"]');
      await page.click('#rf-signin-form [data-submit]');
      await page.waitForSelector('#rf-verify-form:not(.rf-hide)', { timeout: 20000 });

      const shown = await page.textContent('[data-dev-code]');
      const code = (shown.match(/\d{6}/) || [])[0];
      assert.ok(code, 'the one-time code is offered when email is not configured');
      for (const [index, digit] of code.split('').entries()) {
        await page.fill(`.rf-otp input >> nth=${index}`, digit);
      }
      await page.waitForURL('**/dashboard', { timeout: 20000 });
      ok('sign-in: password, then the emailed code');

      // The headline is the vault, and it is the sum of its investments.
      await page.waitForFunction(() => /\$/.test((document.querySelector('[data-hero="value"]') || {}).textContent || ''), null, { timeout: 20000 });
      await page.waitForSelector('[data-timeline] .hs-tl', { timeout: 20000 });
      const hero = money(await page.textContent('[data-hero="value"]'));
      const values = await page.$$eval('[data-timeline] .hs-tl .hs-tl-value strong', (n) => n.map((el) => el.textContent));
      const sum = values.reduce((n, v) => n + money(v), 0);
      assert.strictEqual(values.length, 4, 'the four seeded investments are listed');
      assert.ok(Math.abs(hero - sum) < 0.02, `the headline is the sum of the investments (${hero} vs ${sum})`);
      const lines = await page.$$eval('[data-timeline] .hs-tl', (n) => n.map((li) => li.textContent.replace(/\s+/g, ' ')));
      assert.ok(lines.every((t) => /Invested/.test(t) && /Matur/.test(t)), 'each shows the day it went in and the day it matures');
      assert.ok(/Jan 14, 2015/.test(lines[0]) && /Matured/.test(lines[0]), 'the 2015 investment has matured');
      assert.ok(await page.$$eval('[data-timeline] .hs-tl .hs-logo', (n) => n.length) >= 4, 'with the Bitcoin mark on each');
      assert.match(await page.textContent('[data-stat="ready"]'), /^2\.74619651 BTC$/, 'what has matured is ready to send');
      // The chart, inside the vault card: drawn, each investment marked, with a table view.
      await page.waitForSelector('.hs-vault [data-growth-chart] svg path.value', { timeout: 20000 });
      assert.strictEqual(await page.$$eval('[data-growth-chart] circle.buy', (n) => n.length), 4, 'every investment is marked on the line');
      assert.ok(await page.$$eval('[data-chart-rows] tr', (n) => n.length) > 10, 'the chart has a table view');
      const box = await page.$eval('[data-growth-chart] .hit', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      await page.mouse.move(box.x + box.w * 0.6, box.y + box.h / 2);
      await page.waitForSelector('.hs-tip:not([hidden])', { timeout: 5000 });
      assert.match(await page.textContent('.hs-tip'), /Value[\s\S]*Invested[\s\S]*Growth/, 'hovering reads out every series');
      ok(`dashboard: $${hero.toFixed(2)} across ${values.length} investments with their dates, charted inside the vault card`);
    }

    // Staff set up where Bitcoin and cash come in, as they would under Settings.
    await require(path.join(ROOT, 'src/bank/settings')).save({
      vaultAddresses: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4 Main vault',
      otc: { name: 'Northgate OTC Desk', bankName: 'Example Trust', accountName: 'Northgate OTC LLC', accountNumber: '000123456789', routingNumber: '021000021', swift: 'EXAMUS33', instructions: '' },
    });

    /* ---- 3. Receive: tell us about a cash payment ---- */
    {
      await page.goto(`${base}/receive`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#hs-cash-form:not([hidden])', { timeout: 20000 });
      assert.match(await page.textContent('[data-otc]'), /000123456789[\s\S]*HG\d+/, 'where to pay, and the reference to quote');
      assert.match(await page.textContent('[data-address]'), /bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4/, 'and the vault address');
      await page.fill('#c-amount', '750.00');
      await page.click('#hs-cash-form [data-term="20"]');
      assert.match(await page.textContent('#hs-cash-form [data-term-preview]'), /Matures/, 'the maturity is previewed');
      await page.click('#hs-cash-form [data-submit]');
      await page.waitForFunction(() => /\$750\.00/.test((document.querySelector('[data-requests]') || {}).textContent || ''), null, { timeout: 20000 });
      assert.match(await page.textContent('[data-requests]'), /\$750\.00[\s\S]*20-year term[\s\S]*With our team/);
      ok('receive: a cash payment told to us waits for staff, on the term chosen');
    }

    /* ---- 4. Send: matured Bitcoin, a PIN and a code ---- */
    {
      await page.goto(`${base}/send`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /BTC/.test((document.querySelector('[data-ready]') || {}).textContent || ''), null, { timeout: 20000 });
      assert.strictEqual((await page.textContent('[data-ready]')).trim(), '2.74619651 BTC');
      assert.ok(await page.$$eval('[data-upcoming] .hs-term', (n) => n.length) === 3, 'the rest is listed with when it matures');
      await page.fill('#s-units', '0.25');
      await page.fill('#s-address', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2');
      await page.fill('#s-pin', '4417');
      page.once('dialog', (dialog) => dialog.accept());
      const submitted = page.click('#hs-send-form [data-submit]').catch(() => {});
      await page.waitForSelector('.rf-modal-backdrop .rf-devcode code', { timeout: 20000 });
      await submitted;
      const code = (await page.textContent('.rf-modal-backdrop .rf-devcode code')).trim();
      await page.fill('.rf-modal-backdrop input[name="code"]', code);
      await page.click('.rf-modal-backdrop [data-submit]');
      await page.waitForFunction(() => /With our team/.test((document.querySelector('[data-requests]') || {}).textContent || ''), null, { timeout: 20000 });
      assert.strictEqual((await page.textContent('[data-ready]')).trim(), '2.49619651 BTC', 'what is asked for is no longer ready');
      ok('send: matured Bitcoin, confirmed with a PIN and an emailed code, then with our team');
    }

    /* ---- 5. every signed-in screen renders ---- */
    {
      const screens = ['/vault', '/history', '/receive', '/send', '/alerts', '/messages', '/security', '/activity', '/profile'];
      for (const route of screens) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        const empty = await page.$$eval('.rf-skel, [data-rows] td.rf-center.rf-muted, [data-requests] td.rf-center.rf-muted', (nodes) =>
          nodes.filter((n) => /loading/i.test(n.textContent)).length);
        assert.strictEqual(empty, 0, `${route} finished loading`);
      }
      ok(`all ${screens.length} screens render their data`);
      for (const route of ['/accounts', '/statements', '/bills', '/deposit', '/cards', '/invest', '/transactions', '/transfers', '/recipients']) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        assert.ok(!page.url().endsWith(route), `${route} is retired and redirects`);
      }
      ok('the retired banking screens redirect');
    }

    /* ---- 6. the staff console: requests, registration, adding to a vault ---- */
    {
      const staffContext = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
      const staff = await newPage(staffContext, 'console');
      await staff.goto(`${base}/signin`, { waitUntil: 'domcontentloaded' });
      await staff.click('[data-fill="admin"]');
      await staff.click('#rf-signin-form [data-submit]');
      await staff.waitForURL('**/console', { timeout: 20000 });
      await staff.waitForSelector('[data-stats] .rf-stat', { timeout: 20000 });
      ok('an administrator lands on the console');

      for (const tab of ['customers', 'queue', 'messages', 'alerts', 'activity', 'settings', 'investments', 'setup']) {
        await staff.click(`[data-tab="${tab}"]`);
        await staff.waitForTimeout(700);
        const stillLoading = await staff.$$eval(`[data-panel="${tab}"] td`, (nodes) =>
          nodes.filter((n) => /loading/i.test(n.textContent)).length);
        assert.strictEqual(stillLoading, 0, `the ${tab} tab finished loading`);
      }
      ok('every console tab loads');

      // Confirm the customer's payment, then mark their send as sent.
      await staff.click('[data-tab="queue"]');
      await staff.waitForSelector('[data-queue] tr:has-text("$750.00") [data-confirm-request]', { timeout: 20000 });
      await staff.click('[data-queue] tr:has-text("$750.00") [data-confirm-request]');
      await staff.waitForSelector('.hs-stacked form', { timeout: 10000 });
      await staff.click('.hs-stacked [data-submit]');
      await staff.waitForFunction(() => Array.from(document.querySelectorAll('.rf-toast')).some((t) => /BTC added/.test(t.textContent)), null, { timeout: 20000 });
      await staff.waitForSelector('[data-queue] tr:has-text("0.25 BTC") [data-confirm-request]', { timeout: 20000 });
      await staff.click('[data-queue] tr:has-text("0.25 BTC") [data-confirm-request]');
      await staff.waitForSelector('.hs-stacked input[name="txid"]', { timeout: 10000 });
      await staff.fill('.hs-stacked input[name="txid"]', 'c'.repeat(64));
      await staff.click('.hs-stacked [data-submit]');
      await staff.waitForFunction(() => Array.from(document.querySelectorAll('.rf-toast')).some((t) => /sent and taken off the vault/.test(t.textContent)), null, { timeout: 20000 });
      ok('requests: staff confirm a cash payment and mark a send as sent, from the console');

      // Register a customer with what they have already paid.
      await staff.click('[data-tab="register"]');
      await staff.waitForSelector('#rf-register-form #r-opening', { timeout: 15000 });
      await staff.fill('#r-first', 'Priya');
      await staff.fill('#r-last', 'Raman');
      await staff.fill('#r-email', `priya.${Date.now()}@example.com`);
      await staff.fill('#r-ssn', '445120987');
      // The date of birth is three selects, not a calendar. Pick a leap day in
      // a leap year, then move the year to one that has no 29 February: the
      // day has to fall back rather than compose an impossible date.
      const dob = '#r-dob-label + .rf-dateparts';
      await staff.selectOption(`${dob} [data-part="month"]`, '02');
      await staff.selectOption(`${dob} [data-part="year"]`, '1988');
      await staff.selectOption(`${dob} [data-part="day"]`, '29');
      assert.strictEqual(await staff.inputValue('#r-dob'), '1988-02-29', 'the parts compose an ISO date');
      await staff.selectOption(`${dob} [data-part="year"]`, '1989');
      assert.strictEqual(await staff.inputValue('#r-dob'), '1989-02-28', '29 February falls back in a year without one');
      await staff.selectOption(`${dob} [data-part="year"]`, '1988');
      await staff.selectOption(`${dob} [data-part="day"]`, '29');
      await staff.fill('#r-phone', '(614) 555-0150');
      await staff.fill('#r-addr1', '88 Quarry Lane');
      await staff.fill('#r-city', 'Columbus');
      await staff.fill('#r-zip', '43201');
      await staff.fill('#r-opening', '4200.00');
      await staff.fill('#r-first-date', '2016-05-01');
      await staff.fill('#r-first-term', '15');
      const registered = staff.click('#rf-register-form [data-submit]').catch(() => {});
      await staff.waitForSelector('.rf-modal-backdrop:not(.rf-hide)', { timeout: 25000 });
      const summary = await staff.textContent('.rf-modal-backdrop:not(.rf-hide)');
      assert.match(summary, /HG\d{9}/, 'the registration summary carries the customer number');
      assert.match(summary, /In the vault[\s\S]*BTC[\s\S]*\$4,200\.00[\s\S]*matures/, 'and what went into their vault');
      await staff.click('.rf-modal-backdrop:not(.rf-hide) [data-close]');
      await registered;
      await staff.waitForSelector('[data-customers] tr[data-customer]', { timeout: 25000 });
      assert.match(await staff.textContent('[data-customers]'), /Priya Raman/, 'the new customer appears in the list');
      ok('the console registers a customer with what they paid in 2016, booked at that day\'s price');

      // Their record: the date of birth, then Bitcoin they sent in 2018.
      await staff.click('[data-customers] tr[data-customer]:has-text("Priya Raman")');
      await staff.waitForSelector('[data-modal-body] [data-book-trade]', { timeout: 20000 });
      assert.match(await staff.textContent('[data-modal-body]'), /1988-02-29/, 'the date of birth picked without a calendar is on the record');
      ok('the date of birth composes, clamps to a real day, and reaches the customer');
      await staff.click('[data-modal-body] [data-book-trade]');
      await staff.waitForSelector('.hs-stacked [data-side-value="bitcoin"]', { timeout: 10000 });
      await staff.click('.hs-stacked [data-side-value="bitcoin"]');
      await staff.fill('.hs-stacked input[name="units"]', '0.25');
      await staff.fill('.hs-stacked input[name="date"]', '2018-02-01');
      await staff.fill('.hs-stacked input[name="termYears"]', '20');
      await staff.click('.hs-stacked [data-submit]');
      await staff.waitForFunction(() => Array.from(document.querySelectorAll('.rf-toast')).some((t) => /Added 0\.25 BTC/.test(t.textContent)), null, { timeout: 20000 });
      const toast = await staff.$$eval('.rf-toast', (nodes) => nodes.map((n) => n.textContent).find((t) => /Added 0\.25 BTC/.test(t)) || '');
      assert.match(toast, /maturing Feb 1, 2038/, `dated 2018, maturing 20 years on: ${toast}`);
      ok('the console adds Bitcoin received in 2018 to a vault, maturing in 2038');
      await staffContext.close();
    }

    if (problems.length) {
      failed = true;
      console.error('\n  the browser complained:\n    ' + [...new Set(problems)].join('\n    '));
    } else {
      console.log('\n  all browser tests passed, with nothing logged to the console');
    }
  } catch (err) {
    failed = true;
    console.error('\n  FAILED:', err && err.message);
    console.error(err && err.stack);
    if (problems.length) console.error('  alongside:\n    ' + [...new Set(problems)].join('\n    '));
  } finally {
    await browser.close().catch(() => {});
    server.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  }
})();
