'use strict';

/**
 * Text messages, through Pingram.
 *
 * A no-op until PINGRAM_API_KEY is set, exactly like the email path: a bank
 * with no SMS provider still raises every alert, stores it, and shows it in
 * the customer's Alerts screen. Only the delivery is missing.
 *
 * No SDK. The whole thing is one POST, and this project carries one runtime
 * dependency on purpose.
 *
 * The endpoint is configurable because it was not possible to read Pingram's
 * SMS reference from here - their docs host is not reachable from this
 * network. The base URL and the bearer scheme are from their published API
 * reference, and the body shape is the one their SDK documents:
 *
 *   { type, to: { id, number }, sms: { message, from } }
 *
 * If the path turns out to differ, set PINGRAM_SMS_URL rather than editing
 * this file.
 */

const DEFAULT_ENDPOINT = 'https://api.pingram.io/sms';

/** How long to wait before giving up. An alert is not worth a hung request. */
const TIMEOUT_MS = 8000;

const apiKey = () => process.env.PINGRAM_API_KEY || '';
const endpoint = () => process.env.PINGRAM_SMS_URL || DEFAULT_ENDPOINT;
const sender = () => process.env.PINGRAM_SMS_FROM || '';

/** Whether texts can actually be delivered. */
const configured = () => Boolean(apiKey());

/**
 * A number Pingram will accept.
 *
 * E.164: a plus and digits, nothing else. A number stored as "(614) 555-0184"
 * is a US number written for a human, so it gets a +1 - but only when it has
 * exactly ten digits, because guessing a country code for anything else is how
 * a text goes to a stranger.
 */
function toE164(raw, { defaultCountry = process.env.PINGRAM_DEFAULT_COUNTRY || '1' } = {}) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('+')) {
    const digits = value.slice(1).replace(/\D/g, '');
    return digits.length >= 8 ? `+${digits}` : '';
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Anything else is ambiguous. Better no text than the wrong recipient.
  return '';
}

/** The best number to text a customer on: their mobile, else their phone. */
function numberFor(user) {
  return toE164(user && (user.mobile || user.phone));
}

/**
 * Send one text.
 *
 * Resolves to a result rather than throwing: a failed alert must never take
 * down the request that raised it. `{ ok, skipped, id, error }`.
 */
async function send({ to, message, type = 'bank_alert', userId }) {
  if (!configured()) return { ok: false, skipped: 'no PINGRAM_API_KEY' };

  const number = toE164(to);
  if (!number) return { ok: false, skipped: 'no usable mobile number' };
  if (!message) return { ok: false, skipped: 'nothing to say' };

  const body = {
    type,
    to: { id: userId || number, number },
    sms: { message: String(message).slice(0, 1200), ...(sender() ? { from: sender() } : {}) },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, error: `pingram ${res.status} ${text.slice(0, 200)}` };
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
    return { ok: true, id: (parsed && (parsed.id || parsed.messageId)) || null };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { send, configured, toE164, numberFor, DEFAULT_ENDPOINT };
