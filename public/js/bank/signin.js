'use strict';

/**
 * Sign in, verify, reset and the forced password change.
 *
 * All four live on pages that nobody is signed in to yet, so this script never
 * assumes a session and never redirects away on a 401 - it shows the message
 * and lets the person try again.
 */

(function () {
  const { api, qs, qsa, onSubmit, showError, toast } = window.RF;

  const params = new URLSearchParams(location.search);
  const nextUrl = params.get('next');

  /** Where to land after a successful sign-in. */
  function landing(result) {
    if (nextUrl && nextUrl.startsWith('/') && !nextUrl.startsWith('//')) return nextUrl;
    return result.redirect || '/dashboard';
  }

  /* ------------------------------------------------------------ sign in -- */

  function signin() {
    const form = qs('#rf-signin-form');
    if (!form) return;
    const verifyForm = qs('#rf-verify-form');
    let pendingEmail = '';
    let remember = false;

    // A session that timed out, or a sign-out, says so rather than leaving the
    // page looking like nothing happened.
    const reason = params.get('reason');
    if (reason === 'expired') toast('Your session timed out. Sign in again to carry on.', '', 'Signed out');
    if (reason === 'signed-out') toast('You are signed out.', 'ok');

    // The demonstration credentials appear only where the bank is already
    // handing one-time codes back in its responses - a laptop, or a deployment
    // that has deliberately asked for it. A live bank shows nobody its logins.
    const demoCard = qs('[data-demo-card]');
    if (demoCard) {
      api.get('/config')
        .then((cfg) => { if (cfg && cfg.devCodes) demoCard.classList.remove('rf-hide'); })
        .catch(() => {});
    }

    qsa('[data-fill]').forEach((button) => button.addEventListener('click', () => {
      const which = button.getAttribute('data-fill');
      qs('#rf-email').value = which === 'admin' ? 'admin@rockfieldglobalfinance.com' : 'demo@rockfieldglobalfinance.com';
      qs('#rf-password').value = which === 'admin' ? 'Rockfield#Admin2026' : 'Bedrock#Demo2026';
      qs('#rf-password').focus();
    }));

    onSubmit(form, async (data) => {
      pendingEmail = data.email || '';
      remember = Boolean(data.remember);
      const result = await api.post('/auth/login', {
        email: pendingEmail,
        password: data.password,
        remember,
      });

      if (result.status === 'verification_required') {
        form.classList.add('rf-hide');
        verifyForm.classList.remove('rf-hide');
        qs('[data-sent-to]').textContent = result.sentTo || pendingEmail;
        if (result.devCode) {
          const box = qs('[data-dev-code]', verifyForm);
          box.innerHTML = `Email is not configured on this deployment, so the code is shown here: <code>${result.devCode}</code>`;
          box.classList.remove('rf-hide');
        }
        const first = qs('input', qs('[data-otp]'));
        if (first) first.focus();
        return;
      }
      location.href = landing(result);
    });

    /* The six boxes behave like one field: type across them, paste into them,
       backspace back through them. */
    const otp = qs('[data-otp]', verifyForm);
    if (otp) {
      const boxes = qsa('input', otp);
      boxes.forEach((box, index) => {
        box.addEventListener('input', () => {
          box.value = box.value.replace(/\D/g, '').slice(0, 1);
          if (box.value && boxes[index + 1]) boxes[index + 1].focus();
          if (boxes.every((b) => b.value)) verifyForm.requestSubmit();
        });
        box.addEventListener('keydown', (event) => {
          if (event.key === 'Backspace' && !box.value && boxes[index - 1]) boxes[index - 1].focus();
        });
        box.addEventListener('paste', (event) => {
          const text = (event.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
          if (!text) return;
          event.preventDefault();
          text.split('').forEach((digit, i) => { if (boxes[i]) boxes[i].value = digit; });
          if (text.length === 6) verifyForm.requestSubmit();
        });
      });

      onSubmit(verifyForm, async () => {
        const code = boxes.map((b) => b.value).join('');
        if (code.length !== 6) throw new Error('Enter all six digits.');
        const result = await api.post('/auth/verify', { email: pendingEmail, code, remember });
        location.href = landing(result);
      });

      qs('[data-resend]', verifyForm).addEventListener('click', async () => {
        try {
          const result = await api.post('/auth/resend', { email: pendingEmail });
          toast('A new code is on its way.', 'ok');
          if (result.devCode) {
            const box = qs('[data-dev-code]', verifyForm);
            box.innerHTML = `Email is not configured on this deployment, so the code is shown here: <code>${result.devCode}</code>`;
            box.classList.remove('rf-hide');
          }
        } catch (err) {
          showError(verifyForm, err.message);
        }
      });

      qs('[data-back]', verifyForm).addEventListener('click', () => {
        verifyForm.classList.add('rf-hide');
        form.classList.remove('rf-hide');
        boxes.forEach((b) => { b.value = ''; });
      });
    }
  }

  /* -------------------------------------------------------------- reset -- */

  function forgot() {
    const form = qs('#rf-forgot-form');
    if (!form) return;
    const resetForm = qs('#rf-reset-form');
    let email = '';

    onSubmit(form, async (data) => {
      email = data.email;
      const result = await api.post('/auth/forgot', { email });
      form.classList.add('rf-hide');
      resetForm.classList.remove('rf-hide');
      if (result.devCode) {
        const box = qs('[data-dev-code]', resetForm);
        box.innerHTML = `Email is not configured on this deployment, so the code is shown here: <code>${result.devCode}</code>`;
        box.classList.remove('rf-hide');
      }
      toast('If that address has an account, a code is on its way.', 'ok');
    });

    onSubmit(resetForm, async (data) => {
      if (data.newPassword !== data.confirm) throw new Error('The two passwords do not match.');
      await api.post('/auth/reset', { email, code: data.code, newPassword: data.newPassword });
      toast('Your password is set. Sign in with it now.', 'ok');
      setTimeout(() => { location.href = '/signin'; }, 900);
    });
  }

  /* ----------------------------------------------------------- forced -- */

  function changePassword() {
    const form = qs('#rf-change-form');
    if (!form) return;
    onSubmit(form, async (data) => {
      if (data.newPassword !== data.confirm) throw new Error('The two passwords do not match.');
      const result = await api.post('/auth/password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      });
      toast(`Password changed. ${result.signedOutSessions || 0} other device(s) signed out.`, 'ok');
      setTimeout(() => { location.href = '/dashboard'; }, 800);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    signin();
    forgot();
    changePassword();
  });
}());
