'use strict';

/**
 * Profile, documents, security settings and the customer's own activity log.
 */

(function () {
  const RF = window.RF;
  const { api, qs, qsa, esc, date, datetime, ago, toast, badge, onSubmit, money } = RF;

  /* ------------------------------------------------------------- profile -- */

  async function profilePage() {
    const form = qs('#rf-profile-form');
    const data = await api.get('/me');
    const user = data.user;

    // Read-only fields come from the record; the editable ones are form values.
    qsa('[data-readonly]').forEach((el) => { el.value = user[el.getAttribute('data-readonly')] || ''; });
    ['preferredName', 'phone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
      'employmentStatus', 'employer', 'occupation'].forEach((field) => {
      const input = qs(`[name="${field}"]`, form);
      if (input) input.value = user[field] || '';
    });

    qs('[data-relationship]').innerHTML = [
      ['Customer number', `<span class="rf-mono">${esc(user.customerNumber)}</span>`],
      ['Tier', esc(user.tier)],
      ['Status', badge(user.status)],
      ['Identity check', badge(user.kycStatus)],
      ['With us since', date(user.createdAt)],
      ['Last signed in', user.lastLoginAt ? datetime(user.lastLoginAt) : 'First visit'],
      ['Accounts', String(data.counts.accounts)],
      ['Cards', String(data.counts.cards)],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

    onSubmit(form, async (values) => {
      const res = await api.patch('/me', values);
      RF.state.session.user = res.user;
      RF.paintUser(RF.state.session);
      toast('Your details are saved. We have emailed you a confirmation.', 'ok');
    });

    // Paperless switch.
    const paperless = qs('[data-toggle="paperless"]');
    if (paperless) {
      paperless.checked = Boolean(user.paperless);
      paperless.addEventListener('change', async () => {
        try {
          await api.put('/me/alert-preferences', { preferences: {}, paperless: paperless.checked });
          toast(paperless.checked ? 'Paperless statements on.' : 'We will post paper statements. A $2.00 fee applies to each.', 'ok');
        } catch (err) {
          toast(err.message, 'bad');
          paperless.checked = !paperless.checked;
        }
      });
    }

    /* Documents */
    async function loadDocuments() {
      const res = await api.get('/me/documents');
      qs('[data-documents]').innerHTML = res.documents.length ? res.documents.map((doc) => `
        <li>
          <span class="t">
            <strong>${esc(doc.kindLabel)}</strong>
            <span>${esc(doc.filename)} &middot; ${Math.round(doc.size / 1024)}KB &middot; ${date(doc.createdAt)}${doc.uploadedBy === 'admin' ? ' &middot; filed by the bank' : ''}</span>
          </span>
          <a class="rf-btn ghost sm" href="${esc(doc.url)}" target="_blank" rel="noopener">View</a>
          <button class="rf-btn link sm" data-remove="${esc(doc.id)}">Remove</button>
        </li>`).join('') : '<li class="rf-muted rf-small">Nothing on file yet.</li>';
    }

    qs('[data-documents]').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-remove]');
      if (!button) return;
      try {
        await api.del(`/me/documents/${button.getAttribute('data-remove')}`);
        toast('Document removed.', 'ok');
        loadDocuments();
      } catch (err) { toast(err.message, 'bad'); }
    });

    const docForm = qs('#rf-document-form');
    onSubmit(docForm, async () => {
      const input = qs('input[type="file"]', docForm);
      const file = input.files && input.files[0];
      if (!file) throw new Error('Choose a file first.');
      const dataUrl = await RF.readFile(file);
      await api.post('/me/documents', {
        kind: qs('select[name="kind"]', docForm).value,
        filename: file.name,
        file: dataUrl,
      });
      docForm.reset();
      toast('Document uploaded.', 'ok');
      loadDocuments();
    });

    /* Photo */
    const avatarInput = qs('[data-avatar]');
    if (avatarInput) {
      avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files && avatarInput.files[0];
        if (!file) return;
        try {
          const dataUrl = await RF.readFile(file, { maxDimension: 512 });
          const res = await api.post('/me/documents', { kind: 'avatar', filename: file.name, file: dataUrl });
          RF.state.session.user.photoUrl = res.photoUrl;
          RF.paintUser(RF.state.session);
          toast('Photo updated.', 'ok');
          loadDocuments();
        } catch (err) {
          toast(err.message, 'bad');
        }
      });
    }

    await loadDocuments();
  }

  /* ------------------------------------------------------------ security -- */

  async function securityPage() {
    const data = await api.get('/me/security');

    qs('[data-password-changed]').textContent = data.passwordChangedAt
      ? `Last changed ${ago(data.passwordChangedAt)}.`
      : 'Never changed.';

    const twoFactor = qs('[data-toggle="twoFactorEnabled"]');
    twoFactor.checked = Boolean(data.twoFactorEnabled);
    twoFactor.addEventListener('change', async () => {
      try {
        await api.patch('/me/security', { twoFactorEnabled: twoFactor.checked });
        toast(twoFactor.checked ? 'Two-step verification is on.' : 'Two-step verification is off. We do not recommend it.', twoFactor.checked ? 'ok' : 'bad');
      } catch (err) {
        toast(err.message, 'bad');
        twoFactor.checked = !twoFactor.checked;
      }
    });

    if (data.securityQuestion) {
      const select = qs('#s-question');
      if (select) select.value = data.securityQuestion;
    }
    const pinLabel = qs('#s-pin');
    if (pinLabel && data.hasTransferPin) pinLabel.placeholder = 'A PIN is set. Enter a new one to change it.';

    onSubmit(qs('#rf-password-form'), async (values) => {
      const res = await api.post('/auth/password', values);
      qs('#rf-password-form').reset();
      toast(`Password changed. ${res.signedOutSessions} other device(s) signed out.`, 'ok');
      setTimeout(() => location.reload(), 1200);
    });

    onSubmit(qs('#rf-pin-form'), async (values) => {
      await api.patch('/me/security', values);
      qs('#rf-pin-form').reset();
      toast('Transfer PIN saved.', 'ok');
    });

    onSubmit(qs('#rf-question-form'), async (values) => {
      await api.patch('/me/security', values);
      toast('Security question saved.', 'ok');
    });

    function renderSessions(sessions) {
      qs('[data-sessions]').innerHTML = sessions.map((session) => `
        <li>
          <span class="t">
            <strong>${esc(session.device)}${session.current ? ' &middot; this device' : ''}</strong>
            <span>${esc(session.ip || 'unknown address')} &middot; last seen ${ago(session.lastSeenAt)}</span>
          </span>
          ${session.current ? badge('ok', 'Current') : `<button class="rf-btn link sm" data-revoke="${esc(session.id)}">Sign out</button>`}
        </li>`).join('') || '<li class="rf-muted rf-small">No other devices.</li>';
    }
    renderSessions(data.sessions);

    qs('[data-sessions]').addEventListener('click', async (event) => {
      const button = event.target.closest('[data-revoke]');
      if (!button) return;
      try {
        await api.del(`/me/sessions/${button.getAttribute('data-revoke')}`);
        toast('That device is signed out.', 'ok');
        const fresh = await api.get('/me/security');
        renderSessions(fresh.sessions);
      } catch (err) { toast(err.message, 'bad'); }
    });

    qs('[data-revoke-all]').addEventListener('click', async () => {
      if (!confirm('Sign out every other device?')) return;
      const res = await api.post('/me/sessions/revoke-all');
      toast(`${res.signedOut} device(s) signed out.`, 'ok');
      const fresh = await api.get('/me/security');
      renderSessions(fresh.sessions);
    });

    qs('[data-activity]').innerHTML = data.activity.slice(0, 12).map((row) => `
      <li>
        <span class="t"><strong>${esc(row.detail || row.action)}</strong><span>${esc(row.device || '')} &middot; ${esc(row.ip || '')}</span></span>
        <span class="rf-small rf-muted rf-nowrap">${ago(row.createdAt)}</span>
      </li>`).join('') || '<li class="rf-muted rf-small">Nothing yet.</li>';
  }

  /* ------------------------------------------------------------ activity -- */

  async function activityPage() {
    const data = await api.get('/me/activity?limit=200');
    qs('[data-rows]').innerHTML = data.activity.length ? data.activity.map((row) => `
      <tr>
        <td class="rf-nowrap rf-small">${datetime(row.createdAt)}</td>
        <td><strong>${esc(row.detail || row.action)}</strong><span class="sub rf-mono">${esc(row.action)}</span></td>
        <td>${badge(row.severity === 'info' ? 'info' : row.severity, row.category)}</td>
        <td class="rf-small opt">${esc(row.device || '&mdash;')}</td>
        <td class="rf-small rf-mono opt">${esc(row.ip || '&mdash;')}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="rf-center rf-muted">Nothing yet.</td></tr>';
  }

  const ROUTES = {
    '/profile': profilePage,
    '/security': securityPage,
    '/activity': activityPage,
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
