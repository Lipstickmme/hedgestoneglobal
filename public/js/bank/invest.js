/* Hedgestone Global - the Invest screen.

   Tap an asset, pick how much of a balance to convert (25%, half, all, or an
   amount), see how many units it buys at the live price, confirm. Selling is
   the same sheet the other way round. The server books every trade at the
   price of the moment it is confirmed; this page only ever previews. */
(function () {
  'use strict';

  const RF = window.RF;
  const { api, qs, qsa, esc, money, toast, datetime } = RF;

  let data = null;
  let refreshTimer = null;

  /* ------------------------------------------------------------ helpers -- */

  const dollars = (p) => `$${Number(p).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = (n) => (n == null ? '' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}%`);
  const dirOf = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'flat');
  const unitWord = (asset, n) => (asset.unit === 'share' ? `share${Number(n) === 1 ? '' : 's'}` : asset.unit);
  const assetBy = (symbol) => data && data.assets.find((a) => a.symbol === symbol);
  const holdingBy = (symbol) => data && data.holdings.find((h) => h.symbol === symbol);

  /** How many units `cents` buys at `price` dollars, rounded down like the server does. */
  function previewUnits(cents, price, decimals) {
    if (!(cents > 0) || !(price > 0)) return 0;
    const units = Math.floor(((cents / 100) / price) * 10 ** decimals) / 10 ** decimals;
    return units;
  }
  const fmtUnits = (u, decimals) => Number(u).toLocaleString('en-US', { maximumFractionDigits: decimals });

  const ICON = {
    ETF: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    Stock: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    Crypto: '<path d="M9 6h5a3 3 0 0 1 0 6H9zM9 12h6a3 3 0 0 1 0 6H9zM9 4v16M12 4v2M12 18v2"/>',
    Commodity: '<path d="M4 18h16l-3-6H7zM7 12l2.5-5h5L17 12"/>',
  };
  const icon = (kind) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[kind] || ICON.Stock}</svg>`;

  /* ------------------------------------------------------------- render -- */

  function renderTotals() {
    const t = data.totals;
    qs('[data-inv="value"]').textContent = money(t.value);
    const gain = qs('[data-inv="gain"]');
    gain.textContent = data.holdings.length ? `${t.gain >= 0 ? '+' : '-'}${money(Math.abs(t.gain))} (${pct(t.gainPct || 0)}) all time` : 'Nothing invested yet';
    gain.className = `d ${data.holdings.length ? dirOf(t.gain) : ''}`;
    qs('[data-inv="cost"]').textContent = money(t.cost);
    qs('[data-inv="cash"]').textContent = money(data.accounts.reduce((s, a) => s + Math.max(0, a.available), 0));
    qs('[data-inv="count"]').textContent = String(data.holdings.length);
    const priced = data.assets.filter((a) => a.quote);
    const newest = priced.map((a) => a.quote.fetchedAt).sort().pop();
    qs('[data-inv="asof"]').textContent = newest ? `prices at ${new Date(newest).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'prices unavailable';
    const sources = Array.from(new Set(priced.map((a) => a.quote.source)));
    qs('[data-inv-source]').textContent = sources.length ? `Live prices: ${sources.join(', ')}` : 'Prices unavailable right now';
  }

  function renderAssets() {
    qs('[data-inv-assets]').innerHTML = data.assets.map((a) => {
      const q = a.quote;
      const held = holdingBy(a.symbol);
      const disabled = !q || q.stale;
      return `<button type="button" class="hs-asset ${q ? dirOf(q.change) : ''}" data-convert="${esc(a.symbol)}"${disabled ? ' disabled' : ''}>
        <span class="hs-asset-top"><span class="hs-asset-ic">${icon(a.kind)}</span><span><strong>${esc(a.name)}</strong><small>${esc(a.symbol)} &middot; ${esc(a.kind)}</small></span></span>
        <span class="hs-asset-px">${q ? dollars(q.price) : 'No price'}</span>
        <span class="hs-asset-foot"><span class="chg">${q && q.changePct != null ? `${q.change > 0 ? '&#9650;' : q.change < 0 ? '&#9660;' : ''} ${pct(q.changePct)}` : '&nbsp;'}</span>${held ? `<span class="held">You hold ${fmtUnits(held.units, a.decimals)}</span>` : '<span class="go">Convert &rarr;</span>'}</span>
      </button>`;
    }).join('');
  }

  function renderHoldings() {
    const body = qs('[data-inv-holdings]');
    if (!data.holdings.length) {
      body.innerHTML = '<tr><td colspan="7" class="rf-center rf-muted">You do not hold any assets yet. Tap one above to convert part of your balance.</td></tr>';
      return;
    }
    body.innerHTML = data.holdings.map((h) => {
      const a = assetBy(h.symbol);
      return `<tr>
        <td><strong>${esc(h.name)}</strong><span class="sub">${esc(h.symbol)} &middot; ${esc(h.kind)}</span></td>
        <td class="num rf-mono">${fmtUnits(h.units, a ? a.decimals : 8)}</td>
        <td class="num opt">${money(h.averagePrice)}</td>
        <td class="num opt">${h.price == null ? '&mdash;' : money(h.price)}</td>
        <td class="num"><strong>${h.value == null ? '&mdash;' : money(h.value)}</strong></td>
        <td class="num rf-amt ${h.gain >= 0 ? 'credit' : 'debit'}">${h.gain == null ? '&mdash;' : `${h.gain >= 0 ? '+' : '-'}${money(Math.abs(h.gain))}<span class="sub">${pct(h.gainPct)}</span>`}</td>
        <td class="num rf-nowrap"><button class="rf-btn ghost sm" data-convert="${esc(h.symbol)}">Buy</button> <button class="rf-btn ghost sm" data-sell="${esc(h.symbol)}">Sell</button></td>
      </tr>`;
    }).join('');
  }

  function renderTrades() {
    const list = qs('[data-inv-trades]');
    if (!data.trades.length) {
      list.innerHTML = '<li class="rf-muted rf-small">Your conversions will appear here.</li>';
      return;
    }
    list.innerHTML = data.trades.slice(0, 8).map((t) => `<li>
      <span class="hs-trade-side ${t.side}">${t.side === 'buy' ? 'Bought' : 'Sold'}</span>
      <span class="hs-trade-main"><strong>${esc(t.units)} ${esc(t.symbol)}</strong><small>${datetime(t.createdAt)} &middot; @ ${money(t.price)}</small></span>
      <span class="rf-amt ${t.side === 'buy' ? 'debit' : 'credit'}">${t.side === 'buy' ? '-' : '+'}${money(t.amount)}</span>
    </li>`).join('');
  }

  function render() {
    renderTotals();
    renderAssets();
    renderHoldings();
    renderTrades();
  }

  async function load() {
    data = await api.get('/invest');
    render();
  }

  /* -------------------------------------------------------------- sheets -- */

  function sheet(html) {
    const el = document.createElement('div');
    el.className = 'rf-modal-backdrop';
    el.innerHTML = `<div class="rf-modal hs-sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(el);
    RF.modal.open(el);
    const close = () => { RF.modal.close(el); el.remove(); clearInterval(refreshTimer); };
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    qsa('[data-close-modal]', el).forEach((b) => b.addEventListener('click', close));
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } });
    return { el, close };
  }

  /** Keep the price in an open sheet live, so the preview never goes stale. */
  function keepLive(onPrice) {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      try {
        const fresh = await api.get('/markets');
        fresh.assets.forEach((a) => {
          const mine = assetBy(a.symbol);
          if (mine && a.quote) mine.quote = a.quote;
        });
        onPrice();
      } catch (err) { /* keep the last price */ }
    }, 15000);
  }

  function receiptHtml(trade, asset) {
    return `<div class="hs-receipt">
      <div class="hs-receipt-ok">&#10003;</div>
      <h3>${trade.side === 'buy' ? 'Converted' : 'Sold'}</h3>
      <p class="rf-muted">${trade.side === 'buy'
    ? `${money(trade.amount)} is now <strong>${esc(trade.units)} ${unitWord(asset, trade.units)}</strong> of ${esc(asset.name)}.`
    : `${esc(trade.units)} ${unitWord(asset, trade.units)} of ${esc(asset.name)} became <strong>${money(trade.amount)}</strong>.`}</p>
      <dl class="rf-dl">
        <dt>Price</dt><dd>${money(trade.price)} per ${asset.unit === 'share' ? 'share' : asset.unit}</dd>
        <dt>${trade.side === 'buy' ? 'Debited' : 'Credited'}</dt><dd>${money(trade.amount)}</dd>
        <dt>Price source</dt><dd>${esc(trade.source || '')}</dd>
        <dt>Reference</dt><dd class="rf-mono">${esc(trade.reference)}</dd>
      </dl>
      <button class="rf-btn lg hs-block" type="button" data-close-modal>Done</button>
    </div>`;
  }

  /** Convert: cash -> asset. */
  function openConvert(symbol) {
    const asset = assetBy(symbol) || data.assets.find((a) => a.quote && !a.quote.stale);
    if (!asset || !asset.quote) { toast('There is no live price for that asset right now.', 'bad'); return; }
    if (!data.accounts.length) { toast('You need a checking or savings account to convert from.', 'bad'); return; }

    const options = data.assets.filter((a) => a.quote).map((a) => `<option value="${esc(a.symbol)}"${a.symbol === asset.symbol ? ' selected' : ''}>${esc(a.name)} (${esc(a.symbol)})</option>`).join('');
    const accounts = data.accounts.map((a, i) => `<option value="${esc(a.id)}"${i === 0 ? ' selected' : ''}>${esc(a.nickname || a.name)} &bull;&bull;${esc(a.last4)} - ${money(a.available)} available</option>`).join('');

    const { el, close } = sheet(`
      <div class="rf-modal-head"><h3>Convert balance</h3><button type="button" data-close-modal aria-label="Close">&times;</button></div>
      <form class="rf-modal-body" data-form novalidate>
        <div class="hs-sheet-asset" data-asset-head></div>
        <div class="rf-field"><label class="rf-label" for="inv-asset">Asset</label><select class="rf-select" id="inv-asset" name="symbol">${options}</select></div>
        <div class="rf-field"><label class="rf-label" for="inv-account">From</label><select class="rf-select" id="inv-account" name="accountId">${accounts}</select></div>
        <div class="rf-field">
          <label class="rf-label" for="inv-amount">Amount</label>
          <input class="rf-input money" id="inv-amount" name="amount" inputmode="decimal" placeholder="0.00" autocomplete="off" />
          <div class="hs-chips" role="group" aria-label="Quick amounts">
            <button type="button" data-pct="25">25%</button><button type="button" data-pct="50">50%</button><button type="button" data-pct="75">75%</button><button type="button" data-pct="100">Max</button>
          </div>
        </div>
        <div class="hs-preview" data-preview aria-live="polite"></div>
        <div class="rf-notice bad rf-hide" data-error></div>
        <button class="rf-btn lg hs-block" type="submit" data-submit disabled>Convert</button>
        <p class="rf-small rf-muted hs-center">Booked at the live price when you confirm. Not FDIC insured. May lose value.</p>
      </form>`);

    const f = qs('[data-form]', el);
    const sel = qs('#inv-asset', el);
    const acct = qs('#inv-account', el);
    const amt = qs('#inv-amount', el);
    let pctChosen = null;

    const current = () => assetBy(sel.value);
    const account = () => data.accounts.find((a) => a.id === acct.value);
    const cents = () => {
      if (pctChosen != null) return Math.floor((account().available * pctChosen) / 100);
      const n = Number(String(amt.value).replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? Math.round(n * 100) : 0;
    };

    function paint() {
      const a = current();
      const q = a.quote;
      qs('[data-asset-head]', el).innerHTML = `<span class="hs-asset-ic">${icon(a.kind)}</span>
        <span><strong>${esc(a.name)}</strong><small>${esc(a.detail)}</small></span>
        <span class="hs-sheet-px ${dirOf(q.change)}">${dollars(q.price)}<small>${pct(q.changePct)}</small></span>`;
      const c = cents();
      const units = previewUnits(c, q.price, a.decimals);
      const tooMuch = c > account().available;
      const tooSmall = c > 0 && c < data.minimum;
      qs('[data-preview]', el).innerHTML = c > 0
        ? `<div><span>You pay</span><strong>${money(c)}</strong></div>
           <div><span>You get about</span><strong>${fmtUnits(units, a.decimals)} ${unitWord(a, units)}</strong></div>
           <div><span>At</span><strong>${dollars(q.price)} per ${a.unit === 'share' ? 'share' : a.unit}</strong></div>
           ${tooMuch ? `<p class="hs-warn">That is more than the ${money(account().available)} available.</p>` : ''}
           ${tooSmall ? `<p class="hs-warn">The smallest conversion is ${money(data.minimum)}.</p>` : ''}`
        : '<p class="rf-muted rf-small">Enter an amount or tap a percentage.</p>';
      const btn = qs('[data-submit]', el);
      btn.disabled = !(c >= data.minimum) || tooMuch || units <= 0;
      btn.textContent = c > 0 ? `Convert ${money(c)} to ${a.name}` : 'Convert';
      qsa('[data-pct]', el).forEach((b) => b.classList.toggle('is-active', Number(b.dataset.pct) === pctChosen));
    }

    qsa('[data-pct]', el).forEach((b) => b.addEventListener('click', () => {
      pctChosen = Number(b.dataset.pct);
      amt.value = (Math.floor((account().available * pctChosen) / 100) / 100).toFixed(2);
      paint();
    }));
    amt.addEventListener('input', () => { pctChosen = null; paint(); });
    sel.addEventListener('change', paint);
    acct.addEventListener('change', () => {
      if (pctChosen != null) amt.value = (Math.floor((account().available * pctChosen) / 100) / 100).toFixed(2);
      paint();
    });
    keepLive(paint);
    paint();
    setTimeout(() => amt.focus(), 50);

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = qs('[data-submit]', el);
      const errBox = qs('[data-error]', el);
      errBox.classList.add('rf-hide');
      const a = current();
      const body = { accountId: acct.value, symbol: a.symbol, quotedPrice: a.quote.price };
      if (pctChosen === 100) body.all = true;
      else if (pctChosen != null) body.percent = pctChosen;
      else body.amount = (cents() / 100).toFixed(2);
      btn.disabled = true;
      btn.classList.add('is-busy');
      try {
        const res = await api.post('/invest/convert', body);
        clearInterval(refreshTimer);
        qs('.hs-sheet', el).innerHTML = receiptHtml(res.trade, a);
        qsa('[data-close-modal]', el).forEach((b) => b.addEventListener('click', close));
        toast(`Converted ${money(res.trade.amount)} to ${res.trade.units} ${a.symbol}.`, 'ok');
        load().catch(() => {});
      } catch (err) {
        if (err.code === 'price_moved' && err.body && err.body.details) {
          a.quote = { ...a.quote, ...err.body.details.quote };
          paint();
        }
        errBox.innerHTML = `<div>${esc(err.message)}</div>`;
        errBox.classList.remove('rf-hide');
        btn.disabled = false;
      } finally {
        btn.classList.remove('is-busy');
      }
    });
  }

  /** Sell: asset -> cash. */
  function openSell(symbol) {
    const h = holdingBy(symbol);
    const asset = assetBy(symbol);
    if (!h || !asset) return;
    if (!asset.quote || asset.quote.stale) { toast(`There is no live price for ${asset.name} right now.`, 'bad'); return; }
    const accounts = data.accounts.map((a, i) => `<option value="${esc(a.id)}"${i === 0 ? ' selected' : ''}>${esc(a.nickname || a.name)} &bull;&bull;${esc(a.last4)}</option>`).join('');

    const { el, close } = sheet(`
      <div class="rf-modal-head"><h3>Sell ${esc(asset.name)}</h3><button type="button" data-close-modal aria-label="Close">&times;</button></div>
      <form class="rf-modal-body" data-form novalidate>
        <div class="hs-sheet-asset" data-asset-head></div>
        <div class="rf-field">
          <label class="rf-label" for="inv-units">How much (${esc(asset.unit === 'share' ? 'shares' : asset.unit)})</label>
          <input class="rf-input money" id="inv-units" name="units" inputmode="decimal" placeholder="0" autocomplete="off" />
          <div class="hs-chips" role="group" aria-label="Quick amounts">
            <button type="button" data-pct="25">25%</button><button type="button" data-pct="50">50%</button><button type="button" data-pct="75">75%</button><button type="button" data-pct="100">All</button>
          </div>
          <div class="hint">You hold ${fmtUnits(h.units, asset.decimals)} ${unitWord(asset, h.units)}.</div>
        </div>
        <div class="rf-field"><label class="rf-label" for="inv-to">Pay into</label><select class="rf-select" id="inv-to" name="accountId">${accounts}</select></div>
        <div class="hs-preview" data-preview aria-live="polite"></div>
        <div class="rf-notice bad rf-hide" data-error></div>
        <button class="rf-btn lg hs-block" type="submit" data-submit disabled>Sell</button>
      </form>`);

    const units = qs('#inv-units', el);
    let pctChosen = null;
    const held = Number(h.units);
    const chosen = () => (pctChosen != null ? Math.floor(held * pctChosen / 100 * 10 ** asset.decimals) / 10 ** asset.decimals : Number(String(units.value).replace(/[^0-9.]/g, '')) || 0);

    function paint() {
      const q = asset.quote;
      qs('[data-asset-head]', el).innerHTML = `<span class="hs-asset-ic">${icon(asset.kind)}</span>
        <span><strong>${esc(asset.name)}</strong><small>${esc(asset.detail)}</small></span>
        <span class="hs-sheet-px ${dirOf(q.change)}">${dollars(q.price)}<small>${pct(q.changePct)}</small></span>`;
      const u = pctChosen === 100 ? held : chosen();
      const proceeds = Math.floor(u * q.price * 100);
      const over = u > held + 1e-12;
      qs('[data-preview]', el).innerHTML = u > 0
        ? `<div><span>You sell</span><strong>${fmtUnits(u, asset.decimals)} ${unitWord(asset, u)}</strong></div>
           <div><span>You get about</span><strong>${money(proceeds)}</strong></div>
           ${over ? '<p class="hs-warn">That is more than you hold.</p>' : ''}`
        : '<p class="rf-muted rf-small">Enter an amount or tap a percentage.</p>';
      const btn = qs('[data-submit]', el);
      btn.disabled = !(u > 0) || over || proceeds < 1;
      btn.textContent = u > 0 ? `Sell for about ${money(proceeds)}` : 'Sell';
      qsa('[data-pct]', el).forEach((b) => b.classList.toggle('is-active', Number(b.dataset.pct) === pctChosen));
    }

    qsa('[data-pct]', el).forEach((b) => b.addEventListener('click', () => {
      pctChosen = Number(b.dataset.pct);
      units.value = pctChosen === 100 ? h.units : String(chosen());
      paint();
    }));
    units.addEventListener('input', () => { pctChosen = null; paint(); });
    keepLive(paint);
    paint();

    qs('[data-form]', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = qs('[data-submit]', el);
      const errBox = qs('[data-error]', el);
      errBox.classList.add('rf-hide');
      const body = { accountId: qs('#inv-to', el).value, symbol: asset.symbol, quotedPrice: asset.quote.price };
      if (pctChosen === 100) body.all = true;
      else if (pctChosen != null) body.percent = pctChosen;
      else body.units = String(units.value).replace(/[^0-9.]/g, '');
      btn.disabled = true;
      btn.classList.add('is-busy');
      try {
        const res = await api.post('/invest/sell', body);
        clearInterval(refreshTimer);
        qs('.hs-sheet', el).innerHTML = receiptHtml(res.trade, asset);
        qsa('[data-close-modal]', el).forEach((b) => b.addEventListener('click', close));
        toast(`Sold ${res.trade.units} ${asset.symbol} for ${money(res.trade.amount)}.`, 'ok');
        load().catch(() => {});
      } catch (err) {
        if (err.code === 'price_moved' && err.body && err.body.details) {
          asset.quote = { ...asset.quote, ...err.body.details.quote };
          paint();
        }
        errBox.innerHTML = `<div>${esc(err.message)}</div>`;
        errBox.classList.remove('rf-hide');
        btn.disabled = false;
      } finally {
        btn.classList.remove('is-busy');
      }
    });
  }

  /* --------------------------------------------------------------- boot -- */

  document.addEventListener('click', (e) => {
    const conv = e.target.closest('[data-convert]');
    if (conv && data) { e.preventDefault(); openConvert(conv.dataset.convert); return; }
    const sell = e.target.closest('[data-sell]');
    if (sell && data) { e.preventDefault(); openSell(sell.dataset.sell); return; }
    if (e.target.closest('[data-inv-quick]') && data) { e.preventDefault(); openConvert('SPY'); }
  });

  RF.ready(async () => {
    try {
      await load();
      // /invest?convert=BTC - from the ticker - opens straight onto that asset.
      const wanted = new URLSearchParams(location.search).get('convert');
      if (wanted && assetBy(wanted.toUpperCase())) openConvert(wanted.toUpperCase());
      setInterval(() => { if (!document.hidden && !qs('.hs-sheet')) load().catch(() => {}); }, 30000);
    } catch (err) {
      toast(err.message || 'Investments could not load.', 'bad');
    }
  });
}());
