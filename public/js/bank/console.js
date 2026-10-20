'use strict';

/**
 * The staff console.
 *
 * Each tab loads when it is first opened and refreshes on demand rather than
 * on a timer: a console that re-renders under a cursor is how the wrong
 * request gets approved.
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
  const acting = { customerId: null, transferId: null };

  /* ------------------------------------------------------------- vaults -- */

  const KIND_LABEL = { cash: 'Paid in cash', bitcoin: 'Received', sent: 'Sent', converted: 'Converted to', bought: 'Bought', sold: 'Sold' };
  const btc = (units) => `${esc(String(units))} BTC`;
  const termText = (months) => (months == null ? '' : months % 12 === 0 ? `${months / 12}-year term` : `${months}-month term`);
  const isNeed = (r) => r.kind === 'need_otc' || r.kind === 'need_address';
  const requestAmount = (r) => (isNeed(r) ? '&mdash;' : r.kind === 'cash_in' ? money(r.amount) : btc(r.units));
  const requestDetail = (r) => (isNeed(r) ? (r.note ? `"${r.note}"` : 'details for this customer')
    : r.kind === 'btc_out'
      ? `to ${r.address}`
      : `${r.kind === 'cash_in' ? 'paid' : 'sent'} ${date(r.occurredAt)}${r.termMonths ? `, ${termText(r.termMonths)}` : ''}`);
  const OTC_LABELS = [
    ['accountName', 'Pay (account name)'], ['accountNumber', 'Account number'], ['routingNumber', 'Routing or sort code'],
    ['swift', 'SWIFT / BIC'], ['bankName', 'Held at (bank)'], ['name', 'OTC partner'],
  ];
  const otcFields = (o) => `<div class="rf-row">
      ${OTC_LABELS.map(([f, label]) => `<div class="rf-field"><label>${esc(label)}</label><input class="rf-input${/Number|swift/.test(f) ? ' mono' : ''}" name="otc.${f}" value="${esc((o && o[f]) || '')}" /></div>`).join('')}
    </div>
    <div class="rf-field"><label>Instructions</label><input class="rf-input" name="otc.instructions" value="${esc((o && o.instructions) || '')}" placeholder="Quote your reference with the payment" /></div>`;
  const otcFrom = (values) => {
    const o = {};
    ['name', 'bankName', 'accountName', 'accountNumber', 'routingNumber', 'swift', 'instructions'].forEach((f) => { o[f] = values[`otc.${f}`] || ''; });
    return o;
  };
  const otcSummary = (o) => (o ? `${esc(o.accountName)} &middot; <span class="rf-mono">${esc(o.accountNumber)}</span>${o.routingNumber ? ` &middot; <span class="rf-mono">${esc(o.routingNumber)}</span>` : ''}${o.bankName ? ` &middot; ${esc(o.bankName)}` : ''}` : 'none');
  const FROM = { customer: 'set for this customer', platform: 'the platform&rsquo;s, from Settings' };

  /* ---------------------------------------------------------------- tabs -- */

  const TITLES = {
    overview: ['Today', 'What needs a decision, and how the platform stands.'],
    queue: ['Requests', 'Bitcoin to receive into vaults and to send out of them.'],
    messages: ['Messages', 'Secure messages from customers.'],
    customers: ['Customers', 'Search, open and act on any customer.'],
    register: ['Register a customer', 'Open a customer and their vault.'],
    investments: ['Vaults', 'What customers hold, valued at the live price.'],
    alerts: ['Email alerts', 'Everything we have sent, and to whom.'],
    activity: ['Activity log', 'Every action, by customers and staff.'],
    settings: ['Settings', 'Vault addresses, the OTC partner, terms, contact details and switches.'],
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
      ['Customers', String(s.customers), `${esc(String(s.newCustomers30d))} joined in 30 days &middot; ${s.suspended} suspended`],
      ['Requests done', String(s.requestsDone30d), 'in the last 30 days'],
    ].map(([k, v, d]) => `<div class="rf-card rf-stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="d">${d}</div></div>`).join('');

    // What needs a person, first and largest. Each tile opens its section.
    const attention = [
      ['queue', 'Requests to confirm', s.pendingRequests + s.pendingTransfers, `${s.pendingReceives} to receive, ${s.pendingSends} to send${s.pendingTransfers ? `, ${s.pendingTransfers} older withdrawal${s.pendingTransfers === 1 ? '' : 's'}` : ''}`],
      ['customers?kyc=pending', 'Identity checks', s.pendingKyc, 'customers to verify'],
      ['messages', 'Unanswered messages', s.unansweredMessages, 'from customers'],
    ];
    qs('[data-attention]').innerHTML = attention.map(([tab, label, n, d]) => `
      <a class="hs-attn-tile${n ? ' is-hot' : ''}" href="#${tab.split('?')[0]}" data-goto-tab="${tab}">
        <span class="n">${esc(String(n || 0))}</span>
        <span class="l"><strong>${esc(label)}</strong><small>${n ? esc(d) : 'All clear'}</small></span>
        <span class="go" aria-hidden="true">&rarr;</span>
      </a>`).join('');

    const pips = { queue: s.pendingRequests + s.pendingTransfers, messages: s.unansweredMessages };
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
      host.insertAdjacentHTML('beforeend', `<a class="rf-card rf-stat hs-stat-link" href="#investments" data-goto-tab="investments" data-stat-invested><div class="k">Bitcoin in vaults</div><div class="v">${money(inv.totals.value)}</div><div class="d">${inv.totals.investors} investor${inv.totals.investors === 1 ? '' : 's'} &middot; ${inv.totals.trades24h} trade${inv.totals.trades24h === 1 ? '' : 's'} today</div></a>`);
    }).catch(() => {});
    api.get('/admin/setup').then((setupData) => {
      const left = setupData.counts.todo || 0;
      qsa('[data-staff-pip="setup"]').forEach((pip) => { pip.textContent = String(left || ''); pip.classList.toggle('rf-hide', !left); });
      const banner = qs('[data-setup-banner]');
      if (banner && left) {
        banner.innerHTML = `<span><strong>${left} setup item${left === 1 ? '' : 's'} left</strong> before this platform is ready for real customers.</span><a class="rf-btn sm" href="#setup" data-goto-tab="setup">Open the checklist</a>`;
        banner.classList.remove('rf-hide');
      }
    }).catch(() => {});

    qs('[data-queue-preview]').innerHTML = data.queue.length ? data.queue.map((r) => `
      <tr>
        <td>${esc((r.customer && r.customer.fullName) || '')}</td>
        <td class="rf-small">${esc(r.label)}</td>
        <td class="rf-small">${esc(requestDetail(r))}</td>
        <td class="num rf-amt">${requestAmount(r)}</td>
        <td class="rf-small rf-muted">${ago(r.createdAt)}</td>
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
          <td class="num rf-mono">${c.btcUnits && Number(c.btcUnits) ? btc(c.btcUnits) : '&mdash;'}</td>
          <td class="num rf-amt">${money(c.invested || 0)}</td>
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
      ${data.suspension ? `<div class="rf-notice bad rf-mb"><strong>Suspended${data.suspension.since ? ` since ${date(data.suspension.since)}` : ''}.</strong> ${data.suspension.reason ? `They see the reason: &ldquo;${esc(data.suspension.reason)}&rdquo;` : 'No reason was given.'} They can sign in and look, and message us; nothing can be received, sent or changed until you reactivate them.</div>` : ''}

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
          <h4 class="rf-label">Vault</h4>
          <ul class="rf-list" data-sheet-investments><li class="rf-muted rf-small">Loading&hellip;</li></ul>
        </div>
      </div>

      <h4 class="rf-label rf-mt">Payment details shown to this customer</h4>
      <div data-sheet-details><p class="rf-muted rf-small">Loading&hellip;</p></div>

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
          <h4 class="rf-label">Requests</h4>
          <ul class="rf-list">
            ${(data.requests || []).slice(0, 8).map((r) => `<li>
              <span class="t"><strong>${esc(r.label)}: ${requestAmount(r)}</strong><span>${esc(requestDetail(r))} &middot; ${esc(r.reference)}</span></span>
              ${badge(r.status)}
            </li>`).join('') || '<li class="rf-muted rf-small">None yet.</li>'}
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
        <button class="rf-btn danger sm" data-customer-action="delete" data-id="${esc(c.id)}">Delete customer</button>
      </div>`;

    const paintInvestments = () => api.get(`/admin/customers/${id}/investments`).then((inv) => {
      const list = qs('[data-sheet-investments]', customerModal);
      if (!list) return;
      const holdings = inv.holdings.length ? inv.holdings.map((h) => `<li>
        <span class="t"><strong>${btc(h.units)}</strong><span>invested ${money(h.costBasis)} &middot; ${btc(inv.bitcoin.ready)} matured</span></span>
        <span class="rf-nowrap"><strong>${h.value == null ? '&mdash;' : money(h.value)}</strong></span>
      </li>`).join('') : '<li class="rf-muted rf-small">Nothing in the vault yet.</li>';
      const positions = (inv.positions || []).map((p) => `<li>
        <span class="t"><strong>${btc(p.units)} added ${date(p.purchasedAt)}</strong><span>${money(p.cost)} at ${money(p.price)} &middot; ${termText(p.termMonths)} &middot; ${p.matured ? 'matured' : `matures ${date(p.maturesAt)}`}</span></span>
        <span class="rf-nowrap">${p.value == null ? '&mdash;' : money(p.value)}</span>
      </li>`).join('');
      const trades = inv.trades.slice(0, 8).map((t) => `<li class="${t.status === 'reversed' ? 'is-reversed' : ''}">
        <span class="t"><strong>${esc(KIND_LABEL[t.kind] || t.kind)} ${btc(t.units)} @ ${money(t.price)}</strong><span>${datetime(t.createdAt)} &middot; ${money(t.amount)}${t.side === 'buy' && t.termMonths ? ` &middot; ${termText(t.termMonths)}` : ''}${t.bookedByStaff ? ' &middot; by staff' : ''}${t.status === 'reversed' ? ' &middot; <b>reversed</b>' : ''}${t.note ? ` &middot; ${esc(t.note)}` : ''}</span></span>
        ${t.status === 'reversed' ? '' : `<span class="rf-nowrap"><button class="rf-btn link sm" data-trade-time="${esc(t.id)}" data-trade-at="${esc(t.createdAt)}" data-trade-side="${esc(t.side)}" data-trade-term="${esc(t.termMonths && t.termMonths % 12 === 0 ? t.termMonths / 12 : '')}" data-trade-kind="${esc(t.kind)}" data-trade-amount="${esc((Number(t.amount || 0) / 100).toFixed(2))}" data-trade-units="${esc(t.units)}" data-trade-fixed="${t.converted || t.transactionId ? '1' : ''}">${t.side === 'buy' && !t.converted && !t.transactionId ? 'Edit amount, date or term' : 'Change date or term'}</button>${t.converted || t.transactionId ? '' : ` <button class="rf-btn link sm" data-trade-reverse="${esc(t.id)}" data-trade-label="${esc(`${KIND_LABEL[t.kind] || t.kind} ${t.units} BTC (${money(t.amount)})`)}">Reverse</button>`}</span>`}
      </li>`).join('');
      list.innerHTML = `${holdings}
        ${positions ? `<li class="rf-label" style="border:0;padding-bottom:0">What is in it, and when each part matures</li>${positions}` : ''}
        <li class="hs-sheet-actions"><button class="rf-btn sm" data-book-trade>Add to this vault</button><span class="rf-small rf-muted">Cash paid to the OTC partner or Bitcoin received, dated when it happened.</span></li>
        ${trades ? `<li class="rf-label" style="border:0;padding-bottom:0">Everything that moved</li>${trades}` : ''}`;
    }).catch(() => {
      const list = qs('[data-sheet-investments]', customerModal);
      if (list) list.innerHTML = '<li class="rf-muted rf-small">Could not load their vault.</li>';
    });
    paintInvestments();
    acting.paintInvestments = paintInvestments;
    paintDetails(id);
    acting.customerData = data;

    wireCustomerSheet(c, data);
  }

  /* Where this customer pays cash and sends Bitcoin: their own details, else the platform's. */
  async function paintDetails(id) {
    const host = qs('[data-sheet-details]', customerModal);
    if (!host) return;
    let d;
    try { d = await api.get(`/admin/customers/${id}/vault-details`); } catch (err) { host.innerHTML = `<p class="rf-muted rf-small">${esc(err.message)}</p>`; return; }
    host.innerHTML = `<ul class="rf-list">
        <li><span class="t"><strong>Vault address</strong><span>${d.shown.address ? `<span class="rf-mono" style="word-break:break-all">${esc(d.shown.address.address)}</span> &middot; ${FROM[d.shown.addressFrom]}` : 'None: they see a button to ask for one'}</span></span></li>
        <li><span class="t"><strong>Cash payment details</strong><span>${d.shown.otc ? `${otcSummary(d.shown.otc)} &middot; ${FROM[d.shown.otcFrom]}` : 'None: they see a button to ask for them'}</span></span></li>
        <li class="hs-sheet-actions"><button class="rf-btn sm" data-edit-details>Set details for this customer</button><span class="rf-small rf-muted">Payment reference ${esc(d.paymentReference)}${d.own.updatedBy ? ` &middot; last set by ${esc(d.own.updatedBy)} ${ago(d.own.updatedAt)}` : ''}</span></li>
      </ul>`;
    qs('[data-edit-details]', host).addEventListener('click', () => {
      const { form, close } = staffSheet('Payment details for this customer', `
        <p class="rf-small rf-muted">Only for this customer. Leave a part blank to use the platform&rsquo;s from Settings${d.platform.address || d.platform.otc ? '' : ' (none set yet)'}.</p>
        <h4 class="rf-label">Vault address</h4>
        <div class="rf-row">
          <div class="rf-field"><label>Address</label><input class="rf-input mono" name="address" value="${esc(d.own.address)}" placeholder="${esc(d.platform.address ? d.platform.address.address : 'bc1...')}" /></div>
          <div class="rf-field"><label>Label (optional)</label><input class="rf-input" name="addressLabel" value="${esc(d.own.addressLabel)}" /></div>
        </div>
        <h4 class="rf-label rf-mt">Cash payment details (OTC)</h4>
        ${otcFields(d.own.otc)}`, 'Save details');
      onSubmit(form, async (values) => {
        // Blank fields are left out of values, so blank is sent as '' to clear them.
        await api.put(`/admin/customers/${id}/vault-details`, { address: values.address || '', addressLabel: values.addressLabel || '', otc: otcFrom(values) });
        close();
        toast('Saved. This is what the customer now sees on Receive.', 'ok');
        paintDetails(id);
      });
    });
  }

  function wireCustomerSheet(customer, data) {
    const root = customerModal;

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
          const reason = prompt('Why is this account being suspended? The customer sees this on every page while it lasts. They can still sign in and look, but not receive, send or change anything.');
          if (reason == null) return;
          await api.post(`/admin/customers/${id}/status`, { status: 'suspended', reason });
          toast('Suspended. The customer sees the reason when they next sign in.', 'ok');
        } else if (action === 'activate') {
          await api.post(`/admin/customers/${id}/status`, { status: 'active' });
          toast('Account reactivated.', 'ok');
        } else if (action === 'edit') {
          editCustomer(customer);
          return;
        } else if (action === 'delete') {
          deleteCustomer(customer);
          return;
        }
        openCustomer(id);
      } catch (err) { toast(err.message, 'bad'); }
    }));
  }

  /** Delete a customer and everything that is theirs. Suspend is the reversible choice. */
  function deleteCustomer(customer) {
    const { el, form, close } = staffSheet(`Delete ${customer.fullName}`, `
      <div class="rf-notice bad">This cannot be undone. Their login, vault, every movement, request, message and document are erased. The activity log keeps a record that you deleted them.</div>
      <p class="rf-small rf-muted rf-mt">To stop them signing in but keep everything, close this and press <b>Suspend</b> instead.</p>
      <div class="rf-field"><label>Type their email address to confirm</label><input class="rf-input" name="confirm" autocomplete="off" placeholder="${esc(customer.email)}" /></div>`, 'Delete for good');
    qs('[data-submit]', el).classList.add('danger');
    onSubmit(form, async (values) => {
      await api.del(`/admin/customers/${customer.id}`, { confirm: values.confirm || '' });
      close();
      RF.modal.close(customerModal);
      toast(`${customer.fullName} has been deleted.`, 'ok');
      ['customers', 'overview', 'queue', 'investments'].forEach((t) => loaded.delete(t));
      const current = (window.location.hash || '').slice(1);
      showTab(TABS[current] ? current : 'customers');
    });
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

  // Nothing in a vault can be dated before Bitcoin had a daily price.
  const EARLIEST = '2011-01-01';
  const TERM = { min: 10, max: 100 };
  const localDate = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const localTime = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
  const whenFields = (iso, hint) => `<div class="rf-row">
      <div class="rf-field"><label>Date</label><input class="rf-input" type="date" name="date" value="${iso ? localDate(iso) : ''}" min="${EARLIEST}" max="${localDate(new Date().toISOString())}" /></div>
      <div class="rf-field"><label>Time</label><input class="rf-input" type="time" name="time" value="${iso ? localTime(iso) : ''}" step="60" /></div>
    </div>${hint ? `<p class="rf-small rf-muted" style="margin-top:-6px">${hint}</p>` : ''}`;

  document.addEventListener('click', async (event) => {
    /* Add to a customer's vault: cash paid to the OTC partner, or Bitcoin received. */
    if (event.target.closest('[data-book-trade]')) {
      event.preventDefault();
      if (!state.meta) { try { state.meta = await api.get('/admin/settings'); } catch (err) { /* default term below */ } }
      const defaultTerm = (state.meta && state.meta.settings.investmentTermYears) || TERM.min;
      const { el, form, close } = staffSheet('Add to this vault', `
        <div class="rf-segment rf-mb" data-side><button type="button" class="is-active" data-side-value="cash">Cash paid to the OTC partner</button><button type="button" data-side-value="bitcoin">Bitcoin received</button></div>
        <input type="hidden" name="kind" value="cash" />
        <div class="rf-row">
          <div class="rf-field" data-cash-only><label>Amount paid</label><input class="rf-input money" name="amount" inputmode="decimal" placeholder="0.00" /></div>
          <div class="rf-field" data-btc-only hidden><label>Bitcoin received</label><input class="rf-input money" name="units" inputmode="decimal" placeholder="0.00000000" /></div>
          <div class="rf-field"><label>Term (years)</label><input class="rf-input" type="number" name="termYears" min="${TERM.min}" max="${TERM.max}" step="1" value="${esc(defaultTerm)}" /></div>
        </div>
        ${whenFields('', `When it was paid or arrived. Leave blank for now. Not before ${EARLIEST}. Booked at Bitcoin's closing price that day.`)}
        <div class="rf-field"><label>Note</label><input class="rf-input" name="note" placeholder="Payment confirmed by the OTC partner" /></div>`, 'Add it');
      const kindInput = qs('[name="kind"]', form);
      qsa('[data-side-value]', el).forEach((b) => b.addEventListener('click', () => {
        qsa('[data-side-value]', el).forEach((x) => x.classList.toggle('is-active', x === b));
        kindInput.value = b.getAttribute('data-side-value');
        qs('[data-cash-only]', form).hidden = kindInput.value !== 'cash';
        qs('[data-btc-only]', form).hidden = kindInput.value !== 'bitcoin';
      }));
      onSubmit(form, async (values) => {
        const body = { customerId: acting.customerId, kind: values.kind, termYears: values.termYears, note: values.note, date: whenOf(values.date, values.time) || undefined };
        if (values.kind === 'bitcoin') body.units = values.units; else body.amount = values.amount;
        const res = await api.post('/admin/trades', body);
        close();
        toast(`Added ${res.trade.units} BTC at ${money(res.trade.price)}, maturing ${date(res.trade.maturesAt)}.`, 'ok');
        openCustomer(acting.customerId);
      });
      return;
    }

    /* Correct something in a vault: how much, when (repriced at that day), or its term. */
    const timeBtn = event.target.closest('[data-trade-time]');
    if (timeBtn) {
      event.preventDefault();
      const isBuy = timeBtn.getAttribute('data-trade-side') === 'buy';
      const kind = timeBtn.getAttribute('data-trade-kind');
      // Cash paid and Bitcoin received can have their amount corrected; a conversion cannot.
      const editable = isBuy && !timeBtn.getAttribute('data-trade-fixed');
      const isBtc = kind === 'bitcoin';
      const amountField = !editable ? '' : isBtc
        ? `<div class="rf-field"><label>Bitcoin received</label><input class="rf-input money" name="units" inputmode="decimal" value="${esc(timeBtn.getAttribute('data-trade-units'))}" /><div class="hint">Its value follows, at that day&rsquo;s price.</div></div>`
        : `<div class="rf-field"><label>Amount paid (USD)</label><input class="rf-input money" name="amount" inputmode="decimal" value="${esc(timeBtn.getAttribute('data-trade-amount'))}" /><div class="hint">The Bitcoin it bought follows, at that day&rsquo;s price.</div></div>`;
      const { form, close } = staffSheet(editable ? 'Edit the amount, date or term' : isBuy ? 'Change the date or term' : 'Change the date', `
        ${amountField}
        ${whenFields(timeBtn.getAttribute('data-trade-at'), isBuy ? `Not before ${EARLIEST}. A new date reprices it at Bitcoin's closing price that day: cash paid buys what it would have bought then; Bitcoin received is valued at that day.` : '')}
        ${isBuy ? `<div class="rf-field"><label>Term (years)</label><input class="rf-input" type="number" name="termYears" min="${TERM.min}" max="${TERM.max}" step="1" value="${esc(timeBtn.getAttribute('data-trade-term'))}" /><div class="hint">${TERM.min} to ${TERM.max} years. It matures on its date plus its term.</div></div>` : ''}
        <div class="rf-field"><label>Reason</label><input class="rf-input" name="note" placeholder="Payment date confirmed by the OTC partner" /></div>`, 'Save');
      onSubmit(form, async (values) => {
        const when = whenOf(values.date, values.time);
        if (!when) throw new Error('Enter a date.');
        const body = { date: when, note: values.note };
        if (isBuy && values.termYears) body.termYears = values.termYears;
        if (editable && isBtc && values.units) body.units = values.units;
        if (editable && !isBtc && values.amount) body.amount = values.amount;
        const res = await api.patch(`/admin/trades/${timeBtn.getAttribute('data-trade-time')}`, body);
        close();
        toast(isBuy ? `Updated: ${res.trade.units} BTC (${money(res.trade.amount)}) at ${money(res.trade.price)}, maturing ${date(res.trade.maturesAt)}.` : 'Re-dated.', 'ok');
        openCustomer(acting.customerId);
      });
      return;
    }

    /* Undo a purchase or sale completely. */
    const revBtn = event.target.closest('[data-trade-reverse]');
    if (revBtn) {
      event.preventDefault();
      const note = prompt(`Reverse this?\n\n${revBtn.getAttribute('data-trade-label')}\n\nWhat came in comes off the vault; what was sent goes back on. Why? (the customer sees this)`);
      if (note == null) return;
      try {
        await api.post(`/admin/trades/${revBtn.getAttribute('data-trade-reverse')}/reverse`, { note });
        toast('Reversed.', 'ok');
        openCustomer(acting.customerId);
      } catch (err) { toast(err.message, 'bad'); }
    }
  });

  /** A date and an optional time, read in the operator's own time zone. */
  function whenOf(dateValue, timeValue) {
    if (!dateValue) return '';
    const d = new Date(`${dateValue}T${timeValue || '12:00'}`);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }

  /* ------------------------------------------------------------ register -- */

  async function register() {

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
      const result = await api.post('/admin/customers', { ...values, ...documents });
      showRegistration(result);
      toast('Customer registered and the welcome email sent.', 'ok');
      qs('#rf-register-form').reset();
      loaded.delete('customers');
      showTab('customers');
    });
  }

  /**
   * What was just created, in something an operator can read out or copy: the
   * customer number, the username, the temporary password and anything put
   * into their vault. A native alert() would block the page and could not be
   * copied from.
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
            ${result.vault ? `<dt>In the vault</dt><dd class="mono">${btc(result.vault.units)} &middot; ${money(result.vault.amount)} at ${money(result.vault.price)} &middot; matures ${date(result.vault.maturesAt)}</dd>` : ''}
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
        result.vault ? `In the vault: ${result.vault.units} BTC (${money(result.vault.amount)}), matures ${date(result.vault.maturesAt)}` : '',
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
      const data = await api.get(`/admin/vault/requests?status=${encodeURIComponent(statusSelect.value)}`);
      tbody.innerHTML = data.requests.length ? data.requests.map((r) => `
        <tr>
          <td class="rf-nowrap rf-small">${date(r.createdAt)}<span class="sub">${new Date(r.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></td>
          <td><button class="rf-btn link sm" data-customer="${esc(r.customer.id)}">${esc(r.customer.fullName)}</button><span class="sub">${esc(r.customer.email)}</span></td>
          <td class="rf-small">${esc(r.label)}<span class="sub rf-mono">${esc(r.reference)}</span></td>
          <td class="rf-small">${isNeed(r)
    ? (r.kind === 'need_otc' ? 'No cash payment details to show them' : 'No vault address to show them')
    : r.kind === 'btc_out'
      ? `<span class="rf-mono">${esc(r.address)}</span><span class="sub">${r.ready != null ? `${btc(r.ready)} matured besides this` : ''}</span>`
      : `${r.kind === 'cash_in' ? 'Paid' : 'Sent'} ${date(r.occurredAt)} &middot; ${esc(termText(r.termMonths))}${r.txid ? `<span class="sub rf-mono">${esc(r.txid.slice(0, 16))}&hellip;</span>` : ''}`}${r.note ? `<span class="sub">&ldquo;${esc(r.note)}&rdquo;</span>` : ''}${r.decisionNote ? `<span class="sub">${esc(r.decisionNote)}</span>` : ''}</td>
          <td>${badge(r.status)}</td>
          <td class="num rf-amt">${requestAmount(r)}</td>
          <td class="rf-right rf-nowrap">
            ${r.status === 'pending' ? `
              <button class="rf-btn sm" data-confirm-request="${esc(r.id)}">${isNeed(r) ? 'Give details' : r.kind === 'btc_out' ? 'Mark sent' : 'Confirm'}</button>
              <button class="rf-btn ghost sm" data-reject-request="${esc(r.id)}">Reject</button>` : ''}
          </td>
        </tr>`).join('') : '<tr><td colspan="7" class="rf-center rf-muted">Nothing here.</td></tr>';
      state.requests = data.requests;
      await loadLegacy();
    }

    /* Withdrawals asked for before the vault: shown only while any wait. */
    async function loadLegacy() {
      const wrap = qs('[data-legacy-wrap]');
      let rows = [];
      try { rows = (await api.get('/admin/transfers?status=pending_review')).transfers; } catch (err) { rows = []; }
      wrap.hidden = !rows.length;
      qs('[data-legacy-queue]').innerHTML = rows.map((t) => `
        <tr>
          <td class="rf-nowrap rf-small">${date(t.createdAt)}</td>
          <td>${t.customer ? `<button class="rf-btn link sm" data-customer="${esc(t.customer.id)}">${esc(t.customer.fullName)}</button>` : '&mdash;'}</td>
          <td class="rf-small">${esc((t.recipient && (t.recipient.nickname || t.recipient.name)) || '&mdash;')}<span class="sub rf-mono">${esc((t.recipient && t.recipient.accountMasked) || '')}</span></td>
          <td class="rf-mono rf-small">${esc(t.confirmation)}</td>
          <td>${badge(t.status, t.statusLabel)}</td>
          <td class="num rf-amt">${money(t.total)}</td>
          <td class="rf-right rf-nowrap">
            <button class="rf-btn sm" data-approve="${esc(t.id)}">Release</button>
            <button class="rf-btn ghost sm" data-reject="${esc(t.id)}" data-summary="${esc(`${money(t.total)} to ${(t.recipient && (t.recipient.nickname || t.recipient.name)) || 'their account'}`)}">Return</button>
          </td>
        </tr>`).join('');
    }

    const panel = qs('[data-panel="queue"]');
    panel.addEventListener('click', async (event) => {
      const confirmBtn = event.target.closest('[data-confirm-request]');
      const rejectBtn = event.target.closest('[data-reject-request]');
      const approve = event.target.closest('[data-approve]');
      const reject = event.target.closest('[data-reject]');
      if (confirmBtn) {
        const r = (state.requests || []).find((x) => x.id === confirmBtn.getAttribute('data-confirm-request'));
        if (r) confirmRequest(r);
      }
      if (rejectBtn) {
        const reason = prompt('Why can this not be done? The customer reads this.');
        if (!reason) return;
        try {
          await api.post(`/admin/vault/requests/${rejectBtn.getAttribute('data-reject-request')}/reject`, { reason });
          toast('Rejected, and the customer told why.', 'ok');
          load();
          loaded.delete('overview');
        } catch (err) { toast(err.message, 'bad'); }
      }
      if (approve) {
        if (!confirm('Release this withdrawal? The money leaves the customer’s cash now.')) return;
        try {
          await api.post(`/admin/transfers/${approve.getAttribute('data-approve')}/approve`, { note: '' });
          toast('Withdrawal released and the customer emailed.', 'ok');
          load();
        } catch (err) { toast(err.message, 'bad'); }
      }
      if (reject) {
        acting.transferId = reject.getAttribute('data-reject');
        qs('[data-reject-summary]', rejectModal).textContent = reject.getAttribute('data-summary');
        qs('#rf-reject-form').reset();
        RF.modal.open(rejectModal);
      }
    });

    /* Give a customer the details they asked for: saved as theirs, shown on their Receive page. */
    async function giveDetails(r) {
      let current = null;
      try { current = await api.get(`/admin/customers/${r.customer.id}/vault-details`); } catch (err) { toast(err.message, 'bad'); return; }
      const address = r.kind === 'need_address';
      const platform = address ? current.platform.address : current.platform.otc;
      const body = `${r.note ? `<p class="rf-small">They wrote: &ldquo;${esc(r.note)}&rdquo;</p>` : ''}
        <p class="rf-small rf-muted">${platform
    ? `The platform&rsquo;s ${address ? 'address' : 'payment details'} from Settings now cover this customer. Leave the fields blank to use them, or enter details just for this customer.`
    : `Enter the ${address ? 'vault address' : 'payment details'} for this customer. They are saved as theirs and shown on their Receive page; they can be changed later from the customer&rsquo;s sheet.`}</p>
        ${address
    ? `<div class="rf-field"><label>Vault address</label><input class="rf-input mono" name="address" value="${esc(current.own.address)}" placeholder="bc1..." /></div>
          <div class="rf-field"><label>Label (optional)</label><input class="rf-input" name="addressLabel" value="${esc(current.own.addressLabel)}" /></div>`
    : otcFields(current.own.otc)}
        <div class="rf-field"><label>Note</label><input class="rf-input" name="note" /></div>
        <p class="rf-small rf-muted">The customer is emailed that their details are ready, but not the details themselves: they read them only after signing in.</p>`;
      const { form, close } = staffSheet(`${r.label}: ${r.customer.fullName}`, body, 'Save and tell the customer');
      onSubmit(form, async (values) => {
        const payload = { note: values.note };
        if (address) Object.assign(payload, { address: values.address, addressLabel: values.addressLabel });
        else payload.otc = otcFrom(values);
        await api.post(`/admin/vault/requests/${r.id}/confirm`, payload);
        close();
        toast('Saved. The customer can see the details on Receive now.', 'ok');
        load();
        loaded.delete('overview');
      });
    }

    /* Confirm what arrived (correcting it if need be), or record a send that was made. */
    function confirmRequest(r) {
      if (isNeed(r)) { giveDetails(r); return; }
      const body = r.kind === 'btc_out'
        ? `<p class="rf-small">Send <strong>${btc(r.units)}</strong> from the vault wallet to:</p>
          <p class="rf-mono" style="word-break:break-all">${esc(r.address)}</p>
          <p class="rf-small rf-muted">${r.ready != null ? `${btc(r.ready)} of this customer&rsquo;s Bitcoin has matured besides this request.` : ''} Once the transfer is made, enter its transaction ID and mark it sent. The Bitcoin then leaves their vault.</p>
          <div class="rf-field"><label>Transaction ID</label><input class="rf-input mono" name="txid" placeholder="64 letters and numbers" /></div>
          <div class="rf-field"><label>Note</label><input class="rf-input" name="note" /></div>`
        : `<p class="rf-small rf-muted">Check it against what actually arrived and correct anything that differs. It is booked at Bitcoin&rsquo;s closing price on the date below.</p>
          <div class="rf-row">
            ${r.kind === 'cash_in'
    ? `<div class="rf-field"><label>Amount received</label><input class="rf-input money" name="amount" inputmode="decimal" value="${(r.amount / 100).toFixed(2)}" /></div>`
    : `<div class="rf-field"><label>Bitcoin received</label><input class="rf-input money" name="units" inputmode="decimal" value="${esc(r.units)}" /></div>`}
            <div class="rf-field"><label>Term (years)</label><input class="rf-input" type="number" name="termYears" min="${TERM.min}" max="${TERM.max}" step="1" value="${esc(r.termYears || '')}" /></div>
          </div>
          ${whenFields(r.occurredAt, `When it was ${r.kind === 'cash_in' ? 'paid' : 'sent'}, as the customer gave it.`)}
          ${r.kind === 'btc_in' ? `<div class="rf-field"><label>Transaction ID</label><input class="rf-input mono" name="txid" value="${esc(r.txid || '')}" /></div>` : ''}
          <div class="rf-field"><label>Note</label><input class="rf-input" name="note" placeholder="Confirmed by the OTC partner" /></div>`;
      const { form, close } = staffSheet(`${r.label}: ${r.customer.fullName}`, body, r.kind === 'btc_out' ? 'Mark sent' : 'Confirm and book');
      onSubmit(form, async (values) => {
        const payload = { note: values.note, txid: values.txid || undefined };
        if (r.kind !== 'btc_out') {
          Object.assign(payload, { amount: values.amount, units: values.units, termYears: values.termYears, occurredAt: whenOf(values.date, values.time) || undefined });
        }
        const res = await api.post(`/admin/vault/requests/${r.id}/confirm`, payload);
        close();
        toast(r.kind === 'btc_out' ? `${res.trade.units} BTC sent and taken off the vault.` : `${res.trade.units} BTC added at ${money(res.trade.price)}.`, 'ok');
        load();
        loaded.delete('overview');
      });
    }

    statusSelect.addEventListener('change', load);

    onSubmit(qs('#rf-reject-form'), async (values) => {
      await api.post(`/admin/transfers/${acting.transferId}/reject`, values);
      RF.modal.close(rejectModal);
      toast('Withdrawal returned. The cash is converted to Bitcoin when the customer next signs in.', 'ok');
      load();
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
    set('investmentTermYears', s.investmentTermYears);
    set('vaultAddresses', s.vaultAddresses);
    set('vaultSendFee', ((s.fees && s.fees.vaultSend) / 100 || 0).toFixed(2));
    Object.entries(s.otc || {}).forEach(([key, value]) => set(`otc.${key}`, value));
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
    set('maintenanceMode', s.maintenanceMode);

    qs('[data-mail-configured]').textContent = data.emailConfigured
      ? 'Email is configured: alerts are delivered.'
      : 'No mail provider configured: alerts show when customers sign in but are not emailed.';

    onSubmit(form, async (values) => {
      const otc = {};
      Object.keys(values).filter((k) => k.startsWith('otc.')).forEach((k) => { otc[k.slice(4)] = (values[k] || '').trim(); });
      await api.put('/admin/settings', {
        bankName: (values.bankName || '').trim(),
        investmentTermYears: Number(values.investmentTermYears),
        vaultAddresses: values.vaultAddresses || '',
        otc,
        fees: { vaultSend: Math.round(Number(String(values.vaultSendFee || 0).replace(/[^0-9.]/g, '')) * 100) || 0 },
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
        maintenanceMode: Boolean(values.maintenanceMode),
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
      ['Held by customers', money(t.value), 'at the live price'],
      ['Paid in', money(t.cost), 'what the Bitcoin held cost'],
      ['Unrealised gain / loss', `${gain >= 0 ? '+' : '-'}${money(Math.abs(gain))}`, t.cost ? `${Math.abs(gain / t.cost) < 0.00005 ? '0.00' : ((gain / t.cost) * 100).toFixed(2)}%` : '&nbsp;'],
      ['Investors', String(t.investors), `${t.trades24h} trade${t.trades24h === 1 ? '' : 's'} in 24 hours`],
    ].map(([k, v, d]) => `<div class="rf-card rf-stat"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div><div class="d">${d}</div></div>`).join('');

    qs('[data-inv-holdings]').innerHTML = data.holdings.length ? data.holdings.map((h) => `
      <tr class="clickable" data-customer="${esc(h.customer.id)}">
        <td><strong>${esc(h.customer.fullName)}</strong><span class="sub">${esc(h.customer.email)}</span></td>
        <td class="num rf-mono">${esc(h.units)} BTC</td>
        <td class="num opt">${money(h.cost)}</td>
        <td class="num"><strong>${h.value == null ? '&mdash;' : money(h.value)}</strong></td>
        <td class="num rf-amt ${h.gain >= 0 ? 'credit' : 'debit'}">${h.gain == null ? '&mdash;' : `${h.gain >= 0 ? '+' : '-'}${money(Math.abs(h.gain))}`}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="rf-center rf-muted">No customer holds Bitcoin yet.</td></tr>';

    // Holdings of assets no longer offered are converted as this screen
    // loads. Any left are waiting for a live price, and convert on a reload.
    const converting = qs('[data-inv-converting]');
    converting.hidden = !data.converting;
    converting.textContent = data.converting
      ? `${data.converting} earlier investment${data.converting === 1 ? ' is' : 's are'} waiting to be converted to Bitcoin: there is no live price for ${data.converting === 1 ? 'it' : 'them'} right now. Reload this screen in a few minutes to convert ${data.converting === 1 ? 'it' : 'them'}.`
      : '';

    qs('[data-inv-trades]').innerHTML = data.trades.length ? data.trades.slice(0, 12).map((tr) => `<li class="clickable" data-customer="${esc(tr.customer.id)}">
      <span class="t"><strong>${tr.converted ? 'Converted to' : tr.side === 'buy' ? 'Bought' : 'Sold'} ${esc(tr.units)} ${esc(tr.symbol)}</strong><span>${esc(tr.customer.fullName)} &middot; ${ago(tr.createdAt)} &middot; @ ${money(tr.price)}</span></span>
      <span class="rf-amt ${tr.converted ? '' : tr.side === 'buy' ? 'debit' : 'credit'}">${money(tr.amount)}</span>
    </li>`).join('') : '<li class="rf-muted rf-small">No purchases or sales yet.</li>';
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
    // The exact SQL this database is missing, so nobody has to find the right
    // file or wonder whether the copy they ran was the latest.
    const sql = data.sql ? `
      <section class="rf-card rf-mb hs-setup-sql" data-setup-sql>
        <div class="rf-card-head"><h3>Run this in Supabase</h3><span class="rf-muted rf-small">${esc(data.sql.files.join(', '))}</span></div>
        <div class="rf-card-body">
          ${data.sql.canApply ? `
          <div class="hs-setup-apply">
            <p>The site can run this itself, on project <strong>${esc(data.sql.project)}</strong>, the one it uses.</p>
            <button class="rf-btn" type="button" data-setup-apply>Apply it for me</button>
          </div>
          <p class="rf-small rf-muted rf-mt">Or run it yourself:</p>` : `
          <div class="hs-setup-apply">
            <p><strong>Let the site run it for you</strong>, on exactly the right project:</p>
            <ol class="hs-setup-steps">
              <li>In Supabase, open <a href="${esc(data.sql.tokenUrl)}" target="_blank" rel="noopener">Account, Access Tokens</a> and generate a token, signed in to the account that owns project <strong>${esc(data.sql.project)}</strong>.</li>
              <li>In Vercel, Settings, Environment Variables, add <code>SUPABASE_ACCESS_TOKEN</code> with that token, and redeploy.</li>
              <li>Come back here and press <b>Apply it for me</b>. You can delete the token afterwards.</li>
            </ol>
          </div>
          <p class="rf-small rf-muted rf-mt">Or run it yourself:</p>`}
          <ol class="hs-setup-steps">
            <li>Open the SQL Editor of project <strong>${esc(data.sql.project)}</strong>. It has to be this project: SQL run in another one changes nothing here.</li>
            <li>Paste the SQL below into a new query and press <b>Run</b>. It should answer <b>Success. No rows returned</b>.</li>
            <li>If it shows an error instead, nothing was saved, not even the lines before the error. Copy the error and send it to whoever looks after the platform.</li>
            <li>Come back here and press <b>Check again</b>.</li>
          </ol>
          <textarea class="hs-setup-code" readonly rows="10" spellcheck="false" data-setup-code>${esc(data.sql.text)}</textarea>
          <div class="rf-mt hs-actions">
            <button class="rf-btn sm" type="button" data-setup-copy>Copy SQL</button>
            <a class="rf-btn ghost sm" href="${esc(data.sql.editorUrl)}" target="_blank" rel="noopener">Open the SQL Editor</a>
          </div>
        </div>
      </section>` : '';
    list.innerHTML = sql + groups.map((g) => `
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
    const applyBtn = qs('[data-setup-apply]');
    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        applyBtn.innerHTML = 'Running the SQL&hellip;';
        try {
          const res = await api.post('/admin/setup/apply');
          toast(res.result.sql ? 'The SQL ran, but something is still missing. See the checklist.' : `Done: ${res.applied.join(', ') || 'nothing was missing'}.`, res.result.sql ? 'bad' : 'ok');
          await setup();
        } catch (err) {
          applyBtn.disabled = false;
          applyBtn.textContent = 'Apply it for me';
          toast(err.message, 'bad');
        }
      });
    }
    const copy = qs('[data-setup-copy]');
    if (copy) {
      copy.addEventListener('click', async () => {
        const code = qs('[data-setup-code]');
        try {
          await navigator.clipboard.writeText(code.value);
        } catch (err) {
          code.select();
          document.execCommand('copy');
        }
        toast('SQL copied. Paste it into the Supabase SQL Editor and press Run.');
      });
    }
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

  const TABS = { overview, customers, register, queue, messages, alerts, activity, settings, investments, setup };

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
