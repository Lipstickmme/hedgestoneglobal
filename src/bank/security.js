'use strict';

/**
 * Credentials, tokens and the handful of fields that must not sit in the
 * database in the clear.
 *
 * Passwords and PINs are hashed with scrypt and compared in constant time.
 * Social Security numbers are reversible - a bank has to be able to show the
 * last four on a statement and the full number to a compliance officer - so
 * they are encrypted with AES-256-GCM rather than hashed.
 *
 * The encryption key comes from BANK_ENCRYPTION_KEY. Without one, a key is
 * derived from a fixed development string and a warning is logged once: local
 * development keeps working, and nobody can mistake that for a configured
 * deployment.
 */

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
let warnedAboutKey = false;

/* ------------------------------------------------------------ passwords --- */

function scryptHash(secret, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(secret), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => {
      if (err) return reject(err);
      resolve(key);
    });
  });
}

/** `scrypt$N$r$p$salt$hash`, everything needed to verify it later. */
async function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scryptHash(secret, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${key.toString('hex')}`;
}

async function verifySecret(secret, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'hex');
  const actual = await new Promise((resolve, reject) => {
    crypto.scrypt(String(secret), salt, expected.length, { N: Number(N), r: Number(r), p: Number(p) }, (err, key) => {
      if (err) return reject(err);
      resolve(key);
    });
  });
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/* --------------------------------------------------------------- tokens --- */

/** Session and reset tokens: 256 bits, URL safe. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * What the sessions table stores. A stolen database dump then contains no
 * usable session token, only the digest of one.
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function timingSafeEqualStr(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/* ---------------------------------------------------------- encryption --- */

function encryptionKey() {
  const raw = process.env.BANK_ENCRYPTION_KEY || '';
  if (raw) {
    // A 64-char hex key is used as-is; anything else is stretched to 32 bytes.
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    return crypto.createHash('sha256').update(raw).digest();
  }
  if (!warnedAboutKey) {
    warnedAboutKey = true;
    console.warn('[rockfield] BANK_ENCRYPTION_KEY is not set: using a development key. Do not run production this way.');
  }
  return crypto.createHash('sha256').update('rockfield-development-key').digest();
}

/** `v1:<iv>:<tag>:<ciphertext>`, all base64. */
function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload || typeof payload !== 'string') return '';
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const [, iv, tag, ct] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    console.warn('[rockfield] could not decrypt a stored value:', err.message);
    return '';
  }
}

/* ----------------------------------------------------------- redaction --- */

/** 123-45-6789 -> •••-••-6789. What appears anywhere a customer can see. */
function maskSsn(ssn) {
  const digits = String(ssn || '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `•••-••-${digits.slice(-4)}`;
}

function formatSsn(ssn) {
  const d = String(ssn || '').replace(/\D/g, '');
  if (d.length !== 9) return String(ssn || '');
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'•'.repeat(Math.max(3, local.length - 2))}@${domain}`;
}

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 4) return '';
  return `(•••) •••-${d.slice(-4)}`;
}

/**
 * Password policy. A bank that only counts characters is a bank that gets
 * "Password1!" on every third account, so the obvious shapes are refused too.
 */
function passwordProblems(password, { minLength = 10 } = {}) {
  const value = String(password || '');
  const problems = [];
  if (value.length < minLength) problems.push(`At least ${minLength} characters`);
  if (!/[a-z]/.test(value)) problems.push('A lowercase letter');
  if (!/[A-Z]/.test(value)) problems.push('An uppercase letter');
  if (!/\d/.test(value)) problems.push('A number');
  if (!/[^A-Za-z0-9]/.test(value)) problems.push('A symbol');
  if (/^(?:password|letmein|qwerty|welcome|rockfield)/i.test(value)) problems.push('Not a common password');
  if (/(.)\1{3,}/.test(value)) problems.push('No character repeated four or more times');
  return problems;
}

module.exports = {
  hashSecret,
  verifySecret,
  randomToken,
  hashToken,
  timingSafeEqualStr,
  encrypt,
  decrypt,
  maskSsn,
  formatSsn,
  maskEmail,
  maskPhone,
  passwordProblems,
};
