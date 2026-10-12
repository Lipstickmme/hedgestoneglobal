'use strict';

/* The recruitment form. Roles come from the same API the careers page uses,
   and the one named in ?role= is preselected so the apply link carries over. */
(function () {
  const M = window.ROCKFIELD || window.MERKEL; if (!M) return;
  const form = document.getElementById('apply-form');
  if (!form) return;

  const statusEl = document.getElementById('apply-status');
  const btn = document.getElementById('apply-submit');
  const select = document.getElementById('apply-role');
  const titleEl = document.getElementById('apply-role-title');
  const subEl = document.getElementById('apply-role-sub');
  const metaEl = document.getElementById('apply-role-meta');
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const field = (n) => form.elements.namedItem(n);

  let roles = [];

  const setErr = (name, msg) => {
    const errEl = form.querySelector(`[data-err="${name}"]`);
    const wrap = errEl ? errEl.closest('.field') : null;
    if (errEl) errEl.textContent = msg || '';
    if (wrap) wrap.classList.toggle('invalid', Boolean(msg));
  };

  function describe(role) {
    if (!role) {
      titleEl.textContent = 'Speculative application';
      subEl.textContent = 'Tell us what you have built and where you want to take it next.';
      metaEl.innerHTML = '';
      return;
    }
    titleEl.textContent = role.title;
    subEl.textContent = role.summary;
    metaEl.innerHTML = `
      <div class="row"><div class="k">Team</div><div class="val">${M.esc(role.team)}</div></div>
      <div class="row"><div class="k">Location</div><div class="val">${M.esc(role.location)}</div></div>
      <div class="row"><div class="k">Contract</div><div class="val">${M.esc(role.type)}</div></div>`;
  }

  function validate() {
    let ok = true;
    const name = field('name').value.trim();
    const email = field('email').value.trim();
    const message = field('message').value.trim();
    if (name.length < 2) { setErr('name', 'Please enter your name.'); ok = false; } else setErr('name', '');
    if (!EMAIL_RE.test(email)) { setErr('email', 'Enter a valid email.'); ok = false; } else setErr('email', '');
    if (message.length < 20) { setErr('message', 'A little more detail, please.'); ok = false; } else setErr('message', '');
    return ok;
  }

  ['name', 'email', 'message'].forEach((n) => {
    field(n).addEventListener('blur', validate);
    field(n).addEventListener('input', () => {
      const errEl = form.querySelector(`[data-err="${n}"]`);
      if (errEl && errEl.textContent) validate();
    });
  });

  select.addEventListener('change', () => {
    describe(roles.find((r) => r.id === select.value));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.className = 'form-status';
    if (!validate()) {
      statusEl.className = 'form-status bad';
      statusEl.textContent = 'Please correct the highlighted fields.';
      return;
    }

    const payload = {
      name: field('name').value.trim(),
      email: field('email').value.trim(),
      phone: field('phone').value.trim(),
      roleId: select.value,
      experience: field('experience').value,
      portfolio: field('portfolio').value.trim(),
      message: field('message').value.trim(),
      website: field('website') ? field('website').value : '',
    };

    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = 'Sending';
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        form.reset();
        describe(null);
        statusEl.className = 'form-status ok';
        statusEl.textContent = data.message || 'Thank you. Your application is with our recruitment team.';
      } else if (res.status === 422 && data.fields) {
        Object.entries(data.fields).forEach(([k, v]) => setErr(k, v));
        statusEl.className = 'form-status bad';
        statusEl.textContent = 'Please correct the highlighted fields.';
      } else if (res.status === 429) {
        statusEl.className = 'form-status bad';
        statusEl.textContent = 'Too many attempts. Please wait a moment and try again.';
      } else {
        statusEl.className = 'form-status bad';
        statusEl.textContent = data.message || `Something went wrong. Please email ${M.site.email}.`;
      }
    } catch (err) {
      statusEl.className = 'form-status bad';
      statusEl.textContent = `Network error. Please email ${M.site.email}.`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  (async () => {
    try { const d = await M.fetchJSON('/api/careers'); roles = d.roles || []; } catch (e) {}
    roles.forEach((r) => {
      const option = document.createElement('option');
      option.value = r.id;
      option.textContent = `${r.title} (${r.location})`;
      select.appendChild(option);
    });
    const wanted = new URLSearchParams(window.location.search).get('role');
    if (wanted && roles.some((r) => r.id === wanted)) {
      select.value = wanted;
      describe(roles.find((r) => r.id === wanted));
    }
  })();
})();
