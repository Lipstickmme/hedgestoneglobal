'use strict';

/**
 * The vault's own screens: My vault, History, Receive and Send.
 *
 * Nothing here moves Bitcoin by itself. Receive tells us a payment was made
 * or Bitcoin was sent, Send asks for matured Bitcoin to go out; each becomes
 * a request our team confirms, and the vault changes when they do.
 */

(function () {
  const RF = window.RF;
  const { api, qs, qsa, esc, money, date, datetime, toast, badge, onSubmit } = RF;

  const logo = (px) => (window.HSAssets ? window.HSAssets.logo('BTC', px) : '');
  const longDate = (iso) => date(iso, { day: 'numeric', month: 'short', year: 'numeric' });
  const pct = (n) => `${n >= 0 ? '+' : '−'}${Math.abs(Number(n)).toFixed(2)}%`;
  const signed = (cents) => `${cents >= 0 ? '+' : '−'}${money(Math.abs(cents))}`;
  const termText = (months) => (months == null ? '' : months % 12 === 0 ? `${months / 12}-year term` : `${months}-month term`);
  const KIND = { cash: 'Paid in cash', bitcoin: 'Bitcoin received', sent: 'Bitcoin sent', converted: 'Converted to Bitcoin', bought: 'Bought', sold: 'Sold' };
  const STATUS = { pending_verification: 'Needs your code', pending: 'With our team', completed: 'Done', rejected: 'Not done', cancelled: 'Cancelled' };
  const today = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const requestAmount = (r) => (r.kind === 'cash_in' ? money(r.amount) : `${esc(r.units)} BTC`);

  function span(days) {
    if (days < 62) return `${days} day${days === 1 ? '' : 's'}`;
    const months = Math.round(days / 30.44);
    const years = Math.floor(months / 12);
    const rest = months % 12;
    if (!years) return `${months} months`;
    return `${years} year${years === 1 ? '' : 's'}${rest ? `, ${rest} month${rest === 1 ? '' : 's'}` : ''}`;
  }

  /** `years` from `iso` (or today), the way the server dates a maturity. */
  function maturityFrom(iso, years) {
    const d = iso ? new Date(`${iso}T12:00:00`) : new Date();
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + Number(years) * 12);
    d.setUTCDate(Math.min(day, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
    return d.toISOString();
  }

  /** The years field: quick choices and a preview of the maturity date it gives. */
  function wireTerm(form, terms, dateField) {
    const input = qs('input[name="termYears"]', form);
    if (!input) return;
    input.value = input.value || terms.default;
    const preview = qs('[data-term-preview]', form);
    const paint = () => {
      const y = Number(input.value);
      qsa('[data-term]', form).forEach((b) => b.classList.toggle('is-on', Number(b.getAttribute('data-term')) === y));
      if (!Number.isInteger(y) || y < terms.min || y > terms.max) {
        preview.textContent = `Choose ${terms.min} to ${terms.max} years.`;
        return;
      }
      const from = dateField && dateField.value ? dateField.value : '';
      preview.textContent = `Matures ${longDate(maturityFrom(from, y))}. It can be sent out of your vault from then.`;
    };
    qsa('[data-term]', form).forEach((b) => b.addEventListener('click', () => { input.value = b.getAttribute('data-term'); paint(); }));
    input.addEventListener('input', paint);
    if (dateField) dateField.addEventListener('change', paint);
    paint();
  }

  /* ------------------------------------------------------------ my vault -- */

  async function vaultPage() {
    const data = await api.get('/invest');
    const b = data.bitcoin;
    const holds = Number(b.units) > 0;
    qs('[data-inv="value"]').textContent = b.value == null ? '—' : money(b.value);
    const gain = qs('[data-inv="gain"]');
    gain.textContent = holds && b.value != null ? `${signed(b.gain)} (${pct(b.gainPct || 0)}) since it went in` : 'Nothing in it yet';
    gain.className = `d ${holds ? (b.gain > 0 ? 'up' : b.gain < 0 ? 'down' : '') : ''}`;
    qs('[data-inv="cost"]').textContent = money(b.cost);
    qs('[data-inv="count"]').textContent = `${b.units} BTC`;
    qs('[data-inv="asof"]').textContent = b.price ? `at ${money(b.price)} per Bitcoin` : 'price unavailable';
    qs('[data-inv="ready"]').textContent = `${b.ready} BTC`;
    qs('[data-inv="readySub"]').textContent = Number(b.ready) > 0 ? `worth ${money(b.readyValue || 0)}, can be sent` : 'nothing has matured yet';
    qs('[data-inv-source]').textContent = b.source ? `Live price: ${b.source}` : 'The live price is unavailable right now';
    qs('[data-inv-converting]').hidden = !data.converting;

    const positions = data.positions || [];
    qs('[data-inv-positions]').innerHTML = positions.length
      ? positions.slice().reverse().map((p) => `<tr>
          <td class="rf-nowrap"><span class="hs-chip is-in">${longDate(p.purchasedAt)}</span><span class="sub">${esc(KIND[p.kind] || 'Added')} &middot; ${money(p.cost)}</span></td>
          <td class="num rf-mono"><span class="hs-cell-asset is-right">${logo(20)}${esc(p.units)}</span></td>
          <td class="num opt">${p.price ? money(p.price) : '&mdash;'}</td>
          <td class="num"><strong>${p.value == null ? '&mdash;' : money(p.value)}</strong></td>
          <td class="num rf-amt ${(p.gain || 0) >= 0 ? 'credit' : 'debit'}">${p.gain == null ? '&mdash;' : `${signed(p.gain)}<span class="sub">${p.gainPct == null ? '' : pct(p.gainPct)}</span>`}</td>
          <td class="rf-nowrap"><span class="hs-chip is-out">${longDate(p.maturesAt)}</span><span class="sub">${p.matured ? 'Matured: can be sent' : `${span(p.daysToMaturity)} to go`} &middot; ${esc(termText(p.termMonths))}</span></td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="rf-center rf-muted">Nothing in your vault yet. <a href="/receive">Pay with cash or send Bitcoin</a> to start.</td></tr>';

    const trades = data.trades || [];
    qs('[data-inv-trades]').innerHTML = trades.length
      ? trades.slice(0, 10).map((t) => `<li>
          ${logo(30)}
          <span class="hs-trade-side ${t.side}">${esc(KIND[t.kind] || t.kind)}</span>
          <span class="hs-trade-main"><strong>${t.side === 'buy' ? '+' : '−'}${esc(t.units)} BTC</strong><small>${datetime(t.createdAt)} &middot; @ ${money(t.price)}${t.status === 'reversed' ? ' &middot; reversed' : ''}</small></span>
          <span class="rf-amt">${money(t.amount)}</span>
        </li>`).join('')
      : '<li class="rf-muted rf-small">Everything that moves into or out of your vault appears here.</li>';
  }

  /* ------------------------------------------------------------- history -- */

  async function historyPage() {
    const form = qs('[data-filters]');
    const tbody = qs('[data-rows]');
    qsa('input[type="date"]', form).forEach((input) => { input.max = today(); });

    async function load() {
      const params = new URLSearchParams();
      Object.entries(RF.formData(form)).forEach(([k, v]) => { if (v) params.set(k, v); });
      const data = await api.get(`/vault/history?${params.toString()}`);
      tbody.innerHTML = data.movements.length
        ? data.movements.map((t) => `<tr${t.status === 'reversed' ? ' class="is-reversed"' : ''}>
            <td class="rf-nowrap">${longDate(t.createdAt)}<span class="sub">${new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></td>
            <td><span class="hs-cell-asset">${logo(24)}<span><strong>${esc(t.label)}</strong>${t.status === 'reversed' ? '<span class="sub">Reversed</span>' : t.kind === 'sent' && t.note ? `<span class="sub rf-mono">${esc(t.note)}</span>` : ''}</span></span></td>
            <td class="num rf-mono rf-amt ${t.side === 'buy' ? 'credit' : 'debit'}">${t.side === 'buy' ? '+' : '−'}${esc(t.units)}</td>
            <td class="num opt">${money(t.price)}</td>
            <td class="num">${money(t.amount)}</td>
            <td class="opt rf-nowrap">${t.maturesAt ? `<span class="hs-chip is-out">${longDate(t.maturesAt)}</span>` : '&mdash;'}</td>
            <td class="opt rf-mono rf-small">${esc(t.reference)}</td>
          </tr>`).join('')
        : '<tr><td colspan="7" class="rf-center rf-muted">Nothing matches those filters.</td></tr>';
      qs('[data-count]').textContent = `${data.movements.length} movement${data.movements.length === 1 ? '' : 's'}`;
    }

    form.addEventListener('submit', (event) => { event.preventDefault(); load(); });
    await load();
  }

  /* ------------------------------------------------------------- receive -- */

  function paintRequests(rows, kinds) {
    const mine = rows.filter((r) => kinds.includes(r.kind));
    const tbody = qs('[data-requests]');
    if (kinds.includes('btc_out')) {
      tbody.innerHTML = mine.length
        ? mine.map((r) => `<tr>
            <td class="rf-nowrap">${longDate(r.createdAt)}</td>
            <td class="num rf-mono">${esc(r.units)}</td>
            <td class="rf-mono rf-small" style="word-break:break-all">${esc(r.address)}${r.txid ? `<span class="sub">Transaction ${esc(r.txid.slice(0, 16))}&hellip;</span>` : ''}</td>
            <td>${badge(r.status, STATUS[r.status])}${r.decisionNote && r.status === 'rejected' ? `<span class="sub">${esc(r.decisionNote)}</span>` : ''}</td>
            <td class="opt rf-mono rf-small">${esc(r.reference)}</td>
            <td class="rf-right rf-nowrap">
              ${r.status === 'pending_verification' ? `<button class="rf-btn sm" data-verify="${esc(r.id)}">Enter code</button>` : ''}
              ${['pending', 'pending_verification'].includes(r.status) ? `<button class="rf-btn link sm" data-cancel="${esc(r.id)}">Cancel</button>` : ''}
            </td>
          </tr>`).join('')
        : '<tr><td colspan="6" class="rf-center rf-muted">You have not asked to send any Bitcoin yet.</td></tr>';
      return;
    }
    tbody.innerHTML = mine.length
      ? mine.map((r) => `<tr>
          <td class="rf-nowrap">${longDate(r.createdAt)}</td>
          <td>${esc(r.label)}<span class="sub">${r.kind === 'cash_in' ? 'paid' : 'sent'} ${longDate(r.occurredAt)}</span></td>
          <td class="num">${requestAmount(r)}</td>
          <td class="opt">${esc(termText(r.termMonths))}</td>
          <td>${badge(r.status, STATUS[r.status])}${r.decisionNote && r.status === 'rejected' ? `<span class="sub">${esc(r.decisionNote)}</span>` : ''}</td>
          <td class="opt rf-mono rf-small">${esc(r.reference)}</td>
          <td class="rf-right">${r.status === 'pending' ? `<button class="rf-btn link sm" data-cancel="${esc(r.id)}">Cancel</button>` : ''}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="rf-center rf-muted">Nothing yet. Once you tell us about a payment or a transfer, it appears here until it is in your vault.</td></tr>';
  }

  function wireCancel(reload) {
    qs('[data-requests]').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-cancel]');
      if (!button) return;
      if (!confirm('Cancel this request?')) return;
      try {
        await api.post(`/vault/requests/${button.getAttribute('data-cancel')}/cancel`);
        toast('Request cancelled.', 'ok');
        reload();
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  /** No details to show yet: offer to ask for them, or say when they were asked for. */
  function askFor(need, asked) {
    const what = need === 'cash' ? 'payment details for cash' : 'a vault address';
    if (asked) {
      return `<div class="rf-notice" data-asked="${need}">You asked for ${what} on ${longDate(asked.createdAt)}. They will appear here as soon as our team adds them, and we will email you. <span class="rf-mono rf-small">${esc(asked.reference)}</span></div>`;
    }
    return `<div class="rf-notice">There ${need === 'cash' ? 'are no payment details' : 'is no vault address'} for you yet.
        <div class="rf-mt"><button type="button" class="rf-btn sm" data-ask-details="${need}">${need === 'cash' ? 'Ask for payment details' : 'Ask for a vault address'}</button></div>
      </div>`;
  }

  async function receivePage() {
    let data = await api.get('/vault');
    const cashForm = qs('#hs-cash-form');
    const btcForm = qs('#hs-btc-form');
    const row = (label, value, mono) => (value ? `<dt>${esc(label)}</dt><dd class="${mono ? 'mono' : ''}">${esc(value)} <button type="button" class="rf-copy" data-copy="${esc(value)}">copy</button></dd>` : '');

    const otc = data.otc;
    qs('[data-otc]').innerHTML = otc
      ? `<dl class="rf-dl hs-otc">
          ${row('Pay', otc.accountName)}
          ${row('Number', otc.accountNumber, true)}
          ${row('Routing or sort code', otc.routingNumber, true)}
          ${row('SWIFT / BIC', otc.swift, true)}
          ${otc.bankName ? `<dt>Held at</dt><dd>${esc(otc.bankName)}</dd>` : ''}
          ${otc.name ? `<dt>OTC partner</dt><dd>${esc(otc.name)}</dd>` : ''}
          <dt>Your reference</dt><dd class="mono"><strong>${esc(data.paymentReference)}</strong> <button type="button" class="rf-copy" data-copy="${esc(data.paymentReference)}">copy</button></dd>
        </dl>
        <p class="rf-small rf-muted">${esc(otc.instructions || 'Quote your reference with the payment so the partner can match it to you.')}</p>`
      : askFor('cash', data.asked && data.asked.cash);
    cashForm.hidden = !otc;

    const address = data.address;
    qs('[data-address]').innerHTML = address
      ? `<div class="hs-address">
          <span class="k">${logo(18)} Your vault address${address.label ? ` &middot; ${esc(address.label)}` : ''}</span>
          <code>${esc(address.address)}</code>
          <button type="button" class="rf-btn ghost sm" data-copy="${esc(address.address)}">Copy the address</button>
        </div>
        <p class="rf-small rf-muted">Send only Bitcoin to this address, on the Bitcoin network. Anything else sent to it is lost.</p>`
      : askFor('bitcoin', data.asked && data.asked.bitcoin);
    btcForm.hidden = !address;

    document.addEventListener('click', async (event) => {
      const copy = event.target.closest('[data-copy]');
      if (copy) RF.copy(copy.getAttribute('data-copy'), 'Copied');
      const ask = event.target.closest('[data-ask-details]');
      if (ask) {
        ask.disabled = true;
        try {
          await api.post('/vault/details-request', { need: ask.getAttribute('data-ask-details') });
          toast('Asked. We will put the details on this page and email you when they are ready.', 'ok');
          window.location.reload();
        } catch (err) {
          ask.disabled = false;
          toast(err.message, 'bad');
        }
      }
    });

    [cashForm, btcForm].forEach((form) => {
      const day = qs('input[type="date"]', form);
      day.max = today();
      day.value = today();
      wireTerm(form, data.terms, day);
    });

    onSubmit(cashForm, async (values) => {
      await api.post('/vault/receive', { kind: 'cash', ...values });
      cashForm.reset();
      qs('input[type="date"]', cashForm).value = today();
      qs('input[name="termYears"]', cashForm).value = data.terms.default;
      toast('Thank you. We will add it to your vault once the OTC partner confirms your payment.', 'ok');
      await reload();
    });
    onSubmit(btcForm, async (values) => {
      await api.post('/vault/receive', { kind: 'bitcoin', ...values });
      btcForm.reset();
      qs('input[type="date"]', btcForm).value = today();
      qs('input[name="termYears"]', btcForm).value = data.terms.default;
      toast('Thank you. We will add it to your vault once it has arrived.', 'ok');
      await reload();
    });

    async function reload() {
      data = await api.get('/vault');
      paintRequests(data.requests, ['cash_in', 'btc_in']);
    }
    paintRequests(data.requests, ['cash_in', 'btc_in']);
    wireCancel(reload);
  }

  /* ---------------------------------------------------------------- send -- */

  async function sendPage() {
    const [details, inv] = await Promise.all([api.get('/vault'), api.get('/invest')]);
    let data = details;
    const form = qs('#hs-send-form');
    const units = qs('#s-units');
    const price = inv.bitcoin.price;

    function paintReady() {
      const ready = Number(data.ready);
      qs('[data-ready]').textContent = `${data.ready} BTC`;
      qs('[data-ready-sub]').textContent = ready > 0
        ? `${price ? `Worth about ${money(Math.floor(ready * price))}. ` : ''}Only Bitcoin that has reached its maturity date can be sent.`
        : 'None of your Bitcoin has matured yet. It can be sent once it reaches its maturity date.';
      qs('[type="submit"]', form).disabled = !(ready > 0);
    }
    paintReady();
    qs('[data-pin-field]').hidden = !data.hasPin;

    const valueHint = () => {
      const u = Number(String(units.value).replace(/[^0-9.]/g, ''));
      qs('[data-send-value]').textContent = u > 0 && price
        ? `About ${money(Math.floor(u * price))} at today's price${data.sendFee ? `, plus our fee of ${money(data.sendFee)}` : ''}. The Bitcoin network's fee is taken from the amount sent.`
        : ' ';
    };
    units.addEventListener('input', valueHint);
    qsa('[data-share]', form).forEach((b) => b.addEventListener('click', () => {
      const share = Number(b.getAttribute('data-share'));
      const ready = Math.round(Number(data.ready) * 1e8);
      units.value = (Math.floor((ready * share) / 100) / 1e8).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
      valueHint();
    }));

    // What has not matured yet, soonest first, so the customer can see when it can go.
    const waiting = (inv.positions || []).filter((p) => !p.matured).sort((a, b) => (a.maturesAt < b.maturesAt ? -1 : 1));
    qs('[data-upcoming]').innerHTML = waiting.length
      ? waiting.map((p) => {
        const share = Math.round(p.progress * 100);
        return `<li class="hs-term">
          <span class="t">
            <strong>${esc(p.units)} BTC &middot; ${longDate(p.maturesAt)}</strong>
            <span>Invested ${longDate(p.purchasedAt)} &middot; ${esc(termText(p.termMonths))} &middot; ${span(p.daysToMaturity)} to go</span>
            <span class="hs-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}" aria-label="${share}% of the term has passed"><i style="width:${share}%"></i></span>
          </span>
        </li>`;
      }).join('')
      : `<li class="rf-muted rf-small">${(inv.positions || []).length ? 'Everything in your vault has matured.' : 'Nothing in your vault yet.'}</li>`;

    async function reload() {
      data = await api.get('/vault');
      paintReady();
      paintRequests(data.requests, ['btc_out']);
    }

    /* The address: checked as it is pasted, with the reason when it is wrong. */
    const addressInput = qs('#s-address');
    const status = qs('[data-address-status]');
    const checkAddress = () => {
      const raw = addressInput.value.trim();
      if (!raw) {
        status.hidden = true;
        addressInput.classList.remove('is-valid', 'is-invalid');
        return null;
      }
      const result = window.BtcAddress ? window.BtcAddress.check(raw) : { ok: true, address: raw, type: 'Bitcoin address', length: raw.length };
      status.hidden = false;
      status.className = `hs-addr-status ${result.ok ? 'is-ok' : 'is-bad'}`;
      addressInput.classList.toggle('is-valid', result.ok);
      addressInput.classList.toggle('is-invalid', !result.ok);
      status.innerHTML = result.ok
        ? `<b>&#10003; A valid Bitcoin address</b> &middot; ${esc(result.type)}, ${result.length} characters. It starts <span class="rf-mono">${esc(result.address.slice(0, 6))}</span> and ends <span class="rf-mono">${esc(result.address.slice(-6))}</span>: check both against your wallet.`
        : `<b>&#9888; Not a Bitcoin address.</b> ${esc(result.reason)}`;
      return result;
    };
    addressInput.addEventListener('input', checkAddress);
    addressInput.addEventListener('blur', checkAddress);
    // Some browsers fill a saved email in after the page loads, whatever the
    // field says; it is cleared rather than left looking like an address.
    setTimeout(() => {
      if (/@/.test(addressInput.value)) { addressInput.value = ''; checkAddress(); }
    }, 600);
    addressInput.addEventListener('focus', () => {
      if (/@/.test(addressInput.value)) addressInput.value = '';
    });

    /** Shown before anything is sent: the amount, and the address in groups of four to compare. */
    function confirmSend(values, checked) {
      return new Promise((resolve) => {
        const groups = checked.address.match(/.{1,4}/g).map((g, i, all) => `<span class="${i === 0 || i === all.length - 1 ? 'is-end' : ''}">${esc(g)}</span>`).join('');
        const el = document.createElement('div');
        el.className = 'rf-modal-backdrop';
        el.innerHTML = `
          <div class="rf-modal">
            <div class="rf-modal-head"><h3>Check before you send</h3><button type="button" data-close aria-label="Close">&times;</button></div>
            <div class="rf-modal-body">
              <p class="hs-confirm-amt"><strong>${esc(values.units)} BTC</strong>${price ? `<span>about ${money(Math.floor(Number(values.units) * price))}</span>` : ''}</p>
              <p class="rf-small rf-muted" style="margin:0 0 6px">To this ${esc(checked.type)} address:</p>
              <div class="hs-addr-groups">${groups}</div>
              <div class="hs-addr-warn rf-mt">Compare every group with the Receive screen of your wallet, the first and last above all. Bitcoin sent to a wrong address cannot be brought back, by us or anyone.</div>
              <label class="rf-check rf-mt"><input type="checkbox" data-checked-address /> <span>I have checked the address against my own wallet</span></label>
            </div>
            <div class="rf-modal-foot">
              <button class="rf-btn ghost" type="button" data-close>Go back</button>
              <button class="rf-btn" type="button" data-go disabled>Send ${esc(values.units)} BTC</button>
            </div>
          </div>`;
        document.body.appendChild(el);
        const done = (answer) => { el.remove(); resolve(answer); };
        const go = qs('[data-go]', el);
        qs('[data-checked-address]', el).addEventListener('change', (e) => { go.disabled = !e.target.checked; });
        go.addEventListener('click', () => done(true));
        qsa('[data-close]', el).forEach((b) => b.addEventListener('click', () => done(false)));
      });
    }

    onSubmit(form, async (values) => {
      const checked = checkAddress();
      if (!checked || !checked.ok) {
        addressInput.focus();
        throw new Error(checked ? checked.reason : 'Paste the Bitcoin address from your wallet.');
      }
      values.address = checked.address;
      if (!(await confirmSend(values, checked))) return;
      const result = await api.post('/vault/send', values);
      form.reset();
      checkAddress();
      valueHint();
      await reload();
      if (result.next === 'verify') await verify(result.request, result.otp);
      else toast('Your request is with our team. We will email you when it has gone.', 'ok');
    });

    /** The emailed code, in a sheet so the form behind it stays put. */
    function verify(request, otp) {
      return new Promise((resolve) => {
        const el = document.createElement('div');
        el.className = 'rf-modal-backdrop';
        el.innerHTML = `
          <div class="rf-modal narrow">
            <div class="rf-modal-head"><h3>Confirm this send</h3></div>
            <form class="rf-modal-body">
              <p class="rf-small rf-muted">We emailed a six-digit code to confirm sending <strong>${esc(request.units)} BTC</strong> to <span class="rf-mono" style="word-break:break-all">${esc(request.address)}</span>.</p>
              ${otp && otp.devCode ? `<div class="rf-devcode">Email is not configured on this deployment, so the code is shown here: <code>${esc(otp.devCode)}</code></div>` : ''}
              <div class="rf-field rf-mt"><input class="rf-input mono" name="code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" /></div>
              <div class="rf-notice bad rf-hide" data-form-error></div>
              <div class="rf-inline">
                <button class="rf-btn" type="submit" data-submit>Confirm</button>
                <button class="rf-btn ghost" type="button" data-resend>Send a new code</button>
                <button class="rf-btn link" type="button" data-close>Later</button>
              </div>
            </form>
          </div>`;
        document.body.appendChild(el);
        document.body.style.overflow = 'hidden';
        const close = () => { el.remove(); document.body.style.overflow = ''; reload(); resolve(); };
        const inner = qs('form', el);
        qs('input', el).focus();
        onSubmit(inner, async (values) => {
          await api.post(`/vault/requests/${request.id}/verify`, { code: values.code });
          toast('Confirmed. Our team will check it and email you when it has gone.', 'ok');
          close();
        });
        qs('[data-resend]', el).addEventListener('click', async () => {
          try {
            const res = await api.post(`/vault/requests/${request.id}/resend`);
            toast('A new code is on its way.', 'ok');
            if (res.otp && res.otp.devCode) {
              const box = document.createElement('div');
              box.className = 'rf-devcode';
              box.innerHTML = `Email is not configured on this deployment, so the code is shown here: <code>${esc(res.otp.devCode)}</code>`;
              inner.prepend(box);
            }
          } catch (err) { toast(err.message, 'bad'); }
        });
        qs('[data-close]', el).addEventListener('click', close);
      });
    }

    paintRequests(data.requests, ['btc_out']);
    wireCancel(reload);
    qs('[data-requests]').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-verify]');
      if (!button) return;
      const request = data.requests.find((r) => r.id === button.getAttribute('data-verify'));
      if (!request) return;
      try {
        const res = await api.post(`/vault/requests/${request.id}/resend`);
        await verify(request, res.otp);
      } catch (err) { toast(err.message, 'bad'); }
    });
  }

  /* -------------------------------------------------------------- router -- */

  const ROUTES = { '/vault': vaultPage, '/history': historyPage, '/receive': receivePage, '/send': sendPage };

  RF.ready(async () => {
    const route = ROUTES[location.pathname.replace(/\/$/, '')];
    if (!route) return;
    try {
      await route();
    } catch (err) {
      console.error('[hedgestone]', err);
      toast(err.message || 'This page could not load.', 'bad');
    }
  });
}());
