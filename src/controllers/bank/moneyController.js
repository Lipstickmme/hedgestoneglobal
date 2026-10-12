'use strict';

/**
 * Everything that moves money on the customer's side: transfers and their
 * verification, the people and companies they send to, bill payments and
 * mobile check deposits.
 */

const { db } = require('../../bank/db');
const ids = require('../../bank/ids');
const ledger = require('../../bank/ledger');
const transfersLib = require('../../bank/transfers');
const accountsLib = require('../../bank/accounts');
const settings = require('../../bank/settings');
const alerts = require('../../bank/alerts');
const contact = require('../../bank/contact');
const audit = require('../../bank/audit');
const profile = require('./profileController');
const { asyncHandler, fail, toCents, trimmed, money, page } = require('../../bank/http');
const { BANK, REJECTION_REASONS, US_STATES } = require('../../bank/constants');

const nowIso = () => new Date().toISOString();

/* ------------------------------------------------------------ transfers --- */

/** Everything the transfer form needs to render itself. */
const transferOptions = asyncHandler(async (req, res) => {
  const cfg = await settings.get();
  const [accounts, beneficiaries, payees] = await Promise.all([
    accountsLib.spendableAccounts(req.bankUser.id),
    db.beneficiaries.find({ user_id: req.bankUser.id }, { order: 'created_at.desc' }),
    db.payees.find({ user_id: req.bankUser.id }, { order: 'name.asc' }),
  ]);

  const spent = {};
  for (const [type, rule] of Object.entries(transfersLib.TYPE_RULES)) {
    spent[type] = await ledger.dailyTotal(req.bankUser.id, [rule.method]);
  }

  res.json({
    accounts: accounts.map(accountsLib.publicAccount),
    beneficiaries: beneficiaries.map(publicBeneficiary),
    payees: payees.map(publicPayee),
    types: Object.entries(transfersLib.TYPE_RULES).map(([id, rule]) => ({
      id,
      label: rule.label,
      clearing: rule.clearing,
      fee: rule.feeKey ? Number(cfg.fees[rule.feeKey] || 0) : 0,
      dailyLimit: Number(cfg.limits[rule.limitKey] || 0),
      usedToday: spent[id] || 0,
    })),
    requiresOtp: Boolean(cfg.requireOtpForTransfers),
    requiresPin: Boolean(cfg.requirePinForTransfers) && Boolean(req.bankUser.transfer_pin_hash),
    hasPin: Boolean(req.bankUser.transfer_pin_hash),
    singleTransactionMax: cfg.limits.singleTransactionMax,
    clearing: cfg.clearing,
  });
});

const listTransfers = asyncHandler(async (req, res) => {
  const { limit, offset } = page(req.query);
  const rows = await db.transfers.find({ user_id: req.bankUser.id }, { order: 'created_at.desc' });
  const filtered = req.query.status ? rows.filter((r) => r.status === req.query.status) : rows;
  res.json({
    transfers: filtered.slice(offset, offset + limit).map(transfersLib.publicTransfer),
    total: filtered.length,
  });
});

const getTransfer = asyncHandler(async (req, res) => {
  const transfer = await db.transfers.findById(req.params.id);
  if (!transfer || transfer.user_id !== req.bankUser.id) throw fail(404, 'Transfer not found.');
  res.json({ transfer: transfersLib.publicTransfer(transfer) });
});

const createTransfer = asyncHandler(async (req, res) => {
  const input = {
    type: trimmed(req.body.type, 32) || 'internal',
    fromAccountId: req.body.fromAccountId,
    toAccountId: req.body.toAccountId,
    beneficiaryId: req.body.beneficiaryId,
    payeeId: req.body.payeeId,
    amount: toCents(req.body.amount),
    memo: req.body.memo,
    purpose: req.body.purpose,
    pin: req.body.pin,
    scheduledFor: req.body.scheduledFor,
    recurrence: req.body.recurrence,
    recurrenceEnd: req.body.recurrenceEnd,
  };
  if (!Number.isFinite(input.amount)) throw fail(400, 'Enter an amount.');

  const result = await transfersLib.submit(req.bankUser, input, req);
  res.status(201).json({
    transfer: transfersLib.publicTransfer(result.transfer),
    next: result.next,
    verification: result.otp ? { expiresAt: result.otp.expiresAt, devCode: result.otp.devCode, sentTo: req.bankUser.email } : undefined,
  });
});

const verifyTransfer = asyncHandler(async (req, res) => {
  const result = await transfersLib.verify(req.bankUser, req.params.id, req.body.code, req);
  res.json({ transfer: transfersLib.publicTransfer(result.transfer), next: result.next });
});

const resendTransferCode = asyncHandler(async (req, res) => {
  const transfer = await db.transfers.findById(req.params.id);
  if (!transfer || transfer.user_id !== req.bankUser.id) throw fail(404, 'Transfer not found.');
  if (transfer.status !== 'pending_verification') throw fail(409, 'That transfer is not waiting for a code.');
  const otp = await transfersLib.issueTransferOtp(req.bankUser, transfer);
  res.json({ status: 'sent', expiresAt: otp.expiresAt, devCode: otp.devCode });
});

const cancelTransfer = asyncHandler(async (req, res) => {
  const transfer = await transfersLib.cancel(req.bankUser, req.params.id, req);
  res.json({ transfer: transfersLib.publicTransfer(transfer) });
});

/* -------------------------------------------------------- beneficiaries --- */

function publicBeneficiary(row) {
  return {
    id: row.id,
    nickname: row.nickname,
    name: row.name,
    bankName: row.bank_name,
    accountMask: ids.maskAccount(row.account_number),
    accountLast4: String(row.account_number || '').slice(-4),
    routingNumber: row.routing_number,
    swift: row.swift,
    accountType: row.account_type,
    type: row.type,
    country: row.country,
    address: row.address,
    bankAddress: row.bank_address,
    relationship: row.relationship,
    status: row.status,
    memo: row.memo,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

const listBeneficiaries = asyncHandler(async (req, res) => {
  const rows = await db.beneficiaries.find({ user_id: req.bankUser.id }, { order: 'created_at.desc' });
  res.json({ beneficiaries: rows.map(publicBeneficiary), states: US_STATES });
});

const createBeneficiary = asyncHandler(async (req, res) => {
  const type = trimmed(req.body.type, 32) || 'domestic_ach';
  const name = trimmed(req.body.name, 120);
  const accountNumber = trimmed(req.body.accountNumber, 40).replace(/\s/g, '');
  if (!name) throw fail(400, 'Enter the name on the receiving account.');
  if (!accountNumber) throw fail(400, 'Enter the account number.');

  const routing = trimmed(req.body.routingNumber, 20).replace(/\D/g, '');
  const swift = trimmed(req.body.swift, 20).toUpperCase();

  if (type === 'international_wire') {
    if (!swift) throw fail(400, 'An international wire needs a SWIFT/BIC code.');
  } else if (!ids.validateRouting(routing)) {
    throw fail(400, 'That routing number is not a valid ABA number. Check the nine digits on the check.');
  }

  const duplicate = (await db.beneficiaries.find({ user_id: req.bankUser.id }))
    .find((b) => b.account_number === accountNumber && b.routing_number === routing);
  if (duplicate) throw fail(409, 'You already have that account saved as a recipient.');

  const row = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: req.bankUser.id,
    nickname: trimmed(req.body.nickname, 40) || name.split(' ')[0],
    name,
    bank_name: trimmed(req.body.bankName, 120),
    account_number: accountNumber,
    routing_number: routing,
    swift,
    account_type: trimmed(req.body.accountType, 20) || 'checking',
    type,
    country: trimmed(req.body.country, 60) || 'United States',
    address: trimmed(req.body.address, 200),
    bank_address: trimmed(req.body.bankAddress, 200),
    relationship: trimmed(req.body.relationship, 60),
    memo: trimmed(req.body.memo, 140),
    // New recipients are usable straight away but flagged, and the review queue
    // is what catches a first payment to one.
    status: 'pending',
    verified_at: null,
    last_used_at: null,
  };
  await db.beneficiaries.insert(row);

  await audit.log({
    action: 'beneficiary.added', category: 'money', userId: req.bankUser.id, req, severity: 'notice',
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Added recipient ${name} (${ids.maskAccount(accountNumber)})`,
    meta: { beneficiaryId: row.id },
  });
  await alerts.notifyUser(req.bankUser, 'profile_changed', {
    subject: 'A new recipient was added to your account',
    heading: 'New recipient added',
    intro: `${name} was added to your saved recipients.`,
    rows: [
      { label: 'Recipient', value: name },
      { label: 'Bank', value: row.bank_name || '-' },
      { label: 'Account', value: ids.maskAccount(accountNumber) },
      { label: 'Type', value: type.replace(/_/g, ' ') },
    ],
    footNote: `If you did not add this recipient, ${contact.callFraud()} before making any payment.`,
  });

  res.status(201).json({ beneficiary: publicBeneficiary(row) });
});

const updateBeneficiary = asyncHandler(async (req, res) => {
  const row = await db.beneficiaries.findById(req.params.id);
  if (!row || row.user_id !== req.bankUser.id) throw fail(404, 'Recipient not found.');
  const patch = {};
  ['nickname', 'relationship', 'memo', 'bankName', 'address', 'bankAddress'].forEach((key) => {
    const column = { nickname: 'nickname', relationship: 'relationship', memo: 'memo', bankName: 'bank_name', address: 'address', bankAddress: 'bank_address' }[key];
    if (req.body[key] !== undefined) patch[column] = trimmed(req.body[key], 200);
  });
  if (!Object.keys(patch).length) throw fail(400, 'Nothing to change.');
  await db.beneficiaries.update(row.id, patch);
  await audit.log({
    action: 'beneficiary.updated', category: 'money', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Updated recipient ${row.name}`,
  });
  res.json({ beneficiary: publicBeneficiary({ ...row, ...patch }) });
});

const deleteBeneficiary = asyncHandler(async (req, res) => {
  const row = await db.beneficiaries.findById(req.params.id);
  if (!row || row.user_id !== req.bankUser.id) throw fail(404, 'Recipient not found.');
  await db.beneficiaries.remove(row.id);
  await audit.log({
    action: 'beneficiary.removed', category: 'money', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Removed recipient ${row.name}`,
  });
  res.json({ status: 'ok' });
});

/* --------------------------------------------------------------- payees --- */

const publicPayee = (row) => ({
  id: row.id,
  name: row.name,
  category: row.category,
  accountNumber: row.account_number,
  accountMask: ids.maskAccount(row.account_number),
  amount: row.amount,
  dueDay: row.due_day,
  autopay: Boolean(row.autopay),
  status: row.status,
  phone: row.phone,
  address: row.address,
  lastPaidAt: row.last_paid_at,
  createdAt: row.created_at,
});

const listPayees = asyncHandler(async (req, res) => {
  const rows = await db.payees.find({ user_id: req.bankUser.id }, { order: 'name.asc' });
  res.json({ payees: rows.map(publicPayee) });
});

const createPayee = asyncHandler(async (req, res) => {
  const name = trimmed(req.body.name, 120);
  if (!name) throw fail(400, 'Enter the company name.');
  const row = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: req.bankUser.id,
    name,
    category: trimmed(req.body.category, 40) || 'Utilities',
    account_number: trimmed(req.body.accountNumber, 40),
    amount: Number.isFinite(toCents(req.body.amount)) ? toCents(req.body.amount) : 0,
    due_day: Math.min(Math.max(Number(req.body.dueDay) || 1, 1), 28),
    autopay: Boolean(req.body.autopay),
    phone: trimmed(req.body.phone, 40),
    address: trimmed(req.body.address, 200),
    status: 'active',
    last_paid_at: null,
  };
  await db.payees.insert(row);
  await audit.log({
    action: 'payee.added', category: 'money', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Added payee ${name}`,
  });
  res.status(201).json({ payee: publicPayee(row) });
});

const updatePayee = asyncHandler(async (req, res) => {
  const row = await db.payees.findById(req.params.id);
  if (!row || row.user_id !== req.bankUser.id) throw fail(404, 'Payee not found.');
  const patch = {};
  if (req.body.amount !== undefined) patch.amount = toCents(req.body.amount) || 0;
  if (req.body.dueDay !== undefined) patch.due_day = Math.min(Math.max(Number(req.body.dueDay) || 1, 1), 28);
  if (req.body.autopay !== undefined) patch.autopay = Boolean(req.body.autopay);
  if (req.body.category !== undefined) patch.category = trimmed(req.body.category, 40);
  if (req.body.status !== undefined) patch.status = trimmed(req.body.status, 20);
  if (!Object.keys(patch).length) throw fail(400, 'Nothing to change.');
  await db.payees.update(row.id, patch);
  res.json({ payee: publicPayee({ ...row, ...patch }) });
});

const deletePayee = asyncHandler(async (req, res) => {
  const row = await db.payees.findById(req.params.id);
  if (!row || row.user_id !== req.bankUser.id) throw fail(404, 'Payee not found.');
  await db.payees.remove(row.id);
  res.json({ status: 'ok' });
});

/* ------------------------------------------------------------- deposits --- */

/**
 * Mobile check deposit. Both sides of the check are stored as documents, the
 * money is credited as a pending entry, and the first $225 is made available
 * next business day the way Regulation CC requires.
 */
const createDeposit = asyncHandler(async (req, res) => {
  const cfg = await settings.get();
  const amount = toCents(req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw fail(400, 'Enter the amount written on the check.');
  if (amount > cfg.limits.mobileDepositDaily) {
    throw fail(400, `Mobile deposits are limited to ${money(cfg.limits.mobileDepositDaily)} a day. Visit a branch for larger checks.`);
  }

  const account = await db.accounts.findById(req.body.accountId);
  if (!account || account.user_id !== req.bankUser.id) throw fail(404, 'Account not found.');
  if (!req.body.front || !req.body.back) throw fail(400, 'Photograph the front and the back of the check.');

  const front = await profile.storeDocument({ user: req.bankUser, kind: 'check_front', filename: 'check-front.jpg', dataUrl: req.body.front });
  const back = await profile.storeDocument({ user: req.bankUser, kind: 'check_back', filename: 'check-back.jpg', dataUrl: req.body.back });

  const holdUntil = ledger.addBusinessDays(new Date(), 2).toISOString();
  const { transaction } = await ledger.post({
    accountId: account.id,
    direction: 'credit',
    amount,
    description: `MOBILE CHECK DEPOSIT${req.body.checkNumber ? ` #${trimmed(req.body.checkNumber, 10)}` : ''}`,
    method: 'mobile_deposit',
    category: 'Income',
    status: 'pending',
    memo: trimmed(req.body.memo, 140),
    checkNumber: trimmed(req.body.checkNumber, 10) || ids.checkNumber(),
    createdBy: 'customer',
    createdById: req.bankUser.id,
  });

  const deposit = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: req.bankUser.id,
    account_id: account.id,
    amount,
    check_number: trimmed(req.body.checkNumber, 10),
    front_document_id: front.id,
    back_document_id: back.id,
    transaction_id: transaction.id,
    status: 'review',
    hold_until: holdUntil,
    available_now: Math.min(amount, 22500),
    reason_note: '',
    reviewed_by: null,
    reviewed_at: null,
    reference: ids.reference('DEP'),
  };
  await db.deposits.insert(deposit);

  await audit.log({
    action: 'deposit.submitted', category: 'money', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Mobile deposit of ${money(amount)} into ${ids.maskAccount(account.account_number)}`,
    meta: { depositId: deposit.id },
  });
  await alerts.notifyUser(req.bankUser, 'deposit_posted', {
    subject: `Check deposit received - ${money(amount)}`,
    heading: 'We have your check',
    intro: `${money(amount)} is being deposited into ${account.nickname || account.name} ${ids.maskAccount(account.account_number)}.`,
    rows: [
      { label: 'Amount', value: money(amount) },
      { label: 'Available now', value: money(deposit.available_now) },
      { label: 'Remainder available', value: new Date(holdUntil).toLocaleDateString('en-US', { dateStyle: 'long' }) },
      { label: 'Reference', value: deposit.reference },
    ],
    footNote: cfg.clearing.mobileDeposit,
  });

  res.status(201).json({ deposit: publicDeposit(deposit), transactionId: transaction.id });
});

const publicDeposit = (row) => ({
  id: row.id,
  accountId: row.account_id,
  amount: row.amount,
  checkNumber: row.check_number,
  status: row.status,
  holdUntil: row.hold_until,
  availableNow: row.available_now,
  reference: row.reference,
  reasonNote: row.reason_note,
  createdAt: row.created_at,
  frontUrl: `/api/bank/documents/${row.front_document_id}/file`,
  backUrl: `/api/bank/documents/${row.back_document_id}/file`,
});

const listDeposits = asyncHandler(async (req, res) => {
  const rows = await db.deposits.find({ user_id: req.bankUser.id }, { order: 'created_at.desc', limit: 50 });
  res.json({ deposits: rows.map(publicDeposit) });
});

/* ------------------------------------------------------------- disputes --- */

const createDispute = asyncHandler(async (req, res) => {
  const tx = await db.transactions.findById(req.body.transactionId);
  if (!tx || tx.user_id !== req.bankUser.id) throw fail(404, 'Transaction not found.');
  const existing = (await db.disputes.find({ transaction_id: tx.id }))[0];
  if (existing) throw fail(409, 'A claim is already open on that transaction.');

  const row = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: req.bankUser.id,
    transaction_id: tx.id,
    account_id: tx.account_id,
    amount: tx.amount,
    reason: trimmed(req.body.reason, 60) || 'unauthorized',
    detail: trimmed(req.body.detail, 1000),
    status: 'open',
    reference: ids.reference('CLM'),
    provisional_credit: false,
    resolution: '',
    resolved_at: null,
    handled_by: null,
  };
  await db.disputes.insert(row);

  await audit.log({
    action: 'dispute.opened', category: 'money', userId: req.bankUser.id, req, severity: 'notice',
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Disputed ${money(tx.amount)} - ${tx.description}`,
    meta: { disputeId: row.id, transactionId: tx.id },
  });
  await alerts.notifyUser(req.bankUser, 'card_activity', {
    force: true,
    subject: `Claim opened - ${row.reference}`,
    heading: 'We have opened your claim',
    intro: 'Our disputes team will look at this and write to you within 10 business days.',
    rows: [
      { label: 'Transaction', value: tx.description },
      { label: 'Amount', value: money(tx.amount) },
      { label: 'Reason', value: row.reason },
      { label: 'Claim reference', value: row.reference },
    ],
  });
  res.status(201).json({ dispute: publicDispute(row) });
});

const publicDispute = (row) => ({
  id: row.id,
  transactionId: row.transaction_id,
  amount: row.amount,
  reason: row.reason,
  detail: row.detail,
  status: row.status,
  reference: row.reference,
  provisionalCredit: Boolean(row.provisional_credit),
  resolution: row.resolution,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
});

const listDisputes = asyncHandler(async (req, res) => {
  const rows = await db.disputes.find({ user_id: req.bankUser.id }, { order: 'created_at.desc' });
  res.json({ disputes: rows.map(publicDispute), reasons: REJECTION_REASONS });
});

module.exports = {
  transferOptions,
  listTransfers,
  getTransfer,
  createTransfer,
  verifyTransfer,
  resendTransferCode,
  cancelTransfer,
  listBeneficiaries,
  createBeneficiary,
  updateBeneficiary,
  deleteBeneficiary,
  listPayees,
  createPayee,
  updatePayee,
  deletePayee,
  createDeposit,
  listDeposits,
  createDispute,
  listDisputes,
  publicBeneficiary,
  publicPayee,
  publicDeposit,
  publicDispute,
};
