'use strict';

(function () {
  const M = window.ROCKFIELD || window.MERKEL; if (!M) return;
  const wrap = document.getElementById('roles');
  if (!wrap) return;
  const esc = M.esc;
  const FALLBACK = [
    { id: 'personal-banker', title: 'Personal Banker', team: 'Retail', location: 'Columbus, OH', type: 'Full time', summary: 'Open accounts, sit with people through the hard conversations about money, and know when to escalate rather than improvise.' },
    { id: 'payments-operations-analyst', title: 'Payments Operations Analyst', team: 'Payments', location: 'Columbus, OH', type: 'Full time', summary: 'Review and release outgoing wires and ACH files, and hold the ones that should not go.' }
  ];

  const role = (r) => `
    <div class="role" data-reveal>
      <div>
        <div class="team">${esc(r.team)}</div>
        <h3>${esc(r.title)}</h3>
        <p class="role-sum">${esc(r.summary)}</p>
      </div>
      <div class="role-meta">${esc(r.location)}<br>${esc(r.type)}</div>
      <a class="apply" href="/apply?role=${encodeURIComponent(r.id)}">Apply <span class="arw">&rsaquo;</span></a>
    </div>`;

  (async () => {
    let roles = FALLBACK;
    try { const d = await M.fetchJSON('/api/careers'); roles = d.roles || FALLBACK; } catch (e) {}
    wrap.innerHTML = roles.map(role).join('');
    M.observeReveals();
  })();
})();
