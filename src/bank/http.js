'use strict';

/**
 * Small helpers every bank controller uses: async error propagation, money
 * parsing that accepts what people actually type, and input tidying.
 */

/** Wrap an async handler so a rejected promise reaches the error middleware. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Throw a request error with a status the error handler will honour. */
function fail(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

/**
 * "$1,234.56", "1234.56", 1234.56 and "1234" all mean the same thing to a
 * person filling in a form. They mean 123456 cents here.
 */
function toCents(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return Math.round(value * 100);
  const cleaned = String(value).replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return NaN;
  return Math.round(Number(cleaned) * 100);
}

const money = (cents, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100);

function trimmed(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/** Every named field must be present and non-empty. */
function require_(body, fields) {
  const missing = fields.filter((f) => {
    const v = body[f];
    return v === undefined || v === null || String(v).trim() === '';
  });
  if (missing.length) {
    throw fail(400, `Missing required ${missing.length === 1 ? 'field' : 'fields'}: ${missing.join(', ')}`, 'missing_fields');
  }
}

/** Pagination that cannot be used to ask for the whole table. */
function page(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
}

/** Turn rows into a CSV download. */
function csv(rows, columns) {
  const escape = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(typeof c.value === 'function' ? c.value(row) : row[c.value])).join(','));
  return [head, ...body].join('\n');
}

module.exports = { asyncHandler, fail, toCents, money, trimmed, require: require_, page, csv };
