'use strict';

/**
 * First-run data.
 *
 * A dashboard with no history is impossible to judge, so a fresh install
 * comes up with an administrator and two customers. The demonstration customer
 * has a cash balance, a withdrawal account, and three Bitcoin purchases made
 * over the last fourteen months - one that has already matured, one part way
 * through its term and one recent - each booked at the price Bitcoin actually
 * had on that day, so the chart and the growth figures on the dashboard are
 * the real market's.
 *
 * Everything is generated through the same ledger the live application uses,
 * so the seeded balances are the sum of the seeded entries rather than numbers
 * written on top of them. Idempotent: it does nothing if users already exist.
 */

const { db } = require('./db');
const ids = require('./ids');
const ledger = require('./ledger');
const users = require('./users');
const accountsLib = require('./accounts');
const security = require('./security');
const { BANK, DEFAULT_SETTINGS } = require('./constants');

const nowIso = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

/* A small deterministic PRNG, kept for anything that wants repeatable noise. */
function rng(seed = 20260912) {
  let s = seed >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The demonstration purchases: how long ago, how much, and for how long. */
const DEMO_PURCHASES = [
  { daysAgo: 425, amount: 250000, termMonths: 12 },
  { daysAgo: 270, amount: 600000, termMonths: 12 },
  { daysAgo: 95, amount: 300000, termMonths: 24 },
];

/**
 * Book the demonstration purchases at Bitcoin's closing price on each day.
 *
 * Without a price history (no network, no fixture) a backdated purchase would
 * have to be booked at a price nobody saw, so instead there is one purchase,
 * today, at the live price - or none, if there is no price at all. The seed
 * never invents a market.
 */
async function seedPurchases(customer, cash, admin) {
  const invest = require('./invest');
  const markets = require('./markets');
  let points = [];
  try {
    points = (await markets.history('BTC', 730)).points;
  } catch (err) {
    points = [];
  }
  const priceOn = (iso) => {
    const day = iso.slice(0, 10);
    const hit = points.filter((p) => p.t <= day).pop();
    return hit ? hit.p : null;
  };

  const booked = [];
  const plan = points.length ? DEMO_PURCHASES : [{ daysAgo: 0, amount: 300000, termMonths: 12 }];
  for (const step of plan) {
    const at = step.daysAgo ? daysAgo(step.daysAgo) : null;
    const price = at ? priceOn(at) : null;
    if (at && !price) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { trade } = await invest.convert(customer, {
        accountId: cash.id, symbol: 'BTC', amount: step.amount, termMonths: step.termMonths,
      }, null, at ? { staff: admin, price, at, silent: true, note: 'Demonstration purchase' } : { staff: admin, silent: true, note: 'Demonstration purchase' });
      booked.push(trade);
    } catch (err) {
      console.warn(`[hedgestone] demonstration purchase skipped: ${err.message}`);
    }
  }
  return booked;
}

async function seedBeneficiaries(user) {
  const rows = [
    {
      nickname: 'My bank', name: 'Jordan R Ellis', bank_name: 'First Coast Bank',
      account_number: '4410028866', routing_number: ids.completeRouting('06100022'),
      account_type: 'checking', type: 'domestic_ach', relationship: 'Own account',
    },
  ];
  for (const row of rows) {
    await db.beneficiaries.insert({
      id: ids.uuid(),
      created_at: nowIso(),
      user_id: user.id,
      status: 'verified',
      verified_at: nowIso(),
      last_used_at: null,
      country: 'United States',
      swift: '',
      bank_address: '',
      address: '',
      memo: '',
      ...row,
    });
  }
}

async function seedMessages(user) {
  const thread = ids.uuid();
  await db.messages.insert({
    id: ids.uuid(),
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    thread_id: thread,
    user_id: user.id,
    from_side: 'bank',
    author_name: `${BANK.name} support`,
    subject: `Welcome to ${BANK.name}`,
    body: 'Your account is live. Your dashboard shows your Bitcoin from the day you bought it, what it is worth now and how long each purchase has left to maturity. Set a withdrawal PIN under Security before your first withdrawal.',
    read_at: null,
    attachments: null,
  });
}

/* ------------------------------------------------------------------ run --- */

/**
 * The id of the row that records a finished seed.
 *
 * A marker rather than a head count, because "there are some users" and "the
 * bank was built" are not the same statement. A seed that dies part way -
 * a timeout, a missing column, a network blip - leaves an administrator and
 * nothing else, and a count-based guard reads that wreckage as success: the
 * bank then refuses to seed again, for ever, with no customer, no account and
 * no history. This row is only written once everything is in place.
 */
const SEED_MARKER = 'seed';

/** Whether a previous seed ran all the way to the end. */
async function seedComplete() {
  try {
    const row = await db.settings.findById(SEED_MARKER);
    return Boolean(row && row.values && row.values.completedAt);
  } catch (err) {
    return false;
  }
}

/** How far a bank that is not marked complete actually got. */
async function seedState() {
  const users = await db.users.count().catch(() => null);
  if (users === null) return { users: null, state: 'unreadable' };
  if (await seedComplete()) return { users, state: 'complete' };
  if (users === 0) return { users, state: 'empty' };
  // A finished seed leaves an administrator and two customers. Anything less
  // than that without a marker is a seed that stopped half way.
  return { users, state: users < 3 ? 'incomplete' : 'unmarked' };
}

/**
 * Empty every one of the bank's own collections.
 *
 * Only ever called to clear a seed that never finished, and the caller checks
 * that first. It touches nothing outside the bank - website enquiries, chat
 * and the email inbox are in their own tables and are left alone.
 */
async function resetBank() {
  const cleared = {};
  for (const name of Object.keys(db)) {
    const collection = db[name];
    if (!collection || typeof collection.removeWhere !== 'function') continue;
    // eslint-disable-next-line no-await-in-loop
    cleared[name] = await collection.removeWhere({});
  }
  return cleared;
}

async function ensureSeed(options = {}) {
  const existing = await db.users.count();
  if (existing > 0 && !options.force) return { seeded: false, users: existing };

  const adminEmail = process.env.BANK_ADMIN_EMAIL || 'admin@hedgestonesfinance.com';
  const adminPassword = process.env.BANK_ADMIN_PASSWORD || 'Hedgestone#Admin2026';
  const { user: admin } = await users.createUser({
    email: adminEmail,
    password: adminPassword,
    role: 'admin',
    firstName: 'Avery',
    lastName: 'Stone',
    phone: '(614) 555-0101',
    status: 'active',
    emailVerified: true,
    mustChangePassword: false,
    kycStatus: 'verified',
    tier: 'Staff',
    twoFactorEnabled: false,
    // The seeded staff member's own address, not the bank's - which is now
    // operator-supplied and blank until someone sets it.
    city: 'Columbus',
    state: 'OH',
    country: 'United States',
  });

  // The demonstration customer cannot share an address with the
  // administrator: they are two accounts with two roles, and one email column
  // is unique. Setting both variables to the same address is an easy mistake -
  // they sit next to each other in a deployment's settings and both read like
  // "the login" - and it used to kill the seed right here, after the
  // administrator had been created, leaving a bank that looked seeded, refused
  // to seed again, and had no customer, no account and no history.
  //
  // The administrator keeps the address that was asked for, because that is
  // the one somebody signs in with. The customer gets the built-in one, and
  // the clash is reported rather than silently worked around.
  const DEFAULT_DEMO_EMAIL = 'demo@hedgestonesfinance.com';
  const requestedDemoEmail = process.env.BANK_DEMO_EMAIL || DEFAULT_DEMO_EMAIL;
  const demoClashesWithAdmin = requestedDemoEmail.trim().toLowerCase() === adminEmail.trim().toLowerCase();
  if (demoClashesWithAdmin) {
    console.warn(
      `[hedgestone] BANK_DEMO_EMAIL is the same address as BANK_ADMIN_EMAIL. They must be different accounts, so the demonstration customer is on ${DEFAULT_DEMO_EMAIL} instead.`
    );
  }
  const demoEmail = demoClashesWithAdmin ? DEFAULT_DEMO_EMAIL : requestedDemoEmail;
  const demoPassword = process.env.BANK_DEMO_PASSWORD || 'Bedrock#Demo2026';
  const { user: customer } = await users.createUser({
    email: demoEmail,
    password: demoPassword,
    role: 'customer',
    firstName: 'Jordan',
    middleName: 'R',
    lastName: 'Ellis',
    dateOfBirth: '1989-04-17',
    ssn: '412889021',
    phone: '(614) 555-0184',
    mobile: '(614) 555-0184',
    addressLine1: '148 Harrow Street',
    addressLine2: 'Apt 12B',
    city: 'Columbus',
    state: 'OH',
    postalCode: '43215',
    employmentStatus: 'Employed',
    employer: 'Meridian Logistics',
    occupation: 'Operations Manager',
    annualIncome: 9800000,
    sourceOfFunds: 'Salary',
    idType: 'Driver’s license',
    idNumber: 'OH-TR447120',
    idState: 'OH',
    idExpires: '2029-04-17',
    kycStatus: 'verified',
    emailVerified: true,
    mustChangePassword: false,
    twoFactorEnabled: true,
    transferPin: '4417',
    securityQuestion: 'What was the name of your first pet?',
    securityAnswer: 'pepper',
    tier: 'Premier',
    relationshipManager: 'Avery Stone',
    openedBy: admin.id,
  });

  // The relationship starts fifteen months ago, before the first purchase.
  const relationshipStart = daysAgo(450);

  const cash = await accountsLib.openAccount(customer, {
    productId: 'investment_cash', isPrimary: true,
    createdBy: 'system', openedAt: relationshipStart,
  });
  // Money in first, so every purchase has a balance to come out of.
  for (const [days, amount, description] of [
    [450, 300000, 'Opening deposit'],
    [280, 650000, 'Deposit received'],
    [100, 450000, 'Deposit received'],
  ]) {
    await ledger.post({
      accountId: cash.id,
      direction: 'credit',
      amount,
      description,
      method: 'adjustment',
      category: 'Deposits',
      status: 'posted',
      createdBy: 'system',
      date: daysAgo(days),
    });
  }

  await seedPurchases(customer, cash, admin);
  await seedBeneficiaries(customer);
  await seedMessages(customer);

  // A second customer, so the console has more than one row to show.
  const { user: second, temporaryPassword } = await users.createUser({
    email: 'mara.velez@example.com',
    role: 'customer',
    firstName: 'Mara',
    lastName: 'Velez',
    dateOfBirth: '1994-11-02',
    ssn: '556210447',
    phone: '(614) 555-0199',
    addressLine1: '2210 Ridgeway Ave',
    city: 'Dublin',
    state: 'OH',
    postalCode: '43017',
    employmentStatus: 'Self-employed',
    occupation: 'Architect',
    annualIncome: 11200000,
    kycStatus: 'pending',
    tier: 'Standard',
    openedBy: admin.id,
  });
  const maraCash = await accountsLib.openAccount(second, {
    productId: 'investment_cash', isPrimary: true, openingBalance: 2450000,
    openingDescription: 'Opening deposit', createdBy: 'system',
  });

  await db.settings.insert({
    id: 'global',
    values: { ...DEFAULT_SETTINGS },
    updated_at: nowIso(),
  });

  await require('./audit').log({
    action: 'system.seeded',
    category: 'admin',
    actor: { id: admin.id, email: admin.email, role: 'admin' },
    detail: 'Initial data created',
    severity: 'notice',
  });

  // The last thing, on purpose: if anything above threw, this never runs and
  // the bank is honestly reported as half built rather than quietly broken.
  await db.settings.insert({
    id: SEED_MARKER,
    values: { completedAt: nowIso(), users: await db.users.count() },
    updated_at: nowIso(),
  });

  console.log(`[hedgestone] seeded: admin ${adminEmail}, customer ${demoEmail}`);
  return {
    seeded: true,
    admin: { email: adminEmail, password: adminPassword },
    customer: { email: demoEmail, password: demoPassword },
    demoEmailIgnored: demoClashesWithAdmin ? requestedDemoEmail : null,
    secondary: { email: second.email, password: temporaryPassword },
    accounts: [cash.account_number, maraCash.account_number],
  };
}

/* ------------------------------------------------------- admin bootstrap --- */

/**
 * Bring the administrator's sign-in into line with the environment.
 *
 * ensureSeed() only runs while the platform has no users at all, which is
 * right - it writes over a year of history and must never do that twice. But it means
 * BANK_ADMIN_EMAIL and BANK_ADMIN_PASSWORD only ever take effect if they were
 * set before the very first request. Set them afterwards, as anybody actually
 * deploying will, and the administrator keeps whatever the defaults were and
 * the new credentials do not work. That is a locked-out operator with no way
 * back in short of emptying the database.
 *
 * So this runs on every boot, and reconciles:
 *
 *   - no account on that address, and the account we seeded has never been
 *     signed into: move it to the address and password from the environment.
 *     This is the "I set the variables after the first deploy" case.
 *   - no account, and no untouched seeded administrator either: create one.
 *   - the account exists: leave the password alone. Somebody is using it and
 *     may have changed it deliberately. BANK_ADMIN_RESET=1 overrides that for
 *     the case where it has been forgotten.
 *
 * Never touches a customer, and never weakens an account that is in use.
 */
async function reconcileAdmin() {
  const email = String(process.env.BANK_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.BANK_ADMIN_PASSWORD || '';
  if (!email && !password) return { changed: false, reason: 'not configured' };
  if (!email || !password) {
    console.warn('[hedgestone] BANK_ADMIN_EMAIL and BANK_ADMIN_PASSWORD must both be set; ignoring.');
    return { changed: false, reason: 'incomplete' };
  }

  const reset = /^(1|true|yes|on)$/i.test(String(process.env.BANK_ADMIN_RESET || ''));
  const existing = await users.findByEmail(email);

  if (existing) {
    if (existing.role !== 'admin') {
      console.warn(`[hedgestone] BANK_ADMIN_EMAIL is a customer account; not changing it.`);
      return { changed: false, reason: 'not an administrator' };
    }
    if (!reset) return { changed: false, reason: 'already exists' };
    await db.users.update(existing.id, {
      password_hash: await security.hashSecret(password),
      status: 'active',
      failed_logins: 0,
      locked_until: null,
      must_change_password: false,
      updated_at: nowIso(),
    });
    console.log(`[hedgestone] BANK_ADMIN_RESET: password reset for ${email}`);
    return { changed: true, reason: 'password reset' };
  }

  // Nobody on that address. Move the seeded administrator over, but only if
  // it has never been used - once somebody has signed in, that account is
  // theirs and renaming it out from under them would be its own outage.
  const admins = await db.users.find({ role: 'admin' });
  const untouched = admins.find((a) => !a.last_login_at);
  if (untouched) {
    await db.users.update(untouched.id, {
      email,
      password_hash: await security.hashSecret(password),
      status: 'active',
      failed_logins: 0,
      locked_until: null,
      must_change_password: false,
      updated_at: nowIso(),
    });
    console.log(`[hedgestone] administrator moved to ${email} from the environment`);
    return { changed: true, reason: 'adopted the seeded administrator' };
  }

  await users.createUser({
    email,
    password,
    role: 'admin',
    firstName: 'Platform',
    lastName: 'Administrator',
    status: 'active',
    emailVerified: true,
    mustChangePassword: false,
    kycStatus: 'verified',
    tier: 'Staff',
    twoFactorEnabled: false,
  });
  console.log(`[hedgestone] administrator ${email} created from the environment`);
  return { changed: true, reason: 'created' };
}

/**
 * Seed once per process, on the first request that needs data. Several
 * requests arriving together share the same promise rather than racing to
 * create two administrators.
 */
let seeding = null;

/**
 * What happened the last time seeding was attempted in this process.
 *
 * Reported by /api/health. A seed that fails is otherwise completely silent
 * from outside: the sign-in page just says the details do not match, because
 * from its point of view they genuinely do not - there are no accounts. On a
 * serverless host the log line is somewhere else entirely, behind a different
 * login, which is exactly when somebody needs it most.
 */
let lastSeed = { attempted: false };

/** The last seed attempt, for diagnostics. Never includes a credential. */
function seedStatus() {
  return lastSeed;
}

function ensureSeedOnce() {
  if (!seeding) {
    const startedAt = Date.now();
    seeding = ensureSeed()
      .then(async (result) => {
        // After seeding, not instead of it: a first boot with the variables
        // already set seeds with them and this finds nothing to do.
        let admin;
        try {
          admin = await reconcileAdmin();
        } catch (err) {
          console.warn('[hedgestone] admin reconcile failed:', err.message);
          admin = { changed: false, error: err.message };
        }
        lastSeed = {
          attempted: true, ok: true, tookMs: Date.now() - startedAt,
          seeded: Boolean(result.seeded), users: result.users, admin: admin.reason || null,
        };
        return { ...result, admin };
      })
      .catch((err) => {
        seeding = null;
        lastSeed = { attempted: true, ok: false, tookMs: Date.now() - startedAt, error: err.message };
        console.warn('[hedgestone] seed failed:', err.message);
        return { seeded: false, error: err.message };
      });
  }
  return seeding;
}

module.exports = {
  ensureSeed, ensureSeedOnce, reconcileAdmin, seedStatus,
  seedComplete, seedState, resetBank,
  seedPurchases, rng,
};
