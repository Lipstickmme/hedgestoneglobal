'use strict';

/**
 * Moving money out of an account: validation, verification, review and
 * settlement.
 *
 * The shape of a transfer follows what actually happens at a bank rather than
 * what is convenient to code:
 *
 *   submitted -> pending_verification (one-time code / transfer PIN)
 *             -> pending_review       (operator queue, above the threshold)
 *             -> processing           (funds held, instruction sent)
 *             -> completed | rejected | returned
 *
 * A transfer between two Rockfield accounts skips the middle: both legs post
 * immediately, because both sides of it are on our own books. Everything else
 * puts a hold on the money the moment it is accepted, so the customer cannot
 * spend it twice while it clears.
 */

const { db } = require('./db');
const ids = require('./ids');
const ledger = require('./ledger');
const settings = require('./settings');
const contact = require('./contact');
const alerts = require('./alerts');
const audit = require('./audit');
const { BANK, REJECTION_REASONS } = require('./constants');

const nowIso = () => new Date().toISOString();
const money = alerts.money;

/** Which daily limit and which fee a transfer type is subject to. */
const TYPE_RULES = {
  internal: { limitKey: 'internalDaily', feeKey: null, method: 'internal', label: 'Transfer between accounts', clearing: 'Immediate' },
  ach: { limitKey: 'achDaily', feeKey: 'achOutgoing', method: 'ach', label: 'ACH transfer', clearing: '1-3 business days' },
  wire_domestic: { limitKey: 'wireDaily', feeKey: 'wireDomestic', method: 'wire_domestic', label: 'Domestic wire', clearing: 'Same business day' },
  wire_international: { limitKey: 'wireDaily', feeKey: 'wireInternational', method: 'wire_international', label: 'International wire', clearing: '2-5 business days' },
  instant: { limitKey: 'instantDaily', feeKey: null, method: 'instant', label: 'Instant send', clearing: 'Seconds' },
  bill_pay: { limitKey: 'billPayDaily', feeKey: null, method: 'bill_pay', label: 'Bill payment', clearing: '1-3 business days' },
};

function ruleFor(type) {
  return TYPE_RULES[type] || TYPE_RULES.ach;
}

function reasonLabel(code) {
  const found = REJECTION_REASONS.find((r) => r.code === code);
  return found ? found.label : 'Transfer could not be completed';
}

/* ------------------------------------------------------------ validate --- */

/**
 * Everything that can be checked before a penny moves.
 * Throws with a status and a message a customer can act on.
 */
async function validate(user, input) {
  const cfg = await settings.get();
  const rule = ruleFor(input.type);
  const amount = Math.round(Number(input.amount));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error('Enter an amount greater than zero.'), { status: 400 });
  }
  if (amount > cfg.limits.singleTransactionMax) {
    throw Object.assign(
      new Error(`The most you can send in one transfer is ${money(cfg.limits.singleTransactionMax)}. Call us to arrange a larger payment.`),
      { status: 400 }
    );
  }

  const from = await db.accounts.findById(input.fromAccountId);
  if (!from || from.user_id !== user.id) {
    throw Object.assign(new Error('Choose an account to send from.'), { status: 400 });
  }
  if (from.status !== 'active') {
    throw Object.assign(new Error(`That account is ${from.status}. Transfers are not available on it.`), { status: 409 });
  }

  const fee = rule.feeKey ? Number(cfg.fees[rule.feeKey] || 0) : 0;
  const total = amount + fee;
  const available = ledger.availableFor(from);
  if (total > available) {
    throw Object.assign(
      new Error(`Not enough available funds. ${money(available)} is available, and this transfer needs ${money(total)}.`),
      { status: 400, code: 'insufficient_funds' }
    );
  }

  const spentToday = await ledger.dailyTotal(user.id, [rule.method]);
  const limit = Number(cfg.limits[rule.limitKey] || 0);
  if (limit && spentToday + amount > limit) {
    throw Object.assign(
      new Error(`This would pass your ${money(limit)} daily limit for ${rule.label.toLowerCase()}s. ${money(Math.max(0, limit - spentToday))} is left today.`),
      { status: 400, code: 'limit_exceeded' }
    );
  }

  let to = null;
  let beneficiary = null;
  let payee = null;

  if (input.type === 'internal') {
    to = await db.accounts.findById(input.toAccountId);
    if (!to || to.user_id !== user.id) {
      throw Object.assign(new Error('Choose an account to send to.'), { status: 400 });
    }
    if (to.id === from.id) {
      throw Object.assign(new Error('Choose two different accounts.'), { status: 400 });
    }
  } else if (input.type === 'bill_pay') {
    payee = await db.payees.findById(input.payeeId);
    if (!payee || payee.user_id !== user.id) {
      throw Object.assign(new Error('Choose a payee.'), { status: 400 });
    }
  } else {
    beneficiary = await db.beneficiaries.findById(input.beneficiaryId);
    if (!beneficiary || beneficiary.user_id !== user.id) {
      throw Object.assign(new Error('Choose a recipient.'), { status: 400 });
    }
    if (beneficiary.status === 'blocked') {
      throw Object.assign(new Error('That recipient is blocked. Contact us to release it.'), { status: 409 });
    }
    if (input.type !== 'international_wire' && beneficiary.routing_number && !ids.validateRouting(beneficiary.routing_number)) {
      throw Object.assign(new Error('That recipient’s routing number is not valid.'), { status: 400, code: 'invalid_routing' });
    }
  }

  return { cfg, rule, amount, fee, total, from, to, beneficiary, payee };
}

/* -------------------------------------------------------------- submit --- */

/**
 * Accept a transfer instruction and put it into the right state.
 *
 * @returns {Promise<{transfer: object, next: 'verify'|'review'|'completed'|'scheduled', otp?: object}>}
 */
async function submit(user, input, req) {
  const { cfg, rule, amount, fee, total, from, to, beneficiary, payee } = await validate(user, input);

  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor).toISOString() : null;
  const isFuture = Boolean(scheduledFor) && scheduledFor > nowIso();

  const transfer = {
    id: ids.uuid(),
    created_at: nowIso(),
    user_id: user.id,
    type: input.type,
    method: rule.method,
    from_account_id: from.id,
    to_account_id: to ? to.id : null,
    beneficiary_id: beneficiary ? beneficiary.id : null,
    payee_id: payee ? payee.id : null,
    amount,
    fee,
    total,
    currency: from.currency || 'USD',
    memo: String(input.memo || '').slice(0, 140),
    purpose: input.purpose || '',
    status: 'draft',
    scheduled_for: scheduledFor,
    recurrence: input.recurrence || 'none',
    recurrence_end: input.recurrenceEnd || null,
    confirmation: ids.confirmation(),
    trace_number: null,
    imad: null,
    omad: null,
    requires_otp: Boolean(cfg.requireOtpForTransfers) && input.type !== 'internal',
    otp_verified: false,
    pin_verified: false,
    reason_code: null,
    reason_note: '',
    reviewed_by: null,
    reviewed_at: null,
    completed_at: null,
    debit_transaction_id: null,
    credit_transaction_id: null,
    ip: audit.clientIp(req),
    // What the recipient looked like at the moment of sending. A beneficiary
    // edited later must not rewrite the history of a payment already made.
    snapshot: beneficiary
      ? {
        name: beneficiary.name,
        nickname: beneficiary.nickname,
        bank: beneficiary.bank_name,
        accountMasked: ids.maskAccount(beneficiary.account_number),
        routing: beneficiary.routing_number,
        swift: beneficiary.swift,
        country: beneficiary.country,
        type: beneficiary.type,
      }
      : payee
        ? { name: payee.name, accountMasked: ids.maskAccount(payee.account_number), category: payee.category }
        : to
          ? { name: to.nickname || to.name, accountMasked: ids.maskAccount(to.account_number), type: to.type }
          : null,
  };

  // The transfer PIN, when the customer has one and the bank asks for it.
  if (cfg.requirePinForTransfers && user.transfer_pin_hash && input.type !== 'internal') {
    const security = require('./security');
    const ok = input.pin ? await security.verifySecret(String(input.pin), user.transfer_pin_hash) : false;
    if (!ok) {
      throw Object.assign(new Error('That transfer PIN is not correct.'), { status: 403, code: 'pin_required' });
    }
    transfer.pin_verified = true;
  }

  if (isFuture) {
    transfer.status = 'scheduled';
    await db.transfers.insert(transfer);
    await audit.log({
      action: 'transfer.scheduled', category: 'money', userId: user.id, req,
      actor: { id: user.id, email: user.email, role: user.role },
      detail: `Scheduled ${money(amount)} ${rule.label.toLowerCase()} for ${scheduledFor.slice(0, 10)}`,
      meta: { transferId: transfer.id },
    });
    await alerts.notifyUser(user, 'transfer_submitted', {
      subject: `Transfer scheduled - ${money(amount)}`,
      heading: 'Your transfer is scheduled',
      intro: `We will send ${money(amount)} on ${new Date(scheduledFor).toLocaleDateString('en-US', { dateStyle: 'long' })}.`,
      rows: receiptRows(transfer),
      cta: { label: 'View transfers', href: `${appUrl()}/transfers` },
    });
    return { transfer, next: 'scheduled' };
  }

  if (transfer.requires_otp) {
    transfer.status = 'pending_verification';
    await db.transfers.insert(transfer);
    const otp = await issueTransferOtp(user, transfer);
    return { transfer, next: 'verify', otp };
  }

  await db.transfers.insert(transfer);
  return finalise(user, transfer, req);
}

/** Send the one-time code that releases a transfer. */
async function issueTransferOtp(user, transfer) {
  const auth = require('./auth');
  const { code, expiresAt } = await auth.issueOtp(user, `transfer:${transfer.id}`, { transferId: transfer.id });
  await alerts.notifyUser(user, 'transfer_submitted', {
    force: true,
    subject: `Your Rockfield verification code: ${code}`,
    heading: 'Verify this transfer',
    intro: `Use code ${code} to release the transfer below. It expires in 10 minutes.`,
    rows: receiptRows(transfer),
    footNote: `If you did not start this transfer, do not enter the code - ${contact.callFraud()}.`,
  });
  const exposeCode = require('../utils/config').showDevCodes();
  if (exposeCode) {
    // Not necessarily because email is unconfigured - BANK_SHOW_DEV_CODES
    // turns this on deliberately too - and saying so while mail is working
    // sends whoever reads the log off after the wrong problem.
    console.log(`[rockfield] transfer OTP for ${user.email}: ${code} (codes are being shown; see BANK_SHOW_DEV_CODES)`);
  }
  return { expiresAt, devCode: exposeCode ? code : undefined };
}

/** Check the code, then push the transfer on to review or settlement. */
async function verify(user, transferId, code, req) {
  const transfer = await db.transfers.findById(transferId);
  if (!transfer || transfer.user_id !== user.id) {
    throw Object.assign(new Error('Transfer not found.'), { status: 404 });
  }
  if (transfer.status !== 'pending_verification') {
    throw Object.assign(new Error('That transfer is no longer waiting for a code.'), { status: 409 });
  }
  const auth = require('./auth');
  const result = await auth.verifyOtp(user, `transfer:${transfer.id}`, code);
  if (!result.ok) {
    const message = result.reason === 'expired'
      ? 'That code expired. Send a new one.'
      : result.reason === 'too_many_attempts'
        ? 'Too many attempts. Send a new code.'
        : 'That code is not correct.';
    await audit.log({
      action: 'transfer.otp_failed', category: 'security', userId: user.id, req, severity: 'warning',
      actor: { id: user.id, email: user.email, role: user.role },
      detail: `Failed verification on transfer ${transfer.confirmation}`,
    });
    throw Object.assign(new Error(message), { status: 400, code: result.reason });
  }
  await db.transfers.update(transfer.id, { otp_verified: true });
  return finalise(user, { ...transfer, otp_verified: true }, req);
}

/**
 * Decide between the review queue and settlement, then do whichever it is.
 * Called once a transfer has cleared every verification step in front of it.
 */
async function finalise(user, transfer, req) {
  const cfg = await settings.get();
  const needsReview = transfer.type !== 'internal'
    && (cfg.holdTransfersForReview || transfer.amount >= Number(cfg.holdThresholdCents || 0));

  if (needsReview) {
    // Hold the funds now: the money is committed even though the instruction
    // has not left yet, and the customer must not be able to spend it twice.
    const hold = await ledger.post({
      accountId: transfer.from_account_id,
      direction: 'debit',
      amount: transfer.total,
      description: describeOutgoing(transfer),
      method: transfer.method,
      category: 'Transfers',
      status: 'pending',
      memo: transfer.memo,
      transferId: transfer.id,
      counterparty: transfer.snapshot,
      reference: transfer.confirmation,
      createdBy: 'customer',
      createdById: user.id,
    });
    const patch = {
      status: 'pending_review',
      debit_transaction_id: hold.transaction.id,
      trace_number: transfer.method.startsWith('wire') ? null : ids.achTrace(BANK.routingNumber),
      imad: transfer.method.startsWith('wire') ? ids.imad() : null,
    };
    await db.transfers.update(transfer.id, patch);
    await audit.log({
      action: 'transfer.submitted', category: 'money', userId: user.id, req,
      actor: { id: user.id, email: user.email, role: user.role },
      detail: `${money(transfer.amount)} ${ruleFor(transfer.type).label.toLowerCase()} submitted for review`,
      meta: { transferId: transfer.id, confirmation: transfer.confirmation },
    });
    await alerts.notifyUser(user, 'transfer_submitted', {
      subject: `Transfer submitted - ${money(transfer.amount)}`,
      heading: 'We have your transfer',
      intro: 'It is with our payments team for review. You will get another email the moment it is released.',
      rows: receiptRows({ ...transfer, ...patch }),
      cta: { label: 'Track this transfer', href: `${appUrl()}/transfers` },
    });
    return { transfer: { ...transfer, ...patch }, next: 'review' };
  }

  return complete(user, transfer, { actor: 'customer', req });
}

/** Post the money and mark the transfer done. */
async function complete(user, transfer, { actor = 'system', actorId = null, req, note } = {}) {
  const fresh = await db.transfers.findById(transfer.id) || transfer;
  if (fresh.status === 'completed') return { transfer: fresh, next: 'completed' };

  const patch = {
    status: 'completed',
    completed_at: nowIso(),
    reviewed_by: actorId,
    reviewed_at: actor === 'admin' ? nowIso() : null,
    reason_note: note || fresh.reason_note || '',
  };

  if (fresh.debit_transaction_id) {
    // The money is already held; settling turns the hold into a posting.
    await ledger.settle(fresh.debit_transaction_id, { status: 'posted', note });
  } else {
    const debit = await ledger.post({
      accountId: fresh.from_account_id,
      direction: 'debit',
      amount: fresh.total,
      description: describeOutgoing(fresh),
      method: fresh.method,
      category: 'Transfers',
      status: 'posted',
      memo: fresh.memo,
      transferId: fresh.id,
      counterparty: fresh.snapshot,
      reference: fresh.confirmation,
      createdBy: actor,
      createdById: actorId || user.id,
    });
    patch.debit_transaction_id = debit.transaction.id;
  }

  // The receiving leg, when the other side is also us.
  if (fresh.type === 'internal' && fresh.to_account_id) {
    const credit = await ledger.post({
      accountId: fresh.to_account_id,
      direction: 'credit',
      amount: fresh.amount,
      description: describeIncoming(fresh),
      method: fresh.method,
      category: 'Transfers',
      status: 'posted',
      memo: fresh.memo,
      transferId: fresh.id,
      reference: fresh.confirmation,
      createdBy: actor,
      createdById: actorId || user.id,
    });
    patch.credit_transaction_id = credit.transaction.id;
  }

  if (fresh.method === 'wire_domestic' || fresh.method === 'wire_international') {
    patch.imad = fresh.imad || ids.imad();
    patch.omad = ids.omad();
  } else if (!fresh.trace_number) {
    patch.trace_number = ids.achTrace(BANK.routingNumber);
  }

  if (fresh.beneficiary_id) {
    await db.beneficiaries.update(fresh.beneficiary_id, { last_used_at: nowIso() });
  }
  if (fresh.payee_id) {
    await db.payees.update(fresh.payee_id, { last_paid_at: nowIso() });
  }

  await db.transfers.update(fresh.id, patch);
  const done = { ...fresh, ...patch };

  await audit.log({
    action: 'transfer.completed', category: 'money', userId: fresh.user_id, req,
    actor: { id: actorId || fresh.user_id, email: user && user.email, role: actor },
    detail: `${money(fresh.amount)} sent - ${fresh.confirmation}`,
    meta: { transferId: fresh.id },
  });
  if (user) {
    await alerts.notifyUser(user, 'transfer_completed', {
      subject: `Transfer sent - ${money(fresh.amount)}`,
      heading: 'Your transfer is on its way',
      intro: `${money(fresh.amount)} has left your account.`,
      rows: receiptRows(done),
      cta: { label: 'View receipt', href: `${appUrl()}/transfers` },
    });
  }
  return { transfer: done, next: 'completed' };
}

/** Stop a transfer and give the money back, with a reason the customer sees. */
async function reject(transfer, { reasonCode = 'other', note = '', actorId = null, actorEmail = '', req } = {}) {
  const fresh = await db.transfers.findById(transfer.id) || transfer;
  if (['completed', 'rejected', 'cancelled'].includes(fresh.status)) {
    throw Object.assign(new Error(`That transfer is already ${fresh.status}.`), { status: 409 });
  }
  if (fresh.debit_transaction_id) {
    await ledger.settle(fresh.debit_transaction_id, { status: 'failed', note: note || reasonLabel(reasonCode) });
  }
  const patch = {
    status: 'rejected',
    reason_code: reasonCode,
    reason_note: note || reasonLabel(reasonCode),
    reviewed_by: actorId,
    reviewed_at: nowIso(),
  };
  await db.transfers.update(fresh.id, patch);

  const user = await db.users.findById(fresh.user_id);
  await audit.log({
    action: 'transfer.rejected', category: 'money', userId: fresh.user_id, req, severity: 'warning',
    actor: { id: actorId, email: actorEmail, role: actorId ? 'admin' : 'system' },
    detail: `${money(fresh.amount)} returned - ${patch.reason_note}`,
    meta: { transferId: fresh.id, reasonCode },
  });
  if (user) {
    await alerts.notifyUser(user, 'transfer_rejected', {
      subject: `Transfer returned - ${money(fresh.amount)}`,
      heading: 'We could not complete this transfer',
      intro: patch.reason_note,
      rows: receiptRows({ ...fresh, ...patch }),
      body: `The funds are back in your available balance. Please ${contact.callSupport()} if you would like us to look at it with you.`,
      severity: 'warning',
    });
  }
  return { ...fresh, ...patch };
}

/** The customer pulling their own transfer back before it is released. */
async function cancel(user, transferId, req) {
  const transfer = await db.transfers.findById(transferId);
  if (!transfer || transfer.user_id !== user.id) {
    throw Object.assign(new Error('Transfer not found.'), { status: 404 });
  }
  if (!['pending_verification', 'pending_review', 'scheduled'].includes(transfer.status)) {
    throw Object.assign(new Error('This transfer can no longer be cancelled.'), { status: 409 });
  }
  if (transfer.debit_transaction_id) {
    await ledger.settle(transfer.debit_transaction_id, { status: 'failed', note: 'Cancelled by customer' });
  }
  const patch = { status: 'cancelled', reason_code: 'customer_request', reason_note: 'Cancelled by you', reviewed_at: nowIso() };
  await db.transfers.update(transfer.id, patch);
  await audit.log({
    action: 'transfer.cancelled', category: 'money', userId: user.id, req,
    actor: { id: user.id, email: user.email, role: user.role },
    detail: `${money(transfer.amount)} transfer cancelled`,
    meta: { transferId: transfer.id },
  });
  return { ...transfer, ...patch };
}

/** Scheduled transfers that have come due. Called on request and by cron. */
async function runScheduled({ now = new Date() } = {}) {
  const due = await db.transfers.find({ status: 'scheduled' });
  const ready = due.filter((t) => t.scheduled_for && t.scheduled_for <= now.toISOString());
  const results = [];
  for (const transfer of ready) {
    const user = await db.users.findById(transfer.user_id);
    if (!user) continue;
    try {
      const out = await finalise(user, { ...transfer, status: 'processing' }, null);
      results.push({ id: transfer.id, status: out.transfer.status });
      if (transfer.recurrence && transfer.recurrence !== 'none') await scheduleNext(transfer);
    } catch (err) {
      await reject(transfer, { reasonCode: err.code || 'other', note: err.message });
      results.push({ id: transfer.id, status: 'rejected', error: err.message });
    }
  }
  return results;
}

/** The next instance of a recurring instruction. */
async function scheduleNext(transfer) {
  const base = new Date(transfer.scheduled_for || Date.now());
  const next = new Date(base);
  if (transfer.recurrence === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else if (transfer.recurrence === 'biweekly') next.setUTCDate(next.getUTCDate() + 14);
  else if (transfer.recurrence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
  else return null;
  if (transfer.recurrence_end && next.toISOString() > transfer.recurrence_end) return null;

  const copy = {
    ...transfer,
    id: ids.uuid(),
    created_at: nowIso(),
    status: 'scheduled',
    scheduled_for: next.toISOString(),
    confirmation: ids.confirmation(),
    debit_transaction_id: null,
    credit_transaction_id: null,
    completed_at: null,
    reviewed_at: null,
    reviewed_by: null,
    reason_code: null,
    reason_note: '',
    parent_transfer_id: transfer.id,
  };
  await db.transfers.insert(copy);
  return copy;
}

/* ------------------------------------------------------------ wording --- */

function describeOutgoing(transfer) {
  const who = (transfer.snapshot && (transfer.snapshot.nickname || transfer.snapshot.name)) || 'recipient';
  switch (transfer.type) {
    case 'internal': return `Transfer to ${who}`;
    case 'wire_domestic': return `WIRE OUT ${String(who).toUpperCase()}`;
    case 'wire_international': return `INTL WIRE OUT ${String(who).toUpperCase()}`;
    case 'instant': return `INSTANT SEND ${String(who).toUpperCase()}`;
    case 'bill_pay': return `BILL PAY ${String(who).toUpperCase()}`;
    default: return `ACH TRANSFER ${String(who).toUpperCase()}`;
  }
}

function describeIncoming(transfer) {
  return transfer.type === 'internal' ? 'Transfer from account' : 'Incoming transfer';
}

/** The lines on a receipt and in an alert email. */
function receiptRows(transfer) {
  const rows = [
    { label: 'Amount', value: money(transfer.amount) },
  ];
  if (transfer.fee) rows.push({ label: 'Fee', value: money(transfer.fee) });
  if (transfer.fee) rows.push({ label: 'Total debited', value: money(transfer.total) });
  rows.push({ label: 'Type', value: ruleFor(transfer.type).label });
  if (transfer.snapshot && transfer.snapshot.name) {
    rows.push({ label: 'To', value: `${transfer.snapshot.name}${transfer.snapshot.accountMasked ? ` (${transfer.snapshot.accountMasked})` : ''}` });
  }
  if (transfer.snapshot && transfer.snapshot.bank) rows.push({ label: 'Receiving bank', value: transfer.snapshot.bank });
  rows.push({ label: 'Confirmation', value: transfer.confirmation });
  if (transfer.trace_number) rows.push({ label: 'ACH trace', value: transfer.trace_number });
  if (transfer.imad) rows.push({ label: 'IMAD', value: transfer.imad });
  if (transfer.memo) rows.push({ label: 'Memo', value: transfer.memo });
  rows.push({ label: 'Status', value: statusLabel(transfer.status) });
  return rows;
}

const STATUS_LABELS = {
  draft: 'Draft',
  pending_verification: 'Awaiting your code',
  pending_review: 'In review',
  scheduled: 'Scheduled',
  processing: 'Processing',
  completed: 'Completed',
  rejected: 'Returned',
  cancelled: 'Cancelled',
  failed: 'Failed',
};
const statusLabel = (status) => STATUS_LABELS[status] || status;

const appUrl = require('../utils/config').baseUrl;

/** The shape sent to the browser. */
function publicTransfer(transfer) {
  if (!transfer) return null;
  return {
    id: transfer.id,
    createdAt: transfer.created_at,
    type: transfer.type,
    typeLabel: ruleFor(transfer.type).label,
    method: transfer.method,
    fromAccountId: transfer.from_account_id,
    toAccountId: transfer.to_account_id,
    beneficiaryId: transfer.beneficiary_id,
    payeeId: transfer.payee_id,
    amount: transfer.amount,
    fee: transfer.fee,
    total: transfer.total,
    currency: transfer.currency,
    memo: transfer.memo,
    purpose: transfer.purpose,
    status: transfer.status,
    statusLabel: statusLabel(transfer.status),
    scheduledFor: transfer.scheduled_for,
    recurrence: transfer.recurrence,
    confirmation: transfer.confirmation,
    traceNumber: transfer.trace_number,
    imad: transfer.imad,
    omad: transfer.omad,
    reasonCode: transfer.reason_code,
    reasonNote: transfer.reason_note,
    reviewedAt: transfer.reviewed_at,
    completedAt: transfer.completed_at,
    recipient: transfer.snapshot,
    clearing: ruleFor(transfer.type).clearing,
    receipt: receiptRows(transfer),
  };
}

module.exports = {
  validate,
  submit,
  verify,
  finalise,
  complete,
  reject,
  cancel,
  runScheduled,
  scheduleNext,
  issueTransferOtp,
  publicTransfer,
  receiptRows,
  statusLabel,
  ruleFor,
  reasonLabel,
  TYPE_RULES,
};
