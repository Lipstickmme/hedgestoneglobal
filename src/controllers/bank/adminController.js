'use strict';

/**
 * The staff console.
 *
 * This is where a customer is registered, where an account is opened, where a
 * balance is adjusted and where a held transfer is released or returned.
 * Everything here writes an activity row naming the member of staff who did
 * it, because the difference between a bank and a spreadsheet is that a bank
 * can say who moved the money.
 */

const { db } = require('../../bank/db');
const ids = require('../../bank/ids');
const ledger = require('../../bank/ledger');
const usersLib = require('../../bank/users');
const accountsLib = require('../../bank/accounts');
const transfersLib = require('../../bank/transfers');
const security = require('../../bank/security');
const settingsLib = require('../../bank/settings');
const contact = require('../../bank/contact');
const alerts = require('../../bank/alerts');
const audit = require('../../bank/audit');
const { baseUrl } = require('../../utils/config');
const profile = require('./profileController');
const accountsController = require('./accountsController');
const money_ = require('./moneyController');
const { asyncHandler, fail, toCents, trimmed, money, page, csv } = require('../../bank/http');
const {
  BANK, PRODUCTS, ACCOUNT_TYPES, CATEGORIES, TRANSACTION_METHODS,
  US_STATES, SECURITY_QUESTIONS, DOCUMENT_KINDS, REJECTION_REASONS, ALERT_TYPES,
} = require('../../bank/constants');

const nowIso = () => new Date().toISOString();

/** The member of staff performing the action, in the shape audit.log wants. */
const actorOf = (req) => ({ id: req.bankUser.id, email: req.bankUser.email, role: 'admin' });

async function customerOr404(id) {
  const user = await db.users.findById(id);
  if (!user) throw fail(404, 'Customer not found.');
  return user;
}

/* ------------------------------------------------------------- overview --- */

const overview = asyncHandler(async (req, res) => {
  const [allUsers, accounts, transfers, activity, alertRows, messages] = await Promise.all([
    db.users.find({}, { order: 'created_at.desc' }),
    db.accounts.find({}),
    db.transfers.find({}, { order: 'created_at.desc', limit: 200 }),
    db.activity.find({}, { order: 'created_at.desc', limit: 15 }),
    db.alerts.find({}, { order: 'created_at.desc', limit: 100 }),
    db.messages.find({ from_side: 'customer' }, { order: 'created_at.desc', limit: 50 }),
  ]);

  const customers = allUsers.filter((u) => u.role === 'customer');
  const deposit = accounts.filter((a) => (ACCOUNT_TYPES[a.type] || {}).sign !== -1);
  const since = new Date(Date.now() - 30 * 86400000).toISOString();

  const pendingTransfers = transfers.filter((t) => ['pending_review', 'pending_verification', 'processing'].includes(t.status));

  res.json({
    stats: {
      customers: customers.length,
      newCustomers30d: customers.filter((u) => u.created_at >= since).length,
      pendingKyc: customers.filter((u) => u.kyc_status === 'pending').length,
      suspended: customers.filter((u) => u.status === 'suspended').length,
      accounts: accounts.length,
      deposits: deposit.reduce((s, a) => s + Number(a.balance || 0), 0),
      pendingTransfers: pendingTransfers.length,
      pendingTransferValue: pendingTransfers.reduce((s, t) => s + Number(t.total || 0), 0),
      unansweredMessages: messages.length,
      alertsSent30d: alertRows.filter((a) => a.created_at >= since).length,
      alertsFailed: alertRows.filter((a) => a.status === 'failed').length,
    },
    queue: pendingTransfers.slice(0, 8).map(transfersLib.publicTransfer),
    activity: activity.map(publicActivity),
    recentCustomers: customers.slice(0, 6).map((u) => usersLib.publicUser(u, 'summary')),
  });
});

const publicActivity = (row) => ({
  id: row.id,
  createdAt: row.created_at,
  userId: row.user_id,
  actorEmail: row.actor_email,
  actorRole: row.actor_role,
  action: row.action,
  category: row.category,
  detail: row.detail,
  severity: row.severity,
  ip: row.ip,
  device: row.device,
  channel: row.channel,
  meta: row.meta,
});

/* ------------------------------------------------------------ customers --- */

const listCustomers = asyncHandler(async (req, res) => {
  const { limit, offset } = page(req.query);
  const q = String(req.query.q || '').trim().toLowerCase();
  const rows = await db.users.find({}, { order: 'created_at.desc' });
  const accounts = await db.accounts.find({});

  const filtered = rows.filter((u) => {
    if (req.query.role && u.role !== req.query.role) return false;
    if (req.query.status && u.status !== req.query.status) return false;
    if (req.query.kyc && u.kyc_status !== req.query.kyc) return false;
    if (!q) return true;
    return [u.email, u.first_name, u.last_name, u.customer_number, u.phone, u.ssn_last4]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  const balances = new Map();
  accounts.forEach((a) => {
    const sign = (ACCOUNT_TYPES[a.type] || {}).sign === -1 ? -1 : 1;
    balances.set(a.user_id, (balances.get(a.user_id) || 0) + sign * Number(a.balance || 0));
  });

  res.json({
    customers: filtered.slice(offset, offset + limit).map((u) => ({
      ...usersLib.publicUser(u, 'admin'),
      totalBalance: balances.get(u.id) || 0,
      accountCount: accounts.filter((a) => a.user_id === u.id).length,
    })),
    total: filtered.length,
    limit,
    offset,
  });
});

/** Everything about one customer, for the profile screen. */
const customerDetail = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  const [accounts, transfers, documents, activity, sessions, beneficiaries, alertRows] = await Promise.all([
    db.accounts.find({ user_id: user.id }, { order: 'created_at.asc' }),
    db.transfers.find({ user_id: user.id }, { order: 'created_at.desc', limit: 25 }),
    db.documents.find({ user_id: user.id }, { order: 'created_at.desc' }),
    db.activity.find({ user_id: user.id }, { order: 'created_at.desc', limit: 60 }),
    db.sessions.find({ user_id: user.id, revoked_at: null }, { order: 'last_seen_at.desc' }),
    db.beneficiaries.find({ user_id: user.id }),
    db.alerts.find({ user_id: user.id }, { order: 'created_at.desc', limit: 25 }),
  ]);
  const transactions = await db.transactions.find({ user_id: user.id }, { order: 'date.desc', limit: 60 });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  res.json({
    customer: usersLib.publicUser(user, 'admin'),
    accounts: accounts.map(accountsLib.publicAccount),
    transfers: transfers.map(transfersLib.publicTransfer),
    transactions: transactions.map((t) => accountsController.publicTransaction(t, byId.get(t.account_id))),
    documents: documents.map(profile.publicDocument),
    activity: activity.map(publicActivity),
    sessions: sessions.map((s) => ({ id: s.id, device: s.device, ip: s.ip, lastSeenAt: s.last_seen_at, createdAt: s.created_at })),
    beneficiaries: beneficiaries.map(money_.publicBeneficiary),
    alerts: alertRows.map((a) => ({ id: a.id, subject: a.subject, type: a.type, status: a.status, createdAt: a.created_at, readAt: a.read_at })),
  });
});

/**
 * Register a customer.
 *
 * One call does the whole opening: the person, their identity file, their
 * cash balance and the money they start with. Splitting it across several
 * requests would only invite half-made customers.
 */
const createCustomer = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const email = trimmed(body.email, 200).toLowerCase();
  if (!email) throw fail(400, 'An email address is required.');
  if (!trimmed(body.firstName, 80) || !trimmed(body.lastName, 80)) throw fail(400, 'Enter the customer’s first and last name.');

  const ssn = String(body.ssn || '').replace(/\D/g, '');
  if (ssn && ssn.length !== 9) throw fail(400, 'A Social Security number has nine digits.');

  const cfg = await settingsLib.get();
  if (body.password) {
    const problems = security.passwordProblems(body.password, { minLength: cfg.passwordMinLength });
    if (problems.length) throw fail(400, `That password is too weak: ${problems.join(', ').toLowerCase()}.`);
  }

  const { user, temporaryPassword } = await usersLib.createUser({
    ...body,
    email,
    ssn,
    role: body.role === 'admin' ? 'admin' : 'customer',
    openedBy: req.bankUser.id,
    mustChangePassword: body.mustChangePassword !== false,
    annualIncome: body.annualIncome ? toCents(body.annualIncome) : 0,
    alertThreshold: body.alertThreshold ? toCents(body.alertThreshold) : undefined,
  });

  // Identity documents and a photo, when the console sent them.
  const documents = [];
  for (const kind of ['avatar', 'id_front', 'id_back', 'proof_address', 'ssn_card']) {
    if (!body[kind]) continue;
    const doc = await profile.storeDocument({
      user, kind, filename: `${kind}.jpg`, dataUrl: body[kind],
      uploadedBy: 'admin', uploadedById: req.bankUser.id,
    });
    documents.push(doc);
    if (kind === 'avatar') {
      await db.users.update(user.id, { photo_url: `/api/bank/documents/${doc.id}/file`, photo_document_id: doc.id });
    }
  }

  // The cash balance. Older console forms sent a list of accounts; every
  // entry opens a cash balance now, so their opening amounts still land.
  const requested = Array.isArray(body.accounts) && body.accounts.length
    ? body.accounts
    : [{ openingBalance: body.openingBalance, nickname: body.nickname }];

  const opened = [];
  for (const [index, spec] of requested.entries()) {
    const account = await accountsLib.openAccount(user, {
      productId: 'investment_cash',
      nickname: trimmed(spec.nickname, 40),
      openingBalance: spec.openingBalance ? toCents(spec.openingBalance) : 0,
      openingDescription: trimmed(spec.openingDescription, 120) || 'Opening deposit',
      openingMethod: spec.openingMethod || 'adjustment',
      isPrimary: index === 0,
      createdBy: 'admin',
      createdById: req.bankUser.id,
    });
    opened.push(account);
  }

  await audit.log({
    action: 'admin.customer_created', category: 'admin', userId: user.id, req, severity: 'notice',
    actor: actorOf(req),
    detail: `Registered ${usersLib.fullName(user)} (${email}) with ${opened.length} account(s)`,
    meta: { accounts: opened.map((a) => a.account_number) },
  });

  // The welcome email carries the temporary password when we generated one.
  const fresh = await db.users.findById(user.id);
  await alerts.notifyUser(fresh, 'account_opened', {
    force: true,
    subject: `Welcome to ${cfg.bankName || BANK.name}`,
    heading: `Welcome to ${cfg.bankName || BANK.name}`,
    intro: `Your account is ready, ${user.first_name}. Sign in to buy Bitcoin and follow your investment.`,
    rows: [
      { label: 'Customer number', value: user.customer_number },
      { label: 'Username', value: user.email },
      ...(temporaryPassword ? [{ label: 'Temporary password', value: temporaryPassword }] : []),
      ...opened.map((a) => ({
        label: `${a.name} ${ids.maskAccount(a.account_number)}`,
        value: money(a.balance),
      })),
    ],
    body: temporaryPassword
      ? 'Sign in with the temporary password above. You will be asked to choose your own the first time.'
      : 'Sign in with the password you chose with us today.',
    cta: { label: 'Sign in', href: `${baseUrl()}/signin` },
  });

  res.status(201).json({
    customer: usersLib.publicUser(fresh, 'admin'),
    accounts: opened.map(accountsLib.publicAccount),
    documents: documents.map(profile.publicDocument),
    temporaryPassword: temporaryPassword || null,
  });
});

const updateCustomer = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  const patch = usersLib.patchFromBody(req.body);

  // The sensitive fields the customer cannot change themselves.
  if (req.body.ssn) {
    const ssn = String(req.body.ssn).replace(/\D/g, '');
    if (ssn.length !== 9) throw fail(400, 'A Social Security number has nine digits.');
    patch.ssn_encrypted = security.encrypt(ssn);
    patch.ssn_last4 = ssn.slice(-4);
  }
  if (req.body.annualIncome !== undefined) patch.annual_income = toCents(req.body.annualIncome) || 0;
  if (req.body.twoFactorEnabled !== undefined) patch.two_factor_enabled = Boolean(req.body.twoFactorEnabled);
  if (!Object.keys(patch).length) throw fail(400, 'Nothing to change.');
  patch.updated_at = nowIso();

  await db.users.update(user.id, patch);
  const after = await db.users.findById(user.id);
  const changed = Object.keys(patch).filter((k) => k !== 'updated_at' && !k.startsWith('ssn_'));
  if (patch.ssn_encrypted) changed.push('ssn');

  await audit.log({
    action: 'admin.customer_updated', category: 'admin', userId: user.id, req,
    actor: actorOf(req),
    detail: `Updated ${changed.join(', ')} on ${usersLib.fullName(after)}`,
    meta: { fields: changed },
  });
  await alerts.notifyUser(after, 'profile_changed', {
    subject: `Your ${BANK.name} account details were updated`,
    heading: 'Your details changed',
    intro: 'A member of our team updated the following on your account.',
    rows: changed.map((f) => ({ label: f.replace(/_/g, ' '), value: String(after[f] ?? '-') })),
    footNote: `Not expecting this? Please ${contact.callSupport()}.`,
  });
  res.json({ customer: usersLib.publicUser(after, 'admin') });
});

/** Activate, suspend or close. Suspension is visible at the next request. */
const setCustomerStatus = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  const status = trimmed(req.body.status, 20);
  if (!['active', 'suspended', 'closed', 'pending'].includes(status)) throw fail(400, 'Unknown status.');
  const reason = trimmed(req.body.reason, 200);

  await db.users.update(user.id, { status, updated_at: nowIso(), notes: reason ? `${user.notes || ''}\n[${nowIso().slice(0, 10)}] ${status}: ${reason}`.trim() : user.notes });
  if (status !== 'active') {
    await require('../../bank/auth').revokeOtherSessions(user.id, null);
  }
  await audit.log({
    action: `admin.customer_${status}`, category: 'admin', userId: user.id, req, severity: status === 'active' ? 'notice' : 'warning',
    actor: actorOf(req), detail: `Account ${status}${reason ? `: ${reason}` : ''}`,
  });
  await alerts.notifyUser(await db.users.findById(user.id), 'profile_changed', {
    force: true,
    subject: `Your ${BANK.name} account is now ${status}`,
    heading: `Account ${status}`,
    intro: reason || `Your online banking access is now ${status}.`,
    footNote: `Questions? Please ${contact.callSupport()}.`,
    severity: status === 'active' ? 'info' : 'warning',
  });
  res.json({ customer: usersLib.publicUser(await db.users.findById(user.id), 'admin') });
});

const setKyc = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  const status = trimmed(req.body.kycStatus, 20);
  if (!['pending', 'verified', 'review', 'rejected'].includes(status)) throw fail(400, 'Unknown KYC status.');
  await db.users.update(user.id, {
    kyc_status: status,
    kyc_notes: trimmed(req.body.notes, 500) || user.kyc_notes,
    kyc_reviewed_at: nowIso(),
    updated_at: nowIso(),
  });
  await audit.log({
    action: 'admin.kyc_updated', category: 'admin', userId: user.id, req, severity: 'notice',
    actor: actorOf(req), detail: `Identity verification set to ${status}`,
  });
  res.json({ customer: usersLib.publicUser(await db.users.findById(user.id), 'admin') });
});

/** Show the full SSN once, and write down who looked. */
const revealSsn = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  const ssn = usersLib.revealSsn(user);
  if (!ssn) throw fail(404, 'No Social Security number on file.');
  await audit.log({
    action: 'admin.ssn_revealed', category: 'admin', userId: user.id, req, severity: 'warning',
    actor: actorOf(req), detail: `Viewed the full SSN for ${usersLib.fullName(user)}`,
  });
  res.json({ ssn });
});

/** Issue a temporary password and force a change at next sign-in. */
const resetCustomerPassword = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  const cfg = await settingsLib.get();
  const temporary = trimmed(req.body.password, 64) || `Rf${security.randomToken(5)}!7`;
  const problems = security.passwordProblems(temporary, { minLength: cfg.passwordMinLength });
  if (problems.length) throw fail(400, `That password is too weak: ${problems.join(', ').toLowerCase()}.`);

  await db.users.update(user.id, {
    password_hash: await security.hashSecret(temporary),
    must_change_password: req.body.forceChange !== false,
    password_changed_at: nowIso(),
    failed_logins: 0,
    locked_until: null,
    updated_at: nowIso(),
  });
  await require('../../bank/auth').revokeOtherSessions(user.id, null);
  await audit.log({
    action: 'admin.password_reset', category: 'admin', userId: user.id, req, severity: 'warning',
    actor: actorOf(req), detail: `Issued a temporary password for ${user.email}`,
  });
  await alerts.notifyUser(await db.users.findById(user.id), 'password_changed', {
    force: true,
    subject: `A temporary ${BANK.name} password has been issued`,
    heading: 'Your password was reset by our team',
    intro: 'Use the temporary password below to sign in, then choose your own.',
    rows: [{ label: 'Temporary password', value: temporary }],
    footNote: `If you did not ask for this, ${contact.callFraud()} immediately.`,
  });
  res.json({ temporaryPassword: temporary });
});

const unlockCustomer = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  await db.users.update(user.id, { locked_until: null, failed_logins: 0 });
  await audit.log({
    action: 'admin.customer_unlocked', category: 'admin', userId: user.id, req,
    actor: actorOf(req), detail: 'Cleared the sign-in lockout',
  });
  res.json({ status: 'ok' });
});

/** Upload an identity document on the customer's behalf. */
const uploadCustomerDocument = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  const kind = trimmed(req.body.kind, 40) || 'other';
  const doc = await profile.storeDocument({
    user, kind, filename: req.body.filename, dataUrl: req.body.file,
    uploadedBy: 'admin', uploadedById: req.bankUser.id, note: trimmed(req.body.note, 200),
  });
  if (kind === 'avatar') {
    await db.users.update(user.id, { photo_url: `/api/bank/documents/${doc.id}/file`, photo_document_id: doc.id });
  }
  await audit.log({
    action: 'admin.document_uploaded', category: 'admin', userId: user.id, req,
    actor: actorOf(req), detail: `Filed ${kind.replace(/_/g, ' ')} for ${usersLib.fullName(user)}`,
  });
  res.status(201).json({ document: profile.publicDocument(doc) });
});

/* ------------------------------------------------------------- accounts --- */

const openAccountForCustomer = asyncHandler(async (req, res) => {
  const user = await customerOr404(req.params.id);
  const account = await accountsLib.openAccount(user, {
    productId: 'investment_cash',
    nickname: trimmed(req.body.nickname, 40),
    openingBalance: req.body.openingBalance ? toCents(req.body.openingBalance) : 0,
    openingDescription: trimmed(req.body.openingDescription, 120) || 'Opening deposit',
    createdBy: 'admin',
    createdById: req.bankUser.id,
  });
  await audit.log({
    action: 'admin.account_opened', category: 'admin', userId: user.id, req, severity: 'notice',
    actor: actorOf(req),
    detail: `Opened ${account.name} ${ids.maskAccount(account.account_number)} with ${money(account.balance)}`,
    meta: { accountId: account.id },
  });
  await alerts.notifyUser(user, 'account_opened', {
    subject: `Your new ${account.name} is open`,
    heading: 'Your new account is open',
    intro: `${account.name} is ready to use.`,
    rows: [
      { label: 'Account', value: ids.maskAccount(account.account_number) },
      { label: 'Opening balance', value: money(account.balance) },
    ],
  });
  res.status(201).json({ account: accountsLib.publicAccount(account) });
});

const updateAccount = asyncHandler(async (req, res) => {
  const account = await db.accounts.findById(req.params.id);
  if (!account) throw fail(404, 'Account not found.');
  const patch = {};
  if (req.body.nickname !== undefined) patch.nickname = trimmed(req.body.nickname, 40);
  if (req.body.status !== undefined) {
    const status = trimmed(req.body.status, 20);
    if (!['active', 'frozen', 'restricted', 'dormant', 'closed'].includes(status)) throw fail(400, 'Unknown account status.');
    patch.status = status;
    if (status === 'closed') patch.closed_at = nowIso();
  }
  if (req.body.creditLimit !== undefined) patch.credit_limit = toCents(req.body.creditLimit) || 0;
  if (req.body.overdraftLimit !== undefined) patch.overdraft_limit = toCents(req.body.overdraftLimit) || 0;
  if (req.body.interestRate !== undefined) patch.interest_rate = Number(req.body.interestRate) || 0;
  if (req.body.apy !== undefined) patch.apy = Number(req.body.apy) || 0;
  if (req.body.minimumBalance !== undefined) patch.minimum_balance = toCents(req.body.minimumBalance) || 0;
  if (req.body.monthlyFee !== undefined) patch.monthly_fee = toCents(req.body.monthlyFee) || 0;
  if (req.body.statementDay !== undefined) patch.statement_day = Math.min(Math.max(Number(req.body.statementDay) || 1, 1), 28);
  if (req.body.notes !== undefined) patch.notes = trimmed(req.body.notes, 500);
  if (!Object.keys(patch).length) throw fail(400, 'Nothing to change.');

  await db.accounts.update(account.id, patch);
  const updated = await ledger.recalculate(account.id);
  await audit.log({
    action: 'admin.account_updated', category: 'admin', userId: account.user_id, req,
    actor: actorOf(req),
    detail: `Updated ${Object.keys(patch).join(', ')} on ${ids.maskAccount(account.account_number)}`,
  });
  res.json({ account: accountsLib.publicAccount(updated || { ...account, ...patch }) });
});

/**
 * Add to or take from a balance.
 *
 * This is a ledger entry like any other - it is dated, described, categorised
 * and visible to the customer - because a balance that changed with no entry
 * behind it is the one thing a customer can never be given an answer about.
 */
const adjustBalance = asyncHandler(async (req, res) => {
  const account = await db.accounts.findById(req.params.id);
  if (!account) throw fail(404, 'Account not found.');
  const user = await db.users.findById(account.user_id);

  const amount = toCents(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, 'Enter an amount greater than zero.');

  const direction = req.body.direction === 'debit' ? 'debit' : 'credit';
  const status = ['posted', 'pending'].includes(req.body.status) ? req.body.status : 'posted';
  const method = TRANSACTION_METHODS[req.body.method] ? req.body.method : 'adjustment';
  const description = trimmed(req.body.description, 140)
    || (direction === 'credit' ? 'Deposit' : 'Withdrawal');
  let valueDate;
  if (req.body.date) {
    const when = new Date(req.body.date);
    if (Number.isNaN(when.getTime())) throw fail(400, 'Enter a valid value date.');
    if (when.getTime() > Date.now() + 60000) throw fail(400, 'An entry cannot be dated in the future.');
    valueDate = when.toISOString();
  }

  const { transaction, account: updated } = await ledger.post({
    accountId: account.id,
    direction,
    amount,
    description,
    merchant: trimmed(req.body.merchant, 80),
    category: CATEGORIES.includes(req.body.category) ? req.body.category : (direction === 'credit' ? 'Income' : 'Other'),
    method,
    status,
    memo: trimmed(req.body.memo, 200),
    date: valueDate,
    location: trimmed(req.body.location, 80),
    counterparty: req.body.counterpartyName
      ? {
        name: trimmed(req.body.counterpartyName, 120),
        bank: trimmed(req.body.counterpartyBank, 120),
        account_masked: req.body.counterpartyAccount ? ids.maskAccount(req.body.counterpartyAccount) : '',
        routing: trimmed(req.body.counterpartyRouting, 20),
      }
      : null,
    traceNumber: method === 'ach' ? ids.achTrace(account.routing_number) : null,
    checkNumber: trimmed(req.body.checkNumber, 10) || null,
    createdBy: 'admin',
    createdById: req.bankUser.id,
    adminNote: trimmed(req.body.note, 300),
  });

  // Back-dated: the entries after it need their running balances restated.
  if (valueDate && Date.now() - new Date(valueDate).getTime() > 60000) await ledger.restate(account.id);

  await audit.log({
    action: 'admin.balance_adjusted', category: 'admin', userId: account.user_id, req, severity: 'notice',
    actor: actorOf(req),
    detail: `${direction === 'credit' ? 'Credited' : 'Debited'} ${money(amount)} ${direction === 'credit' ? 'to' : 'from'} ${ids.maskAccount(account.account_number)} - ${description}`,
    meta: { transactionId: transaction.id, accountId: account.id, amount, direction, status },
  });

  if (user && req.body.notify !== false && status === 'posted') {
    if (direction === 'credit') {
      // Two messages: it has landed, then what can be spent. See
      // alerts.creditPosted - those are different numbers whenever any part of
      // the balance is on hold, and one message carrying both is the thing
      // customers misread.
      await alerts.creditPosted(user, {
        account: updated,
        transaction,
        amount,
        balance: updated.balance,
        available: ledger.availableFor(updated),
      });
    } else {
      await alerts.notifyUser(user, 'large_transaction', {
        subject: `Withdrawal posted - ${money(amount)}`,
        heading: 'Money out',
        intro: `${money(amount)} was debited from ${account.nickname || account.name} ${ids.maskAccount(account.account_number)}.`,
        rows: [
          { label: 'Description', value: description },
          { label: 'Amount', value: money(amount) },
          { label: 'New balance', value: money(updated.balance) },
          { label: 'Available', value: money(ledger.availableFor(updated)) },
          { label: 'Reference', value: transaction.reference },
        ],
      });
    }
  }

  res.status(201).json({
    transaction: accountsController.publicTransaction(transaction, updated),
    account: accountsLib.publicAccount(updated),
  });
});

/** Amend the wording, the date or the category of an entry already posted. */
const updateTransaction = asyncHandler(async (req, res) => {
  const tx = await db.transactions.findById(req.params.id);
  if (!tx) throw fail(404, 'Transaction not found.');
  const patch = {};
  if (req.body.description !== undefined) patch.description = trimmed(req.body.description, 140);
  if (req.body.category !== undefined) patch.category = trimmed(req.body.category, 40);
  if (req.body.merchant !== undefined) patch.merchant = trimmed(req.body.merchant, 80);
  if (req.body.memo !== undefined) patch.memo = trimmed(req.body.memo, 200);
  if (req.body.date !== undefined && req.body.date !== '') {
    const when = new Date(req.body.date);
    if (Number.isNaN(when.getTime())) throw fail(400, 'Enter a valid date and time.');
    if (when.getTime() > Date.now() + 60000) throw fail(400, 'An entry cannot be dated in the future. Use a scheduled transfer instead.');
    patch.date = when.toISOString();
    if (tx.posted_at) patch.posted_at = patch.date;
  }
  if (req.body.note !== undefined) patch.admin_note = trimmed(req.body.note, 300);

  // A conversion's entry moves with its trade; its amount is fixed by the units
  // and price, so it is corrected by reversing and booking it again.
  const trade = await db.trades.findOne({ transaction_id: tx.id }).catch(() => null);
  const newAmount = req.body.amount !== undefined && req.body.amount !== '' ? toCents(req.body.amount) : null;
  if (newAmount != null && newAmount !== Number(tx.amount)) {
    if (trade) throw fail(409, 'A Bitcoin purchase\'s amount comes from its units and price. Reverse it and book it again at the right figures.');
    await ledger.amend(tx.id, { amount: newAmount });
    patch.amount = newAmount;
  }
  if (!Object.keys(patch).length) throw fail(400, 'Nothing to change.');

  const { amount: _ignored, ...rest } = patch;
  if (Object.keys(rest).length) await db.transactions.update(tx.id, rest);
  if (trade && patch.date) await db.trades.update(trade.id, { created_at: patch.date });
  if (patch.date || patch.amount) await ledger.restate(tx.account_id);
  await audit.log({
    action: 'admin.transaction_updated', category: 'admin', userId: tx.user_id, req,
    actor: actorOf(req), severity: patch.amount || patch.date ? 'notice' : 'info',
    detail: `Amended entry ${tx.reference} (${Object.keys(patch).join(', ')})${patch.amount ? ` ${money(tx.amount)} -> ${money(patch.amount)}` : ''}${patch.date ? ` dated ${patch.date}` : ''}`,
    meta: { transactionId: tx.id, before: { amount: tx.amount, date: tx.date }, after: { amount: patch.amount, date: patch.date } },
  });
  const account = await db.accounts.findById(tx.account_id);
  const fresh = await db.transactions.findById(tx.id);
  res.json({ transaction: accountsController.publicTransaction(fresh || { ...tx, ...patch }, account) });
});

/** Release a pending entry, or reverse a posted one. */
const settleTransaction = asyncHandler(async (req, res) => {
  const tx = await db.transactions.findById(req.params.id);
  if (!tx) throw fail(404, 'Transaction not found.');
  const action = trimmed(req.body.action, 20) || 'post';

  let result;
  if (action === 'post') result = await ledger.settle(tx.id, { status: 'posted', note: trimmed(req.body.note, 200) });
  else if (action === 'fail') result = await ledger.settle(tx.id, { status: 'failed', note: trimmed(req.body.note, 200) });
  else if (action === 'reverse') {
    // Reversing a conversion's cash alone would leave the customer holding
    // units they no longer paid for. Undo the whole trade instead.
    const trade = await db.trades.findOne({ transaction_id: tx.id }).catch(() => null);
    if (trade) {
      await require('../../bank/invest').reverseTrade(trade.id, req.bankUser, trimmed(req.body.note, 200), req);
      result = await db.transactions.findById(tx.id);
    } else {
      result = await ledger.reverse(tx.id, { reason: trimmed(req.body.note, 200) || 'Reversed by the bank', actor: 'admin', actorId: req.bankUser.id });
    }
  } else throw fail(400, 'Unknown action.');

  await audit.log({
    action: `admin.transaction_${action}`, category: 'admin', userId: tx.user_id, req, severity: 'notice',
    actor: actorOf(req), detail: `${action} on ${tx.reference} (${money(tx.amount)})`,
  });
  const account = await db.accounts.findById(tx.account_id);
  res.json({
    transaction: accountsController.publicTransaction(result, account),
    account: accountsLib.publicAccount(account),
  });
});

/* ---------------------------------------------------- withdrawal queue --- */

const listTransfers = asyncHandler(async (req, res) => {
  const { limit, offset } = page(req.query);
  const rows = await db.transfers.find({}, { order: 'created_at.desc' });
  const filtered = rows.filter((t) => {
    if (req.query.status && t.status !== req.query.status) return false;
    if (req.query.type && t.type !== req.query.type) return false;
    return true;
  });
  const visible = filtered.slice(offset, offset + limit);
  const owners = await db.users.findByIds(visible.map((t) => t.user_id));
  res.json({
    transfers: visible.map((t) => ({
      ...transfersLib.publicTransfer(t),
      customer: owners.has(t.user_id) ? usersLib.publicUser(owners.get(t.user_id), 'summary') : null,
    })),
    total: filtered.length,
    reasons: REJECTION_REASONS,
  });
});

const approveTransfer = asyncHandler(async (req, res) => {
  const transfer = await db.transfers.findById(req.params.id);
  if (!transfer) throw fail(404, 'Withdrawal not found.');
  if (!['pending_review', 'pending_verification', 'processing', 'scheduled'].includes(transfer.status)) {
    throw fail(409, `That withdrawal is already ${transfer.status}.`);
  }
  const owner = await db.users.findById(transfer.user_id);
  const result = await transfersLib.complete(owner, transfer, {
    actor: 'admin', actorId: req.bankUser.id, req, note: trimmed(req.body.note, 300),
  });
  await audit.log({
    action: 'admin.transfer_approved', category: 'admin', userId: transfer.user_id, req, severity: 'notice',
    actor: actorOf(req), detail: `Released ${money(transfer.amount)} - ${transfer.confirmation}`,
  });
  res.json({ transfer: transfersLib.publicTransfer(result.transfer) });
});

const rejectTransfer = asyncHandler(async (req, res) => {
  const transfer = await db.transfers.findById(req.params.id);
  if (!transfer) throw fail(404, 'Withdrawal not found.');
  const updated = await transfersLib.reject(transfer, {
    reasonCode: trimmed(req.body.reasonCode, 40) || 'other',
    note: trimmed(req.body.note, 300),
    actorId: req.bankUser.id,
    actorEmail: req.bankUser.email,
    req,
  });
  res.json({ transfer: transfersLib.publicTransfer(updated) });
});

/* ------------------------------------------------- withdrawal accounts --- */

const reviewBeneficiary = asyncHandler(async (req, res) => {
  const row = await db.beneficiaries.findById(req.params.id);
  if (!row) throw fail(404, 'Withdrawal account not found.');
  const status = trimmed(req.body.status, 20);
  if (!['pending', 'verified', 'blocked'].includes(status)) throw fail(400, 'Unknown status.');
  await db.beneficiaries.update(row.id, { status, verified_at: status === 'verified' ? nowIso() : null });
  await audit.log({
    action: 'admin.beneficiary_reviewed', category: 'admin', userId: row.user_id, req,
    actor: actorOf(req), detail: `Recipient ${row.name} marked ${status}`,
  });
  res.json({ beneficiary: money_.publicBeneficiary({ ...row, status }) });
});

/* --------------------------------------------------------------- activity --- */

const listActivity = asyncHandler(async (req, res) => {
  const { limit, offset } = page(req.query);
  const rows = await db.activity.find({}, { order: 'created_at.desc' });
  const q = String(req.query.q || '').trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (req.query.category && r.category !== req.query.category) return false;
    if (req.query.severity && r.severity !== req.query.severity) return false;
    if (req.query.userId && r.user_id !== req.query.userId) return false;
    if (req.query.from && r.created_at < new Date(req.query.from).toISOString()) return false;
    if (req.query.to && r.created_at > new Date(`${req.query.to}T23:59:59.999Z`).toISOString()) return false;
    if (!q) return true;
    return `${r.action} ${r.detail} ${r.actor_email} ${r.ip}`.toLowerCase().includes(q);
  });
  res.json({ activity: filtered.slice(offset, offset + limit).map(publicActivity), total: filtered.length });
});

const exportActivity = asyncHandler(async (req, res) => {
  const rows = await db.activity.find({}, { order: 'created_at.desc', limit: 5000 });
  const body = csv(rows, [
    { label: 'When', value: 'created_at' },
    { label: 'Action', value: 'action' },
    { label: 'Category', value: 'category' },
    { label: 'Severity', value: 'severity' },
    { label: 'Actor', value: 'actor_email' },
    { label: 'Role', value: 'actor_role' },
    { label: 'Detail', value: 'detail' },
    { label: 'IP', value: 'ip' },
    { label: 'Device', value: 'device' },
  ]);
  await audit.log({
    action: 'admin.activity_exported', category: 'admin', req,
    actor: actorOf(req), detail: `Exported ${rows.length} activity rows`,
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hedgestone-activity-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(body);
});

/* ----------------------------------------------------------------- alerts --- */

const listAlerts = asyncHandler(async (req, res) => {
  const { limit, offset } = page(req.query);
  const rows = await db.alerts.find({}, { order: 'created_at.desc' });
  const filtered = req.query.status ? rows.filter((r) => r.status === req.query.status) : rows;
  const visible = filtered.slice(offset, offset + limit);
  const owners = await db.users.findByIds(visible.map((r) => r.user_id));
  const out = visible.map((row) => ({
    id: row.id, subject: row.subject, type: row.type, status: row.status, severity: row.severity,
    createdAt: row.created_at, sentAt: row.sent_at, readAt: row.read_at, error: row.error,
    customer: owners.has(row.user_id) ? usersLib.publicUser(owners.get(row.user_id), 'summary') : null,
    preview: row.preview,
  }));
  res.json({ alerts: out, total: filtered.length, types: ALERT_TYPES });
});

/** Compose and send an alert to one customer or to everyone. */
const sendAlert = asyncHandler(async (req, res) => {
  const subject = trimmed(req.body.subject, 160);
  const body = trimmed(req.body.body, 4000);
  if (!subject || !body) throw fail(400, 'Give the message a subject and a body.');

  const audience = trimmed(req.body.audience, 20) || 'customer';
  let recipients = [];
  if (audience === 'all') recipients = (await db.users.find({ role: 'customer' })).filter((u) => u.status !== 'closed');
  else if (audience === 'active') recipients = await db.users.find({ role: 'customer', status: 'active' });
  else {
    const one = await db.users.findById(req.body.userId);
    if (!one) throw fail(404, 'Customer not found.');
    recipients = [one];
  }

  const content = {
    force: true,
    subject,
    heading: trimmed(req.body.heading, 160) || subject,
    intro: trimmed(req.body.intro, 400),
    body,
    severity: trimmed(req.body.severity, 20) || 'info',
    cta: req.body.ctaLabel && req.body.ctaHref ? { label: trimmed(req.body.ctaLabel, 60), href: trimmed(req.body.ctaHref, 300) } : undefined,
  };
  const sent = await alerts.broadcast(recipients, trimmed(req.body.type, 40) || 'message_received', content);

  // A message the customer can also answer, not only an email that left.
  if (req.body.alsoMessage !== false) {
    // One bulk write. "Everyone" is every customer the bank has, and a row
    // each would be a round trip each - the sort of thing that is instant
    // against a handful of demonstration accounts and times out against a
    // real book.
    const author = `${req.bankUser.first_name} ${req.bankUser.last_name}`.trim() || 'Hedgestone Client Services';
    await db.messages.insertMany(recipients.map((recipient) => ({
      id: ids.uuid(),
      created_at: nowIso(),
      thread_id: ids.uuid(),
      user_id: recipient.id,
      from_side: 'bank',
      author_name: author,
      subject,
      body,
      read_at: null,
      attachments: null,
    })));
  }

  await audit.log({
    action: 'admin.alert_sent', category: 'admin', req, severity: 'notice',
    actor: actorOf(req),
    detail: `Sent "${subject}" to ${recipients.length} customer(s)`,
    meta: { audience, delivered: sent.filter((s) => s && s.status === 'sent').length },
  });

  res.status(201).json({
    sent: sent.length,
    delivered: sent.filter((s) => s && s.status === 'sent').length,
    queued: sent.filter((s) => s && s.status !== 'sent').length,
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
  });
});

/* --------------------------------------------------------------- messages --- */

const listMessages = asyncHandler(async (req, res) => {
  const rows = await db.messages.find({}, { order: 'created_at.asc' });
  const threads = new Map();
  for (const row of rows) {
    if (!threads.has(row.thread_id)) {
      const owner = await db.users.findById(row.user_id);
      threads.set(row.thread_id, {
        id: row.thread_id,
        subject: row.subject,
        customer: owner ? usersLib.publicUser(owner, 'summary') : null,
        messages: [],
        updatedAt: row.created_at,
        awaitingReply: false,
      });
    }
    const thread = threads.get(row.thread_id);
    thread.messages.push({
      id: row.id, from: row.from_side, authorName: row.author_name,
      body: row.body, createdAt: row.created_at, readAt: row.read_at,
    });
    thread.updatedAt = row.created_at;
    thread.awaitingReply = row.from_side === 'customer';
  }
  res.json({ threads: Array.from(threads.values()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)) });
});

const replyToMessage = asyncHandler(async (req, res) => {
  const body = trimmed(req.body.body, 4000);
  if (!body) throw fail(400, 'Write a reply first.');
  const existing = await db.messages.find({ thread_id: req.params.id }, { order: 'created_at.asc', limit: 1 });
  if (!existing.length) throw fail(404, 'Conversation not found.');
  const first = existing[0];
  const owner = await db.users.findById(first.user_id);

  const row = {
    id: ids.uuid(),
    created_at: nowIso(),
    thread_id: first.thread_id,
    user_id: first.user_id,
    from_side: 'bank',
    author_name: `${req.bankUser.first_name} ${req.bankUser.last_name}`.trim() || 'Hedgestone Client Services',
    subject: first.subject,
    body,
    read_at: null,
    attachments: null,
  };
  await db.messages.insert(row);
  if (owner) {
    await alerts.notifyUser(owner, 'message_received', {
      subject: `New secure message: ${first.subject}`,
      heading: 'You have a new secure message',
      intro: body.slice(0, 240),
      cta: { label: 'Read it in online banking', href: `${baseUrl()}/messages` },
    });
  }
  await audit.log({
    action: 'admin.message_replied', category: 'admin', userId: first.user_id, req,
    actor: actorOf(req), detail: `Replied on "${first.subject}"`,
  });
  res.status(201).json({ message: { id: row.id, from: 'bank', body, createdAt: row.created_at } });
});

/* --------------------------------------------------------------- settings --- */

const getSettings = asyncHandler(async (req, res) => {
  res.json({
    settings: await settingsLib.get(),
    products: PRODUCTS,
    accountTypes: Object.entries(ACCOUNT_TYPES).map(([id, t]) => ({ id, ...t })),
    categories: CATEGORIES,
    methods: Object.entries(TRANSACTION_METHODS).map(([id, m]) => ({ id, ...m })),
    states: US_STATES,
    securityQuestions: SECURITY_QUESTIONS,
    documentKinds: DOCUMENT_KINDS,
    rejectionReasons: REJECTION_REASONS,
    alertTypes: ALERT_TYPES,
    bank: BANK,
    emailConfigured: Boolean(process.env.RESEND_API_KEY),
  });
});

const updateSettings = asyncHandler(async (req, res) => {
  const incoming = req.body || {};
  if (incoming.routingNumber && !ids.validateRouting(incoming.routingNumber)) {
    throw fail(400, 'That routing number does not pass the ABA checksum.');
  }
  // Terms are whole months. The list is what a customer chooses from; the
  // default is preselected, so it has to be one of them.
  const months = (v) => Number(v);
  const valid = (n) => Number.isInteger(n) && n >= 1 && n <= 120;
  if (incoming.investmentTerms !== undefined) {
    const list = (Array.isArray(incoming.investmentTerms) ? incoming.investmentTerms : String(incoming.investmentTerms).split(/[\s,]+/))
      .filter((v) => String(v).trim() !== '').map(months);
    if (!list.length || !list.every(valid)) throw fail(400, 'Terms are whole numbers of months between 1 and 120, separated by commas.');
    incoming.investmentTerms = Array.from(new Set(list)).sort((a, b) => a - b);
  }
  if (incoming.investmentTermMonths !== undefined) {
    const n = months(incoming.investmentTermMonths);
    if (!valid(n)) throw fail(400, 'The default term is a whole number of months between 1 and 120.');
    incoming.investmentTermMonths = n;
  }
  const terms = incoming.investmentTerms || (await settingsLib.get()).investmentTerms || [];
  const fallback = incoming.investmentTermMonths != null ? incoming.investmentTermMonths : (await settingsLib.get()).investmentTermMonths;
  if (terms.length && !terms.includes(fallback)) throw fail(400, `The default term (${fallback} months) must be one of the terms offered.`);
  const saved = await settingsLib.save(incoming);
  await audit.log({
    action: 'admin.settings_updated', category: 'admin', req, severity: 'notice',
    actor: actorOf(req), detail: `Changed ${Object.keys(incoming).join(', ')}`,
  });
  res.json({ settings: saved });
});

/** Run any scheduled transfers that have come due, on demand. */
const runScheduled = asyncHandler(async (req, res) => {
  const results = await transfersLib.runScheduled({});
  await audit.log({
    action: 'admin.scheduled_run', category: 'admin', req,
    actor: actorOf(req), detail: `Processed ${results.length} scheduled transfer(s)`,
  });
  res.json({ processed: results });
});

module.exports = {
  overview,
  listCustomers,
  customerDetail,
  createCustomer,
  updateCustomer,
  setCustomerStatus,
  setKyc,
  revealSsn,
  resetCustomerPassword,
  unlockCustomer,
  uploadCustomerDocument,
  openAccountForCustomer,
  updateAccount,
  adjustBalance,
  updateTransaction,
  settleTransaction,
  listTransfers,
  approveTransfer,
  rejectTransfer,
  reviewBeneficiary,
  listActivity,
  exportActivity,
  listAlerts,
  sendAlert,
  listMessages,
  replyToMessage,
  getSettings,
  updateSettings,
  runScheduled,
};
