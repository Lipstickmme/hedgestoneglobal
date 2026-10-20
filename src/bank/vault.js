'use strict';

/**
 * Requests to move Bitcoin into or out of a customer's vault, and what a
 * customer needs to make one: the vault address and the OTC partner's
 * payment details, both set by staff under Settings.
 *
 *   cash_in   "I have paid $X to the OTC partner on this date"
 *   btc_in    "I have sent X BTC to the vault address on this date"
 *   btc_out   "Send X BTC of my matured Bitcoin to this address"
 *
 * Nothing moves until a member of staff confirms it (confirm()): a payment
 * or a transfer is checked against what actually arrived, then booked into
 * the vault at Bitcoin's price on the day it happened (invest.addToVault); a
 * send is checked against what has matured, made from the vault's wallet,
 * and then recorded (invest.sendFromVault). A request to send is verified by
 * an emailed code first, and by the customer's PIN when they have set one.
 */

const crypto = require('crypto');
const { db } = require('./db');
const ids = require('./ids');
const settings = require('./settings');
const security = require('./security');
const alerts = require('./alerts');
const audit = require('./audit');
const invest = require('./invest');
const { money } = require('./http');

const nowIso = () => new Date().toISOString();
const err = (status, message, code, extra) => Object.assign(new Error(message), { status, code }, extra || {});
const { toScaled, fromScaled } = invest._units;

const OPEN = ['pending_verification', 'pending'];
const LABEL = { cash_in: 'Cash through the OTC partner', btc_in: 'Bitcoin received', btc_out: 'Bitcoin sent out' };

/* --------------------------------------------------------- the details --- */

/** The vault addresses from Settings: one a line, an optional label after the address. */
function vaultAddresses(cfg) {
  return String((cfg && cfg.vaultAddresses) || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [address, ...label] = line.split(/\s+/);
      return { address, label: label.join(' ') };
    })
    .filter((a) => isBitcoinAddress(a.address));
}

/** The address a customer sends to: always the same one for the same customer. */
function addressFor(user, cfg) {
  const list = vaultAddresses(cfg);
  if (!list.length) return null;
  const n = crypto.createHash('sha256').update(String(user.id)).digest().readUInt32BE(0);
  return list[n % list.length];
}

/** The OTC partner's payment details, or null until the name and the number to pay are set. */
function otcDetails(cfg) {
  const o = (cfg && cfg.otc) || {};
  const clean = (v) => String(v || '').trim();
  const details = {
    name: clean(o.name), bankName: clean(o.bankName), accountName: clean(o.accountName),
    accountNumber: clean(o.accountNumber), routingNumber: clean(o.routingNumber), swift: clean(o.swift),
    instructions: clean(o.instructions),
  };
  return details.accountName && details.accountNumber ? details : null;
}

/** Mainnet addresses: bech32 (bc1...) and the older base58 forms (1..., 3...). */
function isBitcoinAddress(value) {
  const v = String(value || '').trim();
  return /^bc1[02-9ac-hj-np-z]{11,71}$/i.test(v) || /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(v);
}

const isTxid = (v) => /^[0-9a-f]{64}$/i.test(String(v || '').trim());

/** What the customer quotes with a cash payment, so the partner can match it to them. */
const paymentReference = (user) => String(user.customer_number || user.id.slice(0, 8)).toUpperCase();

function publicRequest(r) {
  return {
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind,
    label: LABEL[r.kind] || r.kind,
    status: r.status,
    amount: r.amount == null ? null : Number(r.amount),
    units: r.units == null ? null : String(r.units),
    address: r.address || '',
    txid: r.txid || '',
    occurredAt: r.occurred_at,
    termMonths: r.term_months == null ? null : Number(r.term_months),
    termYears: r.term_months == null ? null : Number(r.term_months) / 12,
    reference: r.reference,
    note: r.note || '',
    decidedAt: r.decided_at,
    decisionNote: r.decision_note || '',
    tradeId: r.trade_id,
  };
}

/** What the Receive and Send screens need. */
async function detailsFor(user) {
  const cfg = await settings.get();
  const [ready, rows] = await Promise.all([
    invest.maturedUnits(user.id),
    db.vaultRequests.find({ user_id: user.id }, { order: 'created_at.desc', limit: 25 }),
  ]);
  return {
    address: addressFor(user, cfg),
    otc: otcDetails(cfg),
    paymentReference: paymentReference(user),
    terms: { min: invest.TERM_YEARS.min, max: invest.TERM_YEARS.max, default: invest.defaultTermYears(cfg) },
    earliest: require('./constants').VAULT.earliest,
    ready: fromScaled(ready, 8),
    sendFee: Number((cfg.fees && cfg.fees.vaultSend) || 0),
    hasPin: Boolean(user.transfer_pin_hash),
    requests: rows.map(publicRequest),
  };
}

/* ------------------------------------------------------- the customer --- */

/** A date the customer says something happened: not before the earliest, not in the future. */
function occurredDate(value) {
  if (!value) return nowIso();
  const when = new Date(value);
  const { VAULT } = require('./constants');
  if (Number.isNaN(when.getTime())) throw err(400, 'Enter a valid date.', 'invalid_date');
  if (when.getTime() > Date.now() + 60000) throw err(400, 'That date is in the future.', 'future_date');
  if (when.toISOString().slice(0, 10) < VAULT.earliest) throw err(400, `The earliest date that can be used is ${VAULT.earliest}.`, 'before_earliest');
  return when.toISOString();
}

/**
 * "I have paid" or "I have sent": recorded for staff to confirm.
 *
 * @param {object} input  { kind: 'cash' | 'bitcoin', amount (cents) | units, occurredAt, termYears, txid, note }
 */
async function requestReceive(user, input, req) {
  const cfg = await settings.get();
  const kind = input.kind === 'bitcoin' ? 'btc_in' : 'cash_in';
  const termMonths = invest.termFor(input.termYears, cfg);
  const row = {
    id: ids.uuid(), created_at: nowIso(), user_id: user.id, kind, status: 'pending',
    occurred_at: occurredDate(input.occurredAt), term_months: termMonths,
    note: String(input.note || '').slice(0, 300) || null,
  };
  if (kind === 'cash_in') {
    if (!otcDetails(cfg)) throw err(409, 'Cash payments are not open yet. Send us a message and we will tell you how to pay.', 'otc_unavailable');
    const amount = Math.round(Number(input.amount));
    if (!Number.isFinite(amount) || amount < invest.MIN_BUY) throw err(400, `The smallest amount is ${money(invest.MIN_BUY)}.`, 'below_minimum');
    row.amount = amount;
    row.reference = ids.reference('OTC');
  } else {
    const address = addressFor(user, cfg);
    if (!address) throw err(409, 'Bitcoin cannot be received yet. Send us a message and we will give you an address.', 'no_vault_address');
    const units = toScaled(input.units, 8);
    if (units <= 0n) throw err(400, 'Enter how much Bitcoin you sent.', 'invalid_units');
    if (input.txid && !isTxid(input.txid)) throw err(400, 'A transaction ID is 64 letters and numbers. Leave it blank if you do not have it.', 'invalid_txid');
    row.units = fromScaled(units, 8);
    row.address = address.address;
    row.txid = input.txid ? String(input.txid).trim().toLowerCase() : null;
    row.reference = ids.reference('RCV');
  }
  await db.vaultRequests.insert(row);
  await audit.log({
    action: `vault.${kind}_requested`, category: 'money', userId: user.id, req,
    actor: { id: user.id, email: user.email, role: 'customer' },
    detail: `${LABEL[kind]}: ${kind === 'cash_in' ? money(row.amount) : `${row.units} BTC`} on ${row.occurred_at.slice(0, 10)} - ${row.reference}`,
    meta: { requestId: row.id },
  });
  await alerts.notifyUser(user, 'vault_request', {
    subject: `We have your ${kind === 'cash_in' ? 'payment' : 'Bitcoin'} details`,
    heading: kind === 'cash_in' ? 'Payment noted' : 'Transfer noted',
    intro: kind === 'cash_in'
      ? `Thank you. Once the OTC partner confirms your payment of ${money(row.amount)}, we will add the Bitcoin it bought on ${new Date(row.occurred_at).toLocaleDateString('en-US', { dateStyle: 'long' })} to your vault and let you know.`
      : `Thank you. Once your ${row.units} BTC has arrived and been confirmed on the Bitcoin network, we will add it to your vault and let you know.`,
    rows: [
      { label: 'Reference', value: row.reference },
      { label: 'Term', value: invest.termLabel(termMonths) },
    ],
  }).catch(() => {});
  return { request: publicRequest(row) };
}

/** Ask for matured Bitcoin to be sent to an address. Verified by code before staff see it. */
async function requestSend(user, input, req) {
  const cfg = await settings.get();
  const address = String(input.address || '').trim();
  if (!isBitcoinAddress(address)) throw err(400, 'That is not a Bitcoin address. Check it and paste it again.', 'invalid_address');
  const units = toScaled(input.units, 8);
  if (units <= 0n) throw err(400, 'Enter how much Bitcoin to send.', 'invalid_units');
  const ready = await invest.maturedUnits(user.id);
  if (units > ready) {
    throw err(409, ready > 0n
      ? `Only Bitcoin that has matured can be sent. ${fromScaled(ready, 8)} BTC is ready.`
      : 'None of your Bitcoin has matured yet. It can be sent once it reaches its maturity date.', 'not_matured');
  }
  if (cfg.requirePinForTransfers && user.transfer_pin_hash) {
    const ok = input.pin ? await security.verifySecret(String(input.pin), user.transfer_pin_hash) : false;
    if (!ok) throw err(403, 'That PIN is not correct.', 'pin_required');
  }
  const row = {
    id: ids.uuid(), created_at: nowIso(), user_id: user.id, kind: 'btc_out',
    status: cfg.requireOtpForTransfers === false ? 'pending' : 'pending_verification',
    units: fromScaled(units, 8), address, reference: ids.reference('SND'),
    note: String(input.note || '').slice(0, 300) || null, otp_verified: false,
  };
  await db.vaultRequests.insert(row);
  await audit.log({
    action: 'vault.send_requested', category: 'money', userId: user.id, req, severity: 'notice',
    actor: { id: user.id, email: user.email, role: 'customer' },
    detail: `Asked to send ${row.units} BTC to ${address} - ${row.reference}`,
    meta: { requestId: row.id },
  });
  if (row.status === 'pending') return { request: publicRequest(row), next: 'review' };
  const otp = await issueCode(user, row);
  return { request: publicRequest(row), next: 'verify', otp };
}

async function issueCode(user, row) {
  const auth = require('./auth');
  const { code, expiresAt } = await auth.issueOtp(user, `vault:${row.id}`, { requestId: row.id });
  await alerts.notifyUser(user, 'vault_request', {
    force: true,
    subject: `Your verification code: ${code}`,
    heading: 'Confirm this send',
    intro: `Use code ${code} to confirm sending ${row.units} BTC to ${row.address}. It expires in 10 minutes.`,
    rows: [{ label: 'Reference', value: row.reference }],
    footNote: 'If you did not ask to send Bitcoin, do not enter the code, and change your password.',
  });
  const expose = require('../utils/config').showDevCodes();
  if (expose) console.log(`[hedgestone] vault OTP for ${user.email}: ${code} (codes are being shown; see BANK_SHOW_DEV_CODES)`);
  return { expiresAt, devCode: expose ? code : undefined };
}

async function mine(user, id) {
  const row = await db.vaultRequests.findById(id);
  if (!row || row.user_id !== user.id) throw err(404, 'Request not found.');
  return row;
}

async function verifySend(user, id, code, req) {
  const row = await mine(user, id);
  if (row.status !== 'pending_verification') throw err(409, 'That request is no longer waiting for a code.');
  const result = await require('./auth').verifyOtp(user, `vault:${row.id}`, code);
  if (!result.ok) {
    await audit.log({
      action: 'vault.otp_failed', category: 'security', userId: user.id, req, severity: 'warning',
      actor: { id: user.id, email: user.email, role: 'customer' }, detail: `Failed verification on ${row.reference}`,
    });
    const message = result.reason === 'expired' ? 'That code expired. Send a new one.'
      : result.reason === 'too_many_attempts' ? 'Too many attempts. Send a new code.' : 'That code is not correct.';
    throw err(400, message, result.reason);
  }
  const patch = { status: 'pending', otp_verified: true, updated_at: nowIso() };
  await db.vaultRequests.update(row.id, patch);
  await alerts.notifyUser(user, 'vault_request', {
    subject: 'Your request to send Bitcoin is with us',
    heading: 'Request received',
    intro: `We will check your request to send ${row.units} BTC to ${row.address} and let you know when it has gone.`,
    rows: [{ label: 'Reference', value: row.reference }],
  }).catch(() => {});
  return { request: publicRequest({ ...row, ...patch }) };
}

async function resendCode(user, id) {
  const row = await mine(user, id);
  if (row.status !== 'pending_verification') throw err(409, 'That request is no longer waiting for a code.');
  return { otp: await issueCode(user, row) };
}

async function cancel(user, id, req) {
  const row = await mine(user, id);
  if (!OPEN.includes(row.status)) throw err(409, 'Only a request that is still waiting can be cancelled.');
  const patch = { status: 'cancelled', updated_at: nowIso() };
  await db.vaultRequests.update(row.id, patch);
  await audit.log({
    action: 'vault.request_cancelled', category: 'money', userId: user.id, req,
    actor: { id: user.id, email: user.email, role: 'customer' }, detail: `Cancelled ${row.reference}`,
  });
  return { request: publicRequest({ ...row, ...patch }) };
}

/* -------------------------------------------------------------- staff --- */

/** Requests for the staff queue, newest first, with who made them and, for sends, what has matured. */
async function queue({ status = 'pending', limit = 100 } = {}) {
  const where = status === 'all' ? {} : { status };
  const rows = await db.vaultRequests.find(where, { order: 'created_at.desc', limit });
  const people = await db.users.findByIds(rows.map((r) => r.user_id));
  const ready = new Map();
  for (const r of rows.filter((x) => x.kind === 'btc_out' && OPEN.includes(x.status))) {
    // eslint-disable-next-line no-await-in-loop
    if (!ready.has(r.id)) ready.set(r.id, fromScaled(await invest.maturedUnits(r.user_id, { excluding: r.id }), 8));
  }
  return rows.map((r) => {
    const u = people.get(r.user_id);
    return {
      ...publicRequest(r),
      customer: u ? { id: u.id, fullName: `${u.first_name || ''} ${u.last_name || ''}`.trim(), email: u.email } : { id: r.user_id, fullName: 'Unknown', email: '' },
      ready: ready.get(r.id) || null,
    };
  });
}

/**
 * Confirm a request. For money coming in, staff may correct what arrived and
 * when before it is booked; for a send, `txid` is the transaction they made.
 */
async function confirm(id, staff, input, req) {
  const row = await db.vaultRequests.findById(id);
  if (!row) throw err(404, 'Request not found.');
  if (row.status !== 'pending') throw err(409, row.status === 'pending_verification' ? 'The customer has not confirmed this request with their code yet.' : `That request is ${row.status}.`);
  const user = await db.users.findById(row.user_id);
  if (!user) throw err(404, 'Customer not found.');
  const note = String(input.note || '').slice(0, 300);
  const opts = { staff };
  let result;
  if (row.kind === 'btc_out') {
    if (input.txid && !isTxid(input.txid)) throw err(400, 'A transaction ID is 64 letters and numbers.', 'invalid_txid');
    result = await invest.sendFromVault(user, {
      units: row.units, address: row.address, txid: input.txid || null, requestId: row.id, reference: row.reference,
    }, req, opts);
  } else {
    const termYears = input.termYears != null && input.termYears !== '' ? input.termYears : Number(row.term_months) / 12;
    result = await invest.addToVault(user, {
      kind: row.kind === 'btc_in' ? 'bitcoin' : 'cash',
      amount: input.amount != null && input.amount !== '' ? input.amount : row.amount,
      units: input.units != null && input.units !== '' ? input.units : row.units,
      at: input.occurredAt || row.occurred_at,
      termYears,
      reference: row.reference,
      note: note || null,
    }, req, opts);
  }
  const patch = {
    status: 'completed', updated_at: nowIso(), decided_at: nowIso(), decided_by: staff.id,
    decision_note: note || null, trade_id: result.trade.id,
    txid: input.txid ? String(input.txid).trim().toLowerCase() : row.txid || null,
  };
  await db.vaultRequests.update(row.id, patch);
  return { request: publicRequest({ ...row, ...patch }), trade: result.trade };
}

async function reject(id, staff, reason, req) {
  const row = await db.vaultRequests.findById(id);
  if (!row) throw err(404, 'Request not found.');
  if (!OPEN.includes(row.status)) throw err(409, `That request is ${row.status}.`);
  const why = String(reason || '').trim().slice(0, 300);
  if (!why) throw err(400, 'Say why, for the customer.');
  const patch = { status: 'rejected', updated_at: nowIso(), decided_at: nowIso(), decided_by: staff.id, decision_note: why };
  await db.vaultRequests.update(row.id, patch);
  const user = await db.users.findById(row.user_id);
  await audit.log({
    action: 'vault.request_rejected', category: 'admin', userId: row.user_id, req, severity: 'notice',
    actor: { id: staff.id, email: staff.email, role: 'admin' }, detail: `Rejected ${row.reference}: ${why}`,
  });
  if (user) {
    await alerts.notifyUser(user, 'vault_request', {
      subject: `About your request ${row.reference}`,
      heading: 'We could not complete your request',
      intro: `${LABEL[row.kind]}: ${why}`,
      rows: [{ label: 'Reference', value: row.reference }],
    }).catch(() => {});
  }
  return { request: publicRequest({ ...row, ...patch }) };
}

module.exports = {
  detailsFor, requestReceive, requestSend, verifySend, resendCode, cancel, queue, confirm, reject,
  vaultAddresses, addressFor, otcDetails, isBitcoinAddress, publicRequest, OPEN,
};
