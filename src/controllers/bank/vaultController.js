'use strict';

/**
 * Receiving Bitcoin into the vault and sending it out: the customer's side
 * (details, requests, the history of everything that moved) and the staff
 * queue that confirms each request.
 */

const vault = require('../../bank/vault');
const invest = require('../../bank/invest');
const { db } = require('../../bank/db');
const { asyncHandler, toCents } = require('../../bank/http');

/* ------------------------------------------------------------ customer --- */

/** GET /vault - the vault address, the OTC partner, the terms, what is ready to send, and recent requests. */
const details = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await vault.detailsFor(req.bankUser));
});

/** POST /vault/receive - "I have paid" or "I have sent". */
const receive = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const result = await vault.requestReceive(req.bankUser, {
    kind: b.kind,
    amount: b.amount != null && b.amount !== '' ? toCents(b.amount) : undefined,
    units: b.units,
    occurredAt: b.occurredAt,
    termYears: b.termYears,
    txid: b.txid,
    note: b.note,
  }, req);
  res.status(201).json(result);
});

/** POST /vault/send - ask for matured Bitcoin to be sent to an address. */
const send = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const result = await vault.requestSend(req.bankUser, { units: b.units, address: b.address, note: b.note, pin: b.pin }, req);
  res.status(201).json(result);
});

/** POST /vault/details-request - ask staff for payment details or a vault address. */
const askForDetails = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const result = await vault.requestDetails(req.bankUser, { need: b.need, note: b.note }, req);
  res.status(result.already ? 200 : 201).json(result);
});

const verify = asyncHandler(async (req, res) => {
  res.json(await vault.verifySend(req.bankUser, req.params.id, (req.body || {}).code, req));
});

const resend = asyncHandler(async (req, res) => {
  res.json(await vault.resendCode(req.bankUser, req.params.id));
});

const cancel = asyncHandler(async (req, res) => {
  res.json(await vault.cancel(req.bankUser, req.params.id, req));
});

const KIND_LABEL = {
  cash: 'Paid in cash (OTC)', bitcoin: 'Bitcoin received', sent: 'Bitcoin sent',
  converted: 'Converted to Bitcoin', bought: 'Bought', sold: 'Sold',
};

/** Everything that moved in or out of the vault, newest first. */
async function movements(userId) {
  const rows = await db.trades.find({ user_id: userId, symbol: 'BTC' }, { order: 'created_at.desc' });
  return rows.map(invest.publicTrade).map((t) => ({ ...t, label: KIND_LABEL[t.kind] || t.kind }));
}

/** GET /vault/history - every movement, filterable by kind and date. */
const history = asyncHandler(async (req, res) => {
  let rows = await movements(req.bankUser.id);
  const { kind, from, to } = req.query;
  if (kind) rows = rows.filter((t) => (kind === 'in' ? t.side === 'buy' : kind === 'out' ? t.side !== 'buy' : t.kind === kind));
  if (from) rows = rows.filter((t) => t.createdAt.slice(0, 10) >= String(from));
  if (to) rows = rows.filter((t) => t.createdAt.slice(0, 10) <= String(to));
  res.set('Cache-Control', 'no-store');
  res.json({ movements: rows, labels: KIND_LABEL });
});

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /vault/history/export - the same as a CSV file. */
const exportHistory = asyncHandler(async (req, res) => {
  const rows = await movements(req.bankUser.id);
  const head = ['Date', 'What', 'Bitcoin', 'Bitcoin price (USD)', 'Value (USD)', 'Term', 'Matures', 'Reference', 'Status'];
  const lines = rows.map((t) => [
    t.createdAt.slice(0, 10), t.label, `${t.side === 'buy' ? '' : '-'}${t.units}`, (Number(t.price) / 100).toFixed(2),
    (Number(t.amount) / 100).toFixed(2), t.termMonths ? invest.termLabel(t.termMonths) : '', t.maturesAt ? t.maturesAt.slice(0, 10) : '',
    t.reference, t.status,
  ].map(csvCell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="vault-history-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([head.join(','), ...lines].join('\n'));
});

/* --------------------------------------------------------------- staff --- */

/** GET /admin/vault/requests?status=pending|all|completed|rejected */
const staffQueue = asyncHandler(async (req, res) => {
  const requests = await vault.queue({ status: String(req.query.status || 'pending') });
  res.set('Cache-Control', 'no-store');
  res.json({ requests });
});

/** POST /admin/vault/requests/:id/confirm - book what arrived, or record the send that was made. */
const staffConfirm = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const result = await vault.confirm(req.params.id, req.bankUser, {
    amount: b.amount != null && b.amount !== '' ? toCents(b.amount) : undefined,
    units: b.units,
    occurredAt: b.occurredAt,
    termYears: b.termYears,
    txid: b.txid,
    note: b.note,
    // Answering a request for details.
    address: b.address,
    addressLabel: b.addressLabel,
    otc: b.otc && typeof b.otc === 'object' ? b.otc : undefined,
  }, req);
  res.json(result);
});

/** GET /admin/customers/:id/vault-details - this customer's own details, the platform's, and what they see. */
const staffDetails = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await vault.detailsForStaff(req.params.id));
});

/** PUT /admin/customers/:id/vault-details - set or clear this customer's own address and payment details. */
const staffSetDetails = asyncHandler(async (req, res) => {
  const b = req.body || {};
  res.json(await vault.setOwnDetails(req.params.id, {
    address: b.address,
    addressLabel: b.addressLabel,
    otc: b.otc && typeof b.otc === 'object' ? b.otc : undefined,
  }, req.bankUser, req));
});

/** POST /admin/vault/requests/:id/reject - with the reason the customer will read. */
const staffReject = asyncHandler(async (req, res) => {
  res.json(await vault.reject(req.params.id, req.bankUser, (req.body || {}).reason, req));
});

module.exports = {
  details, receive, send, verify, resend, cancel, history, exportHistory,
  staffQueue, staffConfirm, staffReject, askForDetails, staffDetails, staffSetDetails,
};
