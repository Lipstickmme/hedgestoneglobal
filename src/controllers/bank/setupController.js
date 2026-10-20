'use strict';

/**
 * GET /api/bank/admin/setup - the staff console's setup checklist.
 *
 * Every piece of the backend the bank depends on, each answered as done, to
 * do, or optional, with the exact fix in words an operator can follow without
 * opening the code. It reads the same signals as /api/health, but where that
 * is a diagnostic for whoever deploys the bank, this is a to-do list for
 * whoever runs it.
 *
 * Names of variables only, never values.
 */

const config = require('../../utils/config');
const system = require('../systemController');
const markets = require('../../bank/markets');
const { db } = require('../../bank/db');
const { asyncHandler } = require('../../bank/http');
const migrationsSql = require('../../data/migrations.json');

const MIGRATIONS = [
  { file: '0001_init.sql', what: 'Website enquiries, applications, live chat and the /admin desk' },
  { file: '0002_email.sql', what: 'The inbound mailbox in /admin' },
  { file: '0003_bank.sql', what: 'Customers, cash balances, the ledger, withdrawals and everything else on the platform' },
  { file: '0004_bank_sms.sql', what: 'Text-message delivery status on alerts' },
  { file: '0005_bank_invest.sql', what: 'Bitcoin: holdings, purchases and stored prices' },
  { file: '0006_bank_backposting.sql', what: 'Staff booking, re-timing and reversing purchases' },
  { file: '0007_invest_term.sql', what: 'A term and maturity date on every Bitcoin purchase' },
  { file: '0008_vault.sql', what: 'Requests to receive Bitcoin into the vault and send it out' },
];

/** The Supabase project the server is connected to, from its URL: "abcd1234". */
function projectOf(url) {
  try {
    const host = new URL(url).hostname;
    return { host, ref: /\.supabase\.(co|in)$/i.test(host) ? host.split('.')[0] : '' };
  } catch (err) {
    return { host: '', ref: '' };
  }
}

/** One probe's failure, in words: which table or column is missing, or why it could not be read. */
function explain(probe, message) {
  const m = String(message || '');
  const column = m.match(/column\s+"?(?:[\w]+\.)?([\w]+)"?\s+does not exist/i) || m.match(/Could not find the '([\w]+)' column/i);
  if (/PGRST205|42P01|Could not find the table|relation .* does not exist/i.test(m)) return `the ${probe.table} table is not there`;
  if (column) return `${probe.table} has no ${column[1]} column`;
  if (/42501|permission denied|JWT|401|403/i.test(m)) return `${probe.table} cannot be read with the server key (check SUPABASE_SERVICE_ROLE_KEY is the service_role key)`;
  return `${probe.table}: ${m.slice(0, 160)}`;
}

const setup = asyncHandler(async (req, res) => {
  const supabase = Boolean(config.supabaseUrl() && config.supabaseServiceKey());
  const items = [];
  const add = (group, id, title, status, detail, fix) => items.push({ group, id, title, status, detail, fix: fix || '' });

  /* ---- database ---- */
  add('Database', 'supabase', 'Supabase connected', supabase ? 'done' : 'todo',
    supabase ? 'Every record is stored in Supabase.' : 'The platform is running on temporary files. On Vercel they are lost between requests, so customers, balances and chats will not stay saved.',
    'Create a Supabase project, then in Vercel set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Project Settings, API) and redeploy. Connecting Supabase from Vercel\'s Storage tab sets them for you.');

  const project = projectOf(config.supabaseUrl());
  if (supabase) {
    add('Database', 'project', 'The Supabase project this site uses', 'done',
      project.ref
        ? `Project ${project.ref} (${project.host}). Run every SQL step in this project: its id is in the address bar of the Supabase dashboard. SQL run in another project changes nothing here.`
        : `The database at ${project.host || 'the configured address'}.`);
  }

  let probe = null;
  let probeError = '';
  if (supabase) {
    try { probe = await system.probeSchema(); } catch (err) { probe = null; probeError = err.message; }
  }
  const missing = [];
  MIGRATIONS.forEach((m) => {
    if (!supabase) {
      add('Database', m.file, `Tables: ${m.file}`, 'blocked', m.what, 'Connect Supabase first.');
      return;
    }
    const mine = system.PROBES.filter((p) => (p.migration || '0001_init.sql') === m.file);
    const failing = mine.filter((p) => {
      const label = p.key || p.table;
      const answer = probe && probe.results ? probe.results[label] : (probeError || 'not checked');
      return answer !== 'ok' && !String(answer).startsWith('optional');
    }).map((p) => explain(p, probe && probe.results ? probe.results[p.key || p.table] : probeError));
    if (failing.length) missing.push(m.file);
    add('Database', m.file, `Tables: ${m.file}`, failing.length ? 'todo' : 'done',
      failing.length ? `${m.what}. Not in this database yet: ${failing.join('; ')}.` : m.what,
      'Copy the SQL from "Run this in Supabase" at the top of this page, run it in the SQL Editor of the project named above, then press Check again.');
  });

  // Exactly what this database lacks, in order, ending with the schema reload.
  // Every migration is guarded, so running one that half-applied is safe.
  let sql = null;
  if (missing.length) {
    const text = [
      `-- ${missing.join(', ')}`,
      '-- Runs as one transaction: if Supabase shows an error, nothing below was saved.',
      '',
      ...missing.map((file) => `${migrationsSql.files[file] || `-- ${file} is not in this build`}\n`),
      migrationsSql.reload,
      '',
    ].join('\n');
    sql = {
      files: missing,
      text,
      editorUrl: project.ref ? `https://supabase.com/dashboard/project/${project.ref}/sql/new` : 'https://supabase.com/dashboard',
      project: project.ref || project.host,
    };
  }

  add('Database', 'anon', 'Browser key for live chat and /admin', config.supabaseAnonKey() ? 'done' : (supabase ? 'todo' : 'blocked'),
    config.supabaseAnonKey() ? 'Visitors can chat, and staff can sign in to the /admin desk.' : 'Without it the chat widget falls back to the server and the /admin desk reports "not connected".',
    'In Vercel set SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) to the anon/publishable key from Supabase, Project Settings, API. Also turn on Authentication, Providers, Anonymous in Supabase.');

  /* ---- security ---- */
  const key = process.env.BANK_ENCRYPTION_KEY || '';
  add('Security', 'encryption', 'Encryption key for personal data', key.length >= 32 ? 'done' : 'todo',
    key ? (key.length >= 32 ? 'SSNs and ID numbers are encrypted under your own key.' : 'The key is shorter than 32 characters.') : 'Running on the built-in development key. Never take real customers this way.',
    'Generate one with: openssl rand -hex 32. Set it in Vercel as BANK_ENCRYPTION_KEY before the first real customer, and never change it afterwards.');

  add('Security', 'admin', 'Staff console sign-in set by you', process.env.BANK_ADMIN_EMAIL && process.env.BANK_ADMIN_PASSWORD ? 'done' : 'todo',
    process.env.BANK_ADMIN_EMAIL ? 'The administrator comes from BANK_ADMIN_EMAIL.' : 'The administrator is still the built-in demonstration login.',
    'Set BANK_ADMIN_EMAIL and BANK_ADMIN_PASSWORD in Vercel and redeploy. The administrator moves to them on the next start.');

  const devCodes = config.showDevCodes();
  add('Security', 'devcodes', 'Sign-in codes kept private', devCodes ? 'todo' : 'done',
    devCodes ? 'One-time codes are being shown on screen, and the sign-in page offers the demonstration logins. Anyone can sign in.' : 'Codes go only to the customer.',
    'Set RESEND_API_KEY so codes are emailed, and remove BANK_SHOW_DEV_CODES.');

  /* ---- email ---- */
  const resend = Boolean(config.resendApiKey());
  add('Email', 'resend', 'Email sending (Resend)', resend ? 'done' : 'todo',
    resend ? `Sending as ${config.formFrom()}.` : 'No email goes out: no sign-in codes, alerts or enquiry notifications.',
    'Create an API key at resend.com, verify hedgestonesfinance.com there (add its DNS records), then set RESEND_API_KEY, FORM_FROM and BANK_ALERT_FROM in Vercel.');
  add('Email', 'formto', 'Where enquiries and chats are announced', config.formTo() ? 'done' : 'todo',
    config.formTo() ? `Notifications go to ${config.formTo()}.` : 'New enquiries and chats are stored but nobody is told.',
    'Set FORM_TO in Vercel to an inbox you read.');
  const inbound = Boolean(config.resendWebhookSecret() && config.mailboxAddress());
  add('Email', 'inbound', 'Receiving mail in /admin', inbound ? 'done' : 'optional',
    inbound ? `Mail to ${config.mailboxAddress()} arrives in the desk.` : 'Optional. Lets the /admin desk show mail sent to your domain.',
    'In Resend turn on receiving for the domain and add a webhook to https://<your-domain>/api/inbound/resend. Set RESEND_WEBHOOK_SECRET (whsec_...) and MAILBOX_ADDRESS in Vercel.');

  /* ---- site ---- */
  const base = process.env.PUBLIC_BASE_URL || process.env.BANK_BASE_URL || process.env.APP_URL;
  add('Site', 'baseurl', 'Your web address in emails', base ? 'done' : 'todo',
    base ? `Links in emails point at ${config.baseUrl()}.` : `Links in emails point at ${config.baseUrl()}, which may be a temporary Vercel address.`,
    'Set PUBLIC_BASE_URL to https://hedgestonesfinance.com in Vercel (plain text, not Sensitive).');

  /* ---- prices ---- */
  let priced = [];
  try { priced = (await markets.list()).filter((a) => a.quote && !a.quote.stale); } catch (err) { priced = []; }
  const sources = Array.from(new Set(priced.map((a) => a.quote.source)));
  const fixture = /^(1|true|yes|on)$/i.test(String(process.env.MARKET_DATA_FIXTURE || ''));
  add('Bitcoin', 'prices', 'Live Bitcoin price', fixture ? 'todo' : priced.length ? 'done' : 'todo',
    fixture ? 'Showing fixed demonstration prices (MARKET_DATA_FIXTURE is set).'
      : priced.length ? `Bitcoin is priced live, from ${sources.join(', ')}.`
        : 'No live Bitcoin price could be fetched. The ticker is hidden and nobody can buy or sell.',
    fixture ? 'Remove MARKET_DATA_FIXTURE from Vercel and redeploy.' : 'The price comes from CoinGecko, then Coinbase, then Yahoo Finance. If none answers, check the deployment can reach the internet, and try again in a minute.');
  let charted = null;
  try { charted = await markets.history('BTC', 365); } catch (err) { charted = null; }
  add('Bitcoin', 'history', 'Price history for the dashboard chart', charted && charted.points.length ? 'done' : 'todo',
    charted && charted.points.length ? `${charted.points.length} days of Bitcoin prices, from ${charted.source}.` : 'No price history could be fetched, so the dashboard shows the purchase and today\'s value without the line between them.',
    'The history comes from CoinGecko, then Yahoo Finance, then Coinbase. It is retried every page view; nothing needs setting.');

  /* ---- people ---- */
  let customers = 0;
  try { customers = (await db.users.find({ role: 'customer' })).length; } catch (err) { customers = 0; }
  const demo = await db.users.findOne({ email: (process.env.BANK_DEMO_EMAIL || 'demo@hedgestonesfinance.com').toLowerCase() }).catch(() => null);
  add('Going live', 'demo', 'Demonstration customer removed', demo ? 'optional' : 'done',
    demo ? `The seeded demonstration customer (${demo.email}) is still here with sample balances.` : 'No demonstration customer.',
    'Before taking real customers, close the demonstration customer from Customers, or keep it for training.');

  const counts = items.reduce((acc, i) => { acc[i.status] = (acc[i.status] || 0) + 1; return acc; }, {});
  res.set('Cache-Control', 'no-store');
  res.json({ items, counts, customers, sql, project: project.ref || project.host || '', storage: supabase ? 'supabase' : 'filesystem', checkedAt: new Date().toISOString() });
});

module.exports = { setup };
