'use strict';

/**
 * Moving money: the transfer form and its verification step, recipients,
 * payees and mobile check deposit.
 *
 * The transfer form is the one screen where being wrong is expensive, so it
 * shows the running total, the fee and the remaining daily limit before the
 * button is pressed, and it asks for confirmation of the recipient by name.
 */

(function () {
  const RF = window.RF;
  const { api, qs, qsa, esc, money, date, datetime, toast, badge, onSubmit } = RF;

  /* ----------------------------------------------------------- transfers -- */

  async function transfersPage() {
    const form = qs('#rf-transfer-form');
    const picker = qs('[data-type-picker]');
    const options = await api.get('/transfers/options');

    /*
     * A sign-in with no accounts of its own has nothing to move money
     * between, and two empty dropdowns are a very poor way of saying so -
     * they look like a page that failed to load rather than one with nothing
     * to show.
     *
     * In practice this is always a staff sign-in. Staff do not transfer:
     * money moves on a customer's ledger, from the console, which is a
     * different thing in a different place. Say which.
     */
    if (!options.accounts.length) {
      const staff = RF.state.user && RF.state.user.role === 'admin';
      const notice = document.createElement('div');
      notice.className = 'rf-notice warn';
      // .rf-notice is a flex row, so everything has to go in one child or
      // each sentence lands in a column of its own.
      const body = document.createElement('div');
      body.innerHTML = staff
        ? '<strong>This sign-in has no accounts of its own.</strong> Staff do not move money from here. '
          + 'Open the <a href="/console">console</a>, find the customer, and post an adjustment against the '
          + 'account you mean - a debit on one side and a credit on the other, if you are moving money between two.'
        : '<strong>There are no accounts on this profile yet.</strong> Once one is open it will appear here.';
      notice.appendChild(body);
      form.parentNode.insertBefore(notice, form);
      // Hidden, never removed. The rest of this function still writes to the
      // type picker and the limits panel, and the transfer history below is
      // worth loading whether or not this sign-in can send anything. Both of
      // those carry a display of their own, which outranks the hidden
      // attribute, so they are taken out of flow by hand instead.
      form.hidden = true;
      if (picker) picker.style.display = 'none';
      const side = notice.closest('.rf-grid.side');
      if (side && side.children.length > 1) side.lastElementChild.style.display = 'none';
    }

    let type = new URLSearchParams(location.search).get('type') || 'internal';

    picker.innerHTML = options.types.map((t) => `<button type="button" data-type="${esc(t.id)}"${t.id === type ? ' class="is-active"' : ''}>${esc(t.label)}</button>`).join('');

    const fromSelect = qs('#t-from');
    fromSelect.innerHTML = options.accounts.map((a) =>
      `<option value="${esc(a.id)}" data-avail-cents="${a.availableBalance}">${esc(a.nickname || a.name)} ${esc(a.accountMask)} &mdash; ${money(a.availableBalance)} available</option>`).join('');

    const paintDestinations = () => {
      const from = fromSelect.value;
      qs('#t-to').innerHTML = options.accounts
        .filter((a) => a.id !== from)
        .map((a) => `<option value="${esc(a.id)}">${esc(a.nickname || a.name)} ${esc(a.accountMask)}</option>`).join('');
    };
    paintDestinations();

    qs('#t-beneficiary').innerHTML = options.beneficiaries.length
      ? options.beneficiaries.map((b) =>
        `<option value="${esc(b.id)}" data-type="${esc(b.type)}">${esc(b.nickname || b.name)} &mdash; ${esc(b.bankName || 'bank')} ${esc(b.accountMask)}</option>`).join('')
      : '<option value="">No saved recipients yet</option>';

    qs('#t-payee').innerHTML = options.payees.length
      ? options.payees.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} ${esc(p.accountMask)}</option>`).join('')
      : '<option value="">No payees yet</option>';

    qs('[data-limits]').innerHTML = options.types.map((t) => {
      const left = Math.max(0, t.dailyLimit - t.usedToday);
      const pct = t.dailyLimit ? Math.min(100, Math.round((t.usedToday / t.dailyLimit) * 100)) : 0;
      return `<li>
        <span class="t"><strong>${esc(t.label)}</strong><span>${money(left)} of ${money(t.dailyLimit)} left today</span></span>
        <span class="rf-small rf-muted">${pct}%</span>
      </li>`;
    }).join('');

    qs('[data-clearing]').innerHTML = `
      <dl class="rf-dl">
        <dt>ACH</dt><dd>${esc(options.clearing.ach)}</dd>
        <dt>Domestic wire</dt><dd>${esc(options.clearing.wireDomestic)}</dd>
        <dt>International wire</dt><dd>${esc(options.clearing.wireInternational)}</dd>
      </dl>
      <p class="rf-mt">Outgoing transfers to someone new are read by our payments team before they leave. You will see the status change here and get an email either way.</p>`;

    function applyType(next) {
      type = next;
      qsa('[data-type]', picker).forEach((b) => b.classList.toggle('is-active', b.getAttribute('data-type') === type));
      qs('[data-to-internal]').hidden = type !== 'internal';
      qs('[data-to-beneficiary]').hidden = !['ach', 'wire_domestic', 'wire_international', 'instant'].includes(type);
      qs('[data-to-payee]').hidden = type !== 'bill_pay';
      qs('[data-pin-field]').hidden = !(options.requiresPin && type !== 'internal');
      summarise();
    }

    function summarise() {
      const rule = options.types.find((t) => t.id === type) || {};
      const amount = Number(String(qs('#t-amount').value || '').replace(/[^0-9.]/g, '')) || 0;
      const fee = (rule.fee || 0) / 100;
      const selected = fromSelect.selectedOptions[0];
      const available = selected ? Number(selected.getAttribute('data-avail-cents')) / 100 : 0;
      qs('[data-available]').textContent = selected ? `${money(available * 100)} available` : '';
      qs('[data-summary]').innerHTML = `
        <div>
          <strong>${money((amount + fee) * 100)} leaves your account</strong>
          ${money(amount * 100)} to the recipient${fee ? ` and a ${money(fee * 100)} ${rule.label.toLowerCase()} fee` : ', with no fee'}.
          ${rule.clearing ? `Arrives: ${esc(rule.clearing)}.` : ''}
          ${amount + fee > available ? '<br /><strong>That is more than this account has available.</strong>' : ''}
        </div>`;
    }

    picker.addEventListener('click', (event) => {
      const button = event.target.closest('[data-type]');
      if (button) applyType(button.getAttribute('data-type'));
    });
    ['#t-amount', '#t-from'].forEach((sel) => qs(sel).addEventListener('input', summarise));
    fromSelect.addEventListener('change', () => { paintDestinations(); summarise(); });
    applyType(type);

    onSubmit(form, async (data) => {
      const payload = {
        type,
        fromAccountId: data.fromAccountId,
        amount: data.amount,
        memo: data.memo,
        pin: data.pin,
        scheduledFor: data.scheduledFor,
        recurrence: data.recurrence,
      };
      if (type === 'internal') payload.toAccountId = data.toAccountId;
      else if (type === 'bill_pay') payload.payeeId = data.payeeId;
      else payload.beneficiaryId = data.beneficiaryId;

      // Say out loud who is about to be paid. A transposed digit in an account
      // number is not recoverable once a wire has left.
      const label = type === 'internal'
        ? qs('#t-to').selectedOptions[0].textContent
        : type === 'bill_pay'
          ? qs('#t-payee').selectedOptions[0].textContent
          : qs('#t-beneficiary').selectedOptions[0].textContent;
      if (!confirm(`Send ${money(Number(String(data.amount).replace(/[^0-9.]/g, '')) * 100)} to:\n\n${label}\n\nIs that right?`)) return;

      const result = await api.post('/transfers', payload);
      form.reset();
      applyType(type);

      if (result.next === 'verify') {
        await verifyStep(result.transfer, result.verification);
      } else if (result.next === 'review') {
        showReceipt(result.transfer, 'With our payments team');
      } else if (result.next === 'scheduled') {
        showReceipt(result.transfer, 'Scheduled');
      } else {
        showReceipt(result.transfer, 'Sent');
      }
      await loadHistory();
    });

    /** The one-time code step, in a modal so the form behind it stays put. */
    function verifyStep(transfer, verification) {
      return new Promise((resolve) => {
        const el = document.createElement('div');
        el.className = 'rf-modal-backdrop';
        el.innerHTML = `
          <div class="rf-modal narrow">
            <div class="rf-modal-head"><h3>Verify this transfer</h3></div>
            <form class="rf-modal-body">
              <p class="rf-small rf-muted">We emailed a six-digit code to confirm ${money(transfer.amount)} to ${esc((transfer.recipient && (transfer.recipient.nickname || transfer.recipient.name)) || 'your recipient')}.</p>
              ${verification && verification.devCode
    ? `<div class="rf-devcode">Email is not configured on this deployment, so the code is shown here: <code>${esc(verification.devCode)}</code></div>`
    : ''}
              <div class="rf-field rf-mt"><input class="rf-input mono" name="code" inputmode="numeric" maxlength="6" placeholder="000000" autocomplete="one-time-code" /></div>
              <div class="rf-notice bad rf-hide" data-form-error></div>
              <div class="rf-inline">
                <button class="rf-btn" type="submit" data-submit>Verify and send</button>
                <button class="rf-btn ghost" type="button" data-resend>Send a new code</button>
                <button class="rf-btn link" type="button" data-cancel>Cancel the transfer</button>
              </div>
            </form>
          </div>`;
        document.body.appendChild(el);
        document.body.style.overflow = 'hidden';
        const close = () => { el.remove(); document.body.style.overflow = ''; resolve(); };
        const innerForm = qs('form', el);
        qs('input', el).focus();

        onSubmit(innerForm, async (data) => {
          const result = await api.post(`/transfers/${transfer.id}/verify`, { code: data.code });
          close();
          showReceipt(result.transfer, result.next === 'review' ? 'With our payments team' : 'Sent');
        });
        qs('[data-resend]', el).addEventListener('click', async () => {
          try {
            const res = await api.post(`/transfers/${transfer.id}/resend`);
            toast('A new code is on its way.', 'ok');
            if (res.devCode) {
              const box = document.createElement('div');
              box.className = 'rf-devcode';
              box.innerHTML = `Email is not configured on this deployment, so the code is shown here: <code>${esc(res.devCode)}</code>`;
              innerForm.prepend(box);
            }
          } catch (err) { toast(err.message, 'bad'); }
        });
        qs('[data-cancel]', el).addEventListener('click', async () => {
          try { await api.post(`/transfers/${transfer.id}/cancel`); toast('Transfer cancelled.', 'ok'); } catch (err) { toast(err.message, 'bad'); }
          close();
          loadHistory();
        });
      });
    }

    /** The receipt, which is the thing a customer screenshots. */
    function showReceipt(transfer, statusLabel) {
      const el = document.createElement('div');
      el.className = 'rf-modal-backdrop';
      el.innerHTML = `
        <div class="rf-modal narrow">
          <div class="rf-modal-head"><h3>${esc(statusLabel)}</h3><button type="button" data-close aria-label="Close">&times;</button></div>
          <div class="rf-modal-body">
            <div class="rf-center rf-mb">
              <div class="rf-amt big">${money(transfer.amount)}</div>
              <div class="rf-small rf-muted">${esc(transfer.typeLabel)} &middot; ${esc(transfer.statusLabel)}</div>
            </div>
            <dl class="rf-dl">
              ${(transfer.receipt || []).map((row) => `<dt>${esc(row.label)}</dt><dd class="${/trace|IMAD|Confirmation/i.test(row.label) ? 'mono' : ''}">${esc(row.value)}</dd>`).join('')}
            </dl>
            <p class="rf-small rf-muted rf-mt">Keep the confirmation number. It is what we search on if anything needs chasing.</p>
          </div>
          <div class="rf-modal-foot">
            <button class="rf-btn ghost" type="button" data-copy>Copy the receipt</button>
            <button class="rf-btn" type="button" data-close>Done</button>
          </div>
        </div>`;
      document.body.appendChild(el);
      document.body.style.overflow = 'hidden';
      const close = () => { el.remove(); document.body.style.overflow = ''; };
      qsa('[data-close]', el).forEach((b) => b.addEventListener('click', close));
      qs('[data-copy]', el).addEventListener('click', () => {
        RF.copy((transfer.receipt || []).map((r) => `${r.label}: ${r.value}`).join('\n'), 'Receipt copied');
      });
    }

    /* History */
    const tbody = qs('[data-transfers]');
    const statusFilter = qs('[data-status-filter]');

    async function loadHistory() {
      const status = statusFilter.value;
      const data = await api.get(`/transfers${status ? `?status=${encodeURIComponent(status)}` : ''}`);
      tbody.innerHTML = data.transfers.length ? data.transfers.map((t) => `
        <tr>
          <td class="rf-nowrap">${date(t.createdAt)}<span class="sub">${new Date(t.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span></td>
          <td>${esc((t.recipient && (t.recipient.nickname || t.recipient.name)) || '&mdash;')}<span class="sub">${esc((t.recipient && (t.recipient.accountMasked || '')) || '')}</span></td>
          <td class="rf-small opt">${esc(t.typeLabel)}</td>
          <td class="rf-mono rf-small opt">${esc(t.confirmation)}</td>
          <td>${badge(t.status, t.statusLabel)}${t.reasonNote ? `<span class="sub">${esc(t.reasonNote)}</span>` : ''}</td>
          <td class="num rf-amt">${money(t.total)}</td>
          <td class="rf-right">
            ${['pending_review', 'pending_verification', 'scheduled'].includes(t.status)
    ? `<button class="rf-btn ghost sm" data-cancel="${esc(t.id)}">Cancel</button>`
    : `<button class="rf-btn link sm" data-receipt="${esc(t.id)}">Receipt</button>`}
          </td>
        </tr>`).join('') : '<tr><td colspan="7" class="rf-center rf-muted">No transfers yet.</td></tr>';
    }

    tbody.addEventListener('click', async (event) => {
      const cancelBtn = event.target.closest('[data-cancel]');
      const receiptBtn = event.target.closest('[data-receipt]');
      if (cancelBtn) {
        if (!confirm('Cancel this transfer? Any held funds come straight back.')) return;
        try {
          await api.post(`/transfers/${cancelBtn.getAttribute('data-cancel')}/cancel`);
          toast('Transfer cancelled and the funds released.', 'ok');
          loadHistory();
        } catch (err) { toast(err.message, 'bad'); }
      }
      if (receiptBtn) {
        const data = await api.get(`/transfers/${receiptBtn.getAttribute('data-receipt')}`);
        showReceipt(data.transfer, data.transfer.statusLabel);
      }
    });

    statusFilter.addEventListener('change', loadHistory);
    await loadHistory();
  }

  /* ---------------------------------------------------------- recipients -- */

  async function recipientsPage() {
    const tbody = qs('[data-rows]');
    const form = qs('#rf-beneficiary-form');

    async function load() {
      const data = await api.get('/beneficiaries');
      qs('[data-count]').textContent = `${data.beneficiaries.length} saved`;
      tbody.innerHTML = data.beneficiaries.length ? data.beneficiaries.map((b) => `
        <tr>
          <td><strong>${esc(b.nickname || b.name)}</strong><span class="sub">${esc(b.name)}${b.relationship ? ` &middot; ${esc(b.relationship)}` : ''}</span></td>
          <td class="rf-small opt">${esc(b.bankName || '&mdash;')}${b.swift ? `<span class="sub rf-mono">${esc(b.swift)}</span>` : ''}</td>
          <td class="rf-mono rf-small">${esc(b.accountMask)}${b.routingNumber ? `<span class="sub">ABA ${esc(b.routingNumber)}</span>` : ''}</td>
          <td class="rf-small opt">${esc(b.type.replace(/_/g, ' '))}</td>
          <td>${badge(b.status)}</td>
          <td class="rf-right rf-nowrap">
            <a class="rf-btn ghost sm" href="/transfers?type=${b.type === 'international_wire' ? 'wire_international' : b.type === 'domestic_wire' ? 'wire_domestic' : 'ach'}">Send</a>
            <button class="rf-btn link sm" data-remove="${esc(b.id)}">Remove</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="6" class="rf-center rf-muted">No recipients saved yet.</td></tr>';
    }

    tbody.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-remove]');
      if (!button) return;
      if (!confirm('Remove this recipient? Transfers already sent are unaffected.')) return;
      try {
        await api.del(`/beneficiaries/${button.getAttribute('data-remove')}`);
        toast('Recipient removed.', 'ok');
        load();
      } catch (err) { toast(err.message, 'bad'); }
    });

    // International wires need a SWIFT code instead of a routing number.
    const typeSelect = qs('#b-type');
    const applyType = () => {
      const international = typeSelect.value === 'international_wire';
      qs('[data-routing-field]').classList.toggle('rf-hide', international);
      qs('[data-swift-field]').classList.toggle('rf-hide', !international);
      qs('[data-country-field]').classList.toggle('rf-hide', !international);
    };
    typeSelect.addEventListener('change', applyType);
    applyType();

    onSubmit(form, async (data) => {
      await api.post('/beneficiaries', data);
      form.reset();
      applyType();
      toast('Recipient saved. Your first payment to them is reviewed before it leaves.', 'ok');
      load();
    });

    await load();
  }

  /* --------------------------------------------------------------- bills -- */

  async function billsPage() {
    const tbody = qs('[data-rows]');
    const form = qs('#rf-payee-form');

    async function load() {
      const data = await api.get('/payees');
      tbody.innerHTML = data.payees.length ? data.payees.map((p) => `
        <tr>
          <td><strong>${esc(p.name)}</strong></td>
          <td class="rf-small opt">${esc(p.category)}</td>
          <td class="rf-mono rf-small opt">${esc(p.accountMask || '&mdash;')}</td>
          <td class="rf-small">${p.dueDay ? `Day ${p.dueDay}` : '&mdash;'}${p.lastPaidAt ? `<span class="sub">Last paid ${date(p.lastPaidAt)}</span>` : ''}</td>
          <td class="num">${money(p.amount)}</td>
          <td class="opt-sm">${p.autopay ? badge('ok', 'On') : badge('info', 'Off')}</td>
          <td class="rf-right rf-nowrap">
            <a class="rf-btn ghost sm" href="/transfers?type=bill_pay">Pay</a>
            <button class="rf-btn link sm" data-autopay="${esc(p.id)}" data-on="${p.autopay ? '1' : '0'}">${p.autopay ? 'Stop autopay' : 'Autopay'}</button>
            <button class="rf-btn link sm" data-remove="${esc(p.id)}">Remove</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="7" class="rf-center rf-muted">No payees yet.</td></tr>';
    }

    tbody.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-remove]');
      const autopay = event.target.closest('[data-autopay]');
      try {
        if (remove) {
          if (!confirm('Remove this payee?')) return;
          await api.del(`/payees/${remove.getAttribute('data-remove')}`);
          toast('Payee removed.', 'ok');
        }
        if (autopay) {
          await api.patch(`/payees/${autopay.getAttribute('data-autopay')}`, { autopay: autopay.getAttribute('data-on') !== '1' });
          toast('Autopay updated.', 'ok');
        }
        if (remove || autopay) load();
      } catch (err) { toast(err.message, 'bad'); }
    });

    onSubmit(form, async (data) => {
      await api.post('/payees', data);
      form.reset();
      toast('Payee saved.', 'ok');
      load();
    });

    await load();
  }

  /* ------------------------------------------------------------- deposit -- */

  async function depositPage() {
    const form = qs('#rf-deposit-form');
    const images = { front: null, back: null };
    const { accounts } = await api.get('/accounts');

    qs('#d-account').innerHTML = accounts
      .filter((a) => !a.isCredit && a.status === 'active')
      .map((a) => `<option value="${esc(a.id)}">${esc(a.nickname || a.name)} ${esc(a.accountMask)}</option>`).join('');

    qsa('[data-image]').forEach((input) => {
      input.addEventListener('change', async () => {
        const side = input.getAttribute('data-image');
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          images[side] = await RF.readFile(file, { maxDimension: 1800 });
          const preview = qs(`[data-preview="${side}"]`);
          preview.innerHTML = `<img src="${images[side]}" alt="" style="max-height:120px;border-radius:8px" /><br /><span class="rf-small rf-muted">${esc(file.name)} &mdash; tap to replace</span>`;
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
    });

    async function loadDeposits() {
      const data = await api.get('/deposits');
      qs('[data-deposits]').innerHTML = data.deposits.length ? data.deposits.map((d) => `
        <li>
          <span class="t">
            <strong>${money(d.amount)}</strong>
            <span>${date(d.createdAt)} &middot; ${esc(d.reference)}${d.checkNumber ? ` &middot; check ${esc(d.checkNumber)}` : ''}</span>
          </span>
          ${badge(d.status)}
        </li>`).join('') : '<li class="rf-muted rf-small">No mobile deposits yet.</li>';
    }

    onSubmit(form, async (data) => {
      if (!images.front || !images.back) throw new Error('Photograph both sides of the check.');
      const result = await api.post('/deposits', {
        accountId: data.accountId,
        amount: data.amount,
        checkNumber: data.checkNumber,
        memo: data.memo,
        front: images.front,
        back: images.back,
      });
      form.reset();
      images.front = null;
      images.back = null;
      qs('[data-preview="front"]').textContent = 'Tap to photograph the front';
      qs('[data-preview="back"]').textContent = 'Tap to photograph the back';
      toast(`Deposit received. ${money(result.deposit.availableNow)} is available tomorrow, the rest by ${date(result.deposit.holdUntil)}.`, 'ok');
      loadDeposits();
    });

    await loadDeposits();
  }

  /* -------------------------------------------------------------- router -- */

  const ROUTES = {
    '/transfers': transfersPage,
    '/recipients': recipientsPage,
    '/bills': billsPage,
    '/deposit': depositPage,
  };

  RF.ready(async () => {
    const route = ROUTES[location.pathname.replace(/\/$/, '')];
    if (!route) return;
    try {
      await route();
    } catch (err) {
      console.error('[rockfield]', err);
      toast(err.message || 'This page could not load.', 'bad');
    }
  });
}());
