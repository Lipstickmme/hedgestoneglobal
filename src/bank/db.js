'use strict';

/**
 * The bank's persistence layer.
 *
 * Two backends, one interface. Supabase (PostgREST) when it is configured,
 * otherwise JSON files under the data directory so the whole application runs
 * on a laptop with nothing provisioned. A ledger needs more than the
 * append-only store the marketing site uses - balances change, transfers move
 * through states, cards get frozen - so this module adds update, delete and
 * filtered reads, and serialises writes per collection.
 *
 * Money is always stored in integer cents. Dates are always ISO-8601 strings.
 */

const fs = require('fs/promises');
const path = require('path');

const { dataDir } = require('../utils/paths');
const { getSupabase } = require('../utils/supabase');

/** Every collection, with the Supabase table it maps to. */
const COLLECTIONS = {
  users: 'bank_users',
  accounts: 'bank_accounts',
  transactions: 'bank_transactions',
  transfers: 'bank_transfers',
  beneficiaries: 'bank_beneficiaries',
  cards: 'bank_cards',
  payees: 'bank_payees',
  bills: 'bank_bills',
  deposits: 'bank_deposits',
  documents: 'bank_documents',
  statements: 'bank_statements',
  activity: 'bank_activity',
  alerts: 'bank_alerts',
  messages: 'bank_messages',
  disputes: 'bank_disputes',
  sessions: 'bank_sessions',
  otps: 'bank_otps',
  settings: 'bank_settings',
  notices: 'bank_notices',
};

const bankDir = () => path.join(dataDir(), 'bank');

/* ----------------------------------------------------------- filtering --- */

/**
 * A where clause is `{ field: value }` for equality, or
 * `{ field: { op: value } }` where op is one of eq, neq, gt, gte, lt, lte,
 * in, like, isNull. Kept deliberately small: everything the bank asks for
 * fits, and anything larger belongs in a view.
 */
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([field, cond]) => {
    const value = row[field];
    if (cond === null) return value === null || value === undefined;
    if (typeof cond !== 'object' || Array.isArray(cond)) {
      if (Array.isArray(cond)) return cond.includes(value);
      return value === cond;
    }
    return Object.entries(cond).every(([op, operand]) => {
      switch (op) {
        case 'eq': return value === operand;
        case 'neq': return value !== operand;
        case 'gt': return value > operand;
        case 'gte': return value >= operand;
        case 'lt': return value < operand;
        case 'lte': return value <= operand;
        case 'in': return Array.isArray(operand) && operand.includes(value);
        case 'nin': return Array.isArray(operand) && !operand.includes(value);
        case 'like': return String(value || '').toLowerCase().includes(String(operand).toLowerCase());
        case 'isNull': return operand ? value == null : value != null;
        default: return true;
      }
    });
  });
}

/**
 * Translate a clause into PostgREST filter parameters.
 *
 * Separate from toQuery because a PATCH or a DELETE wants the filter alone -
 * `select`, `order` and `limit` are meaningless on a write, and PostgREST
 * rejects some of them outright.
 */
function toFilter(where = {}) {
  const parts = [];
  Object.entries(where).forEach(([field, cond]) => {
    const enc = (v) => encodeURIComponent(v);
    if (cond === null) {
      parts.push(`${field}=is.null`);
      return;
    }
    if (Array.isArray(cond)) {
      parts.push(`${field}=in.(${cond.map(enc).join(',')})`);
      return;
    }
    if (typeof cond !== 'object') {
      parts.push(`${field}=eq.${enc(cond)}`);
      return;
    }
    Object.entries(cond).forEach(([op, operand]) => {
      switch (op) {
        case 'in': parts.push(`${field}=in.(${(operand || []).map(enc).join(',')})`); break;
        case 'nin': parts.push(`${field}=not.in.(${(operand || []).map(enc).join(',')})`); break;
        case 'like': parts.push(`${field}=ilike.*${enc(operand)}*`); break;
        case 'isNull': parts.push(`${field}=${operand ? 'is.null' : 'not.is.null'}`); break;
        default: parts.push(`${field}=${op}.${enc(operand)}`);
      }
    });
  });
  return parts;
}

/** The same clause plus ordering and paging, for a read. */
function toQuery(where = {}, opts = {}) {
  const parts = toFilter(where);
  if (opts.order) parts.push(`order=${opts.order}`);
  if (opts.limit) parts.push(`limit=${opts.limit}`);
  if (opts.offset) parts.push(`offset=${opts.offset}`);
  parts.push('select=*');
  return parts.join('&');
}

function sortRows(rows, order) {
  if (!order) return rows;
  const [field, dir = 'asc'] = String(order).split('.');
  const sign = dir.startsWith('desc') ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av > bv ? 1 : -1) * sign;
  });
}

/* --------------------------------------------------------- file backend --- */

const cache = new Map(); // collection -> rows
const chains = new Map(); // collection -> Promise, so writes never interleave

function chain(name, task) {
  const prev = chains.get(name) || Promise.resolve();
  const next = prev.then(task, task);
  chains.set(name, next.catch(() => {}));
  return next;
}

async function readFile(name) {
  if (cache.has(name)) return cache.get(name);
  const file = path.join(bankDir(), `${name}.json`);
  let rows = [];
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    rows = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  cache.set(name, rows);
  return rows;
}

async function writeFile(name, rows) {
  cache.set(name, rows);
  await fs.mkdir(bankDir(), { recursive: true });
  const file = path.join(bankDir(), `${name}.json`);
  await fs.writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
}

/* --------------------------------------------------------- collections --- */

function createCollection(name) {
  const table = COLLECTIONS[name] || `bank_${name}`;

  async function find(where = {}, opts = {}) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        return await supabase.select(table, toQuery(where, opts));
      } catch (err) {
        // A missing table means the migration has not been applied yet. Fall
        // through to files rather than taking the whole dashboard down.
        if (/does not exist|42P01|PGRST205/i.test(err.message)) {
          console.warn(`[rockfield] ${table} missing in Supabase; using file storage`);
        } else {
          throw err;
        }
      }
    }
    const rows = await readFile(name);
    let out = rows.filter((r) => matches(r, where));
    out = sortRows(out, opts.order);
    if (opts.offset) out = out.slice(opts.offset);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out.map((r) => ({ ...r }));
  }

  async function findOne(where = {}, opts = {}) {
    const rows = await find(where, { ...opts, limit: 1 });
    return rows[0] || null;
  }

  const findById = (id) => (id ? findOne({ id }) : Promise.resolve(null));

  /**
   * Fetch many rows by id, as a Map keyed by id.
   *
   * For the "and who owns each of these" step that every list in the console
   * needs. Written one at a time it is a round trip per row - a page of two
   * hundred cards was two hundred sequential requests - and this is one, or a
   * handful once the list is long enough to chunk.
   *
   * Chunked because the ids go into the URL as `id=in.(...)`: a few hundred
   * UUIDs is several kilobytes, and proxies have opinions about that.
   */
  async function findByIds(ids, { chunkSize = 100 } = {}) {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    const out = new Map();
    for (let i = 0; i < unique.length; i += chunkSize) {
      // eslint-disable-next-line no-await-in-loop
      const rows = await find({ id: unique.slice(i, i + chunkSize) });
      rows.forEach((row) => out.set(row.id, row));
    }
    return out;
  }

  async function insert(record) {
    const row = { ...record };
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.insert(table, row);
        return row;
      } catch (err) {
        if (!/does not exist|42P01|PGRST205/i.test(err.message)) throw err;
      }
    }
    return chain(name, async () => {
      const rows = await readFile(name);
      rows.push(row);
      await writeFile(name, rows);
      return row;
    });
  }

  /**
   * Insert many rows in as few round trips as possible.
   *
   * This used to be a loop over insert(), which is one HTTPS request per row.
   * The seed writes about seven hundred rows, so on a hosted database that was
   * seven hundred sequential round trips - half a minute or more, against a
   * serverless function that is killed after ten seconds. The bank could never
   * finish seeding itself on a deployment, and the symptom was a sign-in page
   * that rejected every password because there were no accounts behind it.
   *
   * PostgREST takes an array, so a chunk is one request. The chunk is bounded
   * because these rows are wide - a transaction carries thirty columns - and a
   * single multi-megabyte body is its own kind of timeout.
   */
  async function insertMany(records, { chunkSize = 250 } = {}) {
    const rows = records.map((r) => ({ ...r }));
    if (!rows.length) return rows;

    const supabase = getSupabase();
    if (supabase) {
      try {
        for (let i = 0; i < rows.length; i += chunkSize) {
          await supabase.insert(table, rows.slice(i, i + chunkSize));
        }
        return rows;
      } catch (err) {
        if (!/does not exist|42P01|PGRST205/i.test(err.message)) throw err;
      }
    }

    // One file write for the batch rather than one per row.
    return chain(name, async () => {
      const existing = await readFile(name);
      existing.push(...rows);
      await writeFile(name, existing);
      return rows;
    });
  }

  async function update(id, patch) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        const rows = await supabase.update(table, `id=eq.${encodeURIComponent(id)}`, patch);
        return (rows && rows[0]) || null;
      } catch (err) {
        if (!/does not exist|42P01|PGRST205/i.test(err.message)) throw err;
      }
    }
    return chain(name, async () => {
      const rows = await readFile(name);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) return null;
      rows[idx] = { ...rows[idx], ...patch };
      await writeFile(name, rows);
      return { ...rows[idx] };
    });
  }

  /** Patch every row matching a clause. Returns how many changed. */
  /**
   * Apply one patch to every row matching a clause.
   *
   * A single PATCH with a filter, rather than a read followed by a write per
   * row. The count comes back from the rows PostgREST returns, so a caller can
   * still tell how many it touched.
   */
  async function updateWhere(where, patch) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        const filter = toFilter(where).join('&');
        const rows = await supabase.update(table, filter, patch);
        return Array.isArray(rows) ? rows.length : 0;
      } catch (err) {
        if (!/does not exist|42P01|PGRST205/i.test(err.message)) throw err;
      }
    }
    return chain(name, async () => {
      const rows = await readFile(name);
      let touched = 0;
      const next = rows.map((row) => {
        if (!matches(row, where)) return row;
        touched += 1;
        return { ...row, ...patch };
      });
      if (touched) await writeFile(name, next);
      return touched;
    });
  }

  async function remove(id) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        await supabase.remove(table, `id=eq.${encodeURIComponent(id)}`);
        return true;
      } catch (err) {
        if (!/does not exist|42P01|PGRST205/i.test(err.message)) throw err;
      }
    }
    return chain(name, async () => {
      const rows = await readFile(name);
      const next = rows.filter((r) => r.id !== id);
      await writeFile(name, next);
      return next.length !== rows.length;
    });
  }

  /**
   * Delete every row matching a clause, in one request.
   *
   * Was a read followed by a delete per row - the same shape that made seeding
   * time out. Clearing a bank with six months of history would have been
   * several hundred sequential deletes.
   *
   * An empty clause means everything, but PostgREST refuses an unfiltered
   * DELETE, sensibly. It goes as "every row that has an id", which is the same
   * set and says so out loud. The count comes from the rows it returns.
   */
  async function removeWhere(where = {}) {
    const supabase = getSupabase();
    if (supabase) {
      try {
        const parts = toFilter(where);
        const filter = parts.length ? parts.join('&') : 'id=not.is.null';
        const rows = await supabase.remove(table, filter);
        return Array.isArray(rows) ? rows.length : 0;
      } catch (err) {
        if (!/does not exist|42P01|PGRST205/i.test(err.message)) throw err;
      }
    }
    return chain(name, async () => {
      const rows = await readFile(name);
      const keep = rows.filter((r) => !matches(r, where));
      if (keep.length !== rows.length) await writeFile(name, keep);
      return rows.length - keep.length;
    });
  }

  async function count(where = {}) {
    const rows = await find(where);
    return rows.length;
  }

  return {
    name,
    table,
    find,
    findOne,
    findById,
    findByIds,
    insert,
    insertMany,
    update,
    updateWhere,
    remove,
    removeWhere,
    count,
  };
}

const db = {};
Object.keys(COLLECTIONS).forEach((name) => {
  db[name] = createCollection(name);
});

/**
 * Serialised critical sections, keyed by whatever the caller is protecting
 * (usually an account id). Posting to the ledger reads a balance and writes it
 * back; two requests interleaving there would lose money.
 */
const locks = new Map();
function withLock(key, task) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(task, task);
  locks.set(key, next.catch(() => {}));
  next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  }).catch(() => {});
  return next;
}

/** Tests and the seeder need a clean slate without touching the filesystem. */
function _resetCache() {
  cache.clear();
  chains.clear();
}

module.exports = { db, COLLECTIONS, withLock, matches, toQuery, bankDir, _resetCache };
