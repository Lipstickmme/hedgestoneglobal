'use strict';

/**
 * Buying Bitcoin with a cash balance, and selling it back again.
 *
 * A purchase debits the cash balance through the ledger like any other
 * payment, at the live price of the moment, and books the units it bought
 * against the customer's holding. Selling is the same in reverse: units come
 * off the holding and the proceeds are credited to the cash balance.
 *
 * Every purchase carries a term - how long the customer plans to hold it -
 * and so a maturity date, which the dashboard counts down to. A maturity date
 * is a plan, not a lock: nothing here refuses a sale before it.
 *
 * Bitcoin is the only asset. Whatever a customer still holds of the assets
 * the platform used to offer (markets.RETIRED) is converted to Bitcoin the
 * next time their portfolio is read, or when staff open the investments
 * screen (convertRetired). Until then it is not shown anywhere.
 *
 * Arithmetic is exact. Cash is integer cents, as everywhere in the bank; units
 * are carried as BigInt multiples of the asset's smallest unit (a millionth of
 * a share, a satoshi) and stored as decimal strings, so no balance is ever the
 * result of a floating-point rounding error. Units bought are rounded down and
 * proceeds of a sale are rounded down: we never book more than the money paid
 * for.
 *
 * Each customer's trades run one at a time (withLock on the customer), and the
 * price a trade books at is fetched at that moment, never taken from the
 * browser. The browser sends the price it showed, and a trade is refused if
 * the market has moved more than PRICE_TOLERANCE since, so nobody confirms one
 * number and is booked at another.
 */

const { db, withLock } = require('./db');
const ids = require('./ids');
const ledger = require('./ledger');
const markets = require('./markets');
const settings = require('./settings');
const alerts = require('./alerts');
const audit = require('./audit');
const { ACCOUNT_TYPES } = require('./constants');
const { money } = require('./http');

const MIN_BUY = 100; // $1.00
const PRICE_TOLERANCE = 0.02;
const MAX_TERM_MONTHS = 120;

const nowIso = () => new Date().toISOString();
const err = (status, message, code, extra) => Object.assign(new Error(message), { status, code }, extra || {});

/* --------------------------------------------------------------- units --- */

const SCALE = (decimals) => 10n ** BigInt(decimals);

/** "1.5" -> 1500000n at 6 decimals. Anything unparseable is zero. */
function toScaled(value, decimals) {
  // PostgREST hands numeric columns back as JSON numbers, and a small one
  // stringifies as 1e-7: format it to the asset's precision first.
  const str = typeof value === 'number' ? value.toFixed(decimals) : String(value == null ? '0' : value).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) return 0n;
  const [whole, frac = ''] = str.split('.');
  return BigInt(whole) * SCALE(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/** 1500000n at 6 decimals -> "1.5". */
function fromScaled(scaled, decimals) {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const whole = abs / SCALE(decimals);
  const frac = (abs % SCALE(decimals)).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Price in dollars -> integer cents. */
const priceCents = (price) => Math.round(Number(price) * 100);

/** How many units `cents` buys at `pc` cents per unit, rounded down. */
const unitsFor = (cents, pc, decimals) => (BigInt(cents) * SCALE(decimals)) / BigInt(pc);

/** What `scaled` units are worth at `pc` cents per unit, rounded down. */
const valueOf = (scaled, pc, decimals) => Number((scaled * BigInt(pc)) / SCALE(decimals));

/* ---------------------------------------------------------------- terms --- */

/** `iso` plus `months` calendar months, clamped to the last day of a short month. */
function addMonths(iso, months) {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + Number(months));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

/**
 * The term a purchase is booked with. A customer picks one of the terms
 * offered under Settings; staff booking on someone's behalf may enter any
 * whole number of months. Blank means the default term.
 */
function termFor(input, cfg, staff) {
  const offered = (Array.isArray(cfg.investmentTerms) ? cfg.investmentTerms : []).map(Number).filter((n) => n > 0);
  const fallback = Number(cfg.investmentTermMonths) || offered[0] || 12;
  if (input == null || input === '') return fallback;
  const months = Number(input);
  if (!Number.isInteger(months) || months < 1 || months > MAX_TERM_MONTHS) {
    throw err(400, `Choose a term between 1 and ${MAX_TERM_MONTHS} months.`, 'invalid_term');
  }
  if (!staff && offered.length && !offered.includes(months)) {
    throw err(400, `Choose one of the terms offered: ${offered.join(', ')} months.`, 'invalid_term');
  }
  return months;
}

/*
 * term_months and matures_at arrived with 0007_invest_term.sql. A database
 * still on 0006 refuses a row that carries them (PostgREST PGRST204), so the
 * purchase is written without them rather than refused, and the maturity is
 * worked out from the default term when it is read. Said once in the log, the
 * way alerts.js handles the text-message columns.
 */
let warnedNoTerm = false;
async function insertTrade(row) {
  try {
    await db.trades.insert(row);
    return row;
  } catch (e) {
    if (!/PGRST204|term_months|matures_at/i.test(e.message || '')) throw e;
    const { term_months: t, matures_at: m, ...rest } = row;
    if (!warnedNoTerm) {
      warnedNoTerm = true;
      console.warn('[hedgestone] bank_trades has no term_months/matures_at column, so each purchase is using the default term. Run supabase/migrations/0007_invest_term.sql (or the whole of supabase/setup.sql) in the Supabase SQL editor.');
    }
    await db.trades.insert(rest);
    return rest;
  }
}

/** When a purchase matures: as booked, or worked out from the default term. */
function maturityOf(t) {
  if (t.side !== 'buy') return { termMonths: null, maturesAt: null };
  if (t.matures_at) return { termMonths: t.term_months == null ? null : Number(t.term_months), maturesAt: new Date(t.matures_at).toISOString() };
  const months = Number(t.term_months) || Number(settings.snapshot().investmentTermMonths) || 12;
  return { termMonths: months, maturesAt: addMonths(t.created_at, months) };
}

/* ------------------------------------------------------------- helpers --- */

function checkPrice(quotedPrice, quote) {
  const quoted = Number(quotedPrice);
  if (!Number.isFinite(quoted) || quoted <= 0) return;
  const moved = Math.abs(quote.price - quoted) / quoted;
  if (moved > PRICE_TOLERANCE) {
    throw err(409, `The price moved from ${money(priceCents(quoted))} to ${money(priceCents(quote.price))} while you were deciding. Review the new price and confirm again.`, 'price_moved', { details: { quote } });
  }
}

async function depositAccount(user, accountId) {
  const account = await db.accounts.findById(accountId);
  if (!account || account.user_id !== user.id) throw err(400, 'Choose one of your accounts.');
  if (account.status !== 'active') throw err(409, `That account is ${account.status}, so it cannot be used to buy or sell Bitcoin.`);
  const type = ACCOUNT_TYPES[account.type] || ACCOUNT_TYPES.checking;
  if (type.sign === -1 || ['cd', 'loan', 'mortgage'].includes(account.type)) {
    throw err(400, 'Bitcoin is bought with, and sold into, your cash balance.');
  }
  return account;
}

async function holdingFor(userId, symbol) {
  return db.holdings.findOne({ user_id: userId, symbol });
}

/** Write the holding back, or remove it once nothing is left. */
async function saveHolding(existing, userId, asset, scaled, costBasis) {
  if (scaled <= 0n) {
    if (existing) await db.holdings.remove(existing.id);
    return null;
  }
  const patch = { units: fromScaled(scaled, asset.decimals), cost_basis: Math.max(0, Math.round(costBasis)), updated_at: nowIso() };
  if (existing) return db.holdings.update(existing.id, patch);
  const row = { id: ids.uuid(), created_at: nowIso(), user_id: userId, symbol: asset.symbol, ...patch };
  await db.holdings.insert(row);
  return row;
}

function receipt(trade, asset, account) {
  return [
    { label: trade.side === 'buy' ? 'Converted' : 'Sold', value: `${trade.units} ${asset.unit === 'share' ? `share${trade.units === '1' ? '' : 's'} of` : asset.unit} ${asset.name}` },
    { label: 'Price', value: `${money(trade.price)} per ${asset.unit === 'share' ? 'share' : asset.unit}` },
    { label: trade.side === 'buy' ? 'Amount paid' : 'Amount received', value: money(trade.amount) },
    ...(trade.side === 'buy' ? [{ label: 'Matures', value: `${new Date(maturityOf(trade).maturesAt).toLocaleDateString('en-US', { dateStyle: 'long' })} (${maturityOf(trade).termMonths}-month term)` }] : []),
    { label: trade.side === 'buy' ? 'Paid from' : 'Paid to', value: `${account.nickname || account.name} (${ids.maskAccount(account.account_number)})` },
    { label: 'Reference', value: trade.reference },
  ];
}

/** A trade booked by convertRetired rather than by anybody buying or selling. */
const isConversion = (t) => /^CNV-/.test(String(t.reference || ''));

function publicTrade(t) {
  const asset = markets.BY_SYMBOL.get(t.symbol) || { name: t.symbol, unit: 'unit' };
  return {
    id: t.id,
    createdAt: t.created_at,
    side: t.side,
    symbol: t.symbol,
    name: asset.name,
    unit: asset.unit,
    units: t.units,
    price: t.price,
    amount: t.amount,
    accountId: t.account_id,
    reference: t.reference,
    source: t.quote_source,
    quotedAt: t.quote_as_of,
    status: t.status || 'completed',
    note: t.note || '',
    bookedByStaff: Boolean(t.booked_by),
    converted: isConversion(t),
    transactionId: t.transaction_id,
    ...maturityOf(t),
  };
}

/* ----------------------------------------------------------------- buy --- */

/**
 * Buy Bitcoin with part or all of an account's available balance.
 *
 * @param {object} user
 * @param {object} input  { accountId, symbol, amount (cents) | percent | all, quotedPrice, termMonths }
 */
async function convert(user, input, req, opts = {}) {
  return withLock(`invest:${user.id}`, async () => {
    const account = await depositAccount(user, input.accountId);
    const available = ledger.availableFor(account);

    let amount;
    if (input.all) amount = available;
    else if (input.percent != null && input.percent !== '') {
      const pct = Number(input.percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw err(400, 'Choose a percentage between 1 and 100.');
      amount = Math.floor((available * pct) / 100);
    } else amount = Math.round(Number(input.amount));

    if (!Number.isFinite(amount) || amount < MIN_BUY) throw err(400, `The smallest purchase is ${money(MIN_BUY)}.`, 'below_minimum');
    if (amount > available) {
      throw err(400, `Not enough available funds. ${money(available)} is available in that account.`, 'insufficient_funds');
    }
    const cfg = await settings.get();
    const cap = Number(cfg.limits && cfg.limits.singleTransactionMax) || 0;
    if (cap && amount > cap) throw err(400, `The most you can invest at once is ${money(cap)}.`, 'limit_exceeded');
    const termMonths = termFor(input.termMonths, cfg, Boolean(opts.staff));

    const listed = markets.BY_SYMBOL.get(String(input.symbol || 'BTC').toUpperCase());
    if (listed && listed.retired) {
      throw err(400, 'Bitcoin is the only asset you can buy.', 'asset_retired');
    }
    const { asset, quote } = opts.price ? staffQuote(input.symbol || 'BTC', opts) : await markets.tradeQuote(input.symbol || 'BTC');
    if (!opts.staff) checkPrice(input.quotedPrice, quote);
    const pc = priceCents(quote.price);
    const bought = unitsFor(amount, pc, asset.decimals);
    if (bought <= 0n) throw err(400, `${money(amount)} is too small to buy any ${asset.name}.`, 'below_minimum');

    const reference = ids.reference('INV');
    const units = fromScaled(bought, asset.decimals);
    const posted = await ledger.post({
      accountId: account.id,
      direction: 'debit',
      amount,
      description: `Bought ${asset.name} - ${units} ${asset.unit === 'share' ? 'sh' : asset.unit} @ ${money(pc)}`,
      merchant: asset.name,
      method: 'investment',
      category: 'Investments',
      status: 'posted',
      reference,
      createdBy: opts.staff ? 'admin' : 'customer',
      createdById: opts.staff ? opts.staff.id : user.id,
      date: opts.at || undefined,
      adminNote: opts.note || '',
      meta: { symbol: asset.symbol, units, price: pc, source: quote.source },
    });

    let trade;
    try {
      const existing = await holdingFor(user.id, asset.symbol);
      const held = existing ? toScaled(existing.units, asset.decimals) : 0n;
      await saveHolding(existing, user.id, asset, held + bought, Number(existing ? existing.cost_basis : 0) + amount);
      const bookedAt = opts.at || nowIso();
      trade = await insertTrade({
        id: ids.uuid(), created_at: bookedAt, user_id: user.id, account_id: account.id,
        booked_by: opts.staff ? opts.staff.id : null, note: opts.note || null, status: 'completed',
        symbol: asset.symbol, side: 'buy', units, price: pc, amount,
        transaction_id: posted.transaction.id, reference,
        quote_source: quote.source, quote_as_of: quote.asOf,
        term_months: termMonths, matures_at: addMonths(bookedAt, termMonths),
      });
    } catch (e) {
      // The money left the account but the holding was not booked: put it back.
      await ledger.post({
        accountId: account.id, direction: 'credit', amount,
        description: `Reversal - ${asset.name} purchase could not be completed`,
        method: 'investment', category: 'Investments', reference,
        createdBy: 'system',
      });
      throw err(500, 'The purchase could not be completed and has been reversed. Nothing was charged.', 'conversion_failed', { expose: true });
    }

    await audit.log({
      action: 'invest.buy', category: 'money', userId: user.id, req,
      actor: opts.staff ? { id: opts.staff.id, email: opts.staff.email, role: 'admin' } : { id: user.id, email: user.email, role: 'customer' },
      detail: `${money(amount)} of ${asset.symbol} bought: ${units} at ${money(pc)}, ${termMonths}-month term - ${reference}`,
      meta: { tradeId: trade.id, symbol: asset.symbol },
    });
    if (!opts.silent) {
      await alerts.notifyUser(user, 'investment_trade', {
        subject: `${money(amount)} of ${asset.name} bought`,
        heading: `You now hold more ${asset.name}`,
        intro: `We used ${money(amount)} of your cash balance to buy ${units} ${asset.unit === 'share' ? 'shares of' : asset.unit} ${asset.name} at ${money(pc)}. It matures in ${termMonths} months.`,
        rows: receipt(trade, asset, account),
      }).catch(() => {});
    }

    if (opts.at) await ledger.restate(account.id);
    return { trade: publicTrade(trade), account: posted.account };
  });
}

/* ---------------------------------------------------------------- sell --- */

/**
 * Sell part or all of a holding back into an account.
 *
 * @param {object} input  { symbol, accountId, units | percent | all, quotedPrice }
 */
async function sell(user, input, req, opts = {}) {
  return withLock(`invest:${user.id}`, async () => {
    const account = await depositAccount(user, input.accountId);
    const asset = markets.BY_SYMBOL.get(String(input.symbol || 'BTC').toUpperCase());
    if (!asset || asset.retired) throw err(400, 'Bitcoin is the only asset you can sell.', 'asset_retired');
    const existing = await holdingFor(user.id, asset.symbol);
    const held = existing ? toScaled(existing.units, asset.decimals) : 0n;
    if (held <= 0n) throw err(400, `You do not hold any ${asset.name}.`, 'no_holding');

    let selling;
    if (input.all) selling = held;
    else if (input.percent != null && input.percent !== '') {
      const pct = Number(input.percent);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw err(400, 'Choose a percentage between 1 and 100.');
      selling = pct === 100 ? held : (held * BigInt(Math.round(pct * 100))) / 10000n;
    } else selling = toScaled(input.units, asset.decimals);

    if (selling <= 0n) throw err(400, 'Enter how much to sell.');
    if (selling > held) throw err(400, `You hold ${fromScaled(held, asset.decimals)} ${asset.unit === 'share' ? 'shares' : asset.unit}.`, 'insufficient_units');

    const { quote } = opts.price ? staffQuote(asset.symbol, opts) : await markets.tradeQuote(asset.symbol);
    if (!opts.staff) checkPrice(input.quotedPrice, quote);
    const pc = priceCents(quote.price);
    const proceeds = valueOf(selling, pc, asset.decimals);
    if (proceeds <= 0) throw err(400, 'That is too small an amount to sell.', 'below_minimum');

    const reference = ids.reference('INV');
    const units = fromScaled(selling, asset.decimals);
    const cost = Number(existing.cost_basis || 0);
    const remaining = held - selling;
    const costSold = remaining <= 0n ? cost : Math.round(cost * Number((selling * 1000000n) / held) / 1000000);

    await saveHolding(existing, user.id, asset, remaining, cost - costSold);
    let posted;
    try {
      posted = await ledger.post({
        accountId: account.id,
        direction: 'credit',
        amount: proceeds,
        description: `Sold ${asset.name} - ${units} ${asset.unit === 'share' ? 'sh' : asset.unit} @ ${money(pc)}`,
        merchant: asset.name,
        method: 'investment',
        category: 'Investments',
        status: 'posted',
        reference,
        createdBy: opts.staff ? 'admin' : 'customer',
        createdById: opts.staff ? opts.staff.id : user.id,
        date: opts.at || undefined,
        adminNote: opts.note || '',
        meta: { symbol: asset.symbol, units, price: pc, source: quote.source },
      });
    } catch (e) {
      // Put the units back before reporting the failure.
      await saveHolding(await holdingFor(user.id, asset.symbol), user.id, asset, held, cost);
      throw e;
    }

    const trade = {
      id: ids.uuid(), created_at: opts.at || nowIso(), user_id: user.id, account_id: account.id,
      booked_by: opts.staff ? opts.staff.id : null, note: opts.note || null, status: 'completed',
      symbol: asset.symbol, side: 'sell', units, price: pc, amount: proceeds,
      transaction_id: posted.transaction.id, reference,
      quote_source: quote.source, quote_as_of: quote.asOf,
      realized_gain: proceeds - costSold,
    };
    await db.trades.insert(trade);

    await audit.log({
      action: 'invest.sell', category: 'money', userId: user.id, req,
      actor: opts.staff ? { id: opts.staff.id, email: opts.staff.email, role: 'admin' } : { id: user.id, email: user.email, role: 'customer' },
      detail: `${units} ${asset.symbol} sold at ${money(pc)} for ${money(proceeds)} - ${reference}`,
      meta: { tradeId: trade.id, symbol: asset.symbol },
    });
    await alerts.notifyUser(user, 'investment_trade', {
      subject: `${asset.name} sold - ${money(proceeds)} credited`,
      heading: `${money(proceeds)} is back in your account`,
      intro: `We sold ${units} ${asset.unit === 'share' ? 'shares of' : asset.unit} ${asset.name} at ${money(pc)} and credited the proceeds.`,
      rows: receipt(trade, asset, account),
    }).catch(() => {});

    return { trade: publicTrade(trade), account: posted.account };
  });
}

/* ---------------------------------------------------------------- staff --- */

/**
 * A price entered by staff, for a trade booked after the fact: a walk-in
 * customer's instruction, or one taken by phone while the network was down,
 * recorded at the price and time it was actually agreed.
 */
function staffQuote(symbol, opts) {
  const asset = markets.BY_SYMBOL.get(String(symbol || '').toUpperCase());
  if (!asset) throw err(400, 'That asset is not available.');
  const price = Number(opts.price);
  if (!Number.isFinite(price) || price <= 0) throw err(400, 'Enter the price per unit the trade was agreed at.');
  return { asset, quote: { symbol: asset.symbol, price: Math.round(price * 100) / 100, source: 'Entered by staff', asOf: opts.at || nowIso() } };
}

/**
 * Move a trade, and its ledger entry, to the time it actually happened, and
 * for a purchase optionally change its term. A purchase's maturity moves with
 * it: it is always the purchase date plus the term.
 */
async function retimeTrade(tradeId, at, staff, note, req, { termMonths } = {}) {
  const trade = await db.trades.findById(tradeId);
  if (!trade) throw err(404, 'Trade not found.');
  let iso = trade.created_at;
  if (at) {
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) throw err(400, 'Enter a valid date and time.');
    if (when.getTime() > Date.now() + 60000) throw err(400, 'A trade cannot be dated in the future.');
    iso = when.toISOString();
  }
  const patch = { created_at: iso, note: note || trade.note || null };
  let term = trade.term_months == null ? null : Number(trade.term_months);
  if (trade.side === 'buy' && termMonths != null && termMonths !== '') term = termFor(termMonths, await settings.get(), true);
  // Only where the columns exist: a row booked without them was booked on a
  // database without them, and an update naming them would be refused.
  if (trade.side === 'buy' && (trade.term_months != null || trade.matures_at)) {
    patch.term_months = term;
    patch.matures_at = addMonths(iso, term);
  } else if (trade.side === 'buy' && term !== null) {
    throw err(409, 'This database cannot store a term yet. Run supabase/setup.sql in Supabase, then try again.', 'term_unsupported');
  }
  await db.trades.update(trade.id, patch);
  if (trade.transaction_id && iso !== trade.created_at) await db.transactions.update(trade.transaction_id, { date: iso });
  if (trade.account_id && iso !== trade.created_at) await ledger.restate(trade.account_id);
  await audit.log({
    action: 'admin.trade_retimed', category: 'admin', userId: trade.user_id, req, severity: 'notice',
    actor: { id: staff.id, email: staff.email, role: 'admin' },
    detail: `${trade.side === 'buy' ? 'Purchase' : 'Sale'} ${trade.reference} dated ${iso}${patch.term_months ? `, ${patch.term_months}-month term` : ''}${note ? ` - ${note}` : ''}`,
    meta: { tradeId: trade.id, from: trade.created_at, to: iso },
  });
  return publicTrade({ ...trade, ...patch });
}

/**
 * Undo a trade completely: the units come off (or go back on) the holding and
 * the cash goes back (or comes back out) through a ledger reversal.
 */
async function reverseTrade(tradeId, staff, note, req) {
  const trade = await db.trades.findById(tradeId);
  if (!trade) throw err(404, 'Trade not found.');
  if (trade.status === 'reversed') throw err(409, 'That trade has already been reversed.');
  if (isConversion(trade)) {
    throw err(409, 'A conversion to Bitcoin cannot be reversed. Book a sale of the Bitcoin instead.', 'conversion_final');
  }
  const asset = markets.BY_SYMBOL.get(trade.symbol);
  if (!asset) throw err(400, 'That asset is no longer listed.');

  return withLock(`invest:${trade.user_id}`, async () => {
    const existing = await holdingFor(trade.user_id, asset.symbol);
    const held = existing ? toScaled(existing.units, asset.decimals) : 0n;
    const units = toScaled(trade.units, asset.decimals);
    const cost = Number(existing ? existing.cost_basis : 0);

    if (trade.side === 'buy') {
      if (held < units) {
        throw err(409, `The customer now holds ${fromScaled(held, asset.decimals)} ${asset.symbol}, fewer than this purchase bought. Reverse the later sale first.`);
      }
      await saveHolding(existing, trade.user_id, asset, held - units, cost - Number(trade.amount || 0));
    } else {
      const costSold = Number(trade.amount || 0) - Number(trade.realized_gain || 0);
      await saveHolding(existing, trade.user_id, asset, held + units, cost + costSold);
    }

    let reversal = null;
    if (trade.transaction_id) {
      reversal = await ledger.reverse(trade.transaction_id, {
        reason: note || `${trade.side === 'buy' ? 'Purchase' : 'Sale'} reversed by staff`,
        actor: 'admin',
        actorId: staff.id,
      });
    }
    const patch = { status: 'reversed', reversed_at: nowIso(), note: note || trade.note || null };
    await db.trades.update(trade.id, patch);
    await audit.log({
      action: 'admin.trade_reversed', category: 'admin', userId: trade.user_id, req, severity: 'notice',
      actor: { id: staff.id, email: staff.email, role: 'admin' },
      detail: `Reversed ${trade.side} of ${trade.units} ${trade.symbol} (${money(trade.amount)}) - ${trade.reference}${note ? ` - ${note}` : ''}`,
      meta: { tradeId: trade.id, reversalTransactionId: reversal && reversal.id },
    });
    return publicTrade({ ...trade, ...patch });
  });
}

/* ------------------------------------------------------------ convert --- */

/**
 * Turn whatever a customer still holds of the assets the platform no longer
 * offers into Bitcoin, at the live price of each.
 *
 * The holding is valued at its own price and that value buys Bitcoin at
 * Bitcoin's. No cash moves, so nothing is posted to the cash balance. What the
 * customer originally paid carries over as the cost of the Bitcoin, so the
 * gain or loss they had continues rather than restarting at zero. The Bitcoin
 * is a new purchase dated now, on the default term.
 *
 * Removing the old holding is the claim: a delete that finds nothing means
 * another request converted it first, and this one books nothing. Without a
 * live price for either side nothing is converted, and the next call tries
 * again.
 *
 * @returns {{ converted: object[], pending: object[] }}
 */
async function convertRetired(user, opts = {}) {
  return withLock(`invest:${user.id}`, async () => {
    const rows = (await db.holdings.find({ user_id: user.id })).filter((h) => h.symbol !== 'BTC');
    const out = { converted: [], pending: [] };
    if (!rows.length) return out;

    // The old assets' prices first: asking for one refreshes every asset,
    // Bitcoin included, so the Bitcoin price below is already in hand.
    const priced = [];
    for (const h of rows) {
      try {
        // eslint-disable-next-line no-await-in-loop
        priced.push({ h, ...(await markets.tradeQuote(h.symbol)) });
      } catch (e) {
        out.pending.push({ symbol: h.symbol, reason: e.message });
      }
    }
    if (!priced.length) return out;
    let btc;
    try {
      btc = await markets.tradeQuote('BTC');
    } catch (e) {
      priced.forEach(({ h }) => out.pending.push({ symbol: h.symbol, reason: e.message }));
      return out;
    }
    const btcPc = priceCents(btc.quote.price);
    const cfg = await settings.get();
    const termMonths = termFor(null, cfg, true);
    const actor = opts.staff ? { id: opts.staff.id, email: opts.staff.email, role: 'admin' } : { role: 'system' };

    for (const { h, asset, quote } of priced) {
      const held = toScaled(h.units, asset.decimals);
      const pc = priceCents(quote.price);
      const value = valueOf(held, pc, asset.decimals);
      const cost = Number(h.cost_basis || 0);
      const bought = unitsFor(value, btcPc, btc.asset.decimals);

      // eslint-disable-next-line no-await-in-loop
      if (!(await db.holdings.removeWhere({ id: h.id }))) continue;

      // eslint-disable-next-line no-await-in-loop
      const existing = await holdingFor(user.id, 'BTC');
      const had = existing ? toScaled(existing.units, btc.asset.decimals) : 0n;
      const hadCost = Number(existing ? existing.cost_basis : 0);
      if (bought > 0n) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await saveHolding(existing, user.id, btc.asset, had + bought, hadCost + cost);
        } catch (e) {
          // eslint-disable-next-line no-await-in-loop
          await db.holdings.insert(h).catch(() => {});
          throw e;
        }
      }

      const at = nowIso();
      const reference = ids.reference('CNV');
      const units = fromScaled(bought, btc.asset.decimals);
      const common = {
        created_at: at, user_id: user.id, account_id: null, transaction_id: null, reference,
        booked_by: opts.staff ? opts.staff.id : null, status: 'completed',
      };
      try {
        // eslint-disable-next-line no-await-in-loop
        await db.trades.insert({
          ...common, id: ids.uuid(), symbol: asset.symbol, side: 'sell', units: fromScaled(held, asset.decimals),
          price: pc, amount: value, realized_gain: value - cost, note: 'Converted to Bitcoin',
          quote_source: quote.source, quote_as_of: quote.asOf,
        });
        if (bought > 0n) {
          // eslint-disable-next-line no-await-in-loop
          await insertTrade({
            ...common, id: ids.uuid(), symbol: 'BTC', side: 'buy', units, price: btcPc, amount: cost,
            note: 'Converted to Bitcoin from an earlier investment',
            quote_source: btc.quote.source, quote_as_of: btc.quote.asOf,
            term_months: termMonths, matures_at: addMonths(at, termMonths),
          });
        }
      } catch (e) {
        // The holdings have moved, which is what matters to the customer; the
        // record of it is what failed. Say so where staff will see it.
        console.warn(`[hedgestone] ${reference}: ${h.symbol} converted to Bitcoin but the trade record failed: ${e.message}`);
      }

      // eslint-disable-next-line no-await-in-loop
      await audit.log({
        action: 'invest.converted', category: 'money', userId: user.id, req: opts.req, actor,
        detail: `${fromScaled(held, asset.decimals)} ${asset.symbol} (${money(value)} at ${money(pc)}) converted to ${units} BTC at ${money(btcPc)}; ${money(cost)} invested carried over - ${reference}`,
        meta: { symbol: asset.symbol, units: fromScaled(held, asset.decimals), value, cost, btc: units, reference },
      });
      out.converted.push({ name: asset.name, symbol: asset.symbol, units: fromScaled(held, asset.decimals), unit: asset.unit, value, cost, btc: units, reference });
    }

    if (out.converted.length && !opts.silent) {
      const worth = out.converted.reduce((n, c) => n + c.value, 0);
      const coins = fromScaled(out.converted.reduce((n, c) => n + toScaled(c.btc, btc.asset.decimals), 0n), btc.asset.decimals);
      const invested = out.converted.reduce((n, c) => n + c.cost, 0);
      await alerts.notifyUser(user, 'investment_trade', {
        subject: 'Your investments are now in Bitcoin',
        heading: 'Your investments are now in Bitcoin',
        intro: `We now offer Bitcoin only, so we have converted your earlier investments, worth ${money(worth)} at today's prices, into ${coins} BTC at ${money(btcPc)}. The ${money(invested)} you originally invested carries over, so your gain or loss continues from where it was.`,
        rows: [
          ...out.converted.map((c) => ({ label: c.name, value: `${c.units} ${c.unit === 'share' ? `share${c.units === '1' ? '' : 's'}` : c.unit}, worth ${money(c.value)}` })),
          { label: 'Bitcoin received', value: `${coins} BTC` },
          { label: 'Bitcoin price', value: money(btcPc) },
          { label: 'Matures', value: `${new Date(addMonths(nowIso(), termMonths)).toLocaleDateString('en-US', { dateStyle: 'long' })} (${termMonths}-month term)` },
        ],
      }).catch(() => {});
    }
    return out;
  });
}

/** convertRetired for every customer who still holds something other than Bitcoin. */
async function convertAllRetired(opts = {}) {
  const rows = (await db.holdings.find({})).filter((h) => h.symbol !== 'BTC');
  const out = { customers: 0, converted: [], pending: [] };
  if (!rows.length) return out;
  const people = await db.users.findByIds([...new Set(rows.map((h) => h.user_id))]);
  for (const user of people.values()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await convertRetired(user, opts);
      if (r.converted.length) out.customers += 1;
      out.converted.push(...r.converted.map((c) => ({ ...c, userId: user.id })));
      out.pending.push(...r.pending.map((p) => ({ ...p, userId: user.id })));
    } catch (e) {
      console.warn(`[hedgestone] converting ${user.id} to Bitcoin failed: ${e.message}`);
      out.pending.push({ userId: user.id, reason: e.message });
    }
  }
  return out;
}

/* ----------------------------------------------------------- portfolio --- */

/**
 * The customer's Bitcoin as the purchases that make it up, oldest first.
 *
 * Each purchase is its own position with its own date and maturity. Sales
 * come off the oldest purchase first (first in, first out), so a position's
 * units and cost are what is left of that purchase. Anything the holding has
 * that no purchase explains - a balance booked before trades were recorded -
 * appears as one position dated when the holding was opened, so the
 * positions always add up to the holding.
 */
function positionsOf(trades, holding, asset, pc) {
  const lots = [];
  const take = (units) => {
    let left = units;
    while (left > 0n && lots.length) {
      const lot = lots[0];
      if (lot.units <= left) { left -= lot.units; lots.shift(); continue; }
      const costOut = Math.round(lot.cost * Number((left * 1000000n) / lot.units) / 1000000);
      lot.cost -= costOut;
      lot.units -= left;
      left = 0n;
    }
  };
  trades.filter((t) => t.status !== 'reversed').forEach((t) => {
    const units = toScaled(t.units, asset.decimals);
    if (t.side === 'buy') lots.push({ trade: t, units, cost: Number(t.amount || 0) });
    else take(units);
  });

  const held = holding ? toScaled(holding.units, asset.decimals) : 0n;
  const counted = lots.reduce((n, l) => n + l.units, 0n);
  if (counted > held) take(counted - held);
  else if (held > counted) {
    const cost = Math.max(0, Number(holding.cost_basis || 0) - lots.reduce((n, l) => n + l.cost, 0));
    lots.unshift({ trade: { id: `holding-${holding.id}`, side: 'buy', created_at: holding.created_at, price: 0, term_months: null }, units: held - counted, cost });
  }

  const now = Date.now();
  return lots.map(({ trade, units, cost }) => {
    const { termMonths, maturesAt } = maturityOf(trade);
    const start = new Date(trade.created_at).getTime();
    const end = new Date(maturesAt).getTime();
    const value = pc ? valueOf(units, pc, asset.decimals) : null;
    return {
      id: trade.id,
      purchasedAt: trade.created_at,
      units: fromScaled(units, asset.decimals),
      cost,
      price: Number(trade.price) || (units > 0n ? Math.round((cost * Number(SCALE(asset.decimals))) / Number(units)) : 0),
      value,
      gain: value == null ? null : value - cost,
      gainPct: value == null || !cost ? null : Math.round(((value - cost) / cost) * 10000) / 100,
      termMonths,
      maturesAt,
      daysHeld: Math.max(0, Math.floor((now - start) / 86400000)),
      daysToMaturity: Math.max(0, Math.ceil((end - now) / 86400000)),
      progress: end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1,
      matured: now >= end,
      reference: trade.reference || '',
    };
  });
}

/**
 * The customer's Bitcoin: what it is worth, what it cost, and the purchases
 * that make it up. Anything still held of an asset no longer offered is
 * converted first; if it cannot be yet, `converting` says so without naming it.
 */
async function portfolio(userId) {
  let pending = [];
  const user = await db.users.findById(userId);
  if (user) {
    try {
      ({ pending } = await convertRetired(user));
    } catch (e) {
      console.warn(`[hedgestone] converting ${userId} to Bitcoin failed: ${e.message}`);
      pending = [{ reason: e.message }];
    }
  }

  const [btcHolding, trades, btcTrades, assets] = await Promise.all([
    holdingFor(userId, 'BTC'),
    db.trades.find({ user_id: userId, symbol: 'BTC' }, { order: 'created_at.desc', limit: 25 }),
    db.trades.find({ user_id: userId, symbol: 'BTC' }, { order: 'created_at.asc' }),
    markets.list(),
  ]);
  const btc = assets.find((a) => a.symbol === 'BTC');
  const btcPc = btc && btc.quote ? priceCents(btc.quote.price) : null;

  const holdings = btcHolding ? [(() => {
    const scaled = toScaled(btcHolding.units, btc.decimals);
    const value = btcPc ? valueOf(scaled, btcPc, btc.decimals) : null;
    const cost = Number(btcHolding.cost_basis || 0);
    return {
      symbol: 'BTC',
      name: btc.name,
      kind: btc.kind,
      unit: btc.unit,
      units: btcHolding.units,
      costBasis: cost,
      averagePrice: scaled > 0n ? Math.round((cost * Number(SCALE(btc.decimals))) / Number(scaled)) : 0,
      price: btcPc,
      value,
      gain: value == null ? null : value - cost,
      gainPct: value == null || !cost ? null : Math.round(((value - cost) / cost) * 10000) / 100,
      dayChangePct: btc.quote ? btc.quote.changePct : null,
    };
  })()] : [];
  const btcRow = holdings[0] || null;
  const positions = btc ? positionsOf(btcTrades, btcHolding, btc, btcPc) : [];
  const upcoming = positions.filter((p) => !p.matured).sort((a, b) => (a.maturesAt < b.maturesAt ? -1 : 1));
  const value = btcRow && btcRow.value != null ? btcRow.value : 0;
  const cost = btcRow && btcRow.value != null ? btcRow.costBasis : 0;

  return {
    assets,
    holdings,
    totals: {
      value,
      cost,
      gain: value - cost,
      gainPct: cost ? Math.round(((value - cost) / cost) * 10000) / 100 : null,
    },
    bitcoin: {
      units: btcRow ? btcRow.units : '0',
      cost: btcRow ? btcRow.costBasis : 0,
      value: btcRow ? btcRow.value : (btcPc ? 0 : null),
      gain: btcRow ? btcRow.gain : 0,
      gainPct: btcRow ? btcRow.gainPct : null,
      price: btcPc,
      dayChangePct: btc && btc.quote ? btc.quote.changePct : null,
      source: btc && btc.quote ? btc.quote.source : '',
      asOf: btc && btc.quote ? btc.quote.asOf : null,
      firstPurchasedAt: positions.length ? positions[0].purchasedAt : null,
      nextMaturity: upcoming.length ? upcoming[0].maturesAt : null,
      lastMaturity: positions.length ? positions.map((p) => p.maturesAt).sort().pop() : null,
    },
    positions,
    trades: trades.map(publicTrade),
    converting: pending.length > 0,
  };
}

module.exports = {
  convert, sell, portfolio, publicTrade, retimeTrade, reverseTrade, addMonths,
  convertRetired, convertAllRetired,
  MIN_BUY, PRICE_TOLERANCE, MAX_TERM_MONTHS, _units: { toScaled, fromScaled, unitsFor, valueOf },
};
