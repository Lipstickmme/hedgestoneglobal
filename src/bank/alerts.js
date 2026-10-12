'use strict';

/**
 * Email alerts and the notification centre behind them.
 *
 * Every alert is written to the `alerts` collection first and only then
 * attempted over email, so the customer sees it in the app whether or not
 * Resend is configured, and an operator can see which ones failed to leave.
 *
 * Preference handling lives here too: a customer can silence most alerts, but
 * the ones marked `locked` in ALERT_TYPES - a password change, a rejected
 * transfer, an overdraft - go out regardless, which is what the regulation and
 * plain decency both want.
 */

const { db } = require('./db');
const ids = require('./ids');
const settings = require('./settings');
const contact = require('./contact');
const sms = require('./sms');
const { ALERT_TYPES, BANK } = require('./constants');

const TYPES = new Map(ALERT_TYPES.map((t) => [t.id, t]));

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Money in cents to the string a customer recognises. */
function money(cents, currency = 'USD') {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

/** Default preferences, overlaid with whatever the customer has chosen. */
function preferencesFor(user) {
  const stored = (user && user.alert_prefs) || {};
  const out = {};
  ALERT_TYPES.forEach((type) => {
    out[type.id] = type.locked ? true : stored[type.id] !== undefined ? Boolean(stored[type.id]) : type.default;
  });
  return out;
}

function wantsAlert(user, typeId) {
  const type = TYPES.get(typeId);
  if (type && type.locked) return true;
  return Boolean(preferencesFor(user)[typeId]);
}

/* -------------------------------------------------------------- the mail --- */

/**
 * The HTML part. Built as a table so it survives Outlook, and with an inline
 * palette because email clients strip stylesheets.
 */
function renderEmail({ heading, intro, rows = [], body = '', cta, footNote, bankName }) {
  const name = bankName || BANK.name;
  // Blank until an operator sets it at the console, in which case the whole
  // postal line comes out of the footer rather than leaving a dangling
  // separator before "Member FDIC".
  const postal = contact.addressLine();
  const rowsHtml = rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-collapse:collapse">
        ${rows.map((r) => `<tr>
          <td style="padding:9px 0;border-bottom:1px solid #e8e5df;color:#6c6760;font:13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(r.label)}</td>
          <td style="padding:9px 0;border-bottom:1px solid #e8e5df;color:#191714;font:600 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:right">${escapeHtml(r.value)}</td>
        </tr>`).join('')}
      </table>`
    : '';
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f2ee">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e4e0d8;border-radius:14px;overflow:hidden">
        <tr><td style="background:#11213a;padding:20px 26px">
          <span style="color:#ffffff;font:700 17px/1.2 Georgia,'Times New Roman',serif;letter-spacing:.02em">${escapeHtml(name)}</span>
          <span style="display:block;color:#9fb2cc;font:500 11px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase">Member FDIC</span>
        </td></tr>
        <tr><td style="padding:26px">
          <h1 style="margin:0 0 10px;color:#11213a;font:600 21px/1.3 Georgia,'Times New Roman',serif">${escapeHtml(heading)}</h1>
          ${intro ? `<p style="margin:0 0 14px;color:#4a4640;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(intro)}</p>` : ''}
          ${rowsHtml}
          ${body ? `<p style="margin:0 0 14px;color:#4a4640;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;white-space:pre-wrap">${escapeHtml(body)}</p>` : ''}
          ${cta ? `<p style="margin:22px 0 0"><a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#11213a;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font:600 14px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(cta.label)}</a></p>` : ''}
          ${footNote ? `<p style="margin:22px 0 0;color:#847f76;font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">${escapeHtml(footNote)}</p>` : ''}
        </td></tr>
        <tr><td style="background:#faf8f4;border-top:1px solid #e8e5df;padding:18px 26px;color:#847f76;font:400 11px/1.7 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
          ${escapeHtml(name)} will never ask for your password, one-time code or full card number by email or phone.<br />
          If you did not expect this message, ${escapeHtml(contact.callFraud())} straight away.<br />
          ${postal ? `${escapeHtml(postal)} &middot; ` : ''}Member FDIC &middot; Equal Housing Lender
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** The text part: the same content, readable without HTML. */
function renderText({ heading, intro, rows = [], body = '', cta, footNote, bankName }) {
  const questions = contact.supportLine('Questions');
  const lines = [heading, ''];
  if (intro) lines.push(intro, '');
  rows.forEach((r) => lines.push(`${r.label}: ${r.value}`));
  if (rows.length) lines.push('');
  if (body) lines.push(body, '');
  if (cta) lines.push(`${cta.label}: ${cta.href}`, '');
  if (footNote) lines.push(footNote, '');
  lines.push(`${bankName || BANK.name} will never ask for your password or one-time code.`);
  // Left out entirely rather than printed as a label with nothing after it.
  if (questions) lines.push(questions);
  return lines.join('\n');
}

/**
 * The text version: one sentence, and the bank's name first.
 *
 * A phone shows the opening words in the notification shade, so the name and
 * the amount have to be at the front. Callers can pass `sms` to write their
 * own; this is the fallback, built from the same content the email uses.
 */
function smsText({ heading, intro, body, rows = [], bankName }) {
  const name = bankName || BANK.name;
  const lead = intro || body || heading || 'Account notification';
  const detail = rows
    .filter((r) => /balance|amount|reference/i.test(r.label))
    .map((r) => `${r.label}: ${r.value}`)
    .join('. ');
  return [`${name}: ${lead}`, detail].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 320);
}

/* ---------------------------------------------------------------- send --- */

/**
 * Raise an alert with a customer.
 *
 * @param {object} user      the customer row
 * @param {string} typeId    one of ALERT_TYPES
 * @param {object} content   { heading, intro, rows, body, cta, footNote, subject, severity, meta }
 * @returns {Promise<object|null>} the stored alert, or null when suppressed
 */
async function notifyUser(user, typeId, content = {}) {
  if (!user || !user.id) return null;
  if (!content.force && !wantsAlert(user, typeId)) return null;

  const cfg = await settings.get();
  const bankName = cfg.bankName || BANK.name;
  const subject = content.subject || content.heading || 'Account notification';
  const payload = { ...content, bankName };

  // A text goes out alongside the email when the customer has a mobile number
  // we can read and has not turned texts off. Email stays the record: the SMS
  // is a nudge, and it says so by being short.
  const smsNumber = user.sms_alerts === false ? '' : sms.numberFor(user);

  const alert = {
    id: ids.uuid(),
    created_at: new Date().toISOString(),
    user_id: user.id,
    type: typeId,
    channel: smsNumber ? 'email+sms' : 'email',
    subject,
    preview: content.intro || content.body || '',
    body_text: renderText(payload),
    body_html: renderEmail(payload),
    severity: content.severity || 'info',
    status: 'queued',
    sent_at: null,
    read_at: null,
    meta: content.meta || null,
  };
  await db.alerts.insert(alert);

  // Delivery is best effort. The record above is what the app shows either way.
  try {
    const notify = require('../utils/notify');
    const from = process.env.BANK_ALERT_FROM || process.env.FORM_FROM || `${bankName} <onboarding@resend.dev>`;
    const result = await notify.send({
      to: user.email,
      from,
      subject: `${subject}`,
      text: alert.body_text,
      html: alert.body_html,
    });
    const patch = result.ok
      ? { status: 'sent', sent_at: new Date().toISOString(), provider_id: result.id || null }
      : { status: result.error === 'no_api_key' ? 'not_configured' : 'failed', error: result.error || null };

    // The text is its own delivery and its own failure: an SMS provider being
    // down must not mark a delivered email as failed, and the other way round.
    if (smsNumber) {
      const short = content.sms || smsText(payload);
      const out = await sms.send({ to: smsNumber, message: short, type: typeId, userId: user.id });
      patch.sms_status = out.ok ? 'sent' : (out.skipped ? 'not_configured' : 'failed');
      if (out.error) patch.sms_error = out.error;
    }

    const written = await recordDelivery(alert.id, patch);
    return { ...alert, ...written };
  } catch (err) {
    await db.alerts.update(alert.id, { status: 'failed', error: err.message }).catch(() => {});
    return { ...alert, status: 'failed' };
  }
}

/**
 * Write what happened, even on a database that has not had 0004 run.
 *
 * sms_status and sms_error arrived with the text channel, in
 * supabase/migrations/0004_bank_sms.sql. PostgREST rejects the whole PATCH
 * when one column is missing - PGRST204 - so on a database still on 0003 the
 * update threw, the catch marked the alert failed, and an email that had in
 * fact been delivered was recorded as a failure. The row lied about the one
 * thing it exists to record.
 *
 * The two text columns are the only optional ones, so drop them and write the
 * rest. The email's own status is the part that must survive.
 */
async function recordDelivery(id, patch) {
  try {
    await db.alerts.update(id, patch);
    return patch;
  } catch (err) {
    const missingColumn = /PGRST204|sms_status|sms_error/i.test(err.message || '');
    if (!missingColumn) throw err;
    const { sms_status: smsStatus, sms_error: smsError, ...emailOnly } = patch;
    await db.alerts.update(id, emailOnly);
    console.warn(
      '[rockfield] bank_alerts has no sms_status/sms_error column, so text delivery is not being recorded. '
      + 'Run supabase/migrations/0004_bank_sms.sql in the Supabase SQL editor.'
    );
    return emailOnly;
  }
}

/**
 * Money arriving, announced in two messages.
 *
 * Real banks send two, and they are answering two different questions. The
 * first is "has it landed" - the amount, the account, the balance the
 * statement will show. The second is "can I spend it" - the available balance,
 * which is the one that matters at a card terminal and is not the same number
 * whenever any part of the account is on hold.
 *
 * Sent in that order and separately on purpose: one message carrying both
 * figures is the thing customers misread, because the two numbers sit next to
 * each other and only one of them is spendable.
 *
 * Both go by email and, where the customer has a mobile, by text. The second
 * can be turned off with the `availableBalanceAlert` setting for a bank that
 * would rather send one.
 */
async function creditPosted(user, { account, transaction, amount, balance, available }) {
  if (!user || !user.id) return [];

  const cfg = await settings.get();
  const label = `${account.nickname || account.name} ${ids.maskAccount(account.account_number)}`;
  // Read the hold off the account rather than inferring it from the two
  // balances. Available is balance minus holds *plus* any overdraft line, so
  // subtracting one from the other gives a negative number on an account with
  // an overdraft and the hold disappears from the message entirely.
  const held = Math.max(0, Number(account.hold_amount || 0));
  const overdraft = Math.max(0, Number(account.overdraft_limit || 0));
  const out = [];

  // 1. It has landed.
  out.push(await notifyUser(user, 'deposit_posted', {
    force: true,
    subject: `Money in - ${money(amount)}`,
    heading: 'Money in',
    intro: `${money(amount)} was credited to ${label}.`,
    rows: [
      { label: 'Description', value: transaction.description },
      { label: 'Amount', value: money(amount) },
      { label: 'Current balance', value: money(balance) },
      { label: 'Reference', value: transaction.reference },
    ],
    sms: `${cfg.bankName || BANK.name}: ${money(amount)} credited to ${label}. Current balance ${money(balance)}. Ref ${transaction.reference}`,
    meta: { transactionId: transaction.id, accountId: account.id, step: 'credited' },
  }));

  if (cfg.availableBalanceAlert === false) return out.filter(Boolean);

  // 2. What can actually be spent.
  //
  // Both halves get said, because both are why this number differs from the
  // balance: money on hold is not spendable yet, and an overdraft line is
  // spendable but is not the customer's money. A figure larger than the
  // balance with no explanation reads as a mistake.
  const notes = [
    held > 0 ? `${money(held)} is on hold and will be released as it clears` : '',
    overdraft > 0 ? `this includes your ${money(overdraft)} overdraft line` : '',
  ].filter(Boolean);

  out.push(await notifyUser(user, 'balance_available', {
    force: true,
    subject: `Available balance - ${money(available)}`,
    heading: 'Available balance',
    intro: `${money(available)} is available to spend on ${label}${notes.length ? `. ${notes.join(', and ')}` : ''}.`,
    rows: [
      { label: 'Available to spend', value: money(available) },
      { label: 'Current balance', value: money(balance) },
      ...(held > 0 ? [{ label: 'On hold', value: money(held) }] : []),
      ...(overdraft > 0 ? [{ label: 'Overdraft line included', value: money(overdraft) }] : []),
    ],
    sms: `${cfg.bankName || BANK.name}: Available to spend on ${label} is ${money(available)}${notes.length ? `. ${notes.join(', and ')}` : ''}.`,
    meta: { transactionId: transaction.id, accountId: account.id, step: 'available' },
  }));

  return out.filter(Boolean);
}

/** Send the same alert to a list of customers (admin broadcast). */
async function broadcast(users, typeId, content) {
  const out = [];
  for (const user of users) {
    out.push(await notifyUser(user, typeId, content));
  }
  return out.filter(Boolean);
}

/** Unread count for the bell in the header. */
async function unreadCount(userId) {
  const rows = await db.alerts.find({ user_id: userId, read_at: null });
  return rows.length;
}

module.exports = {
  smsText,
  creditPosted,
  notifyUser,
  broadcast,
  unreadCount,
  preferencesFor,
  wantsAlert,
  renderEmail,
  renderText,
  money,
  ALERT_TYPES,
};
