'use strict';

/**
 * Runtime configuration and diagnostics.
 *
 * The browser is handed its Supabase URL and anon key per request rather than
 * having them baked in at build time. Nothing needs rebuilding when they
 * change, and no secret needs a public prefix to reach the client.
 */

const config = require('../utils/config');
const { getSupabase } = require('../utils/supabase');
const security = require('../bank/security');

/**
 * `GET /api/health?probe=1` asks Postgres for one row of every column the
 * server actually reads or writes. It costs one cheap query per table and
 * catches the failure that is otherwise invisible until a visitor tries to use
 * the site: tables created from an older copy of the migration, so a column the
 * code needs is missing and every insert is rejected.
 */
const PROBES = [
  { table: 'enquiries', columns: 'id,created_at,name,email,company,service,message,ip,status' },
  { table: 'site_settings', columns: 'id,updated_at,address,email,phone,hours', optional: true },
  { table: 'applications', columns: 'id,created_at,name,email,phone,role_id,role_title,portfolio,experience,message,ip,status' },
  { table: 'chat_sessions', columns: 'id,created_at,visitor_id,last_message_at,status,handled_by_agent' },
  { table: 'chat_messages', columns: 'id,created_at,session_id,sender,body' },
  { table: 'admins', columns: 'user_id,email' },
  // From 0002_email.sql. A site not receiving mail never needs these, but once
  // MAILBOX_ADDRESS is set they carry the admin inbox, so their absence is a
  // fault rather than a choice: filing is best effort, so the webhook still
  // answers 200 and Resend still reports success while nothing reaches /admin.
  {
    table: 'email_threads',
    columns: 'id,participant_email,subject,last_message_at,status',
    migration: '0002_email.sql',
    neededWhen: () => Boolean(config.mailboxAddress()),
  },
  {
    table: 'email_messages',
    columns: 'id,thread_id,direction,from_email,to_email,message_id',
    migration: '0002_email.sql',
    neededWhen: () => Boolean(config.mailboxAddress()),
  },
  // From 0003_bank.sql. These were missing from this list entirely, which is
  // how a bank that could not write a single row still reported a healthy
  // schema: the probe was only ever asked about the website's tables.
  ...[
    ['bank_users', 'id,created_at,email,password_hash,role,status,failed_logins,locked_until,last_login_at,must_change_password'],
    ['bank_accounts', 'id,created_at,user_id,type,account_number,routing_number,balance,hold_amount,available_balance,status'],
    ['bank_transactions', 'id,created_at,date,user_id,account_id,direction,amount,status,balance_after,reference'],
    ['bank_transfers', 'id,created_at,user_id,type,method,amount,status,trace_number'],
    ['bank_beneficiaries', 'id,created_at,user_id,name,account_number,routing_number,status'],
    ['bank_cards', 'id,created_at,user_id,account_id,last4,status,daily_purchase_limit,daily_atm_limit'],
    ['bank_payees', 'id,created_at,user_id,name,account_number,amount,due_day'],
    ['bank_deposits', 'id,created_at,user_id,account_id,amount,status'],
    ['bank_documents', 'id,created_at,user_id,kind,filename,mime,data'],
    ['bank_activity', 'id,created_at,user_id,actor_email,action,category,severity'],
    ['bank_alerts', 'id,created_at,user_id,type,subject,status'],
    ['bank_messages', 'id,created_at,thread_id,user_id,from_side,subject,body'],
    ['bank_disputes', 'id,created_at,user_id,transaction_id,amount,status'],
    ['bank_sessions', 'id,created_at,user_id,token_hash,csrf,expires_at'],
    ['bank_otps', 'id,created_at,user_id,purpose,code_hash,expires_at'],
    ['bank_settings', 'id,values,updated_at'],
  ].map(([table, columns]) => ({ table, columns, migration: '0003_bank.sql' })),
  // Probed separately so the answer names the file that actually adds these,
  // rather than sending somebody back to 0003 where they are not.
  { table: 'bank_alerts', key: 'bank_alerts.sms', columns: 'id,sms_status,sms_error', migration: '0004_bank_sms.sql' },
];

async function probeSchema() {
  const supabase = getSupabase();
  if (!supabase) return null;

  const results = {};
  const problems = [];
  for (const { table, columns, migration, neededWhen, key } of PROBES) {
    const needed = neededWhen ? neededWhen() : true;
    // A table can be probed twice - once for the columns one migration adds
    // and once for another's - so the answers are keyed separately. Keyed on
    // the table alone, the second probe would quietly overwrite the first.
    const label = key || table;
    try {
      await supabase.select(table, `select=${columns}&limit=1`);
      results[label] = 'ok';
    } catch (err) {
      results[label] = needed ? err.message : `optional: ${err.message}`;
      if (needed) problems.push({ table: label, message: err.message, migration: migration || '0001_init.sql' });
    }
  }
  return { results, problems };
}

/** GET /api/public-config: what the browser needs to talk to Supabase. */
exports.publicConfig = (req, res) => {
  const url = config.supabaseUrl();
  const anonKey = config.supabaseAnonKey();

  // Short cache: this changes rarely, but a stale key should not outlive a
  // rotation for long.
  // Which of the two is absent, and the names this server would have accepted
  // for it. Names only, never values, so the page can say what is wrong
  // instead of a bare "not connected" that leaves you guessing.
  const missing = [];
  if (!url) missing.push({ value: 'supabaseUrl', accepts: config.ACCEPTED_NAMES.supabaseUrl });
  if (!anonKey) missing.push({ value: 'supabaseAnonKey', accepts: config.ACCEPTED_NAMES.supabaseAnonKey });

  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    // The widget degrades to the server-side chat when this is false.
    chatEnabled: Boolean(url && anonKey),
    missing,
  });
};

/**
 * GET /api/health: which variables the running server can actually see.
 * Values are never returned, only whether they are set, plus warnings for
 * combinations that are configured but wrong.
 */
/** How many accounts the bank has, or null if it cannot say. */
/** The contact details the console has saved, so an operator can see them. */
async function storedContact() {
  try {
    const settings = await require('../bank/settings').get();
    return {
      bankName: settings.bankName || '',
      supportEmail: settings.supportEmail || '',
      supportPhone: settings.supportPhone || '',
      mailingAddress: settings.mailingAddress || '',
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function countUsers() {
  try {
    return await require('../bank/db').db.users.count();
  } catch (err) {
    return null;
  }
}

/**
 * Whether the bank's tables are actually there.
 *
 * Asked directly rather than inferred from a count, because the storage layer
 * deliberately falls back to the filesystem when a table is missing - so a
 * bank with no tables at all reports zero accounts rather than an error, and
 * then quietly writes to a container that a serverless host throws away. The
 * bank appears to work, and forgets everything between visits.
 *
 * Returns null when Supabase is not configured at all, which is a different
 * thing and not a fault: running on files is the documented local default.
 */
/**
 * The administrators the bank would actually accept, masked.
 *
 * "Invalid credentials" is the same answer for a wrong password, a wrong
 * address, and an account that was never created - which is correct at the
 * sign-in page and useless when you are trying to work out why your own
 * variables do not work. This says which address is on record and whether it
 * is the one in the environment, without saying what the password is: the
 * local part is masked, and no hash goes anywhere near this response.
 */
async function administrators() {
  const wanted = String(process.env.BANK_ADMIN_EMAIL || '').trim().toLowerCase();
  try {
    const rows = await require('../bank/db').db.users.find({ role: 'admin' });
    return rows.map((u) => ({
      email: security.maskEmail(u.email),
      matchesEnv: Boolean(wanted) && String(u.email || '').toLowerCase() === wanted,
      status: u.status,
      hasSignedIn: Boolean(u.last_login_at),
      lockedUntil: u.locked_until || null,
    }));
  } catch (err) {
    return null;
  }
}

async function bankTablesReadable() {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    await supabase.select('bank_users', 'select=id&limit=1');
    return true;
  } catch (err) {
    return false;
  }
}

exports.health = async (req, res) => {
  const url = config.supabaseUrl();
  const anon = config.supabaseAnonKey();
  const service = config.supabaseServiceKey();
  const resend = config.resendApiKey();
  const webhook = config.resendWebhookSecret();
  const to = config.formTo();
  const mailbox = config.mailboxAddress();
  const forward = config.forwardTo();

  const warnings = [];

  if (url && !service) {
    warnings.push(
      'SUPABASE_URL is set but SUPABASE_SERVICE_ROLE_KEY is not. Enquiries cannot be written; the server falls back to local files, which do not persist on Vercel.'
    );
  }
  if (url && service && !anon) {
    warnings.push(
      `No browser key is set, so /admin reports the backend as not connected and the chat widget falls back to the server-side responder. Set one of: ${config.ACCEPTED_NAMES.supabaseAnonKey.join(', ')}.`
    );
  }
  if (!url && (anon || service)) {
    warnings.push(
      `A Supabase key is set but no project URL. Set one of: ${config.ACCEPTED_NAMES.supabaseUrl.join(', ')}.`
    );
  }
  if (resend && !to) {
    warnings.push('RESEND_API_KEY is set but FORM_TO is not, so notifications have nowhere to go.');
  }
  if (to && !resend) {
    warnings.push('FORM_TO is set but RESEND_API_KEY is not, so no email is sent.');
  }
  if (mailbox && !webhook) {
    warnings.push(
      'MAILBOX_ADDRESS is set but RESEND_WEBHOOK_SECRET is not. The inbound endpoint refuses every request rather than trusting unsigned posts.'
    );
  }
  // Notifications addressed into our own inbound mailbox. The provider says
  // delivered and the desk shows it arrive, so both ends look healthy; the
  // only thing missing is the inbox, which is where somebody is looking.
  const looped = config.formToOnInboundDomain();
  if (looped.length) {
    warnings.push(
      `FORM_TO (${looped.join(', ')}) is on the same domain as MAILBOX_ADDRESS. `
      + 'If that domain\'s MX records point at the mail provider\'s inbound service, which is what MAILBOX_ADDRESS is for, '
      + 'then notifications sent there come straight back into this application and are filed on the message desk at /admin. '
      + (config.forwardTo()
        ? 'FORWARD_TO then copies them to a real inbox, so this is survivable - but the address is still a round trip.'
        : 'FORWARD_TO is not set, so they go no further and never reach a mailbox anybody opens. '
          + 'Point FORM_TO at a mailbox on another domain, or set FORWARD_TO to one.')
    );
  }
  // The bank's own bootstrap. Whether the administrator's credentials come
  // from the environment is the single most common thing to get wrong on a
  // deployment, and it is invisible from the sign-in page, which says only
  // that the details do not match.
  const adminEmail = String(process.env.BANK_ADMIN_EMAIL || '').trim();
  const adminPassword = process.env.BANK_ADMIN_PASSWORD || '';
  if (adminEmail && !adminPassword) {
    warnings.push('BANK_ADMIN_EMAIL is set but BANK_ADMIN_PASSWORD is not, so the administrator keeps the built-in password.');
  }
  if (adminPassword && !adminEmail) {
    warnings.push('BANK_ADMIN_PASSWORD is set but BANK_ADMIN_EMAIL is not, so it is not applied to any account.');
  }
  const demoEmail = String(process.env.BANK_DEMO_EMAIL || '').trim().toLowerCase();
  if (adminEmail && demoEmail && adminEmail.toLowerCase() === demoEmail) {
    warnings.push(
      'BANK_ADMIN_EMAIL and BANK_DEMO_EMAIL are the same address. They are two different accounts with two different roles and one unique email column, so the demonstration customer is given the built-in address instead. Set BANK_DEMO_EMAIL to a different address, or remove it.'
    );
  }
  if (!process.env.BANK_ENCRYPTION_KEY) {
    warnings.push('BANK_ENCRYPTION_KEY is not set, so Social Security and card numbers are encrypted with a development key. Set a 32-byte key before anyone real uses this.');
  }
  const admins = await administrators();
  if (adminEmail && admins && admins.length && !admins.some((a) => a.matchesEnv)) {
    warnings.push(
      `BANK_ADMIN_EMAIL is set, but the administrator on record is a different address (${admins.map((a) => a.email).join(', ')}). The bank was seeded before the variable existed, and the account has been signed into since, so it is left alone deliberately. Set BANK_ADMIN_RESET=1 and redeploy to move it.`
    );
  }
  if (admins && admins.some((a) => a.lockedUntil && a.lockedUntil > new Date().toISOString())) {
    warnings.push('An administrator account is locked after too many failed sign-ins. It unlocks on its own; the lock expiry is in bank.administrators.');
  }
  if (config.forwardWouldLoop()) {
    warnings.push(
      "FORWARD_TO is one of this site's own addresses. Forwarding would loop mail back into the inbound webhook until the sending quota is gone. Set it to a mailbox on another domain, or leave it unset."
    );
  }

  // Opt-in: create the bank, and say what happened.
  //
  // The bank builds itself on the first request that needs data, which is
  // normally the sign-in page. That is fine until it is not: if it never runs,
  // or runs and fails, the only symptom is a sign-in page that rejects every
  // password - truthfully, because there are no accounts behind it - and the
  // reason is in a function log on a host somebody has to go and find.
  //
  // `?seed=1` does it here instead, and returns the error rather than logging
  // it. Safe to leave reachable: it only acts on a bank with no accounts at
  // all, so it can do nothing that loading /signin would not already do, and
  // once there is a single customer it is a read like the rest of this
  // endpoint.
  const bankTables = await bankTablesReadable();
  if (bankTables === false) {
    warnings.push(
      'Supabase is connected but the bank\'s tables are missing, so the bank is writing to the container filesystem - which a serverless host discards between requests. It will appear to work and forget everything. Run supabase/migrations/0003_bank.sql.'
    );
  }

  const seed = require('../bank/seed');
  const state = bankTables === false ? { users: null, state: 'no tables' } : await seed.seedState();

  if (state.state === 'incomplete') {
    warnings.push(
      `The bank has ${state.users} account(s) and no completed seed, which means seeding stopped part way and left an administrator with no customers, accounts or history. Open /api/health?seed=reset to clear it and build the bank properly.`
    );
  }

  let seedRun;
  if (req.query.seed) {
    const wantsReset = String(req.query.seed).toLowerCase() === 'reset';
    const startedAt = Date.now();

    const build = async (cleared) => {
      const result = await seed.ensureSeed();
      const admin = await seed.reconcileAdmin();
      return {
        ran: true, ok: true, tookMs: Date.now() - startedAt, cleared,
        users: await countUsers(), seeded: Boolean(result.seeded), admin: admin.reason || null,
        demoEmailIgnored: result.demoEmailIgnored || undefined,
        note: 'Sign in at /signin with BANK_ADMIN_EMAIL and BANK_ADMIN_PASSWORD.',
      };
    };

    try {
      if (bankTables === false) {
        seedRun = { ran: false, reason: 'the bank tables are missing; run supabase/migrations/0003_bank.sql' };
      } else if (state.state === 'unreadable') {
        seedRun = { ran: false, reason: 'the bank tables are not readable; run supabase/migrations/0003_bank.sql' };
      } else if (wantsReset) {
        // Only ever clears a seed that never finished. A bank carrying the
        // completion marker has been built once and may since have had real
        // customers registered against it, so this refuses rather than
        // guessing - there is no undo for the other answer.
        if (state.state === 'complete' || state.state === 'unmarked') {
          seedRun = {
            ran: false,
            reason: `refusing to reset: this bank has ${state.users} account(s) and looks properly built. Reset only clears a seed that never finished.`,
            users: state.users,
          };
        } else {
          seedRun = await build(await seed.resetBank());
        }
      } else if (state.state === 'empty') {
        seedRun = await build(null);
      } else if (state.state === 'incomplete') {
        seedRun = {
          ran: false,
          users: state.users,
          reason: `seeding stopped part way: ${state.users} account(s) and no completed seed. Open /api/health?seed=reset to clear the half-built bank and do it again.`,
        };
      } else {
        seedRun = { ran: false, reason: `the bank is already built, with ${state.users} account(s)`, users: state.users };
      }
    } catch (err) {
      seedRun = { ran: true, ok: false, tookMs: Date.now() - startedAt, error: err.message };
      warnings.push(`Seeding the bank failed: ${err.message}`);
    }
  }

  /*
   * Opt-in: ask the mail provider what it actually holds.
   *
   * Every other check here reads the environment, which tells you a variable
   * is set and nothing about whether mail can leave the building. The two
   * questions that matter are not visible from inside this process at all:
   * is the domain we send as verified for sending, and is the domain we
   * receive on verified for receiving. Resend will answer both in one
   * request, and a domain verified for one and not the other looks, from
   * every other angle, exactly like a working setup.
   */
  let mail;
  if (req.query.mail) {
    const notify = require('../utils/notify');
    const listed = await notify.domains();
    const domainOf = (value) => {
      const address = config.parseAddress(value).email;
      const at = address.lastIndexOf('@');
      return at === -1 ? '' : address.slice(at + 1);
    };
    const sendingAs = domainOf(config.formFrom());
    const alertingAs = domainOf(process.env.BANK_ALERT_FROM || config.formFrom());
    const receivingOn = domainOf(config.mailboxAddress());

    mail = { ...listed, sendingAs, alertingAs, receivingOn };

    if (!listed.ok) {
      warnings.push(`Resend would not list this account's domains: ${listed.error}. Check RESEND_API_KEY.`);
    } else {
      const find = (name) => listed.domains.find((d) => d.name === name);
      /*
       * Resend reports a capability as the string "enabled" or "disabled".
       * This read it as a boolean, so `=== false` was never true and the one
       * check worth having - is this domain able to receive - stayed silent
       * on a domain that plainly could not. Accept both shapes, and treat
       * anything else as unknown rather than as working: a check that cannot
       * tell should say so, not wave things through.
       */
      const can = (value) => {
        if (value === true || value === 'enabled') return true;
        if (value === false || value === 'disabled') return false;
        return undefined;
      };
      const UNVERIFIED = ['not_started', 'pending', 'failure', 'temporary_failure'];

      [['FORM_FROM', sendingAs], ['BANK_ALERT_FROM', alertingAs]].forEach(([label, domain]) => {
        if (!domain) return;
        const row = find(domain);
        if (!row) {
          warnings.push(
            `${label} sends as ${domain}, which is not a domain on this Resend account `
            + `(it holds ${listed.domains.map((d) => d.name).join(', ') || 'none'}). Every send will be refused.`
          );
          return;
        }
        const sending = can(row.sending);
        if (sending === false || UNVERIFIED.includes(row.status)) {
          warnings.push(
            `${label} sends as ${domain}, which Resend reports as "${row.status}"`
            + `${sending === false ? ' with sending disabled' : ''}. Sends from it will be refused.`
          );
        }
      });

      if (receivingOn) {
        const row = find(receivingOn);
        if (!row) {
          warnings.push(
            `MAILBOX_ADDRESS receives on ${receivingOn}, which is not a domain on this Resend account. `
            + 'Nothing will ever reach the inbound webhook.'
          );
        } else if (can(row.receiving) === false) {
          const alternative = listed.domains
            .filter((d) => can(d.receiving) === true)
            .map((d) => d.name);
          warnings.push(
            `MAILBOX_ADDRESS receives on ${receivingOn}, which Resend reports as "${row.status}" for the domain but `
            + 'with receiving disabled. Mail sent to that address has nowhere to land. Turn receiving on for the '
            + 'domain in Resend and add the MX record it gives you - the sending records, SPF and DKIM, do not cover '
            + `receiving.${alternative.length ? ` Receiving is on for ${alternative.join(', ')}.` : ''}`
          );
        } else if (UNVERIFIED.includes(row.status)) {
          warnings.push(
            `MAILBOX_ADDRESS receives on ${receivingOn}, which Resend reports as "${row.status}". `
            + 'Until it verifies, mail sent there has nowhere to land.'
          );
        }
      }
    }
  }

  // Opt-in: the plain health check stays a pure environment read.
  let schema;
  if (req.query.probe) {
    const probed = await probeSchema();
    schema = probed ? probed.results : null;
    (probed ? probed.problems : []).forEach(({ table, message, migration }) => {
      warnings.push(
        `Table ${table} did not answer as expected: ${message}. Run supabase/migrations/${migration} in the Supabase SQL Editor.`
      );
    });
  }

  /*
   * Which code is answering.
   *
   * Without this the only way to tell a deployment apart from the one before
   * it is to notice a key that is missing, which means knowing in advance
   * which key to look for. Several rounds of "that should be fixed" have gone
   * past on a deployment that had not picked the fix up, and nothing in this
   * response said so.
   *
   * `version` comes from package.json, which travels with the code and is
   * readable at runtime. `commit` comes from the host when it offers one -
   * Vercel only populates VERCEL_GIT_COMMIT_SHA when the project has an
   * ignored build step configured, so it is a bonus rather than the answer.
   */
  const commit = config.pick('VERCEL_GIT_COMMIT_SHA', 'GIT_COMMIT_SHA', 'SOURCE_VERSION', 'RENDER_GIT_COMMIT');

  // A health check read through a cache is worse than none: it answers for a
  // deployment that may no longer exist.
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.json({
    status: warnings.length ? 'degraded' : 'ok',
    service: 'rockfield-national-bank',
    version: require('../../package.json').version,
    commit: commit ? commit.slice(0, 7) : undefined,
    branch: config.pick('VERCEL_GIT_COMMIT_REF') || undefined,
    time: new Date().toISOString(),
    config: {
      supabaseUrl: Boolean(url),
      supabaseAnonKey: Boolean(anon),
      supabaseServiceRoleKey: Boolean(service),
      resendApiKey: Boolean(resend),
      resendWebhookSecret: Boolean(webhook),
      formTo: Boolean(to),
      formFrom: Boolean(config.formFrom()),
      mailboxAddress: Boolean(mailbox),
      forwardTo: Boolean(forward),
    },
    storage: url && service ? 'supabase' : 'filesystem',
    // Enough to tell a locked-out operator what the bank thinks its sign-in
    // is, without saying what it is: the address is reported only as set or
    // not, and no password or hash goes anywhere near this response.
    bank: {
      adminEmailFromEnv: Boolean(adminEmail),
      adminPasswordFromEnv: Boolean(adminPassword),
      adminPasswordResetRequested: /^(1|true|yes|on)$/i.test(String(process.env.BANK_ADMIN_RESET || '')),
      encryptionKeySet: Boolean(process.env.BANK_ENCRYPTION_KEY),
      users: await countUsers(),
      // false means Supabase is connected but 0003_bank.sql has not been run,
      // and the bank has silently fallen back to ephemeral local files.
      tables: bankTables === null ? 'not using supabase' : bankTables,
      administrators: await administrators(),
      // What the console has actually saved, as opposed to what the code
      // ships as a default. A settings row written before a domain move keeps
      // the old address, and because it then differs from the new default it
      // is read as a deliberate choice and wins - so a public page can go on
      // printing an address nobody reads long after the code changed. There
      // is no way to see that from the outside, which is why it is here.
      settings: await storedContact(),
      // 'empty', 'incomplete', 'complete', or 'unmarked' for a bank seeded
      // before the completion marker existed. Read again after a ?seed run, so
      // the answer describes the bank as it is now rather than as it was when
      // this request started.
      seedState: seedRun && seedRun.ran ? (await seed.seedState()).state : state.state,
      // What this particular server process has seen. On a serverless host
      // each request may land on a different instance, so `attempted: false`
      // means "not in the process answering you", not "never anywhere" -
      // `users` is the one that speaks for the whole deployment. Add ?seed=1
      // to create the bank here and now and see what happens.
      seed: { ...require('../bank/seed').seedStatus(), thisProcessOnly: true },
      seedRun,
    },
    schema: req.query.probe ? schema || 'supabase not configured' : undefined,
    mail,
    warnings,
  });
};
