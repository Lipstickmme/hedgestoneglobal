'use strict';

/**
 * Converting a cash balance into listed assets, and back again.
 *
 * A conversion debits a deposit account through the ledger like any other
 * payment, at the live price of the moment, and books the units it bought
 * against the customer's holding of that asset. Selling is the same in
 * reverse: units come off the holding and the proceeds are credited to the
 * account the customer chooses.
 *
 * Arithmetic is exact. Cash is integer cents, as everywhere in the bank; units
 * are carried as BigInt multiples of the asset's smallest unit (a millionth of
 * a share, a satoshi) and stored as decimal strings, so no balance is ever the
 * result of a floating-point rounding error. Units bought are rounded down and
 * proceeds of a sale are rounded down: the bank never books more than the
 * money paid for.
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
  if (account.status !== 'active') throw err(409, `That account is ${account.status}, so it cannot be used to invest.`);
  const type = ACCOUNT_TYPES[account.type] || ACCOUNT_TYPES.checking;
  if (type.sign === -1 || ['cd', 'loan', 'mortgage'].includes(account.type)) {
    throw err(400, 'Investments are funded from, and paid into, a checking or savings account.');
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
    { label: trade.side === 'buy' ? 'Amount debited' : 'Amount credited', value: money(trade.amount) },
    { label: trade.side === 'buy' ? 'From' : 'To', value: `${account.nickname || account.name} (${ids.maskAccount(account.account_number)})` },
    { label: 'Reference', value: trade.reference },
  ];
}

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
    transactionId: t.transaction_id,
  };
}

/* ----------------------------------------------------------------- buy --- */

/**
 * Convert part or all of an account's available balance into an asset.
 *
 * @param {object} user
 * @param {object} input  { accountId, symbol, amount (cents) | percent | all, quotedPrice }
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

    if (!Number.isFinite(amount) || amount < MIN_BUY) throw err(400, `The smallest conversion is ${money(MIN_BUY)}.`, 'below_minimum');
    if (amount > available) {
      throw err(400, `Not enough available funds. ${money(available)} is available in that account.`, 'insufficient_funds');
    }
    const cfg = await settings.get();
    const cap = Number(cfg.limits && cfg.limits.singleTransactionMax) || 0;
    if (cap && amount > cap) throw err(400, `The most you can convert at once is ${money(cap)}.`, 'limit_exceeded');

    const { asset, quote } = opts.price ? staffQuote(input.symbol, opts) : await markets.tradeQuote(input.symbol);
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
      description: `Converted to ${asset.name} - ${units} ${asset.unit === 'share' ? 'sh' : asset.unit} @ ${money(pc)}`,
      merchant: 'Hedgestone Invest',
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
      trade = {
        id: ids.uuid(), created_at: opts.at || nowIso(), user_id: user.id, account_id: account.id,
        booked_by: opts.staff ? opts.staff.id : null, note: opts.note || null, status: 'completed',
        symbol: asset.symbol, side: 'buy', units, price: pc, amount,
        transaction_id: posted.transaction.id, reference,
        quote_source: quote.source, quote_as_of: quote.asOf,
      };
      await db.trades.insert(trade);
    } catch (e) {
      // The money left the account but the holding was not booked: put it back.
      await ledger.post({
        accountId: account.id, direction: 'credit', amount,
        description: `Reversal - conversion to ${asset.name} could not be completed`,
        method: 'investment', category: 'Investments', reference,
        createdBy: 'system',
      });
      throw err(500, 'The conversion could not be completed and has been reversed. Nothing was charged.', 'conversion_failed', { expose: true });
    }

    await audit.log({
      action: 'invest.buy', category: 'money', userId: user.id, req,
      actor: opts.staff ? { id: opts.staff.id, email: opts.staff.email, role: 'admin' } : { id: user.id, email: user.email, role: 'customer' },
      detail: `${money(amount)} converted to ${units} ${asset.symbol} at ${money(pc)} - ${reference}`,
      meta: { tradeId: trade.id, symbol: asset.symbol },
    });
    await alerts.notifyUser(user, 'investment_trade', {
      subject: `${money(amount)} converted to ${asset.name}`,
      heading: `You now hold more ${asset.name}`,
      intro: `We converted ${money(amount)} from your account into ${units} ${asset.unit === 'share' ? 'shares of' : asset.unit} ${asset.name} at ${money(pc)}.`,
      rows: receipt(trade, asset, account),
    }).catch(() => {});

    if (opts.at) await ledger.restate(account.id);
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
    const asset = markets.BY_SYMBOL.get(String(input.symbol || '').toUpperCase());
    if (!asset) throw err(400, 'That asset is not available.');
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
        merchant: 'Hedgestone Invest',
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

/** Move a trade, and its ledger entry, to the time it actually happened. */
async function retimeTrade(tradeId, at, staff, note, req) {
  const trade = await db.trades.findById(tradeId);
  if (!trade) throw err(404, 'Trade not found.');
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) throw err(400, 'Enter a valid date and time.');
  if (when.getTime() > Date.now() + 60000) throw err(400, 'A trade cannot be dated in the future.');
  const iso = when.toISOString();
  await db.trades.update(trade.id, { created_at: iso, note: note || trade.note || null });
  if (trade.transaction_id) await db.transactions.update(trade.transaction_id, { date: iso });
  if (trade.account_id) await ledger.restate(trade.account_id);
  await audit.log({
    action: 'admin.trade_retimed', category: 'admin', userId: trade.user_id, req, severity: 'notice',
    actor: { id: staff.id, email: staff.email, role: 'admin' },
    detail: `${trade.side === 'buy' ? 'Conversion' : 'Sale'} ${trade.reference} moved to ${iso}${note ? ` - ${note}` : ''}`,
    meta: { tradeId: trade.id, from: trade.created_at, to: iso },
  });
  return publicTrade({ ...trade, created_at: iso });
}

/**
 * Undo a trade completely: the units come off (or go back on) the holding and
 * the cash goes back (or comes back out) through a ledger reversal.
 */
async function reverseTrade(tradeId, staff, note, req) {
  const trade = await db.trades.findById(tradeId);
  if (!trade) throw err(404, 'Trade not found.');
  if (trade.status === 'reversed') throw err(409, 'That trade has already been reversed.');
  const asset = markets.BY_SYMBOL.get(trade.symbol);
  if (!asset) throw err(400, 'That asset is no longer listed.');

  return withLock(`invest:${trade.user_id}`, async () => {
    const existing = await holdingFor(trade.user_id, asset.symbol);
    const held = existing ? toScaled(existing.units, asset.decimals) : 0n;
    const units = toScaled(trade.units, asset.decimals);
    const cost = Number(existing ? existing.cost_basis : 0);

    if (trade.side === 'buy') {
      if (held < units) {
        throw err(409, `The customer now holds ${fromScaled(held, asset.decimals)} ${asset.symbol}, fewer than this conversion bought. Reverse the later sale first.`);
      }
      await saveHolding(existing, trade.user_id, asset, held - units, cost - Number(trade.amount || 0));
    } else {
      const costSold = Number(trade.amount || 0) - Number(trade.realized_gain || 0);
      await saveHolding(existing, trade.user_id, asset, held + units, cost + costSold);
    }

    let reversal = null;
    if (trade.transaction_id) {
      reversal = await ledger.reverse(trade.transaction_id, {
        reason: note || `${trade.side === 'buy' ? 'Conversion' : 'Sale'} reversed by the bank`,
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

/* ----------------------------------------------------------- portfolio --- */

/** Holdings valued at the latest prices, with what each cost. */
async function portfolio(userId) {
  const [rows, assets, trades] = await Promise.all([
    db.holdings.find({ user_id: userId }),
    markets.list(),
    db.trades.find({ user_id: userId }, { order: 'created_at.desc', limit: 25 }),
  ]);
  const bySymbol = new Map(assets.map((a) => [a.symbol, a]));

  const holdings = rows.map((h) => {
    const asset = bySymbol.get(h.symbol);
    if (!asset) return null;
    const scaled = toScaled(h.units, asset.decimals);
    const pc = asset.quote ? priceCents(asset.quote.price) : null;
    const value = pc ? valueOf(scaled, pc, asset.decimals) : null;
    const cost = Number(h.cost_basis || 0);
    return {
      symbol: h.symbol,
      name: asset.name,
      kind: asset.kind,
      unit: asset.unit,
      units: h.units,
      costBasis: cost,
      averagePrice: scaled > 0n ? Math.round((cost * Number(SCALE(asset.decimals))) / Number(scaled)) : 0,
      price: pc,
      value,
      gain: value == null ? null : value - cost,
      gainPct: value == null || !cost ? null : Math.round(((value - cost) / cost) * 10000) / 100,
      dayChangePct: asset.quote ? asset.quote.changePct : null,
    };
  }).filter(Boolean).sort((a, b) => (b.value || 0) - (a.value || 0));

  const valued = holdings.filter((h) => h.value != null);
  const totalValue = valued.reduce((s, h) => s + h.value, 0);
  const totalCost = valued.reduce((s, h) => s + h.costBasis, 0);

  return {
    assets,
    holdings,
    totals: {
      value: totalValue,
      cost: totalCost,
      gain: totalValue - totalCost,
      gainPct: totalCost ? Math.round(((totalValue - totalCost) / totalCost) * 10000) / 100 : null,
    },
    trades: trades.map(publicTrade),
  };
}

module.exports = { convert, sell, portfolio, publicTrade, retimeTrade, reverseTrade, MIN_BUY, PRICE_TOLERANCE, _units: { toScaled, fromScaled, unitsFor, valueOf } };
