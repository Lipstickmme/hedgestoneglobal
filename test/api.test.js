'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const mock = require('./mock-supabase');

const ROOT = require('path').join(__dirname, '..');

async function req(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) {}
  return { status: res.status, body: json, text };
}

async function withApp(env, fn) {
  Object.assign(process.env, env);
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ROOT + '/src')) delete require.cache[key];
  }
  const app = require(ROOT + '/src/api-app');
  const server = await new Promise((r) => {
    const s = http.createServer(app).listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.close();
  }
}

(async () => {
  /* ---- 1. the schema mismatch that broke chat is caught by the mock ---- */
  {
    const sb = await mock.start({});
    const base = `http://127.0.0.1:${sb.address().port}`;
    const res = await fetch(`${base}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: { apikey: mock.SERVICE_KEY, Authorization: `Bearer ${mock.SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ session_id: 'sometoken', role: 'user', text: 'hi' }]),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 400, 'old column names must be rejected');
    assert.match(body.message, /'role' column/);
    console.log('  ok  mock rejects the pre-fix columns:', body.message);
    sb.close();
  }

  /* ---- 2. server-side chat path writes what the schema expects ---- */
  {
    const sb = await mock.start({});
    const sbUrl = `http://127.0.0.1:${sb.address().port}`;
    await withApp(
      { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, CHAT_NOTIFY: 'off' },
      async (base) => {
        const token = 'visitortoken1234';
        const sent = await req(base, 'POST', '/api/chat/message', { sessionId: token, text: 'We need a bridge assessed.' });
        assert.strictEqual(sent.status, 201, JSON.stringify(sent.body));
        assert.strictEqual(sent.body.stored, true, 'message must persist: ' + JSON.stringify(sent.body));
        assert.strictEqual(sent.body.messages.length, 2);
        assert.strictEqual(sent.body.messages[0].text, 'We need a bridge assessed.');
        assert.strictEqual(sent.body.messages[1].role, 'agent');

        assert.strictEqual(sb.db.chat_sessions.rows.length, 1, 'one session row');
        assert.strictEqual(sb.db.chat_messages.rows.length, 2, 'visitor + agent rows');
        assert.deepStrictEqual(
          sb.db.chat_messages.rows.map((r) => r.sender),
          ['visitor', 'agent']
        );
        console.log('  ok  server path wrote sender/body rows and a parent session');

        // A second message must reuse the same session row.
        await req(base, 'POST', '/api/chat/message', { sessionId: token, text: 'Second message' });
        assert.strictEqual(sb.db.chat_sessions.rows.length, 1, 'session row is not duplicated');
        console.log('  ok  a follow-up reuses the same session');

        const history = await req(base, 'GET', `/api/chat/${token}`);
        assert.strictEqual(history.status, 200);
        assert.strictEqual(history.body.messages.length, 4);
        assert.deepStrictEqual(history.body.messages.map((m) => m.role), ['user', 'agent', 'user', 'agent']);
        assert.strictEqual(history.body.messages[0].text, 'We need a bridge assessed.');
        console.log('  ok  history reads back in order with app roles');

        // Once a human answers, the canned responder stays quiet.
        sb.db.chat_sessions.rows[0].handled_by_agent = true;
        const quiet = await req(base, 'POST', '/api/chat/message', { sessionId: token, text: 'Anyone there?' });
        assert.strictEqual(quiet.body.messages.length, 1, 'no auto-reply after handover');
        assert.strictEqual(sb.db.chat_messages.rows.length, 5, 'only the visitor row was added');
        console.log('  ok  handover silences the automatic responder');
      }
    );
    sb.close();
  }

  /* ---- 3. browser path: /api/chat/notify posts the holding reply ---- */
  {
    const sb = await mock.start({});
    const sbUrl = `http://127.0.0.1:${sb.address().port}`;
    const visitor = { id: '11111111-2222-4333-8444-555555555555' };
    const session = { id: '99999999-8888-4777-8666-555555555555', visitor_id: visitor.id, created_at: new Date().toISOString(), last_message_at: new Date().toISOString(), status: 'new', handled_by_agent: false };
    sb.db.chat_sessions.rows.push(session);
    sb.db.chat_messages.rows.push({ id: 'm1', created_at: new Date().toISOString(), session_id: session.id, sender: 'visitor', body: 'Hello' });

    await withApp(
      { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY, CHAT_NOTIFY: 'off' },
      async (base) => {
        const notified = await req(base, 'POST', '/api/chat/notify', { sessionId: session.id, text: 'Hello' });
        assert.strictEqual(notified.status, 202, JSON.stringify(notified.body));
        assert.strictEqual(notified.body.replied, true);
        assert.strictEqual(sb.db.chat_messages.rows.length, 2);
        assert.strictEqual(sb.db.chat_messages.rows[1].sender, 'agent');
        console.log('  ok  notify posts the holding reply into the visitor thread');

        session.handled_by_agent = true;
        const after = await req(base, 'POST', '/api/chat/notify', { sessionId: session.id, text: 'Still there?' });
        assert.strictEqual(after.body.replied, false);
        assert.strictEqual(sb.db.chat_messages.rows.length, 2, 'no bot reply once a human is on it');
        console.log('  ok  notify stays quiet after handover');

        const bad = await req(base, 'POST', '/api/chat/notify', { sessionId: 'not-a-uuid', text: 'x' });
        assert.strictEqual(bad.status, 422);
        console.log('  ok  notify rejects a malformed session id');
      }
    );
    sb.close();
  }

  /* ---- 4. the health probe sees a schema built from an older migration ---- */
  {
    const good = await mock.start({});
    // A site that is not receiving mail never runs 0002_email.sql.
    delete good.db.email_threads;
    delete good.db.email_messages;
    await withApp(
      { SUPABASE_URL: `http://127.0.0.1:${good.address().port}`, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'GET', '/api/health?probe=1');
        assert.strictEqual(res.body.schema.chat_messages, 'ok');
        assert.strictEqual(res.body.schema.chat_sessions, 'ok');
        assert.match(res.body.schema.email_threads, /^optional:/);
        assert.ok(!res.body.warnings.some((w) => /did not answer/.test(w)), JSON.stringify(res.body.warnings));
        // The bank's own tables were missing from this probe entirely, so a
        // bank that could not write a row still reported a healthy schema.
        ['bank_users', 'bank_accounts', 'bank_transactions', 'bank_transfers', 'bank_cards', 'bank_settings']
          .forEach((t) => assert.strictEqual(res.body.schema[t], 'ok', `${t} should probe ok`));
        console.log('  ok  probe passes against the current migration, the bank included');
      }
    );
    good.close();

    const stale = await mock.start({ drop: ['chat_sessions.handled_by_agent'] });
    await withApp(
      { SUPABASE_URL: `http://127.0.0.1:${stale.address().port}`, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'GET', '/api/health?probe=1');
        assert.strictEqual(res.body.status, 'degraded');
        assert.match(res.body.schema.chat_sessions, /handled_by_agent does not exist/);
        assert.ok(res.body.warnings.some((w) => /0001_init\.sql/.test(w)));
        console.log('  ok  probe names the missing column and the file that adds it');
      }
    );
    stale.close();

    // Once MAILBOX_ADDRESS is set the inbox tables stop being optional. Filing
    // is best effort, so without them the webhook still answers 200 and Resend
    // still reports success while /admin stays empty and nothing says why.
    const receiving = await mock.start({});
    delete receiving.db.email_threads;
    delete receiving.db.email_messages;
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${receiving.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        MAILBOX_ADDRESS: 'Rockfield National Bank <contact@rockfield.test>',
      },
      async (base) => {
        const res = await req(base, 'GET', '/api/health?probe=1');
        assert.strictEqual(res.body.status, 'degraded');
        assert.ok(
          res.body.warnings.some((w) => /email_threads[\s\S]*0002_email\.sql/.test(w)),
          JSON.stringify(res.body.warnings)
        );
        console.log('  ok  a site receiving mail is told the inbox tables are missing');
      }
    );
    receiving.close();

    // The bank builds itself on the first request that needs data. When that
    // never happens - or happens and fails - the only symptom is a sign-in
    // page rejecting every password, and the reason is in a log on a host
    // somebody has to go and find. ?seed=1 does it here and says what
    // happened.
    const banking = await mock.start({});
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${banking.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        BANK_ADMIN_EMAIL: 'ops@rockfield.test',
        BANK_ADMIN_PASSWORD: 'Quarry#Road2026',
      },
      async (base) => {
        const before = await req(base, 'GET', '/api/health');
        assert.strictEqual(before.body.bank.users, 0, 'nothing is seeded until something asks');

        const seeded = await req(base, 'GET', '/api/health?seed=1');
        assert.strictEqual(seeded.body.bank.seedRun.ran, true);
        assert.strictEqual(seeded.body.bank.seedRun.ok, true, JSON.stringify(seeded.body.bank.seedRun));
        assert.ok(seeded.body.bank.seedRun.users > 0, 'accounts exist afterwards');

        // The credentials from the environment are the ones that work.
        const login = await req(base, 'POST', '/api/bank/auth/login', {
          email: 'ops@rockfield.test', password: 'Quarry#Road2026',
        });
        assert.strictEqual(login.status, 200, JSON.stringify(login.body));
        assert.strictEqual(login.body.user.role, 'admin');

        // And it is a no-op once the bank exists, so it is safe to leave up.
        const again = await req(base, 'GET', '/api/health?seed=1');
        assert.strictEqual(again.body.bank.seedRun.ran, false);
        console.log('  ok  ?seed=1 builds the bank, the env credentials sign in, a second call is a no-op');
      }
    );
    banking.close();

    // A seed that dies part way used to be indistinguishable from a finished
    // one: the guard asked whether any users existed, and an administrator
    // with no customers, accounts or history answered yes. The bank then
    // refused to seed again for ever.
    const halfBuilt = await mock.start({});
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${halfBuilt.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        BANK_ADMIN_EMAIL: 'ops@rockfield.test',
        BANK_ADMIN_PASSWORD: 'Quarry#Road2026',
      },
      async (base) => {
        // Break the history write, which is how a serverless timeout shows up.
        const ledger = require(ROOT + '/src/bank/ledger');
        const real = ledger.postMany;
        ledger.postMany = async () => { throw new Error('function timed out'); };
        await require(ROOT + '/src/bank/seed').ensureSeed().catch(() => {});
        ledger.postMany = real;

        const stuck = await req(base, 'GET', '/api/health');
        assert.strictEqual(stuck.body.bank.seedState, 'incomplete');
        assert.ok(stuck.body.bank.users > 0 && stuck.body.bank.users < 3, 'a partial seed, not a whole one');
        assert.ok(
          stuck.body.warnings.some((w) => /stopped part way/.test(w)),
          JSON.stringify(stuck.body.warnings)
        );

        // ?seed=1 will not paper over it, but says what to do.
        const refused = await req(base, 'GET', '/api/health?seed=1');
        assert.strictEqual(refused.body.bank.seedRun.ran, false);
        assert.match(refused.body.bank.seedRun.reason, /seed=reset/);

        // ?seed=reset clears the wreckage and builds it properly.
        const rebuilt = await req(base, 'GET', '/api/health?seed=reset');
        assert.strictEqual(rebuilt.body.bank.seedRun.ok, true, JSON.stringify(rebuilt.body.bank.seedRun));
        assert.strictEqual(rebuilt.body.bank.seedState, 'complete');

        const login = await req(base, 'POST', '/api/bank/auth/login', {
          email: 'ops@rockfield.test', password: 'Quarry#Road2026',
        });
        assert.strictEqual(login.status, 200, JSON.stringify(login.body));

        // And it refuses to touch a bank that is properly built.
        const guard = await req(base, 'GET', '/api/health?seed=reset');
        assert.strictEqual(guard.body.bank.seedRun.ran, false);
        assert.match(guard.body.bank.seedRun.reason, /refusing to reset/);
        console.log('  ok  a half-built bank is spotted, cleared and rebuilt; a finished one is refused');
      }
    );
    halfBuilt.close();

    // The two variables sit next to each other in a deployment's settings and
    // both read like "the login", so setting them to one address is an easy
    // mistake. It used to kill the seed immediately after the administrator
    // was created - one unique email column, two accounts - and leave the bank
    // permanently half built.
    const sameEmail = await mock.start({});
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${sameEmail.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        BANK_ADMIN_EMAIL: 'support@rockfield.test',
        BANK_ADMIN_PASSWORD: 'Quarry#Road2026',
        BANK_DEMO_EMAIL: 'support@rockfield.test',
        BANK_DEMO_PASSWORD: 'Bedrock#Demo2026',
      },
      async (base) => {
        const warned = await req(base, 'GET', '/api/health');
        assert.ok(
          warned.body.warnings.some((w) => /BANK_ADMIN_EMAIL and BANK_DEMO_EMAIL are the same/.test(w)),
          JSON.stringify(warned.body.warnings)
        );

        const built = await req(base, 'GET', '/api/health?seed=1');
        assert.strictEqual(built.body.bank.seedRun.ok, true, JSON.stringify(built.body.bank.seedRun));
        assert.strictEqual(built.body.bank.seedState, 'complete', 'it finishes rather than dying half way');
        assert.strictEqual(built.body.bank.seedRun.demoEmailIgnored, 'support@rockfield.test');

        // The administrator keeps the address that was asked for.
        const login = await req(base, 'POST', '/api/bank/auth/login', {
          email: 'support@rockfield.test', password: 'Quarry#Road2026',
        });
        assert.strictEqual(login.status, 200, JSON.stringify(login.body));
        assert.strictEqual(login.body.user.role, 'admin');
        console.log('  ok  one address for both variables no longer wedges the bank');
      }
    );
    sameEmail.close();

    // Addressing the site's own notifications to the mailbox the site itself
    // receives on sends them in a circle: out through the API, back in through
    // the inbound webhook, onto the message desk, and no further. Both ends
    // report success - the provider delivered it, the desk filed it - so the
    // only symptom is an inbox that stays empty, which is a miserable thing to
    // debug from the outside.
    const looping = await mock.start({});
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${looping.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        RESEND_API_KEY: 're_test_key',
        RESEND_WEBHOOK_SECRET: 'whsec_test',
        MAILBOX_ADDRESS: 'Rockfield <support@rockfield.test>',
        FORM_TO: 'support@rockfield.test',
      },
      async (base) => {
        const res = await req(base, 'GET', '/api/health');
        const warning = res.body.warnings.find((w) => /FORM_TO .* is on the same domain as MAILBOX_ADDRESS/.test(w));
        assert.ok(warning, JSON.stringify(res.body.warnings));
        assert.match(warning, /support@rockfield\.test/, 'it names the address');
        assert.match(warning, /never reach a mailbox anybody opens/, 'and says what the consequence is');
        console.log('  ok  notifications addressed into our own inbound mailbox are reported');
      }
    );
    looping.close();

    // The same pair of addresses on different domains is the correct setup and
    // must stay quiet.
    const notLooping = await mock.start({});
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${notLooping.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        RESEND_API_KEY: 're_test_key',
        RESEND_WEBHOOK_SECRET: 'whsec_test',
        MAILBOX_ADDRESS: 'Rockfield <support@rockfield.test>',
        FORM_TO: 'someone@elsewhere.test',
      },
      async (base) => {
        const res = await req(base, 'GET', '/api/health');
        assert.ok(
          !res.body.warnings.some((w) => /same domain as MAILBOX_ADDRESS/.test(w)),
          JSON.stringify(res.body.warnings)
        );
        console.log('  ok  a recipient on another domain raises nothing');
      }
    );
    notLooping.close();

    // A domain verified for sending and not for receiving is the state that
    // looks healthiest from every angle except the one that matters: mail
    // leaves fine, the provider's log says delivered, and anything addressed
    // to that domain has nowhere to land. ?mail=1 asks the provider rather
    // than inferring it, because nothing inside this process can tell.
    {
      const resend = await new Promise((r) => {
        const s = http.createServer((rq, rs) => {
          rs.writeHead(200, { 'content-type': 'application/json' });
          rs.end(JSON.stringify({
            has_more: false,
            // The shape a real account returns: capabilities are the strings
            // "enabled" and "disabled", not booleans. Read as booleans, the
            // receiving check never fired on a domain that plainly could not
            // receive, which is the whole reason this exists.
            data: [
              {
                name: 'rockfield.test',
                status: 'verified',
                region: 'eu-west-1',
                capabilities: { sending: 'enabled', receiving: 'disabled' },
              },
              {
                name: 'elsewhere.test',
                status: 'verified',
                region: 'eu-west-1',
                capabilities: { sending: 'enabled', receiving: 'enabled' },
              },
            ],
          }));
        }).listen(0, '127.0.0.1', () => r(s));
      });
      const sb = await mock.start({});
      await withApp(
        {
          SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`,
          SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
          SUPABASE_ANON_KEY: mock.ANON_KEY,
          RESEND_API_KEY: 're_test_key',
          RESEND_API_BASE: `http://127.0.0.1:${resend.address().port}`,
          RESEND_WEBHOOK_SECRET: 'whsec_test',
          FORM_FROM: 'Rockfield <support@rockfield.test>',
          MAILBOX_ADDRESS: 'Rockfield <support@rockfield.test>',
          FORM_TO: 'someone@elsewhere.test',
        },
        async (base) => {
          const res = await req(base, 'GET', '/api/health?mail=1');
          assert.strictEqual(res.body.mail.ok, true, JSON.stringify(res.body.mail));
          assert.strictEqual(res.body.mail.domains[0].sending, 'enabled');
          assert.strictEqual(res.body.mail.domains[0].receiving, 'disabled');
          const receiving = res.body.warnings.find((w) => /MAILBOX_ADDRESS receives on rockfield\.test/.test(w));
          assert.ok(receiving, JSON.stringify(res.body.warnings));
          assert.match(receiving, /receiving disabled/, 'it says which capability is off');
          assert.match(receiving, /MX record/, 'and that SPF and DKIM do not cover it');
          assert.match(receiving, /elsewhere\.test/, 'and names a domain on the account that can receive');
          assert.ok(
            !res.body.warnings.some((w) => /FORM_FROM sends as/.test(w)),
            'sending is fine and must not be reported as broken'
          );

          // Without ?mail=1 nothing reaches out: the plain check stays an
          // environment read that cannot hang on somebody else's API.
          const plain = await req(base, 'GET', '/api/health');
          assert.strictEqual(plain.body.mail, undefined);
          console.log('  ok  a domain verified to send but not receive is named for what it is');
        }
      );
      sb.close();
      resend.close();
      // withApp assigns into process.env and never takes anything back out,
      // so a base URL pointing at a server we have just closed would follow
      // every later test and fail its sends with "fetch failed".
      delete process.env.RESEND_API_BASE;
    }

    // Vercel resolves api/[...path].js for a single segment under /api and
    // nothing deeper: anything further in reaches the edge router and 404s
    // before Express sees it. That is why /api/health answered while every
    // /api/bank/* route did not, and why the sign-in page reported a bare 404
    // rather than any message this app would have written.
    //
    // The template carries one entry point per depth for its own routes. The
    // bank's were missing. This walks the router and checks that every path it
    // registers has a file that can answer it.
    {
      const routesOf = (router, prefix = '') => {
        const out = [];
        for (const layer of router.stack || []) {
          if (layer.route) {
            out.push(`${prefix}${layer.route.path}`);
          } else if (layer.handle && layer.handle.stack) {
            const source = layer.regexp && layer.regexp.source;
            const m = source && source.match(/^\^\\\/((?:[\w-]|\\.)+)/);
            out.push(...routesOf(layer.handle, `${prefix}${m ? `/${m[1].replace(/\\(.)/g, '$1')}` : ''}`));
          }
        }
        return out;
      };

      const paths = routesOf(require(`${ROOT}/src/routes/bank`));
      assert.ok(paths.length > 50, `expected the bank to register plenty of routes, got ${paths.length}`);

      const missing = [];
      const seen = new Set();
      for (const route of paths) {
        const depth = route.split('/').filter(Boolean).length;
        if (seen.has(depth)) continue;
        seen.add(depth);
        // Depth 1 is /api/bank/x, which the root catch-all covers; deeper
        // paths each need their own file under api/bank/.
        const file = `${ROOT}/api/bank/${Array.from({ length: depth }, (_, i) => `[${String.fromCharCode(97 + i)}]`).join('/')}.js`;
        if (!fs.existsSync(file)) missing.push({ depth, route, file: file.replace(`${ROOT}/`, '') });
      }
      assert.deepStrictEqual(
        missing, [],
        `bank routes with no Vercel entry point at their depth:\n${missing.map((m) => `  ${m.route} needs ${m.file}`).join('\n')}`
      );
      console.log(`  ok  all ${paths.length} bank routes have a Vercel entry point at their depth`);
    }

    // And when the bank's tables are missing it says so rather than failing
    // silently, which is the whole point of the endpoint.
    const noTables = await mock.start({});
    Object.keys(noTables.db).filter((t) => t.startsWith('bank_')).forEach((t) => { delete noTables.db[t]; });
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${noTables.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
      },
      async (base) => {
        const res = await req(base, 'GET', '/api/health?seed=1');
        assert.strictEqual(res.body.bank.tables, false, 'the missing tables are reported');
        assert.strictEqual(res.body.bank.seedRun.ran, false);
        assert.match(res.body.bank.seedRun.reason, /0003_bank\.sql/);
        // The storage layer falls back to local files when a table is absent,
        // so without this warning the bank looks healthy and then forgets
        // everything the moment the container is recycled.
        assert.ok(
          res.body.warnings.some((w) => /bank's tables are missing[\s\S]*discards/.test(w)),
          JSON.stringify(res.body.warnings)
        );
        console.log('  ok  a bank with no tables is caught, not quietly run off the filesystem');
      }
    );
    noTables.close();
  }

  /* ---- 5. contact enquiries still land ---- */
  {
    const sb = await mock.start({});
    await withApp(
      { SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'POST', '/api/contact', {
          name: 'Ada Kolen', email: 'ada@example.com', company: 'Kolen BV', service: 'Structural',
          message: 'A 40m span over a canal, tight headroom.',
        });
        assert.strictEqual(res.status, 201, JSON.stringify(res.body));
        assert.strictEqual(sb.db.enquiries.rows.length, 1);
        assert.strictEqual(sb.db.enquiries.rows[0].email, 'ada@example.com');
        console.log('  ok  contact enquiry persisted');
      }
    );
    sb.close();
  }

  /* ---- 6. job applications reach the same database ---- */
  {
    const sb = await mock.start({});
    await withApp(
      { SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const roles = require(ROOT + '/src/data/careers.json');

        const good = await req(base, 'POST', '/api/applications', {
          name: 'Sanne Vermeer', email: 'sanne@example.nl', phone: '+31 6 1234 5678',
          roleId: roles[0].id, experience: '4 to 8', portfolio: 'https://example.nl/sanne',
          message: 'Six years on tall buildings, mostly post-tensioned flat slabs and one diagrid.',
        });
        assert.strictEqual(good.status, 201, JSON.stringify(good.body));
        assert.strictEqual(sb.db.applications.rows.length, 1);
        const row = sb.db.applications.rows[0];
        assert.strictEqual(row.email, 'sanne@example.nl');
        assert.strictEqual(row.role_id, roles[0].id);
        assert.strictEqual(row.role_title, roles[0].title);
        assert.strictEqual(row.status, 'new');
        console.log('  ok  application stored against the role it names');

        const spec = await req(base, 'POST', '/api/applications', {
          name: 'Tom Bakker', email: 'tom@example.nl',
          message: 'No open role fits but I detail connections and would like to talk.',
        });
        assert.strictEqual(spec.status, 201);
        assert.strictEqual(sb.db.applications.rows[1].role_title, 'Speculative application');
        console.log('  ok  a speculative application is still an application');

        const bad = await req(base, 'POST', '/api/applications', { name: 'X', email: 'nope', message: 'short' });
        assert.strictEqual(bad.status, 422);
        assert.deepStrictEqual(Object.keys(bad.body.fields).sort(), ['email', 'message', 'name']);
        console.log('  ok  validation reports every bad field at once');

        const stale = await req(base, 'POST', '/api/applications', {
          name: 'Ada Kolen', email: 'ada@example.com', roleId: 'a-role-we-closed',
          message: 'Applying for a role that is no longer listed on the careers page.',
        });
        assert.strictEqual(stale.status, 422);
        assert.ok(stale.body.fields.roleId, 'a closed role is rejected');
        console.log('  ok  a role that is no longer open is refused');

        const probe = await req(base, 'GET', '/api/health?probe=1');
        assert.strictEqual(probe.body.schema.applications, 'ok');
        console.log('  ok  the schema probe covers applications');
      }
    );
    sb.close();
  }

  /* ---- 7. the browser key, under every name Supabase has given it ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;

    // A project created under the newer API keys scheme: the Vercel
    // integration injects a publishable key, not an anon key. Missing this
    // name is why /admin can report "backend not connected" on a deployment
    // that is in fact configured.
    for (const name of [
      'SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'VITE_SUPABASE_ANON_KEY',
      'SUPABASE_PUBLISHABLE_KEY',
      'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_PUBLISHABLE_KEY',
    ]) {
      ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
       'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
      ].forEach((k) => delete process.env[k]);

      await withApp(
        { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, [name]: 'browser-key-value' },
        async (base) => {
          const cfg = await req(base, 'GET', '/api/public-config');
          assert.strictEqual(cfg.body.supabaseAnonKey, 'browser-key-value', `${name} must be accepted`);
          assert.strictEqual(cfg.body.chatEnabled, true, `${name} must enable the browser half`);
          assert.deepStrictEqual(cfg.body.missing, [], `${name} leaves nothing missing`);
        }
      );
    }
    console.log('  ok  every name Supabase uses for the browser key is accepted');

    ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY',
     'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY',
    ].forEach((k) => delete process.env[k]);

    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY },
      async (base) => {
        const cfg = await req(base, 'GET', '/api/public-config');
        assert.strictEqual(cfg.body.chatEnabled, false);
        assert.strictEqual(cfg.body.missing.length, 1);
        assert.strictEqual(cfg.body.missing[0].value, 'supabaseAnonKey');
        assert.ok(cfg.body.missing[0].accepts.includes('SUPABASE_PUBLISHABLE_KEY'));
        // Names only. A diagnosis must never hand out a key.
        assert.ok(!JSON.stringify(cfg.body.missing).includes(mock.SERVICE_KEY));
        console.log('  ok  a missing browser key is named, with the env names that would satisfy it');

        const health = await req(base, 'GET', '/api/health');
        assert.ok(
          health.body.warnings.some((w) => /SUPABASE_PUBLISHABLE_KEY/.test(w)),
          JSON.stringify(health.body.warnings)
        );
        console.log('  ok  health says the same thing');
      }
    );
    sb.close();
  }

  /* ---- 8. an application never vanishes, and the details are editable ---- */
  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;

    // A database created before the applications table existed.
    delete sb.db.applications;
    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        // The role has to be one that is actually open, or the controller
        // refuses it before the fallback is ever reached.
        const roles = require(ROOT + '/src/data/careers.json');
        const res = await req(base, 'POST', '/api/applications', {
          name: 'Sanne Vermeer', email: 'sanne@example.nl', roleId: roles[1].id,
          phone: '+31 6 1234 5678', experience: '4 to 8',
          message: 'Six years on payment operations, mostly ACH returns and one core migration.',
        });
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.body.stored, 'enquiries', 'it must land somewhere');
        assert.strictEqual(sb.db.enquiries.rows.length, 1);
        const filed = sb.db.enquiries.rows[0];
        assert.match(filed.service, /^Application: /);
        assert.match(filed.message, /Six years on payment operations/);
        assert.match(filed.message, /\+31 6 1234 5678/, 'the phone survives the fallback');
        console.log('  ok  an application is filed as an enquiry when its own table is missing');
      }
    );
    sb.close();
  }

  {
    const sb = await mock.start({});
    const url = `http://127.0.0.1:${sb.address().port}`;
    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const defaults = require(ROOT + '/src/data/site.json');

        const before = await req(base, 'GET', '/api/site');
        assert.strictEqual(before.body.email, defaults.email, 'an empty row falls back to the built-in values');
        assert.strictEqual(before.body.source, 'database');

        assert.strictEqual(before.body.phone, '', 'a telephone number nobody has set is blank, not invented');
        assert.strictEqual(before.body.address, '', 'and so is the address');

        sb.db.site_settings.rows[0].email = 'desk@example.com';
        sb.db.site_settings.rows[0].phone = '+31 (0)20 111 2222';
        const after = await req(base, 'GET', '/api/site');
        assert.strictEqual(after.body.email, 'desk@example.com');
        assert.strictEqual(after.body.phone, '+31 (0)20 111 2222');
        assert.strictEqual(after.body.address, '', 'a field left blank stays blank, so the page leaves its row out');
        console.log('  ok  edited contact details are served, unset details stay blank');
      }
    );
    // And with no table at all the site still knows its own address.
    delete sb.db.site_settings;
    await withApp(
      { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY },
      async (base) => {
        const res = await req(base, 'GET', '/api/site');
        assert.strictEqual(res.body.source, 'defaults');
        assert.strictEqual(res.body.email, require(ROOT + '/src/data/site.json').email);
        console.log('  ok  without the table the built-in details stand');
      }
    );
    sb.close();
  }

  /* ---- 14b. a retired default does not outrank the current one ---- */
  {
    // The console's support email is seeded from the institution's own, so
    // after a domain move every deployment held a settings row with the old
    // address. That differed from the new default, which is how a value
    // nobody chose came to outrank one the code ships - permanently, and
    // invisibly, with the old address printed on every public page.
    const current = require(ROOT + '/src/data/site.json').email;
    const serveWith = async (supportEmail) => {
      const sb = await mock.start({});
      sb.db.bank_settings.rows.push({ id: 'global', values: { supportEmail }, updated_at: new Date().toISOString() });
      let served;
      await withApp(
        {
          SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`,
          SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
          SUPABASE_ANON_KEY: mock.ANON_KEY,
        },
        async (base) => { served = (await req(base, 'GET', '/api/site')).body; }
      );
      sb.close();
      return served;
    };

    const retired = await serveWith('support@rockfieldbank.com');
    assert.strictEqual(retired.email, current, 'a retired default gives way to the one we ship now');

    const chosen = await serveWith('desk@elsewhere.example');
    assert.strictEqual(chosen.email, 'desk@elsewhere.example', 'an address somebody typed still wins');
    assert.strictEqual(chosen.source, 'settings');

    console.log('  ok  a support address nobody chose stops outranking the shipped one');
  }

  /* ---- 15. a signed Resend delivery reaches the admin inbox ---- */
  {
    const { sign } = require(ROOT + '/src/utils/webhookSignature');
    const SECRET = 'whsec_' + Buffer.from('rockfield-inbound-test-secret').toString('base64');
    const sb = await mock.start({});
    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY,
        SUPABASE_ANON_KEY: mock.ANON_KEY,
        RESEND_WEBHOOK_SECRET: SECRET,
        MAILBOX_ADDRESS: 'Rockfield National Bank <contact@rockfield.test>',
        // No forwarding here: this asserts the archive that /admin reads.
        FORWARD_TO: '',
        RESEND_API_KEY: '',
      },
      async (base) => {
        const post = (raw, id, timestamp, signature) =>
          fetch(base + '/api/inbound/resend', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'svix-id': id,
              'svix-timestamp': timestamp,
              'svix-signature': signature,
            },
            body: raw,
          });

        // Resend sends `to` as an array and prefixes the event with "email.".
        const body = JSON.stringify({
          type: 'email.received',
          data: {
            from: 'Ada Kolen <ada@example.com>',
            to: ['contact@rockfield.test'],
            subject: 'Re: A 40m span',
            text: 'Can you quote the canal crossing?',
            message_id: '<m1@example.com>',
          },
        });
        const ts = String(Math.floor(Date.now() / 1000));

        const ok = await post(body, 'msg_1', ts, sign(SECRET, 'msg_1', ts, body));
        assert.strictEqual(ok.status, 200, await ok.text());
        assert.strictEqual(sb.db.email_threads.rows.length, 1, 'a thread was opened');
        assert.strictEqual(sb.db.email_threads.rows[0].participant_email, 'ada@example.com');
        // Re: is stripped so a reply joins the conversation it belongs to.
        assert.strictEqual(sb.db.email_threads.rows[0].subject, 'A 40m span');
        assert.strictEqual(sb.db.email_messages.rows.length, 1);
        assert.strictEqual(sb.db.email_messages.rows[0].direction, 'inbound');
        assert.strictEqual(sb.db.email_messages.rows[0].to_email, 'contact@rockfield.test');
        console.log('  ok  a signed inbound delivery lands in the admin inbox');

        const tampered = body.replace('Ada Kolen', 'Mallory Vane');
        const bad = await post(tampered, 'msg_2', ts, sign(SECRET, 'msg_2', ts, body));
        assert.strictEqual(bad.status, 401);
        // Named so a provider's delivery log says which of the failures it was.
        assert.strictEqual((await bad.json()).reason, 'signature_mismatch');
        assert.strictEqual(sb.db.email_messages.rows.length, 1, 'nothing filed from an unverified post');
        console.log('  ok  a tampered body is refused and files nothing');
      }
    );
    sb.close();
  }

  /* ---- 15b. an inbound webhook that carries no body fetches one ---- */
  {
    const { sign } = require(ROOT + '/src/utils/webhookSignature');
    const SECRET = 'whsec_' + Buffer.from('body-fetch-secret').toString('base64');
    const sb = await mock.start({});

    const realFetch = global.fetch;
    const asked = [];
    global.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/emails/receiving/')) {
        asked.push(String(url));
        return new Response(JSON.stringify({ text: 'Can you quote the canal crossing?' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url, init);
    };

    await withApp(
      {
        SUPABASE_URL: `http://127.0.0.1:${sb.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY,
        RESEND_WEBHOOK_SECRET: SECRET, RESEND_API_KEY: 'test-key',
        MAILBOX_ADDRESS: 'contact@rockfield.test', FORWARD_TO: '',
      },
      async (base) => {
        // Shaped like a real Resend delivery: envelope only, no text or html.
        const body = JSON.stringify({
          type: 'email.received',
          data: {
            attachments: [], bcc: [], cc: [],
            email_id: '4a93e097-c85c-408f-89fd-67bc22511be5',
            from: 'ada@example.com',
            message_id: '<ada-2@example.com>',
            received_for: ['contact@rockfield.test'],
            subject: 'Canal crossing',
            to: ['contact@rockfield.test'],
          },
        });
        const id = 'msg_body', ts = String(Math.floor(Date.now() / 1000));
        const res = await fetch(base + '/api/inbound/resend', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'svix-id': id, 'svix-timestamp': ts, 'svix-signature': sign(SECRET, id, ts, body),
          },
          body,
        });
        assert.strictEqual(res.status, 200, await res.text());
        assert.strictEqual(asked.length, 1, 'the body was fetched by email_id');
        // Received mail lives under /emails/receiving; /emails/{id} is sent mail
        // and answers "Email not found" for an inbound id.
        assert.match(asked[0], /\/emails\/receiving\/4a93e097-c85c-408f-89fd-67bc22511be5\?/);
        const filed = sb.db.email_messages.rows[0];
        assert.strictEqual(filed.body_text, 'Can you quote the canal crossing?',
          'the fetched body is what reaches the dashboard');
        console.log('  ok  an envelope-only delivery fetches its body before filing');
      }
    );

    global.fetch = realFetch;
    sb.close();
  }

  /* ---- 16. replying to studio mail from the desk ---- */
  {
    const sb = await mock.start({});
    const sbUrl = `http://127.0.0.1:${sb.address().port}`;

    // Stand in for Resend so the suite never sends real mail.
    const realFetch = global.fetch;
    const sentMail = [];
    global.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.resend.com/')) {
        sentMail.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: 'resend-1' }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      return realFetch(url, init);
    };

    // A real signed-in session, the way the desk gets one.
    const signIn = async (email, password) => {
      await realFetch(`${sbUrl}/auth/v1/signup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: mock.ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const res = await realFetch(`${sbUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: mock.ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      return res.json();
    };

    const staff = await signIn('desk@rockfield.test', 'pw-desk');
    const outsider = await signIn('nosy@example.com', 'pw-nosy');
    sb.db.admins.rows.push({ user_id: staff.user.id, email: staff.user.email });

    const thread = {
      id: '11111111-2222-4333-8444-555555555555',
      created_at: new Date().toISOString(), last_message_at: new Date().toISOString(),
      subject: 'A 40m span', participant_email: 'ada@example.com', participant_name: 'Ada', status: 'new',
    };
    sb.db.email_threads.rows.push(thread);
    sb.db.email_messages.rows.push({
      id: 'aaaaaaaa-2222-4333-8444-555555555555', created_at: new Date().toISOString(),
      thread_id: thread.id, direction: 'inbound', from_email: 'ada@example.com',
      to_email: 'contact@rockfield.test', subject: 'A 40m span', message_id: '<ada-1@example.com>',
      has_attachments: false,
    });

    await withApp(
      {
        SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: mock.SERVICE_KEY, SUPABASE_ANON_KEY: mock.ANON_KEY,
        RESEND_API_KEY: 'test-key', MAILBOX_ADDRESS: 'contact@rockfield.test',
      },
      async (base) => {
        const reply = (token, payload) => fetch(base + '/api/emails/reply', {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' },
            token ? { Authorization: `Bearer ${token}` } : {}),
          body: JSON.stringify(payload),
        });

        const anon = await reply(null, { threadId: thread.id, body: 'hello' });
        assert.strictEqual(anon.status, 401, 'an unauthenticated caller cannot send mail as the studio');
        assert.strictEqual(sentMail.length, 0);
        console.log('  ok  replying without a session is refused');

        const nonAdmin = await reply(outsider.access_token, { threadId: thread.id, body: 'hello' });
        assert.strictEqual(nonAdmin.status, 403, 'a signed-in non-admin cannot send mail either');
        assert.strictEqual(sentMail.length, 0);
        console.log('  ok  a signed-in non-admin is refused');

        const empty = await reply(staff.access_token, { threadId: thread.id, body: '   ' });
        assert.strictEqual(empty.status, 422);
        console.log('  ok  an empty reply is rejected before sending');

        const missing = await reply(staff.access_token, { threadId: '99999999-2222-4333-8444-555555555555', body: 'hi' });
        assert.strictEqual(missing.status, 404);
        console.log('  ok  replying to a thread that does not exist is a 404');

        const ok = await reply(staff.access_token, { threadId: thread.id, body: 'Quoting next week.' });
        assert.strictEqual(ok.status, 201, JSON.stringify(await ok.json().catch(() => ({}))));
        assert.strictEqual(sentMail.length, 1);
        assert.deepStrictEqual(sentMail[0].to, ['ada@example.com']);
        assert.strictEqual(sentMail[0].subject, 'Re: A 40m span', 'one Re: prefix, not two');
        // Threading headers are what put the reply inside Ada's conversation.
        assert.strictEqual(sentMail[0].headers['In-Reply-To'], '<ada-1@example.com>');
        // A bare MAILBOX_ADDRESS would otherwise show in the recipient's inbox
        // as "contact", the local part, rather than as the studio.
        assert.strictEqual(sentMail[0].from, 'Rockfield National Bank <contact@rockfield.test>');
        // Written by a person, so no monospace HTML part goes with it.
        assert.strictEqual(sentMail[0].html, undefined);
        assert.strictEqual(sentMail[0].text, 'Quoting next week.');

        const outbound = sb.db.email_messages.rows.filter((r) => r.direction === 'outbound');
        assert.strictEqual(outbound.length, 1, 'the reply is recorded on the thread');
        assert.strictEqual(outbound[0].body_text, 'Quoting next week.');
        assert.strictEqual(outbound[0].message_id, 'resend-1');
        console.log('  ok  an admin reply sends, threads, and is filed as outbound');
      }
    );

    global.fetch = realFetch;
    sb.close();
  }

  console.log('\nserver suite passed');
  process.exit(0);
})().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
