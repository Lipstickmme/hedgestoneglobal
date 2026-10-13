'use strict';

/**
 * The staff console.
 *
 * Each tab loads when it is first opened and refreshes on demand rather than
 * on a timer: a console that re-renders under a cursor is how the wrong
 * transfer gets approved.
 */

(function () {
  const RF = window.RF;
  const { api, qs, qsa, esc, money, date, datetime, ago, toast, badge, onSubmit } = RF;

  const state = { settings: null, meta: null, customers: [], activityOffset: 0 };
  const loaded = new Set();

  /**
   * What the open modal is acting on.
   *
   * Deliberately not stored on the element: `dataset.customer` writes a
   * `data-customer` attribute, which is the selector the delegated
   * open-this-customer handler at the bottom of this file listens for. A Save
   * button inside such a modal would match it, and that handler calls
   * preventDefault() - so the form would never submit.
   */
  const acting = { accountId: null, customerId: null, transferId: null };

  /* ---------------------------------------------------------------- tabs -- */

  const TITLES = {
    overview: ['Today', 'What needs a decision, and how the bank stands.'],
    queue: ['Transfer queue', 'Outgoing transfers held for review.'],
    deposits: ['Check deposits', 'Mobile deposits waiting on a decision.'],
    messages: ['Messages', 'Secure messages from customers.'],
    disputes: ['Claims', 'Disputed transactions.'],
    customers: ['Customers', 'Search, open and act on any customer.'],
    register: ['Register a customer', 'Open a customer and their first accounts.'],
    cards: ['Cards', 'Every card the bank has issued.'],
    investments: ['Investments', 'What customers hold, valued at live prices.'],
    alerts: ['Email alerts', 'Everything the bank has sent, and to whom.'],
    activity: ['Activity log', 'Every action, by customers and staff.'],
    settings: ['Settings', 'Limits, fees, contact details and switches.'],
    setup: ['Setup checklist', 'What the backend needs, checked live.'],
  };

  function showTab(name) {
    qsa('[data-tab]').forEach((b) => {
      const on = b.getAttribute('data-tab') === name;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    qsa('[data-panel]').forEach((p) => { p.hidden = p.getAttribute('data-panel') !== name; });
    history.replaceState(null, '', `#${name}`);
    const [title, sub] = TITLES[name] || ['Staff console', ''];
    const h1 = qs('.rf-top h1');
    if (h1) h1.textContent = title;
    const subEl = qs('.rf-top-sub');
    if (subEl) subEl.textContent = sub;
    // On a phone the menu is a drawer: close it once a section is chosen.
    const scrim = qs('.rf-scrim');
    if (scrim) scrim.click();
    window.scrollTo(0, 0);
    if (!loaded.has(name) && TABS[name]) {
      loaded.add(name);
      Promise.resolve(TABS[name]()).catch((err) => {
        loaded.delete(name);
        toast(err.message || 'That tab could not load.', 'bad');
      });
    }
  }

  /* ------------------------------------------------------------ overview -- */

  async function overview() {
    const data = await api.get('/admin/overview');
    const s = data.stats;

    qs('[data-stats]').innerHTML = [
      ['Customers', String(s.customers), `${esc(String(s.newCustomers30d))} joined in 30 days`],
      ['On deposit', money(s.deposits), `${esc(String(s.accounts))} accounts`],
      ['Credit outstanding', money(s.creditOutstanding), `across card accounts &middot; ${s.suspended} suspended`],
    ].map(([k, v, d]) => `<div class="rf-card rf-stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="d">${d}</div></div>`).join('');

    // What needs a person, first and largest. Each tile opens its section.
    const attention = [
      ['queue', 'Transfers to review', s.pendingTransfers, s.pendingTransferValue ? `${money(s.pendingTransferValue)} held` : 'nothing held'],
      ['deposits', 'Check deposits', s.pendingDeposits, 'waiting on a decision'],
      ['customers?kyc=pending', 'Identity checks', s.pendingKyc, 'customers to verify'],
      ['messages', 'Unanswered messages', s.unansweredMessages, 'from customers'],
      ['disputes', 'Open claims', s.openDisputes, 'disputed transactions'],
    ];
    qs('[data-attention]').innerHTML = attention.map(([tab, label, n, d]) => `
      <a class="hs-attn-tile${n ? ' is-hot' : ''}" href="#${tab.split('?')[0]}" data-goto-tab="${tab}">
        <span class="n">${esc(String(n || 0))}</span>
        <span class="l"><strong>${esc(label)}</strong><small>${n ? esc(d) : 'All clear'}</small></span>
        <span class="go" aria-hidden="true">&rarr;</span>
      </a>`).join('');

    const pips = { queue: s.pendingTransfers, deposits: s.pendingDeposits, messages: s.unansweredMessages, disputes: s.openDisputes };
    Object.entries(pips).forEach(([key, n]) => {
      qsa(`[data-staff-pip="${key}"]`).forEach((pip) => {
        pip.textContent = String(n || '');
        pip.classList.toggle('rf-hide', !n);
      });
    });

    // Invested, and whether setup is finished, load beside the rest.
    api.get('/admin/investments').then((inv) => {
      const host = qs('[data-stats]');
      if (!host || qs('[data-stat-invested]', host)) return;
      host.insertAdjacentHTML('beforeend', `<a class="rf-card rf-stat hs-stat-link" href="#investments" data-goto-tab="investments" data-stat-invested><div class="k">Invested by customers</div><div class="v">${money(inv.totals.value)}</div><div class="d">${inv.totals.investors} investor${inv.totals.investors === 1 ? '' : 's'} &middot; ${inv.totals.trades24h} trade${inv.totals.trades24h === 1 ? '' : 's'} today</div></a>`);
    }).catch(() => {});
    api.get('/admin/setup').then((setupData) => {
      const left = setupData.counts.todo || 0;
      qsa('[data-staff-pip="setup"]').forEach((pip) => { pip.textContent = String(left || ''); pip.classList.toggle('rf-hide', !left); });
      const banner = qs('[data-setup-banner]');
      if (banner && left) {
        banner.innerHTML = `<span><strong>${left} setup item${left === 1 ? '' : 's'} left</strong> before this bank is ready for real customers.</span><a class="rf-btn sm" href="#setup" data-goto-tab="setup">Open the checklist</a>`;
        banner.classList.remove('rf-hide');
      }
    }).catch(() => {});

    qs('[data-queue-preview]').innerHTML = data.queue.length ? data.queue.map((t) => `
      <tr>
        <td>${esc((t.customer && t.customer.fullName) || '')}</td>
        <td class="rf-small">${esc(t.typeLabel)}</td>
        <td class="rf-small">${esc((t.recipient && (t.recipient.nickname || t.recipient.name)) || '&mdash;')}</td>
        <td class="num rf-amt">${money(t.total)}</td>
        <td class="rf-small rf-muted">${ago(t.createdAt)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="rf-center rf-muted">Nothing waiting. Good.</td></tr>';

    qs('[data-activity-preview]').innerHTML = data.activity.slice(0, 8).map((row) => `
      <li>
        <span class="t"><strong>${esc(row.detail || row.action)}</strong><span>${esc(row.actorEmail || 'system')} &middot; ${esc(row.ip || '')}</span></span>
        <span class="rf-small rf-muted rf-nowrap">${ago(row.createdAt)}</span>
      </li>`).join('') || '<li class="rf-muted rf-small">Nothing yet.</li>';

    qs('[data-new-customers]').innerHTML = data.recentCustomers.map((c) => `
      <li class="clickable" data-customer="${esc(c.id)}">
        <span class="rf-avatar sm">${esc(c.initials)}</span>
        <span class="t"><strong>${esc(c.fullName)}</strong><span>${esc(c.email)}</span></span>
        <span class="rf-small rf-muted">${date(c.createdAt)}</span>
      </li>`).join('') || '<li class="rf-muted rf-small">No customers yet.</li>';

    qs('[data-goto="queue"]').addEventListener('click', () => showTab('queue'));
  }

  /* ----------------------------------------------------------- customers -- */

  async function customers() {
    const form = qs('[data-customer-filters]');
    const tbody = qs('[data-customers]');

    async function load() {
      const params = new URLSearchParams(RF.formData(form));
      params.set('limit', '100');
      const data = await api.get(`/admin/customers?${params.toString()}`);
      state.customers = data.customers;
      qs('[data-customer-count]').textContent = `${data.total} record(s)`;
      tbody.innerHTML = data.customers.length ? data.customers.map((c) => `
        <tr class="clickable" data-customer="${esc(c.id)}">
          <td>
            <span class="rf-inline"><span class="rf-avatar sm">${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="" />` : esc(c.initials)}</span>
            <span><strong>${esc(c.fullName)}</strong><span class="sub">${esc(c.email)}</span></span></span>
          </td>
          <td class="rf-mono rf-small">${esc(c.customerNumber)}</td>
          <td>${badge(c.status)}${c.role === 'admin' ? ' ' + badge('info', 'staff') : ''}</td>
          <td>${badge(c.kycStatus)}</td>
          <td class="num">${c.accountCount}</td>
          <td class="num rf-amt">${money(c.totalBalance)}</td>
          <td class="rf-small rf-muted">${date(c.createdAt)}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="rf-center rf-muted">Nobody matches that search.</td></tr>';
    }

    form.addEventListener('submit', (event) => { event.preventDefault(); load(); });
    await load();
  }

  /* --------------------------------------------------- the customer sheet -- */

  const customerModal = qs('[data-customer-modal]');
  RF.modal.wire(customerModal);

  async function openCustomer(id) {
    acting.customerId = id;
    RF.modal.open(customerModal);
    qs('[data-modal-body]', customerModal).innerHTML = '<p class="rf-muted">Loading&hellip;</p>';
    const data = await api.get(`/admin/customers/${id}`);
    const c = data.customer;

    qs('[data-modal-name]', customerModal).innerHTML = `${esc(c.fullName)} <span class="rf-small rf-muted">${esc(c.customerNumber)}</span>`;
    const avatar = qs('[data-modal-avatar]', customerModal);
    avatar.innerHTML = c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="" />` : esc(c.initials);

    qs('[data-modal-body]', customerModal).innerHTML = `
      <div class="rf-inline rf-mb">
        ${badge(c.status)} ${badge(c.kycStatus, `KYC ${c.kycStatus}`)} <span class="rf-badge">${esc(c.tier)}</span>
        ${c.lockedUntil ? badge('bad', 'Locked out') : ''}
        ${c.mustChangePassword ? badge('pending', 'Must change password') : ''}
      </div>

      <div class="rf-grid cols-2">
        <div>
          <h4 class="rf-label">Identity</h4>
          <dl class="rf-dl">
            <dt>Email</dt><dd>${esc(c.email)}</dd>
            <dt>Phone</dt><dd>${esc(c.phone || '—')}</dd>
            <dt>Date of birth</dt><dd>${esc(c.dateOfBirth || '—')}</dd>
            <dt>SSN</dt><dd class="mono">${esc(c.ssnMasked || '—')} <button class="rf-copy" data-reveal-ssn="${esc(c.id)}">reveal</button></dd>
            <dt>Address</dt><dd>${esc([c.addressLine1, c.addressLine2, c.city, c.state, c.postalCode].filter(Boolean).join(', ') || '—')}</dd>
            <dt>ID document</dt><dd>${esc(c.idType || '—')} ${esc(c.idState || '')}</dd>
            <dt>Employment</dt><dd>${esc(c.employmentStatus || '—')}${c.employer ? ` at ${esc(c.employer)}` : ''}</dd>
            <dt>Annual income</dt><dd>${c.annualIncome ? money(c.annualIncome) : '—'}</dd>
            <dt>Joined</dt><dd>${date(c.createdAt)}</dd>
            <dt>Last signed in</dt><dd>${c.lastLoginAt ? datetime(c.lastLoginAt) : 'never'}</dd>
          </dl>
        </div>
        <div>
          <h4 class="rf-label">Accounts</h4>
          <table class="rf-table">
            <tbody>
              ${data.accounts.map((a) => `<tr>
                <td><strong>${esc(a.nickname || a.name)}</strong><span class="sub rf-mono">${esc(a.accountMask)} &middot; ${esc(a.typeLabel)}</span></td>
                <td class="num rf-amt">${money(a.balance)}<span class="sub">${money(a.availableBalance)} avail.</span></td>
                <td class="rf-right rf-nowrap">
                  <button class="rf-btn sm" data-adjust="${esc(a.id)}" data-account-label="${esc(`${a.nickname || a.name} ${a.accountMask}`)}">Adjust</button>
                  <button class="rf-btn ghost sm" data-account-status="${esc(a.id)}" data-current="${esc(a.status)}">${a.status === 'active' ? 'Freeze' : 'Activate'}</button>
                </td>
              </tr>`).join('') || '<tr><td class="rf-muted rf-small">No accounts.</td></tr>'}
            </tbody>
          </table>
          <button class="rf-btn ghost sm rf-mt" data-open-account="${esc(c.id)}">Open another account</button>

          <h4 class="rf-label rf-mt">Cards</h4>
          <ul class="rf-list">
            ${data.cards.map((card) => `<li>
              <span class="t"><strong>${esc(card.brand.toUpperCase())} &bull;&bull;&bull;&bull; ${esc(card.last4)}</strong><span>${esc(card.kind)} &middot; expires ${esc(card.expires)}</span></span>
              ${badge(card.status)}
            </li>`).join('') || '<li class="rf-muted rf-small">No cards.</li>'}
          </ul>
          <h4 class="rf-label rf-mt">Investments</h4>
          <ul class="rf-list" data-sheet-investments><li class="rf-muted rf-small">Loading&hellip;</li></ul>
        </div>
      </div>

      <h4 class="rf-label rf-mt">Recent entries</h4>
      <div class="rf-table-wrap">
        <table class="rf-table">
          <thead><tr><th>Date</th><th>Description</th><th>Status</th><th class="num">Amount</th><th class="num">Balance</th><th></th></tr></thead>
          <tbody>
            ${data.transactions.slice(0, 14).map((tx) => `<tr>
              <td class="rf-nowrap rf-small">${date(tx.date)}<span class="sub">${new Date(tx.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></td>
              <td>${esc(tx.description)}<span class="sub">${esc(tx.accountName)} &middot; ${esc(tx.methodLabel)}</span></td>
              <td>${badge(tx.status)}</td>
              <td class="num rf-amt ${tx.direction}">${RF.signedMoney(tx.amount, tx.direction)}</td>
              <td class="num rf-muted">${tx.balanceAfter == null ? '—' : money(tx.balanceAfter)}</td>
              <td class="rf-right rf-nowrap">
                ${tx.status === 'pending' ? `<button class="rf-btn ghost sm" data-settle="${esc(tx.id)}" data-settle-action="post">Post</button>` : ''}
                <button class="rf-btn link sm" data-edit-tx="${esc(tx.id)}">Edit</button>
                ${tx.status === 'posted' ? `<button class="rf-btn link sm" data-settle="${esc(tx.id)}" data-settle-action="reverse">Reverse</button>` : ''}
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="rf-muted rf-small">Nothing yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="rf-grid cols-2 rf-mt">
        <div>
          <h4 class="rf-label">Documents</h4>
          <ul class="rf-list">
            ${data.documents.map((doc) => `<li>
              <span class="t"><strong>${esc(doc.kindLabel)}</strong><span>${esc(doc.filename)} &middot; ${date(doc.createdAt)}</span></span>
              <a class="rf-btn ghost sm" href="${esc(doc.url)}" target="_blank" rel="noopener">View</a>
            </li>`).join('') || '<li class="rf-muted rf-small">Nothing on file.</li>'}
          </ul>
        </div>
        <div>
          <h4 class="rf-label">Recipients</h4>
          <ul class="rf-list">
            ${data.beneficiaries.map((b) => `<li>
              <span class="t"><strong>${esc(b.nickname || b.name)}</strong><span>${esc(b.bankName || '')} ${esc(b.accountMask)}</span></span>
              ${badge(b.status)}
              ${b.status !== 'verified' ? `<button class="rf-btn link sm" data-verify-beneficiary="${esc(b.id)}">Verify</button>` : ''}
            </li>`).join('') || '<li class="rf-muted rf-small">None saved.</li>'}
          </ul>
        </div>
      </div>

      <h4 class="rf-label rf-mt">Activity</h4>
      <ul class="rf-list">
        ${data.activity.slice(0, 10).map((row) => `<li>
          <span class="t"><strong>${esc(row.detail || row.action)}</strong><span>${esc(row.actorRole)} &middot; ${esc(row.ip || '')} &middot; ${esc(row.device || '')}</span></span>
          <span class="rf-small rf-muted rf-nowrap">${ago(row.createdAt)}</span>
        </li>`).join('') || '<li class="rf-muted rf-small">Nothing yet.</li>'}
      </ul>

      <hr class="rf-divider" />
      <h4 class="rf-label">Act on this customer</h4>
      <div class="rf-inline">
        <button class="rf-btn ghost sm" data-customer-action="password" data-id="${esc(c.id)}">Issue a temporary password</button>
        <button class="rf-btn ghost sm" data-customer-action="unlock" data-id="${esc(c.id)}">Clear the lockout</button>
        <button class="rf-btn ghost sm" data-customer-action="kyc" data-id="${esc(c.id)}">Set identity status</button>
        <button class="rf-btn ghost sm" data-customer-action="edit" data-id="${esc(c.id)}">Edit details</button>
        ${c.status === 'active'
    ? `<button class="rf-btn danger sm" data-customer-action="suspend" data-id="${esc(c.id)}">Suspend</button>`
    : `<button class="rf-btn sm" data-customer-action="activate" data-id="${esc(c.id)}">Reactivate</button>`}
      </div>`;

    const paintInvestments = () => api.get(`/admin/customers/${id}/investments`).then((inv) => {
      const list = qs('[data-sheet-investments]', customerModal);
      if (!list) return;
      const holdings = inv.holdings.length ? inv.holdings.map((h) => `<li>
        <span class="t"><strong>${esc(h.units)} ${esc(h.symbol)}</strong><span>${esc(h.name)} &middot; cost ${money(h.costBasis)}</span></span>
        <span class="rf-nowrap"><strong>${h.value == null ? '&mdash;' : money(h.value)}</strong></span>
      </li>`).join('') + `<li class="rf-small"><span class="t"><strong>Total</strong></span><strong>${money(inv.totals.value)}</strong></li>` : '<li class="rf-muted rf-small">No investments.</li>';
      const trades = inv.trades.slice(0, 8).map((t) => `<li class="${t.status === 'reversed' ? 'is-reversed' : ''}">
        <span class="t"><strong>${t.side === 'buy' ? 'Bought' : 'Sold'} ${esc(t.units)} ${esc(t.symbol)} @ ${money(t.price)}</strong><span>${datetime(t.createdAt)} &middot; ${money(t.amount)}${t.bookedByStaff ? ' &middot; booked by staff' : ''}${t.status === 'reversed' ? ' &middot; <b>reversed</b>' : ''}${t.note ? ` &middot; ${esc(t.note)}` : ''}</span></span>
        ${t.status === 'reversed' ? '' : `<span class="rf-nowrap"><button class="rf-btn link sm" data-trade-time="${esc(t.id)}" data-trade-at="${esc(t.createdAt)}">Change time</button> <button class="rf-btn link sm" data-trade-reverse="${esc(t.id)}" data-trade-label="${esc(`${t.side === 'buy' ? 'Bought' : 'Sold'} ${t.units} ${t.symbol} for ${money(t.amount)}`)}">Reverse</button></span>`}
      </li>`).join('');
      list.innerHTML = `${holdings}
        <li class="hs-sheet-actions"><button class="rf-btn sm" data-book-trade>Book a conversion</button><span class="rf-small rf-muted">For walk-ins, or instructions taken while the network was down.</span></li>
        ${trades ? `<li class="rf-label" style="border:0;padding-bottom:0">Conversions</li>${trades}` : ''}`;
    }).catch(() => {
      const list = qs('[data-sheet-investments]', customerModal);
      if (list) list.innerHTML = '<li class="rf-muted rf-small">Could not load investments.</li>';
    });
    paintInvestments();
    acting.paintInvestments = paintInvestments;
    acting.customerData = data;

    wireCustomerSheet(c, data);
  }

  function wireCustomerSheet(customer, data) {
    const root = customerModal;

    qsa('[data-adjust]', root).forEach((button) => button.addEventListener('click', () => {
      openAdjust(button.getAttribute('data-adjust'), button.getAttribute('data-account-label'), customer.id);
    }));

    qsa('[data-account-status]', root).forEach((button) => button.addEventListener('click', async () => {
      const id = button.getAttribute('data-account-status');
      const next = button.getAttribute('data-current') === 'active' ? 'frozen' : 'active';
      try {
        await api.patch(`/admin/accounts/${id}`, { status: next });
        toast(`Account ${next}.`, 'ok');
        openCustomer(customer.id);
      } catch (err) { toast(err.message, 'bad'); }
    }));

    qsa('[data-settle]', root).forEach((button) => button.addEventListener('click', async () => {
      const action = button.getAttribute('data-settle-action');
      const note = action === 'reverse' ? prompt('Why is this being reversed? The customer sees this.') : '';
      if (action === 'reverse' && note == null) return;
      try {
        await api.post(`/admin/transactions/${button.getAttribute('data-settle')}/settle`, { action, note });
        toast(action === 'post' ? 'Entry posted.' : 'Entry reversed.', 'ok');
        openCustomer(customer.id);
      } catch (err) { toast(err.message, 'bad'); }
    }));

    const ssnButton = qs('[data-reveal-ssn]', root);
    if (ssnButton) {
      ssnButton.addEventListener('click', async () => {
        if (!confirm('Viewing a full Social Security number is recorded against your name. Continue?')) return;
        try {
          const res = await api.post(`/admin/customers/${customer.id}/ssn`);
          ssnButton.previousSibling.textContent = `${res.ssn} `;
          ssnButton.remove();
        } catch (err) { toast(err.message, 'bad'); }
      });
    }

    qsa('[data-verify-beneficiary]', root).forEach((button) => button.addEventListener('click', async () => {
      try {
        await api.post(`/admin/beneficiaries/${button.getAttribute('data-verify-beneficiary')}/review`, { status: 'verified' });
        toast('Recipient verified.', 'ok');
        openCustomer(customer.id);
      } catch (err) { toast(err.message, 'bad'); }
    }));

    const openAccountModal = qs('[data-account-modal]');
    qsa('[data-open-account]', root).forEach((button) => button.addEventListener('click', () => {
      acting.customerId = customer.id;
      RF.modal.open(openAccountModal);
    }));

    qsa('[data-customer-action]', root).forEach((button) => button.addEventListener('click', async () => {
      const action = button.getAttribute('data-customer-action');
      const id = button.getAttribute('data-id');
      try {
        if (action === 'password') {
          const res = await api.post(`/admin/customers/${id}/password`, {});
          prompt('Temporary password (also emailed to the customer):', res.temporaryPassword);
          toast('Temporary password issued and every session signed out.', 'ok');
        } else if (action === 'unlock') {
          await api.post(`/admin/customers/${id}/unlock`);
          toast('Lockout cleared.', 'ok');
        } else if (action === 'kyc') {
          const status = prompt('Identity status: pending, review, verified or rejected', customer.kycStatus);
          if (!status) return;
          await api.post(`/admin/customers/${id}/kyc`, { kycStatus: status, notes: prompt('Note (optional):') || '' });
          toast('Identity status updated.', 'ok');
        } else if (action === 'suspend') {
          const reason = prompt('Why is this account being suspended? The customer is told.');
          if (reason == null) return;
          await api.post(`/admin/customers/${id}/status`, { status: 'suspended', reason });
          toast('Account suspended and sessions ended.', 'ok');
        } else if (action === 'activate') {
          await api.post(`/admin/customers/${id}/status`, { status: 'active' });
          toast('Account reactivated.', 'ok');
        } else if (action === 'edit') {
          editCustomer(customer);
          return;
        }
        openCustomer(id);
      } catch (err) { toast(err.message, 'bad'); }
    }));
  }

  /** Edit the details a customer cannot change themselves. */
  function editCustomer(customer) {
    const fields = [
      ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'],
      ['phone', 'Phone'], ['dateOfBirth', 'Date of birth (YYYY-MM-DD)'],
      ['addressLine1', 'Address line 1'], ['addressLine2', 'Address line 2'],
      ['city', 'City'], ['state', 'State'], ['postalCode', 'ZIP'],
      ['employer', 'Employer'], ['occupation', 'Occupation'], ['tier', 'Tier'],
      ['relationshipManager', 'Relationship manager'], ['notes', 'Internal notes'],
    ];
    const el = document.createElement('div');
    el.className = 'rf-modal-backdrop';
    el.innerHTML = `
      <div class="rf-modal">
        <div class="rf-modal-head"><h3>Edit ${esc(customer.fullName)}</h3><button type="button" data-close aria-label="Close">&times;</button></div>
        <form>
          <div class="rf-modal-body">
            <div class="rf-row">
              ${fields.map(([name, label]) => `<div class="rf-field"><label>${esc(label)}</label><input class="rf-input" name="${name}" value="${esc(customer[name] || '')}" /></div>`).join('')}
            </div>
            <div class="rf-field"><label>Social Security number (leave blank to keep)</label><input class="rf-input mono" name="ssn" placeholder="${esc(customer.ssnMasked || '')}" /></div>
            <div class="rf-notice bad rf-hide" data-form-error></div>
          </div>
          <div class="rf-modal-foot">
            <button class="rf-btn ghost" type="button" data-close>Cancel</button>
            <button class="rf-btn" type="submit" data-submit>Save changes</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    qsa('[data-close]', el).forEach((b) => b.addEventListener('click', close));
    onSubmit(qs('form', el), async (values) => {
      await api.patch(`/admin/customers/${customer.id}`, values);
      toast('Customer updated. They have been emailed a confirmation.', 'ok');
      close();
      openCustomer(customer.id);
    });
  }

  /* --------------------------------------------- back-posting and edits -- */

  /** A one-off modal on top of the customer sheet. */
  function staffSheet(title, body, submitLabel) {
    const el = document.createElement('div');
    el.className = 'rf-modal-backdrop hs-stacked';
    el.innerHTML = `<div class="rf-modal">
      <div class="rf-modal-head"><h3>${esc(title)}</h3><button type="button" data-close-sheet aria-label="Close">&times;</button></div>
      <form novalidate>
        <div class="rf-modal-body">${body}<div class="rf-notice bad rf-hide" data-form-error></div></div>
        <div class="rf-modal-foot"><button class="rf-btn ghost" type="button" data-close-sheet>Cancel</button><button class="rf-btn" type="submit" data-submit>${esc(submitLabel)}</button></div>
      </form>
    </div>`;
    document.body.appendChild(el);
    const close = () => el.remove();
    qsa('[data-close-sheet]', el).forEach((b) => b.addEventListener('click', close));
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    return { el, form: qs('form', el), close };
  }

  const localDate = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const localTime = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
  const whenFields = (iso, hint) => `<div class="rf-row">
      <div class="rf-field"><label>Date</label><input class="rf-input" type="date" name="date" value="${iso ? localDate(iso) : ''}" max="${localDate(new Date().toISOString())}" /></div>
      <div class="rf-field"><label>Time</label><input class="rf-input" type="time" name="time" value="${iso ? localTime(iso) : ''}" step="60" /></div>
    </div>${hint ? `<p class="rf-small rf-muted" style="margin-top:-6px">${hint}</p>` : ''}`;

  document.addEventListener('click', async (event) => {
    /* Edit an entry: when, how much, what it says. */
    const editBtn = event.target.closest('[data-edit-tx]');
    if (editBtn) {
      event.preventDefault();
      const data = acting.customerData;
      const tx = data && data.transactions.find((t) => t.id === editBtn.getAttribute('data-edit-tx'));
      if (!tx) return;
      const isTrade = tx.method === 'investment';
      const { form, close } = staffSheet('Edit entry', `
        <p class="rf-small rf-muted">${esc(tx.reference || '')} &middot; ${esc(tx.accountName || '')} &middot; ${badge(tx.status)}</p>
        <div class="rf-field"><label>Description on the statement</label><input class="rf-input" name="description" value="${esc(tx.description)}" maxlength="140" /></div>
        ${whenFields(tx.date, 'Moving an entry restates the running balances after it. The account balance itself does not change.')}
        <div class="rf-row">
          <div class="rf-field"><label>Amount</label><input class="rf-input money" name="amount" value="${(tx.amount / 100).toFixed(2)}" inputmode="decimal" ${tx.status !== 'posted' || isTrade ? 'disabled' : ''} />
            <div class="hint">${isTrade ? 'A conversion is corrected by reversing it and booking it again.' : tx.status !== 'posted' ? 'Post it first to change the amount.' : 'The balance moves by the difference.'}</div></div>
          <div class="rf-field"><label>Category</label><input class="rf-input" name="category" value="${esc(tx.category || '')}" /></div>
        </div>
        <div class="rf-field"><label>Memo shown to the customer</label><input class="rf-input" name="memo" value="${esc(tx.memo || '')}" /></div>
        <div class="rf-field"><label>Internal note (why)</label><input class="rf-input" name="note" placeholder="Walk-in at branch 2; slip #4471" /></div>`, 'Save changes');
      onSubmit(form, async (values) => {
        const body = { description: values.description, category: values.category, memo: values.memo, note: values.note };
        const when = whenOf(values.date, values.time);
        if (when && when !== new Date(tx.date).toISOString() && localDate(when) + localTime(when) !== localDate(tx.date) + localTime(tx.date)) body.date = when;
        if (values.amount !== undefined && Math.round(Number(String(values.amount).replace(/[^0-9.]/g, '')) * 100) !== tx.amount) body.amount = values.amount;
        await api.patch(`/admin/transactions/${tx.id}`, body);
        close();
        toast('Entry updated.', 'ok');
        openCustomer(acting.customerId);
      });
      return;
    }

    /* Book a conversion or sale for the customer, at a price and time. */
    if (event.target.closest('[data-book-trade]')) {
      event.preventDefault();
      const data = acting.customerData;
      const accounts = data.accounts.filter((a) => !a.isCredit && a.status === 'active');
      if (!accounts.length) { toast('This customer has no active checking or savings account.', 'bad'); return; }
      let assets = [];
      try { assets = (await api.get('/markets')).assets; } catch (err) { assets = []; }
      const { el, form, close } = staffSheet('Book a conversion', `
        <div class="rf-segment rf-mb" data-side><button type="button" class="is-active" data-side-value="buy">Convert cash to an asset</button><button type="button" data-side-value="sell">Sell an asset to cash</button></div>
        <input type="hidden" name="side" value="buy" />
        <div class="rf-row">
          <div class="rf-field"><label>Account</label><select class="rf-select" name="accountId">${accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.nickname || a.name)} ${esc(a.accountMask)} - ${money(a.availableBalance)}</option>`).join('')}</select></div>
          <div class="rf-field"><label>Asset</label><select class="rf-select" name="symbol">${assets.map((a) => `<option value="${esc(a.symbol)}" data-price="${a.quote ? a.quote.price : ''}" data-decimals="${a.decimals}">${esc(a.name)} (${esc(a.symbol)})</option>`).join('')}</select></div>
        </div>
        <div class="rf-row">
          <div class="rf-field" data-buy-only><label>Cash amount</label><input class="rf-input money" name="amount" inputmode="decimal" placeholder="0.00" /></div>
          <div class="rf-field" data-sell-only hidden><label>Units to sell</label><input class="rf-input money" name="units" inputmode="decimal" placeholder="0" /></div>
          <div class="rf-field"><label>Price per unit</label><input class="rf-input money" name="price" inputmode="decimal" /><div class="hint" data-live-hint></div></div>
        </div>
        ${whenFields('', 'Leave blank for now. Set it to the time the customer gave the instruction.')}
        <div class="rf-field"><label>Note (why it was booked by staff)</label><input class="rf-input" name="note" placeholder="Walk-in at branch 2" /></div>
        <div class="hs-preview" data-book-preview></div>`, 'Book it');
      const sideInput = qs('[name="side"]', form);
      const symbol = qs('[name="symbol"]', form);
      const price = qs('[name="price"]', form);
      const fillPrice = () => {
        const live = symbol.selectedOptions[0] && symbol.selectedOptions[0].getAttribute('data-price');
        price.value = live || '';
        qs('[data-live-hint]', form).textContent = live ? `Live price $${Number(live).toFixed(2)}. Change it to the agreed price.` : 'No live price: enter the agreed price.';
        preview();
      };
      const preview = () => {
        const p = Number(String(price.value).replace(/[^0-9.]/g, ''));
        const out = qs('[data-book-preview]', form);
        if (sideInput.value === 'buy') {
          const amt = Number(String(qs('[name="amount"]', form).value).replace(/[^0-9.]/g, ''));
          const dp = Number(symbol.selectedOptions[0] && symbol.selectedOptions[0].getAttribute('data-decimals')) || 6;
          out.innerHTML = p > 0 && amt > 0 ? `<div><span>Units</span><strong>${(Math.floor((amt / p) * 10 ** dp) / 10 ** dp).toLocaleString('en-US', { maximumFractionDigits: dp })} ${esc(symbol.value)}</strong></div>` : '';
        } else {
          const u = Number(String(qs('[name="units"]', form).value).replace(/[^0-9.]/g, ''));
          out.innerHTML = p > 0 && u > 0 ? `<div><span>Proceeds</span><strong>${money(Math.floor(u * p * 100))}</strong></div>` : '';
        }
      };
      qsa('[data-side-value]', el).forEach((b) => b.addEventListener('click', () => {
        qsa('[data-side-value]', el).forEach((x) => x.classList.toggle('is-active', x === b));
        sideInput.value = b.getAttribute('data-side-value');
        qs('[data-buy-only]', form).hidden = sideInput.value !== 'buy';
        qs('[data-sell-only]', form).hidden = sideInput.value !== 'sell';
        preview();
      }));
      symbol.addEventListener('change', fillPrice);
      ['amount', 'units', 'price'].forEach((n) => qs(`[name="${n}"]`, form).addEventListener('input', preview));
      fillPrice();
      onSubmit(form, async (values) => {
        const body = { customerId: acting.customerId, side: values.side, accountId: values.accountId, symbol: values.symbol, price: values.price, note: values.note, date: whenOf(values.date, values.time) || undefined };
        if (values.side === 'sell') body.units = values.units; else body.amount = values.amount;
        const res = await api.post('/admin/trades', body);
        close();
        toast(`${res.trade.side === 'buy' ? 'Booked' : 'Sold'} ${res.trade.units} ${res.trade.symbol} at ${money(res.trade.price)}.`, 'ok');
        openCustomer(acting.customerId);
      });
      return;
    }

    /* Move a conversion to when it really happened. */
    const timeBtn = event.target.closest('[data-trade-time]');
    if (timeBtn) {
      event.preventDefault();
      const { form, close } = staffSheet('Change the time of this conversion', `
        ${whenFields(timeBtn.getAttribute('data-trade-at'), 'Its ledger entry moves with it, and the running balances are restated.')}
        <div class="rf-field"><label>Reason</label><input class="rf-input" name="note" placeholder="Instruction taken by phone during the outage" /></div>`, 'Save time');
      onSubmit(form, async (values) => {
        const when = whenOf(values.date, values.time);
        if (!when) throw new Error('Enter a date and time.');
        await api.patch(`/admin/trades/${timeBtn.getAttribute('data-trade-time')}`, { date: when, note: values.note });
        close();
        toast('Conversion re-timed.', 'ok');
        openCustomer(acting.customerId);
      });
      return;
    }

    /* Undo a conversion completely. */
    const revBtn = event.target.closest('[data-trade-reverse]');
    if (revBtn) {
      event.preventDefault();
      const note = prompt(`Reverse this conversion?\n\n${revBtn.getAttribute('data-trade-label')}\n\nThe units come off the holding and the cash goes back. Why? (the customer sees this)`);
      if (note == null) return;
      try {
        await api.post(`/admin/trades/${revBtn.getAttribute('data-trade-reverse')}/reverse`, { note });
        toast('Conversion reversed.', 'ok');
        openCustomer(acting.customerId);
      } catch (err) { toast(err.message, 'bad'); }
    }
  });

  /* -------------------------------------------------------- adjust modal -- */

  const adjustModal = qs('[data-adjust-modal]');
  RF.modal.wire(adjustModal);

  function openAdjust(accountId, label, customerId) {
    acting.accountId = accountId;
    acting.customerId = customerId || null;
    qs('[data-adjust-account]', adjustModal).textContent = `Posting to ${label}`;
    qs('#rf-adjust-form').reset();
    RF.modal.open(adjustModal);
    qs('#ad-amount').focus();
  }

  /** A value date and an optional time, read in the operator's own time zone. */
  function whenOf(dateValue, timeValue) {
    if (!dateValue) return '';
    const d = new Date(`${dateValue}T${timeValue || '12:00'}`);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  onSubmit(qs('#rf-adjust-form'), async (values) => {
    values.date = whenOf(values.date, values.time);
    delete values.time;
    const res = await api.post(`/admin/accounts/${acting.accountId}/adjust`, values);
    RF.modal.close(adjustModal);
    toast(`${res.transaction.direction === 'credit' ? 'Credited' : 'Debited'} ${money(res.transaction.amount)}. New balance ${money(res.account.balance)}.`, 'ok');
    if (acting.customerId) openCustomer(acting.customerId);
  });

  /* -------------------------------------------------- open-account modal -- */

  const accountModal = qs('[data-account-modal]');
  RF.modal.wire(accountModal);
  onSubmit(qs('#rf-open-account-form'), async (values) => {
    const customerId = acting.customerId;
    const res = await api.post(`/admin/customers/${customerId}/accounts`, values);
    RF.modal.close(accountModal);
    toast(`${res.account.name} opened, ${res.account.accountMask}, with ${money(res.account.balance)}.`, 'ok');
    openCustomer(customerId);
  });

  /* ------------------------------------------------------------ register -- */

  function accountRow(index) {
    const products = (state.meta && state.meta.products) || [];
    return `
      <div class="rf-card rf-mb" data-account-row>
        <div class="rf-card-body tight">
          <div class="rf-row">
            <div class="rf-field">
              <label>Product</label>
              <select class="rf-select" data-field="productId">
                ${products.map((p) => `<option value="${esc(p.id)}"${index === 0 && p.id === 'everyday_checking' ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="rf-field">
              <label>Opening balance</label>
              <input class="rf-input money" data-field="openingBalance" inputmode="decimal" placeholder="0.00" />
            </div>
          </div>
          <div class="rf-row">
            <div class="rf-field"><label>Nickname</label><input class="rf-input" data-field="nickname" /></div>
            <div class="rf-field"><label>Credit limit (cards)</label><input class="rf-input" data-field="creditLimit" inputmode="decimal" /></div>
          </div>
          <label class="rf-check"><input type="checkbox" data-field="issueCard" checked /><span>Issue a card on this account</span></label>
          ${index > 0 ? '<button class="rf-btn link sm" type="button" data-remove-row>Remove this account</button>' : ''}
        </div>
      </div>`;
  }

  async function register() {
    if (!state.meta) state.meta = await api.get('/admin/settings');
    const host = qs('[data-account-rows]');
    host.innerHTML = accountRow(0);

    qs('[data-add-account]').addEventListener('click', () => {
      host.insertAdjacentHTML('beforeend', accountRow(host.children.length));
    });
    host.addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-row]');
      if (button) button.closest('[data-account-row]').remove();
    });

    // Identity documents, read as data URLs before the form is sent.
    const documents = {};
    qsa('[data-doc]').forEach((input) => {
      input.addEventListener('change', async () => {
        const kind = input.getAttribute('data-doc');
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          documents[kind] = await RF.readFile(file, { maxDimension: kind === 'avatar' ? 512 : 1600 });
          qs(`[data-doc-preview="${kind}"]`).textContent = `${file.name} ready`;
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
    });

    onSubmit(qs('#rf-register-form'), async (values) => {
      const accounts = qsa('[data-account-row]', host).map((row) => {
        const read = (field) => {
          const el = qs(`[data-field="${field}"]`, row);
          if (!el) return undefined;
          return el.type === 'checkbox' ? el.checked : el.value.trim();
        };
        return {
          productId: read('productId'),
          openingBalance: read('openingBalance'),
          nickname: read('nickname'),
          creditLimit: read('creditLimit'),
          issueCard: read('issueCard'),
        };
      });

      const result = await api.post('/admin/customers', { ...values, ...documents, accounts });
      showRegistration(result);
      toast('Customer registered and the welcome email sent.', 'ok');
      qs('#rf-register-form').reset();
      host.innerHTML = accountRow(0);
      loaded.delete('customers');
      showTab('customers');
    });
  }

  /**
   * What was just created, in something an operator can read out or copy: the
   * customer number, the username, the temporary password and every account
   * with its opening balance. A native alert() would block the page and could
   * not be copied from.
   */
  function showRegistration(result) {
    const el = document.createElement('div');
    el.className = 'rf-modal-backdrop';
    el.innerHTML = `
      <div class="rf-modal">
        <div class="rf-modal-head">
          <h3>${esc(result.customer.fullName)} is registered</h3>
          <button type="button" data-close aria-label="Close">&times;</button>
        </div>
        <div class="rf-modal-body">
          <p class="rf-small rf-muted">A welcome email has gone out with everything below. The temporary password is shown once, here.</p>
          <dl class="rf-dl">
            <dt>Customer number</dt><dd class="mono">${esc(result.customer.customerNumber)}</dd>
            <dt>Username</dt><dd>${esc(result.customer.email)}</dd>
            ${result.temporaryPassword ? `<dt>Temporary password</dt><dd class="mono">${esc(result.temporaryPassword)}</dd>` : ''}
            ${result.accounts.map((a) => `<dt>${esc(a.name)}</dt><dd class="mono">${esc(a.accountMask)} &middot; ${money(a.balance)}</dd>`).join('')}
          </dl>
        </div>
        <div class="rf-modal-foot">
          <button class="rf-btn ghost" type="button" data-copy>Copy the details</button>
          <button class="rf-btn" type="button" data-close>Done</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
    const close = () => { el.remove(); document.body.style.overflow = ''; };
    qsa('[data-close]', el).forEach((b) => b.addEventListener('click', close));
    el.addEventListener('click', (event) => { if (event.target === el) close(); });
    qs('[data-copy]', el).addEventListener('click', () => {
      RF.copy([
        `${result.customer.fullName} — ${result.customer.customerNumber}`,
        `Username: ${result.customer.email}`,
        result.temporaryPassword ? `Temporary password: ${result.temporaryPassword}` : '',
        ...result.accounts.map((a) => `${a.name} ${a.accountMask} — ${money(a.balance)}`),
      ].filter(Boolean).join('\n'), 'Registration details copied');
    });
  }

  /* --------------------------------------------------------------- queue -- */

  const rejectModal = qs('[data-reject-modal]');
  RF.modal.wire(rejectModal);

  async function queue() {
    const tbody = qs('[data-queue]');
    const statusSelect = qs('[data-queue-status]');

    async function load() {
      const status = statusSelect.value;
      const data = await api.get(`/admin/transfers${status ? `?status=${encodeURIComponent(status)}` : ''}`);
      tbody.innerHTML = data.transfers.length ? data.transfers.map((t) => `
        <tr>
          <td class="rf-nowrap rf-small">${date(t.createdAt)}<span class="sub">${new Date(t.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></td>
          <td>${t.customer ? `<button class="rf-btn link sm" data-customer="${esc(t.customer.id)}">${esc(t.customer.fullName)}</button>` : '&mdash;'}</td>
          <td class="rf-small">${esc(t.typeLabel)}</td>
          <td class="rf-small">${esc((t.recipient && (t.recipient.nickname || t.recipient.name)) || '&mdash;')}<span class="sub rf-mono">${esc((t.recipient && t.recipient.accountMasked) || '')}</span></td>
          <td class="rf-mono rf-small">${esc(t.confirmation)}</td>
          <td>${badge(t.status, t.statusLabel)}${t.reasonNote ? `<span class="sub">${esc(t.reasonNote)}</span>` : ''}</td>
          <td class="num rf-amt">${money(t.total)}${t.fee ? `<span class="sub">incl. ${money(t.fee)} fee</span>` : ''}</td>
          <td class="rf-right rf-nowrap">
            ${['pending_review', 'pending_verification', 'processing', 'scheduled'].includes(t.status) ? `
              <button class="rf-btn sm" data-approve="${esc(t.id)}">Release</button>
              <button class="rf-btn ghost sm" data-reject="${esc(t.id)}" data-summary="${esc(`${money(t.total)} to ${(t.recipient && (t.recipient.nickname || t.recipient.name)) || 'recipient'}`)}">Return</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="8" class="rf-center rf-muted">Nothing here.</td></tr>';
    }

    tbody.addEventListener('click', async (event) => {
      const approve = event.target.closest('[data-approve]');
      const reject = event.target.closest('[data-reject]');
      if (approve) {
        if (!confirm('Release this transfer? The money leaves the customer’s account now.')) return;
        try {
          await api.post(`/admin/transfers/${approve.getAttribute('data-approve')}/approve`, { note: '' });
          toast('Transfer released and the customer emailed.', 'ok');
          load();
          loaded.delete('overview');
        } catch (err) { toast(err.message, 'bad'); }
      }
      if (reject) {
        acting.transferId = reject.getAttribute('data-reject');
        qs('[data-reject-summary]', rejectModal).textContent = reject.getAttribute('data-summary');
        qs('#rf-reject-form').reset();
        RF.modal.open(rejectModal);
      }
    });

    statusSelect.addEventListener('change', load);
    qs('[data-run-scheduled]').addEventListener('click', async () => {
      const res = await api.post('/admin/scheduled/run');
      toast(`${res.processed.length} scheduled transfer(s) processed.`, 'ok');
      load();
    });

    onSubmit(qs('#rf-reject-form'), async (values) => {
      await api.post(`/admin/transfers/${acting.transferId}/reject`, values);
      RF.modal.close(rejectModal);
      toast('Transfer returned, funds released and the customer told why.', 'ok');
      load();
      loaded.delete('overview');
    });

    await load();
  }

  /* ------------------------------------------------------------ deposits -- */

  async function deposits() {
    const tbody = qs('[data-deposits]');

    async function load() {
      const data = await api.get('/admin/deposits');
      tbody.innerHTML = data.deposits.length ? data.deposits.map((d) => `
        <tr>
          <td class="rf-nowrap rf-small">${datetime(d.createdAt)}</td>
          <td>${d.customer ? `<button class="rf-btn link sm" data-customer="${esc(d.customer.id)}">${esc(d.customer.fullName)}</button>` : '&mdash;'}</td>
          <td class="rf-mono rf-small">${esc(d.reference)}</td>
          <td class="rf-small">${esc(d.checkNumber || '&mdash;')}</td>
          <td class="num rf-amt">${money(d.amount)}</td>
          <td>${badge(d.status)}</td>
          <td><a class="rf-btn ghost sm" href="${esc(d.frontUrl)}" target="_blank" rel="noopener">Front</a> <a class="rf-btn ghost sm" href="${esc(d.backUrl)}" target="_blank" rel="noopener">Back</a></td>
          <td class="rf-right rf-nowrap">
            ${d.status === 'review' ? `
              <button class="rf-btn sm" data-deposit="${esc(d.id)}" data-action="accept">Accept</button>
              <button class="rf-btn ghost sm" data-deposit="${esc(d.id)}" data-action="reject">Return</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="8" class="rf-center rf-muted">No deposits.</td></tr>';
    }

    tbody.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-deposit]');
      if (!button) return;
      const action = button.getAttribute('data-action');
      const note = action === 'reject' ? prompt('Why is this check being returned? The customer sees this.') : '';
      if (action === 'reject' && note == null) return;
      try {
        await api.post(`/admin/deposits/${button.getAttribute('data-deposit')}/review`, { action, note });
        toast(action === 'accept' ? 'Deposit accepted and the funds released.' : 'Deposit returned.', 'ok');
        load();
      } catch (err) { toast(err.message, 'bad'); }
    });

    await load();
  }

  /* --------------------------------------------------------------- cards -- */

  async function cards() {
    const tbody = qs('[data-cards]');

    async function load() {
      const data = await api.get('/admin/cards');
      tbody.innerHTML = data.cards.length ? data.cards.map((card) => `
        <tr>
          <td class="rf-mono">${esc(card.masked)}<span class="sub">${esc(card.brand)}</span></td>
          <td>${card.customer ? `<button class="rf-btn link sm" data-customer="${esc(card.customer.id)}">${esc(card.customer.fullName)}</button>` : '&mdash;'}</td>
          <td class="rf-small">${esc(card.kind)}</td>
          <td class="rf-small">${esc(card.expires)}</td>
          <td class="num">${money(card.dailyPurchaseLimit)}</td>
          <td>${badge(card.status)}</td>
          <td class="rf-right rf-nowrap">
            <button class="rf-btn ghost sm" data-card="${esc(card.id)}" data-action="${card.status === 'active' ? 'frozen' : 'active'}">${card.status === 'active' ? 'Freeze' : 'Activate'}</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="7" class="rf-center rf-muted">No cards issued.</td></tr>';
    }

    tbody.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-card]');
      if (!button) return;
      try {
        await api.patch(`/admin/cards/${button.getAttribute('data-card')}`, { status: button.getAttribute('data-action') });
        toast('Card updated.', 'ok');
        load();
      } catch (err) { toast(err.message, 'bad'); }
    });

    await load();
  }

  /* ------------------------------------------------------------ messages -- */

  async function messages() {
    const list = qs('[data-threads]');
    const body = qs('[data-thread]');
    let threads = [];
    let current = null;

    async function load() {
      const data = await api.get('/admin/messages');
      threads = data.threads;
      list.innerHTML = threads.length ? threads.map((thread) => `
        <li class="clickable" data-thread="${esc(thread.id)}">
          <span class="t">
            <strong>${esc(thread.subject)}</strong>
            <span>${esc((thread.customer && thread.customer.fullName) || '')} &middot; ${ago(thread.updatedAt)}</span>
          </span>
          ${thread.awaitingReply ? badge('pending', 'Needs a reply') : ''}
        </li>`).join('') : '<li class="rf-muted rf-small">No conversations.</li>';
    }

    function render(thread) {
      current = thread.id;
      qs('[data-thread-subject]').textContent = `${thread.subject} — ${(thread.customer && thread.customer.fullName) || ''}`;
      body.innerHTML = thread.messages.map((m) => `
        <div style="margin-bottom:14px;padding:12px 14px;border-radius:12px;background:${m.from === 'bank' ? 'var(--rf-surface-3)' : 'var(--rf-info-soft)'}">
          <div class="rf-spread rf-small rf-muted"><strong>${esc(m.authorName || m.from)}</strong><span>${datetime(m.createdAt)}</span></div>
          <div style="margin-top:6px;white-space:pre-wrap">${esc(m.body)}</div>
        </div>`).join('');
    }

    list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-thread]');
      if (!row) return;
      const thread = threads.find((t) => t.id === row.getAttribute('data-thread'));
      if (thread) render(thread);
    });

    onSubmit(qs('#rf-console-reply'), async (values) => {
      if (!current) throw new Error('Choose a conversation first.');
      await api.post(`/admin/messages/${current}/reply`, values);
      qs('#rf-console-reply').reset();
      toast('Reply sent and the customer notified.', 'ok');
      await load();
      const thread = threads.find((t) => t.id === current);
      if (thread) render(thread);
    });

    await load();
    if (threads.length) render(threads[0]);
  }

  /* -------------------------------------------------------------- alerts -- */

  async function alerts() {
    const tbody = qs('[data-alerts]');
    const statusSelect = qs('[data-alert-status]');
    if (!state.meta) state.meta = await api.get('/admin/settings');

    const mailBox = qs('[data-mail-status]');
    if (!state.meta.emailConfigured) {
      mailBox.innerHTML = '<div><strong>No mail provider configured</strong>Alerts are stored and shown in the customer’s notification centre, but nothing leaves the server. Set RESEND_API_KEY to send them.</div>';
      mailBox.className = 'rf-notice warn';
      mailBox.classList.remove('rf-hide');
    }

    const customerSelect = qs('#al-customer');
    const list = await api.get('/admin/customers?limit=200&role=customer');
    customerSelect.innerHTML = list.customers.map((c) => `<option value="${esc(c.id)}">${esc(c.fullName)} — ${esc(c.email)}</option>`).join('');

    const audience = qs('#al-audience');
    const applyAudience = () => { qs('[data-one-field]').hidden = audience.value !== 'one'; };
    audience.addEventListener('change', applyAudience);
    applyAudience();

    async function load() {
      const status = statusSelect.value;
      const data = await api.get(`/admin/alerts?limit=100${status ? `&status=${encodeURIComponent(status)}` : ''}`);
      tbody.innerHTML = data.alerts.length ? data.alerts.map((a) => `
        <tr>
          <td class="rf-nowrap rf-small">${datetime(a.createdAt)}</td>
          <td>${a.customer ? `<button class="rf-btn link sm" data-customer="${esc(a.customer.id)}">${esc(a.customer.fullName)}</button>` : '&mdash;'}</td>
          <td>${esc(a.subject)}<span class="sub">${esc(a.preview || '')}</span></td>
          <td class="rf-small">${esc(a.type)}</td>
          <td>${badge(a.status)}${a.error ? `<span class="sub">${esc(a.error)}</span>` : ''}</td>
          <td class="rf-small rf-muted">${a.readAt ? ago(a.readAt) : 'unread'}</td>
        </tr>`).join('') : '<tr><td colspan="6" class="rf-center rf-muted">No alerts yet.</td></tr>';
    }

    statusSelect.addEventListener('change', load);

    onSubmit(qs('#rf-alert-form'), async (values) => {
      const res = await api.post('/admin/alerts', values);
      qs('#rf-alert-form').reset();
      applyAudience();
      toast(`Sent to ${res.sent} customer(s): ${res.delivered} delivered, ${res.queued} queued.`, 'ok');
      load();
    });

    await load();
  }

  /* ------------------------------------------------------------ disputes -- */

  async function disputes() {
    const tbody = qs('[data-disputes]');

    async function load() {
      const data = await api.get('/admin/disputes');
      tbody.innerHTML = data.disputes.length ? data.disputes.map((d) => `
        <tr>
          <td class="rf-nowrap rf-small">${date(d.createdAt)}</td>
          <td>${d.customer ? `<button class="rf-btn link sm" data-customer="${esc(d.customer.id)}">${esc(d.customer.fullName)}</button>` : '&mdash;'}</td>
          <td class="rf-mono rf-small">${esc(d.reference)}</td>
          <td class="rf-small">${esc(d.reason)}<span class="sub">${esc(d.detail || '')}</span></td>
          <td class="num rf-amt">${money(d.amount)}</td>
          <td>${badge(d.status)}</td>
          <td class="rf-right rf-nowrap">
            ${d.status === 'open' || d.status === 'provisional_credit' ? `
              <button class="rf-btn sm" data-dispute="${esc(d.id)}" data-outcome="upheld">Credit</button>
              <button class="rf-btn ghost sm" data-dispute="${esc(d.id)}" data-outcome="provisional">Provisional</button>
              <button class="rf-btn ghost sm" data-dispute="${esc(d.id)}" data-outcome="declined">Decline</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="7" class="rf-center rf-muted">No claims.</td></tr>';
    }

    tbody.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-dispute]');
      if (!button) return;
      const outcome = button.getAttribute('data-outcome');
      const note = prompt('What should the customer be told?');
      if (note == null) return;
      try {
        await api.post(`/admin/disputes/${button.getAttribute('data-dispute')}/resolve`, { outcome, note });
        toast('Claim updated and the customer emailed.', 'ok');
        load();
      } catch (err) { toast(err.message, 'bad'); }
    });

    await load();
  }

  /* ------------------------------------------------------------ activity -- */

  async function activity() {
    const form = qs('[data-activity-filters]');
    const tbody = qs('[data-activity]');
    const limit = 100;

    async function load() {
      const params = new URLSearchParams(RF.formData(form));
      params.set('limit', String(limit));
      params.set('offset', String(state.activityOffset));
      const data = await api.get(`/admin/activity?${params.toString()}`);
      tbody.innerHTML = data.activity.length ? data.activity.map((row) => `
        <tr>
          <td class="rf-nowrap rf-small">${datetime(row.createdAt)}</td>
          <td class="rf-mono rf-small">${esc(row.action)}</td>
          <td class="rf-small">${esc(row.actorEmail || 'system')}<span class="sub">${esc(row.actorRole)}</span></td>
          <td>${esc(row.detail || '')}</td>
          <td>${badge(row.severity === 'info' ? 'info' : row.severity)}</td>
          <td class="rf-mono rf-small">${esc(row.ip || '')}</td>
          <td class="rf-small">${esc(row.device || '')}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="rf-center rf-muted">Nothing matches.</td></tr>';

      qs('[data-activity-count]').textContent = `${data.total} entries`;
      qs('[data-activity-range]').textContent = data.total
        ? `Showing ${state.activityOffset + 1} to ${Math.min(state.activityOffset + limit, data.total)} of ${data.total}`
        : '';
      qs('[data-activity-prev]').disabled = state.activityOffset === 0;
      qs('[data-activity-next]').disabled = state.activityOffset + limit >= data.total;
    }

    form.addEventListener('submit', (event) => { event.preventDefault(); state.activityOffset = 0; load(); });
    qs('[data-activity-prev]').addEventListener('click', () => { state.activityOffset = Math.max(0, state.activityOffset - limit); load(); });
    qs('[data-activity-next]').addEventListener('click', () => { state.activityOffset += limit; load(); });
    await load();
  }

  /* ------------------------------------------------------------ settings -- */

  async function settings() {
    const data = await api.get('/admin/settings');
    state.meta = data;
    state.settings = data.settings;
    const s = data.settings;
    const form = qs('#rf-settings-form');

    const set = (name, value) => {
      const el = qs(`[name="${name}"]`, form);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = Boolean(value);
      else el.value = value == null ? '' : value;
    };

    set('bankName', s.bankName);
    set('routingNumber', s.routingNumber);
    set('supportEmail', s.supportEmail);
    set('supportPhone', s.supportPhone);
    set('fraudPhone', s.fraudPhone);
    set('internationalPhone', s.internationalPhone);
    set('supportHours', s.supportHours);
    set('mailingAddress', s.mailingAddress);
    set('announcement', s.announcement);
    set('announcementLevel', s.announcementLevel);
    set('sessionMinutes', s.sessionMinutes);
    set('requireOtpForTransfers', s.requireOtpForTransfers);
    set('requirePinForTransfers', s.requirePinForTransfers);
    set('holdTransfersForReview', s.holdTransfersForReview);
    set('maintenanceMode', s.maintenanceMode);
    set('holdThresholdCents', (s.holdThresholdCents / 100).toFixed(2));

    const LIMIT_LABELS = {
      internalDaily: 'Between own accounts', achDaily: 'ACH', wireDaily: 'Wires',
      instantDaily: 'Instant sends', memberDaily: 'To other Hedgestone customers', billPayDaily: 'Bill pay', mobileDepositDaily: 'Mobile deposits',
      atmDaily: 'ATM', cardDaily: 'Card purchases', singleTransactionMax: 'Any single transfer',
    };
    qs('[data-limits]').innerHTML = Object.entries(s.limits).map(([key, value]) => `
      <div class="rf-field">
        <label for="lim-${key}">${esc(LIMIT_LABELS[key] || key)}</label>
        <input class="rf-input" id="lim-${key}" data-limit="${key}" inputmode="decimal" value="${(value / 100).toFixed(2)}" />
      </div>`).join('');

    const FEE_LABELS = {
      achOutgoing: 'Outgoing ACH', wireDomestic: 'Domestic wire', wireInternational: 'International wire',
      expeditedTransfer: 'Expedited transfer', overdraft: 'Overdraft item', returnedItem: 'Returned item',
      stopPayment: 'Stop payment', outOfNetworkAtm: 'Out-of-network ATM', foreignTransactionPct: 'Foreign transaction %',
      paperStatement: 'Paper statement', cardReplacement: 'Card replacement', expeditedCardReplacement: 'Expedited card',
    };
    qs('[data-fees]').innerHTML = Object.entries(s.fees).map(([key, value]) => `
      <div class="rf-field">
        <label for="fee-${key}">${esc(FEE_LABELS[key] || key)}</label>
        <input class="rf-input" id="fee-${key}" data-fee="${key}" inputmode="decimal" value="${key === 'foreignTransactionPct' ? value : (value / 100).toFixed(2)}" />
      </div>`).join('');

    qs('[data-mail-configured]').textContent = data.emailConfigured
      ? 'Email is configured: alerts are delivered.'
      : 'No mail provider configured: alerts show in online banking but are not emailed.';

    onSubmit(form, async (values) => {
      const limits = {};
      qsa('[data-limit]', form).forEach((el) => { limits[el.getAttribute('data-limit')] = Math.round(Number(el.value || 0) * 100); });
      const fees = {};
      qsa('[data-fee]', form).forEach((el) => {
        const key = el.getAttribute('data-fee');
        fees[key] = key === 'foreignTransactionPct' ? Number(el.value || 0) : Math.round(Number(el.value || 0) * 100);
      });
      await api.put('/admin/settings', {
        bankName: values.bankName,
        routingNumber: values.routingNumber,
        supportEmail: values.supportEmail,
        // Trimmed, and sent even when empty: clearing a field at the console
        // has to be able to take the detail back off the site.
        supportPhone: (values.supportPhone || '').trim(),
        fraudPhone: (values.fraudPhone || '').trim(),
        internationalPhone: (values.internationalPhone || '').trim(),
        supportHours: (values.supportHours || '').trim(),
        mailingAddress: (values.mailingAddress || '').trim(),
        announcement: values.announcement || '',
        announcementLevel: values.announcementLevel,
        sessionMinutes: Number(values.sessionMinutes) || 30,
        requireOtpForTransfers: Boolean(values.requireOtpForTransfers),
        requirePinForTransfers: Boolean(values.requirePinForTransfers),
        holdTransfersForReview: Boolean(values.holdTransfersForReview),
        maintenanceMode: Boolean(values.maintenanceMode),
        holdThresholdCents: Math.round(Number(values.holdThresholdCents || 0) * 100),
        limits,
        fees,
      });
      if (window.HSName) window.HSName.apply(values.bankName);
      toast('Settings saved. Every page shows them from the next one opened.', 'ok');
    });
  }

  /* --------------------------------------------------------- investments -- */

  async function investments() {
    const data = await api.get('/admin/investments');
    const t = data.totals;
    const gain = t.value - t.cost;
    qs('[data-inv-stats]').innerHTML = [
      ['Invested by customers', money(t.value), 'at live prices'],
      ['Paid in', money(t.cost), 'cost of the units held'],
      ['Unrealised gain / loss', `${gain >= 0 ? '+' : '-'}${money(Math.abs(gain))}`, t.cost ? `${Math.abs(gain / t.cost) < 0.00005 ? '0.00' : ((gain / t.cost) * 100).toFixed(2)}%` : '&nbsp;'],
      ['Investors', String(t.investors), `${t.trades24h} trade${t.trades24h === 1 ? '' : 's'} in 24 hours`],
    ].map(([k, v, d]) => `<div class="rf-card rf-stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="d">${d}</div></div>`).join('');

    qs('[data-inv-holdings]').innerHTML = data.holdings.length ? data.holdings.map((h) => `
      <tr class="clickable" data-customer="${esc(h.customer.id)}">
        <td><strong>${esc(h.customer.fullName)}</strong><span class="sub">${esc(h.customer.email)}</span></td>
        <td><strong>${esc(h.name)}</strong><span class="sub">${esc(h.symbol)}</span></td>
        <td class="num rf-mono">${esc(h.units)}</td>
        <td class="num opt">${money(h.cost)}</td>
        <td class="num"><strong>${h.value == null ? '&mdash;' : money(h.value)}</strong></td>
        <td class="num rf-amt ${h.gain >= 0 ? 'credit' : 'debit'}">${h.gain == null ? '&mdash;' : `${h.gain >= 0 ? '+' : '-'}${money(Math.abs(h.gain))}`}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="rf-center rf-muted">No customer holds an asset yet.</td></tr>';

    qs('[data-inv-assets]').innerHTML = data.byAsset.length ? data.byAsset.map((a) => `<li>
      <span class="t"><strong>${esc(a.name)}</strong><span>${esc(a.symbol)} &middot; ${a.holders} holder${a.holders === 1 ? '' : 's'}</span></span>
      <strong>${money(a.value)}</strong>
    </li>`).join('') : '<li class="rf-muted rf-small">Nothing held yet.</li>';

    qs('[data-inv-trades]').innerHTML = data.trades.length ? data.trades.slice(0, 12).map((tr) => `<li class="clickable" data-customer="${esc(tr.customer.id)}">
      <span class="t"><strong>${tr.side === 'buy' ? 'Bought' : 'Sold'} ${esc(tr.units)} ${esc(tr.symbol)}</strong><span>${esc(tr.customer.fullName)} &middot; ${ago(tr.createdAt)} &middot; @ ${money(tr.price)}</span></span>
      <span class="rf-amt ${tr.side === 'buy' ? 'debit' : 'credit'}">${money(tr.amount)}</span>
    </li>`).join('') : '<li class="rf-muted rf-small">No conversions yet.</li>';
  }

  /* --------------------------------------------------------------- setup -- */

  async function setup() {
    const list = qs('[data-setup-list]');
    const data = await api.get('/admin/setup');
    const counted = data.items.filter((i) => i.status !== 'optional');
    const done = counted.filter((i) => i.status === 'done').length;
    const pct = counted.length ? Math.round((done / counted.length) * 100) : 0;
    qs('[data-setup-score]').textContent = `${done} of ${counted.length} done`;
    qs('[data-setup-sub]').textContent = done === counted.length ? 'The backend is fully set up.' : `${counted.length - done} to do before real customers.`;
    qs('[data-setup-bar]').style.width = `${pct}%`;
    const label = { done: 'Done', todo: 'To do', blocked: 'Waiting', optional: 'Optional' };
    const groups = Array.from(new Set(data.items.map((i) => i.group)));
    list.innerHTML = groups.map((g) => `
      <section class="rf-card rf-mb">
        <div class="rf-card-head"><h3>${esc(g)}</h3></div>
        <ul class="hs-setup-items">
          ${data.items.filter((i) => i.group === g).map((i) => `
          <li class="is-${esc(i.status)}">
            <span class="hs-setup-dot" aria-hidden="true">${i.status === 'done' ? '&#10003;' : i.status === 'optional' ? '&#8226;' : '!'}</span>
            <span class="hs-setup-text">
              <strong>${esc(i.title)}</strong>
              <span>${esc(i.detail)}</span>
              ${i.status !== 'done' && i.fix ? `<span class="hs-setup-fix"><b>How:</b> ${esc(i.fix)}</span>` : ''}
            </span>
            <span class="hs-setup-tag">${label[i.status] || esc(i.status)}</span>
          </li>`).join('')}
        </ul>
      </section>`).join('');
    qsa('[data-staff-pip="setup"]').forEach((pip) => { const left = data.counts.todo || 0; pip.textContent = String(left || ''); pip.classList.toggle('rf-hide', !left); });
  }

  /* -------------------------------------------------------------- search -- */

  function wireSearch() {
    const form = qs('[data-staff-search]');
    if (!form) return;
    const input = qs('input', form);
    const box = qs('[data-search-results]', form);
    let timer = null;
    let seq = 0;
    const close = () => { box.hidden = true; };
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) { close(); return; }
      const mine = ++seq;
      try {
        const data = await api.get(`/admin/customers?q=${encodeURIComponent(q)}&limit=8`);
        if (mine !== seq) return;
        box.innerHTML = data.customers.length ? data.customers.map((c) => `
          <button type="button" data-customer="${esc(c.id)}">
            <span class="rf-avatar sm">${esc(c.initials)}</span>
            <span><strong>${esc(c.fullName)}</strong><small>${esc(c.email)} &middot; ${esc(c.customerNumber || '')}</small></span>
          </button>`).join('') : '<p class="rf-muted rf-small">No customer matches that.</p>';
        box.hidden = false;
      } catch (err) { close(); }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 220); });
    input.addEventListener('focus', () => { if (box.innerHTML && input.value.trim().length >= 2) box.hidden = false; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const first = qs('[data-customer]', box);
      if (first) first.click();
    });
    document.addEventListener('click', (e) => { if (!form.contains(e.target)) close(); });
    box.addEventListener('click', (e) => { if (e.target.closest('[data-customer]')) { close(); input.value = ''; } });
  }

  /* -------------------------------------------------------------- wiring -- */

  const TABS = { overview, customers, register, queue, deposits, cards, messages, alerts, disputes, activity, settings, investments, setup };

  // Any [data-customer] in a table or list opens the customer sheet. Elements
  // inside a modal are excluded: a modal's own controls must keep their normal
  // behaviour, and preventDefault() here would cancel a form submission.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-customer]');
    if (!button || button.closest('.rf-modal-backdrop')) return;
    event.preventDefault();
    openCustomer(button.getAttribute('data-customer')).catch((err) => toast(err.message, 'bad'));
  });

  // Any link or tile that names a section opens it in place.
  document.addEventListener('click', async (event) => {
    const link = event.target.closest('[data-tab], [data-goto-tab]');
    if (!link) return;
    event.preventDefault();
    // A tile can carry a filter: "customers?kyc=pending" opens the list already narrowed.
    const [name, query] = String(link.getAttribute('data-tab') || link.getAttribute('data-goto-tab')).split('?');
    const form = name === 'customers' && query ? qs('[data-customer-filters]') : null;
    // Set the filter first, so a first visit loads the narrowed list rather
    // than racing an unfiltered one; on a later visit, re-run the search.
    const wasLoaded = loaded.has(name);
    if (form) new URLSearchParams(query).forEach((value, key) => { if (form.elements[key]) form.elements[key].value = value; });
    showTab(name);
    if (form && wasLoaded) form.dispatchEvent(new Event('submit', { cancelable: true }));
  });
  window.addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (TABS[name]) showTab(name);
  });

  RF.ready(async () => {
    wireSearch();
    const refresh = qs('[data-setup-refresh]');
    if (refresh) refresh.addEventListener('click', () => setup().catch((err) => toast(err.message, 'bad')));
    const initial = (location.hash || '#overview').slice(1);
    showTab(TABS[initial] ? initial : 'overview');
  });
}());
