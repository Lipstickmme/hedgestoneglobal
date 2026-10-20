'use strict';

/**
 * The vault: the Bitcoin a customer holds, how it got there, and how it
 * leaves.
 *
 * Bitcoin comes in two ways, each confirmed by staff (vault.js holds the
 * requests):
 *
 *   cash     paid to the OTC partner; it buys Bitcoin at that day's price
 *   bitcoin  sent to the vault address; it is valued at that day's price
 *
 * and goes out one way: sent to an address of the customer's, once it has
 * matured, again approved by staff.
 *
 * Everything that comes in carries a term of whole years (VAULT.termYears)
 * and so a maturity date. Anything dated in the past is priced at Bitcoin's
 * closing price on that day (markets.priceAt), never at today's, so the
 * growth shown for a purchase from 2014 is the growth since 2014. Nothing can
 * be dated before VAULT.earliest.
 *
 * Customers no longer hold cash or any other asset. Whatever they still had of
 * either is converted to Bitcoin the next time their vault is read, or when
 * staff open the investments screen (convertRetired, convertCash).
 *
 * Arithmetic is exact. Cash is integer cents, as everywhere in the platform;
 * units are carried as BigInt multiples of the asset's smallest unit (a
 * satoshi) and stored as decimal strings, so no balance is ever the result of
 * a floating-point rounding error. Units bought are rounded down: we never
 * book more than the money paid for.
 *
 * Each customer's vault changes one thing at a time (withLock on the
 * customer).
 */

const { db, withLock } = require('./db');
const ids = require('./ids');
const ledger = require('./ledger');
const markets = require('./markets');
const settings = require('./settings');
const alerts = require('./alerts');
const audit = require('./audit');
const { ACCOUNT_TYPES, VAULT } = require('./constants');
const { money } = require('./http');

const MIN_BUY = 100; // $1.00
const TERM_YEARS = VAULT.termYears;
const MAX_TERM_MONTHS = TERM_YEARS.max * 12;

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

/** A cost split in proportion to units, rounded to the cent. */
const shareOf = (cost, part, whole) => (part >= whole ? cost : Math.round(cost * Number((part * 1000000n) / whole) / 1000000));

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

/** The term preselected and used when nobody chose one, in years. */
function defaultTermYears(cfg) {
  const years = Number(cfg && cfg.investmentTermYears);
  return Number.isInteger(years) && years >= TERM_YEARS.min && years <= TERM_YEARS.max ? years : TERM_YEARS.min;
}

/** A term in whole years, as the months it is stored in. Blank means the default. */
function termFor(years, cfg) {
  if (years == null || years === '') return defaultTermYears(cfg) * 12;
  const n = Number(years);
  if (!Number.isInteger(n) || n < TERM_YEARS.min || n > TERM_YEARS.max) {
    throw err(400, `Choose a term of ${TERM_YEARS.min} to ${TERM_YEARS.max} years, in whole years.`, 'invalid_term');
  }
  return n * 12;
}

/** "10-year term"; terms booked before the vault were months, and still say so. */
const termLabel = (months) => (months % 12 === 0 ? `${months / 12}-year term` : `${months}-month term`);

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

/** When something in the vault matures: as booked, or worked out from the default term. */
function maturityOf(t) {
  if (t.side !== 'buy') return { termMonths: null, maturesAt: null };
  if (t.matures_at) return { termMonths: t.term_months == null ? null : Number(t.term_months), maturesAt: new Date(t.matures_at).toISOString() };
  const months = Number(t.term_months) || defaultTermYears(settings.snapshot()) * 12;
  return { termMonths: months, maturesAt: addMonths(t.created_at, months) };
}

/** A date to book at: valid, not in the future, not before VAULT.earliest. */
function bookingDate(at) {
  if (at == null || at === '') return nowIso();
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw err(400, 'Enter a valid date.', 'invalid_date');
  if (when.getTime() > Date.now() + 60000) throw err(400, 'A date in the future cannot be used.', 'future_date');
  if (when.toISOString().slice(0, 10) < VAULT.earliest) {
    throw err(400, `The earliest date that can be used is ${new Date(`${VAULT.earliest}T00:00:00Z`).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' })}.`, 'before_earliest');
  }
  return when.toISOString();
}

/* ------------------------------------------------------------- helpers --- */

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

/*
 * What a trade was, from its reference: OTC- paid in cash through the OTC
 * partner, RCV- Bitcoin received, SND- Bitcoin sent, CNV- a conversion from
 * cash or another asset. INV- is a purchase or sale from before the vault.
 */
const KINDS = { OTC: 'cash', RCV: 'bitcoin', SND: 'sent', CNV: 'converted' };
const kindOf = (t) => KINDS[String(t.reference || '').slice(0, 3)] || (t.side === 'buy' ? 'bought' : 'sold');
const isConversion = (t) => kindOf(t) === 'converted';
const isSend = (t) => kindOf(t) === 'sent';

const longDate = (iso) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long', timeZone: 'UTC' });

function receipt(trade) {
  const { termMonths, maturesAt } = maturityOf(trade);
  const kind = kindOf(trade);
  return [
    { label: kind === 'sent' ? 'Sent' : 'Added', value: `${trade.units} BTC` },
    { label: 'Bitcoin price', value: `${money(trade.price)} on ${longDate(trade.created_at)}` },
    { label: kind === 'cash' ? 'Paid' : 'Value', value: money(trade.amount) },
    ...(trade.side === 'buy' ? [{ label: 'Matures', value: `${longDate(maturesAt)} (${termLabel(termMonths)})` }] : []),
    ...(kind === 'sent' && trade.note ? [{ label: 'To', value: trade.note }] : []),
    { label: 'Reference', value: trade.reference },
  ];
}

function publicTrade(t) {
  const asset = markets.BY_SYMBOL.get(t.symbol) || { name: t.symbol, unit: 'unit' };
  return {
    id: t.id,
    createdAt: t.created_at,
    side: t.side,
    kind: kindOf(t),
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

const actorOf = (user, opts) => (opts.staff
  ? { id: opts.staff.id, email: opts.staff.email, role: 'admin' }
  : opts.system ? { role: 'system' } : { id: user.id, email: user.email, role: 'customer' });

/* ----------------------------------------------------------- vault: in --- */

/**
 * Book Bitcoin into a customer's vault, dated when it happened and priced at
 * Bitcoin's price that day.
 *
 * @param {object} input  { kind: 'cash' | 'bitcoin', amount (cents, cash) | units (bitcoin),
 *                          at (ISO, default now), termYears, note }
 */
async function addToVault(user, input, req, opts = {}) {
  const at = bookingDate(input.at);
  const cfg = await settings.get();
  const termMonths = termFor(input.termYears, cfg);
  const kind = input.kind === 'bitcoin' ? 'bitcoin' : 'cash';

  return withLock(`invest:${user.id}`, async () => {
    const { asset, quote } = await markets.priceAt('BTC', at);
    const pc = priceCents(quote.price);
    let units;
    let amount;
    if (kind === 'bitcoin') {
      units = toScaled(input.units, asset.decimals);
      if (units <= 0n) throw err(400, 'Enter how much Bitcoin arrived.', 'invalid_units');
      amount = valueOf(units, pc, asset.decimals);
    } else {
      amount = Math.round(Number(input.amount));
      if (!Number.isFinite(amount) || amount < MIN_BUY) throw err(400, `The smallest amount is ${money(MIN_BUY)}.`, 'below_minimum');
      units = unitsFor(amount, pc, asset.decimals);
      if (units <= 0n) throw err(400, `${money(amount)} is too small to buy any Bitcoin.`, 'below_minimum');
    }

    const existing = await holdingFor(user.id, asset.symbol);
    const held = existing ? toScaled(existing.units, asset.decimals) : 0n;
    const cost = Number(existing ? existing.cost_basis : 0);
    await saveHolding(existing, user.id, asset, held + units, cost + amount);

    const reference = input.reference || ids.reference(kind === 'bitcoin' ? 'RCV' : 'OTC');
    let trade;
    try {
      trade = await insertTrade({
        id: ids.uuid(), created_at: at, user_id: user.id, account_id: null,
        booked_by: opts.staff ? opts.staff.id : null, note: input.note || null, status: 'completed',
        symbol: asset.symbol, side: 'buy', units: fromScaled(units, asset.decimals), price: pc, amount,
        transaction_id: null, reference, quote_source: quote.source, quote_as_of: quote.asOf,
        term_months: termMonths, matures_at: addMonths(at, termMonths),
      });
    } catch (e) {
      // Put the holding back as it was before reporting the failure.
      await saveHolding(await holdingFor(user.id, asset.symbol), user.id, asset, held, cost);
      throw e;
    }

    await audit.log({
      action: kind === 'bitcoin' ? 'vault.bitcoin_received' : 'vault.cash_received', category: 'money', userId: user.id, req,
      actor: actorOf(user, opts),
      detail: `${trade.units} BTC added (${kind === 'bitcoin' ? 'Bitcoin received' : `${money(amount)} paid through the OTC partner`}) at ${money(pc)} on ${at.slice(0, 10)}, ${termLabel(termMonths)} - ${reference}`,
      meta: { tradeId: trade.id, kind, at },
    });
    if (!opts.silent) {
      await alerts.notifyUser(user, 'investment_trade', {
        subject: `${trade.units} BTC added to your vault`,
        heading: 'Added to your vault',
        intro: kind === 'bitcoin'
          ? `The ${trade.units} BTC you sent has arrived in your vault. It was worth ${money(amount)} at ${money(pc)} on ${longDate(at)}.`
          : `Your payment of ${money(amount)} has bought ${trade.units} BTC at ${money(pc)} on ${longDate(at)}, now in your vault.`,
        rows: receipt(trade),
      }).catch(() => {});
    }
    return { trade: publicTrade(trade) };
  });
}

/* ---------------------------------------------------------- vault: out --- */

/**
 * The lots that make up a holding: each purchase still (partly) held, oldest
 * first, with what is left of its units and cost.
 *
 * Bitcoin sent out comes off lots that had matured when it was sent, earliest
 * maturity first; anything else that left (a sale from before the vault)
 * comes off the oldest first. Anything the holding has that no purchase
 * explains - a balance booked before trades were recorded - is one lot dated
 * when the holding was opened, so the lots always add up to the holding.
 */
function lotsOf(trades, holding, asset) {
  const lots = [];
  const take = (pool, units) => {
    let left = units;
    for (const lot of pool) {
      if (left <= 0n) break;
      if (lot.units <= 0n) continue;
      const out = lot.units <= left ? lot.units : left;
      const costOut = shareOf(lot.cost, out, lot.units);
      lot.cost -= costOut;
      lot.units -= out;
      left -= out;
    }
    for (let i = lots.length - 1; i >= 0; i -= 1) if (lots[i].units <= 0n) lots.splice(i, 1);
    return left;
  };
  const ripeAt = (when) => lots
    .filter((l) => maturityOf(l.trade).maturesAt <= when)
    .sort((a, b) => (maturityOf(a.trade).maturesAt < maturityOf(b.trade).maturesAt ? -1 : 1));

  trades
    .filter((t) => t.status !== 'reversed')
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .forEach((t) => {
      const units = toScaled(t.units, asset.decimals);
      if (t.side === 'buy') lots.push({ trade: t, units, cost: Number(t.amount || 0) });
      else if (isSend(t)) {
        const left = take(ripeAt(t.created_at), units);
        if (left > 0n) take(lots, left);
      } else take(lots, units);
    });

  const held = holding ? toScaled(holding.units, asset.decimals) : 0n;
  const counted = lots.reduce((n, l) => n + l.units, 0n);
  if (counted > held) take(lots, counted - held);
  else if (held > counted) {
    const cost = Math.max(0, Number(holding.cost_basis || 0) - lots.reduce((n, l) => n + l.cost, 0));
    lots.unshift({ trade: { id: `holding-${holding.id}`, side: 'buy', created_at: holding.created_at, price: 0, term_months: null }, units: held - counted, cost });
  }
  return { lots, ripeAt, take };
}

const OPEN_SENDS = ['pending_verification', 'pending'];

/**
 * Bitcoin that has matured and is not already asked to be sent, in satoshis.
 * `excluding` leaves one request out, for approving that request.
 */
async function maturedUnits(userId, { excluding } = {}) {
  const asset = markets.BY_SYMBOL.get('BTC');
  const [holding, trades, sends] = await Promise.all([
    holdingFor(userId, 'BTC'),
    db.trades.find({ user_id: userId, symbol: 'BTC' }, { order: 'created_at.asc' }),
    db.vaultRequests.find({ user_id: userId, kind: 'btc_out' }).catch(() => []),
  ]);
  const now = nowIso();
  const { lots } = lotsOf(trades, holding, asset);
  const ripe = lots.filter((l) => maturityOf(l.trade).maturesAt <= now).reduce((n, l) => n + l.units, 0n);
  const asked = sends
    .filter((r) => OPEN_SENDS.includes(r.status) && r.id !== excluding)
    .reduce((n, r) => n + toScaled(r.units, asset.decimals), 0n);
  return ripe > asked ? ripe - asked : 0n;
}

/**
 * Send matured Bitcoin out of the vault. Called when staff approve a send
 * request, after they have made the transfer; `txid` is that transaction.
 *
 * @param {object} input  { units, address, txid, requestId, reference }
 */
async function sendFromVault(user, input, req, opts = {}) {
  const asset = markets.BY_SYMBOL.get('BTC');
  return withLock(`invest:${user.id}`, async () => {
    const units = toScaled(input.units, asset.decimals);
    if (units <= 0n) throw err(400, 'Enter how much Bitcoin to send.', 'invalid_units');
    const ready = await maturedUnits(user.id, { excluding: input.requestId });
    if (units > ready) {
      throw err(409, `Only Bitcoin that has matured can be sent. ${fromScaled(ready, asset.decimals)} BTC is ready.`, 'not_matured');
    }

    // Valued at the live price when it can be had, the last one seen when not:
    // the units are what leave, the value is for the record.
    let quote = null;
    try {
      ({ quote } = await markets.tradeQuote('BTC'));
    } catch (e) {
      quote = ((await markets.list()).find((a) => a.symbol === 'BTC') || {}).quote || null;
    }
    const pc = quote ? priceCents(quote.price) : 0;
    const value = pc ? valueOf(units, pc, asset.decimals) : 0;

    const [existing, trades] = await Promise.all([
      holdingFor(user.id, 'BTC'),
      db.trades.find({ user_id: user.id, symbol: 'BTC' }, { order: 'created_at.asc' }),
    ]);
    const { ripeAt } = lotsOf(trades, existing, asset);
    let left = units;
    let costOut = 0;
    for (const lot of ripeAt(nowIso())) {
      if (left <= 0n) break;
      const out = lot.units <= left ? lot.units : left;
      costOut += shareOf(lot.cost, out, lot.units);
      left -= out;
    }
    const held = existing ? toScaled(existing.units, asset.decimals) : 0n;
    const cost = Number(existing ? existing.cost_basis : 0);
    await saveHolding(existing, user.id, asset, held - units, cost - costOut);

    const reference = input.reference || ids.reference('SND');
    const trade = {
      id: ids.uuid(), created_at: nowIso(), user_id: user.id, account_id: null,
      booked_by: opts.staff ? opts.staff.id : null, note: input.address || null, status: 'completed',
      symbol: 'BTC', side: 'sell', units: fromScaled(units, asset.decimals), price: pc, amount: value,
      // transaction_id is the ledger's (a uuid); the Bitcoin txid is kept on the request.
      transaction_id: null, reference,
      quote_source: quote ? quote.source : null, quote_as_of: quote ? quote.asOf : null,
      realized_gain: value - costOut,
    };
    try {
      await db.trades.insert(trade);
    } catch (e) {
      await saveHolding(await holdingFor(user.id, 'BTC'), user.id, asset, held, cost);
      throw e;
    }

    await audit.log({
      action: 'vault.sent', category: 'money', userId: user.id, req, actor: actorOf(user, opts), severity: 'notice',
      detail: `${trade.units} BTC sent to ${input.address || 'an address'}${input.txid ? ` (transaction ${input.txid})` : ''} - ${reference}`,
      meta: { tradeId: trade.id, address: input.address, txid: input.txid || null },
    });
    if (!opts.silent) {
      await alerts.notifyUser(user, 'investment_trade', {
        subject: `${trade.units} BTC sent from your vault`,
        heading: 'Bitcoin sent',
        intro: `We have sent ${trade.units} BTC from your vault to ${input.address}.${input.txid ? ` The transaction is ${input.txid}.` : ''}`,
        rows: receipt(trade),
      }).catch(() => {});
    }
    return { trade: publicTrade(trade) };
  });
}

/* ---------------------------------------------------------------- staff --- */

/**
 * Move something in the vault to the date it really happened, or change a
 * purchase's term. Moving it reprices it at that day's price: a cash purchase
 * keeps what was paid and is worth the Bitcoin that bought then; Bitcoin
 * received keeps its units and is valued at that day. The maturity moves
 * with it: it is always the date plus the term.
 */
async function retimeTrade(tradeId, at, staff, note, req, { termYears } = {}) {
  const found = await db.trades.findById(tradeId);
  if (!found) throw err(404, 'Trade not found.');
  return withLock(`invest:${found.user_id}`, async () => {
    const trade = await db.trades.findById(tradeId);
    if (trade.status === 'reversed') throw err(409, 'That trade has been reversed.');
    const iso = at ? bookingDate(at) : trade.created_at;
    const patch = { created_at: iso, note: note || trade.note || null };
    const kind = kindOf(trade);
    const asset = markets.BY_SYMBOL.get(trade.symbol);

    if (trade.side === 'buy' && trade.symbol === 'BTC' && iso !== trade.created_at && kind !== 'converted') {
      const { quote } = await markets.priceAt('BTC', iso);
      const pc = priceCents(quote.price);
      const existing = await holdingFor(trade.user_id, 'BTC');
      const held = existing ? toScaled(existing.units, asset.decimals) : 0n;
      const cost = Number(existing ? existing.cost_basis : 0);
      const units = toScaled(trade.units, asset.decimals);
      if (kind === 'bitcoin') {
        const amount = valueOf(units, pc, asset.decimals);
        await saveHolding(existing, trade.user_id, asset, held, cost + amount - Number(trade.amount || 0));
        patch.amount = amount;
      } else {
        const next = unitsFor(Number(trade.amount || 0), pc, asset.decimals);
        if (held + next - units < 0n) throw err(409, 'Some of this Bitcoin has been sent since; at that date it would have bought less than has gone.', 'units_sent');
        await saveHolding(existing, trade.user_id, asset, held + next - units, cost);
        patch.units = fromScaled(next, asset.decimals);
      }
      Object.assign(patch, { price: pc, quote_source: quote.source, quote_as_of: quote.asOf });
    }

    let term = trade.term_months == null ? null : Number(trade.term_months);
    if (trade.side === 'buy' && termYears != null && termYears !== '') term = termFor(termYears, await settings.get());
    // Only where the columns exist: a row booked without them was booked on a
    // database without them, and an update naming them would be refused.
    if (trade.side === 'buy' && (trade.term_months != null || trade.matures_at)) {
      patch.term_months = term;
      patch.matures_at = addMonths(iso, term);
    } else if (trade.side === 'buy' && term !== null) {
      throw err(409, 'This database cannot store a term yet. Run supabase/setup.sql in Supabase, then try again.', 'term_unsupported');
    }
    await db.trades.update(trade.id, patch);
    if (trade.transaction_id && iso !== trade.created_at) {
      await db.transactions.update(trade.transaction_id, { date: iso });
      if (trade.account_id) await ledger.restate(trade.account_id);
    }
    await audit.log({
      action: 'admin.trade_retimed', category: 'admin', userId: trade.user_id, req, severity: 'notice',
      actor: { id: staff.id, email: staff.email, role: 'admin' },
      detail: `${trade.reference} dated ${iso.slice(0, 10)}${patch.price ? ` at ${money(patch.price)}` : ''}${patch.term_months ? `, ${termLabel(patch.term_months)}` : ''}${note ? ` - ${note}` : ''}`,
      meta: { tradeId: trade.id, from: trade.created_at, to: iso },
    });
    return publicTrade({ ...trade, ...patch });
  });
}

/**
 * Undo something in the vault completely: what came in comes off the
 * holding, what was sent goes back on. A conversion is final, and so is a
 * purchase paid from a cash balance before the vault, whose cash would only
 * be converted straight back.
 */
async function reverseTrade(tradeId, staff, note, req) {
  const trade = await db.trades.findById(tradeId);
  if (!trade) throw err(404, 'Trade not found.');
  if (trade.status === 'reversed') throw err(409, 'That trade has already been reversed.');
  if (isConversion(trade)) {
    throw err(409, 'A conversion to Bitcoin cannot be reversed.', 'conversion_final');
  }
  if (trade.transaction_id) {
    throw err(409, 'This was paid from a cash balance before the vault, so it cannot be reversed. Change its date or term instead.', 'cash_final');
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
        throw err(409, `The customer now holds ${fromScaled(held, asset.decimals)} BTC, less than this added. Reverse the later send first.`);
      }
      await saveHolding(existing, trade.user_id, asset, held - units, cost - Number(trade.amount || 0));
    } else {
      const costSent = Number(trade.amount || 0) - Number(trade.realized_gain || 0);
      await saveHolding(existing, trade.user_id, asset, held + units, cost + costSent);
    }

    const patch = { status: 'reversed', reversed_at: nowIso(), note: note || trade.note || null };
    await db.trades.update(trade.id, patch);
    await audit.log({
      action: 'admin.trade_reversed', category: 'admin', userId: trade.user_id, req, severity: 'notice',
      actor: { id: staff.id, email: staff.email, role: 'admin' },
      detail: `Reversed ${trade.reference}: ${trade.units} BTC (${money(trade.amount)})${note ? ` - ${note}` : ''}`,
      meta: { tradeId: trade.id },
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
 * Bitcoin's. No cash moves. What the customer originally paid carries over as
 * the cost of the Bitcoin, so the gain or loss they had continues rather than
 * restarting at zero. The Bitcoin is new to the vault today, on the default
 * term.
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
    const termMonths = termFor(null, await settings.get());
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
          { label: 'Matures', value: `${longDate(addMonths(nowIso(), termMonths))} (${termLabel(termMonths)})` },
        ],
      }).catch(() => {});
    }
    return out;
  });
}

/**
 * Turn a cash balance left from before the vault into Bitcoin at the live
 * price. The ledger records it: the balance is spent on Bitcoin like any
 * purchase, so the cash history still adds up. Money on hold for a
 * withdrawal from before the vault is left alone until staff release or
 * return it; returned, it is converted the next time.
 */
async function convertCash(user, opts = {}) {
  const out = { converted: [], pending: [] };
  const accounts = await db.accounts.find({ user_id: user.id, status: 'active' });
  for (const account of accounts) {
    const type = ACCOUNT_TYPES[account.type] || ACCOUNT_TYPES.checking;
    if (type.sign === -1 || ['cd', 'loan', 'mortgage'].includes(account.type)) continue;
    if (ledger.availableFor(account) < MIN_BUY) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await withLock(`invest:${user.id}`, () => buyWithCash(user, account.id, opts));
      if (result) out.converted.push(result);
    } catch (e) {
      out.pending.push({ accountId: account.id, reason: e.message });
    }
  }
  if (out.converted.length && !opts.silent) {
    const paid = out.converted.reduce((n, c) => n + c.amount, 0);
    const coins = fromScaled(out.converted.reduce((n, c) => n + toScaled(c.units, 8), 0n), 8);
    const first = out.converted[0];
    await alerts.notifyUser(user, 'investment_trade', {
      subject: 'Your cash is now in Bitcoin',
      heading: 'Your cash is now in Bitcoin',
      intro: `Your vault holds Bitcoin only, so the ${money(paid)} you had in cash has bought ${coins} BTC at ${money(first.price)}.`,
      rows: [
        { label: 'Bitcoin added', value: `${coins} BTC` },
        { label: 'Bitcoin price', value: money(first.price) },
        { label: 'Matures', value: `${longDate(first.maturesAt)} (${termLabel(first.termMonths)})` },
        { label: 'Reference', value: out.converted.map((c) => c.reference).join(', ') },
      ],
    }).catch(() => {});
  }
  return out;
}

/** The whole available balance of one cash account into Bitcoin, inside the customer's lock. */
async function buyWithCash(user, accountId, opts) {
  const account = await db.accounts.findById(accountId);
  const amount = ledger.availableFor(account);
  if (amount < MIN_BUY) return null;
  const { asset, quote } = await markets.tradeQuote('BTC');
  const pc = priceCents(quote.price);
  const bought = unitsFor(amount, pc, asset.decimals);
  if (bought <= 0n) return null;
  const termMonths = termFor(null, await settings.get());
  const reference = ids.reference('CNV');
  const units = fromScaled(bought, asset.decimals);
  const posted = await ledger.post({
    accountId: account.id,
    direction: 'debit',
    amount,
    description: `Converted to Bitcoin - ${units} BTC @ ${money(pc)}`,
    merchant: asset.name,
    method: 'investment',
    category: 'Investments',
    status: 'posted',
    reference,
    createdBy: opts.staff ? 'admin' : 'system',
    createdById: opts.staff ? opts.staff.id : null,
    meta: { symbol: asset.symbol, units, price: pc, source: quote.source },
  });
  const existing = await holdingFor(user.id, asset.symbol);
  const held = existing ? toScaled(existing.units, asset.decimals) : 0n;
  await saveHolding(existing, user.id, asset, held + bought, Number(existing ? existing.cost_basis : 0) + amount);
  const at = nowIso();
  const trade = await insertTrade({
    id: ids.uuid(), created_at: at, user_id: user.id, account_id: account.id,
    booked_by: opts.staff ? opts.staff.id : null, note: 'Cash balance converted to Bitcoin', status: 'completed',
    symbol: asset.symbol, side: 'buy', units, price: pc, amount,
    transaction_id: posted.transaction.id, reference,
    quote_source: quote.source, quote_as_of: quote.asOf,
    term_months: termMonths, matures_at: addMonths(at, termMonths),
  });
  await audit.log({
    action: 'invest.cash_converted', category: 'money', userId: user.id, req: opts.req,
    actor: opts.staff ? { id: opts.staff.id, email: opts.staff.email, role: 'admin' } : { role: 'system' },
    detail: `${money(amount)} cash converted to ${units} BTC at ${money(pc)} - ${reference}`,
    meta: { tradeId: trade.id },
  });
  return { amount, units, price: pc, reference, ...maturityOf(trade) };
}

/** Bring one customer's vault up to date: other assets and cash become Bitcoin. */
async function convertLegacy(user, opts = {}) {
  const retired = await convertRetired(user, opts);
  const cash = await convertCash(user, opts);
  return { converted: [...retired.converted, ...cash.converted], pending: [...retired.pending, ...cash.pending] };
}

/** convertLegacy for every customer who still holds cash or another asset. */
async function convertAllLegacy(opts = {}) {
  const [holdings, accounts] = await Promise.all([db.holdings.find({}), db.accounts.find({ status: 'active' })]);
  const who = new Set([
    ...holdings.filter((h) => h.symbol !== 'BTC').map((h) => h.user_id),
    ...accounts.filter((a) => ledger.availableFor(a) >= MIN_BUY && (ACCOUNT_TYPES[a.type] || {}).sign !== -1).map((a) => a.user_id),
  ]);
  const out = { customers: 0, converted: [], pending: [] };
  if (!who.size) return out;
  const people = await db.users.findByIds([...who]);
  for (const user of people.values()) {
    if (user.role === 'admin') continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await convertLegacy(user, opts);
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

/** Each lot as the customer sees it: when it came in, what it cost, what it is worth, when it matures. */
function positionsOf(trades, holding, asset, pc) {
  const { lots } = lotsOf(trades, holding, asset);
  const now = Date.now();
  return lots.map(({ trade, units, cost }) => {
    const { termMonths, maturesAt } = maturityOf(trade);
    const start = new Date(trade.created_at).getTime();
    const end = new Date(maturesAt).getTime();
    const value = pc ? valueOf(units, pc, asset.decimals) : null;
    return {
      id: trade.id,
      kind: kindOf(trade),
      purchasedAt: trade.created_at,
      units: fromScaled(units, asset.decimals),
      cost,
      price: Number(trade.price) || (units > 0n ? Math.round((cost * Number(SCALE(asset.decimals))) / Number(units)) : 0),
      value,
      gain: value == null ? null : value - cost,
      gainPct: value == null || !cost ? null : Math.round(((value - cost) / cost) * 10000) / 100,
      termMonths,
      termYears: termMonths % 12 === 0 ? termMonths / 12 : null,
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
 * The customer's vault: what it is worth, what went in, and everything that
 * makes it up. Cash and other assets left from before the vault are
 * converted first; if one cannot be yet, `converting` says so without naming
 * it.
 */
async function portfolio(userId) {
  let pending = [];
  const user = await db.users.findById(userId);
  if (user && user.role !== 'admin') {
    try {
      ({ pending } = await convertLegacy(user));
    } catch (e) {
      console.warn(`[hedgestone] converting ${userId} to Bitcoin failed: ${e.message}`);
      pending = [{ reason: e.message }];
    }
  }

  const [btcHolding, trades, btcTrades, assets, ready] = await Promise.all([
    holdingFor(userId, 'BTC'),
    db.trades.find({ user_id: userId, symbol: 'BTC' }, { order: 'created_at.desc', limit: 25 }),
    db.trades.find({ user_id: userId, symbol: 'BTC' }, { order: 'created_at.asc' }),
    markets.list(),
    maturedUnits(userId),
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
      ready: fromScaled(ready, 8),
      readyValue: btcPc ? valueOf(ready, btcPc, 8) : null,
    },
    positions,
    trades: trades.map(publicTrade),
    converting: pending.length > 0,
  };
}

module.exports = {
  addToVault, sendFromVault, maturedUnits, portfolio, publicTrade, retimeTrade, reverseTrade, addMonths,
  convertRetired, convertCash, convertLegacy, convertAllLegacy, termFor, defaultTermYears, termLabel,
  MIN_BUY, TERM_YEARS, MAX_TERM_MONTHS, _units: { toScaled, fromScaled, unitsFor, valueOf },
};
