'use strict';

/**
 * The pages a customer spends their time on: the dashboard, transactions,
 * alerts and secure messages.
 *
 * One script for all of them, with a small router at the bottom, because they
 * share the same rendering helpers and loading the same script once is
 * cheaper than four files that each redefine a transaction row.
 */

(function () {
  const RF = window.RF;
  const { api, qs, qsa, esc, money, signedMoney, date, datetime, ago, toast, badge } = RF;

  /* ------------------------------------------------------------- shared -- */

  /** The detail sheet for one entry, opened from any transaction table. */
  async function openTransaction(id) {
    let data;
    try {
      data = await api.get(`/transactions/${id}`);
    } catch (err) {
      toast(err.message, 'bad');
      return;
    }
    const tx = data.transaction;
    const transfer = data.transfer;
    const rows = [
      ['Amount', `<span class="rf-amt ${tx.direction}">${signedMoney(tx.amount, tx.direction)}</span>`],
      ['Date', datetime(tx.date)],
      ['Posted', tx.postedAt ? datetime(tx.postedAt) : 'Not yet posted'],
      ['Status', badge(tx.status)],
      ['Method', esc(tx.methodLabel)],
      ['Category', esc(tx.category)],
      ['Account', `${esc(tx.accountName)} &bull;&bull;${esc(tx.accountLast4)}`],
      ['Balance after', tx.balanceAfter == null ? '&mdash;' : money(tx.balanceAfter)],
      ['Reference', `<span class="rf-mono">${esc(tx.reference)}</span>`],
    ];
    if (tx.traceNumber) rows.push(['Trace reference', `<span class="rf-mono">${esc(tx.traceNumber)}</span>`]);
    if (tx.location) rows.push(['Where', esc(tx.location)]);
    if (tx.memo) rows.push(['Memo', esc(tx.memo)]);
    if (tx.counterparty && tx.counterparty.name) {
      rows.push(['Counterparty', esc(tx.counterparty.name)]);
      if (tx.counterparty.bank) rows.push(['Held at', esc(tx.counterparty.bank)]);
      if (tx.counterparty.accountMasked || tx.counterparty.account_masked) {
        rows.push(['Their account', esc(tx.counterparty.accountMasked || tx.counterparty.account_masked)]);
      }
    }
    if (transfer) rows.push(['Confirmation', `<span class="rf-mono">${esc(transfer.confirmation)}</span>`]);

    const el = document.createElement('div');
    el.className = 'rf-modal-backdrop';
    el.innerHTML = `
      <div class="rf-modal">
        <div class="rf-modal-head">
          <h3>${esc(tx.description)}</h3>
          <button type="button" data-close-modal aria-label="Close">&times;</button>
        </div>
        <div class="rf-modal-body">
          <dl class="rf-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
          <p class="rf-small rf-muted rf-mt">Something wrong with this entry? <a href="/messages">Send us a message</a> and quote the reference.</p>
        </div>
      </div>`;
    document.body.appendChild(el);
    RF.modal.wire(el);
    RF.modal.open(el);
    el.addEventListener('click', (event) => { if (event.target === el) el.remove(); });
    qsa('[data-close-modal]', el).forEach((b) => b.addEventListener('click', () => el.remove()));
  }

  /** Every transaction table on the page gets click-to-open, once. */
  function wireTxTables(root) {
    qsa('[data-recent-list], [data-rows]', root || document).forEach((tbody) => {
      if (tbody.dataset.wired) return;
      tbody.dataset.wired = '1';
      tbody.addEventListener('click', (event) => {
        const row = event.target.closest('[data-tx]');
        if (row) openTransaction(row.getAttribute('data-tx'));
      });
    });
  }

  /* ---------------------------------------------------------- dashboard -- */

  const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(Number(n)).toFixed(2)}%`;
  const signed = (cents) => `${cents >= 0 ? '+' : '−'}${money(Math.abs(cents))}`;
  const longDate = (iso) => date(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  const DAY = 86400000;

  /** "1 year, 3 months" or "95 days": how long, in words that suit the size. */
  function span(days) {
    if (days < 62) return `${days} day${days === 1 ? '' : 's'}`;
    const months = Math.round(days / 30.44);
    const years = Math.floor(months / 12);
    const rest = months % 12;
    if (!years) return `${months} months`;
    return `${years} year${years === 1 ? '' : 's'}${rest ? `, ${rest} month${rest === 1 ? '' : 's'}` : ''}`;
  }

  async function dashboard() {
    const heading = qs('.rf-top h1');
    const overview = api.get('/overview').then((data) => {
      if (heading && data.user) {
        const hour = new Date().getHours();
        const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
        heading.textContent = `${part}, ${data.user.preferredName || data.user.firstName || ''}`.trim();
      }
      qs('[data-stat="cash"]').textContent = money(data.totals.available);
      if (data.totals.available !== data.totals.deposits) {
        qs('[data-stat="cashSub"]').textContent = `of ${money(data.totals.deposits)}; the rest is on hold`;
      }
      const recent = data.recent.slice(0, 6);
      qs('[data-recent-list]').innerHTML = recent.length
        ? recent.map((tx) => `<li class="clickable" data-tx="${esc(tx.id)}">
            <span class="t"><strong>${esc(tx.description)}</strong><span>${date(tx.date)}${tx.status === 'posted' ? '' : ` &middot; ${esc(tx.status)}`}</span></span>
            <span class="rf-amt ${tx.direction}">${signedMoney(tx.amount, tx.direction)}</span>
          </li>`).join('')
        : '<li class="rf-muted rf-small">Nothing yet.</li>';
      wireTxTables();
    });

    const inv = await api.get('/invest');
    const btc = inv.bitcoin;
    const positions = inv.positions || [];

    // The headline: what the Bitcoin is worth, what went in, and the difference.
    qs('[data-hero="value"]').textContent = btc.value == null ? '—' : money(btc.value);
    qs('[data-hero="cost"]').textContent = money(btc.cost);
    const gainEl = qs('[data-hero="gain"]');
    gainEl.textContent = btc.value == null ? '—' : `${signed(btc.gain)}${btc.gainPct == null ? '' : ` (${pct(btc.gainPct)})`}`;
    gainEl.classList.toggle('down', (btc.gain || 0) < 0);
    qs('[data-hero="units"]').textContent = `${btc.units} BTC`;

    if (btc.firstPurchasedAt) {
      const held = Math.floor((Date.now() - new Date(btc.firstPurchasedAt).getTime()) / DAY);
      qs('[data-stat="since"]').textContent = longDate(btc.firstPurchasedAt);
      qs('[data-stat="sinceSub"]').textContent = `${span(held)} invested`;
    } else {
      qs('[data-stat="since"]').textContent = 'Not yet';
      qs('[data-stat="sinceSub"]').textContent = 'Buy Bitcoin to start';
    }
    if (btc.nextMaturity) {
      const left = Math.max(0, Math.ceil((new Date(btc.nextMaturity).getTime() - Date.now()) / DAY));
      qs('[data-stat="maturity"]').textContent = longDate(btc.nextMaturity);
      qs('[data-stat="maturitySub"]').textContent = `${span(left)} to go`;
    } else {
      qs('[data-stat="maturity"]').textContent = positions.length ? 'All matured' : '—';
      qs('[data-stat="maturitySub"]').textContent = positions.length ? 'Every purchase has reached its term' : 'Chosen when you buy';
    }
    if (btc.price) {
      qs('[data-stat="price"]').textContent = money(btc.price);
      qs('[data-stat="priceSub"]').innerHTML = `${btc.dayChangePct == null ? '' : `<span class="rf-amt ${btc.dayChangePct >= 0 ? 'credit' : 'debit'}">${pct(btc.dayChangePct)}</span> today &middot; `}${esc(btc.source)}`;
    }

    // Each purchase, as a row: what went in, what it is worth now.
    qs('[data-positions]').innerHTML = positions.length
      ? positions.slice().reverse().map((p) => `<tr>
          <td class="rf-nowrap">${longDate(p.purchasedAt)}<span class="sub">${money(p.cost)} &middot; ${esc(p.units)} BTC</span></td>
          <td class="num opt">${money(p.cost)}</td>
          <td class="num opt">${p.price ? money(p.price) : '&mdash;'}</td>
          <td class="num">${p.value == null ? '&mdash;' : money(p.value)}</td>
          <td class="num rf-amt ${(p.gain || 0) >= 0 ? 'credit' : 'debit'}">${p.gain == null ? '&mdash;' : `${signed(p.gain)}<span class="sub">${p.gainPct == null ? '' : pct(p.gainPct)}</span>`}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="rf-center rf-muted">No Bitcoin yet. <a href="/invest?buy=1">Buy your first</a> and it appears here.</td></tr>';

    // How far through its term each purchase is.
    qs('[data-terms]').innerHTML = positions.length
      ? positions.slice().sort((a, b) => (a.maturesAt < b.maturesAt ? -1 : 1)).map((p) => {
        const share = Math.round(p.progress * 100);
        return `<li class="hs-term${p.matured ? ' is-matured' : ''}">
          <span class="t">
            <strong>${p.matured ? 'Matured' : `${span(p.daysToMaturity)} to go`}</strong>
            <span>${money(p.cost)} bought ${longDate(p.purchasedAt)} &middot; ${p.termMonths}-month term &middot; matures ${longDate(p.maturesAt)}</span>
            <span class="hs-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}" aria-label="${share}% of the term has passed"><i style="width:${share}%"></i></span>
          </span>
          <span class="rf-small rf-muted rf-nowrap">${share}%</span>
        </li>`;
      }).join('')
      : '<li class="rf-muted rf-small">You choose a term when you buy: 3, 6, 12 or 24 months. Its maturity date is counted down here.</li>';

    await overview;

    // The chart: what the Bitcoin held now has been worth on each day since
    // the first purchase, against what was paid for it.
    const host = qs('[data-growth-chart]');
    if (!positions.length) {
      host.innerHTML = '<div class="hs-chart-empty"><strong>Your chart starts the day you buy.</strong><span>It shows what your Bitcoin is worth on every day since, against what you paid.</span><a class="rf-btn sm" href="/invest?buy=1">Buy Bitcoin</a></div>';
      return;
    }
    const first = new Date(positions[0].purchasedAt).getTime();
    const days = Math.ceil((Date.now() - first) / DAY) + 7;
    let history = { points: [], source: '' };
    try {
      history = await api.get(`/markets/history?symbol=BTC&days=${days}`);
    } catch (err) { /* drawn from the purchases alone, and said so */ }
    const series = growthSeries(positions, history.points, btc.price);
    drawGrowth(host, series, positions);
    let resized;
    window.addEventListener('resize', () => {
      clearTimeout(resized);
      resized = setTimeout(() => drawGrowth(host, series, positions), 150);
    });
    qs('[data-chart-note]').textContent = history.points.length
      ? `Daily closing prices from ${history.source}; today's point is the live price. The value is of the Bitcoin you hold now, on each day since you bought it.`
      : 'The price history could not be loaded just now, so the chart joins each purchase to today\'s value. Reload to try again.';
    paintChartTable(series);
  }

  /**
   * One point a day from the first purchase to today: the Bitcoin price, what
   * had been invested by then, and what the Bitcoin held now was worth that
   * day. Units and cost are each purchase's as held now (after any sales), so
   * the line ends exactly on the headline value.
   */
  function growthSeries(positions, points, livePrice) {
    const lots = positions.map((p) => ({
      t: new Date(p.purchasedAt).getTime(),
      units: Number(p.units),
      cost: p.cost,
      price: p.price,
    }));
    const start = lots[0].t;
    const startDay = new Date(start).toISOString().slice(0, 10);
    let prices = points.filter((p) => p.t >= startDay).map((p) => ({ t: new Date(`${p.t}T12:00:00Z`).getTime(), p: p.p * 100 }));
    if (!prices.length) {
      // No history: the purchases themselves are the only prices we know.
      prices = lots.map((l) => ({ t: l.t, p: l.price || livePrice }));
    }
    // Each purchase at the moment and price it was made, so the line steps up
    // where the money went in rather than half a day later.
    lots.forEach((l) => { if (l.price) prices.push({ t: l.t, p: l.price, buy: true }); });
    if (livePrice) prices.push({ t: Date.now(), p: livePrice, live: true });
    prices.sort((a, b) => a.t - b.t);

    return prices.filter((pt) => pt.t >= start).map((pt) => {
      const held = lots.filter((l) => l.t <= pt.t);
      const units = held.reduce((n, l) => n + l.units, 0);
      const cost = held.reduce((n, l) => n + l.cost, 0);
      return { t: pt.t, price: pt.p, cost, value: Math.floor(units * pt.p), buy: Boolean(pt.buy), live: Boolean(pt.live) };
    });
  }

  /** Clean round steps for the value axis: 0 / 2.5K / 5K ... */
  function ticks(max) {
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw || 1));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
    if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
    return out;
  }

  const compact = (cents) => {
    const d = cents / 100;
    if (Math.abs(d) >= 1e6) return `$${(d / 1e6).toFixed(d % 1e6 ? 1 : 0)}M`;
    if (Math.abs(d) >= 1e3) return `$${(d / 1e3).toFixed(d % 1e3 ? 1 : 0)}K`;
    return `$${Math.round(d)}`;
  };

  /**
   * Value against amount invested, as inline SVG with a crosshair readout.
   * Two series, so a legend sits in the card head and the line ends are
   * labelled; purchases are marked on the value line.
   */
  function drawGrowth(host, series, positions) {
    const width = Math.max(280, host.clientWidth || 640);
    const height = host.clientHeight || 300;
    const pad = { top: 16, right: width < 520 ? 12 : 92, bottom: 30, left: 52 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    const t0 = series[0].t;
    const t1 = Math.max(series[series.length - 1].t, t0 + DAY);
    const yTicks = ticks(Math.max(...series.map((d) => Math.max(d.value, d.cost))) * 1.06);
    const yMax = yTicks[yTicks.length - 1] || 1;
    const x = (t) => pad.left + ((t - t0) / (t1 - t0)) * w;
    const y = (v) => pad.top + h - (v / yMax) * h;

    // The invested line is a staircase: flat between purchases, up at each.
    const costPath = series.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.cost).toFixed(1)}`).join('');
    const valuePath = series.map((d, i) => `${i ? 'L' : 'M'}${x(d.t).toFixed(1)},${y(d.value).toFixed(1)}`).join('');
    const area = `${valuePath}L${x(series[series.length - 1].t).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`;

    // Four or five dates along the bottom, evenly spaced in time.
    const xCount = width < 520 ? 3 : 5;
    const xTicks = Array.from({ length: xCount }, (_, i) => t0 + ((t1 - t0) * i) / (xCount - 1));
    const spanDays = (t1 - t0) / DAY;
    const xLabel = (t) => new Date(t).toLocaleDateString('en-US', spanDays > 300 ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });

    const last = series[series.length - 1];
    const buys = series.filter((d) => d.buy);
    const endLabels = width < 520 ? '' : (() => {
      let vy = y(last.value);
      let cy = y(last.cost);
      if (Math.abs(vy - cy) < 30) { // keep the two end labels apart without leaving their lines
        if (vy <= cy) { vy = Math.min(vy, cy - 30); } else { cy = Math.min(cy, vy - 30); }
      }
      return `
        <text class="end v" x="${(x(last.t) + 10).toFixed(1)}" y="${(vy - 2).toFixed(1)}">${esc(compact(last.value))}</text>
        <text class="end-k" x="${(x(last.t) + 10).toFixed(1)}" y="${(vy + 12).toFixed(1)}">Value</text>
        <text class="end c" x="${(x(last.t) + 10).toFixed(1)}" y="${(cy - 2).toFixed(1)}">${esc(compact(last.cost))}</text>
        <text class="end-k" x="${(x(last.t) + 10).toFixed(1)}" y="${(cy + 12).toFixed(1)}">Invested</text>`;
    })();

    host.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
        <defs><linearGradient id="hs-growth-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--hs-chart-value);stop-opacity:.16"/><stop offset="1" style="stop-color:var(--hs-chart-value);stop-opacity:.02"/></linearGradient></defs>
        ${yTicks.map((v) => `<line class="grid" x1="${pad.left}" x2="${pad.left + w}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="ytick" x="${pad.left - 8}" y="${(y(v) + 4).toFixed(1)}">${esc(compact(v))}</text>`).join('')}
        ${xTicks.map((t, i) => `<text class="xtick" x="${x(t).toFixed(1)}" y="${height - 8}" text-anchor="${i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}">${esc(xLabel(t))}</text>`).join('')}
        <path class="area" d="${area}"/>
        <path class="cost" d="${costPath}"/>
        <path class="value" d="${valuePath}"/>
        ${buys.map((d) => `<circle class="buy" cx="${x(d.t).toFixed(1)}" cy="${y(d.value).toFixed(1)}" r="5"/>`).join('')}
        <circle class="now" cx="${x(last.t).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4.5"/>
        ${endLabels}
        <g class="cross" visibility="hidden">
          <line class="cross-line" y1="${pad.top}" y2="${pad.top + h}"/>
          <circle class="cross-v" r="4.5"/><circle class="cross-c" r="4"/>
        </g>
        <rect class="hit" x="${pad.left}" y="${pad.top}" width="${w}" height="${h}" fill="transparent" tabindex="0" aria-label="Move across the chart to read each day's value"/>
      </svg>
      <div class="hs-tip" hidden></div>`;

    const svg = qs('svg', host);
    const cross = qs('.cross', svg);
    const tip = qs('.hs-tip', host);
    const hit = qs('.hit', svg);
    const at = (t) => series.reduce((best, d) => (Math.abs(d.t - t) < Math.abs(best.t - t) ? d : best), series[0]);

    function show(d) {
      const cx = x(d.t);
      cross.setAttribute('visibility', 'visible');
      qs('.cross-line', cross).setAttribute('x1', cx);
      qs('.cross-line', cross).setAttribute('x2', cx);
      qs('.cross-v', cross).setAttribute('cx', cx);
      qs('.cross-v', cross).setAttribute('cy', y(d.value));
      qs('.cross-c', cross).setAttribute('cx', cx);
      qs('.cross-c', cross).setAttribute('cy', y(d.cost));
      const gain = d.value - d.cost;
      tip.textContent = '';
      const head = document.createElement('div');
      head.className = 'd';
      head.textContent = d.live ? 'Now' : longDate(new Date(d.t).toISOString()) + (d.buy ? ' · purchase' : '');
      tip.appendChild(head);
      [['value', money(d.value), 'Value'], ['cost', money(d.cost), 'Invested'], ['', `${signed(gain)}${d.cost ? ` (${pct((gain / d.cost) * 100)})` : ''}`, 'Growth'], ['', money(d.price), 'Bitcoin price']].forEach(([key, val, label]) => {
        const row = document.createElement('div');
        row.className = 'r';
        const k = document.createElement('i');
        k.className = `k ${key}`;
        const b = document.createElement('b');
        b.textContent = val;
        const s = document.createElement('span');
        s.textContent = label;
        row.append(k, b, s);
        tip.appendChild(row);
      });
      tip.hidden = false;
      const left = cx + 14 + tip.offsetWidth > width ? cx - 14 - tip.offsetWidth : cx + 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${pad.top}px`;
    }
    const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    const fromEvent = (event) => {
      const box = svg.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * width;
      return at(t0 + ((px - pad.left) / w) * (t1 - t0));
    };
    hit.addEventListener('pointermove', (event) => show(fromEvent(event)));
    hit.addEventListener('pointerleave', hide);
    // Keyboard: arrow keys walk the days, starting from today.
    let index = series.length - 1;
    hit.addEventListener('focus', () => show(series[index]));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      index = Math.max(0, Math.min(series.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      show(series[index]);
    });
    host.setAttribute('aria-label', `Your Bitcoin was worth ${money(last.value)} against ${money(last.cost)} invested, across ${positions.length} purchase${positions.length === 1 ? '' : 's'} since ${longDate(positions[0].purchasedAt)}.`);
  }

  /** The chart's figures as a table: the first of each month, each purchase, and today. */
  function paintChartTable(series) {
    const seen = new Set();
    const rows = series.filter((d, i) => {
      const month = new Date(d.t).toISOString().slice(0, 7);
      const keep = d.buy || d.live || i === 0 || !seen.has(month);
      seen.add(month);
      return keep;
    });
    qs('[data-chart-rows]').innerHTML = rows.map((d) => `<tr>
      <td class="rf-nowrap">${d.live ? 'Now' : longDate(new Date(d.t).toISOString())}${d.buy ? '<span class="sub">Purchase</span>' : ''}</td>
      <td class="num">${money(d.price)}</td>
      <td class="num">${money(d.cost)}</td>
      <td class="num">${money(d.value)}</td>
      <td class="num rf-amt ${d.value >= d.cost ? 'credit' : 'debit'}">${signed(d.value - d.cost)}</td>
    </tr>`).join('');
  }

  /* ------------------------------------------------------- transactions -- */

  async function transactionsPage() {
    const form = qs('[data-filters]');
    const tbody = qs('[data-rows]');
    let offset = 0;
    const limit = 50;

    const query = () => {
      const data = RF.formData(form);
      const params = new URLSearchParams();
      Object.entries(data).forEach(([k, v]) => { if (v) params.set(k, v); });
      params.set('limit', String(limit));
      params.set('offset', String(offset));
      return params;
    };

    async function load() {
      tbody.innerHTML = '<tr><td colspan="7" class="rf-center rf-muted">Loading&hellip;</td></tr>';
      const params = query();
      const data = await api.get(`/transactions?${params.toString()}`);

      const accountSelect = qs('#f-account');
      if (accountSelect && accountSelect.options.length <= 1) {
        data.filters.accounts.forEach((a) => {
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = a.label;
          accountSelect.appendChild(opt);
        });
        const preset = new URLSearchParams(location.search).get('account');
        if (preset) accountSelect.value = preset;
      }

      tbody.innerHTML = data.transactions.length
        ? data.transactions.map((tx) => `<tr class="clickable" data-tx="${esc(tx.id)}">
            <td class="rf-nowrap">${date(tx.date, { month: 'short', day: 'numeric' })}<span class="sub">${new Date(tx.date).getFullYear()}</span></td>
            <td><strong>${esc(tx.description)}</strong>${tx.memo ? `<span class="sub">${esc(tx.memo)}</span>` : ''}</td>
            <td class="rf-small opt">${esc(tx.category)}</td>
            <td class="rf-small rf-nowrap opt">${esc(tx.accountName)}<span class="sub">&bull;&bull;${esc(tx.accountLast4)}</span></td>
            <td>${badge(tx.status)}</td>
            <td class="num rf-amt ${tx.direction}">${signedMoney(tx.amount, tx.direction)}</td>
            <td class="num rf-muted opt">${tx.balanceAfter == null ? '&mdash;' : money(tx.balanceAfter)}</td>
          </tr>`).join('')
        : '<tr><td colspan="7" class="rf-center rf-muted">Nothing matches those filters.</td></tr>';

      qs('[data-count]').textContent = `${data.total} entr${data.total === 1 ? 'y' : 'ies'}`;
      qs('[data-range]').textContent = data.total
        ? `Showing ${offset + 1} to ${Math.min(offset + limit, data.total)} of ${data.total}`
        : '';
      qs('[data-prev]').disabled = offset === 0;
      qs('[data-next]').disabled = offset + limit >= data.total;

      const exportLink = qs('[data-export]');
      const exportParams = query();
      exportParams.delete('limit');
      exportParams.delete('offset');
      exportLink.href = `/api/bank/transactions/export?${exportParams.toString()}`;
      wireTxTables();
    }

    form.addEventListener('submit', (event) => { event.preventDefault(); offset = 0; load(); });
    form.addEventListener('reset', () => { setTimeout(() => { offset = 0; load(); }, 0); });
    qs('[data-prev]').addEventListener('click', () => { offset = Math.max(0, offset - limit); load(); });
    qs('[data-next]').addEventListener('click', () => { offset += limit; load(); });

    const preset = new URLSearchParams(location.search).get('account');
    if (preset) qs('#f-account').value = preset;
    await load();
  }

  /* ------------------------------------------------------------- alerts -- */

  async function alertsPage() {
    const list = qs('[data-rows]');

    async function load() {
      const data = await api.get('/alerts?limit=60');
      list.innerHTML = data.alerts.length ? data.alerts.map((alert) => `
        <li data-alert="${esc(alert.id)}" class="${alert.readAt ? '' : 'is-unread'}">
          <span class="t">
            <strong>${alert.readAt ? '' : '<span class="rf-badge dot info"></span> '}${esc(alert.subject)}</strong>
            <span>${esc(alert.preview || '')}</span>
          </span>
          <span class="rf-small rf-muted rf-nowrap">${ago(alert.createdAt)}</span>
          ${alert.status === 'sent' ? badge('sent', 'Emailed') : alert.status === 'failed' ? badge('failed', 'Email failed') : badge('info', 'In app only')}
        </li>`).join('') : '<li class="rf-muted rf-small">No notifications yet.</li>';
    }

    list.addEventListener('click', async (event) => {
      const row = event.target.closest('[data-alert]');
      if (!row) return;
      const id = row.getAttribute('data-alert');
      const res = await api.post(`/alerts/${id}/read`);
      const el = document.createElement('div');
      el.className = 'rf-modal-backdrop';
      el.innerHTML = `<div class="rf-modal">
        <div class="rf-modal-head"><h3>${esc(res.alert.subject)}</h3><button type="button" data-close aria-label="Close">&times;</button></div>
        <div class="rf-modal-body"><pre style="white-space:pre-wrap;font:inherit;margin:0">${esc(res.alert.body)}</pre></div>
      </div>`;
      document.body.appendChild(el);
      const close = () => { el.remove(); document.body.style.overflow = ''; load(); RF.paintUser(RF.state.session); };
      qs('[data-close]', el).addEventListener('click', close);
      el.addEventListener('click', (e) => { if (e.target === el) close(); });
      document.body.style.overflow = 'hidden';
    });

    qs('[data-read-all]').addEventListener('click', async () => {
      const res = await api.post('/alerts/read-all');
      toast(`${res.marked} notification(s) marked as read.`, 'ok');
      load();
    });

    // Preferences
    const prefsForm = qs('[data-prefs]');
    const prefs = await api.get('/me/alert-preferences');
    const groups = {};
    prefs.types.forEach((type) => {
      groups[type.group] = groups[type.group] || [];
      groups[type.group].push(type);
    });
    prefsForm.innerHTML = Object.entries(groups).map(([group, types]) => `
      <h4 class="rf-label rf-mt">${esc(group)}</h4>
      ${types.map((type) => `
        <div class="rf-switch">
          <span class="t">${esc(type.label)}${type.locked ? '<small>Always on, for your security.</small>' : ''}</span>
          <input type="checkbox" name="${esc(type.id)}" ${prefs.preferences[type.id] ? 'checked' : ''} ${type.locked ? 'disabled' : ''} />
        </div>`).join('')}`).join('');

    qs('#a-threshold').value = (prefs.alertThreshold / 100).toFixed(2);
    qs('#a-low').value = (prefs.lowBalanceThreshold / 100).toFixed(2);

    qs('[data-save-prefs]').addEventListener('click', async () => {
      const preferences = {};
      qsa('input[type="checkbox"]', prefsForm).forEach((input) => { preferences[input.name] = input.checked; });
      try {
        await api.put('/me/alert-preferences', { preferences });
        await api.patch('/me/security', {
          alertThreshold: Number(qs('#a-threshold').value || 0),
          lowBalanceThreshold: Number(qs('#a-low').value || 0),
        });
        toast('Alert preferences saved.', 'ok');
      } catch (err) {
        toast(err.message, 'bad');
      }
    });

    await load();
  }

  /* ------------------------------------------------------------ messages -- */

  async function messagesPage() {
    const list = qs('[data-threads]');
    const body = qs('[data-thread]');
    const subjectField = qs('[data-subject-field]');
    const form = qs('#rf-message-form');
    let current = null;

    async function load() {
      const data = await api.get('/messages');
      list.innerHTML = data.threads.length ? data.threads.map((thread) => `
        <li data-thread="${esc(thread.id)}" class="clickable">
          <span class="t">
            <strong>${esc(thread.subject)}</strong>
            <span>${esc((thread.messages[thread.messages.length - 1] || {}).body || '').slice(0, 70)}</span>
          </span>
          ${thread.unread ? `<span class="rf-badge info">${thread.unread}</span>` : ''}
          <span class="rf-small rf-muted rf-nowrap">${ago(thread.updatedAt)}</span>
        </li>`).join('') : '<li class="rf-muted rf-small">No conversations yet.</li>';
      return data.threads;
    }

    let threads = await load();

    function render(thread) {
      current = thread.id;
      subjectField.classList.add('rf-hide');
      qs('[data-thread-subject]').textContent = thread.subject;
      body.innerHTML = thread.messages.map((m) => `
        <div style="margin-bottom:16px;padding:12px 14px;border-radius:12px;background:${m.from === 'bank' ? 'var(--rf-surface-3)' : 'var(--rf-info-soft)'}">
          <div class="rf-spread rf-small rf-muted"><strong>${esc(m.authorName || (m.from === 'bank' ? 'Our team' : 'You'))}</strong><span>${datetime(m.createdAt)}</span></div>
          <div style="margin-top:6px;white-space:pre-wrap">${esc(m.body)}</div>
        </div>`).join('');
      api.post(`/messages/${thread.id}/read`).then(() => RF.paintUser(RF.state.session)).catch(() => {});
    }

    list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-thread]');
      if (!row) return;
      const thread = threads.find((t) => t.id === row.getAttribute('data-thread'));
      if (thread) render(thread);
    });

    qs('[data-new]').addEventListener('click', () => {
      current = null;
      subjectField.classList.remove('rf-hide');
      qs('[data-thread-subject]').textContent = 'New secure message';
      body.innerHTML = '<p class="rf-muted rf-small">Write your message below. Anything you send here stays inside your signed-in session.</p>';
    });

    RF.onSubmit(form, async (data) => {
      const payload = { body: data.body, threadId: current || undefined, subject: data.subject };
      await api.post('/messages', payload);
      form.reset();
      toast('Message sent. We usually reply within one business day.', 'ok');
      threads = await load();
      if (current) {
        const thread = threads.find((t) => t.id === current);
        if (thread) render(thread);
      }
    });

    if (threads.length) render(threads[0]);
  }

  /* -------------------------------------------------------------- router -- */

  const ROUTES = {
    '/dashboard': dashboard,
    '/transactions': transactionsPage,
    '/alerts': alertsPage,
    '/messages': messagesPage,
  };

  RF.ready(async () => {
    const route = ROUTES[location.pathname.replace(/\/$/, '') || '/dashboard'];
    if (!route) return;
    try {
      await route();
    } catch (err) {
      console.error('[hedgestone]', err);
      toast(err.message || 'This page could not load.', 'bad');
    }
  });
}());
