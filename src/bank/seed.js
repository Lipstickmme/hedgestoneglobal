'use strict';

/**
 * First-run data.
 *
 * A banking dashboard with no history is impossible to judge, so a fresh
 * install comes up with an administrator, two customers and roughly six months
 * of plausible activity: payroll on the 15th and the last working day, rent on
 * the 1st, a card that gets used at the same handful of places, a savings
 * sweep, a credit card that gets paid off most months.
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

/* A small deterministic PRNG, so two installs of the same build look alike. */
function rng(seed = 20260912) {
  let s = seed >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const MERCHANTS = {
  Groceries: ['Harrow Market', 'Northside Grocers', 'Field & Vine', 'Belmont Foods'],
  Dining: ['Cafe Torrent', 'The Quarry Room', 'Ninth Street Diner', 'Mori Ramen', 'Basalt Coffee'],
  Transport: ['Metro Transit', 'Ridehail Inc', 'City Parking Authority'],
  Fuel: ['Granite Fuel', 'Trailhead Gas'],
  Travel: ['Continental Air', 'Harborview Hotel'],
  Utilities: ['Columbus Power & Light', 'Clearwater Utilities', 'Fibernet Broadband'],
  Shopping: ['Meridian Supply Co', 'Ashgate Hardware', 'Lantern Books'],
  Entertainment: ['Palace Cinema', 'Rockfield Arena'],
  Subscriptions: ['Streamline Media', 'Cloudline Storage', 'Ledger App Pro'],
  Healthcare: ['Brookfield Dental', 'Riverside Pharmacy'],
  Insurance: ['Sentinel Mutual'],
  Education: ['Ohio State Bursar'],
};

const CATEGORY_WEIGHTS = [
  ['Groceries', 0.22, 3200, 14500],
  ['Dining', 0.2, 900, 7800],
  ['Transport', 0.1, 250, 3400],
  ['Fuel', 0.08, 3200, 8900],
  ['Shopping', 0.12, 1500, 22000],
  ['Entertainment', 0.07, 1200, 9500],
  ['Subscriptions', 0.08, 599, 2499],
  ['Healthcare', 0.05, 1500, 18000],
  ['Utilities', 0.05, 4500, 19500],
  ['Travel', 0.03, 12000, 68000],
];

function pick(list, r) {
  return list[Math.floor(r() * list.length) % list.length];
}

function weightedCategory(r) {
  const roll = r();
  let acc = 0;
  for (const row of CATEGORY_WEIGHTS) {
    acc += row[1];
    if (roll <= acc) return row;
  }
  return CATEGORY_WEIGHTS[0];
}

function amountBetween(r, min, max) {
  return Math.round(min + r() * (max - min));
}

function isWeekend(date) {
  const d = date.getUTCDay();
  return d === 0 || d === 6;
}

/**
 * True when this date is the working day a semi-monthly payroll actually lands
 * on: the 15th and the last day of the month, pulled back to the Friday before
 * when they fall on a weekend.
 */
function isPayday(date, lastDay) {
  if (isWeekend(date)) return false;
  const day = date.getUTCDate();
  for (const nominal of [15, lastDay]) {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), nominal));
    while (isWeekend(target)) target.setUTCDate(target.getUTCDate() - 1);
    if (target.getUTCDate() === day) return true;
  }
  return false;
}

/**
 * Build one customer's six months of history and post it in date order.
 * Returns the entries posted, so the caller can log how much was created.
 */
async function generateHistory({ user, checking, savings, card, cardAccountId, monthlyIncome, seed }) {
  const r = rng(seed);
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  const entries = [];

  const cursor = new Date(start);
  while (cursor <= today) {
    const day = cursor.getUTCDate();
    const iso = new Date(cursor).toISOString();

    // Payroll: the 15th and the last day of the month, moved back to the
    // preceding business day when either lands on a weekend - which is what a
    // real payroll file does, and skipping those months instead would quietly
    // halve the customer's income.
    const lastDay = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0)).getUTCDate();
    if (isPayday(cursor, lastDay)) {
      entries.push({
        accountId: checking.id,
        direction: 'credit',
        amount: Math.round(monthlyIncome / 2) + amountBetween(r, -4000, 6000),
        description: 'MERIDIAN LOGISTICS PAYROLL DIRECT DEP',
        merchant: 'Meridian Logistics',
        category: 'Income',
        method: 'direct_deposit',
        date: iso,
        counterparty: { name: 'Meridian Logistics Inc', bank: 'First Coast Bank', account_masked: '••••4417', type: 'ach' },
        traceNumber: ids.achTrace(BANK.routingNumber),
      });
    }

    // Rent on the 1st.
    if (day === 1) {
      entries.push({
        accountId: checking.id,
        direction: 'debit',
        amount: 178500,
        description: 'HARROW STREET RESIDENCES RENT',
        merchant: 'Harrow Street Residences',
        category: 'Rent & Mortgage',
        method: 'bill_pay',
        date: iso,
      });
    }

    // Utilities mid-month.
    if (day === 12) {
      entries.push({
        accountId: checking.id,
        direction: 'debit',
        amount: amountBetween(r, 8400, 17600),
        description: 'COLUMBUS POWER & LIGHT AUTOPAY',
        merchant: 'Columbus Power & Light',
        category: 'Utilities',
        method: 'ach',
        date: iso,
      });
    }

    // Savings sweep the day after payday.
    if (day === 16) {
      const amount = amountBetween(r, 25000, 60000);
      entries.push({
        accountId: checking.id,
        direction: 'debit',
        amount,
        description: `Transfer to Savings ${ids.maskAccount(savings.account_number)}`,
        category: 'Transfers',
        method: 'internal',
        date: iso,
      });
      entries.push({
        accountId: savings.id,
        direction: 'credit',
        amount,
        description: `Transfer from Checking ${ids.maskAccount(checking.account_number)}`,
        category: 'Transfers',
        method: 'internal',
        date: iso,
      });
    }

    // Monthly interest on savings.
    if (day === lastDay) {
      entries.push({
        accountId: savings.id,
        direction: 'credit',
        amount: amountBetween(r, 900, 4200),
        description: 'INTEREST PAID',
        category: 'Income',
        method: 'interest',
        date: iso,
      });
    }

    // Card payment on the 20th: out of checking and against the card balance.
    if (day === 20 && cardAccountId) {
      const amount = amountBetween(r, 18000, 52000);
      const label = card ? `••••${card.last4}` : '';
      entries.push({
        accountId: checking.id,
        direction: 'debit',
        amount,
        description: `ROCKFIELD CARD PAYMENT ${label}`.trim(),
        category: 'Transfers',
        method: 'internal',
        date: iso,
      });
      entries.push({
        accountId: cardAccountId,
        direction: 'credit',
        amount,
        description: 'PAYMENT THANK YOU - ONLINE',
        category: 'Transfers',
        method: 'internal',
        date: iso,
      });
    }

    // Day-to-day card spending.
    const purchases = isWeekend(cursor) ? (r() < 0.7 ? 2 : 1) : (r() < 0.5 ? 1 : r() < 0.85 ? 2 : 3);
    for (let i = 0; i < purchases; i += 1) {
      const [category, , min, max] = weightedCategory(r);
      const merchant = pick(MERCHANTS[category] || ['Rockfield Merchant'], r);
      // Roughly a third of card spending sits on the credit card, so both the
      // debit and the credit product have a history worth looking at.
      const onCard = Boolean(cardAccountId) && r() < 0.35;
      entries.push({
        accountId: onCard ? cardAccountId : checking.id,
        direction: 'debit',
        amount: amountBetween(r, min, max),
        description: `${merchant.toUpperCase()} ${['COLUMBUS OH', 'DUBLIN OH', 'WESTERVILLE OH'][Math.floor(r() * 3) % 3]}`,
        merchant,
        category,
        method: 'card',
        date: new Date(cursor.getTime() + Math.floor(r() * 36000000)).toISOString(),
        location: 'Columbus, OH',
      });
    }

    // The occasional ATM withdrawal.
    if (r() < 0.06) {
      entries.push({
        accountId: checking.id,
        direction: 'debit',
        amount: amountBetween(r, 4000, 20000) - (amountBetween(r, 4000, 20000) % 2000),
        description: 'ATM WITHDRAWAL - 45 HIGH ST COLUMBUS OH',
        category: 'Cash & ATM',
        method: 'atm',
        date: iso,
      });
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  // One bulk write per account rather than two round trips per entry. See
  // ledger.postMany: this is the difference between the bank seeding itself in
  // a couple of seconds and being killed by a serverless timeout part way
  // through, which leaves a sign-in page with no accounts behind it.
  await ledger.postMany(entries.map((entry) => ({ ...entry, status: 'posted', createdBy: 'system' })));
  return entries;
}

/** A couple of entries still in flight, so pending states are visible. */
async function addPending(checking, card) {
  await ledger.post({
    accountId: checking.id,
    direction: 'debit',
    amount: 6742,
    description: 'BASALT COFFEE COLUMBUS OH',
    merchant: 'Basalt Coffee',
    category: 'Dining',
    method: 'card',
    status: 'pending',
    createdBy: 'system',
  });
  if (card) {
    await ledger.post({
      accountId: card.id,
      direction: 'debit',
      amount: 12999,
      description: 'CLOUDLINE STORAGE ANNUAL',
      merchant: 'Cloudline Storage',
      category: 'Subscriptions',
      method: 'card',
      status: 'pending',
      createdBy: 'system',
    });
  }
}

async function seedBeneficiaries(user) {
  const rows = [
    {
      nickname: 'Mum', name: 'Eleanor Vance', bank_name: 'First Coast Bank',
      account_number: '4410028866', routing_number: ids.completeRouting('06100022'),
      account_type: 'checking', type: 'domestic_ach', relationship: 'Family',
    },
    {
      nickname: 'Landlord', name: 'Harrow Street Residences LLC', bank_name: 'Union Trust',
      account_number: '9930114725', routing_number: ids.completeRouting('04400011'),
      account_type: 'checking', type: 'domestic_ach', relationship: 'Housing',
    },
    {
      nickname: 'Sam (Berlin)', name: 'Samira Okonkwo', bank_name: 'Nordbank AG',
      account_number: 'DE89370400440532013000', routing_number: '', swift: 'NORDDEFFXXX',
      account_type: 'checking', type: 'international_wire', country: 'Germany', relationship: 'Friend',
      bank_address: 'Kurfurstendamm 21, 10719 Berlin, Germany',
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

async function seedPayees(user) {
  const rows = [
    { name: 'Columbus Power & Light', category: 'Utilities', account_number: '7741-88213', autopay: true, amount: 12400, due_day: 12 },
    { name: 'Fibernet Broadband', category: 'Utilities', account_number: 'FB-559210', autopay: true, amount: 8999, due_day: 8 },
    { name: 'Sentinel Mutual Auto', category: 'Insurance', account_number: 'SM-4471902', autopay: false, amount: 15600, due_day: 22 },
  ];
  for (const row of rows) {
    await db.payees.insert({
      id: ids.uuid(),
      created_at: nowIso(),
      user_id: user.id,
      status: 'active',
      phone: '',
      address: '',
      last_paid_at: null,
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
    author_name: 'Rockfield Client Services',
    subject: 'Welcome to Rockfield',
    body: 'Your online banking is live. Set a transfer PIN under Security before your first payment, and add the people you pay regularly as beneficiaries - transfers to a verified beneficiary clear without a second review.',
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

  const adminEmail = process.env.BANK_ADMIN_EMAIL || 'admin@rockfieldglobalfinance.com';
  const adminPassword = process.env.BANK_ADMIN_PASSWORD || 'Rockfield#Admin2026';
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
  const DEFAULT_DEMO_EMAIL = 'demo@rockfieldglobalfinance.com';
  const requestedDemoEmail = process.env.BANK_DEMO_EMAIL || DEFAULT_DEMO_EMAIL;
  const demoClashesWithAdmin = requestedDemoEmail.trim().toLowerCase() === adminEmail.trim().toLowerCase();
  if (demoClashesWithAdmin) {
    console.warn(
      `[rockfield] BANK_DEMO_EMAIL is the same address as BANK_ADMIN_EMAIL. They must be different accounts, so the demonstration customer is on ${DEFAULT_DEMO_EMAIL} instead.`
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

  // The relationship starts six months ago, so the seeded history has somewhere
  // to sit and the first statement is not also the account's first day.
  const relationshipStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 5, 1)).toISOString();

  const checking = await accountsLib.openAccount(customer, {
    productId: 'everyday_checking', type: 'checking', isPrimary: true, nickname: 'Everyday',
    createdBy: 'system', openedAt: relationshipStart,
  });
  const savings = await accountsLib.openAccount(customer, {
    productId: 'high_yield_savings', type: 'savings', nickname: 'Rainy day', openingBalance: 1284000,
    openingDescription: 'Opening balance', createdBy: 'system', openedAt: relationshipStart,
    openingDate: relationshipStart,
  });
  const cardAccount = await accountsLib.openAccount(customer, {
    productId: 'rockfield_signature_card', type: 'credit', nickname: 'Signature card', creditLimit: 1500000,
    createdBy: 'system', openedAt: relationshipStart,
  });

  // Seed the opening balance on checking first so the running balance never
  // goes negative across six months of spending.
  await ledger.post({
    accountId: checking.id,
    direction: 'credit',
    amount: 640000,
    description: 'Opening deposit',
    method: 'adjustment',
    category: 'Income',
    status: 'posted',
    createdBy: 'system',
    date: relationshipStart,
  });

  const debitCard = await accountsLib.issueCard(customer, checking, { brand: 'visa', kind: 'debit' });
  const creditCard = await accountsLib.issueCard(customer, cardAccount, { brand: 'mastercard', kind: 'credit' });

  await generateHistory({
    user: customer,
    checking,
    savings,
    card: creditCard,
    cardAccountId: cardAccount.id,
    monthlyIncome: 780000,
    seed: 20260912,
  });
  await addPending(checking, cardAccount);
  await seedBeneficiaries(customer);
  await seedPayees(customer);
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
  const maraChecking = await accountsLib.openAccount(second, {
    productId: 'premier_checking', type: 'checking', isPrimary: true, openingBalance: 2450000,
    openingDescription: 'Opening deposit - cashier check', createdBy: 'system',
  });
  await accountsLib.issueCard(second, maraChecking, { brand: 'visa', kind: 'debit' });

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

  console.log(`[rockfield] seeded: admin ${adminEmail}, customer ${demoEmail}`);
  return {
    seeded: true,
    admin: { email: adminEmail, password: adminPassword },
    customer: { email: demoEmail, password: demoPassword },
    demoEmailIgnored: demoClashesWithAdmin ? requestedDemoEmail : null,
    secondary: { email: second.email, password: temporaryPassword },
    accounts: [checking.account_number, savings.account_number, cardAccount.account_number],
    cards: [debitCard.last4, creditCard.last4],
  };
}

/* ------------------------------------------------------- admin bootstrap --- */

/**
 * Bring the administrator's sign-in into line with the environment.
 *
 * ensureSeed() only runs while the bank has no users at all, which is right -
 * it writes six months of history and must never do that twice. But it means
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
    console.warn('[rockfield] BANK_ADMIN_EMAIL and BANK_ADMIN_PASSWORD must both be set; ignoring.');
    return { changed: false, reason: 'incomplete' };
  }

  const reset = /^(1|true|yes|on)$/i.test(String(process.env.BANK_ADMIN_RESET || ''));
  const existing = await users.findByEmail(email);

  if (existing) {
    if (existing.role !== 'admin') {
      console.warn(`[rockfield] BANK_ADMIN_EMAIL is a customer account; not changing it.`);
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
    console.log(`[rockfield] BANK_ADMIN_RESET: password reset for ${email}`);
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
    console.log(`[rockfield] administrator moved to ${email} from the environment`);
    return { changed: true, reason: 'adopted the seeded administrator' };
  }

  await users.createUser({
    email,
    password,
    role: 'admin',
    firstName: 'Bank',
    lastName: 'Administrator',
    status: 'active',
    emailVerified: true,
    mustChangePassword: false,
    kycStatus: 'verified',
    tier: 'Staff',
    twoFactorEnabled: false,
  });
  console.log(`[rockfield] administrator ${email} created from the environment`);
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
          console.warn('[rockfield] admin reconcile failed:', err.message);
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
        console.warn('[rockfield] seed failed:', err.message);
        return { seeded: false, error: err.message };
      });
  }
  return seeding;
}

module.exports = {
  ensureSeed, ensureSeedOnce, reconcileAdmin, seedStatus,
  seedComplete, seedState, resetBank,
  generateHistory, rng,
};
