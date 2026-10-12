'use strict';

/**
 * The two ways the browser can fail to reach Supabase itself. In both the
 * chat must still work, because the server holds the service role.
 */

const assert = require('assert');
const http = require('http');
const { chromium } = require('playwright-core');
const mock = require('./mock-supabase');

const ROOT = require('path').join(__dirname, '..');


function serve(env) {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ROOT + '/src')) delete require.cache[key];
  }
  ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATA_DIR', 'CHAT_NOTIFY'].forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  const app = require(ROOT + '/src/app');
  return new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s));
  });
}

async function chat(browser, base) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/contact', { waitUntil: 'networkidle' });
  await page.click('#chat-toggle');
  await page.fill('#chat-input', 'Do you take on marine structures?');
  await page.press('#chat-input', 'Enter');
  await page.waitForFunction(
    () => document.querySelectorAll('#chat-log .chat-msg.agent:not(.typing)').length >= 1,
    null,
    { timeout: 15000 }
  );
  const drawn = await page.$$eval('#chat-log .chat-msg', (n) => n.map((x) => x.textContent));
  assert.strictEqual(errors.length, 0, errors.join('\n'));
  await page.close();
  return drawn;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  try {
    /* --- anonymous sign-ins switched off on the Supabase project --- */
    const sb = await mock.start({});
    sb.anonymousEnabled = false;
    let site = await serve({
      SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`,
      SUPABASE_ANON_KEY: mock.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
      CHAT_NOTIFY: 'off',
    });
    let drawn = await chat(browser, `http://127.0.0.1:${site.address().port}`);
    assert.ok(drawn.some((t) => t.includes('marine structures')), JSON.stringify(drawn));
    assert.ok(drawn.length >= 2, 'still got a reply: ' + JSON.stringify(drawn));
    assert.strictEqual(sb.db.chat_sessions.rows.length, 1, 'server wrote the session');
    assert.strictEqual(sb.db.chat_messages.rows.length, 2, 'server wrote both rows');
    assert.ok(sb.db.chat_sessions.rows[0].visitor_id, 'visitor_id supplied without auth.uid()');
    console.log('  ok  anonymous sign-ins disabled: chat falls back to the server and still persists');
    site.close();
    sb.close();

    /* --- no database at all: local files --- */
    const dir = require('fs').mkdtempSync('/tmp/merkel-chat-');
    site = await serve({ DATA_DIR: dir, CHAT_NOTIFY: 'off' });
    drawn = await chat(browser, `http://127.0.0.1:${site.address().port}`);
    assert.ok(drawn.length >= 2, 'reply without a database: ' + JSON.stringify(drawn));
    const files = require('fs').readdirSync(require('path').join(dir, 'chat'));
    assert.strictEqual(files.length, 1, 'conversation written to disk');
    console.log('  ok  no Supabase at all: chat works against local files');
    site.close();

    console.log('\nfallback suite passed');
  } catch (err) {
    console.error('\nFAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
  process.exit(process.exitCode || 0);
})();
