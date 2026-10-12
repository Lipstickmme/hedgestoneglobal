'use strict';

/**
 * Verifies Svix-style signed webhooks (the scheme Resend uses).
 *
 * Signature base string is "<id>.<timestamp>.<raw body>", signed with
 * HMAC-SHA256 using the base64 secret that follows the "whsec_" prefix.
 * The header may carry several space-separated "v1,<signature>" values.
 */

const crypto = require('crypto');

const TOLERANCE_SECONDS = 300;

function header(headers, ...names) {
  for (const n of names) {
    const v = headers[n] || headers[n.toLowerCase()];
    if (v) return Array.isArray(v) ? v[0] : v;
  }
  return null;
}

/**
 * @param {string} secret  whsec_... signing secret
 * @param {object} headers request headers
 * @param {Buffer|string} rawBody exact bytes received
 * @returns {{ok: boolean, reason?: string}}
 */
function verify(secret, headers, rawBody) {
  if (!secret) return { ok: false, reason: 'no_secret_configured' };

  const id = header(headers, 'svix-id', 'webhook-id');
  const timestamp = header(headers, 'svix-timestamp', 'webhook-timestamp');
  const signatureHeader = header(headers, 'svix-signature', 'webhook-signature');

  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: 'missing_signature_headers' };

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const secretBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest('base64');

  const provided = String(signatureHeader)
    .split(' ')
    .map((part) => (part.includes(',') ? part.split(',')[1] : part))
    .filter(Boolean);

  const expectedBuf = Buffer.from(expected);
  const match = provided.some((candidate) => {
    const buf = Buffer.from(candidate);
    return buf.length === expectedBuf.length && crypto.timingSafeEqual(buf, expectedBuf);
  });

  return match ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

/** Build a signature for testing. */
function sign(secret, id, timestamp, body) {
  const secretBytes = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64');
  return `v1,${crypto.createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

module.exports = { verify, sign };
