'use strict';

/**
 * The ledger: the only place balances change.
 *
 * Rules the rest of the application relies on:
 *   - money is integer cents, everywhere, always;
 *   - a posted entry moves the balance, a pending entry moves the hold, and
 *     settling a pending entry does both in one step;
 *   - deposit accounts and credit accounts differ only by the sign in
 *     ACCOUNT_TYPES, so a card payment and a savings withdrawal go through the
 *     same code path;
 *   - every mutation of an account happens inside withLock(accountId), so two
 *     requests cannot read the same balance and each write their own answer.
 */

const { db, withLock } = require('./db');
const ids = require('./ids');
const { ACCOUNT_TYPES, TRANSACTION_METHODS } = require('./constants');

const nowIso = () => new Date().toISOString();

/** Which way a direction moves this account type. */
function signFor(accountType, direction) {
  const sign = (ACCOUNT_TYPES[accountType] || ACCOUNT_TYPES.checking).sign;
  const base = direction === 'credit' ? 1 : -1;
  return sign === 1 ? base : -base; // on a credit line, a purchase increases the balance owed
}

/** Available to spend right now: balance less holds, or the unused credit line. */
function availableFor(account) {
  const type = account.type || 'checking';
  const sign = (ACCOUNT_TYPES[type] || ACCOUNT_TYPES.checking).sign;
  if (sign === -1) {
    return Math.max(0, Number(account.credit_limit || 0) - Number(account.balance || 0) - Number(account.hold_amount || 0));
  }
  return Number(account.balance || 0) - Number(account.hold_amount || 0) + Number(account.overdraft_limit || 0);
}

/** Business days, so "posts in 2 business days" lands on a day a bank is open. */
function addBusinessDays(from, days) {
  const date = new Date(from);
  let left = Number(days || 0);
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date;
}

/**
 * Write one entry against one account.
 *
 * @param {object} input
 * @param {string} input.accountId
 * @param {'credit'|'debit'} input.direction
 * @param {number} input.amount          positive cents
 * @param {string} input.description
 * @param {'posted'|'pending'|'scheduled'|'hold'} [input.status]
 * @returns {Promise<{transaction: object, account: object}>}
 */
async function post(input) {
  const {
    accountId,
    direction,
    amount,
    description,
    status = 'posted',
    method = 'adjustment',
    category = 'Other',
    merchant = '',
    memo = '',
    date,
    counterparty = null,
    transferId = null,
    reference,
    traceNumber = null,
    checkNumber = null,
    location = '',
    createdBy = 'system',
    createdById = null,
    adminNote = '',
    meta = null,
  } = input;

  const cents = Math.round(Number(amount));
  if (!Number.isFinite(cents) || cents <= 0) {
    const err = new Error('Amount must be a positive number.');
    err.status = 400;
    throw err;
  }

  return withLock(`account:${accountId}`, async () => {
    const account = await db.accounts.findById(accountId);
    if (!account) {
      const err = new Error('Account not found.');
      err.status = 404;
      throw err;
    }

    const delta = signFor(account.type, direction) * cents;
    let balance = Number(account.balance || 0);
    let hold = Number(account.hold_amount || 0);

    if (status === 'posted') {
      balance += delta;
    } else if (status === 'pending' || status === 'hold') {
      // A pending debit reserves funds on a deposit account and reserves credit
      // on a card; a pending credit is simply money that is not yours yet.
      if (direction === 'debit') hold += cents;
    }

    const tx = {
      id: ids.uuid(),
      created_at: nowIso(),
      posted_at: status === 'posted' ? nowIso() : null,
      date: date || nowIso(),
      user_id: account.user_id,
      account_id: account.id,
      direction,
      amount: cents,
      currency: account.currency || 'USD',
      description: description || TRANSACTION_METHODS[method]?.label || 'Transaction',
      merchant: merchant || '',
      category,
      method,
      status,
      balance_after: status === 'posted' ? balance : null,
      reference: reference || ids.reference('TXN'),
      trace_number: traceNumber,
      check_number: checkNumber,
      memo,
      location,
      counterparty,
      transfer_id: transferId,
      created_by: createdBy,
      created_by_id: createdById,
      admin_note: adminNote,
      meta,
    };

    await db.transactions.insert(tx);
    const patch = {
      balance,
      hold_amount: hold,
      available_balance: availableFor({ ...account, balance, hold_amount: hold }),
      last_activity_at: nowIso(),
    };
    const updated = await db.accounts.update(account.id, patch);
    return { transaction: tx, account: updated || { ...account, ...patch } };
  });
}

/**
 * Post many entries at once.
 *
 * Same arithmetic as post(), same row shape, same locking - but the round
 * trips collapse. post() writes one transaction and one balance update per
 * entry, which is two requests; six months of seeded history is about three
 * hundred and forty entries, so seeding a hosted database meant roughly seven
 * hundred sequential round trips. That takes half a minute or more, and a
 * serverless function is killed after ten seconds, so the bank could never
 * finish seeding itself on a deployment: the sign-in page then rejected every
 * password, because there were no accounts behind it.
 *
 * Here the entries for an account are walked in date order under one lock, the
 * running balance is carried in memory, and the result is one bulk insert of
 * the transactions plus one update of the account.
 *
 * This is for writing history that is generated rather than transacted - the
 * seeder. Anything a customer or a member of staff actually does goes through
 * post(), one entry at a time, where each balance is read back from the store
 * before it is changed.
 */
async function postMany(entries) {
  if (!entries.length) return { transactions: [], accounts: [] };

  const byAccount = new Map();
  for (const entry of entries) {
    if (!byAccount.has(entry.accountId)) byAccount.set(entry.accountId, []);
    byAccount.get(entry.accountId).push(entry);
  }

  const transactions = [];
  const accounts = [];

  for (const [accountId, group] of byAccount) {
    // eslint-disable-next-line no-await-in-loop
    const result = await withLock(`account:${accountId}`, async () => {
      const account = await db.accounts.findById(accountId);
      if (!account) throw Object.assign(new Error('Account not found.'), { status: 404 });

      let balance = Number(account.balance || 0);
      let hold = Number(account.hold_amount || 0);
      const rows = [];

      // Date order, so every balance_after is the balance as at that entry.
      const ordered = group.slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

      for (const entry of ordered) {
        const cents = Math.round(Number(entry.amount));
        if (!Number.isFinite(cents) || cents <= 0) {
          throw Object.assign(new Error('Amount must be a positive number.'), { status: 400 });
        }
        const status = entry.status || 'posted';
        const delta = signFor(account.type, entry.direction) * cents;

        if (status === 'posted') {
          balance += delta;
        } else if ((status === 'pending' || status === 'hold') && entry.direction === 'debit') {
          hold += cents;
        }

        rows.push({
          id: ids.uuid(),
          created_at: nowIso(),
          posted_at: status === 'posted' ? nowIso() : null,
          date: entry.date || nowIso(),
          user_id: account.user_id,
          account_id: account.id,
          direction: entry.direction,
          amount: cents,
          currency: account.currency || 'USD',
          description: entry.description || TRANSACTION_METHODS[entry.method]?.label || 'Transaction',
          merchant: entry.merchant || '',
          category: entry.category || 'Other',
          method: entry.method || 'adjustment',
          status,
          balance_after: status === 'posted' ? balance : null,
          reference: entry.reference || ids.reference('TXN'),
          trace_number: entry.traceNumber || null,
          check_number: entry.checkNumber || null,
          memo: entry.memo || '',
          location: entry.location || '',
          counterparty: entry.counterparty || null,
          transfer_id: entry.transferId || null,
          created_by: entry.createdBy || 'system',
          created_by_id: entry.createdById || null,
          admin_note: entry.adminNote || '',
          meta: entry.meta || null,
        });
      }

      await db.transactions.insertMany(rows);
      const patch = {
        balance,
        hold_amount: hold,
        available_balance: availableFor({ ...account, balance, hold_amount: hold }),
        last_activity_at: nowIso(),
      };
      const updated = await db.accounts.update(account.id, patch);
      return { rows, account: updated || { ...account, ...patch } };
    });
    transactions.push(...result.rows);
    accounts.push(result.account);
  }

  return { transactions, accounts };
}

/** Turn a pending entry into a posted one, releasing its hold. */
async function settle(transactionId, { status = 'posted', note } = {}) {
  const tx = await db.transactions.findById(transactionId);
  if (!tx) {
    const err = new Error('Transaction not found.');
    err.status = 404;
    throw err;
  }
  if (tx.status === 'posted') return tx;

  return withLock(`account:${tx.account_id}`, async () => {
    const account = await db.accounts.findById(tx.account_id);
    if (!account) throw Object.assign(new Error('Account not found.'), { status: 404 });

    let balance = Number(account.balance || 0);
    let hold = Number(account.hold_amount || 0);
    const delta = signFor(account.type, tx.direction) * Number(tx.amount);

    // Release the reservation this entry made when it was pending.
    if ((tx.status === 'pending' || tx.status === 'hold') && tx.direction === 'debit') {
      hold = Math.max(0, hold - Number(tx.amount));
    }
    if (status === 'posted') balance += delta;

    const patch = {
      status,
      posted_at: status === 'posted' ? nowIso() : null,
      balance_after: status === 'posted' ? balance : null,
      admin_note: note || tx.admin_note || '',
    };
    const updatedTx = await db.transactions.update(tx.id, patch);
    const accountPatch = {
      balance,
      hold_amount: hold,
      available_balance: availableFor({ ...account, balance, hold_amount: hold }),
      last_activity_at: nowIso(),
    };
    await db.accounts.update(account.id, accountPatch);
    return updatedTx || { ...tx, ...patch };
  });
}

/**
 * Reverse a posted entry, leaving both the original and the reversal visible.
 * Banks correct by contra-entry, never by deleting history.
 */
async function reverse(transactionId, { reason = 'Reversed', actor = 'system', actorId = null } = {}) {
  const tx = await db.transactions.findById(transactionId);
  if (!tx) throw Object.assign(new Error('Transaction not found.'), { status: 404 });
  if (tx.status === 'reversed') return tx;

  if (tx.status === 'pending' || tx.status === 'hold') {
    return settle(tx.id, { status: 'failed', note: reason });
  }

  const { transaction } = await post({
    accountId: tx.account_id,
    direction: tx.direction === 'credit' ? 'debit' : 'credit',
    amount: tx.amount,
    description: `Reversal: ${tx.description}`,
    method: tx.method,
    category: tx.category,
    memo: reason,
    status: 'posted',
    createdBy: actor,
    createdById: actorId,
    counterparty: tx.counterparty,
    meta: { reverses: tx.id },
  });
  await db.transactions.update(tx.id, { status: 'reversed', reversed_by: transaction.id, admin_note: reason });
  return transaction;
}

/** Charge a fee against an account, if the amount is non-zero. */
async function charge(accountId, cents, description, extra = {}) {
  if (!cents) return null;
  const { transaction } = await post({
    accountId,
    direction: 'debit',
    amount: cents,
    description,
    method: 'fee',
    category: 'Fees & Interest',
    status: 'posted',
    createdBy: 'system',
    ...extra,
  });
  return transaction;
}

/** Move money between two accounts on our own books, in one step. */
async function internalTransfer({ fromAccountId, toAccountId, amount, description, memo, createdBy = 'customer', createdById = null, transferId = null }) {
  const debit = await post({
    accountId: fromAccountId,
    direction: 'debit',
    amount,
    description: description || 'Transfer to account',
    method: 'internal',
    category: 'Transfers',
    memo,
    status: 'posted',
    createdBy,
    createdById,
    transferId,
  });
  const credit = await post({
    accountId: toAccountId,
    direction: 'credit',
    amount,
    description: description || 'Transfer from account',
    method: 'internal',
    category: 'Transfers',
    memo,
    status: 'posted',
    createdBy,
    createdById,
    transferId,
  });
  return { debit: debit.transaction, credit: credit.transaction };
}

/** What this customer has already moved today by this method, for limit checks. */
async function dailyTotal(userId, methods, day = new Date()) {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const list = Array.isArray(methods) ? methods : [methods];
  // Against the value date rather than created_at: imported and backdated
  // entries are written today but happened months ago, and counting those
  // would spend a customer's daily limit before they had used it.
  const rows = await db.transactions.find({
    user_id: userId,
    direction: 'debit',
    date: { gte: start.toISOString() },
  });
  return rows
    .filter((r) => list.includes(r.method) && r.status !== 'failed' && r.status !== 'reversed')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

/** Recompute a balance from its entries. Used after an import or a repair. */
async function recalculate(accountId) {
  return withLock(`account:${accountId}`, async () => {
    const account = await db.accounts.findById(accountId);
    if (!account) return null;
    const rows = await db.transactions.find({ account_id: accountId }, { order: 'date.asc' });
    let balance = Number(account.opening_balance || 0);
    let hold = 0;
    rows.forEach((tx) => {
      if (tx.status === 'posted') balance += signFor(account.type, tx.direction) * Number(tx.amount || 0);
      if ((tx.status === 'pending' || tx.status === 'hold') && tx.direction === 'debit') {
        hold += Number(tx.amount || 0);
      }
    });
    const patch = {
      balance,
      hold_amount: hold,
      available_balance: availableFor({ ...account, balance, hold_amount: hold }),
    };
    await db.accounts.update(accountId, patch);
    return { ...account, ...patch };
  });
}

/**
 * A statement period for one account: opening and closing balances, totals and
 * the entries in between, ordered the way a paper statement orders them.
 */
async function statement(account, periodStart, periodEnd) {
  const start = new Date(periodStart).toISOString();
  const end = new Date(periodEnd).toISOString();
  const all = await db.transactions.find({ account_id: account.id }, { order: 'date.asc' });
  const inPeriod = all.filter((t) => t.date >= start && t.date <= end && t.status === 'posted');
  const before = all.filter((t) => t.date < start && t.status === 'posted');

  const opening = before.reduce(
    (sum, t) => sum + signFor(account.type, t.direction) * Number(t.amount || 0),
    Number(account.opening_balance || 0)
  );
  const credits = inPeriod.filter((t) => t.direction === 'credit').reduce((s, t) => s + Number(t.amount), 0);
  const debits = inPeriod.filter((t) => t.direction === 'debit').reduce((s, t) => s + Number(t.amount), 0);
  const sign = (ACCOUNT_TYPES[account.type] || ACCOUNT_TYPES.checking).sign;
  const closing = opening + (sign === 1 ? credits - debits : debits - credits);

  return {
    id: ids.statementId(periodStart, account.account_number),
    accountId: account.id,
    accountNumber: account.account_number,
    periodStart: start,
    periodEnd: end,
    opening,
    closing,
    credits,
    debits,
    creditCount: inPeriod.filter((t) => t.direction === 'credit').length,
    debitCount: inPeriod.filter((t) => t.direction === 'debit').length,
    transactions: inPeriod,
  };
}

/** Month boundaries, newest first, for the statements list. */
function recentPeriods(count = 12, from = new Date()) {
  const out = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  for (let i = 0; i < count; i += 1) {
    const start = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59));
    out.push({ start, end, label: start.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
  }
  return out;
}

module.exports = {
  post,
  postMany,
  settle,
  reverse,
  charge,
  internalTransfer,
  dailyTotal,
  recalculate,
  statement,
  recentPeriods,
  availableFor,
  addBusinessDays,
  signFor,
};
