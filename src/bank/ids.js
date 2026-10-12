'use strict';

/**
 * The numbers a bank puts on things.
 *
 * Account numbers, card numbers, ACH trace numbers and wire IMADs all have a
 * shape the rest of the industry checks, so they are generated here once and
 * validated here once rather than being improvised at each call site. Every
 * value is synthetic: the routing prefix is unassigned and card numbers sit in
 * the published test ranges, so nothing generated here can address a real
 * institution or a real card.
 */

const crypto = require('crypto');

const ALPHABET = '0123456789';

/** Cryptographically random digits; Math.random has no business near an account number. */
function digits(n) {
  let out = '';
  const bytes = crypto.randomBytes(n);
  for (let i = 0; i < n; i += 1) out += ALPHABET[bytes[i] % 10];
  return out;
}

/** RFC 4122 v4, so rows carry ids Postgres will accept as uuid. */
function uuid() {
  return crypto.randomUUID();
}

/** Short, unambiguous reference for humans to read down a phone line. */
function reference(prefix = 'RF') {
  const set = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < 10; i += 1) out += set[bytes[i] % set.length];
  return `${prefix}-${out.slice(0, 5)}-${out.slice(5)}`;
}

/* ------------------------------------------------------------------ ABA --- */

/**
 * The ABA checksum every US routing number carries in its ninth digit.
 * 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) must be divisible by 10.
 */
function validateRouting(value) {
  const s = String(value || '').replace(/\D/g, '');
  if (s.length !== 9) return false;
  const d = s.split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

/** Complete an 8-digit prefix into a checksum-valid routing number. */
function completeRouting(prefix8) {
  const p = String(prefix8).replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
  for (let last = 0; last < 10; last += 1) {
    if (validateRouting(p + last)) return p + last;
  }
  return `${p}0`;
}

/* ----------------------------------------------------------------- Luhn --- */

function luhnValid(value, minLength = 2) {
  const s = String(value || '').replace(/\D/g, '');
  if (s.length < minLength) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    let d = Number(s[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** A card number is Luhn-valid *and* card-length; account numbers are shorter. */
function cardValid(value) {
  return luhnValid(value, 12);
}

/** Append the Luhn check digit to a partial number. */
function luhnComplete(partial) {
  for (let d = 0; d < 10; d += 1) {
    if (luhnValid(partial + d)) return partial + d;
  }
  return `${partial}0`;
}

/* -------------------------------------------------------------- numbers --- */

/**
 * A deposit account number: a two-digit product code, a seven-digit body and
 * a Luhn check digit, so a typo in the middle is caught before it reaches the
 * ledger.
 */
const PRODUCT_CODES = {
  checking: '41',
  savings: '52',
  money_market: '63',
  cd: '74',
  credit: '85',
  loan: '96',
  mortgage: '97',
  ira: '38',
};

function accountNumber(type = 'checking') {
  const code = PRODUCT_CODES[type] || '41';
  return luhnComplete(`${code}${digits(7)}`);
}

/** Last four, with the rest masked the way a statement masks it. */
function maskAccount(number, visible = 4) {
  const s = String(number || '');
  if (s.length <= visible) return s;
  return `${'•'.repeat(Math.min(8, s.length - visible))}${s.slice(-visible)}`;
}

/** A customer number: what the call centre asks for before anything else. */
function customerNumber() {
  return `RF${digits(9)}`;
}

/**
 * A card number in a published test BIN, so it is structurally valid, passes
 * Luhn and can never route to a live card.
 */
const CARD_BINS = {
  visa_debit: '400123',
  visa_credit: '400566',
  mastercard_debit: '551234',
  mastercard_credit: '552413',
};

function cardNumber(brand = 'visa', kind = 'debit') {
  const key = `${brand}_${kind}`;
  const bin = CARD_BINS[key] || CARD_BINS.visa_debit;
  return luhnComplete(`${bin}${digits(9)}`);
}

function maskCard(number) {
  const s = String(number || '').replace(/\s/g, '');
  return `•••• •••• •••• ${s.slice(-4)}`;
}

function cvv() {
  return digits(3);
}

/**
 * ACH trace number: the ODFI's routing prefix (eight digits) plus a sequence.
 * This is the number a receiving bank quotes back when something goes missing.
 */
function achTrace(routingNumber) {
  const prefix = String(routingNumber || '').replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
  return `${prefix}${digits(7)}`;
}

/**
 * Fedwire input message accountability data. Format:
 * YYYYMMDD + source (8) + sequence (6).
 */
function imad(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `${ymd}B1Q${digits(5)}${digits(6)}`;
}

function omad(date = new Date()) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `${ymd}L1B${digits(5)}${digits(6)}`;
}

/** Confirmation code shown on a receipt. */
function confirmation() {
  return reference('CNF');
}

/** Check number for a printed or mobile-deposited check. */
function checkNumber(seq) {
  return String(seq == null ? Number(digits(4)) : seq).padStart(4, '0');
}

/** A statement id that sorts by period: RF-STM-2026-03-<acct last4>. */
function statementId(periodStart, accountNo) {
  const d = new Date(periodStart);
  return `RF-STM-${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(accountNo).slice(-4)}`;
}

/** Six-digit one-time passcode. */
function otpCode() {
  return digits(6);
}

/** A SWIFT/BIC for a fictional receiving bank, when one is not supplied. */
function swift(bankName = 'ROCKFIELD') {
  const letters = String(bankName).toUpperCase().replace(/[^A-Z]/g, '').padEnd(4, 'X').slice(0, 4);
  return `${letters}US${digits(2)}XXX`;
}

module.exports = {
  digits,
  cardValid,
  uuid,
  reference,
  validateRouting,
  completeRouting,
  luhnValid,
  luhnComplete,
  accountNumber,
  maskAccount,
  customerNumber,
  cardNumber,
  maskCard,
  cvv,
  achTrace,
  imad,
  omad,
  confirmation,
  checkNumber,
  statementId,
  otpCode,
  swift,
  PRODUCT_CODES,
  CARD_BINS,
};
