'use strict';

/**
 * Money out, on the customer's side: withdrawals to an account of their own
 * elsewhere, their verification, and the withdrawal accounts they are paid
 * into. Money comes in by staff crediting the cash balance at the console.
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
const { asyncHandler, fail, toCents, trimmed, page } = require('../../bank/http');
const { US_STATES } = require('../../bank/constants');

const nowIso = () => new Date().toISOString();

/* ---------------------------------------------------------- withdrawals --- */

/** Everything the withdrawal form needs to render itself. */
const transferOptions = asyncHandler(async (req, res) => {
  const cfg = await settings.get();
  const [accounts, beneficiaries] = await Promise.all([
    accountsLib.spendableAccounts(req.bankUser.id),
    db.beneficiaries.find({ user_id: req.bankUser.id }, { order: 'created_at.desc' }),
  ]);
  const offered = transfersLib.WITHDRAWAL_TYPES.map((id) => [id, transfersLib.TYPE_RULES[id]]);

  const spent = {};
  for (const [type, rule] of offered) {
    spent[type] = await ledger.dailyTotal(req.bankUser.id, [rule.method]);
  }

  res.json({
    accounts: accounts.map(accountsLib.publicAccount).filter((a) => !a.isCredit),
    beneficiaries: beneficiaries.map(publicBeneficiary),
    types: offered.map(([id, rule]) => ({
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
  if (!transfer || transfer.user_id !== req.bankUser.id) throw fail(404, 'Withdrawal not found.');
  res.json({ transfer: transfersLib.publicTransfer(transfer) });
});

const createTransfer = asyncHandler(async (req, res) => {
  const input = {
    type: trimmed(req.body.type, 32) || 'ach',
    fromAccountId: req.body.fromAccountId,
    beneficiaryId: req.body.beneficiaryId,
    amount: toCents(req.body.amount),
    memo: req.body.memo,
    purpose: req.body.purpose,
    pin: req.body.pin,
    scheduledFor: req.body.scheduledFor,
    recurrence: req.body.recurrence,
    recurrenceEnd: req.body.recurrenceEnd,
  };
  if (!transfersLib.WITHDRAWAL_TYPES.includes(input.type)) {
    throw fail(400, 'Money can only be withdrawn to an account of your own. Choose a withdrawal type.', 'withdrawals_only');
  }
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
  if (!transfer || transfer.user_id !== req.bankUser.id) throw fail(404, 'Withdrawal not found.');
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
    if (!swift) throw fail(400, 'An international withdrawal needs the receiving bank’s SWIFT/BIC code.');
  } else if (!ids.validateRouting(routing)) {
    throw fail(400, 'That routing number is not valid. Check the nine digits your bank gives for payments in.');
  }

  const duplicate = (await db.beneficiaries.find({ user_id: req.bankUser.id }))
    .find((b) => b.account_number === accountNumber && b.routing_number === routing);
  if (duplicate) throw fail(409, 'You already have that account saved for withdrawals.');

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
    detail: `Added withdrawal account ${name} (${ids.maskAccount(accountNumber)})`,
    meta: { beneficiaryId: row.id },
  });
  await alerts.notifyUser(req.bankUser, 'profile_changed', {
    subject: 'A new withdrawal account was added',
    heading: 'New withdrawal account added',
    intro: `${name} was added to the accounts you can withdraw to.`,
    rows: [
      { label: 'Name on the account', value: name },
      { label: 'Held at', value: row.bank_name || '-' },
      { label: 'Account', value: ids.maskAccount(accountNumber) },
      { label: 'Type', value: type.replace(/_/g, ' ') },
    ],
    footNote: `If you did not add this account, ${contact.callFraud()} before making any withdrawal.`,
  });

  res.status(201).json({ beneficiary: publicBeneficiary(row) });
});

const updateBeneficiary = asyncHandler(async (req, res) => {
  const row = await db.beneficiaries.findById(req.params.id);
  if (!row || row.user_id !== req.bankUser.id) throw fail(404, 'Withdrawal account not found.');
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
  if (!row || row.user_id !== req.bankUser.id) throw fail(404, 'Withdrawal account not found.');
  await db.beneficiaries.remove(row.id);
  await audit.log({
    action: 'beneficiary.removed', category: 'money', userId: req.bankUser.id, req,
    actor: { id: req.bankUser.id, email: req.bankUser.email, role: 'customer' },
    detail: `Removed withdrawal account ${row.name}`,
  });
  res.json({ status: 'ok' });
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
  publicBeneficiary,
};
