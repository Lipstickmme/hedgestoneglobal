'use strict';

/**
 * The pages a customer spends their time on: the dashboard, accounts,
 * transactions, statements, cards, alerts and secure messages.
 *
 * One script for all of them, with a small router at the bottom, because they
 * share the same rendering helpers and loading the same 20kB once is cheaper
 * than seven files that each redefine a transaction row.
 */

(function () {
  const RF = window.RF;
  const { api, qs, qsa, esc, money, signedMoney, date, datetime, ago, toast, badge } = RF;

  /* ------------------------------------------------------------- shared -- */

  /** One row of the transaction tables, used on three different screens. */
  function txRow(tx, { showAccount = true, showBalance = true } = {}) {
    return `<tr class="clickable" data-tx="${esc(tx.id)}">
      <td class="rf-nowrap">${date(tx.date, { month: 'short', day: 'numeric' })}<span class="sub">${new Date(tx.date).getFullYear()}</span></td>
      <td>
        <strong>${esc(tx.description)}</strong>
        <span class="sub">${esc(tx.category)}${tx.memo ? ` &middot; ${esc(tx.memo)}` : ''}</span>
      </td>
      ${showAccount ? `<td class="rf-nowrap rf-small opt">${esc(tx.accountName || '')}<span class="sub">&bull;&bull;${esc(tx.accountLast4 || '')}</span></td>` : ''}
      <td>${tx.status === 'posted' ? '' : badge(tx.status)}</td>
      <td class="num rf-amt ${tx.direction}">${signedMoney(tx.amount, tx.direction)}</td>
      ${showBalance ? `<td class="num rf-muted opt">${tx.balanceAfter == null ? '&mdash;' : money(tx.balanceAfter)}</td>` : ''}
    </tr>`;
  }

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
    if (tx.traceNumber) rows.push(['ACH trace', `<span class="rf-mono">${esc(tx.traceNumber)}</span>`]);
    if (tx.checkNumber) rows.push(['Check number', esc(tx.checkNumber)]);
    if (tx.location) rows.push(['Where', esc(tx.location)]);
    if (tx.memo) rows.push(['Memo', esc(tx.memo)]);
    if (tx.counterparty && tx.counterparty.name) {
      rows.push(['Counterparty', esc(tx.counterparty.name)]);
      if (tx.counterparty.bank) rows.push(['Their bank', esc(tx.counterparty.bank)]);
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
          ${data.dispute
    ? `<div class="rf-notice warn rf-mt"><div><strong>Claim ${esc(data.dispute.reference)}</strong>${esc(data.dispute.status.replace(/_/g, ' '))}</div></div>`
    : `<div class="rf-mt"><button class="rf-btn ghost sm" data-dispute>Something is wrong with this transaction</button></div>`}
        </div>
      </div>`;
    document.body.appendChild(el);
    RF.modal.wire(el);
    RF.modal.open(el);
    el.addEventListener('click', (event) => { if (event.target === el) el.remove(); });
    qsa('[data-close-modal]', el).forEach((b) => b.addEventListener('click', () => el.remove()));

    const disputeBtn = qs('[data-dispute]', el);
    if (disputeBtn) {
      disputeBtn.addEventListener('click', async () => {
        const detail = prompt('Tell us what is wrong with this transaction:');
        if (!detail) return;
        try {
          const res = await api.post('/disputes', { transactionId: tx.id, reason: 'unauthorized', detail });
          toast(`Claim ${res.dispute.reference} opened. We will write within 10 business days.`, 'ok');
          el.remove();
          document.body.style.overflow = '';
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
    }
  }

  /** Every transaction table on the page gets click-to-open, once. */
  function wireTxTables(root) {
    qsa('[data-recent], [data-rows], [data-detail-transactions]', root || document).forEach((tbody) => {
      if (tbody.dataset.wired) return;
      tbody.dataset.wired = '1';
      tbody.addEventListener('click', (event) => {
        const row = event.target.closest('[data-tx]');
        if (row) openTransaction(row.getAttribute('data-tx'));
      });
    });
  }

  const accountTile = (account) => `
    <a class="rf-acct ${account.isCredit ? 'credit' : ''}" href="/accounts?id=${esc(account.id)}">
      <div class="top">
        <strong>${esc(account.nickname || account.name)}</strong>
        ${account.status === 'active' ? '' : badge(account.status)}
      </div>
      <div class="no">${esc(account.accountMask)}</div>
      <div class="bal">${money(account.balance)}</div>
      <div class="meta">
        ${account.isCredit
    ? `<span>${money(account.availableBalance)} available to spend</span>`
    : `<span>${money(account.availableBalance)} available</span>`}
        ${account.holdAmount ? `<span>${money(account.holdAmount)} on hold</span>` : ''}
      </div>
    </a>`;

  /* ---------------------------------------------------------- dashboard -- */

  async function dashboard() {
    const data = await api.get('/overview');

    const heading = qs('.rf-top h1');
    if (heading && data.user) {
      const hour = new Date().getHours();
      const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      heading.textContent = `${part}, ${data.user.preferredName || data.user.firstName || ''}`.trim();
    }

    qs('[data-total="deposits"]').textContent = money(data.totals.deposits);
    qs('[data-total="available"]').textContent = money(data.totals.available);
    qs('[data-total="owed"]').textContent = money(data.totals.owed);
    qs('[data-total="creditAvailable"]').textContent = money(data.totals.creditAvailable);
    const deposits = data.accounts.filter((a) => !a.isCredit).length;
    qs('[data-total-sub="deposits"]').textContent = `across ${deposits} ${deposits === 1 ? 'account' : 'accounts'}`;
    const owedSub = qs('[data-total-sub="owed"]');
    if (owedSub) owedSub.textContent = data.totals.owed ? 'due on your card' : 'nothing owed';

    qs('[data-accounts]').innerHTML = data.accounts.map(accountTile).join('')
      || '<div class="rf-card rf-empty">No accounts yet.</div>';

    qs('[data-recent]').innerHTML = data.recent.length
      ? data.recent.map((tx) => txRow(tx)).join('')
      : '<tr><td colspan="6" class="rf-center rf-muted">Nothing yet.</td></tr>';

    // Six months in and out.
    const months = data.months || [];
    const peak = Math.max(1, ...months.flatMap((m) => [m.in, m.out]));
    qs('[data-months]').innerHTML = months.map((m) => `
      <div class="col">
        <div class="pair">
          <div class="bar in" style="height:${Math.max(3, (m.in / peak) * 100)}%" title="In ${money(m.in)}"></div>
          <div class="bar out" style="height:${Math.max(3, (m.out / peak) * 100)}%" title="Out ${money(m.out)}"></div>
        </div>
        <span class="lbl">${esc(m.label)}</span>
      </div>`).join('');

    // Spending by category.
    const spending = (data.spending || []).slice(0, 6);
    const spendHost = qs('[data-spending]');
    if (spending.length) {
      const coloured = spending.map((s, i) => ({ ...s, color: RF.CHART_COLORS[i % RF.CHART_COLORS.length] }));
      const total = coloured.reduce((sum, s) => sum + s.amount, 0);
      spendHost.innerHTML = `
        ${RF.donut(coloured.map((s) => ({ label: s.category, amount: s.amount, color: s.color })))}
        <ul class="rf-list legend">
          ${coloured.map((s) => `<li><span class="sw" style="background:${s.color}"></span><span>${esc(s.category)}</span><span class="amt">${money(s.amount)}</span></li>`).join('')}
          <li><span class="sw" style="background:transparent"></span><strong>Total</strong><span class="amt">${money(total)}</span></li>
        </ul>`;
    } else {
      spendHost.innerHTML = '<p class="rf-muted rf-small">No card spending in the last 30 days.</p>';
    }

    const pending = qs('[data-pending]');
    pending.innerHTML = data.pending.length
      ? data.pending.map((tx) => `<li>
          <span class="t"><strong>${esc(tx.description)}</strong><span>${date(tx.date)} &middot; ${esc(tx.accountName)}</span></span>
          <span class="rf-amt ${tx.direction}">${signedMoney(tx.amount, tx.direction)}</span>
        </li>`).join('')
      : '<li class="rf-muted rf-small">Nothing pending.</li>';

    const upcoming = qs('[data-upcoming]');
    upcoming.innerHTML = data.upcoming.length
      ? data.upcoming.map((bill) => `<li>
          <span class="t"><strong>${esc(bill.name)}</strong><span>${date(bill.dueDate)} &middot; ${esc(bill.category)}</span></span>
          <span class="rf-amt">${money(bill.amount)}</span>
        </li>`).join('')
      : '<li class="rf-muted rf-small">No scheduled payments.</li>';

    wireTxTables();
  }

  /* ----------------------------------------------------------- accounts -- */

  async function accountsPage() {
    const { accounts } = await api.get('/accounts');
    qs('[data-accounts]').innerHTML = accounts.map(accountTile).join('')
      || '<div class="rf-card rf-empty"><strong>No accounts yet</strong>Call us and we will open one.</div>';

    const panel = qs('[data-account-detail]');
    const closeBtn = qs('[data-close-detail]');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        panel.hidden = true;
        history.replaceState(null, '', '/accounts');
      });
    }

    async function show(id) {
      const data = await api.get(`/accounts/${id}`);
      const a = data.account;
      panel.hidden = false;
      qs('[data-detail-title]').textContent = `${a.nickname || a.name} ${a.accountMask}`;
      qs('[data-statements-link]').href = `/statements?account=${a.id}`;

      qs('[data-detail-dl]').innerHTML = [
        ['Type', esc(a.typeLabel)],
        ['Status', badge(a.status)],
        ['Balance', `<span class="rf-amt">${money(a.balance)}</span>`],
        ['Available', money(a.availableBalance)],
        a.holdAmount ? ['On hold', money(a.holdAmount)] : null,
        a.isCredit ? ['Credit limit', money(a.creditLimit)] : ['Overdraft cover', money(a.overdraftLimit)],
        a.apy ? ['APY', `${a.apy.toFixed(2)}%`] : null,
        a.apr ? ['APR', `${a.apr.toFixed(2)}%`] : null,
        ['Opened', date(a.openedAt)],
      ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

      qs('[data-detail-wire]').innerHTML = [
        ['Account number', `<span class="rf-mono">${esc(data.details.accountNumber)}</span>`],
        ['Routing (ABA)', `<span class="rf-mono">${esc(data.details.routingNumber)}</span>`],
        ['SWIFT', `<span class="rf-mono">${esc(data.details.swift)}</span>`],
        ['Bank', esc(data.details.bankName)],
        // The address is operator-supplied and blank until it is set. A wire
        // form with an empty "Bank address" beside it is worse than one
        // without the row: it looks like the detail is missing rather than
        // not published.
        data.details.bankAddress ? ['Bank address', esc(data.details.bankAddress)] : null,
      ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd class="mono">${v}</dd>`).join('');

      qs('[data-copy-details]').onclick = () => RF.copy(data.details.wireInstructions, 'Account details copied');

      qs('[data-detail-transactions]').innerHTML = data.recent.length
        ? data.recent.map((tx) => txRow(tx, { showAccount: false })).join('')
        : '<tr><td colspan="5" class="rf-center rf-muted">Nothing on this account yet.</td></tr>';

      qs('[data-rename]').onclick = async () => {
        const nickname = prompt('What should we call this account?', a.nickname || a.name);
        if (nickname == null) return;
        try {
          await api.patch(`/accounts/${a.id}`, { nickname });
          toast('Account renamed.', 'ok');
          location.reload();
        } catch (err) {
          toast(err.message, 'bad');
        }
      };

      wireTxTables(panel);
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    const requested = new URLSearchParams(location.search).get('id');
    if (requested) show(requested).catch((err) => toast(err.message, 'bad'));
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

  /* --------------------------------------------------------- statements -- */

  async function statementsPage() {
    const select = qs('#s-account');
    const tbody = qs('[data-rows]');
    const panel = qs('[data-statement]');
    const { accounts } = await api.get('/accounts');

    select.innerHTML = accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.nickname || a.name)} ${esc(a.accountMask)}</option>`).join('');
    const preset = new URLSearchParams(location.search).get('account');
    if (preset && accounts.some((a) => a.id === preset)) select.value = preset;

    async function load() {
      tbody.innerHTML = '<tr><td colspan="6" class="rf-center rf-muted">Loading&hellip;</td></tr>';
      const data = await api.get(`/accounts/${select.value}/statements`);
      tbody.innerHTML = data.statements.length
        ? data.statements.map((s) => `<tr>
            <td><strong>${esc(s.label)}</strong><span class="sub">${s.entries} entries</span></td>
            <td class="num opt">${money(s.opening)}</td>
            <td class="num rf-amt credit opt">${money(s.credits)}</td>
            <td class="num opt">${money(s.debits)}</td>
            <td class="num"><strong>${money(s.closing)}</strong></td>
            <td class="rf-right"><button class="rf-btn ghost sm" data-open="${esc(s.periodStart.slice(0, 7))}">Open</button></td>
          </tr>`).join('')
        : '<tr><td colspan="6" class="rf-center rf-muted">No statements yet.</td></tr>';
    }

    async function openStatement(period) {
      const data = await api.get(`/accounts/${select.value}/statements/${period}`);
      const s = data.statement;
      const a = data.account;
      panel.hidden = false;
      qs('[data-statement-title]').textContent = `Statement ${date(s.periodStart, { month: 'long', year: 'numeric' })}`;
      qs('[data-statement-body]').innerHTML = `
        <div class="rf-statement">
          <div class="rf-statement-head">
            <div>
              <h2>${esc(data.bank.name)}</h2>
              <div class="addr">${[data.bank.address, data.bank.phone].filter(Boolean).map(esc).join('<br />')}</div>
            </div>
            <div class="rf-right">
              <div class="addr"><strong>${esc(data.customer.name)}</strong><br />${data.customer.addressLines.map(esc).join('<br />')}</div>
            </div>
          </div>
          <div class="rf-spread rf-mb">
            <div>
              <div class="rf-small rf-muted">Account</div>
              <div class="rf-mono">${esc(a.name)} ${esc(a.accountMask)}</div>
            </div>
            <div class="rf-right">
              <div class="rf-small rf-muted">Statement period</div>
              <div>${date(s.periodStart)} to ${date(s.periodEnd)}</div>
            </div>
          </div>
          <div class="rf-statement-summary">
            <div class="box"><div class="k">Opening balance</div><div class="v">${money(s.opening)}</div></div>
            <div class="box"><div class="k">Deposits and credits</div><div class="v">${money(s.credits)}</div></div>
            <div class="box"><div class="k">Withdrawals and debits</div><div class="v">${money(s.debits)}</div></div>
            <div class="box"><div class="k">Closing balance</div><div class="v">${money(s.closing)}</div></div>
          </div>
          <table class="rf-table">
            <thead><tr><th>Date</th><th>Description</th><th class="num">Debits</th><th class="num">Credits</th><th class="num">Balance</th></tr></thead>
            <tbody>
              ${s.transactions.map((tx) => `<tr>
                <td class="rf-nowrap">${date(tx.date, { month: 'short', day: 'numeric' })}</td>
                <td>${esc(tx.description)}${tx.reference ? `<span class="sub rf-mono">${esc(tx.reference)}</span>` : ''}</td>
                <td class="num">${tx.direction === 'debit' ? money(tx.amount) : ''}</td>
                <td class="num">${tx.direction === 'credit' ? money(tx.amount) : ''}</td>
                <td class="num">${tx.balanceAfter == null ? '' : money(tx.balanceAfter)}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="rf-center rf-muted">No activity in this period.</td></tr>'}
            </tbody>
          </table>
          <p class="rf-disclosure rf-mt">
            ${esc(data.bank.legalName)} &middot; Member FDIC &middot; Equal Housing Lender. In case of errors or questions about your electronic transfers,
            ${data.bank.phone ? `telephone ${esc(data.bank.phone)} or ` : ''}write to us${data.bank.address ? ' at the address above' : ''} as soon as you can. We must hear from you no later than 60 days after we sent you
            the first statement on which the problem appeared.
          </p>
        </div>`;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    tbody.addEventListener('click', (event) => {
      const button = event.target.closest('[data-open]');
      if (button) openStatement(button.getAttribute('data-open')).catch((err) => toast(err.message, 'bad'));
    });
    qs('[data-close-statement]').addEventListener('click', () => { panel.hidden = true; });
    select.addEventListener('change', () => { panel.hidden = true; load(); });
    await load();
  }

  /* --------------------------------------------------------------- cards -- */

  async function cardsPage() {
    const host = qs('[data-cards]');

    async function load() {
      const { cards } = await api.get('/cards');
      host.innerHTML = cards.length ? cards.map((card) => `
        <section class="rf-card">
          <div class="rf-card-body">
            <div class="rf-plastic ${card.kind === 'credit' ? 'brass' : ''} ${card.status === 'active' ? '' : 'is-frozen'}">
              <div class="brandline"><span>Rockfield</span><span class="scheme">${esc(card.brand.toUpperCase())}</span></div>
              <div class="chip"></div>
              <div class="pan">${esc(card.masked)}</div>
              <div class="foot">
                <span><span class="k">Card holder</span>${esc(card.nameOnCard)}</span>
                <span><span class="k">Expires</span>${esc(card.expires)}</span>
              </div>
            </div>
            <div class="rf-spread rf-mt">
              <div>
                <strong>${esc(card.accountName || card.kind)}</strong>
                <div class="rf-small rf-muted">${esc(card.kind === 'credit' ? 'Credit card' : 'Debit card')} &middot; ${badge(card.status)}</div>
              </div>
              <div class="rf-inline">
                ${card.status === 'active'
    ? `<button class="rf-btn ghost sm" data-card="${esc(card.id)}" data-action="freeze">Freeze</button>`
    : card.status === 'frozen'
      ? `<button class="rf-btn sm" data-card="${esc(card.id)}" data-action="unfreeze">Unfreeze</button>`
      : ''}
                <button class="rf-btn ghost sm" data-card="${esc(card.id)}" data-action="limits">Limits</button>
                <button class="rf-btn ghost sm" data-card="${esc(card.id)}" data-action="report_lost">Report lost</button>
              </div>
            </div>
            <dl class="rf-dl rf-mt">
              <dt>Daily purchases</dt><dd>${money(card.dailyPurchaseLimit)}</dd>
              <dt>Daily ATM</dt><dd>${money(card.dailyAtmLimit)}</dd>
              <dt>Contactless</dt><dd>${card.contactless ? 'On' : 'Off'}</dd>
              <dt>International use</dt><dd>${card.internationalAllowed ? 'Allowed' : 'Blocked'}</dd>
            </dl>
          </div>
        </section>`).join('') : '<div class="rf-card rf-empty"><strong>No cards yet</strong>Call us and we will send one out.</div>';
    }

    host.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-card]');
      if (!button) return;
      const id = button.getAttribute('data-card');
      const action = button.getAttribute('data-action');
      try {
        if (action === 'limits') {
          const purchases = prompt('Daily purchase limit, in dollars:', '7500');
          if (purchases == null) return;
          const atm = prompt('Daily ATM limit, in dollars:', '1000');
          if (atm == null) return;
          await api.post(`/cards/${id}`, { action: 'limits', dailyPurchaseLimit: Number(purchases), dailyAtmLimit: Number(atm) });
          toast('Card limits updated.', 'ok');
        } else if (action === 'report_lost') {
          if (!confirm('Report this card lost? We will cancel it and post a replacement today.')) return;
          const res = await api.post(`/cards/${id}`, { action });
          toast(res.replacement ? `Card cancelled. A replacement ending ${res.replacement.last4} is on its way.` : 'Card cancelled.', 'ok');
        } else {
          await api.post(`/cards/${id}`, { action });
          toast(action === 'freeze' ? 'Card frozen.' : 'Card unfrozen.', 'ok');
        }
        await load();
      } catch (err) {
        toast(err.message, 'bad');
      }
    });

    await load();
  }

  /* -------------------------------------------------------------- alerts -- */

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
          <span class="t">${esc(type.label)}${type.locked ? '<small>Always on. We are required to tell you.</small>' : ''}</span>
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
          <div class="rf-spread rf-small rf-muted"><strong>${esc(m.authorName || (m.from === 'bank' ? 'Rockfield' : 'You'))}</strong><span>${datetime(m.createdAt)}</span></div>
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
      body.innerHTML = '<p class="rf-muted rf-small">Write your message below. Anything you send here stays inside your banking session.</p>';
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
    '/accounts': accountsPage,
    '/transactions': transactionsPage,
    '/statements': statementsPage,
    '/cards': cardsPage,
    '/alerts': alertsPage,
    '/messages': messagesPage,
  };

  RF.ready(async () => {
    const route = ROUTES[location.pathname.replace(/\/$/, '') || '/dashboard'];
    if (!route) return;
    try {
      await route();
    } catch (err) {
      console.error('[rockfield]', err);
      toast(err.message || 'This page could not load.', 'bad');
    }
  });
}());
