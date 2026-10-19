'use strict';

/**
 * The investment platform driven through a real browser.
 *
 * test/bank.test.js proves the API. This proves the part a customer actually
 * touches: that the dashboard renders the investment the ledger holds and
 * charts it, that a withdrawal made through the form holds the money, that
 * buying Bitcoin through the sheet books a purchase with its term, that the
 * staff console can register a customer and adjust a balance, and that none
 * of it logs an error on the way.
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
// Fixed prices and a fixed price history, so the seeded purchases, the chart
// and every purchase made here are priced without the network.
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
      for (const route of ['/', '/bitcoin', '/digital', '/rates', '/security-center', '/support', '/contact', '/careers', '/legal', '/open-account', '/apply']) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        const heading = await page.textContent('h1');
        assert.ok(heading && heading.trim().length, `${route} has a heading`);
      }
      // The banking pages' old addresses land on the Bitcoin page.
      for (const route of ['/personal', '/business', '/services', '/projects']) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        assert.ok(page.url().endsWith('/bitcoin'), `${route} now goes to /bitcoin`);
      }
      // The home page says what we do, and prices it live.
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      assert.match(await page.textContent('.hs-band-hero mark.hs-hl'), /Bitcoin only/);
      await page.waitForSelector('[data-btc-live]:not([hidden])', { timeout: 15000 });
      assert.match(await page.textContent('[data-btc-price]'), /^\$63,250\.00$/, 'the live price is shown in the hero');
      ok('the public pages render, each with a heading; old addresses redirect; the hero shows Bitcoin only, priced live');

      /* the enquiry form reaches the desk's store */
      await page.goto(`${base}/contact`, { waitUntil: 'domcontentloaded' });
      await page.fill('#contact-form-name', 'Dana Whitfield');
      await page.fill('#contact-form-email', 'dana@example.com');
      await page.fill('#contact-form-message', 'I would like to start investing in Bitcoin. What do I need?');
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

    /* ---- 2. a customer signs in and sees their money ---- */
    const context = await browser.newContext({ viewport: { width: 1400, height: 950 } });
    const page = await newPage(context, 'customer');
    let checkingBefore;
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

      // The headline is the Bitcoin, and it is the sum of the purchases.
      await page.waitForFunction(() => /\$/.test((document.querySelector('[data-hero="value"]') || {}).textContent || ''), null, { timeout: 20000 });
      await page.waitForSelector('[data-positions] tr td.num', { timeout: 20000 });
      const hero = money(await page.textContent('[data-hero="value"]'));
      const values = await page.$$eval('[data-positions] tr', (rows) => rows.map((r) => r.querySelectorAll('td.num')[2].textContent));
      const sum = values.reduce((n, v) => n + money(v), 0);
      assert.strictEqual(values.length, 3, 'the three seeded purchases are listed');
      assert.ok(Math.abs(hero - sum) < 0.02, `the headline is the sum of the purchases (${hero} vs ${sum})`);
      const terms = await page.$$eval('[data-terms] .hs-term', (n) => n.map((li) => li.textContent));
      assert.strictEqual(terms.length, 3, 'each purchase has its time to maturity');
      assert.ok(terms.some((t) => /Matured/.test(t)) && terms.some((t) => /to go/.test(t)), 'matured and running terms both read');
      // The chart: drawn, with each purchase marked, and its figures as a table.
      await page.waitForSelector('[data-growth-chart] svg path.value', { timeout: 20000 });
      assert.strictEqual(await page.$$eval('[data-growth-chart] circle.buy', (n) => n.length), 3, 'every purchase is marked on the line');
      assert.ok(await page.$$eval('[data-chart-rows] tr', (n) => n.length) > 10, 'the chart has a table view');
      const box = await page.$eval('[data-growth-chart] .hit', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      await page.mouse.move(box.x + box.w * 0.6, box.y + box.h / 2);
      await page.waitForSelector('.hs-tip:not([hidden])', { timeout: 5000 });
      assert.match(await page.textContent('.hs-tip'), /Value[\s\S]*Invested[\s\S]*Growth/, 'hovering reads out every series');
      checkingBefore = money(await page.textContent('[data-stat="cash"]'));
      ok(`dashboard: $${hero.toFixed(2)} of Bitcoin across ${values.length} purchases, charted since the first, $${checkingBefore.toFixed(2)} cash to invest`);
    }

    /* ---- 3. a withdrawal made in the UI holds the money ---- */
    {
      await page.goto(`${base}/transfers`, { waitUntil: 'domcontentloaded' });
      // An <option> is never "visible" to Playwright, so wait on the count.
      await page.waitForFunction(
        () => { const s = document.getElementById('t-beneficiary'); return s && s.options.length > 0 && s.value; },
        null,
        { timeout: 15000 }
      );
      const kinds = await page.$$eval('[data-type-picker] button', (n) => n.map((b) => b.textContent));
      assert.deepStrictEqual(kinds, ['Standard withdrawal', 'Same-day withdrawal', 'International withdrawal'], 'withdrawals are all there is');
      await page.fill('#t-amount', '125.00');
      await page.fill('#t-pin', '4417');
      await page.fill('#t-memo', 'Browser test');
      // The form asks for the account to be confirmed. A click that opens a
      // native dialog does not settle until the dialog is handled, so the
      // click is started rather than awaited.
      page.once('dialog', (dialog) => dialog.accept());
      const submitted = page.click('#rf-transfer-form [data-submit]').catch(() => {});
      await page.waitForSelector('.rf-modal-backdrop .rf-devcode code', { timeout: 20000 });
      await submitted;
      const code = (await page.textContent('.rf-modal-backdrop .rf-devcode code')).trim();
      await page.fill('.rf-modal-backdrop input[name="code"]', code);
      await page.click('.rf-modal-backdrop [data-submit]');
      await page.waitForFunction(() => /CNF-/.test((document.querySelector('.rf-modal-backdrop') || {}).textContent || ''), null, { timeout: 20000 });
      const receipt = await page.textContent('.rf-modal-backdrop');
      assert.match(receipt, /With our team for review/, 'it waits for a person');
      await page.click('.rf-modal-backdrop [data-close]');

      await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /\$/.test((document.querySelector('[data-stat="cash"]') || {}).textContent || ''), null, { timeout: 20000 });
      const after = money(await page.textContent('[data-stat="cash"]'));
      assert.ok(Math.abs((checkingBefore - 125) - after) < 0.02, `the cash to invest fell by $125 while it is held (${checkingBefore} -> ${after})`);
      ok('a withdrawal made in the form is verified by code and holds the money');
    }

    /* ---- 3b. buying Bitcoin through the sheet, with a term ---- */
    {
      await page.goto(`${base}/invest`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-inv-positions] tr td.num', { timeout: 20000 });
      await page.click('[data-inv-quick]');
      await page.waitForSelector('.hs-sheet #inv-amount', { timeout: 10000 });
      assert.deepStrictEqual(await page.$$eval('#inv-term option', (n) => n.map((o) => o.value)), ['3', '6', '12', '24'], 'the terms on offer');
      await page.fill('#inv-amount', '632.50');
      await page.selectOption('#inv-term', '6');
      assert.match(await page.textContent('.hs-sheet [data-preview]'), /0\.01 BTC[\s\S]*Matures/, 'the preview shows the Bitcoin and the maturity');
      await page.click('.hs-sheet [data-submit]');
      await page.waitForSelector('.hs-receipt', { timeout: 20000 });
      assert.match(await page.textContent('.hs-receipt'), /Bought[\s\S]*0\.01[\s\S]*6-month term/, 'the receipt names the term');
      await page.click('.hs-receipt [data-close-modal]');
      await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('[data-positions] tr td.num').length >= 16, null, { timeout: 20000 });
      ok('Bitcoin bought through the sheet on a 6-month term appears on the dashboard');
    }

    /* ---- 4. every signed-in screen renders ---- */    /* ---- 4. every signed-in screen renders ---- */
    {
      const screens = ['/invest', '/transactions', '/transfers', '/recipients', '/alerts', '/messages', '/security', '/activity', '/profile'];
      for (const route of screens) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        const empty = await page.$$eval('.rf-skel, [data-rows] td.rf-center.rf-muted', (nodes) =>
          nodes.filter((n) => /loading/i.test(n.textContent)).length);
        assert.strictEqual(empty, 0, `${route} finished loading`);
      }
      ok(`all ${screens.length} account screens render their data`);
      for (const route of ['/accounts', '/statements', '/bills', '/deposit', '/cards']) {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        assert.ok(!page.url().endsWith(route), `${route} is retired and redirects`);
      }
      ok('the retired banking screens redirect');
    }

    /* ---- 5. the staff console registers a customer and adjusts a balance ---- */
    {
      const staffContext = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
      const staff = await newPage(staffContext, 'console');
      await staff.goto(`${base}/signin`, { waitUntil: 'domcontentloaded' });
      await staff.click('[data-fill="admin"]');
      await staff.click('#rf-signin-form [data-submit]');
      await staff.waitForURL('**/console', { timeout: 20000 });
      await staff.waitForSelector('[data-stats] .rf-stat', { timeout: 20000 });
      ok('an administrator lands on the console');

      // Every tab loads.
      for (const tab of ['customers', 'queue', 'messages', 'alerts', 'activity', 'settings', 'investments', 'setup']) {
        await staff.click(`[data-tab="${tab}"]`);
        await staff.waitForTimeout(700);
        const stillLoading = await staff.$$eval(`[data-panel="${tab}"] td`, (nodes) =>
          nodes.filter((n) => /loading/i.test(n.textContent)).length);
        assert.strictEqual(stillLoading, 0, `the ${tab} tab finished loading`);
      }
      ok('every console tab loads');

      // Register a customer with an opening balance.
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
      const registered = staff.click('#rf-register-form [data-submit]').catch(() => {});
      await staff.waitForSelector('.rf-modal-backdrop:not(.rf-hide)', { timeout: 25000 });
      const summary = await staff.textContent('.rf-modal-backdrop:not(.rf-hide)');
      assert.match(summary, /HG\d{9}/, 'the registration summary carries the customer number');
      await staff.click('.rf-modal-backdrop:not(.rf-hide) [data-close]');
      await registered;
      await staff.waitForSelector('[data-customers] tr[data-customer]', { timeout: 25000 });
      const listed = await staff.textContent('[data-customers]');
      assert.match(listed, /Priya Raman/, 'the new customer appears in the list');
      ok('the console registers a customer with an opening balance');

      // Open their sheet and post an adjustment.
      await staff.click('[data-customers] tr[data-customer]:has-text("Priya Raman")');
      await staff.waitForSelector('[data-modal-body] [data-adjust]', { timeout: 20000 });
      // The date picked from the three scrollers reached the record, which is
      // the whole point of the hidden input sitting behind them.
      const sheet = await staff.textContent('[data-modal-body]');
      assert.match(sheet, /1988-02-29/, 'the date of birth picked without a calendar is on the record');
      ok('the date of birth composes, clamps to a real day, and reaches the customer');
      await staff.click('[data-modal-body] [data-adjust]');
      await staff.waitForSelector('[data-adjust-modal]:not(.rf-hide)', { timeout: 10000 });
      await staff.fill('#ad-amount', '1500.00');
      await staff.fill('#ad-description', 'DEPOSIT RECEIVED');
      await staff.click('#rf-adjust-form [data-submit]');
      // An earlier toast may still be on screen, so wait for the one this
      // action raises rather than for any toast at all.
      await staff.waitForFunction(
        () => Array.from(document.querySelectorAll('.rf-toast')).some((t) => /Credited/.test(t.textContent)),
        null,
        { timeout: 20000 }
      );
      const toast = await staff.$$eval('.rf-toast', (nodes) =>
        (nodes.map((n) => n.textContent).find((t) => /Credited/.test(t)) || ''));
      assert.match(toast, /Credited \$1,500\.00/, `the console reports the credit: ${toast}`);
      assert.match(toast, /New balance \$5,700\.00/, `the balance is the sum of the two entries: ${toast}`);
      ok('the console posts a dated ledger entry and the balance follows');
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
